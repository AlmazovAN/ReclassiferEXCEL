  const FAILURE_CLASSIFIER_ID = 'failure_classifier';
  const failureClassifierDatasetDefinition = globalThis.ReclassifierDatasetCatalog?.get?.(FAILURE_CLASSIFIER_ID);
  if (!failureClassifierDatasetDefinition) {
    throw new Error('Dataset Catalog не загружен до Failure Classifier Config.');
  }
  const FAILURE_CLASSIFIER_SCHEMA_VERSION = failureClassifierDatasetDefinition.schemaVersion;

  const FAILURE_CLASSIFIER_CANONICAL_COLUMNS = Object.freeze([
    ['service', 'Услуга'],
    ['equipment', 'Наименование оборудования'],
    ['element', 'Элемент'],
    ['failure', 'Неисправность'],
    ['cause', 'Причина']
  ]);

  const FAILURE_CLASSIFIER_OGR_SERVICE = 'Техническое обслуживание и ремонт автоматизированной системы управления открытыми горными работами';

  const failureClassifierConfig = Object.freeze({
    id: FAILURE_CLASSIFIER_ID,
    allowEmpty: failureClassifierDatasetDefinition.allowEmpty,
    title: 'Классификатор отказов',
    description: 'Рабочий текстовый классификатор: услуга → оборудование → элемент → неисправность → причина.',
    schemaVersion: FAILURE_CLASSIFIER_SCHEMA_VERSION,
    deduplication: Object.freeze({
      enabled: true,
      fields: Object.freeze(FAILURE_CLASSIFIER_CANONICAL_COLUMNS.map(([field]) => field))
    })
  });
