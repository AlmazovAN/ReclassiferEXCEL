// Human-readable V4 technical evidence for columns AI onward. No apply logic.
(() => {
  'use strict';
  const columns = Object.freeze([
    'V4: версия технического разбора','Симптомы','Диагностика','Действия','Результаты',
    'Отрицания','Предположения','Запланированные действия','Неразобранные фрагменты',
    'Исходный тип обращения','V4: аналитический тип','V4: тип события','V4: факт отказа',
    'V4: основание вывода','V4: противоречия и ограничения','V4: следующий шаг',
    'V4: требуется инженерный разбор','V4: исключить неотказ из реклассификации',
    'V4: политика INC без отказа','Последовательность внутри полей','V4: готово к применению',
    'Версия алгоритма классификации','Решение алгоритма классификации','Включено в Reclassification',
    'Опора алгоритма классификации','Объединённый комментарий из МБ',
    'V4: оборудование по диагностике','V4: отказавший объект','V4: статус выбора объекта',
    'V4: основание выбора объекта','V4: объекты симптомов','V4: проверенные объекты',
    'V4: ограничения выбора объекта','V4: факт отказа после разбора объектов',
    'V4: элемент по диагностике','V4: статус выбора элемента','V4: основание выбора элемента','V4: ограничения выбора элемента',
    'V4: неисправность по диагностике','V4: статус выбора неисправности','V4: основание выбора неисправности','V4: ограничения выбора неисправности',
    'V4: причина по диагностике','V4: статус выбора причины','V4: основание выбора причины','V4: ограничения выбора причины',
    'V4: полный путь классификации','V4: статус проверки пути','V4: след доказательств по пути','V4: ограничения проверки пути',
    'V4: статус инженерной проверки','V4: маршрут разбора','V4: ограничения допуска','V4: действия инженера'
  ]);
  const fieldLabels = Object.freeze({shortDescription:'Краткое описание',description:'Описание',closureNote:'Примечание к закрытию',extraReason:'Доп. информация по причине'});
  const assertions = Object.freeze({reported:'сообщено',stated:'утверждение автора',negated:'отрицание',hypothesis:'предположение',planned:'план',ambiguous:'неоднозначно'});
  const reasons = Object.freeze({INSUFFICIENT_EVIDENCE:'Недостаточно технических доказательств',CONTRADICTORY_DIAGNOSTICS:'Диагностические утверждения противоречат друг другу; порядок и объект требуют разбора',EXPLICIT_DIAGNOSTIC_FAILURE:'В тексте явно описан установленный дефект',EXPLICIT_NON_FAILURE:'В тексте явно описана проверка без выявленных неисправностей',COMPLETED_SERVICE_WITHOUT_FAILURE_SIGNALS:'Описаны сервисный запрос и завершение работ, признаков отказа в тексте нет'});
  const eventLabels = Object.freeze({FAILURE:'Отказ',SERVICE:'Обслуживание',NON_FAILURE:'Неотказ',UNDETERMINED:'Недостаточно данных',CONFLICT:'Противоречие'});
  const warningLabels = Object.freeze({NON_TEXT_FIELD:'Нетекстовое исходное поле',UNRESOLVED_ROLE:'Роль фрагмента не определена',MIXED_STATEMENTS:'Смешанные утверждения в одном фрагменте'});
  const actions = Object.freeze({SKIP_NON_FAILURE:'Обычный RITM: классификационную цепочку не заполнять',CONTINUE_TECHNICAL_CLASSIFICATION:'Продолжить выбор оборудования, элемента, неисправности и причины',MANUAL_REVIEW:'Передать на инженерный разбор'});
  const issues = Object.freeze({HISTORICAL_CONTEXT:'Есть исторический или иной контекст события',UNRESOLVED_FAILURE_HYPOTHESIS:'Предположение об отказе не разрешено',FAILURE_NOT_ESTABLISHED:'Отказ не подтверждён; это не доказательство неотказа',UNLOCALIZED_DEFECT_MENTION:'Упомянут дефект без достаточной диагностики',INCOMPLETE_TEXT_INTERPRETATION:'Не весь текст удалось однозначно разобрать'});
  const evidenceCodes = Object.freeze({EXPLICIT_DIAGNOSTIC_FAILURE:'Диагностика отказа',EXPLICIT_NON_FAILURE_OBSERVATION:'Наблюдение неотказа',SERVICE_REQUEST:'Сервисный запрос',SERVICE_COMPLETED:'Работы завершены',REPORTED_SYMPTOM:'Симптом',FAILURE_NOT_ESTABLISHED:'Отказ не установлен',HISTORICAL_OR_OTHER_EVENT:'Другой момент или событие',UNCERTAIN_OR_PLANNED:'План или предположение'});
  function limit(value) {
    if (!value) return null;
    const text=String(value), suffix='\n[Сокращено до лимита Excel; полный текст в исходных полях]';
    return text.length<=32767 ? text : text.slice(0,32767-suffix.length)+suffix;
  }
  const formatFact = f => '['+(fieldLabels[f.field]||f.field)+':'+f.start+'–'+f.end+'; '+(assertions[f.assertion]||f.assertion)+'] '+f.text;
  const objectStatuses=Object.freeze({SELECTED:'Объект выбран',UNRESOLVED:'Недостаточно данных об объекте',NOT_APPLICABLE:'Неотказ: выбор не требуется',MULTIPLE_OBJECTS:'Несколько объектов без выделенного первичного',AMBIGUOUS_OBJECT:'Термин соответствует разным объектам',AMBIGUOUS_EQUIPMENT:'Объект относится к разному оборудованию',CONFLICT:'Противоречие по объекту'});
  const objectIssues=Object.freeze({UNBOUND_DIAGNOSTIC_DEFECT:'Дефект не связан с известным объектом',NO_PRIMARY_OBJECT:'Первичный объект не выделен',AMBIGUOUS_TERM:'Неоднозначное название или алиас',MULTIPLE_CLASSIFIER_PARENTS:'У объекта несколько допустимых родителей в справочнике',EQUIPMENT_CONTEXT_MISMATCH:'Оборудование в диагностике не согласуется с объектом',REPORTED_EQUIPMENT_DIFFERS:'Оборудование с симптомами отличается от найденного по диагностике',SAME_OR_UNSCOPED_CONTRADICTION:'Отказ и исправность относятся к одному объекту либо область не определена',NO_IDENTIFIED_FAILED_OBJECT:'Отказавший объект не установлен',HEALTHY_OTHER_OBJECT:'Исправность другого проверенного объекта не опровергает данный дефект',COORDINATED_OBJECTS:'Перечислены несколько объектов при одном диагностическом утверждении',LOSS_OF_FUNCTION_NOT_LOCALIZED:'Потеря функции не локализует неисправный аппаратный объект'});
  const formatObject=m=>'['+(fieldLabels[m.field]||m.field)+':'+m.start+'–'+m.end+'] '+m.text+' → '+m.canonical+(m.instance?' №'+m.instance:'');
  function cells(assessment, legacy={}, objects=null, element=null, failure=null, cause=null, pathReview=null, policy=null) {
    const facts=assessment.extraction.facts;
    const select = predicate => facts.filter(predicate).map(formatFact).join('\n');
    const refinedFailure=objects?.effectiveFailureState==='FAILURE';
    const refinedConflict=assessment.failureState==='CONFLICT'&&refinedFailure;
    const needsReview=(assessment.reviewRequired&&!refinedConflict)||Boolean(objects?.reviewRequired);
    const next=objects?.reviewRequired?'Передать на инженерный разбор: объект не выбран':refinedConflict?actions.CONTINUE_TECHNICAL_CLASSIFICATION:actions[assessment.nextAction]||assessment.nextAction;
    const values = [
      assessment.extraction.version+' / '+assessment.version,
      ...['symptoms','diagnosis','action','result'].map(kind=>select(f=>f.kind===kind)),
      select(f=>f.assertion==='negated'),select(f=>f.assertion==='hypothesis'),
      select(f=>f.assertion==='planned'),select(f=>f.kind==='unknown'||f.assertion==='ambiguous'),
      assessment.sourceType,refinedFailure?'INC':assessment.analyticalType,refinedFailure?eventLabels.FAILURE:eventLabels[assessment.eventType]||assessment.eventType,assessment.failureLabel,
      (reasons[assessment.reasonCode]||assessment.reasonCode)+'\n'+assessment.evidence.map(e=>
        '['+(fieldLabels[e.field]||e.field)+':'+e.start+'–'+e.end+'; '+(evidenceCodes[e.code]||e.code)+'] '+e.text).join('\n'),
      [assessment.failureState==='CONFLICT'?'Есть несовместимые диагностические утверждения':null,
        ...assessment.blockers.map(code=>issues[code]||code),
        ...assessment.extraction.warnings.map(w=>(warningLabels[w.code]||w.code)+(w.factId?' ('+w.factId+')':'')+(w.field?' — '+(fieldLabels[w.field]||w.field):'')),
        'Вывод основан на тексте; независимая проверка не выполнена'].filter(Boolean).join('\n'),
      next,needsReview?'Да':'Нет',
      assessment.excludeFromReclassification?'Да':'Нет',assessment.policyPending?'Решение отложено до V4-12':null,
      facts.map(f=>'['+(fieldLabels[f.field]||f.field)+' #'+(f.sequenceInField+1)+'] '+f.text).join('\n')+
        '\nПорядок между разными полями не установлен.',
      'Нет: требуется инженерное подтверждение; автоприменение V4 отключено',legacy.version,legacy.decision,
      legacy.included?'Да':'Нет',legacy.sourceLabel,legacy.mbComment,
      objects?.selectedEquipment,
      objects?.failedObject?objects.failedObject.canonical+(objects.failedObject.instance?' №'+objects.failedObject.instance:''):null,
      objects?(objectStatuses[objects.status]||objects.status):'Разбор объекта не выполнен',
      objects?objects.version+'\n'+(objects.failedObject?'Опора выбора: '+(objects.failedObject.selectionMode==='diagnostic_object_with_unique_classifier_parent'?'диагностический объект и единственный родитель в справочнике':'объект и оборудование в одном диагностическом фрагменте')+'\n':'')+objects.targets.map(target=>formatObject(target)+'\n'+target.evidence.map(e=>
        '['+(fieldLabels[e.field]||e.field)+':'+e.start+'–'+e.end+'] '+e.text).join('\n')).join('\n')+
        '\nРодители по справочнику: '+objects.equipmentCandidates.join('; '):null,
      objects?.roles.symptoms.map(formatObject).join('\n'),objects?.roles.diagnosis.map(formatObject).join('\n'),
      objects?.limitations.map(code=>objectIssues[code]||code).join('\n'),
      objects?(globalThis.ReclassifierEventAssessmentV4.failureLabels[objects.effectiveFailureState]||objects.effectiveFailureState):null,
      element?.selectedElement,
      element?.status||'NOT_EVALUATED',
      element?.evidence?element.version+'; диагностирован объект '+element.evidence.object+'; позиционные доказательства сохранены в V4-07':null,
      element?.limitations.join('; '),
      failure?.selectedFailure,
      failure?.status||'NOT_EVALUATED',
      failure?.evidence.map(e=>'['+(fieldLabels[e.field]||e.field)+':'+e.start+'–'+e.end+'] '+e.text+' → '+e.failure).join('\\n'),
      failure?.limitations.join('; '),
      cause?.selectedCause,
      cause?.status||'NOT_EVALUATED',
      cause?.evidence.map(e=>'['+(fieldLabels[e.field]||e.field)+':'+e.start+'–'+e.end+'] '+e.text+' → '+e.cause+' ('+e.semanticKind+')').join('\n'),
      cause?.limitations.join('; '),
      pathReview?.candidatePath.map(value=>value??'—').join(' / '),
      pathReview?.status||'NOT_EVALUATED',
      pathReview?.trace.map(e=>e.stage+': ['+(fieldLabels[e.field]||e.field)+':'+e.start+'–'+e.end+'] '+e.text).join('\n'),
      pathReview?[...pathReview.blockers,...pathReview.warnings].join('; '):null,
      policy?.status||'NOT_EVALUATED',policy?.route,
      policy?.issues.join('; '),policy?.reviewSteps.join('\n')
    ].map(limit);
    if (values.length!==columns.length) throw new Error('V4_DIAGNOSTIC_WIDTH_MISMATCH');
    return values;
  }
  globalThis.ReclassifierTechnicalDiagnosticsV4 = Object.freeze({columns, cells});
})();
