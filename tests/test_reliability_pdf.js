const assert = require('node:assert/strict');
const renderer = require('../src/js/app/reliability_pdf.js');

const snapshot = Object.freeze({
  schemaVersion: '1.0.0',
  type: 'reliability-report',
  status: 'ready',
  calculatedAt: '2026-10-08T08:15:00.000Z',
  preparationVersion: '1.0.0',
  calculatorVersion: '1.0.0',
  query: Object.freeze({
    period: Object.freeze({ id: '2026-10', month: '2026-10', label: 'Окт 2026' }),
    mine: Object.freeze({ id: 'Северный', label: 'Северный' }),
    equipmentClass: Object.freeze({ id: 'mounted', label: 'Навесное' })
  }),
  results: Object.freeze({
    vbr: Object.freeze({
      id: 'vbr', title: 'ВБР', value: 99, unit: '%', dataState: 'available',
      reason: null, formula: '(1 - FailureCount / EquipmentCount) × 100',
      formulaVersion: '1.0.0', components: Object.freeze({ failureCount: 1, equipmentCount: 100 })
    }),
    total_labor: Object.freeze({
      id: 'total_labor', title: 'Общая трудоёмкость', value: 10, unit: 'чел.-ч',
      dataState: 'available', reason: null, formula: 'Σ LaborHours',
      formulaVersion: '1.0.0', components: Object.freeze({ totalLaborHours: 10 })
    })
  }),
  series: Object.freeze({
    monthly: Object.freeze([
      Object.freeze({
        period: '2026-10', label: 'Окт 2026',
        vbr: Object.freeze({ value: 99, dataState: 'available' }),
        sla: Object.freeze({ value: 95, dataState: 'available' }),
        classification_quality: Object.freeze({ value: 90, dataState: 'available' })
      })
    ])
  }),
  breakdowns: Object.freeze({
    labor: Object.freeze([
      Object.freeze({ id: 'авр', title: 'АВР', hours: 4, share: 40 })
    ]),
    problemManagement: Object.freeze([
      Object.freeze({ id: 'linked', title: 'Связано с PRB', count: 1, laborHours: 4 })
    ])
  }),
  sources: Object.freeze([
    Object.freeze({
      id: 'itsm_data', available: true, schemaVersion: '1.0.0',
      activeRevision: 7, contentHash: 'abc', freshness: '2026-10-07',
      rowCount: 10, validationStatus: 'valid', dependencyStatus: 'not-applicable'
    })
  ])
});

assert.equal(renderer.version, '1.3.0');

const fingerprint = renderer.snapshotFingerprint(snapshot);
assert.match(fingerprint, /^[0-9a-f]{8}$/);
assert.equal(renderer.snapshotFingerprint(snapshot), fingerprint);

const changed = {
  ...snapshot,
  results: {
    ...snapshot.results,
    vbr: { ...snapshot.results.vbr, value: 98 }
  }
};
assert.notEqual(renderer.snapshotFingerprint(changed), fingerprint);

// A changed historical VBR/SLA line must not silently keep an old PDF filename.
for (const id of ['vbr','sla']) {
  const historicalUpdate={
    ...snapshot,
    series:{monthly:[{...snapshot.series.monthly[0],
      [id]:{dataState:'available',value: id==='vbr'?98:91}}]}
  };
  assert.notEqual(renderer.snapshotFingerprint(historicalUpdate),fingerprint,
    'PDF fingerprint must cover historical '+id.toUpperCase()+' chart data');
}
assert.throws(
  ()=>renderer.createPlan({...snapshot,diagnostics:{stage:'primary'}}),
  /полного Report Snapshot/,
  'A partial first-paint Snapshot cannot be exported as a complete PDF'
);

const plan = renderer.createPlan(snapshot);
assert.equal(plan.fingerprint, fingerprint);
assert.equal(plan.queryLabel, 'Окт 2026 · Северный · Навесное');
assert.equal(plan.results[0].id, 'vbr');
assert.equal(plan.results[1].id, 'total_labor');
assert.equal(plan.monthly.length, 1);
assert.equal(plan.labor[0].hours, 4);
assert.equal(plan.problemManagement[0].id, 'linked');
assert.equal(plan.sources[0].activeRevision, 7);
assert.equal(plan.evidence.kpiAvailable,2);
assert.equal(plan.evidence.kpiTotal,2);
assert.equal(plan.evidence.sourceAvailable,1);
assert.equal(plan.evidence.sourceTotal,1);
assert.equal(plan.evidence.monthCount,1);

