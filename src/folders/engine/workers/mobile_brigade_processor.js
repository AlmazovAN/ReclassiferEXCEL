(() => {
  'use strict';

  const rules = globalThis.ReclassifierMobileBrigadeRules;
  if (!rules) throw new Error('Mobile Brigade rules are not loaded in worker runtime.');
  if (!globalThis.XLSX) throw new Error('SheetJS is not loaded in worker runtime.');

  const OUTPUT_COLUMNS = rules.outputColumns;
  const key = rules.key;
  const text = rules.text;

  const REQUIRED_HEADERS = [
    'Тип задачи',
    'Фактическая дата',
    'Фактические трудозатраты'
  ];

  const IDENTITY_HEADERS = ['Участок', 'Заявка', 'Номер задачи'];
  // Columns observed in the two supported source exports but not emitted to the 38-column result.
  const KNOWN_SOURCE_HEADERS = new Set([...OUTPUT_COLUMNS, ...["Приоритет","Услуга","% Использованного времени","Остаток","Backlog","Вид работ","Вандальные действия","Вес","Статус в системе","Плановая дата","Трудозатраты","В сменное задание","Наряд - допуск","Причина отсутствия фото","Комментарий по отсутствию фото","Файлы (Место работ)","Файлы (До/В процессе работ)","Файлы (После работ)","Файлы (Вандальные действия)","Файлы (Внешние факторы)","Файлы (Наряд - допуск)","Факт. - план. трудозатраты","% Плановой загрузки по смене","% Плановой загрузки по бригаде","% Фактической загрузки по бригаде","Комментарий по закрытой смене","Категория замечания ОПиН","Непредоставлений оборудования","Небезопасные внешние факторы","Условия","Описание и адрес выявленных условий","Часовой пояс","Комментарий","Комментарий по закрытой задаче","Source.Name"]].map(key));

  const MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = text(value).replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function roundNumber(value, digits = 6) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function dateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;

    if (typeof value === 'number' && Number.isFinite(value) && globalThis.XLSX?.SSF?.parse_date_code) {
      const parsed = globalThis.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
      }
    }

    const normalized = text(value);
    if (!normalized) return null;

    let match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      const result = new Date(
        year, Number(match[2]) - 1, Number(match[1]),
        Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
      );
      return Number.isNaN(result.getTime()) ? null : result;
    }

    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const result = new Date(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
      );
      return Number.isNaN(result.getTime()) ? null : result;
    }

    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  function periodFromFileName(fileName) {
    const values = [...String(fileName || '').matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)]
      .map(match => match[1] + '-' + match[2] + '-' + match[3])
      .filter(value => !Number.isNaN(Date.parse(value + 'T00:00:00')))
      .sort();
    return {
      from: values.at(0) || null,
      to: values.at(-1) || null
    };
  }

  function freshnessFromFileName(fileName) {
    return periodFromFileName(fileName).to;
  }

  function findInputTables(workbook) {
    const required = REQUIRED_HEADERS.map(key);
    const tables = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = globalThis.XLSX.utils.sheet_to_json(sheet, {
        header: 1, raw: true, defval: null, blankrows: false
      });
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
        const normalized = (rows[rowIndex] || []).map(key);
        if (!required.every(header => normalized.includes(header)) ||
            !IDENTITY_HEADERS.some(header => normalized.includes(key(header)))) continue;
        const header = rows[rowIndex] || [];
        const columns = header.map(text).filter(Boolean);
        const unknownColumns = [...new Set(columns.filter(column => !KNOWN_SOURCE_HEADERS.has(key(column))))];
        const duplicateHeaders = [...new Set(columns.filter((column, index) =>
          columns.findIndex(other => key(other) === key(column)) !== index))];
        tables.push({ sheetName, rows, headerRowIndex: rowIndex, unknownColumns, duplicateHeaders });
        break;
      }
    }
    return tables;
  }

  function buildPositions(header) {
    const positions = new Map();
    header.forEach((title, index) => {
      const normalized = key(title);
      if (normalized && !positions.has(normalized)) positions.set(normalized, index);
    });
    return positions;
  }

  function valueAt(row, positions, column) {
    const index = positions.get(key(column));
    return index === undefined ? null : row[index];
  }

  function hasSourceData(row, positions) {
    return ['Заявка', 'Номер задачи', 'Описание', 'Тип задачи', 'Фактическая дата']
      .some(column => {
        const value = valueAt(row, positions, column);
        return value !== null && value !== undefined && text(value) !== '';
      });
  }

  function outputFileName(freshness) {
    return 'Мобильные_бригады' + (freshness ? '_' + freshness : '') + '.xlsx';
  }

  function buildItsmCreatedAtIndex(records) {
    const index = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const number = key(record?.number);
      if (!number) continue;
      const createdAt = rules.parseItsmCreatedAt(record?.createdAt);
      if (createdAt) index.set(number, createdAt);
    }
    return index;
  }

  function buildOutputRecord(row, positions, itsmCreatedAtByNumber) {
    const direct = {};
    for (const column of OUTPUT_COLUMNS.slice(0, 30)) {
      direct[column] = column === 'Объединённый комментарий'
        ? null
        : valueAt(row, positions, column);
    }

    const sourceComment = valueAt(row, positions, 'Комментарий');
    const sourceCloseComment = valueAt(row, positions, 'Комментарий по закрытой задаче');
    const combinedComment = rules.mergeComments(sourceComment, sourceCloseComment);
    const labor = rules.parseLaborHours(valueAt(row, positions, 'Фактические трудозатраты'));
    const laborHours = labor.hours;
    const crew = numberValue(valueAt(row, positions, 'Количество человек в бригаде'));
    const astroHours = Number.isFinite(laborHours) && crew !== null && crew > 0
      ? roundNumber(laborHours / crew)
      : null;
    const factDate = dateValue(valueAt(row, positions, 'Фактическая дата'));

    const result = {
      ...direct,
      'Объединённый комментарий': combinedComment,
      'ФактТрудочас, чел-час': laborHours,
      'ФактАстрочас, час': astroHours,
      'Ненулевые Труды': laborHours > 0 ? 'Да' : 'Нет',
      'МесСмены': factDate ? MONTHS[factDate.getMonth()] : '',
      'ГодСмены': factDate ? factDate.getFullYear() : '',
      'Итог Новый тип задач': rules.classifyTask({
        type: valueAt(row, positions, 'Тип задачи'),
        description: valueAt(row, positions, 'Описание'),
        comment: sourceComment,
        closeComment: sourceCloseComment
      }),
      'Дата создания вызова ITSM': itsmCreatedAtByNumber.get(key(valueAt(row, positions, 'Заявка'))) || '',
      'Возраст пред-бэклога': ''
    };

    return result;
  }

  // Folder processing updates derived Excel columns without a parallel database staging path.
  // Modify only derived columns in the original Excel workbook, preserving row identities.
  const FOLDER_DERIVED_COLUMNS = Object.freeze([
    'Объединённый комментарий',...OUTPUT_COLUMNS.slice(30)
  ]);

  function folderSetCell(sheet, rowIndex, columnIndex, value) {
    const cell = value instanceof Date && !Number.isNaN(value.getTime())
      ? {t:'d',v:value}
      : typeof value === 'number' && Number.isFinite(value)
        ? {t:'n',v:value}
        : typeof value === 'boolean' ? {t:'b',v:value}
        : {t:'s',v:String(value ?? '')};
    if (Array.isArray(sheet) || Array.isArray(sheet['!data'])) {
      const rows=Array.isArray(sheet) ? sheet : sheet['!data'];
      if (!rows[rowIndex]) rows[rowIndex]=[];
      rows[rowIndex][columnIndex]=cell;
    } else {
      sheet[globalThis.XLSX.utils.encode_cell({r:rowIndex,c:columnIndex})]=cell;
    }
  }

  function folderHeader(header) {
    const positions = buildPositions(header);
    return REQUIRED_HEADERS.every(name => positions.has(key(name))) &&
      IDENTITY_HEADERS.some(name => positions.has(key(name))) ? positions : null;
  }

  function folderDetectTables(workbook) {
    const tables=[];
    for (const sheetName of workbook.SheetNames) {
      const sheet=workbook.Sheets[sheetName];
      const rows=globalThis.XLSX.utils.sheet_to_json(sheet,{
        header:1,raw:true,defval:null,blankrows:true
      });
      for(let headerRowIndex=0;headerRowIndex<Math.min(rows.length,25);headerRowIndex++){
        const header=rows[headerRowIndex]||[];
        const normalized=header.map(key);
        if(!REQUIRED_HEADERS.every(name=>normalized.includes(key(name))) ||
           !IDENTITY_HEADERS.some(name=>normalized.includes(key(name)))) continue;
        const headers=normalized.filter(Boolean);
        if(new Set(headers).size!==headers.length) {
          throw new Error('Повторяющиеся заголовки в МБ: лист «'+sheetName+'».');
        }
        tables.push({sheetName,sheet,rows,headerRowIndex,positions:buildPositions(header)});
        break;
      }
    }
    return tables;
  }

  function reuseFolderTables(workbook, layouts) {
    return layouts.map(layout => {
      const sheet = workbook.Sheets[layout.sheetName];
      if (!sheet) throw new Error('МБ: проверенный лист отсутствует: ' + layout.sheetName);
      const rows = globalThis.XLSX.utils.sheet_to_json(sheet,{
        header:1,raw:true,defval:null,blankrows:true
      });
      return {...layout,sheet,rows};
    });
  }

  function folderDateString(value) {
    const date=dateValue(value);
    if(!date) return null;
    const pad=n=>String(n).padStart(2,'0');
    return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());
  }

  function folderWriteBuffer(workbook) {
    const written=globalThis.XLSX.write(workbook,{
      bookType:'xlsx',type:'array',compression:true,bookSST:true
    });
    if (written instanceof ArrayBuffer) return written;
    if (ArrayBuffer.isView(written)) {
      return written.buffer.slice(written.byteOffset,written.byteOffset+written.byteLength);
    }
    throw new Error('SheetJS не вернул байты XLSX для безопасного сохранения МБ.');
  }

  async function processFolder(payload, reportProgress=()=>{}) {
    const mode=payload?.folderMode;
    if(!['evidence','prepare'].includes(mode))
      throw new Error('Неизвестный режим обработки МБ в «Папки».');
    if(!(payload?.bytes instanceof ArrayBuffer))
      throw new Error('Обработчик МБ ожидает ArrayBuffer одного исходного XLSX.');
    if(mode==='prepare' && !(payload.folderItsmIndex instanceof Map) && !Array.isArray(payload?.itsmData))
      throw new Error('Для заполнения связей МБ требуется актуальный список ITSM.');
    let workbook=null;
    const records=[];
    const approvedRanges=[];
    let rowCount=0;
    let latestDate=null;
    let unmatched=0;
    const itsmIndex=payload.folderItsmIndex || buildItsmCreatedAtIndex(payload?.itsmData);
    try {
      workbook=globalThis.XLSX.read(new Uint8Array(payload.bytes),{
        type:'array',cellDates:true,cellFormula:true,dense:true
      });
      const tables=Array.isArray(payload.folderHeaderLayouts)
        ? reuseFolderTables(workbook,payload.folderHeaderLayouts) : folderDetectTables(workbook);
      if(!tables.length)
        throw new Error('Нет таблиц МБ с обязательными заголовками и идентификаторами.');
      reportProgress({percent:15,label:'Проверка листов МБ'});
      for(let index=0;index<tables.length;index++){
        const table=tables[index];
        const header=table.rows[table.headerRowIndex]||[];
        const positions=table.positions;
        let columns=null;
        if(mode==='prepare'){
          const bounds=table.sheet['!ref']
            ?globalThis.XLSX.utils.decode_range(table.sheet['!ref'])
            :{s:{r:0,c:0},e:{r:table.rows.length-1,c:header.length-1}};
          let nextColumn=Math.max(bounds.e.c+1,header.length);
          if(nextColumn+FOLDER_DERIVED_COLUMNS.length>16384)
            throw new Error('В XLSX МБ недостаточно столбцов для вычисляемых полей.');
          columns=new Map();
          for(const name of FOLDER_DERIVED_COLUMNS){
            let column=positions.get(key(name));
            if(column===undefined){column=nextColumn++;folderSetCell(table.sheet,table.headerRowIndex,column,name);}
            columns.set(name,column);
          }
          // Approve precisely these named computed columns on one original sheet.
          // Existing original fields, comments and task numbers are NOT writable.
          for(const [name,column] of columns) {
            const col=globalThis.XLSX.utils.encode_col(column);
            approvedRanges.push({sheet:table.sheetName,
              range:col+(table.headerRowIndex+1)+':'+col+Math.max(table.rows.length,table.headerRowIndex+1)});
          }
          if(table.sheet['!ref']) {
            bounds.e.c=Math.max(bounds.e.c,nextColumn-1);
            table.sheet['!ref']=globalThis.XLSX.utils.encode_range(bounds);
          }
        }
        let accepted=0;
        for(let rowIndex=table.headerRowIndex+1;rowIndex<table.rows.length;rowIndex++){
          const row=table.rows[rowIndex]||[];
          if(!hasSourceData(row,positions)) continue;
          const calculated=buildOutputRecord(row,positions,itsmIndex);
          const request=text(calculated['Заявка']);
          const labor=rules.parseLaborHours(calculated['Фактические трудозатраты']);
          if(request && mode==='evidence') {
            records.push({
              request,
              laborHours:labor.hours,
              equipmentPlacement:text(calculated['Навесное / Стационарное']),
              transport:text(calculated['Транспорт']),
              equipmentUnit:text(calculated['Единица оборудования'])
            });
          }else if(!request){unmatched++;}
          const date=folderDateString(calculated['Фактическая дата']);
          if(date && (!latestDate||date>latestDate))latestDate=date;
          if(mode==='prepare'){
            for(const [name,column] of columns) {
              const value=calculated[name];
              if(typeof value==='string' && value.length>32767)
                throw new Error('Вычисленный текст превышает лимит Excel 32767 символов: '+name);
              folderSetCell(table.sheet,rowIndex,column,value);
            }
          }
          accepted++;rowCount++;
        }
        if(!accepted)throw new Error('Лист «'+table.sheetName+'» не содержит задач МБ.');
        reportProgress({percent:15+Math.floor(70*(index+1)/tables.length),
          label:'Обработано листов МБ: '+(index+1)+'/'+tables.length});
      }
      if(!rowCount)throw new Error('Нет строк МБ для обработки.');
      // Record grouping is only for ITSM lookups: it preserves additive labor
      // and unique equipment identifiers, not source row or source task IDs.
      if(mode==='evidence'){
        const grouped=new Map();
        for(const record of records){
          const k=[key(record.request),key(record.equipmentPlacement),
            key(record.transport),key(record.equipmentUnit)].join('\u001f');
          if(grouped.has(k)){
            const previous=grouped.get(k);
            const a=Number(previous.laborHours)||0,b=Number(record.laborHours)||0;
            previous.laborHours=Math.round((a+b+Number.EPSILON)*1000000)/1000000;
          }else grouped.set(k,record);
        }
        const headerLayouts = tables.map(({sheetName,headerRowIndex,positions}) =>
          ({sheetName,headerRowIndex,positions}));
        return {mode,records:[...grouped.values()],latestSourceDate:latestDate,headerLayouts,
          stats:{rows:rowCount,sheets:tables.length,rowsWithoutRequest:unmatched}};
      }
      const bytes=folderWriteBuffer(workbook);
      return {mode,bytes,approvedRanges,approvedNewSheets:[],
        outputColumns:FOLDER_DERIVED_COLUMNS.slice(),
        stats:{rows:rowCount,sheets:tables.length,rowsWithoutRequest:unmatched},
        latestSourceDate:latestDate};
    }finally{
      workbook=null;
      records.length=0;
    }
  }

  globalThis.ReclassifierMobileBrigadeWorkerProcessor = Object.freeze({
    processFolder, folderHeader, buildOutputRecord, dateValue,
    folderColumns:FOLDER_DERIVED_COLUMNS,
    parseLaborHours: value => rules.parseLaborHours(value).hours,
    freshnessFromFileName,
    periodFromFileName,
    buildItsmCreatedAtIndex
  });
})();
