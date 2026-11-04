const assert = require('node:assert/strict');

require('../src/js/app/reliability_dashboard_data.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/kpi/operational_series.js');
require('../src/js/kpi/preparation/common.js');
require('../src/js/kpi/preparation/failures.js');
require('../src/js/kpi/preparation/equipment.js');
require('../src/js/kpi/preparation/labor.js');
require('../src/js/kpi/preparation/sla.js');
require('../src/js/kpi/preparation/classification.js');
require('../src/js/kpi/preparation/prb.js');
require('../src/js/kpi/preparation/ktg.js');
require('../src/js/kpi/preparation/index.js');
require('../src/js/kpi/calculator/common.js');
require('../src/js/kpi/calculator/declarative.js');
require('../src/js/kpi/calculator/definitions.js');
require('../src/js/kpi/calculator/vbr/calculate.js');
require('../src/js/kpi/calculator/ktg/calculate.js');
require('../src/js/kpi/calculator/sla/calculate.js');
require('../src/js/kpi/calculator/classification_quality/calculate.js');
require('../src/js/kpi/calculator/classification_quality_cgps/calculate.js');
require('../src/js/kpi/calculator/labor/calculate.js');
require('../src/js/kpi/calculator/problem_management/calculate.js');
require('../src/js/kpi/calculator/index.js');
require('../src/js/kpi/catalog/contracts.js');
require('../src/js/kpi/catalog/index.js');
require('../src/js/kpi/execution_trace.js');
require('../src/js/kpi/forecast_engine.js');
require('../src/js/kpi/passport_math.js');
require('../src/js/kpi/passport_view.js');
require('../src/js/kpi/report_view_model.js');
require('../src/js/kpi/chart_view_model.js');
require('../src/js/kpi/report_snapshot.js');

const ITSM_FIELDS = [
  'number', 'createdAt', 'completedAt', 'closedAt', 'territory',
  'reclassifiedEquipment', 'sourceEquipment', 'openedBy',
  'classificationQuality', 'typeAfterReclassification',
  'sputnikVbrDecision', 'sdgrService', 'division',
  'slaHours', 'preBacklogHours', 'problemLink', 'result6LaborHours', 'workType'
];
globalThis.ReclassifierItsmDatasetSchema = Object.freeze({
  fields: Object.freeze(ITSM_FIELDS.slice())
});

const itsmRows = [
  [
    'INC-1', '2026-10-01', '2026-10-02', '2026-10-03', 'Северный',
    'БКМ', 'БКМ', 'Интеграция с МБ',
    'INC без изм', 'INC', 'Считать отказом', 'Навесное оборудование', 'КФ',
    2, 3, 'PRB001047', 4, 'Монтаж'
  ],
  [
    'INC-2', '2026-10-04', '2026-10-05', '2026-10-06', 'Северный',
    'БКМ', 'БКМ', 'Пользователь',
    'INC с исправлением', 'INC', 'Исключить', 'Навесное оборудование', 'КФ',
    1, 2, 'нет', 6, 'Плановое ТО'
  ]
];

const equipmentRows = Array.from({ length: 100 }, (_, index) => ({
  id: 'M-' + String(index + 1),
  source_catalog: 'Mounted',
  unit: 'Северный',
  unit_department: 'КФ',
  name: 'БКМ',
  equipment_type: 'БКМ',
  'Статус эксплуатации': 'Активен'
}));

const datasets = {
  itsm_data: {
    id: 'itsm_data',
    records: itsmRows,
    fullDataset: {
      columns: ['Номер', 'Просрочен по разрешению'],
      recordKeys: ['INC-1', 'INC-2'],
      rows: [
        ['INC-1', 'Нет'],
        ['INC-2', 'Да']
      ]
    },
    validation: { status: 'valid', errors: [], warnings: [] },
    meta: {
      fields: ITSM_FIELDS,
      sourceType: 'sqlite',
      schemaVersion: '1.0.0',
      activeRevision: 11,
      contentHash: 'itsm-hash',
      freshness: '2026-10-06',
      loadedAt: '2026-10-08T05:00:00Z',
      dependencyStatus: 'not-applicable'
    }
  },
  mobile_brigade_data: {
    id: 'mobile_brigade_data',
    records: [
      {
        recordKey: 'north|1',
        request: 'INC-1',
        factDate: '2026-10-03',
        site: 'Северный',
        finalTaskType: 'АВР',
        laborHours: 4,
        astroHours: 2,
        laborState: 'valid',
        equipmentPlacement: 'Навесное',
        equipmentType: 'БКМ',
        transport: 'ПДМ-1'
      },
      {
        recordKey: 'north|2',
        request: 'INC-2',
        factDate: '2026-10-06',
        site: 'Северный',
        finalTaskType: 'ТО по графику',
        laborHours: 6,
        astroHours: 3,
        laborState: 'valid',
        equipmentPlacement: 'Навесное',
        equipmentType: 'БКМ',
        transport: 'ПДМ-2'
      }
    ],
    validation: { status: 'valid', errors: [], warnings: [] },
    meta: {
      sourceType: 'sqlite',
      schemaVersion: '1.5.0',
      activeRevision: 5,
      contentHash: 'mb-hash',
      freshness: '2026-10-06',
      loadedAt: '2026-10-08T05:00:00Z',
      dependencyStatus: 'not-applicable'
    }
  },
  drivers: {
    id:'drivers',
    records:[
      {mine:'Северный',name:'БКМ',service:'Навесное оборудование',system:'СДГР',value:100,unit:'шт',valueState:'value'},
      {mine:'Все рудники',name:'БКМ',service:'Навесное оборудование',system:'СДГР',value:100,unit:'шт',valueState:'value'}
    ],
    validation:{status:'valid',errors:[],warnings:[]},
    meta:{sourceType:'sqlite',schemaVersion:'1.0.0',activeRevision:7,
      contentHash:'drivers-hash',freshness:'2026-10-08',loadedAt:'2026-10-08T05:00:00Z'}
  },
  combined: {
    id: 'combined',
    records: equipmentRows,
    validation: { status: 'valid', errors: [], warnings: [] },
    meta: {
      sourceType: 'sqlite',
      schemaVersion: '2.0.0',
      freshness: '2026-10-01',
      loadedAt: '2026-10-08T05:00:00Z',
      sourceCatalogs: [{ id: 'mounted', freshness: '2026-10-01' }]
    }
  }
};

globalThis.ReclassifierRuntimeDataRepository = Object.freeze({
  get(id) {
    return datasets[id] || null;
  }
});

// Count actual single-KPI Calculator calls without changing the formula implementation.
const rawCalculator=globalThis.ReclassifierKpiCalculator;
const chartCalculatorCalls=[];
globalThis.ReclassifierKpiCalculator=Object.freeze({...rawCalculator,
  calculate:(...args)=>{
    if(args[1]?.kpis?.length===1) chartCalculatorCalls.push({
      id:args[1].kpis[0],period:args[1].period,
      filters:JSON.stringify(args[1].filters)
    });
    return rawCalculator.calculate(...args);
  }
});
require('../src/js/app/kpi_computation_service.js');
require('../src/js/app/reliability_report_service.js');
const service = globalThis.ReclassifierReliabilityReportService;
const computation = globalThis.ReclassifierKpiComputationService;
assert.ok(service);
assert.equal(computation.status().state, 'idle');

