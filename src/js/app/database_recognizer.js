  function recognizerNormalizeHeader(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function recognizerDatasetId(classification) {
    const id = classification?.id || 'unknown';
    if (id === 'itsm') return 'itsm_data';
    if (id === 'mobile_brigade') return 'mobile_brigade_data';
    if (id === 'failure_classifier') return 'failure_classifier';
    if (id.startsWith('equipment:')) return id.slice('equipment:'.length);
    if (globalThis.ReclassifierDatabaseContract?.datasets?.[id]) return id;
    return null;
  }

  function recognizerStrategy(datasetId) {
    return datasetId
      ? globalThis.ReclassifierDatabaseContract?.datasets?.[datasetId]?.strategy || null
      : null;
  }

  function recognizerDefinition(datasetId) {
    return datasetId ? globalThis.ReclassifierDatabaseContract?.datasets?.[datasetId] || null : null;
  }

  function recognizerDateParts(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return {
        y: value.getFullYear(),
        m: value.getMonth() + 1,
        d: value.getDate()
      };
    }

    if (typeof value === 'number' && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return { y: parsed.y, m: parsed.m, d: parsed.d };
      }
    }

    const text = String(value ?? '').trim();
    if (!text) return null;

    let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})/);
    if (match) {
      return {
        y: match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]),
        m: Number(match[2]),
        d: Number(match[1])
      };
    }

    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) {
      return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
    }

    const timestamp = Date.parse(text);
    if (Number.isNaN(timestamp)) return null;
    const date = new Date(timestamp);
    return {
      y: date.getFullYear(),
      m: date.getMonth() + 1,
      d: date.getDate()
    };
  }

  function recognizerIsoDate(value) {
    const parts = recognizerDateParts(value);
    if (!parts) return null;
    const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    if (date.getUTCFullYear() !== parts.y ||
        date.getUTCMonth() !== parts.m - 1 ||
        date.getUTCDate() !== parts.d) {
      return null;
    }
    return String(parts.y).padStart(4, '0') + '-' +
      String(parts.m).padStart(2, '0') + '-' +
      String(parts.d).padStart(2, '0');
  }

  function recognizerDateRange(values) {
    const dates = values.map(recognizerIsoDate).filter(Boolean).sort();
    return {
      from: dates.at(0) || null,
      to: dates.at(-1) || null,
      validCount: dates.length
    };
  }

  function recognizerFilePeriod(fileName) {
    const values = [...String(fileName || '').matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)]
      .map(match => match[1] + '-' + match[2] + '-' + match[3])
      .filter(value => recognizerIsoDate(value))
      .sort();
    return {
      from: values.at(0) || null,
      to: values.at(-1) || null
    };
  }

  function recognizerRows(workbook, sheetName) {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) return [];
    const trace = globalThis.ReclassifierDatabaseMemoryDiagnostics;
    trace?.mark?.('recognizer-rows','start');
    const rows = window.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false
    });
    trace?.mark?.('recognizer-rows','end',{rows:rows.length});
    return rows;
  }

  function recognizerHeaderIndex(row) {
    const result = new Map();
    (row || []).forEach((value, index) => {
      const key = recognizerNormalizeHeader(value);
      if (key && !result.has(key)) result.set(key, index);
    });
    return result;
  }

  function recognizerFindExact(index, aliases) {
    for (const alias of aliases) {
      const found = index.get(recognizerNormalizeHeader(alias));
      if (found !== undefined) return found;
    }
    return -1;
  }

  function recognizerFindPrefix(index, aliases) {
    const expected = aliases.map(recognizerNormalizeHeader);
    for (const [value, column] of index.entries()) {
      if (expected.some(item =>
        value === item || value.startsWith(item + ' ') || value.startsWith(item + '(')
      )) return column;
    }
    return -1;
  }

  function recognizerFindContains(index, parts) {
    const expected = parts.map(recognizerNormalizeHeader);
    for (const [value, column] of index.entries()) {
      if (expected.every(part => value.includes(part))) return column;
    }
    return -1;
  }

  function recognizerNonEmpty(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  function recognizerCountRows(rows, startIndex, columns = null) {
    let count = 0;
    for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const values = Array.isArray(columns) && columns.length
        ? columns.map(column => row[column])
        : row;
      if (values.some(recognizerNonEmpty)) count += 1;
    }
    return count;
  }

  function recognizerConfidence(found, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(found / total * 100)));
  }

  function recognizerConfidenceLabel(value) {
    if (value >= 95) return 'Высокая';
    if (value >= 75) return 'Средняя';
    if (value > 0) return 'Низкая';
    return 'Нет';
  }

  function recognizerFreshness(from, to, source, field = null) {
    return {
      from: from || null,
      to: to || null,
      source: source || 'none',
      field: field || null
    };
  }

  function recognizerFinalize(base) {
    const datasetId = base.datasetId || recognizerDatasetId(base.classification);
    const definition = recognizerDefinition(datasetId);
    const validation = {
      status: base.validation?.status || 'invalid',
      errors: Array.from(base.validation?.errors || []),
      warnings: Array.from(base.validation?.warnings || [])
    };

    const normalizedRows = Number.isFinite(base.normalizedRows)
      ? base.normalizedRows
      : Number.isFinite(base.sourceRows)
        ? base.sourceRows
        : 0;

    if (definition && !definition.allowEmpty && normalizedRows === 0 &&
        !validation.errors.some(item => /пуст|строк|запис/i.test(item))) {
      validation.errors.push('Набор не содержит ни одной пригодной записи.');
    }

    if (validation.errors.length) validation.status = 'invalid';
    else if (validation.warnings.length) validation.status = 'warning';
    else validation.status = 'valid';

    const strategy = base.strategy || recognizerStrategy(datasetId);
    const ready = Boolean(
      datasetId &&
      definition &&
      definition.persisted !== false &&
      strategy &&
      strategy !== globalThis.ReclassifierDatabaseContract?.strategy?.DERIVED &&
      validation.status !== 'invalid'
    );

    return Object.freeze({
      classification: base.classification,
      datasetId,
      datasetTitle: definition?.title || base.classification?.label || 'Не распознано',
      datasetSchemaVersion: definition?.schemaVersion || null,
      strategy,
      confidence: Number.isFinite(base.confidence) ? base.confidence : 0,
      confidenceLabel: recognizerConfidenceLabel(base.confidence || 0),
      sheetName: base.sheetName || base.classification?.sheetName || null,
      headerRow: base.headerRow || base.classification?.headerRow || null,
      sourceRows: Number.isFinite(base.sourceRows) ? base.sourceRows : null,
      normalizedRows: Number.isFinite(base.normalizedRows) ? base.normalizedRows : null,
      freshness: base.freshness || recognizerFreshness(null, null, 'none'),
      validation: Object.freeze(validation),
      ready,
      readyLabel: ready
        ? (validation.status === 'warning' ? 'Готов с предупреждениями' : 'Готов к интеграции')
        : 'Не готов к интеграции',
      details: Object.freeze(base.details || {})
    });
  }

  function recognizerInspectItsm(workbook, classification) {
    const rows = recognizerRows(workbook, classification.sheetName);
    const headerRowIndex = Math.max(0, Number(classification.headerRow || 1) - 1);
    const header = rows[headerRowIndex] || [];
    const index = recognizerHeaderIndex(header);
    const fields = {
      created: recognizerFindPrefix(index, ['Дата создания Вызова']),
      completed: recognizerFindPrefix(index, ['Дата выполнения обращения']),
      closed: recognizerFindPrefix(index, ['Дата закрытия']),
      number: recognizerFindExact(index, ['Номер']),
      territory: recognizerFindExact(index, ['Территории MES', 'Территория MES']),
      equipment: recognizerFindExact(index, ['Наименование оборудования']),
      element: recognizerFindExact(index, ['Элемент']),
      fault: recognizerFindExact(index, ['Неисправность']),
      reason: recognizerFindExact(index, ['Причина инцидента']),
      shortDescription: recognizerFindExact(index, ['Категорированная информация обращения.Краткое описание']),
      description: recognizerFindExact(index, ['Категорированная информация обращения.Описание']),
      closureNote: recognizerFindExact(index, ['Примечания к разрешению', 'Примечание к закрытию', 'Примечания к закрытию']),
      openedBy: recognizerFindExact(index, ['Открыл']),
      slaWorking: recognizerFindContains(index, ['Измерение цели обслуживания', 'Прошло (рабочее время)']),
      closureCode: recognizerFindPrefix(index, ['Код закрытия'])
    };
    const requiredIds = Object.keys(fields);
    const missing = requiredIds.filter(id => fields[id] < 0);
    const presentColumns = requiredIds.map(id => fields[id]).filter(column => column >= 0);
    const errors = [];
    const warnings = [];
    const confidence = recognizerConfidence(requiredIds.length - missing.length, requiredIds.length);

    if (missing.length) {
      errors.push('Не найдена полная структура ITSM: отсутствуют обязательные поля (' + missing.join(', ') + ').');
    }

    const dataRows = [];
    const numberCounts = new Map();
    let blankKeys = 0;
    let invalidCreatedDates = 0;
    const createdValues = [];

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!presentColumns.some(column => recognizerNonEmpty(row[column]))) continue;
      dataRows.push(rowIndex);

      const number = fields.number >= 0 ? String(row[fields.number] ?? '').trim() : '';
      if (!number) blankKeys += 1;
      else numberCounts.set(number, (numberCounts.get(number) || 0) + 1);

      if (fields.created >= 0 && recognizerNonEmpty(row[fields.created])) {
        const iso = recognizerIsoDate(row[fields.created]);
        if (iso) createdValues.push(iso);
        else invalidCreatedDates += 1;
      }
    }

    const duplicateKeys = [...numberCounts.values()].filter(count => count > 1).length;
    if (!dataRows.length) errors.push('ITSM-выгрузка не содержит строк данных.');
    if (blankKeys) errors.push('Строк без устойчивого ключа «Номер»: ' + blankKeys + '.');
    if (duplicateKeys) errors.push('Повторяющихся значений ключа «Номер»: ' + duplicateKeys + '.');
    if (invalidCreatedDates) {
      warnings.push('Не распознана «Дата создания Вызова» в строках: ' + invalidCreatedDates + '.');
    }

    const range = recognizerDateRange(createdValues);
    if (!range.to && dataRows.length) {
      warnings.push('Свежесть ITSM не удалось определить по «Дата создания Вызова».');
    }

    return recognizerFinalize({
      classification,
      datasetId: 'itsm_data',
      confidence,
      sheetName: classification.sheetName,
      headerRow: headerRowIndex + 1,
      sourceRows: dataRows.length,
      normalizedRows: dataRows.length,
      freshness: recognizerFreshness(range.from, range.to, 'content', 'Дата создания Вызова'),
      validation: { errors, warnings },
      details: {
        missingRequiredFields: missing,
        blankKeys,
        duplicateKeys,
        invalidCreatedDates,
        // Used only during ITSM SQLite integration to stream matching MB tasks.
        requestKeys: Array.from(numberCounts.keys())
      }
    });
  }

  function recognizerInspectMobileBrigade(workbook, classification, fileName) {
    const rows = recognizerRows(workbook, classification.sheetName);
    const headerRowIndex = Math.max(0, Number(classification.headerRow || 1) - 1);
    const header = rows[headerRowIndex] || [];
    const index = recognizerHeaderIndex(header);

    const required = [
      ['Тип задачи', recognizerFindExact(index, ['Тип задачи'])],
      ['Фактическая дата', recognizerFindExact(index, ['Фактическая дата'])],
      ['Фактические трудозатраты', recognizerFindExact(index, ['Фактические трудозатраты'])]
    ];
    const identities = [
      ['Участок', recognizerFindExact(index, ['Участок'])],
      ['Заявка', recognizerFindExact(index, ['Заявка'])],
      ['Номер задачи', recognizerFindExact(index, ['Номер задачи'])]
    ];
    const requestUrlColumn = recognizerFindExact(index, ['Ссылка на заявку']);
    const missingRequired = required.filter(([, column]) => column < 0).map(([title]) => title);
    const hasIdentity = identities.some(([, column]) => column >= 0);
    const errors = [];
    const warnings = [];
    const scoreFound = (required.length - missingRequired.length) + (hasIdentity ? 1 : 0);
    const confidence = recognizerConfidence(scoreFound, required.length + 1);

    if (missingRequired.length) {
      errors.push('Не найдены обязательные поля МБ: ' + missingRequired.map(item => '«' + item + '»').join(', ') + '.');
    }
    if (!hasIdentity) {
      errors.push('Не найдено ни одного идентифицирующего поля МБ: «Участок», «Заявка» или «Номер задачи».');
    }

    const dataColumns = [
      ...required.map(([, column]) => column),
      ...identities.map(([, column]) => column),
      requestUrlColumn
    ].filter(column => column >= 0);

    const factDateColumn = required.find(([title]) => title === 'Фактическая дата')?.[1] ?? -1;
    const siteColumn = identities.find(([title]) => title === 'Участок')?.[1] ?? -1;
    const taskColumn = identities.find(([title]) => title === 'Номер задачи')?.[1] ?? -1;
    const records = [];
    const keys = new Map();
    const dates = [];
    let blankKeys = 0;
    let invalidFactDates = 0;

    for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!dataColumns.some(column => recognizerNonEmpty(row[column]))) continue;
      records.push(rowIndex);

      if (factDateColumn >= 0 && recognizerNonEmpty(row[factDateColumn])) {
        const iso = recognizerIsoDate(row[factDateColumn]);
        if (iso) dates.push(iso);
        else invalidFactDates += 1;
      }

      const site = siteColumn >= 0 ? String(row[siteColumn] ?? '').trim() : '';
      const taskNumber = taskColumn >= 0 ? String(row[taskColumn] ?? '').trim() : '';
      const requestUrl = requestUrlColumn >= 0 ? String(row[requestUrlColumn] ?? '').trim() : '';
      const key = globalThis.ReclassifierMobileBrigadeRules?.mobileBrigadeRecordKey
        ? globalThis.ReclassifierMobileBrigadeRules.mobileBrigadeRecordKey({ site, taskNumber, requestUrl })
        : (site && taskNumber ? site.toLocaleLowerCase('ru-RU') + '|' + taskNumber.toLocaleLowerCase('ru-RU') : '');

      if (!key) blankKeys += 1;
      else keys.set(key, (keys.get(key) || 0) + 1);
    }

    const duplicateKeys = [...keys.values()].filter(count => count > 1).length;
    if (!records.length) errors.push('Выгрузка МБ не содержит строк данных.');
    if (blankKeys) errors.push('Строк без устойчивого recordKey: ' + blankKeys + '.');
    if (duplicateKeys) warnings.push('Повторяющихся recordKey внутри файла: ' + duplicateKeys + '. Первое вхождение сохраняет исходный ключ; последующие получат суффиксы -D1, -D2 и далее при обработке МБ.');
    if (invalidFactDates) warnings.push('Не распознана «Фактическая дата» в строках: ' + invalidFactDates + '.');

    const range = recognizerDateRange(dates);
    if (!range.to && records.length) {
      warnings.push('Свежесть МБ не удалось определить по «Фактическая дата».');
    }

    const filePeriod = recognizerFilePeriod(fileName);
    if (range.to && filePeriod.to && range.to !== filePeriod.to) {
      warnings.push(
        'Дата в имени файла (' + filePeriod.to +
        ') не совпадает с максимальной «Фактической датой» в содержимом (' + range.to + ').'
      );
    }

    return recognizerFinalize({
      classification,
      datasetId: 'mobile_brigade_data',
      confidence,
      sheetName: classification.sheetName,
      headerRow: headerRowIndex + 1,
      sourceRows: records.length,
      normalizedRows: records.length,
      freshness: recognizerFreshness(range.from, range.to, 'content', 'Фактическая дата'),
      validation: { errors, warnings },
      details: {
        missingRequiredFields: missingRequired,
        blankKeys,
        duplicateKeys,
        invalidFactDates,
        fileNamePeriod: filePeriod
      }
    });
  }

  function recognizerReferenceNormalizer(datasetId) {
    const map = {
      reclassification: typeof normalizeReclassificationWorkbook === 'function' ? normalizeReclassificationWorkbook : null,
      drivers: typeof normalizeDriversWorkbook === 'function' ? normalizeDriversWorkbook : null,
      customers: typeof normalizeCustomersWorkbook === 'function' ? normalizeCustomersWorkbook : null,
      type_request: typeof normalizeTypeRequestWorkbook === 'function' ? normalizeTypeRequestWorkbook : null,
      initiators: typeof normalizeInitiatorsWorkbook === 'function' ? normalizeInitiatorsWorkbook : null,
      exceptions: typeof normalizeExceptionsWorkbook === 'function' ? normalizeExceptionsWorkbook : null,
      problem_grade: typeof normalizeProblemGradeWorkbook === 'function' ? normalizeProblemGradeWorkbook : null
    };
    return map[datasetId] || null;
  }

  function recognizerInspectReference(workbook, classification, datasetId) {
    const normalize = recognizerReferenceNormalizer(datasetId);
    if (!normalize) {
      return recognizerFinalize({
        classification,
        datasetId,
        confidence: 70,
        validation: {
          errors: ['Для Dataset не найден валидатор структуры.'],
          warnings: []
        }
      });
    }

    const instance = normalize(workbook);
    const records = Array.isArray(instance?.records) ? instance.records : [];
    const errors = Array.from(instance?.validation?.errors || []);
    const warnings = Array.from(instance?.validation?.warnings || []);
    let freshness = recognizerFreshness(null, null, 'not-applicable');

    if (datasetId === 'reclassification') {
      const completedDates = records.map(record => record?.dateCompleted).filter(Boolean);
      const range = recognizerDateRange(completedDates);
      freshness = recognizerFreshness(
        range.from,
        instance?.meta?.latestRequestDate || range.to,
        'content',
        'Дата выполнения обращения'
      );
      if (!freshness.to && records.length) {
        warnings.push('Свежесть Reclassification не удалось определить по «Дата выполнения обращения».');
      }
    }

    return recognizerFinalize({
      classification,
      datasetId,
      confidence: instance?.validation?.status === 'invalid' ? 85 : 100,
      sheetName: instance?.meta?.sourceSheet || classification.sheetName,
      headerRow: instance?.meta?.headerRow || classification.headerRow,
      sourceRows: Number.isFinite(instance?.meta?.sourceRows) ? instance.meta.sourceRows : records.length,
      normalizedRows: Number.isFinite(instance?.meta?.normalizedRows) ? instance.meta.normalizedRows : records.length,
      freshness,
      validation: { errors, warnings },
      details: {
        validationStatus: instance?.validation?.status || null
      }
    });
  }

  function recognizerInspectEquipment(workbook, classification, datasetId, fileName, fileSize) {
    if (typeof normalizeEquipmentWorkbook !== 'function') {
      return recognizerFinalize({
        classification,
        datasetId,
        confidence: 70,
        validation: { errors: ['Equipment validator недоступен.'], warnings: [] }
      });
    }

    const filePeriod = recognizerFilePeriod(fileName);
    const instance = normalizeEquipmentWorkbook(datasetId, workbook, {
      loadedAt: new Date().toISOString(),
      fileName,
      fileSize,
      freshness: filePeriod.to,
      schemaVersion: equipmentConfig?.[datasetId]?.schemaVersion || null,
      processingMs: null,
      sourceType: 'database-recognizer'
    });
    const errors = Array.from(instance?.validation?.errors || []);
    const warnings = Array.from(instance?.validation?.warnings || []);
    let freshness = recognizerFreshness(filePeriod.from, filePeriod.to, filePeriod.to ? 'filename-contract' : 'none');

    if (datasetId === 'zabbix') {
      const values = (instance.records || []).map(record => record?.zabbix__update).filter(Boolean);
      const range = recognizerDateRange(values);
      if (range.to) {
        freshness = recognizerFreshness(range.from, range.to, 'content', 'update');
        if (filePeriod.to && range.to !== filePeriod.to) {
          warnings.push(
            'Дата каталога в имени файла (' + filePeriod.to +
            ') не совпадает с максимальным «update» в содержимом (' + range.to + ').'
          );
        }
      }
    }

    return recognizerFinalize({
      classification,
      datasetId,
      confidence: instance?.validation?.status === 'invalid' ? 85 : 100,
      sheetName: instance?.meta?.sourceSheet || classification.sheetName,
      headerRow: classification.headerRow,
      sourceRows: instance?.meta?.sourceRows,
      normalizedRows: instance?.meta?.normalizedRows,
      freshness,
      validation: { errors, warnings },
      details: {
        duplicateIds: instance?.meta?.duplicateIds || 0,
        duplicateJoinKeys: instance?.meta?.duplicateJoinKeys || 0,
        invalidNotWorkingSince: instance?.meta?.invalidNotWorkingSince || 0
      }
    });
  }

  function recognizerInspectFailureClassifier(workbook, classification) {
    if (typeof normalizeFailureClassifierWorkbook !== 'function') {
      return recognizerFinalize({
        classification,
        datasetId: 'failure_classifier',
        confidence: 70,
        validation: { errors: ['Валидатор классификатора отказов недоступен.'], warnings: [] }
      });
    }

    let instance;
    try {
      instance = normalizeFailureClassifierWorkbook(workbook);
    } catch (error) {
      return recognizerFinalize({
        classification,
        datasetId: 'failure_classifier',
        confidence: 60,
        validation: { errors: [error?.message || String(error)], warnings: [] }
      });
    }

    const errors = Array.from(instance?.validation?.errors || []);
    const warnings = Array.from(instance?.validation?.warnings || []);
    const latest = instance?.meta?.latestChangedAt || null;

    return recognizerFinalize({
      classification,
      datasetId: 'failure_classifier',
      confidence: instance?.validation?.status === 'invalid' ? 85 : 100,
      sheetName: instance?.meta?.sourceSheet || classification.sheetName,
      headerRow: instance?.meta?.headerRow || classification.headerRow,
      sourceRows: instance?.meta?.candidateRows ?? instance?.meta?.sourceRows,
      normalizedRows: instance?.meta?.normalizedRows ?? instance?.records?.length ?? 0,
      freshness: recognizerFreshness(null, latest, latest ? 'content' : 'none', 'Дата изменения'),
      validation: { errors, warnings },
      details: {
        format: instance?.meta?.formatLabel || null,
        filteredRows: instance?.meta?.filteredRows || 0,
        afterFiltersRows: instance?.meta?.afterFiltersRows ??
          ((instance?.meta?.normalizedRows || 0) + (instance?.meta?.duplicatesRemoved || 0)),
        duplicatesRemoved: instance?.meta?.duplicatesRemoved || 0
      }
    });
  }

  function recognizerInspectWorkbook(workbook, fileMeta = {}) {
    let classification;
    try {
      const classifier = globalThis.ReclassifierDatasetClassifier;
      if (!classifier?.classifyWorkbook) {
        throw new Error('Dataset Classifier недоступен.');
      }
      classification = classifier.classifyWorkbook(workbook);
    } catch (error) {
      classification = {
        id: 'read_error',
        group: 'Ошибка распознавания',
        label: 'Ошибка распознавания',
        reason: error?.message || String(error)
      };
    }

    if (classification.id === 'unknown') {
      return recognizerFinalize({
        classification,
        confidence: 0,
        validation: {
          errors: ['Не найдена известная структура Dataset.'],
          warnings: []
        }
      });
    }

    if (classification.id === 'read_error') {
      return recognizerFinalize({
        classification,
        confidence: 0,
        validation: {
          errors: [classification.reason || 'Ошибка чтения Excel.'],
          warnings: []
        }
      });
    }

    if (classification.id === 'itsm') {
      return recognizerInspectItsm(workbook, classification);
    }
    if (classification.id === 'mobile_brigade') {
      return recognizerInspectMobileBrigade(workbook, classification, fileMeta.fileName);
    }
    if (classification.id === 'failure_classifier') {
      return recognizerInspectFailureClassifier(workbook, classification);
    }
    if (classification.id.startsWith('equipment:')) {
      return recognizerInspectEquipment(
        workbook,
        classification,
        classification.id.slice('equipment:'.length),
        fileMeta.fileName,
        fileMeta.fileSize
      );
    }

    const datasetId = recognizerDatasetId(classification);
    if (datasetId) {
      return recognizerInspectReference(workbook, classification, datasetId);
    }

    return recognizerFinalize({
      classification,
      confidence: 40,
      validation: {
        errors: ['Структура распознана, но Dataset не зарегистрирован в Database Contract.'],
        warnings: []
      }
    });
  }

  async function recognizerInspectFile(file) {
    if (!window.XLSX) throw new Error('Excel parser XLSX не включён в сборку.');
    const trace = globalThis.ReclassifierDatabaseMemoryDiagnostics;
    trace?.mark?.('recognizer-read','start',{inputBytes:file.size});
    const bytes = await file.arrayBuffer();
    trace?.mark?.('recognizer-read','end',{inputBytes:bytes.byteLength});
    trace?.mark?.('recognizer-xlsx','start',{inputBytes:bytes.byteLength});
    const workbook = window.XLSX.read(bytes, {
      type: 'array',
      cellDates: true,
      cellFormula: true,
      // Large task exports should not allocate a sparse cell-address object.
      dense: true
    });
    trace?.mark?.('recognizer-xlsx','end',{inputBytes:bytes.byteLength,
      sheetCount:workbook.SheetNames?.length||0});
    trace?.mark?.('recognizer-inspection','start');
    const inspection = recognizerInspectWorkbook(workbook, {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified
    });
    trace?.mark?.('recognizer-inspection','end',
      {rows:inspection.sourceRows||0,ready:inspection.ready?1:0});
    return inspection;
  }

  globalThis.ReclassifierDatasetRecognizer = Object.freeze({
    inspectFile: recognizerInspectFile,
    inspectWorkbook: recognizerInspectWorkbook,
    datasetId: recognizerDatasetId,
    isoDate: recognizerIsoDate
  });
