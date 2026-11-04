// FILE CONTRACT: shared structural Dataset classifier.
// Purpose: identify supported Excel workbook types from their internal header structure.
// Owns: header normalization, structural probes and workbook classification only.
// Reads: SheetJS workbook data plus Reference/Equipment/Failure Classifier schema declarations.
// Writes: no application state or persistent data.
// Public API: globalThis.ReclassifierDatasetClassifier.
// Must not: render UI, mutate Dataset state or access SQLite/storage.
// Related tests: test_dataset_classifier.js, test_database_recognizer.js,
//                test_reference_architecture.py, test_architecture_guardrails.py.

  function datasetClassifierNormalizeHeader(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function datasetClassifierHeaderRows(workbook) {
    const xlsx = globalThis.XLSX;
    if (!xlsx?.utils?.sheet_to_json) {
      throw new Error('Excel parser XLSX не включён в сборку.');
    }

    const result = [];
    for (const sheetName of workbook?.SheetNames || []) {
      const sheet = workbook?.Sheets?.[sheetName];
      if (!sheet) continue;
      globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
        'classifier-headers','start');
      // The classifier needs only the first 25 nonblank rows, not 70k+ rows
      // from the complete workbook. Preserve the logical nonblank rowIndex
      // used by recognizerRows() even when physical spreadsheet rows are blank.
      let seen = 0;
      const collect = rows => {
        for (const row of rows) {
          if (seen >= 25) break;
          const rowIndex = seen++;
          const normalized = (row || []).map(datasetClassifierNormalizeHeader);
          const set = new Set(normalized.filter(Boolean));
          if (set.size) result.push({ sheetName, rowIndex, set });
        }
      };
      if (sheet['!ref'] && typeof xlsx.utils.decode_range === 'function') {
        const bounds = xlsx.utils.decode_range(sheet['!ref']);
        const batchRows = 128;
        for (let first = bounds.s.r; first <= bounds.e.r && seen < 25; first += batchRows) {
          const rows = xlsx.utils.sheet_to_json(sheet, {
            header: 1,
            raw: true,
            defval: null,
            blankrows: false,
            range: {
              s: { r: first, c: bounds.s.c },
              e: { r: Math.min(bounds.e.r, first + batchRows - 1), c: bounds.e.c }
            }
          });
          collect(rows);
        }
      } else {
        // Fake/legacy sheets without !ref preserve existing behavior.
        collect(xlsx.utils.sheet_to_json(sheet, {
          header: 1, raw: true, defval: null, blankrows: false
        }));
      }
      globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
        'classifier-headers','end',{rows:seen});
    }
    return result;
  }

  function datasetClassifierRowHasAll(row, headers) {
    return headers.every(header => row.set.has(datasetClassifierNormalizeHeader(header)));
  }

  function datasetClassifierRowHasAny(row, headers) {
    return headers.some(header => row.set.has(datasetClassifierNormalizeHeader(header)));
  }

  function classifyWorkbookByStructure(workbook) {
    const rows = datasetClassifierHeaderRows(workbook);
    const findAll = headers => rows.find(row => datasetClassifierRowHasAll(row, headers));
    const findAllAndAny = (headers, anyHeaders) => rows.find(row =>
      datasetClassifierRowHasAll(row, headers) && datasetClassifierRowHasAny(row, anyHeaders)
    );

    const itsm = findAll(['Номер', 'Код закрытия', 'Наименование оборудования', 'Причина инцидента']);
    if (itsm) return {
      id: 'itsm',
      group: 'Данные',
      label: 'ITSM',
      sheetName: itsm.sheetName,
      headerRow: itsm.rowIndex + 1,
      reason: 'структура ITSM-выгрузки'
    };

    const mobileBrigade = findAllAndAny(
      ['Тип задачи', 'Фактическая дата', 'Фактические трудозатраты'],
      ['Участок', 'Заявка', 'Номер задачи']
    );
    if (mobileBrigade) return {
      id: 'mobile_brigade',
      group: 'Данные',
      label: 'Мобильные бригады',
      sheetName: mobileBrigade.sheetName,
      headerRow: mobileBrigade.rowIndex + 1,
      reason: 'структура выгрузки задач МБ'
    };

    const failureClassifierDetector =
      typeof classifierDetectWorkbook === 'function' ? classifierDetectWorkbook : null;
    if (failureClassifierDetector) {
      try {
        const detected = failureClassifierDetector(workbook);
        if (detected) return {
          id: 'failure_classifier',
          group: 'Классификаторы',
          label: 'Классификатор отказов',
          sheetName: detected.sheetName,
          headerRow: detected.headerRowIndex + 1,
          reason: detected.formatLabel || 'структура классификатора отказов'
        };
      } catch (_) {
        // Not a failure-classifier workbook.
      }
    }

    const equipmentCandidates = [
      ['stationary', 'CatalogStationaryEquipment'],
      ['mounted', 'CatalogMountedEquipment'],
      ['transport_start_points', 'CatalogTransport StartPoints'],
      ['transport', 'CatalogTransport'],
      ['zabbix', 'CatalogZabbixEquipmentTree']
    ];
    const equipmentDefinitions =
      typeof equipmentConfig !== 'undefined' ? equipmentConfig : {};
    for (const [id, label] of equipmentCandidates) {
      const config = equipmentDefinitions?.[id];
      if (!config?.requiredHeaders) continue;
      const match = findAll(config.requiredHeaders);
      if (match) return {
        id: 'equipment:' + id,
        group: 'Оборудование',
        label,
        sheetName: match.sheetName,
        headerRow: match.rowIndex + 1,
        reason: 'структура каталога оборудования'
      };
    }

    const reclassificationSchema =
      typeof RECLASSIFICATION_SCHEMA !== 'undefined' ? RECLASSIFICATION_SCHEMA : null;
    const problemGradeSchema =
      typeof PROBLEM_GRADE_SCHEMA !== 'undefined' ? PROBLEM_GRADE_SCHEMA : null;
    const initiatorsSchema =
      typeof INITIATORS_SCHEMA !== 'undefined' ? INITIATORS_SCHEMA : null;

    const referenceChecks = [
      {
        id: 'reclassification',
        label: 'Reclassification / ReClass',
        match: () => reclassificationSchema?.anchorHeaders
          ? findAll(reclassificationSchema.anchorHeaders) : null
      },
      {
        id: 'problem_grade',
        label: 'ProblemGrade',
        match: () => problemGradeSchema?.anchorHeaders
          ? findAll(problemGradeSchema.anchorHeaders) : null
      },
      {
        id: 'initiators',
        label: 'Initiators',
        match: () => initiatorsSchema?.requiredHeaders
          ? findAll(initiatorsSchema.requiredHeaders) : null
      },
      {
        id: 'exceptions',
        label: 'Exceptions',
        match: () => rows.find(row =>
          datasetClassifierRowHasAll(row, ['№', 'Решение', 'Категория']) &&
          datasetClassifierRowHasAny(row, [
            'Ислючение для [Причина инцидента]',
            'Исключение для [Причина инцидента]'
          ])
        )
      },
      {
        id: 'customers',
        label: 'Customers',
        match: () => rows.find(row =>
          datasetClassifierRowHasAll(row, ['Рудник', 'Заказчик кратко', 'Заказчик полностью']) &&
          datasetClassifierRowHasAny(row, ['Заказчик (для нас)', 'Заказчик'])
        )
      },
      {
        id: 'type_request',
        label: 'TypeRequest',
        match: () => rows.find(row =>
          datasetClassifierRowHasAll(row, ['Вид работ']) &&
          datasetClassifierRowHasAny(row, [
            'Краткое описание (типовой запрос)',
            'Краткое описание'
          ])
        )
      },
      {
        id: 'drivers',
        label: 'Drivers',
        match: () => rows.find(row =>
          datasetClassifierRowHasAll(row, ['Сервис', 'Система']) &&
          datasetClassifierRowHasAny(row, [
            'Наименование типа узла/бъекта/оборудования',
            'Наименование типа узла/объекта/оборудования'
          ])
        )
      }
    ];

    for (const check of referenceChecks) {
      const match = check.match();
      if (match) return {
        id: check.id,
        group: 'Справочники',
        label: check.label,
        sheetName: match.sheetName,
        headerRow: match.rowIndex + 1,
        reason: 'структура справочника'
      };
    }

    return {
      id: 'unknown',
      group: 'Не распознано',
      label: 'Не распознано',
      sheetName: workbook?.SheetNames?.[0] || null,
      headerRow: null,
      reason: 'не найдена известная структура заголовков'
    };
  }

  globalThis.ReclassifierDatasetClassifier = Object.freeze({
    classifyWorkbook: classifyWorkbookByStructure,
    normalizeHeader: datasetClassifierNormalizeHeader
  });
