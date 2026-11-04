// Independent event gate. Never selects classifier levels or copies label fields.
(() => {
  'use strict';
  const version = '4.0.0-event.1';
  const norm = text => text.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const failureLabels = Object.freeze({FAILURE:'Отказ подтверждён текстом диагностики', NON_FAILURE:'Неотказ подтверждён описанием работ или диагностикой', UNKNOWN:'Недостаточно данных', CONFLICT:'Противоречивые данные'});
  const defect = /обрыв[а-я]*|коротк[а-я]* замыкани[а-я]*|неисправ[а-я]*|поврежден[а-я]*|отказ[а-я]*|разрушен[а-я]*|сгор[а-я]*/;
  const observation = /обнаруж[а-я]*|выяв[а-я]*|найден[а-я]*|установлен[а-я]*|подтвержден[а-я]*|диагностирован[а-я]*|проверен[а-я]*|проверили|измерен[а-я]*|замерен[а-я]*/;
  const negative = /(?:^|[\s,:])не(?:[\s,:]|$)|(?:^|[\s,:])нет(?:[\s,.!?;:]|$)|без (?:признак|дефект|поврежден|неисправност|отказ)/;
  const historical = /ранее|раньше|в прошлом|стар[а-я]* (?:обрыв|дефект|отказ)|предыдущ[а-я]* (?:обращен|заявк|отказ)|не связан[а-я]* с текущ/;
  const service = /планов[а-я]*|(?:^|\s)то(?:\s|$)|техническ[а-я]* обслуживан[а-я]*|монтаж[а-я]*|демонтаж[а-я]*|перенос[а-я]*|перенести|настройк[а-я]* обзора|настроить обзор|выгрузк[а-я]* видео|выгрузить видео|предостав[а-я]* доступ/;
  const serviceDone = /выполнен[а-я]*|завершен[а-я]*|изменен[а-я]*|перенес[а-я]*|предоставлен[а-я]*|выгружен[а-я]*|смонтирован[а-я]*|демонтирован[а-я]*/;
  const symptom = /нет (?:изображения|связи|питания|напряжения|видеопотока|сигнала)|не работает|не включается|пропал[а-я]* изображен[а-я]*|отсутств[а-я]* (?:питани|связ|изображени)|потер[а-я]* (?:связ|изображени)|отключается|не отвечает|неисправ[а-я]*|отказ|обрыв/;

  function analyze(row) {
    const extractor = globalThis.ReclassifierTechnicalFactsV4;
    if (!extractor?.extract) throw new Error('V4_FACTS_MODULE_MISSING');
    const extraction = extractor.extract(row);
    // A prefix tells us the registered type, never proves a technical failure.
    const number = typeof row?.number === 'string' ? row.number.trim() : '';
    const sourceType = /^RITM(?=$|[-\s\d])/i.test(number) ? 'RITM' : /^INC(?=$|[-\s\d])/i.test(number) ? 'INC' : 'UNKNOWN';
    const evidence = [], blockers = [];
    const add = (fact, code, strength) => evidence.push({factId:fact.id, field:fact.field,
      start:fact.start, end:fact.end, text:fact.text, code, strength});
    const failure = [], nonFailure = [], serviceIntent = [], completedService = [], unresolvedSymptoms = [];
    for (const fact of extraction.facts) {
      const text = norm(fact.text);
      const closure = fact.field === 'closureNote' || fact.field === 'extraReason';
      const diagnostic = closure || fact.kind === 'diagnosis';
      const uncertain = ['hypothesis','planned','ambiguous'].includes(fact.assertion);
      if (historical.test(text)) { add(fact,'HISTORICAL_OR_OTHER_EVENT','context'); blockers.push('HISTORICAL_CONTEXT'); continue; }
      if (uncertain) {
        add(fact,'UNCERTAIN_OR_PLANNED','context');
        if (defect.test(text) || symptom.test(text)) blockers.push('UNRESOLVED_FAILURE_HYPOTHESIS');
        continue;
      }
      // Negation is conservative at fragment level. We do not borrow a
      // positive predicate across "не", "без", or a mixed statement.
      const denied = fact.assertion === 'negated' || negative.test(text);
      const explicitNoDefect = /(?:неисправност[а-я]*|дефект[а-я]*|(?:техническ[а-я]* )?отказ[а-я]*)\s+не\s+(?:обнаруж[а-я]*|выяв[а-я]*)|(?:неисправност[а-я]*|дефект[а-я]*)\s+(?:нет|отсутствуют)|(?:без|нет)\s+(?:неисправност[а-я]*|дефект[а-я]*)/.test(text);
      const testedHealthy = /провер[а-я]*|диагностик[а-я]*|испытан[а-я]*/.test(text) && /(?:^|\s)исправ[а-я]*(?:\s|[,.!]|$)|работоспособн[а-я]*/.test(text) && !denied;
      const functionalLoss = /отсутств[а-я]* (?:входн[а-я]* )?(?:питани[а-я]*|напряжени[а-я]*|связ[а-я]*|изображени[а-я]*)|не (?:работает|включается|отвечает)/.test(text);
      const deniedDiagnosis = fact.assertion==='negated' || negative.test(text.replace(/не (?:работает|включается|отвечает)/g,'недоступна'));
      const currentFailure = diagnostic && !deniedDiagnosis && (defect.test(text)||functionalLoss) &&
        (observation.test(text) || /(?:^|\s)неисправен(?:[,.!\s]|$)|(?:^|\s)неисправна(?:[,.!\s]|$)/.test(text));
      if (currentFailure) { failure.push(fact); add(fact,'EXPLICIT_DIAGNOSTIC_FAILURE','support'); }
      else if (diagnostic && (explicitNoDefect || testedHealthy)) {
        nonFailure.push(fact); add(fact,'EXPLICIT_NON_FAILURE_OBSERVATION','support');
      } else if (defect.test(text) && denied) {
        add(fact,'FAILURE_NOT_ESTABLISHED','context');
        blockers.push('FAILURE_NOT_ESTABLISHED');
      }
      if (!currentFailure && !explicitNoDefect && !testedHealthy && symptom.test(text) && fact.assertion !== 'negated') {
        unresolvedSymptoms.push(fact); add(fact,'REPORTED_SYMPTOM','context');
      }
      if ((fact.field === 'shortDescription' || fact.field === 'description') && service.test(text) && !denied) {
        serviceIntent.push(fact); add(fact,'SERVICE_REQUEST','support');
      }
      if (closure && serviceDone.test(text) && !denied && (service.test(text) || /угол обзора/.test(text))) {
        completedService.push(fact); add(fact,'SERVICE_COMPLETED','support');
      }
      if (defect.test(text) && !currentFailure && !explicitNoDefect && !denied) blockers.push('UNLOCALIZED_DEFECT_MENTION');
    }
    const uncertainInput = extraction.warnings.some(w=>w.code==='NON_TEXT_FIELD' || w.code==='MIXED_STATEMENTS');
    if (uncertainInput) blockers.push('INCOMPLETE_TEXT_INTERPRETATION');
    const distinctBlockers = [...new Set(blockers)];
    let failureState = 'UNKNOWN', eventType = 'UNDETERMINED', reasonCode = 'INSUFFICIENT_EVIDENCE';
    // Without object/time resolution, conflicting observations must not be
    // ordered away merely because the last field says "исправно".
    if (failure.length && nonFailure.length) {
      failureState='CONFLICT'; eventType='CONFLICT'; reasonCode='CONTRADICTORY_DIAGNOSTICS';
    } else if (failure.length) {
      failureState='FAILURE'; eventType='FAILURE'; reasonCode='EXPLICIT_DIAGNOSTIC_FAILURE';
    } else if (!unresolvedSymptoms.length && !distinctBlockers.length &&
        (nonFailure.length || (sourceType==='RITM' && serviceIntent.length && completedService.length))) {
      failureState='NON_FAILURE'; eventType=serviceIntent.length?'SERVICE':'NON_FAILURE'; reasonCode=nonFailure.length?'EXPLICIT_NON_FAILURE':'COMPLETED_SERVICE_WITHOUT_FAILURE_SIGNALS';
    }
    const ordinaryRitm = sourceType==='RITM' && failureState==='NON_FAILURE';
    const analyticalType = failureState==='FAILURE' ? 'INC' : ordinaryRitm ? 'RITM' : 'UNKNOWN';
    const policyPending = sourceType==='INC' && failureState==='NON_FAILURE';
    return freeze({version, extraction, sourceType, analyticalType, eventType, failureState,
      failureLabel:failureLabels[failureState], reasonCode, evidence, blockers:distinctBlockers,
      reviewRequired:!ordinaryRitm && failureState!=='FAILURE', excludeFromReclassification:ordinaryRitm,
      nextAction:ordinaryRitm?'SKIP_NON_FAILURE':failureState==='FAILURE'?'CONTINUE_TECHNICAL_CLASSIFICATION':'MANUAL_REVIEW',
      policyPending:policyPending?'INC_NON_FAILURE_V4_12':null,
      candidatePath:[null,null,null,null], readyForApply:false,
      evidenceBasis:'source_text_only', independentlyVerified:false});
  }
  globalThis.ReclassifierEventAssessmentV4 = Object.freeze({version, failureLabels, analyze});
})();