const reportFilters = {period:'latest',mine:'Северный',equipmentClass:'mounted'};
const primary = service.buildSnapshot(reportFilters, {
  stage:'primary',now:'2026-10-08T06:30:00.000Z'
});
assert.equal(primary.diagnostics.stage,'primary');
assert.equal(primary.series.monthly.length,0,'Primary stage must not calculate monthly history');
assert.equal(service.getCachedSnapshot(reportFilters),null,'Partial Snapshot must not enter full cache');
const snapshot = service.buildSnapshot(reportFilters, {
  now: '2026-10-08T06:30:00.000Z'
});
assert.equal(snapshot.diagnostics.stage,'full');
assert(snapshot.series.monthly.length>0,'Full Report Snapshot must retain monthly history');
assert.deepEqual(primary.results,snapshot.results,'Primary and full stages must use identical KPI formulas and values');
assert.deepEqual(primary.executionTrace,snapshot.executionTrace,'Observed trace must be identical');

// PR-1: a real Report Snapshot carries certified coverage separately from
// latest event dates, Calculator values, and today's calendar date.
assert.equal(snapshot.reportingCoverage.version,'1.0.0');
assert(Object.isFrozen(snapshot.reportingCoverage));
assert(Object.isFrozen(snapshot.reportingCoverage.kpis.vbr));
assert.equal(snapshot.reportingCoverage.sources.itsm_data.status,'observed-only');
assert.equal(snapshot.reportingCoverage.sources.itsm_data.coverageThrough,'2026-10-06');
assert.equal(snapshot.reportingCoverage.kpis.vbr.reportMonthStatus,'incomplete');
assert.equal(snapshot.reportingCoverage.kpis.vbr.coverageBasis,'observed-event-horizon');
assert.equal(snapshot.reportingCoverage.kpis.ktg.reportMonthStatus,'incomplete');
assert.equal(snapshot.reportingCoverage.kpis.classification_quality.sourceId,'itsm_data');
assert.equal(snapshot.reportingCoverage.kpis.classification_quality_cgps.sourceId,'itsm_data');
assert.equal(snapshot.reportingCoverage.kpis.total_labor.sourceId,'mobile_brigade_data');
assert.deepEqual(primary.reportingCoverage,snapshot.reportingCoverage);

const beforeCoverage=datasets.itsm_data;
datasets.itsm_data={...beforeCoverage,meta:{...beforeCoverage.meta,
  reportingCoverage:{confirmed:true,basis:'source-export-cutoff',
    coverageFrom:'2026-01-01',coverageThrough:'2026-10-15'}
}};
const sourceCutoffSnapshot=service.buildSnapshot(reportFilters,{
  now:'2026-11-10T09:00:00.000Z'
});
assert.equal(sourceCutoffSnapshot.reportingCoverage.sources.itsm_data.status,'confirmed');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.vbr.reportMonth,'2026-10');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.vbr.reportMonthStatus,'incomplete');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.ktg.reportMonthStatus,'incomplete');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.vbr.selectedMonthStatus,'incomplete');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.total_labor.reportMonthStatus,'incomplete');
assert.equal(sourceCutoffSnapshot.reportingCoverage.kpis.vbr.coverageThrough,'2026-10-15');
assert.equal(sourceCutoffSnapshot.calculatedAt,'2026-11-10T09:00:00.000Z');
for(const id of Object.keys(snapshot.results)){
  const actual=sourceCutoffSnapshot.results[id],expected=snapshot.results[id];
  for(const field of ['value','dataState','reason','formulaVersion','components']){
    assert.deepEqual(actual[field],expected[field],
      'Source cutoff must not change factual '+id+' '+field);
  }
}
assert.notDeepEqual(
  sourceCutoffSnapshot.results.classification_quality.diagnostics.classificationCoverage,
  snapshot.results.classification_quality.diagnostics.classificationCoverage,
  'Coverage-dependent diagnostics must reflect newly certified source boundaries.');
datasets.itsm_data=beforeCoverage;
service.invalidate();

assert.equal(snapshot.schemaVersion, '1.0.0');
assert.equal(snapshot.status, 'ready');
assert.equal(snapshot.calculatedAt, '2026-10-08T06:30:00.000Z');
assert.equal(snapshot.query.period.month, '2026-10');
assert.equal(snapshot.query.mine.id, 'Северный');
assert.equal(snapshot.query.equipmentClass.id, 'mounted');
assert.equal(snapshot.results.vbr.dataState, 'available');
assert.equal(snapshot.results.vbr.value, 99);
assert.equal(snapshot.results.vbr.components.failureCount, 1);
assert.equal(snapshot.results.vbr.components.equipmentCount, 100);
assert.equal(snapshot.results.vbr.diagnostics.populationBasis,'fixed-drivers-reference');
assert.equal(snapshot.sources.find(x=>x.id==='drivers').activeRevision,7);
assert.equal(snapshot.executionTrace?.byKpi?.vbr?.preparation?.find(x=>x.tableId==='equipment_population')?.diagnostics?.summaryRowsSkipped,1);
assert.equal(snapshot.results.sla.value, 50);
assert.equal(snapshot.results.classification_quality.value, 50);
assert.equal(snapshot.results.total_labor.value, 10);
assert.equal(snapshot.results.avr_labor.value, 4);
assert.equal(snapshot.results.avr_task_count.value,1);
assert.equal(snapshot.results.avr_task_count.unit,'шт.');
assert.equal(snapshot.results.avr_task_count.components.avrTaskCount,1);
assert.equal(snapshot.results.avr_task_count.components.avrUsableTaskCount,1);
assert.equal(snapshot.results.avr_task_count.components.avrUnusableTaskCount,0);
assert.equal(snapshot.results.avr_task_count.formulaVersion,'1.0.0');
assert.equal(snapshot.results.avr_share.value, 40);
assert.equal(snapshot.results.maintenance_labor.value, 6);
assert.equal(snapshot.results.problem_coverage_absolute.value, 4);
assert.equal(snapshot.results.problem_coverage_relative.value, 40);
assert.equal(snapshot.executionTrace.version,'1.0.0');
assert.equal(Object.keys(snapshot.executionTrace.byKpi).length,23);
assert.equal(snapshot.results.problem_linked_tasks.value,1);
assert.equal(snapshot.results.problem_task_coverage.value,50);
assert.equal(snapshot.results.problem_active_count.value,1);
const countTrace=snapshot.executionTrace.byKpi.avr_task_count;
assert.equal(countTrace.evidence,'observed');
assert.equal(countTrace.value,1);
assert.equal(countTrace.sources[0].datasetId,'mobile_brigade_data');
assert.equal(countTrace.sources[0].revision,5);
assert.equal(countTrace.components.avrTaskCount,1);
const countSubsets=countTrace.events.filter(x=>x.kind==='subset');
assert.equal(countSubsets.length,3);
assert.deepEqual(countSubsets.map(x=>x.componentKey),[
  'avrTaskCount','avrUsableTaskCount','avrUnusableTaskCount']);
