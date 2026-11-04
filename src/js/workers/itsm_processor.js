(() => {
  'use strict';

  const rules = globalThis.ReclassifierItsmRules;
  if (!rules) throw new Error('ITSM rules are not loaded in worker runtime.');
  const datasetSchema = globalThis.ReclassifierItsmDatasetSchema;
  if (!datasetSchema) throw new Error('ITSM Dataset schema is not loaded in worker runtime.');
  const kpiSourceApi = globalThis.ReclassifierKpiSource;
  if (!kpiSourceApi) throw new Error('KPI Source core is not loaded in worker runtime.');
  if (!globalThis.XLSX) throw new Error('SheetJS is not loaded in worker runtime.');

  const OUTPUT_SOURCE_COLUMNS = rules.outputColumns;
  const OUTPUT_COLUMNS = datasetSchema.labels.slice(
    datasetSchema.sourceFieldCount,
    datasetSchema.sourceFieldCount + datasetSchema.outputFieldCount
  );
  const PRESENCE_COLUMN = 27 + datasetSchema.outputFieldCount;
  const PRESENCE_LABEL = 'Наличие заявки в МБ';
  const mbPresence = globalThis.ReclassifierItsmMbPresence;
  if (!mbPresence?.evaluate) throw new Error('ITSM MB presence module is missing.');
  const datasetOutputSourceLabels = datasetSchema.sourceLabels.slice(
    datasetSchema.sourceFieldCount,
    datasetSchema.sourceFieldCount + datasetSchema.outputFieldCount
  );
  if (datasetSchema.outputFieldCount !== OUTPUT_SOURCE_COLUMNS.length ||
      datasetOutputSourceLabels.some((label, index) => label !== OUTPUT_SOURCE_COLUMNS[index])) {
    throw new Error('ITSM Dataset schema is not aligned with ITSM Rules output.');
  }
  const key = rules.key;
  const text = rules.text;
  const datasetFieldIndex = new Map(
    datasetSchema.fields.map((field, index) => [field, index])
  );
  const HEADER_SEARCH_LIMIT = 100;
  const EXTRA_REASON_PREFIX = 'Доп.информация по причине: ';

  // A single idempotent representation is used by the ITSM Dataset, report and Re-Class.
  // Preserve the original comment body (including internal line breaks).
  function combineClosureNotes(closureNote, extraReason) {
    const main = String(closureNote ?? '').replace(/\u00a0/g, ' ').trim();
    const extra = String(extraReason ?? '').replace(/\u00a0/g, ' ').trim();
    if (!extra) return main || null;
    const suffix = EXTRA_REASON_PREFIX + extra;
    if (main.endsWith(suffix)) return main;
    const merged = main ? main + ' ' + suffix : suffix;
    if (merged.length > 32767) {
      throw new Error('Объединённые примечания превышают допустимые 32767 символов ячейки Excel.');
    }
    return merged;
  }
  const OUTPUT_START_COLUMN = 27;
  const REQUIRED_HEADERS = Object.freeze([
    'created', 'completed', 'closed', 'number', 'territory', 'equipment',
    'element', 'fault', 'reason', 'shortDescription', 'description', 'closureNote',
    'openedBy', 'slaWorking', 'closureCode'
  ]);
  const HEADER_LABELS = Object.freeze({
    created: 'Дата создания Вызова',
    completed: 'Дата выполнения обращения',
    closed: 'Дата закрытия',
    number: 'Номер',
    territory: 'Территории MES',
    equipment: 'Наименование оборудования',
    element: 'Элемент',
    fault: 'Неисправность',
    reason: 'Причина инцидента',
    shortDescription: 'Категорированная информация обращения.Краткое описание',
    description: 'Категорированная информация обращения.Описание',
    closureNote: 'Примечания к разрешению / Примечание к закрытию',
    openedBy: 'Открыл',
    slaWorking: 'Измерение цели обслуживания…Прошло (рабочее время)',
    closureCode: 'Код закрытия'
  });

  function numberValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = text(value).replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
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

    let match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      const date = new Date(
        year,
        Number(match[2]) - 1,
        Number(match[1]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0)
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }

    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4] || 0),
        Number(match[5] || 0),
        Number(match[6] || 0)
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const timestamp = Date.parse(normalized);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
  }

  function datasetDateText(value) {
    const date = dateValue(value);
    if (!date) return null;
    const pad = number => String(number).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
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
    const includesAll = parts => {
      const expected = parts.map(headerKey);
      return normalized.findIndex(value => expected.every(part => value.includes(part)));
    };

    return {
      created: exactOrSuffix(['Дата создания Вызова']),
      completed: exactOrSuffix(['Дата выполнения обращения']),
      closed: exactOrSuffix(['Дата закрытия']),
      number: exact('Номер'),
      initiator: exact('Инициатор'),
      state: exact('Состояние'),
      territory: firstExact(['Территории MES', 'Территория MES']),
      equipment: exact('Наименование оборудования'),
      element: exact('Элемент'),
      fault: exact('Неисправность'),
      reason: exact('Причина инцидента'),
      shortDescription: exact('Категорированная информация обращения.Краткое описание'),
      description: exact('Категорированная информация обращения.Описание'),
      closureNote: firstExact(['Примечания к разрешению', 'Примечания к закрытию (объединённые с доп)', 'Примечание к закрытию', 'Примечания к закрытию']),
      extraReason: exact('Доп.информация по причине'),
      installationLocation: exact('Место установки объекта обслуживания'),
      openedBy: exact('Открыл'),
      slaWorking: includesAll(['Измерение цели обслуживания', 'Прошло (рабочее время)']),
      slaOverdue: exactOrSuffix(['Просрочен по разрешению']),
      closureCode: exactOrSuffix(['Код закрытия'])
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
        const header = rows[rowIndex] || [];
        const positions = headerPositions(header);
        const missing = REQUIRED_HEADERS.filter(id => positions[id] < 0);
        if (!missing.length) {
          return { table: { sheetName, sheet, rows, headerRowIndex: rowIndex, positions }, bestCandidate: null };
        }

        const score = REQUIRED_HEADERS.length - missing.length;
        if (!bestCandidate || score > bestCandidate.score) {
          bestCandidate = { sheetName, rowIndex, score, missing };
        }
      }
    }

    return { table: null, bestCandidate };
  }

  function sourceRowHasData(row, pos) {
    return REQUIRED_HEADERS.some(id => {
      const index = pos[id];
      const value = index >= 0 ? row[index] : null;
      return value !== null && value !== undefined && String(value).trim() !== '';
    });
  }

  function assertOutputRegionSafe(table, lastSourceRow) {
    const header = table.rows[table.headerRowIndex] || [];
    const conflicts = [];

    for (let offset = 0; offset < OUTPUT_COLUMNS.length + 1; offset += 1) {
      const columnIndex = OUTPUT_START_COLUMN + offset;
      const currentHeader = text(header[columnIndex]);
      const expectedHeader = OUTPUT_COLUMNS[offset] || PRESENCE_LABEL;
      const legacyHeader = OUTPUT_SOURCE_COLUMNS[offset] || PRESENCE_LABEL;

      if (currentHeader &&
          headerKey(currentHeader) !== headerKey(expectedHeader) &&
          headerKey(currentHeader) !== headerKey(legacyHeader)) {
        conflicts.push({
          columnIndex,
          title: currentHeader
        });
        continue;
      }

      if (!currentHeader) {
        for (let rowIndex = table.headerRowIndex + 1; rowIndex <= lastSourceRow; rowIndex += 1) {
          const value = table.rows[rowIndex]?.[columnIndex];
          if (value !== null && value !== undefined && String(value).trim() !== '') {
            conflicts.push({ columnIndex, title: '(заголовок пуст, но есть данные)' });
            break;
          }
        }
      }
    }

    if (conflicts.length) {
      const preview = conflicts.slice(0, 5).map(item =>
        globalThis.XLSX.utils.encode_col(item.columnIndex) + ' «' + item.title + '»'
      ).join(', ');
      const more = conflicts.length > 5 ? ' и ещё ' + (conflicts.length - 5) : '';
      throw new Error(
        'Структура ITSM изменилась: диапазон AB:BJ зарезервирован для 34 расчётных полей и признака МБ, ' +
        'но в исходном файле там обнаружены другие данные (' + preview + more + '). ' +
        'Обработка остановлена, чтобы не перезаписать исходные колонки.'
      );
    }
  }

  function datasetSourceValues(row, pos) {
    const nullableText = index => index >= 0 ? (text(row[index]) || null) : null;
    return [
      datasetDateText(row[pos.created]),
      datasetDateText(row[pos.completed]),
      datasetDateText(row[pos.closed]),
      nullableText(pos.number),
      nullableText(pos.initiator),
      nullableText(pos.state),
      nullableText(pos.territory),
      nullableText(pos.equipment),
      nullableText(pos.element),
      nullableText(pos.fault),
      nullableText(pos.reason),
      nullableText(pos.shortDescription),
      nullableText(pos.description),
      nullableText(pos.closureNote),
      nullableText(pos.installationLocation),
      nullableText(pos.openedBy),
      nullableText(pos.closureCode)
    ];
  }

  function datasetFieldValue(datasetRow, field) {
    const index = datasetFieldIndex.get(field);
    if (index === undefined) {
      throw new Error('ITSM Dataset schema does not contain field: ' + field + '.');
    }
    return datasetRow[index];
  }

  function kpiRecordFromDatasetRow(datasetRow, sourceRow, pos) {
    return {
      createdAt: datasetFieldValue(datasetRow, 'createdAt'),
      completedAt: datasetFieldValue(datasetRow, 'completedAt'),
      closedAt: datasetFieldValue(datasetRow, 'closedAt'),
      territory: datasetFieldValue(datasetRow, 'territory'),
      sourceEquipment: datasetFieldValue(datasetRow, 'sourceEquipment'),
      reclassifiedEquipment: datasetFieldValue(datasetRow, 'reclassifiedEquipment'),
      openedBy: datasetFieldValue(datasetRow, 'openedBy'),
      classificationQuality: datasetFieldValue(datasetRow, 'classificationQuality'),
      typeAfterReclassification: datasetFieldValue(datasetRow, 'typeAfterReclassification'),
      sputnikVbrDecision: datasetFieldValue(datasetRow, 'sputnikVbrDecision'),
      sdgrService: datasetFieldValue(datasetRow, 'sdgrService'),
      division: datasetFieldValue(datasetRow, 'division'),
      slaHours: datasetFieldValue(datasetRow, 'slaHours'),
      preBacklogHours: datasetFieldValue(datasetRow, 'preBacklogHours'),
      equipmentCount: datasetFieldValue(datasetRow, 'driversByMine'),
      slaOverdue: pos.slaOverdue >= 0 ? sourceRow[pos.slaOverdue] : null
    };
  }

  function setCell(sheet, rowIndex, columnIndex, value) {
    const address = globalThis.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    if (typeof value === 'boolean') sheet[address] = { t: 'b', v: value };
    else if (typeof value === 'number' && Number.isFinite(value)) sheet[address] = { t: 'n', v: value };
    else sheet[address] = { t: 's', v: value === null || value === undefined ? '' : String(value) };
  }

  function upsertKpiSourceWorksheet(workbook, kpiAggregate, kpiRecords) {
    const rows = [Array.from(kpiAggregate.columns), ...kpiRecords];
    const sheet = globalThis.XLSX.utils.aoa_to_sheet(rows);
    const sheetName = 'KPI_Source';
    if (workbook.SheetNames.includes(sheetName)) {
      workbook.Sheets[sheetName] = sheet;
      return;
    }
    globalThis.XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  }

  function outputFileName(fileName) {
    const base = String(fileName || 'ITSM').replace(/\.(xlsx|xlsm|xls)$/i, '');
    return base + '_ITSM.xlsx';
  }

  function normalizeReferences(references) {
    const result = {};
    for (const id of ['reclassification', 'drivers', 'customers', 'type_request', 'initiators', 'exceptions', 'problem_grade']) {
      result[id] = Array.isArray(references?.[id]) ? references[id] : [];
    }
    if (Array.isArray(references?.mobile_brigade_data)) {
      result.mobile_brigade_data = references.mobile_brigade_data;
    }
    if (references?.mobile_brigade_meta && typeof references.mobile_brigade_meta === 'object') {
      result.mobile_brigade_meta = {
        latestSourceDate: references.mobile_brigade_meta.latestSourceDate || null
      };
    }
    return result;
  }

  async function process(payload, reportProgress = () => {}) {
    const inputBuffer = payload?.bytes;
    if (!(inputBuffer instanceof ArrayBuffer) && !payload?.runtimeWorkbook)
      throw new Error('ITSM worker did not receive an ArrayBuffer or runtime workbook.');
    reportProgress({ percent: 3, label: 'Подготовка' });

    const references = normalizeReferences(payload?.references);
    const lookups = rules.buildLookups(references);
    // Runtime snapshots stay inside the Worker; do not materialize a temporary
    // XLSX merely to call the existing ITSM processor.
    const workbook = payload?.runtimeWorkbook || globalThis.XLSX.read(new Uint8Array(inputBuffer), {
      type: 'array',
      cellDates: true,
      cellFormula: true
    });
    reportProgress({ percent: 12, label: 'Чтение Excel' });

    const discovery = findInputTable(workbook);
    if (!discovery.table) {
      const best = discovery.bestCandidate;
      if (best && best.score >= 4) {
        const missing = best.missing.map(id => '«' + HEADER_LABELS[id] + '»').join(', ');
        throw new Error(
          'Не удалось распознать полную строку заголовков ITSM. Лучший вариант: лист «' +
          best.sheetName + '», строка ' + (best.rowIndex + 1) + '. Не найдены обязательные колонки: ' + missing + '.'
        );
      }
      throw new Error(
        'Не найдена строка заголовков ITSM в первых ' + HEADER_SEARCH_LIMIT +
        ' строках листов. Проверьте, что выгрузка содержит обязательные поля ITSM.'
      );
    }

    const table = discovery.table;
    const pos = table.positions;
    reportProgress({ percent: 18, label: 'Проверка структуры' });

    let lastSourceRow = table.headerRowIndex;
    for (let rowIndex = table.headerRowIndex + 1; rowIndex < table.rows.length; rowIndex += 1) {
      const row = table.rows[rowIndex] || [];
      if (sourceRowHasData(row, pos)) lastSourceRow = rowIndex;
    }

    // SQLite integration requires the normalized Dataset, not an exported
    // 50k-row XLSX. Avoid constructing and serializing 34 extra spreadsheet
    // columns in that mode; normal standalone ITSM processing is unchanged.
    const datasetOnly = payload?.datasetOnly === true;
    // A combined Re-Class report consumes the live worksheet and analytical
    // rows, not a second complete raw-row copy. This is an internal optimization
    // and cannot suppress persisted Full Dataset in ordinary ITSM processing.
    const omitFullDatasetRows = payload?.deferExport === true &&
      payload?.omitFullDatasetRows === true;
    if (!datasetOnly) {
      assertOutputRegionSafe(table, lastSourceRow);
      OUTPUT_COLUMNS.forEach((title, offset) => {
        setCell(table.sheet, table.headerRowIndex, OUTPUT_START_COLUMN + offset, title);
      });
      setCell(table.sheet, table.headerRowIndex, PRESENCE_COLUMN, PRESENCE_LABEL);
    }

    const stats = {
      rows: 0,
      reclassified: 0,
      missingDrivers: 0,
      missingInitiators: 0,
      missingCustomers: 0,
      missingTypeRequests: 0,
      northExceptions: 0,
      generalExceptions: 0,
      problemLinks: 0
    };

    const asOfDate = dateValue(payload?.asOfDate) || new Date();
    asOfDate.setHours(0, 0, 0, 0);
    const sourceHeader = table.rows[table.headerRowIndex] || [];
    const fullDatasetColumnCount = Math.max(
      sourceHeader.length,
      PRESENCE_COLUMN + 1
    );
    const fullDatasetColumns = Array.from({ length: fullDatasetColumnCount }, (_, index) => {
      const value = sourceHeader[index];
      return value === null || value === undefined ? '' : String(value);
    });
    OUTPUT_COLUMNS.forEach((title, offset) => {
      fullDatasetColumns[OUTPUT_START_COLUMN + offset] = title;
    });
    fullDatasetColumns[PRESENCE_COLUMN] = PRESENCE_LABEL;

    const datasetRows = [];
    const fullDatasetRows = [];
    const kpiAggregator = kpiSourceApi.createAggregator();
    let earliestSourceDate = null;
    let latestSourceDate = null;
    // Opt-in Re-Class handoff: preserve the actual V text before legacy
    // ITSM combines V and W for its own Reclassification contract.
    const originalClosureNotes = payload?.deferExport === true &&
      payload?.captureOriginalClosureNotes === true ? [] : null;
    const totalRows = Math.max(1, lastSourceRow - table.headerRowIndex);
    const progressStep = Math.max(1, Math.floor(totalRows / 100));
    reportProgress({ percent: 22, label: 'Обработка строк' });

    for (let rowIndex = table.headerRowIndex + 1; rowIndex <= lastSourceRow; rowIndex += 1) {
      const row = table.rows[rowIndex] || [];
      const originalNote = row[pos.closureNote];
      if (originalClosureNotes) originalClosureNotes.push(originalNote ?? null);
      const combinedNote = combineClosureNotes(originalNote, pos.extraReason >= 0 ? row[pos.extraReason] : null);
      if (combinedNote !== (originalNote ?? null)) {
        // Keep rawRows, the normalized Dataset and exported source worksheet in sync.
        row[pos.closureNote] = combinedNote;
        if (!datasetOnly) setCell(table.sheet, rowIndex, pos.closureNote, combinedNote);
      }
      stats.rows += 1;
      const processedRows = rowIndex - table.headerRowIndex;
      if (processedRows === 1 || processedRows === totalRows || processedRows % progressStep === 0) {
        reportProgress({
          percent: 22 + Math.floor((processedRows / totalRows) * 63),
          label: 'Обработка строк'
        });
      }

      const result = rules.evaluateRow({
        created: dateValue(row[pos.created]),
        completed: dateValue(row[pos.completed]),
        closed: dateValue(row[pos.closed]),
        number: text(row[pos.number]),
        territory: text(row[pos.territory]),
        equipment: text(row[pos.equipment]),
        element: text(row[pos.element]),
        fault: text(row[pos.fault]),
        reason: text(row[pos.reason]),
        shortDescription: text(row[pos.shortDescription]),
        openedBy: text(row[pos.openedBy]),
        slaWorking: numberValue(row[pos.slaWorking]),
        closureCode: text(row[pos.closureCode])
      }, lookups, { asOfDate });

      if (result.audit.reclassified) stats.reclassified += 1;
      if (result.audit.missingDrivers) stats.missingDrivers += 1;
      if (result.audit.missingInitiator) stats.missingInitiators += 1;
      if (result.audit.missingCustomer) stats.missingCustomers += 1;
      if (result.audit.missingTypeRequest) stats.missingTypeRequests += 1;
      if (result.audit.linkedProblem) stats.problemLinks += 1;
      if (result.audit.sputnikExcluded && result.audit.exceptionSource === 'north') stats.northExceptions += 1;
      if (result.audit.sputnikExcluded && result.audit.exceptionSource === 'general') stats.generalExceptions += 1;

      const requestPresence = mbPresence.evaluate(
        lookups.mobileBrigadeByRequest,
        text(row[pos.number]),
        dateValue(row[pos.created]),
        references.mobile_brigade_meta || {},
        lookups.mobileBrigadeAvailable
      );
      if (!datasetOnly) {
        result.values.forEach((value, offset) => {
          setCell(table.sheet, rowIndex, OUTPUT_START_COLUMN + offset, value);
        });
        setCell(table.sheet, rowIndex, PRESENCE_COLUMN, requestPresence);
      }

      if (!omitFullDatasetRows) {
        const fullDatasetRow = Array.from({ length: fullDatasetColumnCount }, (_, index) => {
          const value = row[index];
          return value === undefined ? null : value;
        });
        result.values.forEach((value, offset) => {
          fullDatasetRow[OUTPUT_START_COLUMN + offset] =
            value === undefined ? null : value;
        });
        fullDatasetRow[PRESENCE_COLUMN] = requestPresence;
        fullDatasetRows.push(fullDatasetRow);
      }

      const datasetRow = [...datasetSourceValues(row, pos), ...result.values, requestPresence];
      if (datasetRow.length !== datasetSchema.fields.length) {
        throw new Error('ITSM Dataset row width does not match schema.');
      }
      datasetRows.push(datasetRow);
      kpiAggregator.consume(kpiRecordFromDatasetRow(datasetRow, row, pos));

      const createdDate = datasetRow[0]?.slice?.(0, 10) || null;
      if (createdDate) {
        if (!earliestSourceDate || createdDate < earliestSourceDate) earliestSourceDate = createdDate;
        if (!latestSourceDate || createdDate > latestSourceDate) latestSourceDate = createdDate;
      }
    }

    const kpiAggregate = kpiAggregator.finalize();
    const kpiRecords = kpiAggregate.records.map(record =>
      kpiAggregate.fields.map(field => record[field] ?? null)
    );
    const kpiPeriods = kpiAggregate.records
      .map(record => record.period)
      .filter(Boolean);

    let outputBuffer = null;
    reportProgress({ percent: 88, label: datasetOnly ? 'Подготовка данных' : 'Формирование Excel' });
    if (!datasetOnly) {
      upsertKpiSourceWorksheet(workbook, kpiAggregate, kpiRecords);
    }
    if (!datasetOnly && payload?.deferExport !== true) {
      const oldRange = table.sheet['!ref']
        ? globalThis.XLSX.utils.decode_range(table.sheet['!ref'])
        : { s: { r: 0, c: 0 }, e: { r: lastSourceRow, c: 0 } };
  
      for (let rowIndex = lastSourceRow + 1; rowIndex <= oldRange.e.r; rowIndex += 1) {
        for (let columnIndex = OUTPUT_START_COLUMN; columnIndex <= PRESENCE_COLUMN; columnIndex += 1) {
          delete table.sheet[globalThis.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
        }
      }
  
      oldRange.e.r = Math.max(oldRange.e.r, lastSourceRow);
      oldRange.e.c = Math.max(oldRange.e.c, PRESENCE_COLUMN);
      table.sheet['!ref'] = globalThis.XLSX.utils.encode_range(oldRange);
  
      const written = globalThis.XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array',
        compression: true,
        bookSST: true
      });
  
      if (written instanceof ArrayBuffer) {
        outputBuffer = written;
      } else if (ArrayBuffer.isView(written)) {
        outputBuffer = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);
      } else {
        throw new Error('SheetJS returned an unsupported output buffer type.');
      }
  
    }
    reportProgress({ percent: 100, label: 'Готово' });

    return {
      bytes: outputBuffer,
      outputName: outputFileName(payload?.fileName),
      stats,
      sheetName: table.sheetName,
      rulesVersion: rules.version,
      // Internal hand-off: the combined reclassification workflow appends its
      // diagnostics before a single XLSX export. Standard ITSM calls are unchanged.
      ...(payload?.deferExport === true ? { workspace: {
        workbook, sheet: table.sheet, rawRows: table.rows,
        headerRowIndex: table.headerRowIndex, lastSourceRow,
        ...(originalClosureNotes ? {originalClosureNotes} : {})
      } } : {}),
      itsmFullDataset: {
        schemaVersion: '1.0.0',
        package: 'itsm-full-dataset',
        aggregation: 'per-source-row',
        fieldCount: fullDatasetColumns.length,
        columns: fullDatasetColumns,
        rows: fullDatasetRows,
        sourceRows: datasetRows.length,
        ...(omitFullDatasetRows ? {coverage:'omitted-for-reclassification'} : {}),
        earliestSourceDate,
        latestSourceDate
      },
      itsmData: {
        schemaVersion: datasetSchema.version,
        fields: Array.from(datasetSchema.fields),
        columns: Array.from(datasetSchema.labels),
        records: datasetRows,
        sourceRows: datasetRows.length,
        earliestSourceDate,
        latestSourceDate
      },
      kpiSource: {
        schemaVersion: kpiSourceApi.schemaVersion,
        package: 'kpi-source',
        aggregation: 'monthly-dimensions',
        fields: Array.from(kpiAggregate.fields),
        columns: Array.from(kpiAggregate.columns),
        records: kpiRecords,
        sourceRows: datasetRows.length,
        aggregateRows: kpiRecords.length,
        earliestPeriod: kpiPeriods.length ? kpiPeriods[0] : null,
        latestPeriod: kpiPeriods.length ? kpiPeriods[kpiPeriods.length - 1] : null
      }
    };
  }

  globalThis.ReclassifierItsmWorkerProcessor = Object.freeze({ process, combineClosureNotes });
})();
