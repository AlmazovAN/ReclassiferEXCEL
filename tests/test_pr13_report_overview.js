'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const pdf=fs.readFileSync('src/js/app/reliability_pdf.js','utf8');
const css=fs.readFileSync('src/ui/style/05_reliability_dashboard.css','utf8');
const context=vm.createContext({
  escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
  formatReliabilityNumber:v=>String(v),
  formatReliabilityMetric:(v,unit)=>String(v)+' '+String(unit||'')
});
context.globalThis=context;
vm.runInContext(source+'\nthis.pr13={laborTone:reliabilityLaborTone,labor:renderReliabilityLaborChart,problems:renderReliabilityProblemChart,line:renderReliabilityLineChart};',
  context,{filename:'reliability_dashboard.js'});
const api=context.pr13;
const types=[
 ['ТО по графику','maintenance','#277da1'],
 ['АВР','avr','#d65b55'],
 ['ЗНО — монтажи, переносы','install','#b28a41'],
 ['Корректирующее воздействие','corrective','#7b61a3'],
 ['Прочее','other','#88939d'],
 ['ТО вне графика','unscheduled','#2c9b80']
];
for(const [name,tone,color] of types){
 assert.equal(api.laborTone(name),tone,'Wrong stable category for '+name);
 assert(css.includes('.reliability-labor-segment.labor-tone-'+tone));
 assert(pdf.includes(color),'PDF must use the exact WEB category color for '+name);
}
assert.equal(api.laborTone('Без типа'),'other');
const items=types.map(([title],index)=>({title,hours:index+1,share:100/6}));
const labor={structure:items,totalHours:21,displayHoursUnit:'чел.-ч',
 reactiveShare:{value:42.8}};
const html=api.labor(labor);
assert.equal((html.match(/reliability-labor-segment labor-tone-/g)||[]).length,6);
assert.equal((html.match(/reliability-chart-legend-swatch labor-tone-/g)||[]).length,6);
assert(html.includes('Реактивная деятельность:'));
const shuffled=api.labor({...labor,structure:items.slice().reverse()});
for(const [name,tone] of types) {
 const fragment='title="'+name+': ';
 assert(html.includes(fragment),'Missing labor tooltip for '+name);
 assert(shuffled.includes('labor-tone-'+tone));
}
const sla=[
 {period:'2026-01',label:'Янв 2026',value:97.1},
 {period:'2026-02',label:'Фев 2026',value:null},
 {period:'2026-03',label:'Мар 2026',value:99.3},
 {period:'2026-04',label:'Апр 2026',value:100}
];
const chart=api.line({id:'sla-dynamics',title:'Динамика SLA',description:'',
 points:sla,minValue:0,maxValue:100,showValues:true});
assert(chart.includes('reliability-sla-compact'));
assert.equal((chart.match(/class="reliability-chart-value-label"/g)||[]).length,3,
 'Every observed SLA month must have a value label');
assert(chart.includes('97,1%')&&chart.includes('99,3%')&&chart.includes('100%'),
 'SLA labels use the app\'s ru-RU numeric formatting');
assert(chart.includes('Фев 2026'),'Missing month label cannot be silently omitted');
assert(!chart.includes('NaN'));
assert(chart.includes('min-width:'),'Many months must scroll rather than overlap');
const paths=chart.match(/class="reliability-chart-line series-1" d="([^"]*)"/)?.[1]||'';
assert.equal((paths.match(/M /g)||[]).length,2,'Unknown month must break the SLA line');
const many=Array.from({length:24},(_,index)=>({
 period:'2025-'+String(index+1).padStart(2,'0'),
 label:String(index+1),value:80+index/5
}));
const extended=api.line({id:'sla-dynamics',title:'SLA',description:'',
 points:many,minValue:0,maxValue:100,showValues:true});
assert.equal((extended.match(/class="reliability-chart-value-label"/g)||[]).length,24);
assert(extended.includes('min-width:1586px'),'24 months must get at least 66px per point');
const prb=api.problems({charts:Array.from({length:8},(_,index)=>({id:'c'+index,items:[]})),
 portfolio:[{title:'Связано с PRB',count:10},{title:'Без PRB',count:5}]});
assert.equal((prb.match(/data-chart-id=/g)||[]).length,1,
 'The eight separately calculated PRB charts are not eight overview charts');
assert(prb.includes('data-chart-id="prb-linkage"'));
assert(!prb.includes('reliability-management-charts'));
assert(!source.includes('const vbrChart = renderReliabilityLineChart('));
assert(!source.includes('const qualityChart = renderReliabilityQualityComparisonChart('));
assert(!pdf.includes('    qualityComparisonChart();'));
assert(pdf.includes('    qualityDetails();'));
assert(pdf.includes('    problemBreakdown();'));
console.log('PR13: SLA monthly labels and missing-month gap, six stable WEB/PDF labor tones, one PRB overview, PDF detail preserved OK');
