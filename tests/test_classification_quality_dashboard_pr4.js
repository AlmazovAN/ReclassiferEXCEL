'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
const source=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const modal=fs.readFileSync('src/js/app/reliability_kpi_chart.js','utf8');
const api=vm.runInNewContext(source+'\n'+modal+
  '\n;({renderReliabilityQualityComparisonChart,renderReliabilityKpiCard,'+
  'buildReliabilityDashboardView,renderKpiFormulaTiles,reliabilityKpiChartUiState})',
  {escapeHtml:esc,Intl,console});

const months=[
  {period:'2026-07',label:'июл',classification_quality:{dataState:'available',value:90},
    classification_quality_cgps:{dataState:'available',value:94.74}},
  {period:'2026-08',label:'авг',classification_quality:{dataState:'available',value:80},
    classification_quality_cgps:{dataState:'no-data',value:null,reason:'mb-coverage-unknown'}},
  {period:'2026-09',label:'сен',classification_quality:{dataState:'available',value:75},
    classification_quality_cgps:{dataState:'available',value:86}}
];
const template={schemaVersion:'2.0.0',mode:'report-snapshot',report:{title:'Reliability'},
  filters:{disclaimer:'filters'},
  kpiGroups:{dataQuality:[
    {id:'classification_quality',title:'Качество классификации — общее',unit:'%'},
    {id:'classification_quality_cgps',title:'Качество классификации ЦГПС',unit:'%'}
  ],technicalReliability:[],organizationalReadiness:[]},
  labor:{summaryKpis:[]},problemManagement:{summaryKpis:[]}};
const result=(value,dataState='available',reason=null)=>({value,dataState,reason,unit:'%'});
const snap={
  status:'ready',calculatedAt:'2026-10-01',sources:[],
  query:{period:{label:'Сентябрь'},mine:{label:'Все'},equipmentClass:{label:'Все'}},
  filters:{periods:[],mines:[],equipmentClasses:[]},
  results:{
    classification_quality:result(75),
    classification_quality_cgps:result(86)
  },
  kpiView:{cards:{},seriesById:{}},
  series:{monthly:months},breakdowns:{labor:[],problemManagement:[]}
};
const view=api.buildReliabilityDashboardView(template,snap);
assert.equal(view.kpiGroups.dataQuality.length,2);
assert.equal(view.kpiGroups.dataQuality[0].value,75);
assert.equal(view.kpiGroups.dataQuality[1].value,86);
assert.equal(view.monthlyDynamics.classification.length,3);
assert.equal(view.monthlyDynamics.classification[1].cgps,null);
assert.equal(view.monthlyDynamics.classification[1].cgpsReason,'mb-coverage-unknown');
const graph=api.renderReliabilityQualityComparisonChart(view.monthlyDynamics.classification);
assert.match(graph,/data-chart-id="classification-quality-comparison"/);
assert.match(graph,/Общее качество/);
assert.match(graph,/Качество ЦГПС/);
assert.match(graph,/неполного покрытия МБ/);
assert.equal((graph.match(/class="reliability-chart-point series-1"/g)||[]).length,3);
assert.equal((graph.match(/class="reliability-chart-point series-2"/g)||[]).length,2);
const cgpsPath=graph.match(/class="reliability-chart-line series-2" d="([^"]*)"/);
assert(cgpsPath,'CGPS SVG series missing');
assert.equal((cgpsPath[1].match(/M /g)||[]).length,2,
  'Unknown CGPS month must break line; never connect July directly to September.');
assert.equal((cgpsPath[1].match(/ L /g)||[]).length,0);
assert.doesNotMatch(graph,/авг: 0%|0% · авг/);
assert.match(api.renderReliabilityQualityComparisonChart([]),/недостаточно месячных данных/);

