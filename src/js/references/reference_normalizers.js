// FILE CONTRACT: pure workbook-to-Reference normalization library.
// Purpose: detect known Reference tables, normalize source cells and return records/meta/validation.
// Owns: Reference-specific workbook structure rules and data cleaning.
// Reads: workbook objects plus schema constants from reference_config.
// Writes: nothing; returns normalized candidates only.
// Public API: normalizer functions consumed by Reference Manager and Database Integration.
// Must not: render UI, commit Dataset state or access SQLite.
// Related tests: test_reference_architecture.py, test_reference_baseline_contract.py,
//                test_database_recognizer.js, test_architecture_guardrails.py.

// ============================================================================
// SHARED NORMALIZATION PRIMITIVES
// ============================================================================
  function normalizeReferenceHeader(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  }

  function normalizeReferenceText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\u00a0/g, ' ').trim();
    return text === '' ? null : text;
  }

  function normalizeOptionalReferenceText(value) {
    const text = normalizeReferenceText(value);
    if (!text || /^\?+$/.test(text)) return null;
    return text;
  }

  function normalizeExcelDate(value) {
    if (value === null || value === undefined || value === '') return { value: null, state: 'empty' };

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return { value: year + '-' + month + '-' + day, state: 'value' };
    }

    if (typeof value === 'number' && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return {
          value: String(parsed.y).padStart(4, '0') + '-' + String(parsed.m).padStart(2, '0') + '-' + String(parsed.d).padStart(2, '0'),
          state: 'value'
        };
      }
    }

    const text = normalizeReferenceText(value);
    if (!text) return { value: null, state: 'empty' };

    let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      const month = Number(match[2]);
      const day = Number(match[1]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return { value: String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'), state: 'value' };
      }
    }

    match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return { value: match[1] + '-' + match[2] + '-' + match[3], state: 'value' };

    return { value: text, state: 'invalid' };
  }

  function cleanMineName(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:р\.|ш\.)\s*/i, '');
  }

  function normalizeDriversValue(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') {
      return { value: null, unit: null, state: 'empty' };
    }
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return { value: rawValue, unit: 'шт', state: 'value' };
    }
    const text = String(rawValue).trim();
    if (text === '-') return { value: null, unit: null, state: 'dash' };

    const km = text.match(/^(\d+(?:[.,]\d+)?)\s*км$/i);
    if (km) return { value: Number(km[1].replace(',', '.')), unit: 'км', state: 'value' };

    const numeric = text.replace(',', '.');
    if (/^-?\d+(?:\.\d+)?$/.test(numeric)) {
      return { value: Number(numeric), unit: 'шт', state: 'value' };
    }
    return { value: text, unit: null, state: 'text' };
  }