assert(countSubsets.every(x=>x.field==='finalTaskType'&&x.inputRows===2&&
  x.outputRows===1&&x.excludedRows===1&&x.acceptedTypes[0]==='АВР'));
const slaTrace=snapshot.executionTrace.byKpi.sla;
assert.equal(slaTrace.evidence,'observed');
assert.equal(slaTrace.value,snapshot.results.sla.value);
assert.equal(slaTrace.components.slaSuccessCount,1);
assert.equal(slaTrace.components.slaTotalCount,2);
assert.equal(slaTrace.sources[0].datasetId,'itsm_data');
assert.equal(slaTrace.sources[0].sourceRows,2);
assert.equal(slaTrace.sources[0].revision,11);
assert.equal(slaTrace.sources[0].hash,'itsm-hash');
assert(slaTrace.preparation.some(x=>x.tableId==='sla'&&x.preparedRows>0));
const slaFilter=slaTrace.events.find(x=>x.kind==='selection');
assert.equal(slaFilter.tableId,'sla');
assert(slaFilter.stages.some(x=>x.stage==='period'&&x.outputRows===1));
assert(slaFilter.stages.some(x=>x.stage==='dimension'&&x.filter==='mine'));
assert(slaFilter.stages.every(x=>x.inputRows-x.outputRows===x.excludedRows));
const vbrTrace=snapshot.executionTrace.byKpi.vbr;
assert.equal(vbrTrace.value,99);
assert.deepEqual(vbrTrace.events.filter(x=>x.kind==='selection').map(x=>x.tableId),
  ['failure_events','equipment_population']);
assert.equal(vbrTrace.components.failureCount,1);
assert.equal(vbrTrace.components.equipmentCount,100);
const avrTrace=snapshot.executionTrace.byKpi.avr_share;
const subset=avrTrace.events.find(x=>x.kind==='subset');
assert.equal(subset.inputRows,2);
assert.equal(subset.outputRows,1);
assert.equal(subset.excludedRows,1);
assert.equal(subset.sumValue,4);
assert.equal(avrTrace.components.avrLaborHours,4);
assert.equal(avrTrace.components.totalLaborHours,10);
const prbTrace=snapshot.executionTrace.byKpi.problem_coverage_relative;
const linkage=prbTrace.events.find(x=>x.kind==='linkage');
assert.equal(linkage.taskCount,2);
assert.equal(linkage.linkedTaskCount,1);
assert.equal(linkage.unlinkedTaskCount,1);
assert.equal(linkage.linkedLaborHours,4);
assert.equal(prbTrace.preparation.find(x=>x.tableId==='problem_management').diagnostics.linkage.requestMatched,2);
assert.notEqual(snapshot.executionTrace.byKpi.ktg.evidence,'not-implemented');
assert.equal(snapshot.executionTrace.byKpi.ktg.evidence,'observed');
assert.ok(Math.abs(snapshot.results.ktg.value-((74400-5)/74400*100))<1e-8);
assert.equal(snapshot.results.ktg.components.equipmentUnits,100);
assert.equal(snapshot.results.ktg.components.calendarHours,74400);
const selectedKtg=service.buildKpiSelectionSummary('ktg',
  {period:'2026-10',mine:'all',equipmentClass:'all'},
  ['Северный'],['mounted'],{fromMonth:'2026-10',toMonth:'2026-10'});
assert.equal(selectedKtg.result.dataState,'available');
assert.equal(selectedKtg.result.components.incidentHours,5);
assert.equal(selectedKtg.result.components.plannedMaintenanceHours,0);
assert.equal(selectedKtg.result.components.actualDowntimeHours,5);
assert.equal(selectedKtg.result.components.equipmentUnits,100);
assert.equal(selectedKtg.result.components.calendarHours,74400);
assert.equal(selectedKtg.result.diagnostics.selectedUsableTaskRows,2);
assert.equal(selectedKtg.result.components.actualMaintenanceHours,0);
const doubleClassKtg=service.buildKpiSelectionSummary('ktg',
  {period:'2026-10',mine:'all',equipmentClass:'all'},
  ['all','Северный'],['mounted','stationary'],{fromMonth:'2026-10',toMonth:'2026-10'});
assert.equal(doubleClassKtg.result.components.incidentHours,5,
  'Overlapping selected mines/classes must aggregate factual AVR only once.');

assert(Object.isFrozen(snapshot.executionTrace));
assert(Object.isFrozen(slaTrace.events));
assert(Object.isFrozen(slaTrace.components));
const modalHtml=globalThis.ReclassifierKpiPassportView.renderContent('sla',{snapshot});
assert(modalHtml.includes('Показать расчёт'));
assert(modalHtml.includes('Отбор · sla'));
assert(modalHtml.includes('Период ∈ 2026-10'));
assert(modalHtml.includes('Исходных записей (весь набор)'));
assert(modalHtml.includes('Исключено:'));
assert(modalHtml.includes('Северный'));
assert(modalHtml.includes('itsm-hash'));
assert(modalHtml.includes('Статус доказательств'));
assert(modalHtml.includes('Calculator'));
const vbrHtml=globalThis.ReclassifierKpiPassportView.renderContent('vbr',{snapshot});
assert(vbrHtml.includes('Отбор · failure_events'));
assert(vbrHtml.includes('Отбор · equipment_population'));
const prbHtml=globalThis.ReclassifierKpiPassportView.renderContent('problem_coverage_relative',{snapshot});
assert(prbHtml.includes('Охват PRB в выбранных группах'));
assert(prbHtml.includes('Связанных: 1'));
const noKpi=globalThis.ReclassifierKpiPassportView.renderContent('ktg',{snapshot});
assert(noKpi.includes('КТГ'));



assert(snapshot.filters.periods.some(item => item.id === '2026-10'));
assert(snapshot.filters.mines.some(item => item.id === 'Северный'));
assert(snapshot.filters.equipmentClasses.some(item => item.id === 'mounted'));
assert.equal(snapshot.breakdowns.labor.length, 2);
assert.equal(snapshot.breakdowns.problemManagement.length, 2);

const itsmSource = snapshot.sources.find(item => item.id === 'itsm_data');
const mbSource = snapshot.sources.find(item => item.id === 'mobile_brigade_data');
assert.equal(itsmSource.activeRevision, 11);
assert.equal(itsmSource.contentHash, 'itsm-hash');
assert.equal(mbSource.activeRevision, 5);
// A missing cutoff is a visible diagnosis, not an omitted forecast field.
const unconfirmedOperational=service.buildOperationalChartData('labor','month',
  {period:'2026-10',mine:'Северный',equipmentClass:'mounted'},
  ['Северный'],['mounted'],{range:'1y',window:1});
