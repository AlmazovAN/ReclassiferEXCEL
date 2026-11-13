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

  async function process(payload, reportProgress = () => {}, reportBatch = null) {
    // Diagnostics are metadata only. Memory APIs are not supported in every browser/Worker.
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const diagnostics = { schemaVersion: '1.0.0', phases: [], memoryMetric: 'unavailable' };
    // Opt-in. Live start/end markers are sent before CPU-heavy synchronous work.
    // Only fixed stage labels and numeric counters; never source data or names.
    const trace = (stage, event, counters = {}) => {
      if (payload?.memoryDiagnostics === true) {
        reportProgress({ mbMemoryDiag: {stage, event, ...counters} });
      }
    };
    let phaseStart = startedAt;
    const snapshot = (stage, extra = {}) => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const memory = typeof performance !== 'undefined' && performance.memory &&
        Number.isFinite(performance.memory.usedJSHeapSize)
        ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null;
      if (memory !== null) diagnostics.memoryMetric = 'jsHeapUsedMB';
      const entry = {
        stage, elapsedMs: Math.round(now - phaseStart),
        sinceStartMs: Math.round(now - startedAt),
        ...extra, jsHeapUsedMB: memory
      };
      diagnostics.phases.push(entry);
      phaseStart = now;
      // Avoid file names, row content, and other potentially sensitive data in logs.
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('[MB memory diagnostics]', entry);
      }
    };
    const files = Array.isArray(payload?.files) ? payload.files : [];
    snapshot('start', { files: files.length });
    if (!files.length) throw new Error('Не переданы файлы Мобильных бригад.');
    const itsmCreatedAtByNumber = buildItsmCreatedAtIndex(payload?.itsmData);
    reportProgress({ percent: 3, label: 'Подготовка' });

    const streamToSqlite = payload?.streamToSqlite === true;
    const batchSize = streamToSqlite ? (payload?.batchSize ?? 5000) : 5000;
    if (streamToSqlite && (typeof reportBatch !== 'function' ||
        !Number.isInteger(batchSize) || batchSize < 500 || batchSize > 10000)) {
      throw new Error('SQLite требует подтверждаемый приёмник и размер пакета 500–10000 строк.');
    }
    const outputRows = streamToSqlite ? null : [];
    const mobileBrigadeDataRows = streamToSqlite ? null : [];
    let stageRows = [];
    let stagedCount = 0;
    let stageSequence = 0;
    const flushStage = async () => {
      if (!stageRows.length) return;
      const rows = stageRows;
      stageRows = [];
      const batchNumber = ++stageSequence;
      trace('batch-send', 'start', {batchNumber, batchRows:rows.length, acceptedRows:stagedCount});
      await reportBatch(rows, batchNumber);
      trace('batch-ack', 'end', {batchNumber, batchRows:rows.length,
        acceptedRows:stagedCount, confirmedBatches:batchNumber});
    };
    const sourceFreshness = [];
    const freshnessByScope = {};
    const typeCounts = {};
    let rowsWithoutRecordKey = 0;
    let rowsMatchedItsm = 0;
    let rowsWithoutItsmMatch = 0;
    const sheetWarnings = [];
    let processedSheets = 0;
    const sheetDetails = [];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
      const file = files[fileIndex];
      if (!(file?.bytes instanceof ArrayBuffer)) {
        throw new Error('Файл «' + (file?.fileName || 'без имени') + '» не передан как ArrayBuffer.');
      }

      reportProgress({
        percent: 5 + Math.floor((fileIndex / files.length) * 75),
        label: 'Чтение файла ' + (fileIndex + 1) + '/' + files.length
      });
      trace('xlsx-read','start',{fileIndex:fileIndex+1,inputBytes:file.bytes.byteLength});
      const workbook = globalThis.XLSX.read(new Uint8Array(file.bytes), {
        type: 'array',
        cellDates: true,
        cellFormula: true,
        // Dense worksheet rows avoid the large sparse-cell address map for
        // 70k+ row files; sheet_to_json supports both storage layouts.
        dense: true
      });
      trace('xlsx-read','end',{fileIndex:fileIndex+1,inputBytes:file.bytes.byteLength});
      snapshot('xlsx-read', { inputBytes: file.bytes.byteLength });
      trace('sheet-parse','start',{fileIndex:fileIndex+1});
      const tables = findInputTables(workbook);
      trace('sheet-parse','end',{fileIndex:fileIndex+1,sheetCount:tables.length});
      snapshot('sheet-to-json', { sheetCount: tables.length });
      if (!tables.length) {
        throw new Error('В файле «' + (file.fileName || 'без имени') +
          '» не найден лист с обязательными полями: ' + REQUIRED_HEADERS.join(', ') +
          ' и хотя бы одним идентифицирующим полем: ' + IDENTITY_HEADERS.join(', ') + '.');
      }
      for (const skipped of workbook.SheetNames.filter(name => !tables.some(table => table.sheetName === name))) {
        sheetWarnings.push('Файл «' + (file.fileName || 'без имени') + '»: лист «' + skipped + '» пропущен: не найдены обязательные заголовки таблицы задач.');
      }
      for (const table of tables) {
        trace('classify','start',{fileIndex:fileIndex+1,sheetIndex:processedSheets+1});
        const initialOutputRows = streamToSqlite ? stagedCount : outputRows.length;
        const inputRowCount = Math.max(0, table.rows.length - table.headerRowIndex - 1);
        processedSheets += 1;
        if (table.unknownColumns.length) sheetWarnings.push(
          'Лист «' + table.sheetName + '»: есть новые колонки: ' + table.unknownColumns.join(', ') + '. Имейте в виду: они пока не используются при обработке.');
        if (table.duplicateHeaders.length) throw new Error(
          'Лист «' + table.sheetName + '»: повторяющиеся названия колонок: ' + table.duplicateHeaders.join(', ') + '.');
        const header = table.rows[table.headerRowIndex] || [];
        const positions = buildPositions(header);
      const sourcePeriod = periodFromFileName(file.fileName);
      const freshness = sourcePeriod.to;
      const fileScopes = new Set();
      const totalFileRows = Math.max(1, table.rows.length - table.headerRowIndex - 1);
      const rowProgressStep = Math.max(1, Math.floor(totalFileRows / 50));

      for (let rowIndex = table.headerRowIndex + 1; rowIndex < table.rows.length; rowIndex += 1) {
        const row = table.rows[rowIndex] || [];
        const processedFileRows = rowIndex - table.headerRowIndex;
        if (processedFileRows === 1 || processedFileRows === totalFileRows ||
            processedFileRows % rowProgressStep === 0) {
          const fileFraction = processedFileRows / totalFileRows;
          reportProgress({
            percent: 5 + Math.floor(((fileIndex + fileFraction) / files.length) * 75),
            label: 'Обработка файла ' + (fileIndex + 1) + '/' + files.length
          });
        }
        if (!hasSourceData(row, positions)) continue;

        const record = buildOutputRecord(row, positions, itsmCreatedAtByNumber);
        const requestNumber = text(record['Заявка']);
        const itsmCreatedAt = record['Дата создания вызова ITSM'] || null;
        if (requestNumber) {
          if (itsmCreatedAt) rowsMatchedItsm += 1;
          else rowsWithoutItsmMatch += 1;
        }
        const output = OUTPUT_COLUMNS.map(column => {
          const value = record[column];
          return value === null || value === undefined ? '' : value;
        });
        if (!streamToSqlite) outputRows.push(output);

        const site = text(record['Участок']);
        const taskNumber = text(record['Номер задачи']);
        const requestUrl = text(record['Ссылка на заявку']);
        const taskForShiftId = rules.extractTaskForShiftId(requestUrl);
        const recordKey = rules.mobileBrigadeRecordKey({ site, taskNumber, taskForShiftId, requestUrl });
        if (site) {
          fileScopes.add(site);
          if (freshness && (!freshnessByScope[site] || freshness > freshnessByScope[site])) {
            freshnessByScope[site] = freshness;
          } else if (!(site in freshnessByScope)) {
            freshnessByScope[site] = freshness || null;
          }
        }
        if (!recordKey) rowsWithoutRecordKey += 1;

        const labor = rules.parseLaborHours(record['Фактические трудозатраты']);
        const analyticalRecord = {
          site,
          taskNumber,
          taskForShiftId,
          recordKey,
          request: text(record['Заявка']),
          requestUrl,
          factDate: dateValue(record['Фактическая дата']),
          laborHours: labor.hours,
          astroHours: Number.isFinite(record['ФактАстрочас, час']) ? record['ФактАстрочас, час'] : null,
          equipmentPlacement: text(record['Навесное / Стационарное']),
          equipmentUnit: text(record['Единица оборудования']),
          equipmentType: text(record['Тип оборудования']),
          transport: text(record['Транспорт']),
          equipment: text(record['Оборудование']),
          element: text(record['Элемент']),
          fault: text(record['Неисправность']),
          incidentReason: text(record['Причина инцидента']),
          description: text(record['Описание']),
          combinedComment: String(record['Объединённый комментарий'] ?? ''),
          itsmCreatedAt,
          preBacklogAge: '',
          finalTaskType: text(record['Итог Новый тип задач']) || null,
          laborState: labor.state
        };
        if (streamToSqlite) {
          stageRows.push({record: analyticalRecord, row: output});
          stagedCount += 1;
          if (stageRows.length >= batchSize) await flushStage();
        } else mobileBrigadeDataRows.push(analyticalRecord);

        const finalType = text(record['Итог Новый тип задач']) || '(пусто)';
        typeCounts[finalType] = (typeCounts[finalType] || 0) + 1;
      }

      sheetDetails.push({
        fileName: file.fileName || '',
        sheetName: table.sheetName,
        inputRows: inputRowCount,
        acceptedRows: (streamToSqlite ? stagedCount : outputRows.length) - initialOutputRows,
        skippedRows: inputRowCount - ((streamToSqlite ? stagedCount : outputRows.length) - initialOutputRows)
      });
      sourceFreshness.push({
        fileName: file.fileName || '',
        periodStart: sourcePeriod.from,
        periodEnd: sourcePeriod.to,
        freshness,
        sheetName: table.sheetName,
        scopes: Array.from(fileScopes).sort((left, right) => left.localeCompare(right, 'ru'))
      });
      trace('classify','end',{fileIndex:fileIndex+1,sheetIndex:processedSheets,
        acceptedRows:(streamToSqlite?stagedCount:outputRows.length)-initialOutputRows});
      }
    }

    if (streamToSqlite) await flushStage();
    const acceptedTotal = streamToSqlite ? stagedCount : outputRows.length;
    if (sheetDetails.reduce((sum, item) => sum + item.acceptedRows, 0) !== acceptedTotal ||
        (!streamToSqlite && mobileBrigadeDataRows.length !== acceptedTotal)) {
      throw new Error('Нарушена полнота многолистового импорта: количество строк Worker не совпадает с Dataset.');
    }

    snapshot('classification', { outputRows: acceptedTotal, sqliteBatches: stageSequence, batchSize: streamToSqlite ? batchSize : null });
    // Preserve every source row. First occurrence keeps its source key; repeated
    // occurrences receive a unique synthetic task number and recordKey.
    // Reserve all original keys so a synthetic suffix never overwrites a real task.
    const reservedKeys = streamToSqlite ? new Set() : new Set(mobileBrigadeDataRows.map(row => key(row.recordKey)).filter(Boolean));
    const usedKeys = new Set();
    const duplicateOrdinals = new Map();
    let duplicateRecordKeys = 0;
    const taskNumberColumn = OUTPUT_COLUMNS.indexOf('Номер задачи');
    for (let index = 0; !streamToSqlite && index < mobileBrigadeDataRows.length; index += 1) {
      const record = mobileBrigadeDataRows[index];
      const baseKey = key(record.recordKey);
      if (!baseKey) continue; // Existing missing-key validation is unchanged.
      if (!usedKeys.has(baseKey)) {
        usedKeys.add(baseKey);
        continue;
      }
      duplicateRecordKeys += 1;
      let ordinal = duplicateOrdinals.get(baseKey) || 0;
      let proposedKey;
      let proposedTaskNumber;
      do {
        ordinal += 1;
        proposedTaskNumber = text(record.taskNumber) + '-D' + ordinal;
        proposedKey = baseKey + '-d' + ordinal;
      } while (reservedKeys.has(proposedKey) || usedKeys.has(proposedKey));
      duplicateOrdinals.set(baseKey, ordinal);
      record.recordKey = proposedKey;
      record.taskNumber = proposedTaskNumber;
      outputRows[index][taskNumberColumn] = proposedTaskNumber;
      usedKeys.add(proposedKey);
    }
    if (duplicateRecordKeys) sheetWarnings.push(
      'Найдено повторяющихся recordKey: ' + duplicateRecordKeys +
      '. Первое вхождение оставлено без изменений; остальные сохранены с суффиксами -D1, -D2 и далее.'
    );

    const freshnessValues = sourceFreshness
      .map(item => item.freshness)
      .filter(Boolean)
      .sort();
    const freshnessMin = freshnessValues.at(0) || null;
    const freshnessMax = freshnessValues.at(-1) || null;
    const freshness = freshnessMax;

    // XLSX cells cannot contain more than 32767 UTF-16 code units.
    // Restrict only the downloadable workbook; preserve original full text in
    // Mobile Brigade Full Dataset and analytics stored in SQLite.
    snapshot('duplicate-key-resolution', { duplicateRecordKeys, deferredToSqlite: streamToSqlite });
    const deferExport = payload?.deferExport === true || streamToSqlite;
    let outputBuffer = null;
    const XLSX_TEXT_LIMIT = 32767;
    if (!deferExport) {
    let truncatedExcelCells = 0;
    // Prepare XLSX in bounded chunks instead of duplicating all output rows.
    const sheet = globalThis.XLSX.utils.aoa_to_sheet([OUTPUT_COLUMNS], { cellDates: true });
    const chunkSize = 2000;
    for (let offset = 0; offset < outputRows.length; offset += chunkSize) {
      const chunk = outputRows.slice(offset, offset + chunkSize).map(row => row.map(value => {
        if (typeof value !== 'string' || value.length <= XLSX_TEXT_LIMIT) return value;
        truncatedExcelCells += 1;
        return value.slice(0, XLSX_TEXT_LIMIT);
      }));
      globalThis.XLSX.utils.sheet_add_aoa(sheet, chunk, {
        origin: { r: offset + 1, c: 0 }, cellDates: true
      });
    }
    if (truncatedExcelCells) sheetWarnings.push(
      'В ' + truncatedExcelCells + ' ячейках текст превышает лимит XLSX 32767 символов. ' +
      'Текст сокращён только в скачиваемом Excel; полные значения сохранены в Dataset.'
    );
    snapshot('export-row-preparation', { outputRows: outputRows.length, truncatedExcelCells });
    reportProgress({ percent: 84, label: 'Формирование таблицы' });
    sheet['!autofilter'] = { ref: 'A1:' + globalThis.XLSX.utils.encode_cell({ r: outputRows.length, c: OUTPUT_COLUMNS.length - 1 }) };
    sheet['!cols'] = OUTPUT_COLUMNS.map(column => ({
      wch: Math.min(45, Math.max(11, String(column).length + 2))
    }));

    snapshot('aoa-to-sheet', { outputRows: outputRows.length });
    const book = globalThis.XLSX.utils.book_new();
    globalThis.XLSX.utils.book_append_sheet(book, sheet, 'Мобильные бригады');

    reportProgress({ percent: 92, label: 'Формирование Excel' });
    const written = globalThis.XLSX.write(book, {
      bookType: 'xlsx',
      type: 'array',
      compression: true,
      bookSST: false
    });

    snapshot('xlsx-write', { outputRows: outputRows.length });
    if (written instanceof ArrayBuffer) {
      outputBuffer = written;
    } else if (ArrayBuffer.isView(written)) {
      outputBuffer = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);
    } else {
      throw new Error('SheetJS returned an unsupported output buffer type.');
    }

    }
    reportProgress({ percent: 100, label: 'Готово' });
    snapshot('finish', { outputRows: acceptedTotal, outputBytes: outputBuffer?.byteLength || 0, excelGenerated: Boolean(outputBuffer), sqliteBatches: stageSequence, batchSize: streamToSqlite ? batchSize : null });

    return {
      bytes: outputBuffer,
      outputName: outputFileName(freshness),
      rulesVersion: rules.version,
      outputColumns: OUTPUT_COLUMNS,
      freshness,
      freshnessMin,
      freshnessMax,
      sourceFreshness,
      mobileBrigadeFullDataset: {
        schemaVersion: '1.0.0',
        package: 'mobile-brigade-full-dataset',
        aggregation: 'per-task-row',
        fieldCount: OUTPUT_COLUMNS.length,
        columns: OUTPUT_COLUMNS.slice(),
        rows: outputRows
      },
      mobileBrigadeData: {
        schemaVersion: '1.5.0',
        latestSourceDate: freshnessMax,
        earliestSourceDate: freshnessMin,
        sourceFreshness,
        freshnessByScope,
        records: mobileBrigadeDataRows
      },
      stageOnly: streamToSqlite,
      stats: {
        diagnostics,
        files: files.length,
        sheets: processedSheets,
        sheetDetails,
        warnings: sheetWarnings,
        rows: acceptedTotal,
        batchSize: streamToSqlite ? batchSize : null,
        batches: stageSequence,
        rowsWithoutRecordKey,
        duplicateRecordKeys,
        rowsMatchedItsm,
        rowsWithoutItsmMatch,
        itsmIndexSize: itsmCreatedAtByNumber.size,
        scopes: Object.keys(freshnessByScope).length,
        typeCounts
      }
    };
  }


  // Opt-in "Папки" path. Existing 38-column downloadable workbook and SQLite
  // processor stay unchanged. This mode modifies only named derived columns
  // in the ORIGINAL workbook, preserving source row numbers and task identifiers.
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
    process, processFolder, folderHeader, buildOutputRecord, dateValue,
    folderColumns:FOLDER_DERIVED_COLUMNS,
    parseLaborHours: value => rules.parseLaborHours(value).hours,
    freshnessFromFileName,
    periodFromFileName,
    buildItsmCreatedAtIndex
  });
})();
