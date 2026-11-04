// FILE CONTRACT: manual reporting coverage attestation command boundary.
// Purpose: persist an operator-confirmed full accumulated Dataset interval.
// Reads: KPI Source Facts, Dataset Lifecycle Manager, Runtime Repository.
// Writes: Dataset meta via approved Lifecycle or SQLite Repository.
// Must not: infer cutoff from last event or change event records / Calculator.
(() => {
  'use strict';

  const IDS=Object.freeze(['itsm_data','mobile_brigade_data']);

  function set(id,input=null,confirmed=false) {
    if(!IDS.includes(id))
      throw new Error('Неподдерживаемый Dataset для подтверждения.');
    const facts=globalThis.ReclassifierKpiSourceFacts;
    if(!facts?.certifyReportingCoverage)
      throw new Error('Контракт покрытия источника недоступен.');
    const certificate=input===null?null:facts.certifyReportingCoverage(
      input,{datasetId:id,confirmed,timestamp:new Date().toISOString()}
    );
    const runtime=globalThis.ReclassifierRuntimeDataRepository;
    if(certificate){
      const active=runtime?.get?.(id);
      if(!active)throw new Error('Активный Dataset отсутствует.');
      const observed=facts.sourceReportingCoverage(id,active).observedLatestDate;
      if(observed && observed>certificate.coverageThrough)
        throw new Error('В Dataset есть события после выбранной даты окончания выгрузки: '+
          observed+'. Укажите полный подтверждённый интервал.');
    }
    if(runtime?.isSqliteAuthoritative?.()){
      const database=globalThis.ReclassifierDatabaseRepository;
      if(!database?.setReportingCoverage)
        throw new Error('Операция сохранения в SQLite недоступна.');
      database.setReportingCoverage(id,certificate);
      runtime?.invalidate?.([id]);
    }else{
      const lifecycle=globalThis.ReclassifierDatasetLifecycleManager;
      const current=lifecycle?.active?.(id);
      if(!current)throw new Error('Активный Dataset отсутствует.');
      const meta={...current.meta};
      if(certificate)meta.reportingCoverage=certificate;
      else delete meta.reportingCoverage;
      // An otherwise untouched embedded Dataset is intentionally skipped
      // by HTML snapshot export. Turn an explicitly modified certification
      // into an exportable overlay without changing its records.
      if(certificate&&meta.sourceType==='embedded'){
        meta.originSourceType='embedded';
        meta.sourceType='user';
      }
      lifecycle.activate(id,{...current,meta},{recordHistory:false});
      runtime?.invalidate?.([id]);
    }
    globalThis.ReclassifierKpiAutoRefresh?.request?.('reporting-coverage',[id]);
    return certificate;
  }

  globalThis.ReclassifierReportingCoverageManager=Object.freeze({
    set,ids:IDS
  });
})();
