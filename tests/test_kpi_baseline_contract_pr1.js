// PR-1: compatibility baseline for all KPI definitions, facts and predictions.
// Synthetic data only. No production calculations or UI are changed by this file.
'use strict';
const assert=require('node:assert/strict');
require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
for(const p of ['common','failures','equipment','labor','sla','classification','prb','ktg','index'])
  require('../src/js/kpi/preparation/'+p+'.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/definitions.js');
for(const p of ['vbr','ktg','sla','classification_quality','classification_quality_cgps','labor','problem_management'])
  require('../src/js/kpi/calculator/'+p+'/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');
const engine=require('../src/js/kpi/forecast_engine.js');
const catalog=globalThis.ReclassifierKpiCatalog;
const passport=globalThis.ReclassifierKpiPassportView;

// Deliberately independent, explicit fixture: changing the catalog cannot silently
// rebaseline these formulas. No snapshot is generated from the production catalog.
const FORMULAS=Object.freeze({
  vbr:['(1 - FailureCount / EquipmentCount) × 100','1.0.1','%'],
  ktg:['(CalendarHours - IncidentHours - ActualMaintenanceHours - UnplannedMaintenanceHours - OtherHours) / (CalendarHours - PlannedMaintenanceHours) × 100','2.0.1','%'],
  sla:['SlaSuccessCount / SlaTotalCount × 100','1.0.0','%'],
  classification_quality:['A / (A + B + C + D) × 100','1.1.0','%'],
  classification_quality_cgps:['A_MB / (A_MB + B_MB + C_MB + D_CGPS_MB) × 100','1.0.0','%'],
  total_labor:['Σ LaborHours','1.0.0','чел.-ч'],
  avr_labor:['Σ LaborHours, FinalTaskType = АВР','1.0.0','чел.-ч'],
  avr_share:['AvrLaborHours / TotalLaborHours × 100','1.0.0','%'],
  maintenance_labor:['Σ LaborHours, FinalTaskType ∈ {ТО по графику, ТО вне графика}','1.0.0','чел.-ч'],
  corrective_labor:['Σ LaborHours, FinalTaskType = Корректирующее воздействие','1.0.0','чел.-ч'],
  reactive_share:['(AvrLaborHours + CorrectiveLaborHours) / TotalLaborHours × 100','1.0.0','%'],
  problem_coverage_absolute:['Σ LinkedLaborHours','1.0.0','чел.-ч'],
  problem_coverage_relative:['LinkedLaborHours / LaborHours × 100','1.0.0','%']
});
// PR1 remains the immutable regression baseline for the original 13 formulas.
// These additional PR7 formulas are checked independently without rebaselining it.
const NEW_FORMULAS=Object.freeze({
  problem_linked_tasks:['Σ LinkedTaskCount','1.0.0','задач'],
  problem_task_coverage:['LinkedTaskCount / TaskCount × 100','1.0.0','%'],
  problem_active_count:['COUNT_DISTINCT(ProblemId WHERE ProblemLinkState = linked)','1.0.0','проблем']
});
const expectedFormulas=Object.freeze({...FORMULAS,...NEW_FORMULAS});
const PLACEHOLDERS=[
  'required_fields_completeness','confirmed_failures_share','data_freshness',
  'kog','service_level','confirmed_labor_reduction'
];
const allIds=Object.keys(expectedFormulas).concat(PLACEHOLDERS).sort();
assert.deepEqual(catalog.list().map(x=>x.id).sort(),allIds);
assert.equal(catalog.list().length,22);
assert.equal(catalog.list().filter(x=>x.visibleInReport).length,21);
assert.equal(catalog.get('avr_share').visibleInReport,false);
const tabs=['overview','method','data','monitor'];
const sections=['overview','fact','interpretation','formula','method','sources',
  'visual','forecast','trace','control'];
for(const id of allIds){
  const entry=catalog.get(id),html=passport.renderContent(id);
  assert(entry, 'missing catalog definition '+id);
  assert(Object.isFrozen(entry),'mutable definition '+id);
  assert.equal(entry.definition.methodology.status,'draft',id);
  assert.equal(entry.definition.target,null,id);
  assert.equal(entry.definition.methodology.version,'not-assigned',id);
  assert.equal(entry.calculationState,expectedFormulas[id]?'implemented':'not-implemented',id);
  for(const tab of tabs)assert(html.includes('id="kpi-passport-tab-'+tab+'"'),id+': '+tab);
  for(const section of sections)assert(html.includes('id="kpi-passport-'+section+'"'),id+': '+section);
  assert.equal((html.match(/role="tab"/g)||[]).length,4,id);
  if(expectedFormulas[id]){
    const [formula,version,unit]=expectedFormulas[id];
    assert.equal(entry.calculation.formula.expression,formula,id);
    assert.equal(entry.calculation.formula.formulaVersion,version,id);
    assert.equal(entry.definition.unit,unit,id);
    assert(html.includes('Машинная запись и версия формулы'),id);
    assert(entry.calculation.sources.length>0,id);
  }else{
    assert.equal(entry.calculation,null,id);
    assert(html.includes('Расчёт ещё не реализован'),id);
    assert(!html.includes('Пример расчёта'),id);
  }
}
// The source semantics of known formulas are part of the historical baseline.
assert.deepEqual(catalog.get('vbr').calculation.sources.map(s=>s.datasetId),
  ['itsm_data','drivers']);