// PR9: PDF plan includes only an eligible, already computed Snapshot forecast.
// Forecast never changes actual KPI Result but does change PDF identity.
const nowcast={forecastType:'reporting-month-nowcast',dataState:'available',
  value:97.8,observedValue:99,horizon:'2026-10',methodId:'linear-trend',
  methodVersion:'1.0.0',requestedMethodId:'linear-trend',
  strategyId:'monthly-components-remaining-days',strategyVersion:'2.0.0',
  methodComponents:{failureCount:{methodId:'linear-trend',
    methodVersion:'1.0.0',validation:{mae:.2,baselineMae:.6}}},
  coverageFrom:'2026-01-01',coverageThrough:'2026-10-08',
  asOf:'2026-10-08',quality:{historicalMonths:8,validationMonths:2}};
const withForecast={...snapshot,kpiView:{
  cards:{vbr:{forecast:nowcast}}
}};
const forecastPlan=renderer.createPlan(withForecast);
assert.equal(forecastPlan.forecastVbr.value,97.8);
assert.notEqual(forecastPlan.fingerprint,fingerprint,
  'PDF fingerprint should identify a forecast-bearing report');
assert.equal(withForecast.results.vbr.value,99,
  'Forecast must not alter actual VBR');
assert.equal(renderer.snapshotFingerprint({...withForecast,kpiView:{
  cards:{vbr:{forecast:{...nowcast,methodVersion:'1.0.1'}}}
}})===forecastPlan.fingerprint,false,
  'The actual method version must contribute to PDF fingerprint');
assert.notEqual(renderer.snapshotFingerprint({...withForecast,kpiView:{
  cards:{vbr:{forecast:{...nowcast,coverageThrough:'2026-10-09'}}}
}}),forecastPlan.fingerprint,'Certified export cutoff must change report identity');
const ktgForecast={...nowcast,kpiId:'ktg',value:98.5,observedValue:99.4,
  methodId:'mixed-components'};
const withBoth=renderer.createPlan({...withForecast,kpiView:{
  cards:{vbr:{forecast:nowcast},ktg:{forecast:ktgForecast}}
}});
assert.equal(withBoth.forecastKtg.value,98.5);
assert.notEqual(withBoth.fingerprint,forecastPlan.fingerprint);


const laborVolume={forecastType:'reporting-month-volume-nowcast',
  dataState:'available',metricId:'total_labor',
  value:1350,observedValue:847,remainingValue:503,
  horizon:'2026-10',asOf:'2026-10-08',
  coverageThrough:'2026-10-08',coverageFrom:'2026-01-01',
  methodId:'last-value',methodVersion:'1.0.0',
  sourceRevisions:[{datasetId:'mobile_brigade_data',revision:7}],
  methodComponents:{laborHours:{methodId:'last-value'}}
};
const laborSnapshot={...snapshot,kpiView:{cards:{
  total_labor:{forecast:laborVolume}
}}};
const laborPlan=renderer.createPlan(laborSnapshot);
assert.equal(laborPlan.forecastLabor.total_labor.value,1350);
assert.equal(laborPlan.results.find(r=>r.id==='total_labor').value,10);
assert.notEqual(laborPlan.fingerprint,fingerprint,
  'Forecast labor must change PDF fingerprint without altering actual hours');
assert.notEqual(renderer.snapshotFingerprint({...laborSnapshot,kpiView:{
  cards:{total_labor:{forecast:{...laborVolume,methodVersion:'2.0.0'}}}
}}),laborPlan.fingerprint);
assert.notEqual(renderer.snapshotFingerprint({...snapshot,sources:[
  {...snapshot.sources[0],reportingCoverage:{
    status:'confirmed',coverageFrom:'2026-01-01',coverageThrough:'2026-10-08',
    basis:'source-export-cutoff'
  }}
]}),fingerprint,'Certified source boundary must affect PDF identity');

const withoutForecast=renderer.createPlan({...snapshot,kpiView:{
  cards:{vbr:{forecast:{...nowcast,dataState:'insufficient',value:null}}}
}});
assert.equal(withoutForecast.forecastVbr.dataState,'insufficient');
assert.equal(renderer.snapshotFingerprint({...snapshot,kpiView:{
  cards:{vbr:{forecast:{...nowcast,dataState:'insufficient',value:null}}}
}}),fingerprint,'An unavailable forecast must not alter PDF identity');