// ============================================================================
// TYPE REQUEST
// ============================================================================
  function findTypeRequestTable(workbook) {
    const shortAliases = TYPE_REQUEST_SCHEMA.headerAliases.shortDescription.map(normalizeReferenceHeader);
    const workTypeHeader = normalizeReferenceHeader('Вид работ');

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        const shortDescriptionColumn = normalizedHeader.findIndex(header => shortAliases.includes(header));
        const workTypeColumn = normalizedHeader.indexOf(workTypeHeader);

        if (shortDescriptionColumn >= 0 && workTypeColumn >= 0) {
          return {
            sheetName,
            rows,
            headerRowIndex: rowIndex,
            positions: { shortDescriptionColumn, workTypeColumn }
          };
        }
      }
    }

    return null;
  }

  function normalizeTypeRequestWorkbook(workbook) {
    const match = findTypeRequestTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат TypeRequest. Ожидаются колонки «Краткое описание (типовой запрос)» и «Вид работ». Также принимается заголовок «Краткое описание».'],
          warnings: []
        }
      };
    }

    const warnings = [];
    const errors = [];
    const { shortDescriptionColumn, workTypeColumn } = match.positions;
    const recordsBySignature = new Map();
    const workTypesByRequestKey = new Map();
    let sourceRows = 0;
    let skippedWithoutDescription = 0;
    let skippedWithoutWorkType = 0;
    let exactDuplicateRows = 0;

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const rawDescription = row[shortDescriptionColumn];
      const rawWorkType = row[workTypeColumn];

      if ([rawDescription, rawWorkType].every(value =>
        value === null || value === undefined || String(value).trim() === ''
      )) continue;

      sourceRows += 1;
      const shortDescription = normalizeOptionalReferenceText(rawDescription);
      const workType = normalizeOptionalReferenceText(rawWorkType);

      if (!shortDescription) {
        skippedWithoutDescription += 1;
        continue;
      }
      if (!workType) {
        skippedWithoutWorkType += 1;
        continue;
      }

      const requestKey = normalizeReferenceHeader(shortDescription);
      const record = {
        requestKey,
        shortDescription,
        workType,
        sourceSheet: match.sheetName,
        sourceRows: [rowIndex + 1],
        sourceRow: rowIndex + 1
      };

      const signature = JSON.stringify([requestKey, workType]);
      if (recordsBySignature.has(signature)) {
        exactDuplicateRows += 1;
        recordsBySignature.get(signature).sourceRows.push(rowIndex + 1);
      } else {
        recordsBySignature.set(signature, record);
      }

      if (!workTypesByRequestKey.has(requestKey)) workTypesByRequestKey.set(requestKey, new Set());
      workTypesByRequestKey.get(requestKey).add(workType);
    }

    const conflicts = [...workTypesByRequestKey.entries()]
      .filter(([, workTypes]) => workTypes.size > 1);

    if (skippedWithoutDescription) {
      warnings.push('Строк без краткого описания: ' + skippedWithoutDescription + '. Они пропущены, остальные данные приняты.');
    }
    if (skippedWithoutWorkType) {
      warnings.push('Строк без «Вид работ»: ' + skippedWithoutWorkType + '. Они пропущены, остальные данные приняты.');
    }
    if (conflicts.length) {
      const examples = conflicts.slice(0, 5).map(([requestKey, workTypes]) =>
        '«' + requestKey + '» → ' + [...workTypes].join(', ')
      ).join('; ');
      warnings.push(
        'Одно краткое описание сопоставлено с несколькими видами работ: ' + conflicts.length +
        '. Все варианты сохранены без автоматического выбора. ' + examples + (conflicts.length > 5 ? '; …' : '') + '.'
      );
    }

    const records = [...recordsBySignature.values()].sort((left, right) => {
      const typeOrder = left.workType.localeCompare(right.workType, 'ru');
      if (typeOrder !== 0) return typeOrder;
      return left.shortDescription.localeCompare(right.shortDescription, 'ru');
    });

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        patternCount: new Set(records.map(record => record.requestKey)).size,
        workTypeCount: new Set(records.map(record => normalizeReferenceHeader(record.workType))).size,
        exactDuplicateRows,
        skippedWithoutDescription,
        skippedWithoutWorkType,
        conflictCount: conflicts.length,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// CUSTOMERS
