  const itsmDatasetSchema = globalThis.ReclassifierItsmDatasetSchema;
  if (!itsmDatasetSchema) throw new Error('ITSM Dataset schema is not loaded.');

  const itsmModuleConfig = Object.freeze({
    index: '03',
    title: 'ITSM',
    description: 'Обогащение заявок ITSM, подготовка расчётных полей и накопление данных для отчёта по надёжности.',
    references: ['reclassification', 'drivers', 'customers', 'type_request', 'initiators', 'exceptions', 'problem_grade']
  });
