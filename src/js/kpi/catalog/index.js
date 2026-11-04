// FILE CONTRACT: single read-only KPI Passport / Calculation Contract catalog.
// Owns: stable KPI identities and auditable metadata for all implemented and placeholder KPI IDs.
// Reads: existing Calculator definitions, reviewed calculation path declarations and report card templates.
// Writes: immutable read-only API only; NEVER computes KPI values or writes Datasets.
// Must not: introduce an independent formula evaluator, approved thresholds or synthetic forecasts.
(() => {
  'use strict';

  const formulas = globalThis.ReclassifierKpiDefinitions;
  const contracts = globalThis.ReclassifierKpiCatalogContracts;
  const template = globalThis.ReclassifierReliabilityDashboardData;
  const declared=globalThis.ReclassifierKpiDeclarative;
  // Metadata originates in one reviewed declaration, not a second UI list.
  for(const d of declared?.definitions||[]){
    if(formulas[d.id]===undefined||contracts[d.id]===undefined)
      throw new Error('Incomplete declarative KPI registration '+d.id);
  }
  if (!formulas || !contracts || !template?.kpiGroups) {
    throw new Error('KPI Catalog requires Calculator definitions, Contracts and the report template.');
  }

  const groupItems=(category,items)=>[
    ...items,
    ...(declared?.definitions||[]).filter(d=>d.category===category).map(d=>({
      id:d.id,title:d.title,unit:d.unit
    }))
  ];
  const GROUPS = Object.freeze([
    { key: 'dataQuality', title: 'Данные и качество', items: groupItems('dataQuality',template.kpiGroups.dataQuality) },
    { key: 'technicalReliability', title: 'Техническая надёжность', items: groupItems('technicalReliability',template.kpiGroups.technicalReliability) },
    { key: 'organizationalReadiness', title: 'Организационная готовность', items: groupItems('organizationalReadiness',template.kpiGroups.organizationalReadiness) },
    { key: 'labor', title: 'Трудозатраты', items: groupItems('labor',template.labor.summaryKpis) },
    { key: 'problemManagement', title: 'Управление проблемами', items: groupItems('problemManagement',template.problemManagement.summaryKpis) }
  ]);

  const DIRECTIONS_BY_ID = Object.freeze({
    vbr:'higher-is-better',ktg:'higher-is-better',sla:'higher-is-better',classification_quality:'higher-is-better',classification_quality_cgps:'higher-is-better',
    total_labor:'neutral',avr_labor:'neutral',avr_share:'neutral',
    maintenance_labor:'neutral',corrective_labor:'neutral',reactive_share:'neutral',
    problem_coverage_absolute:'neutral',problem_coverage_relative:'neutral',
    problem_linked_tasks:'neutral',problem_task_coverage:'neutral',
    problem_active_count:'neutral'
  });

  // Reader-facing terminology is distinct from the stable short titles of KPI cards.
  // Wording explains what the EXISTING Calculator measures; it does not approve methodology.
  const READER_DESCRIPTIONS = Object.freeze({
    vbr: {
      fullTitle:'ВБР — вероятность безотказной работы',
      definition:'ВБР — это показатель надёжности навесного и стационарного оборудования СДГР, характеризующий количество отказов относительно численности оборудования за отчётный период.',
      purpose:'ВБР применяется для ежемесячного контроля надёжности, выявления ухудшений по рудникам и видам оборудования, определения приоритетов анализа причин отказов и оценки результатов мероприятий по надёжности. Динамика показателя помогает установить, снижается ли частота отказов после изменения технических решений, организации обслуживания или условий эксплуатации.',
      limitation:'Показатель по этой формуле является приближённой оценкой: при нескольких отказах одной единицы число отказов не равно числу отказавших единиц. Это не строгая статистическая вероятность работы каждой единицы без отказа. Если отчётный интервал частично выходит за наблюдаемые месяцы ITSM, ВБР рассчитывается только по подтверждённым месяцам с явным предупреждением о неполном охвате; месяцы вне выгрузки не приравниваются к отсутствию отказов.'
    },
    ktg: {
      fullTitle:'КТГ — коэффициент технической готовности',
      definition:'Расчётная доля доступного календарного фонда времени оборудования СДГР. КФРВ = количество оборудования Drivers × 24 × календарные дни. Из КФРВ вычитаются продолжительности INC, фактических плановых ТО, внеплановых ТО и прочих работ из ITSM; в знаменателе вычитается плановое ТО.',
      purpose:'Ежемесячная оценка технической готовности по рудникам и видам оборудования, сопоставление продолжительности зарегистрированных работ с календарным фондом.',
      limitation:'Проект методики. Часы предбэклога ITSM оценивают длительность обращения, а не обязательно физическую недоступность оборудования. Месяц определяется датой создания; длительность переходящих через месяц обращений не распределяется по дням. Справочник Drivers фиксирован для исторических месяцев. До подключения графиков ТО плановые часы в знаменателе временно равны фактическим часам плановых ТО ITSM. Монтаж, ПО доступ и консультация исключены для не-INC; INC имеет безусловный приоритет. Незавершённые обращения и некорректные часы не считаются нулём: при наличии других завершённых работ расчёт показывается как предварительная оценка. Месяцы вне наблюдений ITSM исключаются из КФРВ и итоговых сумм, а не приравниваются к нулевому простою.'
    },
    sla: {
      fullTitle:'SLA — соблюдение соглашения об уровне сервиса',
      definition:'Доля обращений с известным статусом SLA, закрытых без просрочки по разрешению в выбранном отчётном периоде.',
      purpose:'Оценка соблюдения установленных сроков разрешения обращений ITSM.'
    },
    classification_quality: {
      fullTitle:'Качество классификации общее',
      definition:'Доля обращений с категорией «INC без изм» среди четырёх результатов инженерной проверки: «INC без изм», «INC с исправлением», «INC не классифицирован», «RITM вместо INC».',
      purpose:'Оценка качества первоначальной классификации обращений ITSM Сириус. При проверке инженер по надёжности сопоставляет указанные в классификаторе сведения с описанием обращения, диагностикой неисправности и результатом выполненных работ, уточняя категорию при необходимости. Показатель отражает долю обращений, не потребовавших исправления после проверки; в расчёт включаются все инициаторы и обращения независимо от наличия задачи в Мобильных бригадах.',
      limitation:'Результат вычисляется по уже присвоенной категории качества классификации; само числовое вычисление не проверяет текст на смысловые противоречия и не подтверждает правильность каждого поля. «RITM без изм» не учитывается. Месяц определяется датой выполнения обращения, при её отсутствии — датой закрытия. Без обеих дат запись не входит в расчёт. Если знаменатель равен нулю, процент недоступен.'
    },
    classification_quality_cgps: {
      fullTitle:'Качество классификации ЦГПС',
      definition:'Доля обращений «INC без изм» среди обращений с подтверждённой связью с Мобильными бригадами. «INC с исправлением» и «INC не классифицирован» учитываются при любой группе инициаторов; «RITM вместо INC» — только при группе инициаторов «ЦГПС».',
      purpose:'Оценка качества классификации обращений, по которым работы зарегистрированы в Мобильных бригадах в рамках деятельности ЦГПС. Специалисты ЦГПС выполняют диагностику и работы, фиксируют сведения о выявленной неисправности и выполненных действиях; эти сведения позволяют инженеру по надёжности проверить первоначальную классификацию и обоснованность исправлений. Наличие работы в МБ определяет область оценки, но не устанавливает автора каждого исходного поля.',
      limitation:'Связь определяется по точному сопоставлению нормализованного номера обращения ITSM Сириус с полем «Заявка» актуального Dataset МБ, а не по названию оборудования и не по значению «Открыл». Несколько задач МБ по одному обращению не увеличивают количество обращений. Если номер не найден в загруженном Dataset МБ, обращение исключается независимо от дат выгрузки. При отсутствии или недоступности Dataset МБ показатель недоступен. При пустом номере ITSM обращение исключается с отдельным диагностическим счётчиком; RITM с пустой группой инициаторов исключается отдельно от RITM других групп. Неполная выгрузка МБ может не содержать реально существующих заявок. Числовой показатель основан на присвоенных категориях и не выполняет автоматическую проверку текста. Месяц определяется датой выполнения, иначе закрытия.'
    },
    total_labor: {
      fullTitle:'Общая трудоёмкость выполненных задач',
      definition:'Сумма пригодных к расчёту трудозатрат задач ИС «Мобильные бригады» за отчётный период.',
      purpose:'Оценка общего объёма зарегистрированных работ в человеко-часах.'
    },
    avr_labor: {
      fullTitle:'АВР — трудоёмкость аварийно-восстановительных работ',
      definition:'Сумма пригодных трудозатрат задач МБ с итоговым видом работы «АВР».',
      purpose:'Оценка затрат труда на аварийно-восстановительные работы.'
    },
    avr_share: {
      fullTitle:'Доля АВР в общей трудоёмкости',
      definition:'Доля пригодных трудозатрат аварийно-восстановительных работ в общем объёме пригодных трудозатрат МБ.',
      purpose:'Оценка удельного веса аварийно-восстановительных работ.'
    },
    maintenance_labor: {
      fullTitle:'ТО — трудоёмкость технического обслуживания',
      definition:'Сумма пригодных трудозатрат задач МБ с итоговыми видами «ТО по графику» и «ТО вне графика».',
      purpose:'Оценка трудоёмкости зарегистрированного технического обслуживания.'
    },
    corrective_labor: {
      fullTitle:'Трудоёмкость корректирующих воздействий',
      definition:'Сумма пригодных трудозатрат задач МБ с итоговым видом «Корректирующее воздействие».',
      purpose:'Оценка трудозатрат на корректирующие воздействия.'
    },
    reactive_share: {
      fullTitle:'Доля реактивной деятельности в трудозатратах',
      definition:'Доля суммы пригодных трудозатрат АВР и корректирующих воздействий в общей пригодной трудоёмкости МБ.',
      purpose:'Оценка удельного веса реактивных работ в зарегистрированных трудозатратах.'
    },
    problem_coverage_absolute: {
      fullTitle:'Абсолютный охват трудозатрат управлением ИТ-проблемами',
      definition:'Сумма пригодных трудозатрат задач МБ с однозначной связью с ИТ-проблемой (PRB) через обращение ITSM.',
      purpose:'Оценка трудоёмкости работ, относящихся к управлению ИТ-проблемами.'
    },
    problem_linked_tasks: {
      fullTitle:'Задачи, связанные с ИТ-проблемами',
      definition:'Число задач ИС «Мобильные бригады» за выбранный период, для которых через номер обращения ITSM Сириус установлена однозначная связь с ИТ-проблемой (PRB).',
      purpose:'Оценка объёма работ, отнесённых к разбору и устранению системных проблем.',
      limitation:'Одна строка задачи МБ учитывается один раз. Неподтверждённые, неоднозначные и отсутствующие связи не считаются связанными. Это количество задач, а не количество проблем.'
    },
    problem_task_coverage: {
      fullTitle:'Доля задач, связанных с ИТ-проблемами',
      definition:'Количество задач МБ с однозначной связью с ИТ-проблемой, делённое на количество всех задач МБ за выбранный период, умноженное на 100%.',
      purpose:'Оценка охвата зарегистрированных задач работой по устранению ИТ-проблем.',
      limitation:'Используются все задачи, включая записи без пригодной трудоёмкости; показатель не означает снижение аварийности или подтверждённый экономический эффект. При нуле задач доля недоступна.'
    },
    problem_active_count: {
      fullTitle:'Число ИТ-проблем с зарегистрированными работами',
      definition:'Число различных кодов PRB, однозначно связанных с задачами МБ за выбранный период.',
      purpose:'Оценка количества уникальных ИТ-проблем, по которым в МБ зарегистрированы работы.',
      limitation:'Это не общее число заведённых или открытых ИТ-проблем. Одна PRB при нескольких задачах и месяцах считается один раз; неоднозначные связи исключены. Источник не содержит подтверждения устранения первопричины.'
    },
    problem_coverage_relative: {
      fullTitle:'Относительный охват трудозатрат управлением ИТ-проблемами',
      definition:'Доля пригодных трудозатрат задач МБ с однозначной связью с PRB в общей пригодной трудоёмкости выбранного среза.',
      purpose:'Оценка доли трудоёмкости, связанной с процессом управления ИТ-проблемами.'
    }
  });

  // KPI Definition V2: metadata ONLY. Every source/field/formula below refers
  // back to the audited V1 Calculation Contract. This is not an executable DSL.
  // The chart, PDF and Calculator continue to consume the unchanged V1 objects.
  const V2_SCHEMA_VERSION='2.0.0';
  const PERCENT_RATIOS=new Set([
    'sla','classification_quality','classification_quality_cgps','avr_share',
    'reactive_share','problem_coverage_relative','problem_task_coverage'
  ]);
  const COEFFICIENTS=new Set(['vbr','ktg']);
  const COUNTS=new Set(['problem_active_count']);
  const SUMS=new Set([
    'total_labor','avr_labor','maintenance_labor','corrective_labor',
    'problem_coverage_absolute','problem_linked_tasks'
  ]);
  // Keys are taken from actual Calculator Result.components; labels do not
  // define or modify the formula. PR-3 will use these as named display inputs.
  const COMPONENT_LABELS=Object.freeze({
    failureCount:['Отказы','событий'],equipmentCount:['Фонд наблюдения','обор.-мес.'],
    calendarHours:['КФРВ','ч'],incidentHours:['INC','ч'],
    actualMaintenanceHours:['ТО по графику (факт)','ч'],
    plannedMaintenanceHours:['Плановое ТО (допущение)','ч'],
    unplannedMaintenanceHours:['Внеплановое ТО','ч'],
    otherHours:['Прочие работы','ч'],
    actualDowntimeHours:['Суммарное учтённое время','ч'],
    productiveHours:['Расчётный работоспособный фонд','ч'],
    availableHours:['Расчётный доступный фонд','ч'],
    equipmentUnits:['Численность оборудования','шт.'],
    slaSuccessCount:['Выполнено в SLA','обращений'],
    slaOverdueCount:['Нарушение SLA','обращений'],
    slaTotalCount:['Всего с известным SLA','обращений'],
    classificationSuccessCount:['Классификация без исправления','обращений'],
    classificationFailureCount:['Остальные результаты проверки','обращений'],
    classificationTotalCount:['Всего в знаменателе','обращений'],
    classificationIncUnchangedCount:['A · INC без изменений','обращений'],
    classificationIncCorrectedCount:['B · INC с исправлением','обращений'],
    classificationIncUnclassifiedCount:['C · INC не классифицирован','обращений'],
    classificationRitmInsteadOfIncCount:['D · RITM вместо INC','обращений'],
    excludedNoMbCount:['Без связанной задачи МБ','обращений'],
    unknownMbCoverageCount:['Неизвестное покрытие МБ','обращений'],
    excludedOtherInitiatorRitmCount:['RITM другой группы инициаторов','обращений'],
    excludedUnknownInitiatorRitmCount:['RITM без группы инициаторов','обращений'],
    excludedMissingRequestCount:['Без номера обращения','обращений'],
    laborHours:['Трудоёмкость','чел.-ч'],
    taskCount:['Все задачи выбранного среза','задач'],
    usableLaborTaskCount:['Задачи с пригодными часами','задач'],
    unusableLaborTaskCount:['Задачи без пригодных часов','задач'],
    avrLaborHours:['Трудоёмкость АВР','чел.-ч'],
    totalLaborHours:['Общая трудоёмкость','чел.-ч'],
    correctiveLaborHours:['Трудоёмкость корректирующих воздействий','чел.-ч'],
    reactiveLaborHours:['Реактивная трудоёмкость','чел.-ч'],
    linkedLaborHours:['Трудоёмкость задач, связанных с PRB','чел.-ч'],
    linkedTaskCount:['Число связанных с ИТ-проблемами задач','задач'],
    uniqueProblemCount:['Число уникальных ИТ-проблем','проблем']
  });
  const QUALITY_COMPONENTS=[
    'classificationSuccessCount','classificationFailureCount','classificationTotalCount',
    'classificationIncUnchangedCount','classificationIncCorrectedCount',
    'classificationIncUnclassifiedCount','classificationRitmInsteadOfIncCount'
  ];
  const LABOR_COMPONENTS=['laborHours','taskCount','usableLaborTaskCount','unusableLaborTaskCount'];
  const PRB_COMPONENTS=[...LABOR_COMPONENTS,'linkedTaskCount','linkedLaborHours'];
  const COMPONENTS_BY_ID=Object.freeze({
    vbr:['failureCount','equipmentCount'],
    ktg:['calendarHours','incidentHours','actualMaintenanceHours','plannedMaintenanceHours',
      'unplannedMaintenanceHours','otherHours','actualDowntimeHours','productiveHours',
      'availableHours','equipmentUnits'],
    sla:['slaSuccessCount','slaOverdueCount','slaTotalCount'],
    classification_quality:QUALITY_COMPONENTS,
    classification_quality_cgps:[...QUALITY_COMPONENTS,'excludedNoMbCount',
      'unknownMbCoverageCount','excludedOtherInitiatorRitmCount',
      'excludedUnknownInitiatorRitmCount','excludedMissingRequestCount'],
    total_labor:LABOR_COMPONENTS,avr_labor:LABOR_COMPONENTS,
    maintenance_labor:LABOR_COMPONENTS,corrective_labor:LABOR_COMPONENTS,
    avr_share:['avrLaborHours','totalLaborHours'],
    reactive_share:['avrLaborHours','correctiveLaborHours','reactiveLaborHours','totalLaborHours'],
    problem_coverage_absolute:PRB_COMPONENTS,
    problem_coverage_relative:PRB_COMPONENTS,
    problem_linked_tasks:PRB_COMPONENTS,
    problem_task_coverage:PRB_COMPONENTS,
    problem_active_count:[...PRB_COMPONENTS,'uniqueProblemCount']
  });
  const RATIO_OPERANDS=Object.freeze({
    vbr:['failureCount','equipmentCount'],
    ktg:['productiveHours','availableHours'],
    sla:['slaSuccessCount','slaTotalCount'],
    classification_quality:['classificationSuccessCount','classificationTotalCount'],
    classification_quality_cgps:['classificationSuccessCount','classificationTotalCount'],
    avr_share:['avrLaborHours','totalLaborHours'],
    reactive_share:['reactiveLaborHours','totalLaborHours'],
    problem_coverage_relative:['linkedLaborHours','laborHours'],
    problem_task_coverage:['linkedTaskCount','taskCount']
  });
  const SHARED_EQUIPMENT_FILTERS=['mine','equipmentClass','equipmentType','equipmentName'];
  const SHARED_BRANCH_FILTERS=['branch',...SHARED_EQUIPMENT_FILTERS];
  const LABOR_FILTERS=SHARED_EQUIPMENT_FILTERS;
  const FILTERS_BY_ID=Object.freeze({
    vbr:SHARED_EQUIPMENT_FILTERS,ktg:SHARED_EQUIPMENT_FILTERS,
    sla:SHARED_BRANCH_FILTERS,classification_quality:SHARED_BRANCH_FILTERS,
    classification_quality_cgps:SHARED_BRANCH_FILTERS,
    total_labor:LABOR_FILTERS,avr_labor:LABOR_FILTERS,
    maintenance_labor:LABOR_FILTERS,corrective_labor:LABOR_FILTERS,
    avr_share:LABOR_FILTERS,reactive_share:LABOR_FILTERS,
    problem_coverage_absolute:['branch','mine','equipmentClass','problemId','finalTaskType'],
    problem_coverage_relative:['branch','mine','equipmentClass','problemId','finalTaskType'],
    problem_linked_tasks:['branch','mine','equipmentClass','problemId','finalTaskType'],
    problem_task_coverage:['branch','mine','equipmentClass','problemId','finalTaskType'],
    problem_active_count:['branch','mine','equipmentClass','problemId','finalTaskType']
  });
  // Existing reporting-month nowcasts are distinct from generic future-month
  // estimators. A metadata declaration NEVER enables a forecast in a chart.
  const NOWCAST_COMPONENTS=new Set(['vbr','ktg']);
  const NOWCAST_VOLUMES=new Set([
    'total_labor','avr_labor','maintenance_labor','corrective_labor'
  ]);
  const REPORTING_METHOD_IDS=['observed-run-rate','last-value','linear-trend'];
  const HISTORICAL_METHOD_IDS=['linear-trend','last-value'];
  const RELATED_METRICS=Object.freeze({
    vbr:['failureCount','equipmentCount'],
    ktg:['incidentHours','actualDowntimeHours','equipmentUnits'],
    sla:['slaSuccessCount','slaOverdueCount','slaTotalCount'],
    classification_quality:[
      'classificationIncUnchangedCount','classificationIncCorrectedCount',
      'classificationIncUnclassifiedCount','classificationRitmInsteadOfIncCount'
    ],
    classification_quality_cgps:[
      'classificationIncUnchangedCount','classificationIncCorrectedCount',
      'classificationIncUnclassifiedCount','classificationRitmInsteadOfIncCount',
      'unknownMbCoverageCount'
    ],
    total_labor:['laborHours','taskCount'],
    // For subset labor KPIs, Result.components.taskCount is NOT filtered by
    // work type; never offer it as an apparent count of AVR/TO/corrective jobs.
    avr_labor:['laborHours'],
    maintenance_labor:['laborHours'],
    corrective_labor:['laborHours'],
    avr_share:['avrLaborHours','totalLaborHours'],
    reactive_share:['reactiveLaborHours','totalLaborHours'],
    problem_coverage_absolute:['linkedLaborHours','linkedTaskCount'],
    problem_coverage_relative:['linkedLaborHours','laborHours','linkedTaskCount'],
    problem_linked_tasks:['linkedTaskCount','taskCount'],
    problem_task_coverage:['linkedTaskCount','taskCount'],
    problem_active_count:['uniqueProblemCount','linkedTaskCount']
  });

  function makeDefinitionV2(entry) {
    const id=entry.id,calculation=entry.calculation;
    const enabled=entry.calculationState==='implemented';
    const declaredKpi=declared?.get(id)||null;
    const kind=!enabled?'unconfigured':declaredKpi?.kind||
      (COEFFICIENTS.has(id)?'coefficient':
      PERCENT_RATIOS.has(id)?'ratio':SUMS.has(id)?'sum':
      COUNTS.has(id)?'count':null);
    if(!kind)throw new Error('KPI Definition V2: unrecognized measurement kind '+id);
    const keys=enabled?(declaredKpi?.components.map(part=>part.key)||COMPONENTS_BY_ID[id]):[];
    if(enabled&&(!Array.isArray(keys)||!keys.length))
      throw new Error('KPI Definition V2: missing component metadata '+id);
    const operands=declaredKpi?.kind==='ratio'?declaredKpi.components.map(p=>p.key):RATIO_OPERANDS[id]||[];
    const components=keys.map(key=>{
      const registeredPart=declaredKpi?.components.find(item=>item.key===key);
      const info=registeredPart?[registeredPart.label,registeredPart.unit]:COMPONENT_LABELS[key];
      if(!info)throw new Error('KPI Definition V2: missing component label '+id+'/'+key);
      return {
        key,label:info[0],unit:info[1],
        role:registeredPart?.role||(key===operands[0]?'numerator':key===operands[1]?'denominator':'context'),
        valuePath:'components.'+key
      };
    });
    const sourceRefs=calculation?.sources.map(source=>({
      datasetId:source.datasetId,
      semanticFields:source.fields.map(field=>field.field)
    }))||[];
    const forecastPolicy=!enabled?'none':declaredKpi?.forecastPolicy||
      (['problem_linked_tasks','problem_task_coverage','problem_active_count'].includes(id)
        ? 'none' : NOWCAST_COMPONENTS.has(id)
      ?'reporting-month-components':NOWCAST_VOLUMES.has(id)
      ?'reporting-month-volume':'historical-next-month');
    const forecastMethods=forecastPolicy==='none'?[]:
      forecastPolicy==='historical-next-month'?HISTORICAL_METHOD_IDS:REPORTING_METHOD_IDS;
    const forecastAvailableInChart=NOWCAST_COMPONENTS.has(id)||NOWCAST_VOLUMES.has(id);
    const forecastPresentation=NOWCAST_COMPONENTS.has(id)
      ?'percentage-month-endpoint':NOWCAST_VOLUMES.has(id)
      ?'absolute-current-to-month-end':'no-reporting-month-overlay';
    return deepFreeze({
      schemaVersion:V2_SCHEMA_VERSION,kpiId:id,
      identity:{category:entry.definition.category,visibleInReport:entry.visibleInReport},
      measurement:{kind,unit:entry.definition.unit},
      calculator:{
        integration:enabled?'existing-calculator':'not-implemented',
        handlerRef:calculation?.formulaHandler||null,
        formulaVersion:calculation?.formula.formulaVersion||null,
        calculationContractVersion:calculation?.contractVersion||null,
        contractRef:enabled?id:null
      },
      data:{
        sourceRefs,filterDimensions:enabled?(declaredKpi?Object.keys(declaredKpi.sourceConfig.filters):[...FILTERS_BY_ID[id]]):[],
        periodGrain:calculation?.temporal.periodGrain||null
      },
      components,
      // Supporting component metrics are defined here, but are not yet
      // automatically rendered as independent lines or separate KPI values.
      relatedMetrics:(declaredKpi?.components.map(p=>p.key)||RELATED_METRICS[id]||[]).map(key=>({
        id:key,componentKey:key,presentation:'defined-not-connected'
      })),
      forecast:{
        policy:forecastPolicy,methodIds:[...forecastMethods],
        chartNowcastConnected:forecastAvailableInChart,
        chartPresentation:forecastPresentation,
        selectionSurface:NOWCAST_COMPONENTS.has(id)?'kpi-chart':'none'
      },
      presentation:{
        passport:'shared-four-tabs',
        card:!entry.visibleInReport?'hidden':enabled?'existing':'placeholder',
        chart:!entry.visibleInReport?'hidden':enabled?'existing-line-svg':'not-implemented',
        pdf:enabled?'existing-snapshot-renderer':'not-implemented',
        visualStyle:'unchanged'
      }
    });
  }

  function assertDefinitionV2(entry,v2) {
    const id=entry.id,calc=entry.calculation;
    const validKinds=new Set(['unconfigured','count','sum','ratio','coefficient','custom']);
    const validPolicies=new Set(['none','reporting-month-components','reporting-month-volume',
      'historical-next-month']);
    if(v2.schemaVersion!==V2_SCHEMA_VERSION||v2.kpiId!==id||
       !validKinds.has(v2.measurement.kind)||!validPolicies.has(v2.forecast.policy))
      throw new Error('KPI Definition V2: invalid identity/kind/forecast '+id);
    if(v2.measurement.unit!==entry.definition.unit||
       v2.identity.visibleInReport!==entry.visibleInReport)
      throw new Error('KPI Definition V2: legacy presentation mismatch '+id);
    if(!calc){
      if(v2.measurement.kind!=='unconfigured'||v2.components.length||
         v2.relatedMetrics.length||v2.data.sourceRefs.length||
         v2.forecast.policy!=='none'||v2.forecast.chartNowcastConnected)
        throw new Error('KPI Definition V2: placeholder must not claim capabilities '+id);
      return true;
    }
    if(v2.calculator.handlerRef!==calc.formulaHandler||
       v2.calculator.formulaVersion!==calc.formula.formulaVersion||
       v2.calculator.contractRef!==id)
      throw new Error('KPI Definition V2: Calculator/Contract mismatch '+id);
    if(JSON.stringify(v2.data.sourceRefs.map(s=>s.datasetId))!==
       JSON.stringify(calc.sources.map(s=>s.datasetId)))
      throw new Error('KPI Definition V2: source identities mismatch '+id);
    for(let i=0;i<calc.sources.length;i++){
      const actual=calc.sources[i].fields.map(f=>f.field);
      if(JSON.stringify(v2.data.sourceRefs[i].semanticFields)!==JSON.stringify(actual))
        throw new Error('KPI Definition V2: source fields mismatch '+id);
    }
    const names=new Set(v2.components.map(c=>c.key));
    if(names.size!==v2.components.length||
       v2.components.some(c=>c.valuePath!=='components.'+c.key))
      throw new Error('KPI Definition V2: duplicate/misbound components '+id);
    if(v2.relatedMetrics.some(metric=>!names.has(metric.componentKey))||
       new Set(v2.relatedMetrics.map(m=>m.id)).size!==v2.relatedMetrics.length)
      throw new Error('KPI Definition V2: invalid additional metrics '+id);
    if(new Set(v2.data.filterDimensions).size!==v2.data.filterDimensions.length||
       !v2.data.periodGrain)
      throw new Error('KPI Definition V2: invalid temporal/filter metadata '+id);
    return true;
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }

  // Handler names are audit references only. They resolve to EXISTING real functions;
  // neither a string handler nor a declarative operation is executed by the Catalog.
  function resolveHandler(ref) {
    const names = String(ref || '').split('.').filter(Boolean);
    if (names.length < 2) return null;
    let current = globalThis;
    for (const name of names) current = current?.[name];
    return typeof current === 'function' ? current : null;
  }

  function assertCalculation(id, calculation, formula) {
    if (!calculation || !formula) throw new Error('KPI Catalog: contract/definition missing for ' + id);
    if (!Array.isArray(calculation.sources) || !calculation.sources.length ||
        !Array.isArray(calculation.steps) || !calculation.steps.length ||
        !Array.isArray(calculation.filters) || !Array.isArray(calculation.joins)) {
      throw new Error('KPI Catalog: incomplete lineage for ' + id);
    }
    const stepIds = new Set();
    for (const step of calculation.steps) {
      if (!step.id || stepIds.has(step.id)) {
        throw new Error('KPI Catalog: duplicate/missing calculation step: ' + id);
      }
      stepIds.add(step.id);
      if (step.handlerRef && !resolveHandler(step.handlerRef)) {
        throw new Error('KPI Catalog: missing step handler ' + step.handlerRef + ' for ' + id);
      }
    }
    const handlers = calculation.preparationHandler.split('+').map(value => value.trim());
    handlers.push(calculation.formulaHandler);
    for (const ref of handlers) {
      if (!resolveHandler(ref)) throw new Error('KPI Catalog: unknown real handler ' + ref + ' for ' + id);
    }
    if (calculation.formula?.expression !== formula.formula ||
        calculation.formula?.formulaVersion !== formula.formulaVersion ||
        JSON.stringify(calculation.sourceComponents) !== JSON.stringify(formula.sourceComponents)) {
      throw new Error('KPI Catalog: formula/source component drift for ' + id);
    }
    if (calculation.temporal?.forecast?.status === 'approved') {
      throw new Error('KPI Catalog: unapproved forecast contract for ' + id);
    }
    return true;
  }

  const sections = new Map();
  const cardInfo = new Map();
  for (const group of GROUPS) {
    const ids = [];
    for (const item of group.items) {
      if (!item?.id || cardInfo.has(item.id)) {
        throw new Error('KPI Catalog: duplicate or empty template KPI ID ' + String(item?.id));
      }
      cardInfo.set(item.id, { group: group.key, item });
      ids.push(item.id);
    }
    sections.set(group.key, deepFreeze({
      id: group.key, title: group.title, ids
    }));
  }
  // Only avr_share remains a calculated KPI without a dashboard card.
  const HIDDEN_GROUPS = Object.freeze({ avr_share: 'labor' });

  const definitions = new Map();
  const allIds = new Set([...cardInfo.keys(), ...Object.keys(formulas)]);
  for (const id of allIds) {
    const rawFormula = formulas[id] || null;
    const rawContract = contracts[id] || null;
    const card = cardInfo.get(id) || null;
    const category = card?.group || HIDDEN_GROUPS[id];
    if (!category || !sections.has(category)) {
      throw new Error('KPI Catalog: missing category for ' + id);
    }

    if (rawFormula) {
      const registered=declared?.get(id);
      const direction = registered?.direction||DIRECTIONS_BY_ID[id];
      const reader = registered ?{
        fullTitle:registered.fullTitle,definition:registered.definition,
        purpose:registered.purpose,limitation:registered.limitation
      }:READER_DESCRIPTIONS[id];
      if (!direction || !reader) throw new Error('KPI Catalog: missing interpretation for ' + id);
      if (!rawContract) throw new Error('KPI Catalog: missing calculation contract for ' + id);
      const calculation = {
        kpiId: id,
        contractVersion: '1.0.0',
        status: 'draft',
        preparationHandler: rawContract.preparationHandler,
        formulaHandler: rawContract.formulaHandler,
        sources: rawContract.sources,
        joins: rawContract.joins,
        filters: rawContract.filters,
        steps: rawContract.steps,
        aggregation: rawContract.aggregation,
        temporal: rawContract.temporal,
        formula: {
          expression: rawFormula.formula,
          formulaVersion: rawFormula.formulaVersion,
          output: 'value',
          zeroDenominator: rawContract.zeroDenominator,
          roundingDigits: 1
        },
        sourceComponents: Array.from(rawFormula.sourceComponents)
      };
      assertCalculation(id, calculation, rawFormula);
      definitions.set(id, deepFreeze({
        id,
        visibleInReport: Boolean(card),
        calculationState: 'implemented',
        definition: {
          id,
          title: rawFormula.title,
          fullTitle: reader.fullTitle,
          category,
          definition: reader.definition,
          purpose: reader.purpose,
          limitation: reader.limitation || null,
          unit: rawFormula.unit,
          direction,
          target: null,
          methodology: { version: 'not-assigned', status: rawFormula.methodologyStatus, reference: null }
        },
        calculation
      }));
    } else {
      if (rawContract) throw new Error('KPI Catalog: orphan contract for ' + id);
      if (!card || card.item.calculationState !== 'not-implemented') {
        throw new Error('KPI Catalog: unrecognized placeholder for ' + id);
      }
      definitions.set(id, deepFreeze({
        id,
        visibleInReport: true,
        calculationState: 'not-implemented',
        definition: {
          id,
          title: card.item.title,
          fullTitle: card.item.title,
          category,
          definition: 'Расчётная методика пока не подключена.',
          purpose: 'Зарезервированная позиция управленческого отчёта.',
          unit: card.item.unit,
          direction: 'neutral',
          target: null,
          methodology: { version: 'not-assigned', status: 'draft', reference: null }
        },
        calculation: null
      }));
    }
  }

  for (const id of Object.keys(contracts)) {
    if (!formulas[id]) throw new Error('KPI Catalog: contract without implemented calculator ' + id);
  }

  // V2 is additive: existing get(), list(), calculations and rendering contracts
  // remain byte-for-byte equivalent to their V1 projections.
  const definitionsV2 = new Map();
  for (const entry of definitions.values()) {
    const v2=makeDefinitionV2(entry);
    assertDefinitionV2(entry,v2);
    definitionsV2.set(entry.id,v2);
  }

  const ids = Object.freeze(Array.from(definitions.keys()));
  const groups = Object.freeze(Array.from(sections.values()));
  const listValues = Object.freeze(ids.map(id => definitions.get(id)));

  function get(id) { return definitions.get(String(id || '')) || null; }
  function getCalculation(id) { return get(id)?.calculation || null; }
  function getV2(id) { return definitionsV2.get(String(id || '')) || null; }
  // PR-3 read-only projection of existing Result.components. This is a
  // presenter, not a Calculator: no rounding, parsing, inferred zero or formula
  // evaluation. A component is available only if a finite number was supplied.
  function projectComponents(kpiId,result) {
    const spec=getV2(kpiId);
    if(!spec)return null;
    const availableResult=result?.dataState==='available'&&Number.isFinite(result?.value);
    const data=result?.components&&typeof result.components==='object'?
      result.components:{};
    const items=spec.components.map(descriptor=>{
      const raw=Object.prototype.hasOwnProperty.call(data,descriptor.key)?
        data[descriptor.key]:null;
      const present=Number.isFinite(raw);
      return {
        key:descriptor.key,label:descriptor.label,unit:descriptor.unit,
        role:descriptor.role,valuePath:descriptor.valuePath,
        value:present?raw:null,
        state:present?'available':'missing'
      };
    });
    const find=role=>items.find(item=>item.role===role)||null;
    const primary=['sum','count'].includes(spec.measurement.kind)?
      items.find(item=>item.key===spec.relatedMetrics[0]?.componentKey)||null:null;
    const required=spec.measurement.kind==='ratio'?
      [find('numerator'),find('denominator')]:
      ['sum','count'].includes(spec.measurement.kind)?[primary]:[];
    const operandsComplete=required.every(item=>item?.state==='available');
    return deepFreeze({
      kpiId:spec.kpiId,kind:spec.measurement.kind,
      dataState:!result?'no-result':result.dataState||'unavailable',
      reason:result?.reason||null,
      observedValue:availableResult?result.value:null,
      items,primary, numerator:find('numerator'),denominator:find('denominator'),
      requiredComplete:operandsComplete,
      // If the result was unavailable, its diagnostic components may still
      // be present, but must never be presented as an actual KPI value.
      canDisplayFormula:availableResult&&operandsComplete&&
        spec.measurement.kind!=='unconfigured'&&items.length>0,
      componentCount:items.filter(item=>item.state==='available').length
    });
  }

  function listV2(options = {}) {
    return Object.freeze(list(options).map(entry=>getV2(entry.id)));
  }
  function list(options = {}) {
    const items = !options.category ? listValues : listValues.filter(item =>
      item.definition.category === options.category);
    return !options.calculationState
      ? items
      : items.filter(item => item.calculationState === options.calculationState);
  }

  const api = Object.freeze({
    version: '1.0.0',
    definitionSchemaVersion: V2_SCHEMA_VERSION,
    ids,
    groups,
    get,
    getCalculation,
    getV2,
    listV2,
    projectComponents,
    list
  });
  globalThis.ReclassifierKpiCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