// ============================================================================
  function findCustomersTable(workbook) {
    const mineHeader = normalizeReferenceHeader('Рудник');
    const shortHeader = normalizeReferenceHeader('Заказчик кратко');
    const fullHeader = normalizeReferenceHeader('Заказчик полностью');
    const internalAliases = CUSTOMERS_SCHEMA.headerAliases.customerInternal.map(normalizeReferenceHeader);

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        const mineColumn = normalizedHeader.indexOf(mineHeader);
        const internalColumn = normalizedHeader.findIndex(header => internalAliases.includes(header));
        const shortColumn = normalizedHeader.indexOf(shortHeader);
        const fullColumn = normalizedHeader.indexOf(fullHeader);

        if ([mineColumn, internalColumn, shortColumn, fullColumn].every(position => position >= 0)) {
          return {
            sheetName,
            rows,
            headerRowIndex: rowIndex,
            positions: { mineColumn, internalColumn, shortColumn, fullColumn }
          };
        }
      }
    }

    return null;
  }

  function normalizeCustomersWorkbook(workbook) {
    const match = findCustomersTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат Customers. Ожидаются колонки «Рудник», «Заказчик (для нас)», «Заказчик кратко», «Заказчик полностью». Также принимается старый заголовок «Заказчик».'],
          warnings: []
        }
      };
    }

    const warnings = [];
    const errors = [];
    const { mineColumn, internalColumn, shortColumn, fullColumn } = match.positions;
    const recordsBySignature = new Map();
    const mappingsByMine = new Map();
    let sourceRows = 0;
    let skippedWithoutMine = 0;
    let exactDuplicateRows = 0;

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const rawValues = [row[mineColumn], row[internalColumn], row[shortColumn], row[fullColumn]];
      if (rawValues.every(value => value === null || value === undefined || String(value).trim() === '')) continue;

      sourceRows += 1;
      const mineSource = normalizeOptionalReferenceText(row[mineColumn]);
      if (!mineSource) {
        skippedWithoutMine += 1;
        continue;
      }

      const mine = cleanMineName(mineSource);
      const mineKey = normalizeReferenceHeader(mine);
      const customerInternal = normalizeOptionalReferenceText(row[internalColumn]);
      const customerShort = normalizeOptionalReferenceText(row[shortColumn]);
      const customerFull = normalizeOptionalReferenceText(row[fullColumn]);

      const record = {
        mine,
        mineSource,
        mineKey,
        customerInternal,
        customerCode: customerInternal,
        customerShort,
        customerFull,
        sourceSheet: match.sheetName,
        sourceRows: [rowIndex + 1],
        sourceRow: rowIndex + 1
      };

      const signature = JSON.stringify([mineKey, customerInternal, customerShort, customerFull]);
      if (recordsBySignature.has(signature)) {
        exactDuplicateRows += 1;
        recordsBySignature.get(signature).sourceRows.push(rowIndex + 1);
      } else {
        recordsBySignature.set(signature, record);
      }

      if (!mappingsByMine.has(mineKey)) mappingsByMine.set(mineKey, new Set());
      mappingsByMine.get(mineKey).add(JSON.stringify([customerInternal, customerShort, customerFull]));
    }

    const mineConflicts = [...mappingsByMine.entries()].filter(([, mappings]) => {
      const nonEmptyMappings = [...mappings].map(item => JSON.parse(item)).filter(parts => parts.some(Boolean));
      return new Set(nonEmptyMappings.map(parts => JSON.stringify(parts))).size > 1;
    });

    if (skippedWithoutMine) {
      warnings.push('Строк без значения «Рудник»: ' + skippedWithoutMine + '. Они пропущены, остальные данные приняты.');
    }
    if (mineConflicts.length) {
      warnings.push('Один рудник привязан к нескольким различным заказчикам: ' + mineConflicts.length + '. Данные сохранены без автоматического выбора.');
    }

    const records = [...recordsBySignature.values()].sort((left, right) =>
      left.mine.localeCompare(right.mine, 'ru')
    );

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        mineCount: new Set(records.map(record => record.mineKey)).size,
        internalCustomerCount: new Set(records.map(record => normalizeReferenceHeader(record.customerInternal || '')).filter(Boolean)).size,
        customerCount: new Set(records.map(record => normalizeReferenceHeader(record.customerShort || record.customerFull || '')).filter(Boolean)).size,
        exactDuplicateRows,
        skippedWithoutMine,
        mineConflictCount: mineConflicts.length,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// RECLASSIFICATION
