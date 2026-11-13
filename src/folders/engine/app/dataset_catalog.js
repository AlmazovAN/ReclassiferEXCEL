// FILE CONTRACT: single source of stable Dataset identity and dependency metadata.
// Purpose: define Dataset IDs, kinds, schema versions, emptiness policy and storage strategies once.
// Owns: stable Dataset contract properties used by the folders runtime and Excel handlers.
// Reads: no UI/module state.
// Writes: no application state or persistence.
// Public API: globalThis.ReclassifierDatasetCatalog.
// Must not: contain workbook rules, UI descriptions or workbook normalization logic.
// Related tests: tests/test_folders*.cjs.

(() => {
  'use strict';

  const STRATEGY = Object.freeze({
    UPSERT: 'UPSERT',
    REPLACE: 'REPLACE',
    DERIVED: 'DERIVED'
  });

  function defineDataset(id, definition) {
    const dataset = Object.freeze({
      id,
      databaseTitle: definition.databaseTitle,
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      allowEmpty: definition.allowEmpty === true,
      persisted: definition.persisted !== false,
      strategy: definition.strategy,
      keyField: definition.keyField || null,
      partitionField: definition.partitionField || null,
      dependencies: Object.freeze(Array.from(definition.dependencies || [])),
      // Field-level enrichment inputs are not dataset-wide revision edges.
      // ITSM and MB refer to one another, so inserting both directions into
      // dependencies would create a false cycle in the stale-data checker.
      fieldDependencies: Object.freeze(Array.from(definition.fieldDependencies || [], item =>
        Object.freeze({
          datasetId: item.datasetId,
          sourceFields: Object.freeze(Array.from(item.sourceFields || [])),
          targetFields: Object.freeze(Array.from(item.targetFields || []))
        })
      ))
    });
    if (!dataset.id || !dataset.databaseTitle || !dataset.kind || !dataset.schemaVersion || !dataset.strategy) {
      throw new Error('Неполное описание Dataset Catalog: ' + String(id || 'unknown') + '.');
    }
    if (dataset.strategy === STRATEGY.UPSERT && !dataset.keyField) {
      throw new Error('UPSERT Dataset требует keyField: ' + dataset.id + '.');
    }
    if (dataset.strategy === STRATEGY.DERIVED && dataset.persisted) {
      throw new Error('DERIVED Dataset не может быть persisted: ' + dataset.id + '.');
    }
    return dataset;
  }

  const DATASETS = Object.freeze({
    reclassification: defineDataset('reclassification', {
      databaseTitle: 'Reclassification / ReClass',
      kind: 'reference', schemaVersion: '1.2.0', strategy: STRATEGY.REPLACE
    }),
    drivers: defineDataset('drivers', {
      databaseTitle: 'Drivers',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE
    }),
    customers: defineDataset('customers', {
      databaseTitle: 'Customers',
      kind: 'reference', schemaVersion: '1.1.0', strategy: STRATEGY.REPLACE
    }),
    type_request: defineDataset('type_request', {
      databaseTitle: 'TypeRequest',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE
    }),
    initiators: defineDataset('initiators', {
      databaseTitle: 'Initiators',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE
    }),
    exceptions: defineDataset('exceptions', {
      databaseTitle: 'Exceptions',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      allowEmpty: true
    }),
    it_problem_registry: defineDataset('it_problem_registry', {
      databaseTitle: 'Реестр ИТ-проблем', kind: 'reference', schemaVersion: '1.0.0',
      strategy: STRATEGY.REPLACE, keyField: 'prbNumber'
    }),
    problem_grade: defineDataset('problem_grade', {
      databaseTitle: 'ProblemGrade',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE
    }),

    dkn_roadmap: defineDataset('dkn_roadmap', {
      databaseTitle: 'Дорожная карта по надёжности',
      kind: 'reference', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE, keyField: 'rowId'
    }),

    mobile_brigade_data: defineDataset('mobile_brigade_data', {
      databaseTitle: 'Mobile Brigade Data',
      kind: 'events', schemaVersion: '1.5.0', strategy: STRATEGY.UPSERT,
      keyField: 'recordKey',
      fieldDependencies: [{
        datasetId: 'itsm_data',
        sourceFields: ['number', 'createdAt'],
        targetFields: ['itsmCreatedAt']
      }]
    }),
    itsm_data: defineDataset('itsm_data', {
      databaseTitle: 'ITSM Sirius Data',
      kind: 'events', schemaVersion: '1.2.0', strategy: STRATEGY.UPSERT,
      keyField: 'number',
      dependencies: [
        'reclassification', 'drivers', 'customers', 'type_request',
        'initiators', 'exceptions', 'problem_grade', 'mobile_brigade_data'
      ],
      fieldDependencies: [{
        datasetId: 'mobile_brigade_data',
        sourceFields: ['request', 'laborHours', 'equipmentPlacement', 'transport', 'equipmentUnit'],
        targetFields: ['equipmentName', 'result6LaborHours', 'mbPresence']
      }]
    }),
    kpi_source: defineDataset('kpi_source', {
      databaseTitle: 'KPI Source',
      kind: 'analytics', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      allowEmpty: true,
      dependencies: ['itsm_data']
    }),

    mounted: defineDataset('mounted', {
      databaseTitle: 'CatalogMountedEquipment',
      kind: 'equipment', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      partitionField: 'unit'
    }),
    stationary: defineDataset('stationary', {
      databaseTitle: 'CatalogStationaryEquipment',
      kind: 'equipment', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      partitionField: 'unit'
    }),
    transport: defineDataset('transport', {
      databaseTitle: 'CatalogTransport',
      kind: 'equipment', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      partitionField: 'unit'
    }),
    zabbix: defineDataset('zabbix', {
      databaseTitle: 'CatalogZabbixEquipmentTree',
      kind: 'equipment', schemaVersion: '1.0.0', strategy: STRATEGY.REPLACE,
      partitionField: '__partition_unit'
    }),
    combined: defineDataset('combined', {
      databaseTitle: 'Equipment_Combined',
      kind: 'equipment', schemaVersion: '1.1.0', strategy: STRATEGY.DERIVED,
      persisted: false,
      dependencies: ['mounted', 'stationary', 'transport', 'zabbix']
    }),

    dkn_measures: defineDataset('dkn_measures', {
      databaseTitle: 'Меры ДКН', kind: 'management', schemaVersion: '1.0.0',
      strategy: STRATEGY.UPSERT, keyField: 'measureId', allowEmpty: true
    }),
    dkn_orders: defineDataset('dkn_orders', {
      databaseTitle: 'Ордеры ДКН', kind: 'management', schemaVersion: '1.0.0',
      strategy: STRATEGY.UPSERT, keyField: 'orderId', allowEmpty: true
    }),
    dkn_results: defineDataset('dkn_results', {
      databaseTitle: 'Результаты ДКН', kind: 'management', schemaVersion: '1.0.0',
      strategy: STRATEGY.UPSERT, keyField: 'resultId', allowEmpty: true
    }),
    failure_classifier: defineDataset('failure_classifier', {
      databaseTitle: 'Классификатор отказов',
      kind: 'classifier', schemaVersion: '2.0.0', strategy: STRATEGY.REPLACE
    })
  });

  for (const dataset of Object.values(DATASETS)) {
    if (dataset.strategy === STRATEGY.DERIVED && !dataset.dependencies.length) {
      throw new Error('DERIVED Dataset требует dependencies: ' + dataset.id + '.');
    }
    for (const dependencyId of dataset.dependencies) {
      if (dependencyId === dataset.id || !DATASETS[dependencyId]) {
        throw new Error(
          'Некорректная зависимость Dataset ' + dataset.id + ': ' + dependencyId + '.'
        );
      }
    }
    for (const dependency of dataset.fieldDependencies) {
      if (!dependency.datasetId || dependency.datasetId === dataset.id ||
          !DATASETS[dependency.datasetId] ||
          !dependency.sourceFields.length || !dependency.targetFields.length ||
          [...dependency.sourceFields, ...dependency.targetFields].some(field =>
            typeof field !== 'string' || !field.trim()
          )) {
        throw new Error('Некорректная зависимость полей Dataset ' + dataset.id + '.');
      }
    }
  }

  function get(id) {
    const definition = DATASETS[id];
    if (!definition) throw new Error('Dataset отсутствует в Dataset Catalog: ' + id + '.');
    return definition;
  }

  function list() {
    return Object.values(DATASETS);
  }

  function fieldDependents(sourceDatasetId, field = null) {
    const matches = [];
    for (const definition of Object.values(DATASETS)) {
      for (const input of definition.fieldDependencies) {
        if (input.datasetId !== sourceDatasetId ||
            (field !== null && !input.sourceFields.includes(field))) continue;
        matches.push(Object.freeze({
          datasetId: definition.id,
          sourceDatasetId: input.datasetId,
          sourceFields: input.sourceFields,
          targetFields: input.targetFields
        }));
      }
    }
    return Object.freeze(matches);
  }

  globalThis.ReclassifierDatasetCatalog = Object.freeze({
    strategy: STRATEGY,
    datasets: DATASETS,
    get,
    list,
    fieldDependents
  });
})();