assert.equal(unconfirmedOperational.series[0].points.at(-1).value,10);
assert.equal(unconfirmedOperational.series[0].forecast.dataState,'available');
assert.equal(unconfirmedOperational.series[0].forecast.coverageBasis,
  'observed-event-horizon');
assert.equal(unconfirmedOperational.series[0].forecast.methodId,'observed-run-rate');
assert.equal(unconfirmedOperational.series[0].forecast.observedValue,10);
assert.equal(unconfirmedOperational.series[0].forecast.value,10/6*31);
assert(unconfirmedOperational.series[0].forecast.caveats.some(
  message=>message.includes('полноту загруженных данных')));
assert.equal(unconfirmedOperational.series[0].forecast.forecastType,
  'reporting-month-volume-nowcast');
assert(Object.isFrozen(unconfirmedOperational.series[0].forecast));
assert.equal(snapshot.series.monthly.length, 1);
assert.equal(snapshot.series.monthly[0].period, '2026-10');
assert.equal(snapshot.series.monthly[0].sla.value, 50);
assert.equal(snapshot.series.monthly[0].total_labor.value, 10);
assert.equal(snapshot.series.monthly[0].problem_coverage_relative.value, 40);
assert.equal(snapshot.kpiView.version, '1.0.0');
assert.equal(snapshot.kpiView.catalogVersion, globalThis.ReclassifierKpiCatalog.version);
assert.equal(Object.keys(snapshot.kpiView.cards).length, 23);
assert.equal(snapshot.kpiView.cards.avr_task_count.current.value,1);
assert.equal(snapshot.kpiView.cards.avr_task_count.forecast.reason,'insufficient-history');
assert.equal(snapshot.kpiView.cards.avr_task_count.forecast.value,null);
assert.equal(Object.keys(snapshot.kpiView.seriesById).length, 23);
assert.equal(snapshot.kpiView.seriesById.avr_task_count.points[0].value,1);
assert.equal(snapshot.kpiView.cards.vbr.current.value, 99);
assert.equal(snapshot.kpiView.cards.vbr.current.period, '2026-10');
assert.equal(snapshot.kpiView.cards.vbr.previous.period, '2026-09');
assert.equal(snapshot.kpiView.cards.vbr.previous.value, null);
assert.equal(snapshot.kpiView.cards.vbr.change, null);
assert.equal(snapshot.kpiView.cards.vbr.forecast.horizon,'2026-10');
assert.equal(snapshot.kpiView.cards.vbr.forecast.dataState,'available');
assert.equal(snapshot.kpiView.cards.vbr.forecast.coverageBasis,
  'observed-event-horizon');
assert.equal(snapshot.kpiView.cards.vbr.forecast.observedValue,99);
assert(snapshot.kpiView.cards.vbr.forecast.value<99);
assert(snapshot.kpiView.cards.vbr.forecast.caveats.some(
  message=>message.includes('полнота выгрузки не доказана')));
assert.equal(snapshot.kpiView.cards.sla.forecast.reason,'insufficient-history');
assert.equal(snapshot.kpiView.cards.sla.forecast.requestedHorizonMonths,1);
assert.equal(snapshot.kpiView.cards.sla.current.value, 50);
assert.equal(snapshot.kpiView.cards.sla.sourceRevisions[0].revision, 11);
assert.equal(snapshot.kpiView.cards.sla.passportRef.kpiId, 'sla');
assert.equal(snapshot.kpiView.seriesById.sla.points[0].value, 50);
assert.equal(snapshot.kpiView.seriesById.total_labor.points[0].value, 10);
assert.ok(snapshot.kpiView.cards.ktg.current.value>99);
assert.notEqual(snapshot.kpiView.cards.ktg.current.dataState, 'not-applicable');
assert.equal(snapshot.diagnostics.catalogVersion, globalThis.ReclassifierKpiCatalog.version);
assert(Object.isFrozen(snapshot.kpiView.cards.sla));
assert(Object.isFrozen(snapshot.kpiView.seriesById.sla.points));

// Both classification charts are real KPI Calculator slices. Equipment names
// for these KPIs must come from ITSM facts rather than the Drivers baseline.
const qualityScope={period:'2026-10',mine:'Северный',equipmentClass:'mounted'};
const overallQualityChart=service.buildKpiChartMultiData(
  'classification_quality',qualityScope,['Северный'],['mounted'],{range:'1m',window:1});
const cgpsQualityChart=service.buildKpiChartMultiData(
  'classification_quality_cgps',qualityScope,['Северный'],['mounted'],{range:'1m',window:1});
assert.equal(overallQualityChart.kpiId,'classification_quality');
assert.equal(cgpsQualityChart.kpiId,'classification_quality_cgps');
assert.deepEqual(cgpsQualityChart.equipmentNameOptions.map(option=>option.id),['БКМ']);
assert.equal(overallQualityChart.series[0].points.at(-1).value,50);
assert.equal(cgpsQualityChart.series[0].points.at(-1).value,50);
assert.equal(cgpsQualityChart.series[0].points.at(-1).components.classificationTotalCount,2);
assert.equal(cgpsQualityChart.series[0].points.at(-1).components.classificationIncUnchangedCount,1);
assert.equal(cgpsQualityChart.series[0].points.at(-1).components.classificationIncCorrectedCount,1);
assert(cgpsQualityChart.series[0].points.at(-1).formulaVersion);
const selectedName=service.buildKpiChartMultiData(
  'classification_quality_cgps',qualityScope,['Северный'],['mounted'],
  {range:'1m',window:1,equipmentNames:['БКМ']});
assert.equal(selectedName.selectedEquipmentNames[0],'БКМ');
assert.equal(selectedName.series[0].points.at(-1).value,50);