// ============================================================================
  function findReclassificationTable(workbook) {
    const anchors = RECLASSIFICATION_SCHEMA.anchorHeaders.map(normalizeReferenceHeader);

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        if (!anchors.every(header => normalizedHeader.includes(header))) continue;

        const positions = {};
        for (const [id, title] of RECLASSIFICATION_SCHEMA.columns) {
          positions[id] = normalizedHeader.indexOf(normalizeReferenceHeader(title));
        }
        // Existing Re-Class workbooks in the user database have the previous header.
        if (positions.closureNote < 0) {
          const aliases = ['Примечание к закрытию', 'Примечания к закрытию', 'Примечания к разрешению']
            .map(normalizeReferenceHeader);
          positions.closureNote = normalizedHeader.findIndex(value => aliases.includes(value));
        }
        return { sheetName, rows, headerRowIndex: rowIndex, positions };
      }
    }

    return null;
  }

  function normalizeReclassificationWorkbook(workbook) {
    const match = findReclassificationTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат Reclassification: обязательны колонки «Дата регистрации», «Дата выполнения обращения» и «Номер».'],
          warnings: []
        }
      };
    }

    const errors = [];
    const warnings = [];
    const missingHeaders = RECLASSIFICATION_SCHEMA.columns
      .filter(([id]) => match.positions[id] < 0)
      .map(([, title]) => title);

    if (missingHeaders.length) {
      warnings.push('Не найдены необязательные колонки: ' + missingHeaders.map(item => '«' + item + '»').join(', ') + '. Они будут заполнены пустыми значениями.');
    }

    const records = [];
    const numberCounts = new Map();
    let sourceRows = 0;
    let missingNumberCount = 0;
    let invalidRegisteredDates = 0;
    let invalidCompletedDates = 0;
    let latestRequestDate = null;

    const getCell = (row, id) => {
      const index = match.positions[id];
      return index >= 0 ? row[index] : null;
    };

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const hasAnyValue = Object.values(match.positions)
        .filter(index => index >= 0)
        .some(index => row[index] !== null && row[index] !== undefined && String(row[index]).trim() !== '');
      if (!hasAnyValue) continue;

      sourceRows += 1;
      const registered = normalizeExcelDate(getCell(row, 'dateRegistered'));
      const completed = normalizeExcelDate(getCell(row, 'dateCompleted'));
      const number = normalizeReferenceText(getCell(row, 'number'));

      if (registered.state === 'invalid') invalidRegisteredDates += 1;
      if (completed.state === 'invalid') invalidCompletedDates += 1;
      if (!number) missingNumberCount += 1;
      else numberCounts.set(number, (numberCounts.get(number) || 0) + 1);

      if (completed.state === 'value' && (!latestRequestDate || completed.value > latestRequestDate)) {
        latestRequestDate = completed.value;
      }

      records.push({
        dateRegistered: registered.state === 'value' ? registered.value : null,
        dateCompleted: completed.state === 'value' ? completed.value : null,
        territory: normalizeReferenceText(getCell(row, 'territory')),
        number,
        equipment: normalizeReferenceText(getCell(row, 'equipment')),
        element: normalizeReferenceText(getCell(row, 'element')),
        fault: normalizeReferenceText(getCell(row, 'fault')),
        incidentReason: normalizeReferenceText(getCell(row, 'incidentReason')),
        description: normalizeReferenceText(getCell(row, 'description')),
        closureNote: normalizeReferenceText(getCell(row, 'closureNote')),
        sourceSheet: match.sheetName,
        sourceRow: rowIndex + 1
      });
    }

    records.sort((left, right) => {
      const leftCompleted = left.dateCompleted || '9999-12-31';
      const rightCompleted = right.dateCompleted || '9999-12-31';
      if (leftCompleted !== rightCompleted) return leftCompleted.localeCompare(rightCompleted);

      const leftRegistered = left.dateRegistered || '9999-12-31';
      const rightRegistered = right.dateRegistered || '9999-12-31';
      if (leftRegistered !== rightRegistered) return leftRegistered.localeCompare(rightRegistered);

      return left.sourceRow - right.sourceRow;
    });

    const duplicateNumbers = [...numberCounts.entries()].filter(([, count]) => count > 1);
    if (missingNumberCount) {
      warnings.push('Строк без значения «Номер»: ' + missingNumberCount + '. Строки сохранены, справочник не отклонён.');
    }
    if (duplicateNumbers.length) {
      warnings.push('Повторяющихся значений «Номер»: ' + duplicateNumbers.length + '. Данные сохранены без удаления дублей.');
    }
    if (invalidRegisteredDates) {
      warnings.push('Не распознано значений «Дата регистрации»: ' + invalidRegisteredDates + '. Они сохранены как пустая нормализованная дата.');
    }
    if (invalidCompletedDates) {
      warnings.push('Не распознано значений «Дата выполнения обращения»: ' + invalidCompletedDates + '. Они не участвуют в расчёте свежести.');
    }

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        latestRequestDate,
        freshnessField: 'Дата выполнения обращения',
        sortField: 'Дата выполнения обращения',
        sortDirection: 'asc',
        missingNumberCount,
        duplicateNumberCount: duplicateNumbers.length
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// INITIATORS
// ============================================================================
  function findInitiatorsTable(workbook) {
    const required = INITIATORS_SCHEMA.requiredHeaders.map(normalizeReferenceHeader);

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        const positions = required.map(header => normalizedHeader.indexOf(header));
        if (positions.every(position => position >= 0)) {
          return { sheetName, rows, headerRowIndex: rowIndex, positions };
        }
      }
    }

    return null;
  }

  function normalizeInitiatorsWorkbook(workbook) {
    const match = findInitiatorsTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат Initiators. Ожидаются колонки: «Инициатор (открыл)», «Группа инициаторов», «Группа инициаторов с коментами», «комменты».'],
          warnings: []
        }
      };
    }

    const errors = [];
    const warnings = [];
    const [initiatorColumn, groupColumn, detailedColumn, commentsColumn] = match.positions;
    const merged = new Map();
    let sourceRows = 0;
    let rowsWithoutInitiator = 0;
    let unknownMarkerCount = 0;
    let mergedDuplicateRows = 0;
    const conflicts = [];

    const normalizedValue = raw => {
      const text = normalizeReferenceText(raw);
      if (!text) return null;
      if (/^\?+$/.test(text)) {
        unknownMarkerCount += 1;
        return null;
      }
      return text;
    };

    const mergeField = (target, field, incoming, initiator, sourceRow) => {
      if (!incoming) return;
      if (!target[field]) {
        target[field] = incoming;
        return;
      }
      if (target[field] !== incoming) {
        conflicts.push({
          initiator,
          field,
          existing: target[field],
          incoming,
          sourceRow
        });
      }
    };

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const rawValues = [row[initiatorColumn], row[groupColumn], row[detailedColumn], row[commentsColumn]];
      if (rawValues.every(value => value === null || value === undefined || String(value).trim() === '')) continue;

      sourceRows += 1;
      const initiator = normalizeOptionalReferenceText(row[initiatorColumn]);
      const group = normalizedValue(row[groupColumn]);
      const groupDetailed = normalizedValue(row[detailedColumn]);
      const comments = normalizedValue(row[commentsColumn]);

      if (!initiator) {
        rowsWithoutInitiator += 1;
        continue;
      }

      if (!merged.has(initiator)) {
        merged.set(initiator, {
          initiator,
          group,
          groupDetailed,
          comments,
          sourceSheet: match.sheetName,
          sourceRows: [rowIndex + 1]
        });
        continue;
      }

      mergedDuplicateRows += 1;
      const target = merged.get(initiator);
      target.sourceRows.push(rowIndex + 1);
      mergeField(target, 'group', group, initiator, rowIndex + 1);
      mergeField(target, 'groupDetailed', groupDetailed, initiator, rowIndex + 1);
      mergeField(target, 'comments', comments, initiator, rowIndex + 1);
    }

    if (rowsWithoutInitiator) {
      warnings.push('Строк без значения «Инициатор (открыл)»: ' + rowsWithoutInitiator + '. Они пропущены, остальные данные приняты.');
    }
    if (conflicts.length) {
      const sample = conflicts.slice(0, 5).map(item =>
        '«' + item.initiator + '»: ' + item.field + ' = «' + item.existing + '» / «' + item.incoming + '»'
      ).join('; ');
      warnings.push('Найдены разные непустые значения у одного инициатора: ' + conflicts.length + '. ' + sample + (conflicts.length > 5 ? '; …' : '') + '.');
    }

    const records = [...merged.values()]
      .map(record => Object.assign({}, record, { sourceRow: record.sourceRows[0] }))
      .sort((left, right) => left.initiator.localeCompare(right.initiator, 'ru'));

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        mergedDuplicateRows,
        rowsWithoutInitiator,
        unknownMarkerCount,
        conflictCount: conflicts.length,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// EXCEPTIONS