const validCard=api.renderReliabilityKpiCard({
  id:'classification_quality_cgps',title:'Качество классификации ЦГПС',
  dataState:'available',dataStatus:'calculated',value:94.74,unit:'%',
  change:null,forecast:null,status:'neutral'
});
assert.match(validCard,/data-kpi-chart-open="classification_quality_cgps"/);
assert.match(validCard,/data-kpi-passport-open="classification_quality_cgps"/);
assert.match(validCard,/94,7/);
const unavailableCard=api.renderReliabilityKpiCard({
  id:'classification_quality_cgps',title:'Качество классификации ЦГПС',
  dataState:'no-data',dataStatus:'calculated',value:null,unit:'%',reason:'mb-coverage-unknown',
  forecast:null,status:'neutral'
});
assert.match(unavailableCard,/Dataset Мобильных бригад отсутствует или недоступен/);
assert.match(unavailableCard,/reliability-kpi-value">—</);
assert.doesNotMatch(unavailableCard,/reliability-kpi-value">0</);

function detailed(kpiId,state='available',reason=null) {
  const parts={
    classificationIncUnchangedCount:90,
    classificationIncCorrectedCount:2,
    classificationIncUnclassifiedCount:1,
    classificationRitmInsteadOfIncCount:2,
    classificationTotalCount:95,
    excludedNoMbCount:3,unknownMbCoverageCount:state==='available'?0:4,
    excludedOtherInitiatorRitmCount:5
  };
  const value=state==='available'?90/95*100:null;
  const series={id:'all:mounted',mineLabel:'Все',equipmentLabel:'Навесное',
    points:[{period:'2026-09',value,dataState:state,reason,components:parts}]};
  const model={points:[{period:'2026-09',value,rollingValue:null}]};
  api.reliabilityKpiChartUiState.detailSeriesId=null;
  api.reliabilityKpiChartUiState.detailMonth=null;
  return api.renderKpiFormulaTiles([{series,view:model}],kpiId,'%');
}
const cgps=detailed('classification_quality_cgps');
assert.match(cgps,/INC без изм/);
assert.match(cgps,/INC с исправлением/);
assert.match(cgps,/INC не классифицирован/);
assert.match(cgps,/RITM вместо INC \(ЦГПС\)/);
assert.match(cgps,/Исключено: нет в МБ/);
assert.match(cgps,/Нет данных МБ: Dataset недоступен/);
assert.match(cgps,/RITM иных инициаторов/);
assert.match(cgps,/94,7/);
// One shared compact fraction for both quality KPIs: numerator A,
// four actual categories immediately beneath the fraction bar, no
// opaque "A + B + C + D" denominator tile or duplicated overview.
assert.equal((cgps.match(/reliability-classification-category/g)||[]).length,4);
assert.match(cgps,/reliability-classification-denominator/);
assert.doesNotMatch(cgps,/A \+ B \+ C \+ D/);
assert(cgps.indexOf('reliability-formula-numerator')<
  cgps.indexOf('reliability-classification-denominator'));
assert(cgps.indexOf('reliability-classification-denominator')<
  cgps.indexOf('reliability-classification-remarks'));
assert.match(cgps,/Примечания к вычислениям/);
assert.match(cgps,/aria-label="Знаменатель: сумма категорий A, B, C и D = 95"/);
assert.equal((cgps.match(/reliability-formula-result/g)||[]).length,1);
const general=detailed('classification_quality');
assert.match(general,/RITM вместо INC/);
assert.doesNotMatch(general,/Исключено: нет в МБ/);
assert.equal((general.match(/reliability-classification-category/g)||[]).length,4);
assert.match(general,/reliability-classification-denominator/);
assert.doesNotMatch(general,/A \+ B \+ C \+ D/);
assert.match(general,/Примечания к вычислениям/);
assert(!general.includes('reliability-classification-exclusions'));
const style=fs.readFileSync('src/ui/style/zz_reliability_formula_tiles.css','utf8');
assert.match(style,/\.reliability-classification-denominator\s*\{/);
assert.match(style,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(style,/@media\(max-width:540px\)/);
const unknown=detailed('classification_quality_cgps','no-data','mb-coverage-unknown');
assert.match(unknown,/Процент ЦГПС нельзя рассчитать/);
assert.match(unknown,/Нет данных МБ: Dataset недоступен/);
assert.match(unknown,/reliability-formula-result/);
assert.doesNotMatch(unknown,/reliability-formula-result[^<]*>0%/);

console.log('PR4 quality dashboard: two cards, snapshot comparison, genuine gaps, category breakdown, MB coverage, action wiring OK');