// Step 7: chart adapter uses same subject preparation and real calculator, not demo values.
const chartSla=service.buildKpiChartData('sla',{
  period:'2026-10',mine:'Северный',equipmentClass:'mounted'
});
assert.equal(chartSla.kpiId,'sla');
assert.equal(chartSla.selectedMonth,'2026-10');
assert.equal(chartSla.selectedMine,'Северный');
assert.equal(chartSla.series.kpiId,'sla');
assert.equal(chartSla.series.points.at(-1).period,'2026-10');
assert.equal(chartSla.series.points.at(-1).value,50);
assert.equal(chartSla.series.points.at(-1).components.slaSuccessCount,1);
assert.equal(chartSla.series.points.at(-1).components.slaTotalCount,2);
assert(chartSla.mineOptions.some(o=>o.id==='Северный'));
assert.equal(chartSla.comparison.find(o=>o.mineId==='Северный').value,50);
assert(Object.isFrozen(chartSla.series));
assert(Object.isFrozen(chartSla.comparison));
const chartAll=service.buildKpiChartData('total_labor',{
  period:'2026-10',mine:'all',equipmentClass:'mounted'
},'all');
assert.equal(chartAll.series.points.at(-1).value,10);
assert.equal(chartAll.comparison.find(o=>o.mineId==='Северный').value,10);
const chartVbr=service.buildKpiChartData('vbr',{
  period:'2026-10',mine:'Северный',equipmentClass:'mounted'
});
assert.equal(chartVbr.series.points.at(-1).value,99);
const multi=service.buildKpiChartMultiData('vbr',{
 period:'2026-10',mine:'all',equipmentClass:'all'
},['Северный','all'],['mounted','stationary']);
assert.equal(multi.series.length,4);
// PR-10 diagnostic baseline: a populated incomplete KPI month must expose
// its separate forecast to the visual layer for both percentage KPIs.
for(const kpiId of ['vbr','ktg']){
  const check=service.buildKpiChartMultiData(kpiId,{
    period:'2026-10',mine:'Северный',equipmentClass:'mounted'
  },['Северный'],['mounted'],{range:'1y',window:1});
  const item=check.series[0];
  assert.equal(item.forecast?.dataState,'available',
    'Real chart service must deliver a percentage forecast for '+kpiId);
  assert.equal(item.forecast?.forecastType,'reporting-month-nowcast');
  assert.equal(item.forecast?.observedValue,item.points.at(-1)?.value);
  assert.equal(item.forecast?.coverageBasis,'observed-event-horizon');
  assert.equal(item.forecast?.methodId,'observed-run-rate');
  const selected=service.buildKpiChartMultiData(kpiId,{
    period:'2026-10',mine:'Северный',equipmentClass:'mounted'
  },['Северный'],['mounted'],{
    range:'1m',window:1,forecastMethodId:'observed-run-rate'
  });
  assert.equal(selected.series[0].forecast.dataState,'available');
  assert.equal(selected.series[0].forecast.observedValue,
    selected.series[0].points.at(-1).value);
  assert.equal(selected.series[0].forecast.value,item.forecast.value,
    'Forecast remains stable when chart viewport changes');

}

assert.deepEqual(multi.selectedMines,['Северный','all']);
assert.deepEqual(multi.selectedClasses,['mounted','stationary']);
assert.deepEqual(multi.equipmentNameOptions.map(x=>x.label),['БКМ']);
assert.deepEqual(multi.selectedEquipmentNames,[]);
const nameFiltered=service.buildKpiChartMultiData('vbr',{
  period:'2026-10',mine:'all',equipmentClass:'all'
},['Северный'],['mounted'],{range:'1m',equipmentNames:['БКМ']});
assert.deepEqual(nameFiltered.selectedEquipmentNames,['БКМ']);
assert.equal(nameFiltered.series[0].points.at(-1).value,99);
assert.equal(service.buildKpiSelectionSummary('vbr',{
  period:'2026-10',mine:'all',equipmentClass:'all'
},['Северный'],['mounted'],{
  fromMonth:'2026-10',toMonth:'2026-10',equipmentNames:['БКМ']
}).result.value,99);
assert.throws(()=>service.buildKpiChartMultiData('vbr',{},['all'],['mounted'],
  {equipmentNames:['Несуществующее оборудование']}),/Unknown equipment name/);

assert.equal(multi.series.find(s=>s.mineId==='Северный'&&s.equipmentClass==='mounted').points.at(-1).value,99);
assert.equal(multi.series.find(s=>s.mineId==='all'&&s.equipmentClass==='mounted').points.at(-1).value,99);
assert.ok(multi.mineOptions.some(m=>m.id==='zf'));
assert.ok(multi.mineOptions.some(m=>m.id==='all'));
const zf=service.buildKpiChartMultiData('vbr',{period:'2026-10'},['zf'],['mounted']);
assert.equal(zf.series.length,1);
assert.equal(zf.series[0].points.at(-1).value,null,
  'ZF must exclude the Northern mine, not average individual KPIs.');
assert.throws(()=>service.buildKpiChartMultiData('vbr',{period:'2026-10'},
  ['Северный','Таймырский','Маяк','ЗФ'],['mounted']),/Unknown comparison mine|no more than three/);
const missingChart=service.buildKpiChartData('ktg',{
  period:'2026-10',mine:'Северный',equipmentClass:'mounted'
});
assert.ok(missingChart.series.points.at(-1).value>99);
assert.ok(missingChart.comparison[0].value>99);
assert.throws(()=>service.buildKpiChartData('invented'),/Unknown KPI/);
assert.throws(()=>service.buildKpiChartData('sla',{},'wrong-mine'),/Unknown mine/);

// PR 4 — snapshot cache never reruns the same historical calculation.
const request = {period:'latest',mine:'Северный',equipmentClass:'mounted'};
assert.equal(service.getCachedSnapshot(request),null,
  'Explicit now snapshots must not be silently cached.');
const cachedA=service.buildSnapshot(request);
const cachedB=service.buildSnapshot({...request});
assert.strictEqual(cachedA,cachedB,'Repeat of an unchanged report must return the same frozen Snapshot.');
assert.strictEqual(service.getCachedSnapshot(request),cachedA);
assert(Object.isFrozen(cachedA));
const otherPeriod=service.buildSnapshot({...request,period:'2026-10'});
assert.notStrictEqual(otherPeriod,cachedA,'Distinct selected period has its own snapshot key.');
assert.strictEqual(otherPeriod.series.monthly,cachedA.series.monthly,
  'Changing only the selected month must reuse the independent monthly results.');
assert.strictEqual(otherPeriod.filters,cachedA.filters,
  'Report filter catalog must be built only once per prepared Dataset revision.');
assert.strictEqual(service.buildSnapshot(request),cachedA,
  'Cached report must survive switching between other report slices.');
assert.equal(service.getCachedSnapshot({...request,mine:'all'}),null);
const revisionBefore=datasets.mobile_brigade_data.meta.activeRevision;
datasets.mobile_brigade_data.meta.activeRevision=revisionBefore+1;
assert.equal(service.getCachedSnapshot(request),null,
  'A changed dataset revision must invalidate cached snapshot automatically.');
const revised=service.buildSnapshot(request);
assert.notStrictEqual(revised,cachedA);
assert.equal(revised.sources.find(source=>source.id==='mobile_brigade_data').activeRevision,revisionBefore+1);
datasets.mobile_brigade_data.meta.activeRevision=revisionBefore;
assert.equal(service.getCachedSnapshot(request),null);
const restored=service.buildSnapshot(request);
assert.equal(restored.results.vbr.value,cachedA.results.vbr.value);
assert.notStrictEqual(restored,cachedA);
const oldDrivers=datasets.drivers;
datasets.drivers={...oldDrivers,records:oldDrivers.records.slice(),
  meta:{...oldDrivers.meta}};
assert.equal(service.getCachedSnapshot(request),null,
  'Replacing source object with identical revision metadata must also invalidate.');
service.buildSnapshot(request);
datasets.drivers=oldDrivers;
assert.equal(service.getCachedSnapshot(request),null);
const afterRestore=service.buildSnapshot(request);
service.invalidate();
assert.equal(service.getCachedSnapshot(request),null,'Explicit invalidation clears snapshot and monthly caches.');
const afterInvalidate=service.buildSnapshot(request);
assert.notStrictEqual(afterInvalidate,afterRestore);
assert.equal(afterInvalidate.results.vbr.value,afterRestore.results.vbr.value);

