'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/js/app/kpi_computation_service.js', 'utf8');
let prepareCalls = 0;
let formulaCalls = 0;
let traceForwarded = null;
let lastPrepared = null;
const profiler = {
  measure: (name, run) => run(),
  count: () => {}
};
const context = vm.createContext({
  ReclassifierPerformanceProfiler: profiler,
  ReclassifierKpiPreparation: {
    prepare(inputs) {
      prepareCalls += 1;
      assert.equal(inputs.itsm.fields[0], 'number');
      assert(Array.isArray(inputs.mobileBrigade.records));
      assert(Array.isArray(inputs.drivers.records));
      lastPrepared = Object.freeze({ version: 'subject-v1', families: Object.freeze({}) });
      return lastPrepared;
    }
  },
  ReclassifierKpiCalculator: {
    calculate(prepared, request) {
      assert.strictEqual(prepared, lastPrepared);
      formulaCalls += 1;
      traceForwarded = request.trace;
      return Object.freeze({
        version: 'calc-v1',
        results: Object.fromEntries(request.kpis.map(id => [
          id, Object.freeze({ dataState: 'available', value: request.period === '2026-10-01' ? 95 : 90 })
        ]))
      });
    }
  },
  ReclassifierKpiCalculatorCommon: {
    unavailable(definition, query, reason, options) {
      assert.equal(definition.id, 'vbr');
      assert.equal(query.period, '2026-10-01');
      return Object.freeze({ dataState: options.dataState, reason, diagnostics: options.diagnostics });
    }
  },
  ReclassifierKpiDefinitions: { vbr: { id: 'vbr' } },
  ReclassifierKpiCatalog: {
    list: () => [{ id: 'vbr' }],
    getCalculation: () => ({ sources: [{ datasetId: 'itsm_data' }, { datasetId: 'drivers' }] })
  },
  ReclassifierItsmDatasetSchema: { fields: ['number'] }
});
vm.runInContext(source, context);
const service = context.ReclassifierKpiComputationService;
assert(Object.isFrozen(service));
const sourceInstances = {
  itsm_data: { records: [{ number: 'INC-1' }], meta: { fields: ['number'] } },
  mobile_brigade_data: { records: [], meta: { sourceType: 'sqlite' } },
  drivers: { records: [{ value: 10 }], meta: {} },
  combined: { records: [], meta: {} }
};
const descriptors = [
  { id: 'itsm_data', available: true },
  { id: 'mobile_brigade_data', available: true },
  { id: 'drivers', available: true },
  { id: 'combined', available: true }
];
const pack = { instances: sourceInstances, sources: descriptors };
assert.equal(service.status().state, 'idle');
assert.throws(() => service.prepare({}, 's1'), /source pack/);
assert.throws(() => service.prepare(pack, ''), /revision signature/);
const first = service.prepare(pack, 's1');
assert.strictEqual(service.prepare(pack, 's1'), first, 'Identical revision must reuse prepared components');
assert.equal(prepareCalls, 1);
assert.equal(service.status().state, 'ready');
const trace = { forKpi: () => null };
const request = { prepared: first, sources: descriptors, query: { period: '2026-10-01', filters: {} }, kpis: ['vbr'], trace };
const result = service.calculate(request);
assert.equal(result.version, 'calc-v1');
assert.equal(result.results.vbr.value, 95);
assert.strictEqual(traceForwarded, trace, 'Trace must be forwarded to real Calculator');
assert.equal(formulaCalls, 1);
assert(Object.isFrozen(result));
assert(Object.isFrozen(result.results));

const missingDrivers = descriptors.map(item => item.id === 'drivers'
  ? { ...item, available: false } : item);
const guarded = service.calculate({ ...request, sources: missingDrivers });
assert.equal(guarded.results.vbr.dataState, 'no-data');
assert.equal(guarded.results.vbr.reason, 'source-missing');
assert.equal(Array.from(guarded.results.vbr.diagnostics.missingSources).join(','), 'drivers');
assert.equal(formulaCalls, 2, 'Guard must not skip the actual Calculator pass');

