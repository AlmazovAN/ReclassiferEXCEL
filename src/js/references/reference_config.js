  const referenceDatasetCatalog = globalThis.ReclassifierDatasetCatalog;
  if (!referenceDatasetCatalog?.get) {
    throw new Error('Dataset Catalog не загружен до Reference Config.');
  }

  function referenceUiConfig(id, config) {
    const definition = referenceDatasetCatalog.get(id);
    return {
      ...config,
      allowEmpty: definition.allowEmpty,
      schemaVersion: definition.schemaVersion
    };
  }

  const referenceConfig = {
    reclassification: referenceUiConfig('reclassification', {
      title: 'Реклассификация',
      description: 'История реклассификации обращений; нормализуется по номеру обращения и датам регистрации/выполнения',
      freshnessPolicy: 'max_date',
      freshnessField: 'Дата выполнения обращения'
    }),
    drivers: referenceUiConfig('drivers', {
      title: 'Драйверы оборудования',
      description: 'Драйверы: привязка оборудования к сервису, системе и количеству по рудникам/шахтам',
      freshnessPolicy: 'none'
    }),
    customers: referenceUiConfig('customers', {
      title: 'Заказчики',
      description: 'Заказчики: привязка рудника/шахты к внутреннему заказчику и краткому/полному наименованию фактического заказчика',
      freshnessPolicy: 'none'
    }),
    type_request: referenceUiConfig('type_request', {
      title: 'Типовые запросы',
      description: 'Типовые запросы: сопоставление краткого описания заявки с ожидаемым видом работ',
      freshnessPolicy: 'none'
    }),
    initiators: referenceUiConfig('initiators', {
      title: 'Инициаторы',
      description: 'Справочник инициаторов и их групп; пустые значения и «?» трактуются как не определено',
      freshnessPolicy: 'none'
    }),
    exceptions: referenceUiConfig('exceptions', {
      title: 'Исключения',
      description: 'Правила обработки причин инцидентов: исключить или считать отказом, с категорией результата',
      freshnessPolicy: 'none'
    }),
    problem_grade: referenceUiConfig('problem_grade', {
      title: 'Связь с IT-проблемами',
      description: 'Привязка IT-проблем к комбинациям классификатора оборудование → элемент → неисправность → причина',
      freshnessPolicy: 'none'
    }),
    mobile_brigade_data: referenceUiConfig('mobile_brigade_data', {
      title: 'Данные Мобильных бригад',
      description: 'Накопительный внутренний набор фактических данных Мобильных бригад содержит 15 бизнес-колонок, 4 служебных поля, 2 поля связи с ITSM и 2 аналитических поля для KPI. Свежие выгрузки обновляют существующие строки по устойчивому recordKey, добавляют новые и не удаляют незатронутую историю. Набор накапливает все уникальные задачи МБ за весь период; одна заявка ITSM может быть представлена несколькими задачами.',
      freshnessPolicy: 'source_filename',
      generatedOnly: true
    }),
    itsm_data: referenceUiConfig('itsm_data', {
      title: 'Данные ITSM',
      description: 'Накопительный внутренний набор обработанных данных ITSM Sirius. Содержит 52 поля на уровне заявки: 17 исходных полей жизненного цикла и контекста, 34 расчётных поля ITSM и признак наличия заявки в Мобильных бригадах. Свежие выгрузки обновляют существующие заявки по устойчивому номеру «Номер», добавляют новые и не удаляют незатронутую историю.',
      freshnessPolicy: 'max_date',
      generatedOnly: true,
      externalDataset: true
    }),
    kpi_source: referenceUiConfig('kpi_source', {
      title: 'Источник для KPI',
      description: 'Агрегированный набор исходных числителей, знаменателей и временных сумм для Reliability Report. Формируется автоматически из той же обработки ITSM и не содержит готовых коэффициентов KPI.',
      freshnessPolicy: 'max_date',
      generatedOnly: true,
      externalDataset: true
    })
  };

  const MOBILE_BRIGADE_DATA_SCHEMA = {
    version: referenceConfig.mobile_brigade_data.schemaVersion,
    keyField: referenceDatasetCatalog.get('mobile_brigade_data').keyField,
    output: [
      ['site', 'Участок', 'text'],
      ['taskNumber', 'Номер задачи', 'text|null'],
      ['taskForShiftId', 'ID задачи МБ', 'text|null'],
      ['recordKey', 'Устойчивый ключ записи', 'text'],
      ['request', 'Заявка', 'text|null'],
      ['requestUrl', 'Ссылка на заявку', 'text|null'],
      ['factDate', 'Фактическая дата', 'date|text|null'],
      ['laborHours', 'ФактТрудочас, чел-час', 'number|null'],
      ['astroHours', 'ФактАстрочас, час', 'number|null'],
      ['equipmentPlacement', 'Навесное / Стационарное', 'text|null'],
      ['equipmentUnit', 'Единица оборудования', 'text|null'],
      ['equipmentType', 'Тип оборудования', 'text|null'],
      ['transport', 'Транспорт', 'text|null'],
      ['equipment', 'Оборудование', 'text|null'],
      ['element', 'Элемент', 'text|null'],
      ['fault', 'Неисправность', 'text|null'],
      ['incidentReason', 'Причина инцидента', 'text|null'],
      ['description', 'Описание', 'text|null'],
      ['combinedComment', 'Объединённый комментарий', 'text|null'],
      ['itsmCreatedAt', 'Дата создания заявки ITSM', 'date|text|null'],
      ['preBacklogAge', 'Возраст предварительного бэклога', 'number|text|null'],
      ['finalTaskType', 'Итоговый тип задачи', 'text|null'],
      ['laborState', 'Состояние трудозатрат', 'text|null']
    ]
  };

  const RECLASSIFICATION_SCHEMA = {
    version: referenceConfig.reclassification.schemaVersion,
    anchorHeaders: [
      'Дата регистрации',
      'Дата выполнения обращения',
      'Номер'
    ],
    columns: [
      ['dateRegistered', 'Дата регистрации', 'date|null'],
      ['dateCompleted', 'Дата выполнения обращения', 'date|null'],
      ['territory', 'Территории MES', 'text|null'],
      ['number', 'Номер', 'text|null'],
      ['equipment', 'Наименование оборудования', 'text|null'],
      ['element', 'Элемент', 'text|null'],
      ['fault', 'Неисправность', 'text|null'],
      ['incidentReason', 'Причина инцидента', 'text|null'],
      ['description', 'Категорированная информация обращения.Описание', 'text|null'],
      ['closureNote', 'Примечания к закрытию (объединённые с доп)', 'text|null']
    ]
  };

  const INITIATORS_SCHEMA = {
    version: referenceConfig.initiators.schemaVersion,
    requiredHeaders: [
      'Инициатор (открыл)',
      'Группа инициаторов',
      'Группа инициаторов с коментами',
      'комменты'
    ],
    output: [
      ['initiator', 'Инициатор', 'text|null'],
      ['group', 'Группа инициаторов', 'text|null'],
      ['groupDetailed', 'Группа инициаторов с коментами', 'text|null'],
      ['comments', 'Комментарии', 'text|null']
    ]
  };

  const EXCEPTIONS_SCHEMA = {
    version: referenceConfig.exceptions.schemaVersion,
    requiredHeaders: [
      '№',
      'Ислючение для [Причина инцидента]',
      'Решение',
      'Категория'
    ],
    headerAliases: {
      exception: [
        'Ислючение для [Причина инцидента]',
        'Исключение для [Причина инцидента]'
      ]
    },
    output: [
      ['number', '№', 'number|text|null'],
      ['exception', 'Исключение для [Причина инцидента]', 'text'],
      ['decision', 'Решение', 'text|null'],
      ['category', 'Категория', 'text|null']
    ]
  };

  const PROBLEM_GRADE_SCHEMA = {
    version: referenceConfig.problem_grade.schemaVersion,
    anchorHeaders: [
      'Основание № IT-проблемы',
      'Наименование оборудования',
      'Элемент',
      'Неисправность',
      'Причина'
    ],
    columns: [
      ['legacyKey', 'Вспомогательный столбец', 'text|null', false],
      ['problemId', 'Основание № IT-проблемы', 'text|null', true],
      ['problemStatus', 'Статус PRB', 'text|null', false],
      ['problemName', 'Имя ИТ-проблемы', 'text|null', false],
      ['equipment', 'Наименование оборудования', 'text|null', true],
      ['element', 'Элемент', 'text|null', true],
      ['fault', 'Неисправность', 'text|null', true],
      ['reason', 'Причина', 'text|null', true],
      ['classifierConfirmation', 'Подтверждение классификатора', 'text|null', false],
      ['normalizationDecision', 'Решение о нормализации', 'text|null', false],
      ['primaryExclusion', 'Первичное исключение (Исключение по расчёту общего ВБР см. сервис-лист)', 'text|null', false]
    ]
  };

  const CUSTOMERS_SCHEMA = {
    version: referenceConfig.customers.schemaVersion,
    requiredHeaders: [
      'Рудник',
      'Заказчик (для нас)',
      'Заказчик кратко',
      'Заказчик полностью'
    ],
    headerAliases: {
      customerInternal: ['Заказчик (для нас)', 'Заказчик']
    },
    output: [
      ['mine', 'Рудник', 'text', true],
      ['mineSource', 'Рудник (как в Excel)', 'text', true],
      ['customerInternal', 'Заказчик (для нас)', 'text|null', false],
      ['customerShort', 'Заказчик кратко', 'text|null', false],
      ['customerFull', 'Заказчик полностью', 'text|null', false],
      ['customerCode', 'Заказчик (legacy alias)', 'text|null', false]
    ]
  };

  const TYPE_REQUEST_SCHEMA = {
    version: referenceConfig.type_request.schemaVersion,
    requiredHeaders: [
      'Краткое описание (типовой запрос)',
      'Вид работ'
    ],
    headerAliases: {
      shortDescription: ['Краткое описание (типовой запрос)', 'Краткое описание']
    },
    output: [
      ['requestKey', 'Ключ краткого описания', 'text', true],
      ['shortDescription', 'Краткое описание (типовой запрос)', 'text', true],
      ['workType', 'Вид работ', 'text', true]
    ]
  };

  const DRIVERS_SCHEMA = {
    version: referenceConfig.drivers.schemaVersion,
    requiredHeaders: [
      'Наименование типа узла/бъекта/оборудования',
      'Сервис',
      'Система'
    ],
    output: [
      ['mine', 'Рудник', 'text', true],
      ['name', 'Наименование', 'text', true],
      ['service', 'Сервис', 'text|null', false],
      ['system', 'Система', 'text', true],
      ['value', 'Значение', 'number|text|null', false],
      ['unit', 'Ед.', 'text|null', false]
    ]
  };
