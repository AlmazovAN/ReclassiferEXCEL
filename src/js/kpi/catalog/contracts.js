// FILE CONTRACT: auditable declarations of existing KPI calculation paths.
// Owns: dataset fields, joins, filters, component steps, aggregation and time semantics.
// Reads: nothing; definitions/formula versions are bound in catalog/index.js.
// Writes: no Dataset state. This is NOT an expression interpreter.
// Must not: calculate KPI values, read SQLite/Excel, invent approved targets or change formulas.
(() => {
  'use strict';

  const f = (field, purpose, nullPolicy = 'preserve', sourceColumn = null) =>
    ({ field, purpose, nullPolicy, sourceColumn });
  const src = (datasetId, grain, fields) => ({ datasetId, grain, fields });
  const step = (id, operation, inputs, output, description, handlerRef = null, parameters = {}) =>
    ({ id, operation, inputs, output, description, handlerRef, parameters });
  const predicate = (id, stage, datasetId, field, operator, value, effect, note, appliesTo = null) =>
    ({ id, stage, field: { datasetId, field }, operator, value, effect, note, appliesTo });
  const grain = ['period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'];

  const ITSM_DIMENSIONS = [
    f('division', 'Филиал'),
    f('territory', 'Рудник'),
    f('sdgrService', 'Класс и тип оборудования'),
    f('reclassifiedEquipment', 'Имя оборудования после реклассификации'),
    f('sourceEquipment', 'Резервное имя оборудования')
  ];
  const ITSM_SLA = src('itsm_data', ['number'], [
    f('closedAt', 'Дата учёта показателя'),
    f('number', 'Ключ обращения'),
    f('slaOverdue', 'Известный статус просрочки по разрешению', 'exclude', 'Просрочен по разрешению'),
    ...ITSM_DIMENSIONS
  ]);
  // The calculation consumes classificationQuality (assigned by the ITSM
  // transformation). Raw descriptions and classifier values are audit context
  // for the ENGINEERING verification; they are not parsed by the KPI formula.
  const ITSM_CLASSIFICATION_CONTEXT = [
    f('sourceEquipment', 'Исходная категория оборудования; контекст проверки, не дополнительный фильтр'),
    f('sourceElement', 'Исходный элемент классификатора; контекст инженерной проверки'),
    f('sourceFault', 'Исходная неисправность; контекст инженерной проверки'),
    f('sourceReason', 'Исходная причина инцидента; контекст инженерной проверки'),
    f('description', 'Текст обращения; используется при инженерной проверке, не анализируется формулой KPI'),
    f('closureNote', 'Описание результата закрытия; контекст инженерной проверки'),
    f('reclassifiedEquipment', 'Итоговое наименование после реклассификации'),
    f('reclassifiedElement', 'Итоговый элемент после реклассификации'),
    f('reclassifiedFault', 'Итоговая неисправность после реклассификации'),
    f('reclassifiedReason', 'Итоговая причина после реклассификации')
  ];
  const ITSM_CLASSIFICATION = src('itsm_data', ['number'], [
    f('number', 'Номер обращения ITSM Сириус; одна запись обращения'),
    f('completedAt', 'Основная дата учёта качества классификации'),
    f('closedAt', 'Резервная дата при отсутствии или невалидности даты выполнения'),
    f('classificationQuality', 'Расчётная категория результата инженерной проверки A/B/C/D', 'exclude'),
    ...ITSM_CLASSIFICATION_CONTEXT,
    ...ITSM_DIMENSIONS.filter(item => !['sourceEquipment','reclassifiedEquipment'].includes(item.field))
  ]);
  const ITSM_CGPS_CLASSIFICATION = src('itsm_data', ['number'], [
    f('number', 'Номер обращения ITSM Сириус для сверки с МБ', 'exclude'),
    f('createdAt', 'Дата создания для подтверждения полноты выгрузки МБ'),
    f('completedAt', 'Приоритетная дата учёта качества классификации'),
    f('closedAt', 'Резервная дата учёта качества классификации'),
    f('classificationQuality', 'Категория A/B/C/D', 'exclude'),
    f('initiatorGroup', 'Расчётная группа инициаторов для RITM вместо INC; формируется из поля «Открыл» через справочник инициаторов'),
    f('openedBy', 'Источник определения расчётной группы инициаторов, не самостоятельный фильтр интеграции'),
    ...ITSM_CLASSIFICATION_CONTEXT,
    ...ITSM_DIMENSIONS.filter(item => !['sourceEquipment','reclassifiedEquipment'].includes(item.field))
  ]);
  const MB_CGPS_CLASSIFICATION = src('mobile_brigade_data', ['recordKey'], [
    f('request', 'Номер обращения ITSM Сириус, на который ссылается задача МБ; сравнивается с ITSM.number', 'exclude')
  ]);
  const ITSM_FAILURE = src('itsm_data', ['number'], [
    f('completedAt', 'Приоритетная дата учёта отказа'),
    f('closedAt', 'Резервная дата учёта отказа, если дата выполнения отсутствует'),
    f('typeAfterReclassification', 'Итоговый тип INC/RITM после инженерной реклассификации'),
    f('classificationQuality', 'Результат сравнения исходной и инженерной классификации'),
    f('reclassifiedElement', 'Итоговый элемент классификатора'),
    f('reclassifiedFault', 'Итоговая неисправность классификатора'),
    f('reclassifiedReason', 'Итоговая причина, по которой ITSM применяет правила исключений'),
    f('sputnikVbrDecision', 'Результат правил исключений: Exceptions; для Северного — специальные правила'),
    ...ITSM_DIMENSIONS
  ]);
  const DRIVERS = src('drivers', ['mine','name','service','system'], [
    f('mine', 'Рудник (физический рудник, без «Все рудники»)', 'exclude', 'Рудник'),
    f('name', 'Наименование из ITSM, соответствует «Наим1»', 'exclude', 'Наименование'),
    f('service', 'Сервис: навесное или стационарное оборудование', 'exclude', 'Сервис'),
    f('system', 'Система (несколько строк одной группы суммируются)', 'preserve', 'Система'),
    f('value', 'Численность оборудования; только неотрицательное целое', 'exclude', 'Значение'),
    f('unit', 'Единица измерения; только «шт»', 'exclude', 'Ед.'),
    f('valueState', 'Нормализованное состояние численного значения', 'exclude')
  ]);
  const ITSM_KTG = src('itsm_data', ['number'], [
    f('number','Уникальный номер обращения; повторные строки не удваиваются','exclude','Номер'),
    f('createdAt','Месяц учёта продолжительности обращения','unavailable','Дата создания Вызова'),
    f('completedAt','Дата выполнения; завершённое обращение','preserve','Дата выполнения обращения'),
    f('closedAt','Резервная дата окончания','preserve','Дата закрытия'),
    f('territory','Рудник через Территории MES','exclude','Территории MES'),
    f('reclassifiedEquipment','Наим1, наименование оборудования после реклассификации','exclude','Наим1'),
    f('typeAfterReclassification','Итоговый INC имеет приоритет перед видом работ','exclude','INC после рекласс'),
    f('workType','Вид работ для не-INC: плановое ТО, внеплановое ТО, прочее; исключить монтаж/ПО доступ/консультацию','preserve','ТО/ Монтаж/ Разовое'),
    f('preBacklogHours','Продолжительность от создания до выполнения, иначе закрытия, в часах','unavailable','Время предбэклога (откр-выполн), час'),
    f('sdgrService','Сервис для определения класса оборудования'),
    f('division','Филиал')
  ]);
  const MB = src('mobile_brigade_data', ['recordKey'], [
    f('recordKey', 'Уникальная задача МБ', 'exclude'),
    f('factDate', 'Дата фактического выполнения', 'exclude'),
    f('site', 'Рудник'),
    f('finalTaskType', 'Итоговый вид работы'),
    f('laborHours', 'Трудоёмкость, человеко-часы', 'unavailable'),
    f('laborState', 'Состояние значения трудоёмкости', 'exclude'),
    f('equipmentPlacement', 'Тип размещения оборудования'),
    f('equipmentType', 'Тип оборудования'),
    f('transport', 'Навесной объект'),
    f('equipmentUnit', 'Стационарный объект'),
    f('equipment', 'Общий объект')
  ]);
  const ITSM_PRB = src('itsm_data', ['number'], [
    f('number', 'Номер обращения для связи с МБ', 'exclude'),
    f('problemLink', 'Номер PRB; учитывается только идентификатор PRB'),
    f('division', 'Филиал'),
    f('territory', 'Рудник'),
    f('sdgrService', 'Класс оборудования')
  ]);
  const MB_PRB = src('mobile_brigade_data', ['recordKey'], [
    ...MB.fields,
    f('request', 'Номер обращения для обогащения через ITSM')
  ]);

  const TIME = (datasetId, field, rollingMethod, historicalSupported = true) => ({
    periodGrain: 'month',
    basis: { datasetId, field },
    incompletePeriod: 'include-with-label', // Existing month bucketing; not an approved reporting cut-off.
    historicalSupported,
    previous: { selection: 'previous-calendar-period', whenMissing: 'null-with-reason' },
    rolling: { method: rollingMethod, defaultWindow: 4, minWindow: 2, requireCompleteWindow: true },
    forecast: { status: 'not-defined', methodId: null, horizon: null, minPeriods: null }
  });
  const aggregate = (componentMethods, combinePeriods, dims = grain) => ({
    grain: dims, componentMethods, combinePeriods, missingPolicy: 'skip-with-diagnostic'
  });
  const queryFilter = (datasetId, field, inputKey) =>
    predicate('scope-' + datasetId + '-' + inputKey, 'query', datasetId, field,
      'eq', '$query.filters.' + inputKey, 'include', 'Фильтр применяется после подготовки компонентов.');
  const ITSM_SCOPE = [
    queryFilter('sla', 'mine', 'mine'),
    queryFilter('sla', 'equipmentClass', 'equipmentClass'),
    queryFilter('sla', 'equipmentType', 'equipmentType'),
    queryFilter('sla', 'equipmentName', 'equipmentName'),
    queryFilter('sla', 'branch', 'branch')
  ];
  const SCOPE = (componentId, includeBranch = false, mineField = 'mine') => [
    queryFilter(componentId, mineField, 'mine'),
    queryFilter(componentId, 'equipmentClass', 'equipmentClass'),
    queryFilter(componentId, 'equipmentType', 'equipmentType'),
    queryFilter(componentId, 'equipmentName', 'equipmentName'),
    ...(includeBranch ? [queryFilter(componentId, 'branch', 'branch')] : [])
  ];
  const laborSteps = (label, types = null) => [
    step('select', 'FILTER', ['mobile_brigade_labor'], 'selectedRows', 'Выбрать месяцы и доступные измерения.'),
    ...(types ? [step('subset', 'FILTER', ['selectedRows', 'finalTaskType'], 'targetRows',
      'Отобрать виды работ для числителя: ' + types.join(', ') + '.', null, { acceptedTypes: types })] : []),
    step('sum', 'SUM', [types ? 'targetRows.laborHours' : 'selectedRows.laborHours'], 'laborHours',
      'Сумма только usable laborHours; непригодные строки остаются в диагностике.'),
    step('output', 'IDENTITY', ['laborHours'], 'value', label)
  ];
  const laborFilter = types => types ? [
    predicate('task-types', 'query', 'mobile_brigade_labor', 'finalTaskType', 'in', types,
      'include', 'Ограничение только для компонента выбранного вида работ; общий итог не уменьшается.', 'numerator')
  ] : [];
  const COMMON_LABOR_SCOPE = SCOPE('mobile_brigade_labor', false, 'site');
  const baseLabor = (calc, steps, types = null, ratio = false) => ({
    preparationHandler: 'ReclassifierKpiPrepareLabor.prepare',
    formulaHandler: 'ReclassifierKpiCalculateLabor.' + calc,
    sources: [MB], joins: [],
    filters: [...COMMON_LABOR_SCOPE, ...laborFilter(types)],
    steps,
    aggregation: aggregate(
      ratio ? { avrLaborHours: 'SUM', totalLaborHours: 'SUM' } : { laborHours: 'SUM' },
      ratio ? 'sum-components-then-formula' : 'sum-values',
      ['period','site','finalTaskType','equipmentPlacement','equipmentClass','equipmentType','equipmentName']
    ),
    temporal: TIME('mobile_brigade_data','factDate', ratio ? 'ratio-of-sums' : 'average'),
    zeroDenominator: 'unavailable'
  });

  const definitions = {
    vbr: {
      preparationHandler: 'ReclassifierKpiPrepareFailures.prepare + ReclassifierKpiPrepareEquipment.prepare',
      formulaHandler: 'ReclassifierKpiCalculateVbr.calculate',
      sources: [ITSM_FAILURE, DRIVERS], joins: [],
      filters: [
        predicate('inc-only', 'facts', 'itsm_data', 'typeAfterReclassification', 'eq', 'INC', 'include', 'Только итоговые INC из поля «INC после рекласс», сформированного инженерной реклассификацией.'),
        predicate('confirmed-failure', 'facts', 'itsm_data', 'sputnikVbrDecision', 'eq', 'Считать отказом', 'include', 'Только «Считать отказом» из «ИсклВБР-Спутник». Исключения определяются по «Прич1»: справочник Exceptions, а для Северного — специальные правила ITSM.'),
        predicate('physical-mine', 'facts', 'drivers', 'mine', 'ne', 'Все рудники', 'include', 'Не суммировать контрольную колонку «Все рудники» с физическими рудниками.'),
        predicate('count-unit', 'facts', 'drivers', 'unit', 'eq', 'шт', 'include', 'Только неотрицательное целое значение; километры и другие единицы измерения исключаются.'),
        predicate('known-service', 'facts', 'drivers', 'service', 'not-null', null, 'include', 'Сервис определяет класс и тип оборудования.'),

        ...SCOPE('failure_events'),
        ...SCOPE('equipment_population', false, 'organizationalUnit')
      ],
      steps: [
        step('event-date', 'MAP', ['itsmFacts.completedAt','itsmFacts.closedAt'], 'failurePeriod', 'Дата выполнения имеет приоритет; при отсутствии или невалидности берётся дата закрытия. Без обеих дат отказ не включается в период.', 'ReclassifierKpiPrepareFailures.prepare'),
        step('failures', 'FILTER', ['itsmFacts', 'failurePeriod'], 'failureRows', 'Итоговый INC и решение «Считать отказом», сгруппированные по месяцу выбранной даты.', 'ReclassifierKpiPrepareFailures.prepare'),
        step('driver-valid', 'FILTER', ['drivers.mine','drivers.name','drivers.service','drivers.value','drivers.unit'], 'validDriverRows', 'Физические рудники, известный класс оборудования, только целочисленные значения шт.; «Все рудники» пропускается.', 'ReclassifierKpiSourceFacts.driverPopulationSnapshot'),
        step('equipment', 'GROUP', ['validDriverRows.mine','validDriverRows.service','validDriverRows.name','validDriverRows.value'], 'equipmentPopulation', 'Сумма шт. по руднику, сервису и наименованию оборудования, без присоединения к событиям ITSM.', 'ReclassifierKpiPrepareEquipment.prepare'),
        step('count-failures', 'SUM', ['failureRows.failureCount'], 'failureCount', 'Отказы за выбранные месяцы.'),
        step('count-equipment', 'SUM', ['equipmentPopulation.equipmentCount'], 'baseEquipmentCount', 'Численность парка по текущему справочнику Drivers.'),
        step('exposure', 'MULTIPLY', ['baseEquipmentCount','monthsInPeriod'], 'equipmentCount', 'Для диапазона месяцев считать оборудование-месяцы: число шт. × количество месяцев. Для одного месяца — число шт.'),
        step('divide', 'DIVIDE', ['failureCount','equipmentCount'], 'failureRatio', 'Частота отказов относительно парка.'),
        step('subtract', 'SUBTRACT', ['1','failureRatio'], 'reliabilityRatio', 'Единица минус доля отказов.'),
        step('multiply', 'MULTIPLY', ['reliabilityRatio','100'], 'value', 'ВБР в процентах.')
      ],
      aggregation: aggregate({ failureCount:'SUM', equipmentCount:'SUM' }, 'sum-components-then-formula'),
      temporal: {
        ...TIME('itsm_data','completedAt','unavailable',false),
        currentMonthForecast:{
          status:'experimental',methodId:'monthly-components-remaining-days',
          methodVersion:'1.0.0',horizon:'end-of-current-calendar-month',
          minHistoryMonths:6,validationMonths:2,
          populationBasis:'fixed-drivers-reference',
          note:'Прогноз завершения незакрытого месяца по подтверждённым отказам; не прогноз фактического KPI и не история состава оборудования.'
        },
        periodBindings:[
          { datasetId:'itsm_data', field:'completedAt', purpose:'Основной месяц отказа по дате выполнения' },
          { datasetId:'itsm_data', field:'closedAt', purpose:'Резервный месяц отказа, когда дата выполнения отсутствует или невалидна' },
          { datasetId:'drivers', field:'value', purpose:'Фиксированная численность шт. на каждый выбранный месяц; справочник не содержит исторических дат' }
        ]
      },
      zeroDenominator: 'unavailable'
    },
    ktg: {
      preparationHandler:'ReclassifierKpiPrepareKtg.prepare',
      formulaHandler:'ReclassifierKpiCalculateKtg.calculate',
      sources:[ITSM_KTG,DRIVERS],
      joins:[],
      filters:[
        predicate('incident-priority','preparation','itsm_data','typeAfterReclassification','eq','INC','include',
          'INC после рекласс учитывается всегда, независимо от вида работ и решения ВБР.'),
        predicate('scheduled-maintenance','preparation','itsm_data','workType','in',['Плановое ТО','ТО по графику'],'include',
          'Для не-INC: фактическое время планового ТО.'),
        predicate('unscheduled-maintenance','preparation','itsm_data','workType','in',['Внеплановое ТО','ТО вне графика'],'include',
          'Для не-INC: продолжительность внепланового ТО.'),
        predicate('other','preparation','itsm_data','workType','in',['Прочее','пусто','#Н/Д','нет данных'],'include',
          'Для не-INC: прочие работы и неопределённый вид работ.'),
        predicate('excluded','preparation','itsm_data','workType','in',['Монтаж','ПО доступ','Консультация'],'exclude',
          'Исключить только не-INC; INC всегда имеет приоритет.'),
        predicate('physical-mine','facts','drivers','mine','ne','Все рудники','include',
          'Не удваивать физическую численность итоговой строкой справочника.'),
        predicate('count-unit','facts','drivers','unit','eq','шт','include',
          'Количество должно быть неотрицательным целым в штуках.'),
        ...SCOPE('ktg_work'),...SCOPE('ktg_fleet')
      ],
      steps:[
        step('drivers','MAP',['drivers.mine','drivers.name','drivers.service','drivers.value','drivers.unit'],
          'ktgFleet','Фиксированная численность Drivers по руднику, сервису и Наим1; контроль единиц и агрегатов.',
          'ReclassifierKpiPrepareEquipment.prepare'),
        step('classify','MAP',['itsm_data.typeAfterReclassification','itsm_data.workType'],
          'workCategory','INC первичен; остальные обращения разделить на плановое ТО, внеплановое ТО, прочее или исключённые.',
          'ReclassifierKpiPrepareKtg.prepare'),
        step('match','FILTER',['itsm_data.territory','itsm_data.reclassifiedEquipment','ktgFleet'],
          'matchedItsm','Сопоставить ITSM и Drivers по руднику и Наим1, уточнить класс по сервису; неоднозначности диагностировать.',
          'ReclassifierKpiPrepareKtg.prepare'),
        step('duration','MAP',['itsm_data.createdAt','itsm_data.completedAt','itsm_data.closedAt','itsm_data.preBacklogHours'],
          'ktgWork','Фактические часы готового preBacklogHours; месяц по созданию; незавершённые/некорректные не равны нулю.',
          'ReclassifierKpiPrepareKtg.prepare'),
        step('calendar','MULTIPLY',['equipmentUnits','24','calendarDays'],'calendarHours','КФРВ, календарные часы оборудования.'),
        step('actual','ADD',['incidentHours','actualMaintenanceHours','unplannedMaintenanceHours','otherHours'],
          'actualDowntimeHours','INC + ТО факт (плановое) + ТО внеплановое + Прочее.'),
        step('plan','IDENTITY',['actualMaintenanceHours'],'plannedMaintenanceHours',
          'Временное допущение: ТО план = фактическая продолжительность планового ТО из ITSM.'),
        step('numerator','SUBTRACT',['calendarHours','actualDowntimeHours'],'productiveHours','КФРВ минус фактические часы работ.'),
        step('denominator','SUBTRACT',['calendarHours','plannedMaintenanceHours'],'availableHours','КФРВ минус ТО план.'),
        step('ratio','DIVIDE',['productiveHours','availableHours'],'ratio','Работоспособный / доступный фонд.'),
        step('percent','MULTIPLY',['ratio','100'],'value','КТГ в процентах.')
      ],
      aggregation:aggregate({
        calendarHours:'SUM',incidentHours:'SUM',actualMaintenanceHours:'SUM',
        plannedMaintenanceHours:'SUM',unplannedMaintenanceHours:'SUM',
        otherHours:'SUM',actualDowntimeHours:'SUM'
      },'sum-components-then-formula',['period','mine','equipmentClass','equipmentType','equipmentName']),
      temporal:{
        ...TIME('itsm_data','createdAt','ratio-of-sums',false),
        currentMonthForecast:{
          status:'experimental',methodId:'monthly-components-remaining-days',
          methodVersion:'1.0.0',horizon:'end-of-current-calendar-month',
          minHistoryMonths:6,validationMonths:2,
          populationBasis:'fixed-drivers-reference',
          note:'Прогноз завершения незакрытого месяца по длительностям из preBacklogHours; непроверенные длительности диагностируются отдельно.'
        },
        periodBindings:[
          {datasetId:'itsm_data',field:'createdAt',purpose:'Месяц учёта продолжительности обращения'},
          {datasetId:'itsm_data',field:'preBacklogHours',purpose:'Сумма часов обращения без повторного пересчёта дат'},
          {datasetId:'drivers',field:'value',purpose:'Фиксированная численность; не исторический учёт оборудования'}
        ]
      },
      zeroDenominator:'unavailable'
    },
    sla: {
      preparationHandler:'ReclassifierKpiPrepareSla.prepare',
      formulaHandler:'ReclassifierKpiCalculateSla.calculate',
      sources:[ITSM_SLA], joins:[],
      filters:[
        predicate('known-sla','facts','itsm_data','slaOverdue','not-null',null,'include','Unknown SLA вне знаменателя; источник может быть Full Dataset.'),
        ...ITSM_SCOPE
      ],
      steps:[
        step('select','FILTER',['itsmFacts','closedAt','slaState'],'eligibleRows','Известный SLA и дата закрытия.', 'ReclassifierKpiPrepareSla.prepare'),
        step('success','COUNT',['eligibleRows','slaState=success'],'slaSuccessCount','Соблюдённые сроки.'),
        step('total','COUNT',['eligibleRows'],'slaTotalCount','Все строки с известным статусом.'),
        step('divide','DIVIDE',['slaSuccessCount','slaTotalCount'],'ratio','Числитель / знаменатель.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Перевод в %.')
      ],
      aggregation:aggregate({slaSuccessCount:'SUM',slaTotalCount:'SUM'},'sum-components-then-formula'),
      temporal:TIME('itsm_data','closedAt','ratio-of-sums'),
      zeroDenominator:'unavailable'
    },
    classification_quality: {
      preparationHandler:'ReclassifierKpiPrepareClassification.prepare',
      formulaHandler:'ReclassifierKpiCalculateClassificationQuality.calculate',
      sources:[ITSM_CLASSIFICATION],joins:[],
      filters:[
        predicate('approved-denominator','facts','itsm_data','classificationQuality','in',
          ['INC без изм','INC не классифицирован','INC с исправлением','RITM вместо INC'],
          'include','Категории в знаменателе; остальные not-applicable.'),
        ...SCOPE('classification_quality',true)
      ],
      steps:[
        step('period','MAP',['itsmFacts.completedAt','itsmFacts.closedAt'],'classificationPeriod','Дата выполнения приоритетна, при отсутствии или невалидности — дата закрытия; без обеих дат обращение исключается.', 'ReclassifierKpiPrepareClassification.prepare'),
        step('select','FILTER',['itsmFacts','classificationPeriod','classificationIncluded'],'eligibleRows','Только четыре учитываемые категории с известным периодом выполнения/закрытия.', 'ReclassifierKpiPrepareClassification.prepare'),
        step('categories','GROUP',['eligibleRows.classificationCode'],'categoriesABCD','Разбивка: A=INC без изм; B=INC с исправлением; C=INC не классифицирован; D=RITM вместо INC.', 'ReclassifierKpiPrepareClassification.prepare'),
        step('success','COUNT',['eligibleRows','classificationCode=A'],'classificationSuccessCount','A: INC без изменений.'),
        step('total','COUNT',['eligibleRows'],'classificationTotalCount','A + B + C + D.'),
        step('divide','DIVIDE',['classificationSuccessCount','classificationTotalCount'],'ratio','Числитель / знаменатель.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Перевод в %.')
      ],
      aggregation:aggregate({
        classificationSuccessCount:'SUM',classificationTotalCount:'SUM',
        classificationIncUnchangedCount:'SUM',classificationIncCorrectedCount:'SUM',
        classificationIncUnclassifiedCount:'SUM',classificationRitmInsteadOfIncCount:'SUM'
      },'sum-components-then-formula'),
      temporal:{
        ...TIME('itsm_data','completedAt','ratio-of-sums'),
        periodBindings:[
          {datasetId:'itsm_data',field:'completedAt',purpose:'Месяц выполнения, приоритетная дата общего показателя'},
          {datasetId:'itsm_data',field:'closedAt',purpose:'Месяц закрытия, если дата выполнения отсутствует или некорректна'}
        ]
      },
      zeroDenominator:'unavailable'
    },
    classification_quality_cgps: {
      preparationHandler:'ReclassifierKpiPrepareClassification.prepareCgps',
      formulaHandler:'ReclassifierKpiCalculateClassificationQualityCgps.calculate',
      sources:[ITSM_CGPS_CLASSIFICATION,MB_CGPS_CLASSIFICATION],
      joins:[{
        id:'itsm-mb-request-presence',
        left:{datasetId:'itsm_data',field:'number'},
        right:{datasetId:'mobile_brigade_data',field:'request'},
        joinType:'LOOKUP',
        cardinality:'1:N',
        onUnmatched:'preserve-null',
        onDuplicate:'retain-with-justification',
        justification:'Проверяется точное совпадение нормализованного номера ITSM с заявкой в загруженном Dataset МБ без проверки дат. Несколько задач не умножают обращения. Если номер не найден — исключить; если Dataset отсутствует — расчёт недоступен. Неполная выгрузка ограничивает полноту выборки.'
      }],
      filters:[
        predicate('approved-denominator','facts','itsm_data','classificationQuality','in',
          ['INC без изм','INC с исправлением','INC не классифицирован','RITM вместо INC'],
          'include','Только четыре категории общей методики.'),
        predicate('mb-confirmed','preparation','mobile_brigade_data','request','not-null',null,
          'include','Обращение учитывается только при совпадении номера в загруженном Dataset МБ. Без Dataset результат недоступен. Пустые номера ITSM исключаются отдельно.'),
        predicate('ritm-cgps-only','preparation','itsm_data','initiatorGroup','eq','ЦГПС',
          'include','Для RITM вместо INC учитывать только подтверждённую группу «ЦГПС». Пустая/неопределённая группа исключается и диагностируется отдельно. К трём категориям INC условие не применяется.', 'ritm-only'),
        ...SCOPE('classification_quality_cgps',true)
      ],
      steps:[
        step('period','MAP',['itsm_data.completedAt','itsm_data.closedAt'],'classificationPeriod',
          'Месяц выполнения, иначе месяц закрытия.', 'ReclassifierKpiPrepareClassification.prepareCgps'),
        step('mb-index','JOIN',['mobile_brigade_data.request','itsm_data.number'],
          'mbPresence','Проверить точное равенство номеров в текущем Dataset МБ. Даты и наименование оборудования не участвуют.','ReclassifierItsmMbPresence.evaluate'),
        step('eligible','FILTER',['classificationPeriod','classificationQuality','mbPresence','initiatorGroup'],
          'included','A/B/C — все группы инициаторов, D — только ЦГПС; связь МБ подтверждена.'),
        step('components','GROUP',['included.classificationCode'],'componentsABCD',
          'Количество A, B, C, D, отдельно причины исключения.'),
        step('ratio','DIVIDE',['classificationSuccessCount','classificationTotalCount'],'ratio',
          'Числитель и знаменатель — только выбранные обращения ЦГПС; не усреднять проценты.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Процент качества классификации ЦГПС.')
      ],
      aggregation:aggregate({
        classificationSuccessCount:'SUM',classificationTotalCount:'SUM',
        classificationIncUnchangedCount:'SUM',classificationIncCorrectedCount:'SUM',
        classificationIncUnclassifiedCount:'SUM',classificationRitmInsteadOfIncCount:'SUM',
        excludedNoMbCount:'SUM',unknownMbCoverageCount:'SUM',excludedOtherInitiatorRitmCount:'SUM',
        excludedUnknownInitiatorRitmCount:'SUM',excludedMissingRequestCount:'SUM'
      },'sum-components-then-formula'),
      temporal:{
        ...TIME('itsm_data','completedAt','ratio-of-sums'),
        periodBindings:[
          {datasetId:'itsm_data',field:'completedAt',purpose:'Основной месяц выполнения'},
          {datasetId:'itsm_data',field:'closedAt',purpose:'Резервный месяц закрытия'}
        ]
      },
      zeroDenominator:'unavailable'
    },
    total_labor: baseLabor('calculateTotal',laborSteps('Вся пригодная трудоёмкость'),null,false),
    avr_labor: baseLabor('calculateAvr',laborSteps('Трудоёмкость АВР',['АВР']),['АВР'],false),
    maintenance_labor: baseLabor('calculateMaintenance',laborSteps('ТО по графику и ТО вне графика',['ТО по графику','ТО вне графика']),['ТО по графику','ТО вне графика'],false),
    corrective_labor: baseLabor('calculateCorrective',laborSteps('Корректирующее воздействие',['Корректирующее воздействие']),['Корректирующее воздействие'],false),
    avr_share: {
      ...baseLabor('calculateAvrShare',[
        step('select','FILTER',['mobile_brigade_labor'],'selectedRows','Все допустимые трудозатраты.'),
        step('total','SUM',['selectedRows.laborHours'],'totalLaborHours','Знаменатель: вся пригодная трудоёмкость.'),
        step('avr','SUM',['selectedRows where finalTaskType=АВР'],'avrLaborHours','Числитель: только АВР.'),
        step('divide','DIVIDE',['avrLaborHours','totalLaborHours'],'ratio','Доля АВР.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Проценты.')
      ],['АВР'],true),
      aggregation:aggregate({avrLaborHours:'SUM',totalLaborHours:'SUM'},'sum-components-then-formula',
        ['period','site','finalTaskType','equipmentPlacement','equipmentClass','equipmentType','equipmentName'])
    },
    reactive_share: {
      ...baseLabor('calculateReactiveShare',[
        step('select','FILTER',['mobile_brigade_labor'],'selectedRows','Вся пригодная трудоёмкость.'),
        step('total','SUM',['selectedRows.laborHours'],'totalLaborHours','Знаменатель.'),
        step('avr','SUM',['selectedRows where finalTaskType=АВР'],'avrLaborHours','АВР.'),
        step('corrective','SUM',['selectedRows where finalTaskType=Корректирующее воздействие'],'correctiveLaborHours','Корректирующее воздействие.'),
        step('add','ADD',['avrLaborHours','correctiveLaborHours'],'reactiveLaborHours','Реактивная деятельность.'),
        step('divide','DIVIDE',['reactiveLaborHours','totalLaborHours'],'ratio','Доля реактивных работ.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Проценты.')
      ],null,true),
      filters:[
        ...COMMON_LABOR_SCOPE,
        predicate('reactive-types','query','mobile_brigade_labor','finalTaskType','in',
          ['АВР','Корректирующее воздействие'],'include','Только числитель; знаменатель включает остальные виды работ.','numerator')
      ],
      aggregation:aggregate({avrLaborHours:'SUM',correctiveLaborHours:'SUM',totalLaborHours:'SUM'},'sum-components-then-formula',
        ['period','site','finalTaskType','equipmentPlacement','equipmentClass','equipmentType','equipmentName'])
    }
  };

  const PRB_JOIN = [{
    id:'mobile-to-itsm-by-request',
    left:{datasetId:'mobile_brigade_data',field:'request'},
    right:{datasetId:'itsm_data',field:'number'},
    joinType:'LOOKUP',
    cardinality:'N:1',
    onUnmatched:'preserve-null',
    onDuplicate:'retain-with-justification',
    justification:'При конфликтующих PRB для одинакового номера ITSM связь помечается ambiguous и исключается из числителя; строки МБ не размножаются.'
  }];
  const PRB_STEPS = [
    step('join','JOIN',['mobile_brigade_data.request','itsm_data.number'],'linkedTasks',
      'Нормализованный lookup номера заявки и PRB, конфликт — ambiguous.', 'ReclassifierKpiSourceFacts.linkMobileBrigadeToProblems'),
    step('group','GROUP',['linkedTasks','factDate'],'problem_management',
      'Сохранить гранулярность задач МБ и агрегировать человеко-часы по дате факта.','ReclassifierKpiPreparePrb.prepare'),
    step('labor','SUM',['problem_management.laborHours'],'laborHours',
      'Все пригодные человеко-часы.'),
    step('linked','SUM',['problem_management.linkedLaborHours'],'linkedLaborHours',
      'Только задачи с однозначной PRB-связью.')
  ];
  const PRB = {
    preparationHandler:'ReclassifierKpiPreparePrb.prepare',
    sources:[MB_PRB,ITSM_PRB],joins:PRB_JOIN,
    filters:[
      queryFilter('problem_management','mine','mine'),
      queryFilter('problem_management','equipmentClass','equipmentClass'),
      queryFilter('problem_management','branch','branch'),
      queryFilter('problem_management','problemId','problemId'),
      queryFilter('problem_management','finalTaskType','finalTaskType'),
      predicate('prb-linked','preparation','problem_management','problemLinkState','eq','linked',
        'include','Только числитель охвата; несвязанные задачи остаются в знаменателе.','numerator')
    ],
    aggregation:aggregate({laborHours:'SUM',linkedLaborHours:'SUM'},'sum-components-then-formula',
      ['period','branch','mine','equipmentClass','finalTaskType','problemLinkState','problemId']),
    temporal:TIME('mobile_brigade_data','factDate','ratio-of-sums'),
    zeroDenominator:'unavailable'
  };
  definitions.problem_coverage_absolute = {
    ...PRB, formulaHandler:'ReclassifierKpiCalculateProblemManagement.calculateAbsolute',
    steps:[...PRB_STEPS,step('value','IDENTITY',['linkedLaborHours'],'value','Абсолютный охват PRB.')],
    aggregation:aggregate({linkedLaborHours:'SUM'},'sum-values',
      ['period','branch','mine','equipmentClass','finalTaskType','problemLinkState','problemId']),
    temporal:TIME('mobile_brigade_data','factDate','average')
  };
  definitions.problem_coverage_relative = {
    ...PRB,formulaHandler:'ReclassifierKpiCalculateProblemManagement.calculateRelative',
    steps:[
      ...PRB_STEPS,
      step('divide','DIVIDE',['linkedLaborHours','laborHours'],'ratio','Доля трудозатрат под PRB.'),
      step('percent','MULTIPLY',['ratio','100'],'value','Проценты.')
    ]
  };

  // Additional task-grain indicators reuse the same MB → ITSM lookup and
  // selection contract, but they never treat missing/ambiguous PRB as linked.
  definitions.problem_linked_tasks = {
    ...PRB,
    formulaHandler:'ReclassifierKpiCalculateProblemManagement.calculateLinkedTasks',
    steps:[
      ...PRB_STEPS,
      step('task-number','SUM',['problem_management.linkedTaskCount'],'linkedTaskCount',
        'Только задачи с однозначной связью с ИТ-проблемой.'),
      step('value','IDENTITY',['linkedTaskCount'],'value','Число связанных задач.')
    ],
    aggregation:aggregate({linkedTaskCount:'SUM'},'sum-values',
      ['period','branch','mine','equipmentClass','finalTaskType','problemLinkState','problemId']),
    temporal:TIME('mobile_brigade_data','factDate','sum')
  };
  definitions.problem_task_coverage = {
    ...PRB,
    formulaHandler:'ReclassifierKpiCalculateProblemManagement.calculateTaskCoverage',
    steps:[
      ...PRB_STEPS,
      step('all-tasks','SUM',['problem_management.taskCount'],'taskCount',
        'Все задачи МБ за выбранный период.'),
      step('linked-tasks','SUM',['problem_management.linkedTaskCount'],'linkedTaskCount',
        'Задачи МБ с однозначной связью с ИТ-проблемой.'),
      step('divide','DIVIDE',['linkedTaskCount','taskCount'],'ratio',
        'Доля связанных задач в общем числе задач.'),
      step('percent','MULTIPLY',['ratio','100'],'value','Перевести долю в проценты.')
    ],
    aggregation:aggregate({linkedTaskCount:'SUM',taskCount:'SUM'},
      'sum-components-then-formula',
      ['period','branch','mine','equipmentClass','finalTaskType','problemLinkState','problemId']),
    temporal:TIME('mobile_brigade_data','factDate','ratio-of-sums')
  };
  definitions.problem_active_count = {
    ...PRB,
    formulaHandler:'ReclassifierKpiCalculateProblemManagement.calculateActiveProblemCount',
    steps:[
      ...PRB_STEPS,
      step('unique-problem','COUNT_DISTINCT',['problem_management.problemId'],
        'uniqueProblemCount',
        'Только однозначные связи; повтор одной PRB в других месяцах не удваивает итог.'),
      step('value','IDENTITY',['uniqueProblemCount'],'value',
        'Число уникальных ИТ-проблем с зарегистрированными задачами.')
    ],
    aggregation:aggregate({problemId:'COUNT_DISTINCT'},'not-supported',
      ['period','branch','mine','equipmentClass','finalTaskType','problemLinkState','problemId']),
    // Summation of monthly DISTINCT values is invalid; the Calculator
    // recomputes distinct IDs for the entire requested selection.
    temporal:TIME('mobile_brigade_data','factDate','unavailable')
  };

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  // Generic lineage is generated from the reviewed registration, not hand
  // copied into separate catalog files. Base source/period semantics remain
  // the same as the existing subject-specific prepared family.
  const declarative=globalThis.ReclassifierKpiDeclarative;
  for(const d of declarative?.definitions||[]){
    if(definitions[d.id])throw new Error('Duplicate declarative KPI contract '+d.id);
    const base=definitions[d.sourceConfig.baseKpi];
    if(!base)throw new Error('Unknown baseline KPI source for '+d.id);
    const operands=d.components;
    const extraSteps=[
      step('select','FILTER',[d.sourceConfig.tableId],'selectedRows',
        'Подготовленный источник и фильтры запроса через общий Calculator.'),
      ...operands.map((component,i)=>step('component-'+i,'SUM',
        ['selectedRows.'+component.field],
        component.key,
        'Сумма подготовленного '+component.field+
        (component.where?' с дополнительным отбором '+JSON.stringify(component.where):'')+'.')),
      ...(d.kind==='ratio'?[
        step('ratio','DIVIDE',[operands[0].key,operands[1].key],'ratio',
          'Отношение суммы числителя к сумме знаменателя; нуль запрещён.'),
        step('percent','MULTIPLY',['ratio','100'],'value','Перевести долю в проценты.')
      ]:[step('output','IDENTITY',[operands[0].key],'value',
        'Сумма фактических компонентов без дополнительных коэффициентов.')])
    ];
    definitions[d.id]={
      preparationHandler:base.preparationHandler,
      formulaHandler:'ReclassifierKpiDeclarative.calculate',
      sources:base.sources,
      joins:[],
      filters:base.filters,
      steps:extraSteps,
      aggregation:{
        ...base.aggregation,
        componentMethods:Object.fromEntries(operands.map(o=>[o.key,'SUM'])),
        combinePeriods:d.kind==='ratio'?'sum-components-then-formula':'sum-values'
      },
      temporal:base.temporal,zeroDenominator:'unavailable'
    };
  }

  globalThis.ReclassifierKpiCatalogContracts = deepFreeze(definitions);
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ReclassifierKpiCatalogContracts;
})();