// PR-6: the diagnostic sidecar displayed in the general KPI UI must remain
// the same source for PDF, including its report fingerprint. No KPI re-eval.
const qualityCoverage={
  version:'1.0.0',classifiedItsmCount:5,bothSameMonthCount:2,
  bothOtherMonthCount:1,bothUndatedMbCount:0,
  missingItsmRequestCount:0,itsmNotInLoadedMbCount:2,
  itsmUnknownMbCoverageCount:2,itsmConfirmedMbAbsenceCount:0,
  mbOnlyLoadedCount:1,mbUnknownItsmCoverageCount:1,mbNoRequestTaskCount:0,
  mbPresent:true,itsmCoverageStatus:'unknown',mbCoverageStatus:'unknown',
  byInitiator:[
    {label:'ЦГПС',count:3,categoryA:2,categoryB:1,categoryC:0,categoryD:0,
      bothSameMonthCount:2,bothOtherMonthCount:1},
    {label:'Группа не определена',count:2,categoryA:0,categoryB:1,categoryC:1,
      categoryD:0,bothSameMonthCount:0,bothOtherMonthCount:0}
  ]
};
const qualitySnapshot={...snapshot,results:{...snapshot.results,
  classification_quality:{
    id:'classification_quality',title:'Качество классификации общее',
    dataState:'available',value:40,unit:'%',formulaVersion:'1.1.0',
    components:{classificationIncUnchangedCount:2,
      classificationIncCorrectedCount:2,
      classificationIncUnclassifiedCount:1,
      classificationRitmInsteadOfIncCount:0,
      classificationSuccessCount:2,classificationTotalCount:5},
    diagnostics:{classificationCoverage:qualityCoverage}
  }
}};
const actualQuality=qualitySnapshot.results.classification_quality;
const pdfQuality=renderer.createPlan(qualitySnapshot);
assert.strictEqual(pdfQuality.results.find(x=>x.id==='classification_quality'),
  actualQuality,'PDF plan must use factual KPI and diagnostic sidecar directly');
const updatedQuality={...qualitySnapshot,
  results:{...qualitySnapshot.results,classification_quality:{
    ...actualQuality,diagnostics:{classificationCoverage:{
      ...qualityCoverage,bothOtherMonthCount:2
    }}
  }}
};
assert.equal(updatedQuality.results.classification_quality.value,40);
assert.notEqual(renderer.snapshotFingerprint(updatedQuality),
  pdfQuality.fingerprint,'Different numeric classification diagnostics require a different PDF');
const updatedInitiator={...qualitySnapshot,
  results:{...qualitySnapshot.results,classification_quality:{
    ...actualQuality,diagnostics:{classificationCoverage:{
      ...qualityCoverage,byInitiator:qualityCoverage.byInitiator.map((g,i)=>
        i?g:{...g,categoryB:2})
    }}
  }}
};
assert.notEqual(renderer.snapshotFingerprint(updatedInitiator),
  pdfQuality.fingerprint,'Initiator-group diagnostic changes must invalidate PDF identity');
const sameData=JSON.parse(JSON.stringify(qualitySnapshot));
assert.equal(renderer.snapshotFingerprint(sameData),pdfQuality.fingerprint,
  'Equivalent source facts have deterministic PDF identity');
assert.equal(qualitySnapshot.results.classification_quality.value,40,
  'Quality diagnostics never change actual KPI');

const name = renderer.fileName(snapshot, fingerprint);
assert.equal(name, 'Reclassifier_Reliability_2026-10_' + fingerprint + '.pdf');

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const bytes = renderer.buildPdfBytes([
  { width: 1240, height: 1754, bytes: fakeJpeg },
  { width: 1240, height: 1754, bytes: fakeJpeg }
], { fingerprint });

assert(bytes instanceof Uint8Array);
assert(bytes.length > 600);
const pdf = Buffer.from(bytes).toString('latin1');
assert(pdf.startsWith('%PDF-1.4'));
assert(pdf.includes('% ReclassifierSnapshot: ' + fingerprint));
assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 2);
assert(pdf.includes('/Count 2'));
assert(pdf.includes('/Filter /DCTDecode'));
assert(pdf.includes('xref\n0 '));
assert(pdf.includes('startxref\n'));
assert(pdf.endsWith('%%EOF\n'));

const original = JSON.stringify(snapshot);
renderer.createPlan(snapshot);
assert.equal(JSON.stringify(snapshot), original, 'PDF planning must not mutate Report Snapshot');

assert.throws(
  () => renderer.createPlan({ type: 'other-report' }),
  /requires a reliability Report Snapshot/
);

console.log('Reliability PDF renderer: Snapshot fingerprint + PDF byte structure OK');
