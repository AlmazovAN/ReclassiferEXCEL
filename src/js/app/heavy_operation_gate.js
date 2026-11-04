// TEST_15: coordinate memory-heavy operations without coupling domain logic.
// Only active in the dedicated TEST_15 build; no production scheduling change.
(() => {
  'use strict';
  const enabled = () => ['TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
  let lease = null;
  let sequence = 0;
  const note = (phase,event) =>
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(phase,event);
  function busy() { return Boolean(lease); }
  function begin(kind) {
    if(!enabled()) return null;
    if(!['xlsx','import'].includes(kind)) throw new Error('Unknown heavy job kind.');
    if(lease) throw new Error('Другая тяжёлая операция уже выполняется: '+lease.kind);
    const jobs=globalThis.ReclassifierKpiBackgroundJobs;
    const status=jobs?.status?.();
    if(status?.queued || (status?.active && status.active.priority !== 5)) {
      note('heavy-job-blocked','error');
      throw new Error('Дождитесь завершения интерактивного или ожидающего расчёта KPI перед импортом или экспортом.');
    }
    const coordinator=globalThis.ReclassifierKpiAutoRefresh;
    // Suspend BEFORE stopping the worker. A cancelled auto task must not
    // immediately schedule a new KPI calculation while SQLite/XLSX is active.
    coordinator?.pause?.(kind);
    if(status?.active?.priority===5) {
      if(jobs?.preemptAuto?.()!==true) {
        coordinator?.resume?.();
        throw new Error('Не удалось остановить фоновый KPI перед тяжёлой операцией.');
      }
      note('kpi-auto-preempted','end');
    }
    const token=++sequence;
    lease={kind,token};
    note('heavy-job-start','start');
    return token;
  }
  function end(token) {
    if(!enabled()||token===null||token===undefined||!lease||
        lease.token!==token) return false;
    lease=null;
    note('heavy-job-end','end');
    globalThis.ReclassifierKpiAutoRefresh?.resume?.();
    return true;
  }
  globalThis.ReclassifierHeavyJobGate=Object.freeze({
    begin,end,busy,status:()=>Object.freeze({active:busy(),kind:lease?.kind||null})
  });
})();