// ============================================================================
  function findExceptionsTable(workbook) {
    const numberHeader = normalizeReferenceHeader('№');
    const decisionHeader = normalizeReferenceHeader('Решение');
    const categoryHeader = normalizeReferenceHeader('Категория');
    const exceptionAliases = EXCEPTIONS_SCHEMA.headerAliases.exception.map(normalizeReferenceHeader);

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        const numberColumn = normalizedHeader.indexOf(numberHeader);
        const exceptionColumn = normalizedHeader.findIndex(header => exceptionAliases.includes(header));
        const decisionColumn = normalizedHeader.indexOf(decisionHeader);
        const categoryColumn = normalizedHeader.indexOf(categoryHeader);

        if ([numberColumn, exceptionColumn, decisionColumn, categoryColumn].every(position => position >= 0)) {
          return {
            sheetName,
            rows,
            headerRowIndex: rowIndex,
            positions: { numberColumn, exceptionColumn, decisionColumn, categoryColumn }
          };
        }
      }
    }

    return null;
  }

  function normalizeExceptionsWorkbook(workbook) {
    const match = findExceptionsTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат Exceptions. Ожидаются колонки: «№», «Ислючение для [Причина инцидента]», «Решение», «Категория».'],
          warnings: []
        }
      };
    }

    const warnings = [];
    const errors = [];
    const { numberColumn, exceptionColumn, decisionColumn, categoryColumn } = match.positions;
    const merged = new Map();
    let sourceRows = 0;
    let skippedWithoutException = 0;
    let unknownMarkerCount = 0;
    let mergedDuplicateRows = 0;
    const conflicts = [];

    const optionalText = raw => {
      const text = normalizeReferenceText(raw);
      if (!text) return null;
      if (/^\?+$/.test(text)) {
        unknownMarkerCount += 1;
        return null;
      }
      return text;
    };

    const mergeField = (target, field, incoming, sourceRow) => {
      if (!incoming) return;
      if (!target[field]) {
        target[field] = incoming;
        return;
      }
      if (target[field] !== incoming) {
        conflicts.push({
          exception: target.exception,
          field,
          existing: target[field],
          incoming,
          sourceRow
        });
      }
    };

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const rawValues = [row[numberColumn], row[exceptionColumn], row[decisionColumn], row[categoryColumn]];
      if (rawValues.every(value => value === null || value === undefined || String(value).trim() === '')) continue;

      sourceRows += 1;
      const exception = optionalText(row[exceptionColumn]);
      if (!exception) {
        skippedWithoutException += 1;
        continue;
      }

      const number = optionalText(row[numberColumn]);
      const decision = optionalText(row[decisionColumn]);
      const category = optionalText(row[categoryColumn]);
      const key = normalizeReferenceHeader(exception);

      if (!merged.has(key)) {
        merged.set(key, {
          number,
          exception,
          exceptionKey: key,
          decision,
          category,
          sourceSheet: match.sheetName,
          sourceRows: [rowIndex + 1]
        });
        continue;
      }

      mergedDuplicateRows += 1;
      const target = merged.get(key);
      target.sourceRows.push(rowIndex + 1);
      if (!target.number && number) target.number = number;
      mergeField(target, 'decision', decision, rowIndex + 1);
      mergeField(target, 'category', category, rowIndex + 1);
    }

    if (skippedWithoutException) {
      warnings.push('Строк без текста исключения: ' + skippedWithoutException + '. Они пропущены, остальные данные приняты.');
    }

    if (conflicts.length) {
      const sample = conflicts.slice(0, 5).map(item =>
        '«' + item.exception + '»: ' + item.field + ' = «' + item.existing + '» / «' + item.incoming + '»'
      ).join('; ');
      warnings.push('Найдены разные непустые значения у одного исключения: ' + conflicts.length + '. ' + sample + (conflicts.length > 5 ? '; …' : '') + '.');
    }

    const records = [...merged.values()]
      .map(record => Object.assign({}, record, { sourceRow: record.sourceRows[0] }))
      .sort((left, right) => left.exception.localeCompare(right.exception, 'ru'));

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        mergedDuplicateRows,
        skippedWithoutException,
        unknownMarkerCount,
        conflictCount: conflicts.length,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// PROBLEM GRADE