assert.deepEqual(catalog.get('ktg').calculation.sources.map(s=>s.datasetId),
  ['itsm_data','drivers']);
assert.deepEqual(catalog.get('classification_quality_cgps').calculation.sources
  .map(s=>s.datasetId),['itsm_data','mobile_brigade_data']);
assert.deepEqual(catalog.get('problem_coverage_relative').calculation.sources
  .map(s=>s.datasetId),['mobile_brigade_data','itsm_data']);

// Fact is always kept separate from forecast in the unified passport.
const snapshot={
  calculatedAt:'2026-10-11T09:00:00.000Z',
  query:{period:{month:'2026-09',label:'Сентябрь'},mine:{label:'Северный'},
    equipmentClass:{label:'Навесное'}},
  results:{vbr:{value:97.1,dataState:'available',
    components:{failureCount:29,equipmentCount:1000}}},
  kpiView:{
    cards:{vbr:{current:{value:97.1,dataState:'available',period:'2026-09'},
      forecast:{forecastType:'reporting-month-nowcast',dataState:'available',
        value:93.8,methodId:'observed-run-rate',horizon:'2026-09'}}},
    seriesById:{vbr:{points:[
      {period:'2026-08',value:95,dataState:'available'},
      {period:'2026-09',value:97.1,dataState:'available'}
    ]}}
  },sources:[{id:'drivers',available:true,activeRevision:3,contentHash:'abc'}]
};
const before=JSON.stringify(snapshot);
const rendered=passport.renderContent('vbr',{snapshot});
assert(rendered.includes('97,1 %'),'Passport fact must remain observed');
assert(rendered.includes('93,8'),'Forecast should be separate and labeled');
assert(rendered.includes('Прогноз и контроль качества'));
assert(rendered.includes('Источники и колонки'));
assert.equal(JSON.stringify(snapshot),before,'Passport must not modify snapshot');

// Reporting-month nowcast: fixed cutoff, no computer-clock fallback, no
// mixing the completed-month value into the unfinished-month observed fact.
const coverage=(sourceId)=>({
  sourceId,reportMonth:'2026-09',reportMonthStatus:'incomplete',
  coverageBasis:'source-export-cutoff',
  coverageFrom:'2026-09-01',coverageThrough:'2026-09-15'
});
const vbrInput={
  kpiId:'vbr',selectedMonth:'2026-09',reportingCoverage:coverage('itsm_data'),
  current:{dataState:'available',value:98,components:{failureCount:20,equipmentCount:1000},
    diagnostics:{partialCoverage:false}},points:[],methodId:'observed-run-rate'
};
const forecastVbr=engine.predictReportingMonth(vbrInput);
assert.equal(forecastVbr.forecastType,'reporting-month-nowcast');
assert.equal(forecastVbr.dataState,'available');
assert.equal(forecastVbr.observedValue,98);
assert.equal(forecastVbr.value,96);
assert.equal(forecastVbr.remainingDays,15);
assert.equal(forecastVbr.horizon,'2026-09');
assert.equal(forecastVbr.methodId,'observed-run-rate');
assert.equal(forecastVbr.coverageThrough,'2026-09-15');
assert.deepEqual(forecastVbr,engine.predictReportingMonth({
  ...vbrInput,asOf:'2030-01-01',now:'2030-01-01'
}),'Wall clock cannot change certified reporting nowcast');

const laborInput={metricId:'labor',selectedMonth:'2026-09',
  reportingCoverage:coverage('mobile_brigade_data'),
  current:{value:847,dataState:'available'},points:[],methodId:'observed-run-rate'};
const forecastLabor=engine.predictReportingMetric(laborInput);
assert.equal(forecastLabor.forecastType,'reporting-month-volume-nowcast');
assert.equal(forecastLabor.observedValue,847);
assert.equal(forecastLabor.value,1694);
assert.equal(forecastLabor.remainingDays,15);
assert.equal(forecastLabor.unit,'чел.-ч');
assert.equal(forecastLabor.methodId,'observed-run-rate');
assert.deepEqual(forecastLabor,engine.predictReportingMetric({
  ...laborInput,asOf:'2030-01-01',now:'2030-01-01'
}));
assert.equal(engine.REPORTING_STRATEGY.defaultMethodId,'linear-trend');
assert.deepEqual(Object.keys(engine.REPORTING_VOLUME_METRICS).sort(),
 ['avr_labor','corrective_labor','inc','labor','maintenance_labor','total_labor']);
assert.equal(engine.externalAdapter.status,'not-connected',
  'An unconnected corporate ML adapter must never be presented as functional');
assert.equal(engine.predictReportingMetric({
  ...laborInput,reportingCoverage:null
}).dataState,'insufficient');

console.log('PR-1 KPI contract baseline: 19 passports, 13 locked formulas, sources, fact/forecast separation, fixed-cutoff nowcasts OK');
