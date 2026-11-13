  function classifierNormalizeHeader(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function classifierNormalizeText(value, stats = null) {
    if (value === null || value === undefined) return null;
    const raw = String(value).replace(/\u00a0/g, ' ');
    const normalized = raw.trim();
    if (stats && normalized !== raw) stats.normalizedTextCells += 1;
    return normalized === '' ? null : normalized;
  }

  function classifierNormalizeDate(value) {
    if (value === null || value === undefined || value === '') return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getFullYear() + '-' +
        String(value.getMonth() + 1).padStart(2, '0') + '-' +
        String(value.getDate()).padStart(2, '0');
    }

    if (typeof value === 'number' && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return String(parsed.y).padStart(4, '0') + '-' +
          String(parsed.m).padStart(2, '0') + '-' +
          String(parsed.d).padStart(2, '0');
      }
    }

    const text = classifierNormalizeText(value);
    if (!text) return null;

    let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      return String(year).padStart(4, '0') + '-' +
        String(Number(match[2])).padStart(2, '0') + '-' +
        String(Number(match[1])).padStart(2, '0');
    }

    match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[1] + '-' + match[2] + '-' + match[3];

    return text;
  }

  const FAILURE_CLASSIFIER_WORKING_FIELDS = Object.freeze({
    service: 'Услуга',
    equipment: 'Наименование оборудования',
    element: 'Элемент',
    failure: 'Неисправность',
    cause: 'Причина',
    disabled: 'Деактивирована',
    sadu: 'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"',
    changedAt: 'Дата изменения'
  });

  const FAILURE_CLASSIFIER_SYSTEM_FIELDS = Object.freeze({
    service: 'Неисправность.Элемент.Наименование оборудования.Услуга',
    equipment: 'Неисправность.Элемент.Наименование оборудования',
    element: 'Неисправность.Элемент',
    failure: 'Неисправность',
    cause: 'Название',
    disabled: 'Деактивирована',
    sadu: 'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"',
    changedAt: 'Дата изменения'
  });

  const FAILURE_CLASSIFIER_WORKING_REQUIRED = Object.freeze([
    'Услуга',
    'Наименование оборудования',
    'Элемент',
    'Неисправность',
    'Причина',
    'Деактивирована',
    'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"'
  ]);

  const FAILURE_CLASSIFIER_SYSTEM_REQUIRED = Object.freeze([
    'Неисправность.Элемент.Наименование оборудования.Услуга',
    'Неисправность.Элемент.Наименование оборудования',
    'Неисправность.Элемент',
    'Неисправность',
    'Название',
    'Деактивирована',
    'Неисправность.Элемент.Наименование оборудования.Услуга "САДУ"'
  ]);

  const FAILURE_CLASSIFIER_ALLOWED_SERVICES = Object.freeze(new Set([
    classifierNormalizeHeader(FAILURE_CLASSIFIER_OGR_SERVICE),
    classifierNormalizeHeader('Открытые горные работы'),
    classifierNormalizeHeader('ОГР'),
    classifierNormalizeHeader('OGR')
  ]));

  function classifierHeaderIndex(headerRow) {
    const map = new Map();
    headerRow.forEach((value, index) => {
      const key = classifierNormalizeHeader(value);
      if (key && !map.has(key)) map.set(key, index);
    });
    return map;
  }

  function classifierHasHeaders(index, required) {
    return required.every(header => index.has(classifierNormalizeHeader(header)));
  }

  function classifierDetectWorkbook(workbook) {
    const candidates = [];
    for (const sheetName of workbook.SheetNames || []) {
      const sheet = workbook.Sheets?.[sheetName];
      if (!sheet) continue;

      const rows = window.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: null,
        raw: true,
        blankrows: false
      });

      const maxHeaderRows = Math.min(rows.length, 20);
      for (let rowIndex = 0; rowIndex < maxHeaderRows; rowIndex += 1) {
        const headerRow = rows[rowIndex] || [];
        const index = classifierHeaderIndex(headerRow);
        const working = classifierHasHeaders(index, FAILURE_CLASSIFIER_WORKING_REQUIRED);
        const system = classifierHasHeaders(index, FAILURE_CLASSIFIER_SYSTEM_REQUIRED);
        if (!working && !system) continue;

        candidates.push({
          sheetName,
          headerRowIndex: rowIndex,
          rows,
          headerRow,
          headerIndex: index,
          format: working ? 'working' : 'system',
          formatLabel: working ? 'Рабочий классификатор' : 'Системная выгрузка'
        });
      }
    }

    if (!candidates.length) {
      throw new Error(
        'Формат классификатора не распознан. Для обработки обязательны поля услуги, оборудования, элемента, ' +
        'неисправности, причины, признака «Деактивирована» и признака САДУ.'
      );
    }

    candidates.sort((a, b) => {
      if (a.format !== b.format) return a.format === 'working' ? -1 : 1;
      if (a.sheetName === 'Полные данные') return -1;
      if (b.sheetName === 'Полные данные') return 1;
      return a.headerRowIndex - b.headerRowIndex;
    });

    return candidates[0];
  }

  function classifierFieldRawValue(row, headerIndex, sourceHeader) {
    if (!sourceHeader) return null;
    const columnIndex = headerIndex.get(classifierNormalizeHeader(sourceHeader));
    if (columnIndex === undefined) return null;
    return row[columnIndex];
  }

  function classifierFieldValue(row, headerIndex, sourceHeader, stats) {
    return classifierNormalizeText(classifierFieldRawValue(row, headerIndex, sourceHeader), stats);
  }

  function classifierServiceAllowed(value) {
    const normalized = classifierNormalizeHeader(value);
    return !normalized || FAILURE_CLASSIFIER_ALLOWED_SERVICES.has(normalized);
  }

  function classifierNegativeFlagState(value) {
    const normalized = classifierNormalizeHeader(value);
    if (!normalized || ['нет', 'no', 'false', '0'].includes(normalized)) return 'allow';
    if (['да', 'yes', 'true', '1'].includes(normalized)) return 'exclude';
    return 'unknown';
  }

  function classifierUniqueTextCount(records, field, includeEmpty = false) {
    const keys = new Set();
    for (const record of records) {
      const normalized = classifierNormalizeHeader(record[field]);
      if (normalized || includeEmpty) keys.add(normalized || '__EMPTY__');
    }
    return keys.size;
  }

  function classifierTextRecordKey(record) {
    // Collision-safe composite key: text fields are individually normalized.
    // Original display strings in the first encountered record are preserved.
    return JSON.stringify(failureClassifierConfig.deduplication.fields.map(
      field => classifierNormalizeHeader(record[field])
    ));
  }

  function normalizeFailureClassifierWorkbook(workbook) {
    if (!window.XLSX?.utils?.sheet_to_json) {
      throw new Error('Excel parser XLSX не включён в сборку.');
    }

    const detected = classifierDetectWorkbook(workbook);
    const fields = detected.format === 'working'
      ? FAILURE_CLASSIFIER_WORKING_FIELDS
      : FAILURE_CLASSIFIER_SYSTEM_FIELDS;
    const stats = {
      normalizedTextCells: 0,
      candidateRows: 0,
      filteredServiceRows: 0,
      filteredDeactivatedRows: 0,
      filteredSaduRows: 0,
      filteredUnknownDeactivatedRows: 0,
      filteredUnknownSaduRows: 0
    };
    const records = [];
    const seenTextRecords = new Set();
    let duplicatesRemoved = 0;
    const sourceDates = [];

    for (let rowIndex = detected.headerRowIndex + 1; rowIndex < detected.rows.length; rowIndex += 1) {
      const row = detected.rows[rowIndex] || [];
      const source = {
        service: classifierFieldValue(row, detected.headerIndex, fields.service, stats),
        equipment: classifierFieldValue(row, detected.headerIndex, fields.equipment, stats),
        element: classifierFieldValue(row, detected.headerIndex, fields.element, stats),
        failure: classifierFieldValue(row, detected.headerIndex, fields.failure, stats),
        cause: classifierFieldValue(row, detected.headerIndex, fields.cause, stats),
        disabled: classifierFieldValue(row, detected.headerIndex, fields.disabled, stats),
        sadu: classifierFieldValue(row, detected.headerIndex, fields.sadu, stats),
        changedAt: classifierNormalizeDate(classifierFieldRawValue(row, detected.headerIndex, fields.changedAt))
      };

      const hasCoreData = source.service || source.equipment || source.element || source.failure || source.cause;
      if (!hasCoreData) continue;

      stats.candidateRows += 1;
      if (/^\d{4}-\d{2}-\d{2}$/.test(source.changedAt || '')) sourceDates.push(source.changedAt);

      if (!classifierServiceAllowed(source.service)) {
        stats.filteredServiceRows += 1;
        continue;
      }

      const disabledState = classifierNegativeFlagState(source.disabled);
      if (disabledState === 'exclude') {
        stats.filteredDeactivatedRows += 1;
        continue;
      }
      if (disabledState === 'unknown') {
        stats.filteredUnknownDeactivatedRows += 1;
        continue;
      }

      const saduState = classifierNegativeFlagState(source.sadu);
      if (saduState === 'exclude') {
        stats.filteredSaduRows += 1;
        continue;
      }
      if (saduState === 'unknown') {
        stats.filteredUnknownSaduRows += 1;
        continue;
      }

      const record = {
        service: source.service,
        equipment: source.equipment,
        element: source.element,
        failure: source.failure,
        cause: source.cause
      };
      if (failureClassifierConfig.deduplication.enabled) {
        const key = classifierTextRecordKey(record);
        if (seenTextRecords.has(key)) {
          duplicatesRemoved += 1;
          continue;
        }
        seenTextRecords.add(key);
      }
      records.push(record);
    }

    if (!failureClassifierConfig.allowEmpty && !stats.candidateRows) {
      throw new Error('В распознанном листе нет строк классификатора.');
    }
    if (!failureClassifierConfig.allowEmpty && !records.length) {
      throw new Error('После применения фильтров не осталось строк рабочего классификатора.');
    }

    const warnings = [];
    const errors = [];

    if (stats.filteredUnknownDeactivatedRows) {
      warnings.push(
        'Исключены строки с неизвестным значением «Деактивирована»: ' +
        stats.filteredUnknownDeactivatedRows + '.'
      );
    }
    if (stats.filteredUnknownSaduRows) {
      warnings.push(
        'Исключены строки с неизвестным значением признака САДУ: ' +
        stats.filteredUnknownSaduRows + '.'
      );
    }

    const incompleteRows = records.filter(record =>
      !record.equipment || !record.element || !record.failure || !record.cause
    ).length;
    if (incompleteRows) {
      warnings.push(
        'В рабочем наборе есть строки с пустым оборудованием / элементом / неисправностью / причиной: ' +
        incompleteRows + '.'
      );
    }

    const latestChangedAt = sourceDates.length ? sourceDates.sort().at(-1) : null;
    const filteredRows =
      stats.filteredServiceRows +
      stats.filteredDeactivatedRows +
      stats.filteredSaduRows +
      stats.filteredUnknownDeactivatedRows +
      stats.filteredUnknownSaduRows;

    return {
      records,
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      },
      meta: {
        schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION,
        format: detected.format,
        formatLabel: detected.formatLabel,
        sourceSheet: detected.sheetName,
        headerRow: detected.headerRowIndex + 1,
        sourceRows: Math.max(0, detected.rows.length - detected.headerRowIndex - 1),
        candidateRows: stats.candidateRows,
        normalizedRows: records.length,
        afterFiltersRows: records.length + duplicatesRemoved,
        duplicatesRemoved,
        filteredRows,
        filteredServiceRows: stats.filteredServiceRows,
        filteredDeactivatedRows: stats.filteredDeactivatedRows,
        filteredSaduRows: stats.filteredSaduRows,
        filteredUnknownDeactivatedRows: stats.filteredUnknownDeactivatedRows,
        filteredUnknownSaduRows: stats.filteredUnknownSaduRows,
        normalizedTextCells: stats.normalizedTextCells,
        sourceHeaders: detected.headerRow.filter(value => classifierNormalizeText(value)),
        latestChangedAt,
        serviceCount: classifierUniqueTextCount(records, 'service', true),
        equipmentCount: classifierUniqueTextCount(records, 'equipment'),
        elementCount: classifierUniqueTextCount(records, 'element'),
        failureCount: classifierUniqueTextCount(records, 'failure'),
        causeCount: classifierUniqueTextCount(records, 'cause'),
        duplicateTextRows: 0,
        incompleteRows
      }
    };
  }