// ============================================================================
  function findProblemGradeTable(workbook) {
    const anchors = PROBLEM_GRADE_SCHEMA.anchorHeaders.map(normalizeReferenceHeader);

    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });

      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalizedHeader = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        if (!anchors.every(header => normalizedHeader.includes(header))) continue;

        const positions = {};
        for (const [id, title] of PROBLEM_GRADE_SCHEMA.columns) {
          positions[id] = normalizedHeader.indexOf(normalizeReferenceHeader(title));
        }
        return { sheetName, rows, headerRowIndex: rowIndex, positions };
      }
    }

    return null;
  }

  function normalizeProblemGradeWorkbook(workbook) {
    const match = findProblemGradeTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найден формат ProblemGrade. Обязательны колонки «Основание № IT-проблемы», «Наименование оборудования», «Элемент», «Неисправность», «Причина».'],
          warnings: []
        }
      };
    }

    const errors = [];
    const warnings = [];
    const missingHeaders = PROBLEM_GRADE_SCHEMA.columns
      .filter(([id]) => id !== 'legacyKey' && match.positions[id] < 0)
      .map(([, title]) => title);

    if (missingHeaders.length) {
      warnings.push('Не найдены необязательные колонки: ' + missingHeaders.map(item => '«' + item + '»').join(', ') + '. Они будут заполнены пустыми значениями.');
    }

    const getCell = (row, id) => {
      const index = match.positions[id];
      return index >= 0 ? row[index] : null;
    };

    const recordsBySignature = new Map();
    let sourceRows = 0;
    let exactDuplicateRows = 0;
    let legacyMismatchCount = 0;
    let incompleteClassifierCount = 0;
    let missingProblemIdCount = 0;
    const legacyMismatchRows = [];

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const knownPositions = Object.values(match.positions).filter(index => index >= 0);
      const hasAnyValue = knownPositions.some(index => row[index] !== null && row[index] !== undefined && String(row[index]).trim() !== '');
      if (!hasAnyValue) continue;

      sourceRows += 1;

      const equipment = normalizeOptionalReferenceText(getCell(row, 'equipment'));
      const element = normalizeOptionalReferenceText(getCell(row, 'element'));
      const fault = normalizeOptionalReferenceText(getCell(row, 'fault'));
      const reason = normalizeOptionalReferenceText(getCell(row, 'reason'));
      const classifierParts = [equipment, element, fault, reason];
      const classifierKey = JSON.stringify(classifierParts.map(value => normalizeReferenceHeader(value || '')));
      const classifierPath = classifierParts.map(value => value || '—').join(' → ');
      const legacyExpected = classifierParts.map(value => value || '').join('');
      const legacyKey = normalizeOptionalReferenceText(getCell(row, 'legacyKey'));
      const legacyKeyMatches = legacyKey ? legacyKey === legacyExpected : null;

      if (classifierParts.some(value => !value)) incompleteClassifierCount += 1;
      if (legacyKeyMatches === false) {
        legacyMismatchCount += 1;
        if (legacyMismatchRows.length < 10) legacyMismatchRows.push(rowIndex + 1);
      }

      const problemId = normalizeOptionalReferenceText(getCell(row, 'problemId'));
      if (!problemId) missingProblemIdCount += 1;

      const record = {
        classifierKey,
        classifierPath,
        equipment,
        element,
        fault,
        reason,
        problemId,
        problemStatus: normalizeOptionalReferenceText(getCell(row, 'problemStatus')),
        problemName: normalizeOptionalReferenceText(getCell(row, 'problemName')),
        classifierConfirmation: normalizeOptionalReferenceText(getCell(row, 'classifierConfirmation')),
        normalizationDecision: normalizeOptionalReferenceText(getCell(row, 'normalizationDecision')),
        primaryExclusion: normalizeOptionalReferenceText(getCell(row, 'primaryExclusion')),
        legacyKey,
        legacyExpected,
        legacyKeyMatches,
        sourceSheet: match.sheetName,
        sourceRows: [rowIndex + 1],
        sourceRow: rowIndex + 1
      };

      const signature = JSON.stringify([
        classifierKey,
        record.problemId,
        record.problemStatus,
        record.problemName,
        record.classifierConfirmation,
        record.normalizationDecision,
        record.primaryExclusion
      ]);

      if (recordsBySignature.has(signature)) {
        exactDuplicateRows += 1;
        recordsBySignature.get(signature).sourceRows.push(rowIndex + 1);
      } else {
        recordsBySignature.set(signature, record);
      }
    }

    const records = [...recordsBySignature.values()];
    const problemIdsByClassifier = new Map();
    const pathByClassifier = new Map();

    for (const record of records) {
      if (!problemIdsByClassifier.has(record.classifierKey)) problemIdsByClassifier.set(record.classifierKey, new Set());
      if (record.problemId) problemIdsByClassifier.get(record.classifierKey).add(record.problemId);
      pathByClassifier.set(record.classifierKey, record.classifierPath);
    }

    const ambiguousClassifierKeys = [...problemIdsByClassifier.entries()]
      .filter(([, problemIds]) => problemIds.size > 1);

    if (legacyMismatchCount) {
      warnings.push(
        'Вспомогательная склейка не совпадает с текущей цепочкой классификатора в ' + legacyMismatchCount +
        ' строках' + (legacyMismatchRows.length ? ' (например: ' + legacyMismatchRows.join(', ') + ')' : '') +
        '. Для работы используется вычисленный ключ из четырёх полей, а не вспомогательный столбец.'
      );
    }
    if (ambiguousClassifierKeys.length) {
      const sample = ambiguousClassifierKeys.slice(0, 5).map(([key, problemIds]) =>
        '«' + (pathByClassifier.get(key) || key) + '» → ' + [...problemIds].join(', ')
      ).join('; ');
      warnings.push(
        'Одна классификационная цепочка привязана к нескольким IT-проблемам: ' + ambiguousClassifierKeys.length +
        '. Привязки сохранены без автоматического выбора. ' + sample + (ambiguousClassifierKeys.length > 5 ? '; …' : '') + '.'
      );
    }
    if (incompleteClassifierCount) {
      warnings.push('Строк с неполной цепочкой классификатора: ' + incompleteClassifierCount + '. Они сохранены, но ключ содержит пустой уровень.');
    }
    if (missingProblemIdCount) {
      warnings.push('Строк без «Основание № IT-проблемы»: ' + missingProblemIdCount + '. Они сохранены.');
    }

    records.sort((left, right) => {
      const pathOrder = left.classifierPath.localeCompare(right.classifierPath, 'ru');
      if (pathOrder !== 0) return pathOrder;
      return (left.problemId || '').localeCompare(right.problemId || '', 'ru');
    });

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        normalizedRows: records.length,
        classifierKeyCount: problemIdsByClassifier.size,
        exactDuplicateRows,
        legacyMismatchCount,
        ambiguousClassifierKeyCount: ambiguousClassifierKeys.length,
        incompleteClassifierCount,
        missingProblemIdCount,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

