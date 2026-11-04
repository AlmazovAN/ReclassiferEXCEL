(() => {
  'use strict';

  const engineRegistry = globalThis.ReclassifierReclassificationEngineRegistry;
  if (!engineRegistry?.requireAvailable) throw new Error('Reclassification engine registry is not loaded in worker runtime.');
  if (!globalThis.XLSX) throw new Error('SheetJS is not loaded in worker runtime.');

  const OUTPUT_COLUMNS = [
    ['dateRegistered','Дата регистрации'],['dateCompleted','Дата выполнения обращения'],
    ['territory','Территории MES'],['number','Номер'],['equipment','Наименование оборудования'],
    ['element','Элемент'],['fault','Неисправность'],['incidentReason','Причина инцидента'],
    ['description','Категорированная информация обращения.Описание'],['closureNote','Примечания к закрытию (объединённые с доп)']
  ];

  // ITSM comparison report layout reviewed against the supplied Excel sample.
  // This projection is output-only: the normalized Full Dataset and the
  // independent 10-column ReClass file retain their complete field contracts.
  // Contract: A:AL (38) preserved, V4 starts at AM and ends at CN.
  const REPORT_COLUMN_SPECS = Object.freeze([
    "Дата создания Вызова",
    "Дата выполнения обращения",
    "Номер",
    "INC",
    "Наименование оборудования",
    "Элемент",
    "Неисправность",
    "Причина инцидента",
    "INC после рекласс",
    "Наим1",
    "Элем1",
    "Неис1",
    "Прич1",
    "Кач классификации (инженерная проверка)|Кач классификации",
    "Тип после нового алгоритма",
    "Новое оборудование",
    "Новый элемент",
    "Новая неисправность",
    "Новая причина",
    "Новое Качество классификации|Качество классификации",
    "Категорированная информация обращения.Описание",
    "Примечания к разрешению",
    "Доп.информация по причине",
    "Категорированная информация обращения.Изменил",
    "Территории MES",
    "Услуга СДГР (по наименованию)",
    "Место установки объекта обслуживания",
    "Код закрытия",
    "НаименованиеТехники",
    "Группа инициаторов",
    "ИсклВБР-ЦГПС",
    "ИсклВБР-Спутник",
    "Наличие заявки в МБ",
    "ТО/ Монтаж/ Разовое",
    "ГодОткр",
    "МесОткр",
    "ГодЗакр",
    "МесЗакр",
    ...globalThis.ReclassifierTechnicalDiagnosticsV4.columns
  ]);
  const REPORT_COLUMNS = Object.freeze(REPORT_COLUMN_SPECS.map(spec => {
    const separator = spec.indexOf('|');
    return Object.freeze(separator < 0
      ? {label:spec, source:spec}
      : {label:spec.slice(0,separator), source:spec.slice(separator+1)});
  }));
  const REPORT_GROUPS = Object.freeze([
    {column:3, label:'Первичная классификация в головном объекте ITSM'},
    {column:8, label:'Инженерная реклассификация специалистом ОПиН'},
    {column:14, label:'Реклассификация машинным алгоритмом Reclassifier 3.3'},
    {column:38, label:'Независимый технический разбор V4 (без применения)'}
  ]);

  // The legacy ITSM pipeline sometimes persists V as "V + W". Its own
  // serializer uses a stable suffix; split that suffix only for runtime input
  // carrying a separate W. File input retains its original V verbatim.
  function originalRuntimeClosure(raw, extraReason, isRuntime) {
    const original = String(raw ?? '');
    if (!isRuntime) return original;
    const extra = String(extraReason ?? '').replace(/\u00a0/g,' ').trim();
    if (!extra) return original;
    const suffix = 'Доп.информация по причине: ' + extra;
    const normalized = original.replace(/\u00a0/g,' ').trim();
    if (normalized === suffix) return '';
    if (normalized.endsWith(' ' + suffix))
      return normalized.slice(0, -(suffix.length + 1));
    return original;
  }

  async function buildCompactReport(workbook, workspace, lastSourceColumn, reportProgress=()=>{}) {
    const xlsx = globalThis.XLSX;
    const sourceSheet = workspace.sheet;
    const sourceHeaderRow = workspace.headerRowIndex;
    const sourceName = workspace.sheetName;
    const sourceLabels = Array.from({length:lastSourceColumn+1}, (_,column) =>
      sourceSheet[xlsx.utils.encode_cell({r:sourceHeaderRow,c:column})]?.v ?? '');
    const sourceIndices = new Map();
    sourceLabels.forEach((label,column) => {
      const normalized = headerKey(label);
      if (normalized)sourceIndices.set(normalized,column);
    });
    const columns = REPORT_COLUMNS.map(({source,label}) => {
      const aliases = source === 'Примечания к разрешению'
        ? ['Примечания к разрешению','Примечания к закрытию (объединённые с доп)',
          'Примечание к закрытию','Примечания к закрытию']
        : label === source ? [source] : [label,source];
      const index = aliases.map(label=>sourceIndices.get(headerKey(label)))
        .find(value=>Number.isInteger(value));
      if(index!==undefined)return index;
      // Not every valid ITSM source exports all supplementary description fields.
      if(['Категорированная информация обращения.Изменил',
          'Место установки объекта обслуживания', 'Доп.информация по причине', 'ГодЗакр', 'МесЗакр'].includes(source))return -1;
      throw new Error('Нет обязательной колонки для сравнительного отчёта: «'+source+'».');
    });
    const missingSourceColumns=REPORT_COLUMNS.slice(0,38).filter((_,i)=>columns[i]<0)
      .map(item=>item.label);
    const groups=Array(REPORT_COLUMNS.length).fill(null);
    REPORT_GROUPS.forEach(group=>{groups[group.column]=group.label;});
    const report=xlsx.utils.aoa_to_sheet([groups,REPORT_COLUMNS.map(item=>item.label)]);
    // Restrained widths prevent long diagnostic texts making the file unwieldy.
    report['!cols']=REPORT_COLUMNS.map((field,index)=>{
      const wide=[20,21,22].includes(index)||index>=38;
      const date=[0,1].includes(index);
      const width=wide?52:date?20:index<20?Math.min(33,Math.max(15,field.label.length+2)):
        Math.min(39,Math.max(16,field.label.length+3));
      return {wch:width};
    });
    const dateColumns=new Set([0,1]);
    const recordCount=Math.max(0,workspace.lastSourceRow-sourceHeaderRow);
    for(let inputRow=sourceHeaderRow+1;inputRow<=workspace.lastSourceRow;inputRow+=1){
      const outputRow=inputRow-sourceHeaderRow+1;
      for(let outputCol=0;outputCol<columns.length;outputCol+=1){
        const inputCol=columns[outputCol];
        if(inputCol<0)continue;
        // V must remain the text entered by the executor. The legacy ITSM
        // stage combines V and W for ReClass, but its combination is not
        // the user's agreed 38-column comparison export.
        if (outputCol===21 && Array.isArray(workspace.originalClosureNotes)) {
          const raw=workspace.originalClosureNotes[inputRow-sourceHeaderRow-1];
          const wIndex=sourceIndices.get(headerKey('Доп.информация по причине'));
          const wCell=Number.isInteger(wIndex)
            ? sourceSheet[xlsx.utils.encode_cell({r:inputRow,c:wIndex})] : null;
          const original=originalRuntimeClosure(raw,wCell?.v,workspace.isRuntimeSource);
          if(original!=='')
            report[xlsx.utils.encode_cell({r:outputRow,c:outputCol})]={t:'s',v:original};
          continue;
        }
        const sourceCell=sourceSheet[xlsx.utils.encode_cell({r:inputRow,c:inputCol})];
        if(!sourceCell||sourceCell.v===null||sourceCell.v===undefined)continue;
        // Cached data, not original cell formulas: original column positions
        // differ from those in the new comparison report.
        const outputCell={t:sourceCell.t,v:sourceCell.v};
        if(sourceCell.z)outputCell.z=sourceCell.z;
        if(dateColumns.has(outputCol)) {
          // ITSM exports frequently store timestamps as text. Parse only the
          // designated date columns; otherwise preserve their source value.
          if(sourceCell.t==='s' || sourceCell.t==='str'){
            const parsed=parsedDate(sourceCell.v);
            if(parsed){outputCell.t='d';outputCell.v=parsed;}
          }
          if(outputCell.t==='d'||outputCell.t==='n')
            outputCell.z=globalThis.ReclassifierReclassificationXlsxFormat.preferredDateFormat;
        }
        report[xlsx.utils.encode_cell({r:outputRow,c:outputCol})]=outputCell;
      }
      if (outputRow % 250 === 0 || inputRow === workspace.lastSourceRow) {
        reportProgress({percent:89+Math.round((inputRow-sourceHeaderRow)/Math.max(1,recordCount)*5),
          label:'Сборка отчёта ITSM: '+(inputRow-sourceHeaderRow)+' / '+recordCount});
        if (typeof setTimeout === 'function') await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    report['!ref']=xlsx.utils.encode_range({
      s:{r:0,c:0},e:{r:1+recordCount,c:REPORT_COLUMNS.length-1}
    });
    report['!autofilter']={ref:xlsx.utils.encode_range({
      s:{r:1,c:0},e:{r:1+recordCount,c:REPORT_COLUMNS.length-1}
    })};
    if(sourceName!=='ITSM'&&workbook.SheetNames.includes('ITSM'))
      throw new Error('В исходном файле уже имеется другой лист «ITSM».');
    const sourcePosition=workbook.SheetNames.indexOf(sourceName);
    if(sourcePosition<0)throw new Error('Исходный лист не найден при формировании отчёта.');
    workbook.SheetNames[sourcePosition]='ITSM';
    if(sourceName!=='ITSM')delete workbook.Sheets[sourceName];
    workbook.Sheets.ITSM=report;
    return {columns:REPORT_COLUMNS.length,rows:recordCount,missingSourceColumns};
  }

  const HEADER_SEARCH_LIMIT = 100;
  const STATUS_LABELS = Object.freeze({
    CANCELLED:'Отменено',PENDING:'Недостаточно данных о завершении',RITM_OK:'Обычный RITM',
    REVIEW:'Нужна проверка',KEEP:'Штатная ветка сохранена',CHANGE:'Предложено исправление',
    BASELINE:'Штатная ветка сохранена; факт отказа не подтверждён'
  });
  const DIAGNOSTIC_COLUMNS = [
    'Новый алгоритм: версия','Дата для разбора','Источник даты','этап отсечения',
    'Решение алгоритма','Факт отказа','Основание решения','Качество классификации',
    'Изменение относительно штатной ITSM','Тип после нового алгоритма',
    'Новое оборудование','Новый элемент','Новая неисправность','Новая причина',
    'Кандидат оборудования','Кандидат элемента','Кандидат неисправности','Кандидат причины',
    'Проверено уровней','Уровней с основанием по тексту','Уровней сохранено из штатной ITSM',
    'Включено в Reclassification','Штатная ветка допустима','Итоговая ветка допустима',
    'Основание факта отказа','Основание оборудования','Как выбрано оборудование',
    'Основание элемента','Как выбран элемент','Основание неисправности','Как выбрана неисправность',
    'Основание причины','Как выбрана причина','Первый изменённый уровень относительно штатной ITSM',
    'Veto сработал','Первый расходящийся уровень с разметкой исходного файла',
    'Наим1 (до штатной обработки)','Элем1 (до штатной обработки)',
    'Неис1 (до штатной обработки)','Прич1 (до штатной обработки)',
    'Вердикт проверки','Комментарий проверки','Объединённый комментарий из МБ',
    'Разбор частичный','Неразрешённые уровни','Предупреждения по тексту','Изменилось оборудование','Опора алгоритма'
  ];
  const REQUIRED_FIELDS = Object.freeze([
    'createdAt','completedAt','territory','number','sourceEquipment',
    'sourceElement','sourceFault','sourceReason','description','closureNote'
  ]);
  const HEADER_LABELS = Object.freeze({
    createdAt: 'Дата создания Вызова',
    completedAt: 'Дата выполнения обращения / Дата закрытия',
    territory: 'Территории MES',
    number: 'Номер',
    sourceEquipment: 'Наименование оборудования',
    sourceElement: 'Элемент',
    sourceFault: 'Неисправность',
    sourceReason: 'Причина инцидента',
    description: 'Категорированная информация обращения.Описание',
    closureNote: 'Примечания к разрешению / Примечание к закрытию'
  });

  function key(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  }

  function text(value) {
    const normalized = String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  function outputFileName(fileName) {
    const base = String(fileName || 'ITSM').replace(/\.(xlsx|xlsm|xls)$/i, '');
    return base + '_ITSM_Диагностика.xlsx';
  }

  function mobileBrigadeCommentsByRequest(records) {
    const groups = new Map();
    for (const record of records || []) {
      const request = key(record?.request);
      const comment = String(record?.combinedComment ?? '');
      if (!request || !comment.trim()) continue;
      if (!groups.has(request)) groups.set(request, []);
      groups.get(request).push(comment);
    }
    return new Map(Array.from(groups, ([request, comments]) => [request, comments.join('\n\n')]));
  }

  function parsedDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0 || value >= 2958466) return null;
      return new Date(Date.UTC(1899,11,30) + value * 86400000);
    }
    const raw = String(value ?? '').trim();
    const local = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (local) {
      const date = new Date(Date.UTC(+local[3],+local[2]-1,+local[1],+(local[4]||0),+(local[5]||0),+(local[6]||0)));
      return date.getUTCFullYear() === +local[3] && date.getUTCMonth()+1 === +local[2] && date.getUTCDate() === +local[1] ? date : null;
    }
    if (!/^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(raw)) return null;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateCell(value) {
    return parsedDate(value) ?? (value || null);
  }

  function referenceDate(value) {
    return parsedDate(value)?.toISOString().slice(0,10) ?? text(value);
  }

  function headerKey(value) {
    return key(value)
      .replace(/[‐‑–—]/g, '-')
      .replace(/\s*\.\s*/g, '.')
      .replace(/\s*\(\s*/g, '(')
      .replace(/\s*\)\s*/g, ')');
  }

  function headerPositions(header) {
    const normalized = header.map(headerKey);
    const exact = title => normalized.indexOf(headerKey(title));
    const firstExact = titles => {
      for (const title of titles) {
        const index = exact(title);
        if (index >= 0) return index;
      }
      return -1;
    };
    const exactOrSuffix = titles => {
      for (const title of titles) {
        const expected = headerKey(title);
        const index = normalized.findIndex(value =>
          value === expected || value.startsWith(expected + ' ') || value.startsWith(expected + '(')
        );
        if (index >= 0) return index;
      }
      return -1;
    };

    return {
      createdAt: exactOrSuffix(['Дата создания Вызова']),
      completedAt: exactOrSuffix(['Дата выполнения обращения']),
      closedAt: exactOrSuffix(['Дата закрытия']),
      closingCode: exact('Код закрытия'),
      state: exact('Состояние'),
      shortDescription: exact('Категорированная информация обращения.Краткое описание'),
      extraReason: exact('Доп.информация по причине'),
      expertEquipment: exact('Наим1'), expertElement: exact('Элем1'),
      expertFault: exact('Неис1'), expertReason: exact('Прич1'),
      territory: firstExact(['Территории MES', 'Территория MES']),
      number: exact('Номер'),
      sourceEquipment: exact('Наименование оборудования'),
      sourceElement: exact('Элемент'),
      sourceFault: exact('Неисправность'),
      sourceReason: exact('Причина инцидента'),
      description: exact('Категорированная информация обращения.Описание'),
      closureNote: firstExact(['Примечания к разрешению', 'Примечания к закрытию (объединённые с доп)', 'Примечание к закрытию', 'Примечания к закрытию'])
    };
  }

  function findInputTable(workbook) {
    const preferred = workbook.SheetNames.includes('Обращение')
      ? ['Обращение', ...workbook.SheetNames.filter(name => name !== 'Обращение')]
      : workbook.SheetNames;
    let bestCandidate = null;

    for (const sheetName of preferred) {
      const sheet = workbook.Sheets[sheetName];
      const rows = globalThis.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
      const limit = Math.min(rows.length, HEADER_SEARCH_LIMIT);
      for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
        const positions = headerPositions(rows[rowIndex] || []);
        const missing = REQUIRED_FIELDS.filter(field => positions[field] < 0 &&
          !(field === 'completedAt' && positions.closedAt >= 0));
        if (!missing.length) {
          return {
            table: { sheetName, rows, headerRowIndex: rowIndex, positions },
            bestCandidate: null
          };
        }
        const score = REQUIRED_FIELDS.length - missing.length;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { sheetName, rowIndex, score, missing };
        }
      }
    }

    return { table: null, bestCandidate };
  }

  function parseItsmWorkbook(inputBuffer) {
    if (!(inputBuffer instanceof ArrayBuffer)) {
      throw new Error('Reclassification Worker не получил выбранный ITSM Excel.');
    }

    const workbook = globalThis.XLSX.read(new Uint8Array(inputBuffer), {
      type: 'array',
      cellDates: true,
      cellFormula: true
    });
    const discovery = findInputTable(workbook);
    if (!discovery.table) {
      const best = discovery.bestCandidate;
      if (best && best.score >= 4) {
        const missing = best.missing.map(field => '«' + HEADER_LABELS[field] + '»').join(', ');
        throw new Error(
          'Не удалось распознать полную строку заголовков ITSM для Reclassification. Лучший вариант: лист «' +
          best.sheetName + '», строка ' + (best.rowIndex + 1) + '. Не найдены обязательные колонки: ' + missing + '.'
        );
      }
      throw new Error(
        'Не найдена строка заголовков ITSM для Reclassification в первых ' + HEADER_SEARCH_LIMIT +
        ' строках листов. Проверьте, что выгрузка содержит обязательные поля.'
      );
    }

    const table = discovery.table;
    const pos = table.positions;

    const records = [];
    for (let rowIndex = table.headerRowIndex + 1; rowIndex < table.rows.length; rowIndex += 1) {
      const row = table.rows[rowIndex] || [];
      const number = text(row[pos.number]);
      const hasSourceData = REQUIRED_FIELDS.some(field => {
        const index = pos[field];
        return index >= 0 && row[index] !== null && row[index] !== undefined && String(row[index]).trim() !== '';
      });
      if (!hasSourceData) continue;
      if (!number) continue;

      records.push({
        createdAt: row[pos.createdAt] ?? null,
        completedAt: row[pos.completedAt] ?? null,
        closedAt: row[pos.closedAt] ?? null,
        closingCode: text(row[pos.closingCode]), state: text(row[pos.state]),
        shortDescription: text(row[pos.shortDescription]), extraReason: text(row[pos.extraReason]),
        expertPath: ['expertEquipment','expertElement','expertFault','expertReason'].map(field => text(row[pos[field]])),
        territory: text(row[pos.territory]),
        number,
        sourceEquipment: text(row[pos.sourceEquipment]),
        sourceElement: text(row[pos.sourceElement]),
        sourceFault: text(row[pos.sourceFault]),
        sourceReason: text(row[pos.sourceReason]),
        description: String(row[pos.description] ?? '').trim() || null,
        closureNote: globalThis.ReclassifierItsmWorkerProcessor.combineClosureNotes(
          row[pos.closureNote], pos.extraReason >= 0 ? row[pos.extraReason] : null
        )
      });
    }

    if (!records.length) throw new Error('Выбранная ITSM-выгрузка не содержит строк с номером обращения.');
    return { records, sheetName: table.sheetName };
  }

  function runtimeInputWorkbook(source,reportProgress) {
    if(source?.package!=='itsm-full-dataset' || source.aggregation!=='per-source-row' ||
      !Array.isArray(source.columns)||!Array.isArray(source.rows)||!source.rows.length)
      throw new Error('Re-Class: передан некорректный Active Runtime Full Dataset.');
    const headers=source.columns,rows=source.rows;
    // The comparison sheet has two header rows (the Excel limit is 1,048,576).
    if(rows.length>1048574)throw new Error('Объём ITSM превышает 1 048 574 строки данных на одном листе Excel.');
    const xlsx=globalThis.XLSX,workbook=xlsx.utils.book_new();
    const sheet=xlsx.utils.aoa_to_sheet([headers],{cellDates:true});
    const step=1000;
    for(let i=0;i<rows.length;i+=step){
      const chunk=rows.slice(i,i+step);
      for(let j=0;j<chunk.length;j++)
        if(!Array.isArray(chunk[j])||chunk[j].length!==headers.length)
          throw new Error('Некорректная строка Full Dataset ITSM: '+(i+j+1)+'.');
      xlsx.utils.sheet_add_aoa(sheet,chunk,{origin:{r:i+1,c:0},cellDates:true});
      if(i===0||i+step>=rows.length)
        reportProgress({percent:Math.round(Math.min(i+step,rows.length)/rows.length*4),label:'ITSM: подготовка Active Runtime'});
    }
    xlsx.utils.book_append_sheet(workbook,sheet,'Обращение');
    return workbook;
  }

  async function process(payload,onProgress=()=>{}) {
    // Fail fast before ITSM calculation, XLSX allocation or Re-Class preparation.
    const rules=engineRegistry.requireAvailable(payload?.engineId);
    // Runtime input preparation and the standard ITSM worker have independent
    // scales. A single monotonic reporter prevents backwards UI progress
    // when switching between the two stages.
    let lastPercent=0;
    const reportProgress=progress=>{
      const proposed=Number(progress?.percent);
      const percent=Number.isFinite(proposed)
        ? Math.max(lastPercent,Math.min(100,proposed)) : lastPercent;
      lastPercent=percent;
      onProgress({...progress,percent});
    };
    if (!Array.isArray(payload?.classifierRecords) || !payload.classifierRecords.length) {
      throw new Error('Для каскада реклассификации нужен действующий классификатор отказов из раздела «Данные».');
    }
    const elementCounts={};
    const failureCounts={};
    const causeCounts={};
    const pathReviewCounts={};
    const reviewPolicyCounts={};
    const objectContext=globalThis.ReclassifierObjectAssessmentV4.fromPreparedRecords(
      payload.classifierRecords,payload.classifierMeta||{}, {aliases:payload.classifierAliases||[]});
    const context=rules.buildContext(payload.classifierRecords);
    if (!context.paths.size) throw new Error('Классификатор не содержит полных действующих веток.');
    const standardProcessor=globalThis.ReclassifierItsmWorkerProcessor;
    if (!standardProcessor) throw new Error('Штатный обработчик ITSM недоступен.');
    if (!payload.references || typeof payload.references !== 'object') {
      throw new Error('Для штатной обработки ITSM нужен снимок действующих справочников, включая ReClass.');
    }
    const baselineMode=payload.baselineMode??'standard';
    if(!['standard','source'].includes(baselineMode))throw new Error('Неизвестный режим опорной классификации.');
    const runtimeWorkbook=payload?.runtimeSource
      ? runtimeInputWorkbook(payload.runtimeSource,reportProgress) : null;
    const standard=await standardProcessor.process({
      bytes:payload.bytes,runtimeWorkbook,fileName:payload.fileName,references:payload.references,
      asOfDate:payload.asOfDate,datasetOnly:false,deferExport:true,
      omitFullDatasetRows:true,captureOriginalClosureNotes:true
    },p=>reportProgress({percent:Math.round(p.percent*0.45),label:'ITSM: '+p.label}));
    const workspace=standard.workspace,workbook=workspace.workbook;
    workspace.sheetName=standard.sheetName;
    workspace.isRuntimeSource=Boolean(payload.runtimeSource);
    const inputHeader=workspace.rawRows[workspace.headerRowIndex] || [],pos=headerPositions(inputHeader);
    const standardFields=standard.itsmData.fields;
    const classificationIndices=['reclassifiedEquipment','reclassifiedElement','reclassifiedFault','reclassifiedReason']
      .map(field=>standardFields.indexOf(field));
    if (classificationIndices.some(i=>i<0)) throw new Error('Штатная ITSM не вернула классификационные поля.');
    const baselineColumns=standard.itsmFullDataset.columns;
    let diagnosticStart=baselineColumns.indexOf(DIAGNOSTIC_COLUMNS[0]);
    if (diagnosticStart<0) diagnosticStart=baselineColumns.length;
    else {
      const currentBlock=DIAGNOSTIC_COLUMNS.every((label,i)=>baselineColumns[diagnosticStart+i]===label);
      const previousBlock=[42,43].some(length=>baselineColumns.length===diagnosticStart+length &&
        DIAGNOSTIC_COLUMNS.slice(0,length).every((label,i)=>baselineColumns[diagnosticStart+i]===label));
      if (!currentBlock && !previousBlock) {
        throw new Error('В исходном файле есть диагностический блок другой структуры. Используйте исходную выгрузку ITSM.');
      }
    }
    const mobileBrigadeComments=mobileBrigadeCommentsByRequest(payload.references.mobile_brigade_data);
    const referenceRecords=[];
    const statusCounts={},stageCounts={},qualityCounts={},classificationSources={},technicalCounts={},objectCounts={};
    const expertComparison={
      noMarking:0,partialMarking:0,invalidMarking:0,
      validMarking:0,readyCompared:0,readyMatched:0,readyDifferent:0
    };
    let usedClosingDate=0,withoutDescription=0,withoutClosureNote=0,comparedRows=0,matchedRows=0;
    // Write fixed-size batches straight to XLSX; do not hold all diagnostic
    // rows plus the worksheet cells simultaneously for a large Active Runtime.
    const xlsx=globalThis.XLSX;
    const diagnosticChunkSize=400;
    let diagnosticBuffer=[],diagnosticsWritten=0,peakDiagnosticBuffer=0;
    xlsx.utils.sheet_add_aoa(workspace.sheet,[[...DIAGNOSTIC_COLUMNS,...globalThis.ReclassifierTechnicalDiagnosticsV4.columns]],{
      origin:{r:workspace.headerRowIndex,c:diagnosticStart}
    });
    const referenceSheet=xlsx.utils.aoa_to_sheet([OUTPUT_COLUMNS.map(([,label])=>label)]);
    let referenceBuffer=[],referencesWritten=0,peakReferenceBuffer=0;
    function flushDiagnostics(){
      if(!diagnosticBuffer.length)return;
      xlsx.utils.sheet_add_aoa(workspace.sheet,diagnosticBuffer,{
        origin:{r:workspace.headerRowIndex+1+diagnosticsWritten,c:diagnosticStart},cellDates:true
      });
      diagnosticsWritten+=diagnosticBuffer.length;
      diagnosticBuffer=[];
    }
    function flushReferences(){
      if(!referenceBuffer.length)return;
      xlsx.utils.sheet_add_aoa(referenceSheet,referenceBuffer,{
        origin:{r:referencesWritten+1,c:0},cellDates:true
      });
      referencesWritten+=referenceBuffer.length;
      referenceBuffer=[];
    }
    let reviewedLevels=0,textConfirmedLevels=0,sourcePreservedLevels=0;
    let partialRows=0,objectMismatchRows=0,causeContextRows=0;
    const norm=value=>String(value??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
      .replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\s+/g,' ').trim();
    const same=(a,b)=>JSON.stringify(a.map(norm))===JSON.stringify(b.map(norm));
    function comparison(result,raw) {
      const marked=raw.expertPath.filter(Boolean).length;
      if(marked===0)expertComparison.noMarking++;
      else if(marked<4)expertComparison.partialMarking++;
      else if(!context.paths.has(JSON.stringify(raw.expertPath.map(norm))))expertComparison.invalidMarking++;
      else expertComparison.validMarking++;
      const target=marked===4
        ? context.paths.get(JSON.stringify(raw.expertPath.map(norm))) : null;
      if (!target) return 'Нет допустимой разметки в исходном файле';
      if(result.readyForApply){
        expertComparison.readyCompared++;
        const matched=target.every((value,index)=>norm(value)===norm(
          [result.equipment,result.element,result.fault,result.incidentReason][index]));
        if(matched)expertComparison.readyMatched++;
        else expertComparison.readyDifferent++;
      }
      const selected=result.candidate;
      const i=selected.findIndex((value,level)=>value && norm(value)!==norm(target[level]));
      if (i>=0) return ['Оборудование','Элемент','Неисправность','Причина'][i];
      return selected.length===4 && selected.every(Boolean) ? 'Полное совпадение' : selected.some(Boolean) ? 'Выбранные уровни совпадают; ветка не завершена' : 'Уровни ещё не выбраны';
    }
    for (let i=0;i<standard.itsmData.records.length;i+=1) {
      const sourceRow=workspace.rawRows[workspace.headerRowIndex+1+i] || [];
      const original={
        createdAt:sourceRow[pos.createdAt]??null,completedAt:sourceRow[pos.completedAt]??null,
        closedAt:sourceRow[pos.closedAt]??null,territory:text(sourceRow[pos.territory]),number:text(sourceRow[pos.number]),
        state:text(sourceRow[pos.state]),closingCode:text(sourceRow[pos.closingCode]),
        shortDescription:text(sourceRow[pos.shortDescription]),extraReason:text(sourceRow[pos.extraReason]),
        sourceEquipment:text(sourceRow[pos.sourceEquipment]),sourceElement:text(sourceRow[pos.sourceElement]),
        sourceFault:text(sourceRow[pos.sourceFault]),sourceReason:text(sourceRow[pos.sourceReason]),
        description:String(sourceRow[pos.description]??'').trim()||null,
        closureNote:standardProcessor.combineClosureNotes(
          sourceRow[pos.closureNote], pos.extraReason >= 0 ? sourceRow[pos.extraReason] : null
        ),
        expertPath:['expertEquipment','expertElement','expertFault','expertReason'].map(field=>text(sourceRow[pos[field]]))
      };
      const standardBaseline=classificationIndices.map(index=>text(standard.itsmData.records[i][index]));
      const baseline=baselineMode==='source'?['sourceEquipment','sourceElement','sourceFault','sourceReason'].map(field=>original[field]):standardBaseline;
      const row={...original,sourceEquipment:baseline[0],sourceElement:baseline[1],sourceFault:baseline[2],sourceReason:baseline[3],
        classificationSourceLabel:baselineMode==='source'?'исходные поля ITSM без опоры на ReClass':'штатная классификация ITSM (ReClass или исходные поля)'};
      const result=rules.evaluateRow({row,context});
      const adaptedStatus=rules.adaptStatus(result.status);
      const finalPath=[result.equipment,result.element,result.fault,result.incidentReason];
      const quality=rules.classificationQuality({row:original,result,finalPath});
      const changed=!same(standardBaseline,finalPath);
      const type=norm(row.number).startsWith('ritm') ? 'RITM' : norm(row.number).startsWith('inc') ? 'INC' : '';
      const afterType=['CANCELLED','PENDING'].includes(result.status) ? '' :
        type==='RITM' && result.failureState==='FAILURE' ? 'INC' : type;
      statusCounts[adaptedStatus]=(statusCounts[adaptedStatus]||0)+1;
      stageCounts[result.stageText]=(stageCounts[result.stageText]||0)+1;
      qualityCounts[quality]=(qualityCounts[quality]||0)+1;
      classificationSources[result._classificationSource]=(classificationSources[result._classificationSource]||0)+1;
      if(result.dateSource==='Дата закрытия')usedClosingDate+=1;
      if(!result.description)withoutDescription+=1;
      if(!result.closureNote)withoutClosureNote+=1;
      reviewedLevels+=result.reviewedLevels;textConfirmedLevels+=result.textConfirmedLevels;sourcePreservedLevels+=result.sourcePreservedLevels;
      if(result.partial)partialRows+=1;
      if(result.evidenceWarnings.some(w=>w.startsWith('Объект работ')))objectMismatchRows+=1;
      if(result.evidenceWarnings.some(w=>w.startsWith('Упоминание взрывных')))causeContextRows+=1;
      const level=index=>result.levelDecisions.find(d=>d.level===index);
      const compare=comparison(result,original);
      if(result.readyForApply && compare!=='Нет допустимой разметки в исходном файле') {
        comparedRows+=1;if(compare==='Полное совпадение')matchedRows+=1;
      }
      const diag=[rules.version,dateCell(result.analysisDate),result.dateSource,result.stageText,STATUS_LABELS[adaptedStatus],
        result.failureState,result.reason,quality,changed?'Да':'Нет',afterType,...finalPath,
        ...Array.from({length:4},(_,index)=>result.candidate[index]??null),
        result.reviewedLevels,result.textConfirmedLevels,result.sourcePreservedLevels,
        result.readyForApply?'Да':'Нет',result.originalValid?'Да':'Нет',result.selectedValid?'Да':'Нет',result.gateEvidence,
        ...[0,1,2,3].flatMap(index=>[level(index)?.evidence??null,level(index)?.mode==='TEXT'?'По тексту':level(index)?'Сохранено из штатной ITSM':null]),
        result.firstChanged,result.veto?'Да':'Нет',compare,...original.expertPath,null,null,
        mobileBrigadeComments.get(key(original.number))??null,
        result.partial?'Да':'Нет',result.unresolvedLevels.join('; '),result.evidenceWarnings.join('\n')||null,
        norm(original.sourceEquipment)!==norm(finalPath[0])?'Да':'Нет',row.classificationSourceLabel];
      if(diag.length!==DIAGNOSTIC_COLUMNS.length)throw new Error('Нарушена ширина диагностического блока.');
      // Analyze original text only, before any legacy/source classification.
      // Full Dataset may already contain the combined extraReason suffix.
      let technicalClosure=originalRuntimeClosure(
        workspace.originalClosureNotes?.[i] ?? sourceRow[pos.closureNote],
        original.extraReason,workspace.isRuntimeSource
      );
      const extra=original.extraReason;
      if(extra && !Array.isArray(workspace.originalClosureNotes) && !workspace.isRuntimeSource){
        const suffix='Доп.информация по причине: '+extra;
        if(technicalClosure.endsWith(suffix))technicalClosure=technicalClosure.slice(0,-suffix.length).trimEnd();
      }
      const assessment=globalThis.ReclassifierEventAssessmentV4.analyze({
        number:original.number,shortDescription:original.shortDescription,
        description:original.description,closureNote:technicalClosure,extraReason:extra
      });
      const objects=globalThis.ReclassifierObjectAssessmentV4.analyze(assessment,objectContext);
      objectCounts[objects.status]=(objectCounts[objects.status]||0)+1;
      const element=globalThis.ReclassifierElementAssessmentV4.analyze(objects,objectContext);
      elementCounts[element.status]=(elementCounts[element.status]||0)+1;
      const failure=globalThis.ReclassifierFailureAssessmentV4.analyze(element,objects,objectContext);
      failureCounts[failure.status]=(failureCounts[failure.status]||0)+1;
      const cause=globalThis.ReclassifierCauseAssessmentV4.analyze(failure,assessment,objectContext);
      causeCounts[cause.status]=(causeCounts[cause.status]||0)+1;
      const pathReview=globalThis.ReclassifierPathReviewV4.analyze(assessment,objects,element,failure,cause,objectContext);
      pathReviewCounts[pathReview.status]=(pathReviewCounts[pathReview.status]||0)+1;
      const policy=globalThis.ReclassifierReviewPolicyV4.assess(assessment,objects,element,failure,cause,pathReview);
      reviewPolicyCounts[policy.status]=(reviewPolicyCounts[policy.status]||0)+1;
      const technicalCells=globalThis.ReclassifierTechnicalDiagnosticsV4.cells(assessment,{
        version:rules.version,decision:STATUS_LABELS[adaptedStatus],included:result.readyForApply,
        sourceLabel:row.classificationSourceLabel,mbComment:mobileBrigadeComments.get(key(original.number))??null
      },objects,element,failure,cause,pathReview,policy);
      technicalCounts[assessment.failureState]=(technicalCounts[assessment.failureState]||0)+1;
      diagnosticBuffer.push([...diag,...technicalCells]);
      peakDiagnosticBuffer=Math.max(peakDiagnosticBuffer,diagnosticBuffer.length);
      if(diagnosticBuffer.length>=diagnosticChunkSize)flushDiagnostics();
      if(result.readyForApply) {
        referenceBuffer.push(OUTPUT_COLUMNS.map(([field])=>
          ['dateRegistered','dateCompleted'].includes(field)?dateCell(result[field]):result[field]??null));
        peakReferenceBuffer=Math.max(peakReferenceBuffer,referenceBuffer.length);
        if(referenceBuffer.length>=diagnosticChunkSize)flushReferences();
        referenceRecords.push(Object.fromEntries(OUTPUT_COLUMNS.map(([field])=>[field,
          ['dateRegistered','dateCompleted'].includes(field)?referenceDate(result[field]):result[field]??null])));
      }
      if(i===0 || (i+1)%500===0 || i+1===standard.itsmData.records.length) {
        reportProgress({percent:45+Math.round((i+1)/standard.itsmData.records.length*38),label:'Диагностика нового алгоритма'});
      }
    }
    flushDiagnostics();
    flushReferences();
    if(diagnosticsWritten!==standard.itsmData.records.length ||
       referencesWritten!==referenceRecords.length)
      throw new Error('Не все обращения записаны в диагностический XLSX.');
    const lastColumn=diagnosticStart+DIAGNOSTIC_COLUMNS.length+globalThis.ReclassifierTechnicalDiagnosticsV4.columns.length-1;
    workspace.sheet['!autofilter']={ref:globalThis.XLSX.utils.encode_range({
      s:{r:workspace.headerRowIndex,c:0},e:{r:workspace.lastSourceRow,c:lastColumn}
    })};
    workspace.sheet['!cols']=workspace.sheet['!cols'] || [];
    DIAGNOSTIC_COLUMNS.forEach((label,i)=>{
      workspace.sheet['!cols'][diagnosticStart+i]={wch:label.startsWith('Основание') || label==='Объединённый комментарий из МБ'?65:34};
    });
    function appendDerived(sheet,name) {
      let chosen=name,n=2;
      while(workbook.SheetNames.includes(chosen))chosen=name+' '+n++;
      globalThis.XLSX.utils.book_append_sheet(workbook,sheet,chosen);
      return chosen;
    }
    referenceSheet['!autofilter']={ref:'A1:J'+(referencesWritten+1)};
    referenceSheet['!cols']=OUTPUT_COLUMNS.map((_,i)=>({wch:i<2?20:i<4?22:i<8?36:65}));
    const reclassSheet=appendDerived(referenceSheet,'Reclassification');
    const summary=[
      ['Диагностика V4','Колонки AM:CN: независимый технический разбор V4; применение отключено. O:T и файл Reclassification: алгоритм 3.3.'],
      ['Диагностика V4: версия',globalThis.ReclassifierEventAssessmentV4.version],
      ...Object.entries(technicalCounts).map(([status,count])=>['V4: '+status,count]),
      ['Версия выбора объекта V4',globalThis.ReclassifierObjectAssessmentV4.version],
      ...Object.entries(objectCounts).map(([status,count])=>['V4 объект: '+status,count]),
      ['Версия элемента V4',globalThis.ReclassifierElementAssessmentV4.version],
      ...Object.entries(elementCounts).map(([status,count])=>['V4 элемент: '+status,count]),
      ['Версия неисправности V4',globalThis.ReclassifierFailureAssessmentV4.version],
      ...Object.entries(failureCounts).map(([status,count])=>['V4 неисправность: '+status,count]),
      ['Версия причины V4',globalThis.ReclassifierCauseAssessmentV4.version],
      ...Object.entries(causeCounts).map(([status,count])=>['V4 причина: '+status,count]),
      ['Версия проверки полного пути V4',globalThis.ReclassifierPathReviewV4.version],
      ...Object.entries(pathReviewCounts).map(([status,count])=>['V4 путь: '+status,count]),
      ['Версия инженерной маршрутизации V4',globalThis.ReclassifierReviewPolicyV4.version],
      ...Object.entries(reviewPolicyCounts).map(([status,count])=>['V4 проверка: '+status,count]),
      ['Конвейер','Штатная ITSM → диагностика нового алгоритма'],['Версия нового алгоритма',rules.version],
      ['Версия штатной ITSM',standard.rulesVersion],['Исходных строк',standard.stats.rows],
      ['Готовых решений для ReClass',referenceRecords.length],['Использована дата закрытия',usedClosingDate],
      ['Полных штатных веток без подтверждения отказа',statusCounts.BASELINE||0],
      ['Проверено уровней',reviewedLevels],['Уровней с текстовым основанием',textConfirmedLevels],
      ['Уровней сохранено из штатной ITSM',sourcePreservedLevels],
      ['Качество классификации','Штатная формула ITSM: сравниваются элемент, неисправность и причина, с теми же условиями завершения. Оборудование отмечено отдельно. Это не оценка точности.'],
      ['Опора алгоритма',baselineMode==='source'?'Исходные поля ITSM без опоры на ReClass':'Штатная ITSM после ReClass'],
      ['Частично разобранных строк',partialRows],['Строк с другим объектом работ',objectMismatchRows],['Строк с историческим контекстом причины',causeContextRows],
      ['Комментарии МБ','Только в экспорте; в распознавании не участвуют.'],
      ['Сопоставление с инженером','Результаты после ReClass используют штатную ветку как опору; совпадения не являются независимой оценкой распознавания.'],
      ['Сравнение со штатной ITSM','Отдельная колонка показывает, что изменил новый алгоритм после ReClass.'],
      ['Сохранённая штатная ветка','Допустимая полная ветка сохраняется при недостатке подтверждения отказа. Это не новое распознавание по тексту; в ReClass не применяется.'],
      ['Технический разбор V4','Симптомы, диагностика, действия, результаты и ограничения приведены после AL (начиная с AM). Доказательства содержат исходное поле и положение фрагмента.'],
      ['Без автоматической замены','Исходные поля и 34 штатных расчётных поля не изменяются новым алгоритмом. Предложения расположены справа.'],
      ['Сопоставимых готовых решений с исходной разметкой',comparedRows],['Совпадений с исходной разметкой',matchedRows],
      ['',''],['Проверка инженерной классификации','Количество'],
      ['Без инженерной разметки',expertComparison.noMarking],
      ['Неполная инженерная разметка',expertComparison.partialMarking],
      ['Полная разметка вне действующего классификатора',expertComparison.invalidMarking],
      ['Полная допустимая инженерная разметка',expertComparison.validMarking],
      ['Готовых машинных решений с допустимой инженерной разметкой',expertComparison.readyCompared],
      ['Совпадение готовой машинной и инженерной классификации',expertComparison.readyMatched],
      ['Расхождение готовой машинной и инженерной классификации',expertComparison.readyDifferent],
      ['',''],['Категории качества','Количество'],...Object.entries(qualityCounts),
      ['',''],['Решения алгоритма','Количество'],...Object.entries(statusCounts).map(([k,v])=>[STATUS_LABELS[k],v]),
      ['',''],['Этапы отсечения','Количество'],...Object.entries(stageCounts),
      ['',''],['Штатная ITSM','Количество'],...Object.entries(standard.stats)
    ];
    const summarySheet=globalThis.XLSX.utils.aoa_to_sheet(summary);
    summarySheet['!cols']=[{wch:62},{wch:110}];appendDerived(summarySheet,'Сводка алгоритма');
    reportProgress({percent:87,label:'Формирование общего Excel'});
    const compactReport=await buildCompactReport(workbook,workspace,lastColumn,reportProgress);
    if (compactReport.missingSourceColumns.includes('Доп.информация по причине')) {
      xlsx.utils.sheet_add_aoa(summarySheet,[[
        'Исходная колонка W недоступна',
        'Источник не содержит отдельной «Доп.информация по причине». '
          +'W оставлена пустой, исходный текст W невозможно восстановить из объединённого примечания.'
      ]],{origin:-1});
    }
    const formatter=globalThis.ReclassifierReclassificationXlsxFormat;
    if(!formatter?.format)throw new Error('Модуль оформления Excel-отчёта Re-Class не подключён.');
    // Long free-text evidence is usually unique. Shared String Table duplicates
    // it transiently and increases peak memory without improving compression.
    reportProgress({percent:95,label:'Сжатие большого XLSX'});
    const written=globalThis.XLSX.write(workbook,{bookType:'xlsx',type:'array',compression:true,bookSST:false,cellDates:true});
    const rawBytes=written instanceof ArrayBuffer?written:written.buffer.slice(written.byteOffset,written.byteOffset+written.byteLength);
    reportProgress({percent:97,label:'Оформление листа ITSM'});
    const bytes=formatter.format(rawBytes,workbook.SheetNames.indexOf('ITSM'),compactReport.rows);
    const referenceBook=globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(referenceBook,referenceSheet,'Reclassification');
    reportProgress({percent:99,label:'Сжатие отдельного файла Reclassification'});
    const referenceWritten=globalThis.XLSX.write(referenceBook,{bookType:'xlsx',type:'array',compression:true,bookSST:false,cellDates:true});
    const reclassBytes=referenceWritten instanceof ArrayBuffer?referenceWritten:referenceWritten.buffer.slice(referenceWritten.byteOffset,referenceWritten.byteOffset+referenceWritten.byteLength);
    reportProgress({percent:100,label:'Готово'});
    if(compactReport.columns!==38+globalThis.ReclassifierTechnicalDiagnosticsV4.columns.length)
      throw new Error('Нарушен контракт итогового Excel A:CN.');
    return {bytes,outputName:outputFileName(payload.fileName),sourceSheet:standard.sheetName,reclassSheet,referenceRecords,reclassBytes,
      reclassOutputName:String(payload.fileName||'ITSM').replace(/\.(xlsx|xlsm|xls)$/i,'')+'_Reclassification.xlsx',
      stats:{rows:standard.stats.rows,readyRows:referenceRecords.length,columns:compactReport.columns,diagnosticColumns:globalThis.ReclassifierTechnicalDiagnosticsV4.columns.length,
        diagnosticStart:38,missingSourceColumns:compactReport.missingSourceColumns,usedClosingDate,statusCounts,stageCounts,qualityCounts,reviewedLevels,textConfirmedLevels,sourcePreservedLevels,
        withoutDescription,withoutClosureNote,classificationSources,classifierPaths:context.paths.size,standardItsm:standard.stats,
        baselineMode,partialRows,objectMismatchRows,causeContextRows,technicalCounts,objectCounts,
        expertComparison,
        batchSizes:{diagnostic:peakDiagnosticBuffer,reference:peakReferenceBuffer}},
      rulesVersion:rules.version,standardRulesVersion:standard.rulesVersion};
  }
  globalThis.ReclassifierReclassificationWorkerProcessor=Object.freeze({
    process,outputColumns:OUTPUT_COLUMNS,diagnosticColumns:DIAGNOSTIC_COLUMNS,
    reportColumns:REPORT_COLUMNS,reportGroups:REPORT_GROUPS,parseItsmWorkbook
  });
})();