// PR 6: a 58-month sparse source history and mixed month-viewports.
const originalMb=datasets.mobile_brigade_data;
const extra=[];
for(let year=2022;year<=2026;year++)for(let month=1;month<=12;month++){
  const period=String(year)+'-'+String(month).padStart(2,'0');
  if(period>='2026-10')continue;
  extra.push({
    recordKey:'perf|'+period,request:'INC-PERF-'+period,
    factDate:period+'-14',site:'Северный',finalTaskType:'АВР',
    laborHours:2,astroHours:1,laborState:'valid',
    equipmentPlacement:'Навесное',equipmentType:'БКМ'
  });
}
datasets.mobile_brigade_data={...originalMb,
  records:[...originalMb.records,...extra],
  meta:{...originalMb.meta,activeRevision:originalMb.meta.activeRevision+3}};
// Add audited ITSM observation-only months to the VBR 3-month formula fixture.
// An MB-only month no longer counts as a confirmed zero-failure ITSM month.
const originalItsm=datasets.itsm_data;
const excludedMonth=month=>[
  'INC-EXCLUDED-'+month,month+'-01',month+'-15',month+'-16','Северный',
  'БКМ','БКМ','Пользователь','INC без изм','INC','Исключить',
  'Навесное оборудование','КФ',0,0,'нет',0,'Монтаж'
];
datasets.itsm_data={...originalItsm,
  records:[...originalItsm.records,excludedMonth('2026-08'),excludedMonth('2026-09')],
  meta:{...originalItsm.meta,activeRevision:originalItsm.meta.activeRevision+1}};
// ITSM must observe every historical KTG month; MB-only history is insufficient.
const historicItsm=extra.map(row=>[
  'INC-KTG-'+row.factDate,row.factDate,row.factDate,row.factDate,'Северный',
  'БКМ','БКМ','Пользователь','INC без изм','INC','Исключить',
  'Навесное оборудование','КФ',0,1,'нет',0,'Монтаж'
]);
datasets.itsm_data={...datasets.itsm_data,
  records:[...datasets.itsm_data.records,...historicItsm],
  meta:{...datasets.itsm_data.meta,activeRevision:datasets.itsm_data.meta.activeRevision+1}};
// PR-3: forecast completion of the last certified reporting month, even if
// the report was launched later. Month facts remain untouched in the Snapshot.
datasets.itsm_data={...datasets.itsm_data,
  meta:{...datasets.itsm_data.meta,reportingCoverage:{
    confirmed:true,basis:'source-export-cutoff',
    coverageFrom:'2022-01-01',coverageThrough:'2026-10-15'
  }}
};
datasets.mobile_brigade_data={...datasets.mobile_brigade_data,
  meta:{...datasets.mobile_brigade_data.meta,reportingCoverage:{
    confirmed:true,basis:'source-export-cutoff',
    coverageFrom:'2022-01-01',coverageThrough:'2026-10-15'
  }}
};
service.invalidate();
const forecastScope={period:'2026-10',mine:'Северный',equipmentClass:'mounted'};
const integrated=service.buildSnapshot(forecastScope,{now:'2026-11-10T08:00:00Z'});
const forecastRow=integrated.series.monthly.find(row=>row.period==='2026-10');
assert.equal(integrated.reportingCoverage.kpis.vbr.reportMonthStatus,'incomplete');
assert.equal(integrated.reportingCoverage.kpis.vbr.coverageThrough,'2026-10-15');
assert.equal(integrated.kpiView.cards.vbr.forecast.forecastType,'reporting-month-nowcast');
assert.equal(integrated.kpiView.cards.vbr.forecast.dataState,'available');
assert.equal(integrated.kpiView.cards.vbr.forecast.horizon,'2026-10');
assert.equal(integrated.kpiView.cards.vbr.forecast.asOf,'2026-10-15');
assert.strictEqual(forecastRow.forecasts.vbr,integrated.kpiView.cards.vbr.forecast);
assert.strictEqual(integrated.kpiView.seriesById.vbr.points.at(-1).forecast,
  integrated.kpiView.cards.vbr.forecast);
assert.equal(integrated.results.vbr.value,forecastRow.vbr.value);
assert.equal(integrated.kpiView.cards.vbr.current.value,integrated.results.vbr.value);
assert(integrated.kpiView.cards.vbr.forecast.sourceRevisions.some(
  source=>source.datasetId==='itsm_data'));
assert(Object.isFrozen(forecastRow.forecasts));
assert(Object.isFrozen(integrated.kpiView.cards.vbr.forecast));
// PR-7: same certified last reporting month supports absolute labor and
// completed INC volume. Both retain the Calculator / operational observed fact.
const laborForecast=integrated.kpiView.cards.total_labor.forecast;
assert.equal(laborForecast.forecastType,'reporting-month-volume-nowcast');
assert.equal(laborForecast.dataState,'available');
assert.equal(laborForecast.horizon,'2026-10');
assert.equal(laborForecast.asOf,'2026-10-15');
assert.equal(laborForecast.observedValue,integrated.results.total_labor.value);
assert.strictEqual(forecastRow.forecasts.total_labor,laborForecast);
assert.strictEqual(integrated.kpiView.seriesById.total_labor.points.at(-1).forecast,
  laborForecast);
assert.equal(integrated.results.total_labor.value,10);
assert(Object.isFrozen(laborForecast));
const laborPassport=globalThis.ReclassifierKpiPassportView.renderContent(
  'total_labor',{snapshot:integrated});
assert(laborPassport.includes('Факт за доступные дни'));
assert(laborPassport.includes('Прогноз оставшихся дней'));
assert(laborPassport.includes('Прогноз завершения месяца'));
assert(laborPassport.includes('Подтверждённые данные по'));
assert(laborPassport.includes('Метод'));
assert(laborPassport.includes('Накопленный факт + прогноз до конца месяца'));