const replacementPack = { instances: { ...sourceInstances, drivers: { ...sourceInstances.drivers } },
  sources: descriptors };
const replaced = service.prepare(replacementPack, 's1');
assert.notStrictEqual(replaced, first, 'Object identity must invalidate same-revision source swap');
assert.equal(prepareCalls, 2);
assert.throws(() => service.calculate(request), error =>
  error.code === 'RECLASSIFIER_KPI_STALE_PREPARED');
const revisionBefore = service.status().generation;
service.invalidate();
assert.equal(service.status().state, 'idle');
assert(service.status().generation > revisionBefore);
assert.throws(() => service.calculate({ ...request, prepared: replaced }),
  error => error.code === 'RECLASSIFIER_KPI_STALE_PREPARED');
const fresh = service.prepare(replacementPack, 's2');
assert.notStrictEqual(fresh, replaced);
assert.equal(prepareCalls, 3);
const after = service.calculate({ ...request, prepared: fresh });
assert.equal(after.results.vbr.value, result.results.vbr.value);
assert.equal(after.version, result.version);

// PR6: materialized results come from the unchanged Calculator.
// The first traced result may seed the cache, but the next traced call
// must still execute so it can collect genuine selection evidence.
const noTrace={...request,prepared:fresh,trace:null};
const beforeCache=formulaCalls;
const reused=service.calculate(noTrace);
assert.strictEqual(reused.results.vbr,after.results.vbr);
assert.equal(formulaCalls,beforeCache,'Non-traced request must reuse the real result');
const tracedAgain=service.calculate({...noTrace,trace});
assert.equal(formulaCalls,beforeCache+1,'Traced request must execute the original Calculator');
assert.deepEqual(tracedAgain.results.vbr,reused.results.vbr);
const afterTrace=formulaCalls;
service.calculate(noTrace);
assert.equal(formulaCalls,afterTrace,'Repeated untraced request must not recalculate');
const alternativeScope=service.calculate({...noTrace,query:{period:'2026-09-01',filters:{mine:'Северный'}}});
assert.equal(alternativeScope.results.vbr.value,90);
assert.equal(formulaCalls,afterTrace+1);
service.calculate({...noTrace,query:{period:'2026-09-01',filters:{mine:'Северный'}}});
assert.equal(formulaCalls,afterTrace+1,'Identical period/mine must use cache');

const missingAfter=service.calculate({...noTrace,sources:missingDrivers});
assert.equal(missingAfter.results.vbr.reason,'source-missing');
assert.equal(formulaCalls,afterTrace+2,'Missing-source guard changes the cache scope');
assert.equal(service.calculate(noTrace).results.vbr.dataState,'available',
  'Unavailable source must not poison ready cached results');
assert.equal(formulaCalls,afterTrace+2);
const stats=service.status().materializedResults;
assert(stats.hits>0 && stats.misses>0 && stats.size>0);
assert.equal(stats.capacity,2048);
service.invalidate();
assert.equal(service.status().materializedResults.size,0);
assert.throws(()=>service.calculate(noTrace),e=>e.code==='RECLASSIFIER_KPI_STALE_PREPARED');

const report = fs.readFileSync('src/js/app/reliability_report_service.js','utf8');
assert(report.includes('computation.prepare('));
assert(report.includes('computation.calculate('));
assert(!report.includes('calculator.calculate('));
assert(!report.includes('preparation.prepare('));
assert(!source.includes('document.') && !source.includes('window.') &&
  !source.includes('databaseRuntime.db') && !source.includes('localStorage'),
  'Computation module must not contain UI or storage access');

console.log('PR3 KPI Computation Service: cache identity/revision, source guards, trace and Calculator parity OK');