// ============================================================================
// DRIVERS
// ============================================================================
  function findDriversTable(workbook) {
    const required = DRIVERS_SCHEMA.requiredHeaders.map(normalizeReferenceHeader);
    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null
      });
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const normalized = (rows[rowIndex] || []).map(normalizeReferenceHeader);
        const positions = required.map(header => normalized.indexOf(header));
        if (positions.every(position => position >= 0)) {
          return { sheetName, rows, headerRowIndex: rowIndex, positions };
        }
      }
    }
    return null;
  }

  function normalizeDriversWorkbook(workbook) {
    const match = findDriversTable(workbook);
    if (!match) {
      return {
        records: [],
        meta: {},
        validation: {
          status: 'invalid',
          errors: ['Не найдены обязательные колонки Drivers: «Наименование типа узла/бъекта/оборудования», «Сервис», «Система».'],
          warnings: []
        }
      };
    }

    const errors = [];
    const warnings = [];
    const [nameColumn, serviceColumn, systemColumn] = match.positions;
    const header = match.rows[match.headerRowIndex] || [];
    const mineColumns = [];

    for (let column = Math.max(...match.positions) + 1; column < header.length; column += 1) {
      const sourceHeader = String(header[column] ?? '').trim();
      if (sourceHeader) {
        mineColumns.push({ column, sourceHeader, mine: cleanMineName(sourceHeader) });
      }
    }
    if (!mineColumns.length) {
      errors.push('После колонки «Система» не найдено ни одной колонки рудника/шахты.');
    }

    const records = [];
    const linkMap = new Map();
    let sourceRows = 0;
    let textValueCount = 0;

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      const name = row[nameColumn] == null ? '' : String(row[nameColumn]).trim();
      const service = row[serviceColumn] == null || String(row[serviceColumn]).trim() === ''
        ? null
        : String(row[serviceColumn]).trim();
      const system = row[systemColumn] == null ? '' : String(row[systemColumn]).trim();

      if (!name && !service && !system) continue;
      if (!name) {
        errors.push('Строка ' + (rowIndex + 1) + ': отсутствует «Наименование типа узла/бъекта/оборудования».');
        continue;
      }
      if (!system) {
        errors.push('Строка ' + (rowIndex + 1) + ': для «' + name + '» не заполнена «Система».');
      }

      sourceRows += 1;
      const linkKey = JSON.stringify([service, system || null]);
      if (!linkMap.has(name)) linkMap.set(name, new Map());
      if (!linkMap.get(name).has(linkKey)) linkMap.get(name).set(linkKey, []);
      linkMap.get(name).get(linkKey).push(rowIndex + 1);

      for (const mineColumn of mineColumns) {
        const rawValue = row[mineColumn.column] ?? null;
        const normalized = normalizeDriversValue(rawValue);
        if (normalized.state === 'text') textValueCount += 1;

        records.push({
          mine: mineColumn.mine,
          mineSource: mineColumn.sourceHeader,
          name,
          service,
          system: system || null,
          value: normalized.value,
          unit: normalized.unit,
          rawValue,
          valueState: normalized.state,
          sourceSheet: match.sheetName,
          sourceRow: rowIndex + 1
        });
      }
    }

    for (const [name, variants] of linkMap.entries()) {
      if (variants.size <= 1) continue;

      const parsedVariants = [...variants.entries()].map(([key, rows]) => ({
        pair: JSON.parse(key),
        rows
      }));

      let hasRealConflict = false;
      for (let left = 0; left < parsedVariants.length && !hasRealConflict; left += 1) {
        for (let right = left + 1; right < parsedVariants.length; right += 1) {
          const [leftService, leftSystem] = parsedVariants[left].pair;
          const [rightService, rightSystem] = parsedVariants[right].pair;

          const serviceConflict = Boolean(leftService && rightService && leftService !== rightService);
          const systemConflict = Boolean(leftSystem && rightSystem && leftSystem !== rightSystem);

          if (serviceConflict || systemConflict) {
            hasRealConflict = true;
            break;
          }
        }
      }

      if (!hasRealConflict) continue;

      const variantText = parsedVariants.map(item =>
        'строки ' + item.rows.join(', ') + ': Сервис=' + (item.pair[0] || 'пусто') + ', Система=' + (item.pair[1] || 'пусто')
      ).join('; ');
      warnings.push('Найдены разные непустые значения связи для «' + name + '»: ' + variantText + '.');
    }

    if (textValueCount) {
      warnings.push('Найдено текстовых значений, не распознанных как количество или км: ' + textValueCount + '. Исходный текст сохранён.');
    }

    return {
      records,
      meta: {
        sourceSheet: match.sheetName,
        headerRow: match.headerRowIndex + 1,
        sourceRows,
        mineCount: mineColumns.length,
        mineNames: mineColumns.map(item => item.mine),
        normalizedRows: records.length,
        latestRequestDate: null
      },
      validation: {
        status: errors.length ? 'invalid' : (warnings.length ? 'warning' : 'valid'),
        errors,
        warnings
      }
    };
  }