const scopeLaborShort=service.buildKpiChartMultiData('total_labor',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
const scopeLaborYear=service.buildKpiChartMultiData('total_labor',forecastScope,
  ['Северный'],['mounted'],{range:'1y',window:1});
assert.equal(scopeLaborShort.series[0].forecast.dataState,'available');
assert.deepEqual(scopeLaborShort.series[0].forecast,
  scopeLaborYear.series[0].forecast,
  'Labor forecast model must be independent of the visible chart viewport.');
const operationalShort=service.buildOperationalChartData('inc','month',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
const operationalYear=service.buildOperationalChartData('inc','month',forecastScope,
  ['Северный'],['mounted'],{range:'1y',window:1});
const incForecast=operationalShort.series[0].forecast;
assert.equal(incForecast.forecastType,'reporting-month-volume-nowcast');
assert.equal(incForecast.dataState,'available');
assert.equal(incForecast.observedValue,
  operationalShort.series[0].points.at(-1).value);
assert.equal(incForecast.horizon,'2026-10');
assert.deepEqual(incForecast,operationalYear.series[0].forecast);
assert(Object.isFrozen(operationalShort.series[0].forecast));
const opLabor=service.buildOperationalChartData('labor','month',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
assert.equal(opLabor.series[0].forecast.dataState,'available');
assert.equal(opLabor.series[0].forecast.observedValue,10);
assert.equal(opLabor.series[0].forecast.value,laborForecast.value);
const forecastObserved=service.buildOperationalChartData('labor','month',
  forecastScope,['Северный'],['mounted'],
  {range:'1y',window:1,forecastMethodId:'observed-run-rate'});
assert.equal(forecastObserved.series[0].forecast.dataState,'available');
assert.equal(forecastObserved.series[0].forecast.methodId,'observed-run-rate');
assert.equal(forecastObserved.series[0].forecast.observedValue,10);
assert.equal(forecastObserved.series[0].forecast.elapsedDays,15);
assert.equal(forecastObserved.series[0].forecast.value,10+(10/15)*16);
assert.notEqual(forecastObserved.series[0].forecast.methodId,
  opLabor.series[0].forecast.methodId);
assert.equal(forecastObserved.series[0].points.at(-1).value,
  opLabor.series[0].points.at(-1).value);
const forecastPrevious=service.buildOperationalChartData('labor','month',
  forecastScope,['Северный'],['mounted'],
  {range:'1y',window:1,forecastMethodId:'last-value'});
assert.equal(forecastPrevious.series[0].forecast.methodId,'last-value');

const daily=service.buildOperationalChartData('inc','day',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
assert.equal(daily.series[0].forecast,undefined,
  'Daily/weekly views are unchanged until PR-8 visualization.');

const forecastPassport=globalThis.ReclassifierKpiPassportView.renderContent('vbr',
  {snapshot:integrated});
assert(forecastPassport.includes('Подтверждённые данные по'));
assert(forecastPassport.includes('2026-10-15'));
assert(forecastPassport.includes('Запрошенный метод'));
assert(forecastPassport.includes('Применённый метод'));
assert(forecastPassport.includes('MAE базовой'));
assert(forecastPassport.includes('Ревизия'));
assert(forecastPassport.includes('Прогнозные компоненты не рассчитаны.')===false);
const byMonth=service.buildSnapshot({...forecastScope,period:'2026-09'},
  {now:'2026-11-12T08:00:00Z'});
assert.strictEqual(byMonth.series.monthly,integrated.series.monthly,
  'Monthly facts and forecast must be cached independently of selected month.');
assert.strictEqual(byMonth.kpiView.cards.vbr.forecast,
  integrated.kpiView.cards.vbr.forecast);
const scopeShort=service.buildKpiChartMultiData('vbr',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
const scopeYear=service.buildKpiChartMultiData('vbr',forecastScope,
  ['Северный'],['mounted'],{range:'1y',window:1});
assert.equal(scopeShort.series[0].points.length,2);
assert.equal(scopeYear.series[0].points.length,13);
assert.equal(scopeShort.series[0].forecast.dataState,'available');
assert.deepEqual(scopeShort.series[0].forecast,scopeYear.series[0].forecast,
  'Forecast inputs must not be cropped to the visible history.');
assert.equal(scopeShort.series[0].forecast.value,
  integrated.kpiView.cards.vbr.forecast.value);
assert.equal(scopeShort.series[0].forecast.methodId,
  integrated.kpiView.cards.vbr.forecast.methodId);
assert.equal(scopeShort.reportingCoverage.reportMonth,'2026-10');
const onePoint=service.buildKpiChartMultiData('vbr',forecastScope,
  ['Северный'],['mounted'],{range:'1m',window:1});
assert.deepEqual(onePoint.series[0].forecast,scopeShort.series[0].forecast);
const beforeCutoff=integrated.results.vbr.value;
// Source coverage metadata participates in source revision invalidation.
datasets.itsm_data={...datasets.itsm_data,meta:{
  ...datasets.itsm_data.meta,
  reportingCoverage:{...datasets.itsm_data.meta.reportingCoverage,
    coverageThrough:'2026-10-31'}
}};
assert.equal(service.getCachedSnapshot(forecastScope),null);
const completed=service.buildSnapshot(forecastScope,{now:'2026-11-12T09:00:00Z'});
assert.equal(completed.reportingCoverage.kpis.vbr.reportMonthStatus,'complete');
assert.equal(completed.kpiView.cards.vbr.forecast.value,null,
  'No nowcast should be published for a certified complete month.');
assert.equal(completed.results.vbr.value,beforeCutoff,
  'Certified cutoff change must not rewrite factual Calculator result.');
datasets.itsm_data={...datasets.itsm_data,meta:{
  ...datasets.itsm_data.meta,reportingCoverage:null
}};
service.invalidate();
chartCalculatorCalls.length=0;
// Unified VBR formula must invoke one real Calculator on the union of mine and
// class filters, with the fixed Drivers stock multiplied by month exposure.
const unifiedState={period:'2026-10',mine:'all',equipmentClass:'all'};
const interval={fromMonth:'2026-08',toMonth:'2026-10'};
const threeMonths=service.buildKpiSelectionSummary('vbr',unifiedState,
  ['Северный'],['mounted'],interval);
assert.equal(threeMonths.result.dataState,'available');
assert.equal(threeMonths.result.components.failureCount,1);
assert.equal(threeMonths.result.components.equipmentCount,300);
assert.equal(threeMonths.result.diagnostics.baselineEquipmentCount,100);
assert.equal(threeMonths.result.diagnostics.reportingMonths,3);
assert.ok(Math.abs(threeMonths.result.value-(1-1/300)*100)<1e-9);
const withAll=service.buildKpiSelectionSummary('vbr',unifiedState,
  ['all','Северный'],['mounted'],interval);
assert.equal(withAll.result.value,threeMonths.result.value,
 'Choosing Все and Северный must not double-count the northern mine.');
const withZf=service.buildKpiSelectionSummary('vbr',unifiedState,
  ['zf','Северный'],['mounted','stationary'],interval);
assert.equal(withZf.result.components.equipmentCount,300);
assert.equal(withZf.result.components.failureCount,1);
const customViewport=service.buildKpiChartMultiData('vbr',unifiedState,
  ['Северный'],['mounted'],{range:'custom',fromMonth:'2026-08',
    toMonth:'2026-09',window:1});
assert.equal(customViewport.selectedMonth,'2026-09');
assert.equal(customViewport.availableTo,'2026-10');
assert.deepEqual(customViewport.series[0].points.map(p=>p.period),['2026-08','2026-09']);
assert.throws(()=>service.buildKpiChartMultiData('vbr',unifiedState,
  ['Северный'],['mounted'],{range:'custom',fromMonth:'2026-11',
    toMonth:'2026-11',window:1}),/Invalid selected month interval/);

// Reset count and month-point cache after independent union/slider acceptance.
service.invalidate();
chartCalculatorCalls.length=0;
const viewportState={period:'2026-10',mine:'all',equipmentClass:'all'};
const chartOneYear=service.buildKpiChartMultiData('ktg',viewportState,
  ['all'],['mounted'],{range:'1y',window:1});
assert.equal(chartOneYear.series.length,1);
assert.equal(chartOneYear.series[0].points.length,13);
assert.equal(chartOneYear.series[0].points[0].period,'2025-10');
assert.equal(chartOneYear.availableFrom,'2022-01');
assert.equal(chartCalculatorCalls.length,13,
 'PR 6 first viewport must calculate 13 months, not every month of history.');
const cachedPeriod=chartOneYear.series[0].points.at(-1);
const chartAgain=service.buildKpiChartMultiData('ktg',viewportState,
  ['all'],['mounted'],{range:'1y',window:1});
assert.strictEqual(chartAgain.series[0].points.at(-1),cachedPeriod);
assert.equal(chartCalculatorCalls.length,13,'Warm viewport must reuse all calculated months.');
const withTrend=service.buildKpiChartMultiData('ktg',viewportState,
  ['all'],['mounted'],{range:'1y',window:12});
assert.equal(withTrend.series[0].points.length,24,
  'Rolling 12-month trend requires 11 extra calendar months.');
assert.equal(chartCalculatorCalls.length,24,
 'Moving-trend expansion must calculate only 11 additional months.');
const trendView=globalThis.ReclassifierKpiChartViewModel.project({
  kpiId:'ktg',series:withTrend.series[0],selectedMonth:'2026-10',range:'1y',window:12
});
assert.equal(trendView.points.length,13);
assert(Number.isFinite(trendView.points[0].rollingValue),
 'Historical padding must make first visible trend point available.');
const fullHistory=service.buildKpiChartMultiData('ktg',viewportState,
  ['all'],['mounted'],{range:'all',window:12});
assert.equal(fullHistory.series[0].points.length,58);
assert.equal(chartCalculatorCalls.length,58,
 'Full history should calculate only the 34 previously uncached months.');
const fullTrend=globalThis.ReclassifierKpiChartViewModel.project({
  kpiId:'ktg',series:fullHistory.series[0],selectedMonth:'2026-10',range:'1y',window:12
});
assert.deepEqual(trendView.points,fullTrend.points,
 'Retrospective moving trend must be identical for short viewport and full history.');
assert.strictEqual(fullHistory.series[0].points.at(-1),cachedPeriod);
assert.equal(fullHistory.series[0].points.at(-1).value,cachedPeriod.value);
const twoMines=service.buildKpiChartMultiData('ktg',viewportState,
  ['all','Северный'],['mounted','stationary'],{range:'1m',window:1});
assert.equal(twoMines.series.length,4);
assert.equal(twoMines.series[0].points.length,2);
assert.equal(chartCalculatorCalls.length,64,
 'Existing all/mounted months are cached; only three new 2-month series need Calculator.');
const beforeInvalidation=chartCalculatorCalls.length;
service.invalidate();
service.buildKpiChartMultiData('ktg',viewportState,['all'],['mounted'],{range:'1m',window:1});
assert.equal(chartCalculatorCalls.length,beforeInvalidation+2);
datasets.mobile_brigade_data=originalMb;
datasets.itsm_data=originalItsm;
service.invalidate();

datasets.drivers = null;
service.invalidate();

const partial = service.buildSnapshot({
  period: 'latest',
  mine: 'Северный',
  equipmentClass: 'mounted'
}, {
  now: '2026-10-08T06:31:00.000Z'
});
assert.equal(partial.status, 'partial');
assert.equal(partial.results.vbr.dataState, 'no-data');
assert.equal(partial.results.vbr.reason, 'source-missing');
assert.equal(partial.executionTrace.byKpi.vbr.evidence,'source-guarded');
assert.equal(partial.executionTrace.byKpi.vbr.value,null);
assert.equal(partial.executionTrace.byKpi.vbr.sources.find(s=>s.datasetId==='drivers').available,false);
assert.equal(partial.executionTrace.byKpi.total_labor.evidence,'observed');
assert.equal(partial.executionTrace.byKpi.total_labor.value,10);

assert.equal(partial.kpiView.cards.vbr.current.value, null);
assert.equal(partial.kpiView.cards.vbr.current.reason, 'source-missing');
assert.deepEqual(partial.results.vbr.diagnostics.missingSources, ['drivers']);
assert.equal(partial.results.total_labor.value, 10);
assert.equal(partial.results.problem_coverage_relative.value, 40);

assert(Object.isFrozen(snapshot));
assert(Object.isFrozen(snapshot.results));
assert(Object.isFrozen(snapshot.sources));

// PR5 integration: a validated full Report Snapshot is saved through the
// Repository and restored after memory invalidation without re-running formulas.
const originalCacheStore=globalThis.ReclassifierKpiSnapshotStore;
let savedSnapshotRow=null, putCount=0, getCount=0;
globalThis.ReclassifierKpiSnapshotStore={
  identity:()=> 'pr5-test-sqlite',
  write:(input,payload)=>{
    putCount+=1;
    savedSnapshotRow={input:{...input},payload:JSON.parse(JSON.stringify(payload))};
    return {stored:true};
  },
  read:input=>{
    getCount+=1;
    if(savedSnapshotRow?.input?.sourceSignature!==input.sourceSignature ||
      savedSnapshotRow?.input?.methodologyVersion!==input.methodologyVersion ||
      savedSnapshotRow?.input?.cacheKey!==input.cacheKey) return null;
    return JSON.parse(JSON.stringify(savedSnapshotRow.payload));
  }
};
service.invalidate();
const persistedCache=service.buildSnapshot(reportFilters);
assert.equal(persistedCache.diagnostics.stage,'full');
assert.equal(putCount,1,'complete synchronous Report should persist once');
service.invalidate();
const readsBefore=getCount;
const fromDisk=service.getCachedSnapshot(reportFilters);
assert(fromDisk,'Report Service must load versioned SQLite cache');
assert.equal(fromDisk.calculatedAt,persistedCache.calculatedAt);
assert.equal(fromDisk.results.vbr.value,persistedCache.results.vbr.value);
assert.equal(getCount,readsBefore+1);
assert(Object.isFrozen(fromDisk) && Object.isFrozen(fromDisk.results),
  'reopened JSON cache must remain an immutable Report Snapshot');
const cachedAgain=service.getCachedSnapshot(reportFilters);
assert.strictEqual(cachedAgain,fromDisk,'subsequent reads hit in-memory cache');
assert.equal(getCount,readsBefore+1);
const originalMbBeforeCacheTest=datasets.mobile_brigade_data;
datasets.mobile_brigade_data={...originalMbBeforeCacheTest,
  meta:{...originalMbBeforeCacheTest.meta,activeRevision:909,
    contentHash:'changed-after-cache'}};
assert.equal(service.getCachedSnapshot(reportFilters),null,
  'changed authoritative source revision must reject cached Snapshot');
datasets.mobile_brigade_data=originalMbBeforeCacheTest;
globalThis.ReclassifierKpiSnapshotStore=originalCacheStore;
service.invalidate();

console.log('Reliability Report Service: real KPI Snapshot + source revisions + partial-source guards OK');
