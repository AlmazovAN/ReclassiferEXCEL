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
require('../src/js/kpi/execution_trace.js');
const common=globalThis.ReclassifierKpiCalculatorCommon;
const Trace=globalThis.ReclassifierKpiExecutionTrace;
const collector=Trace.createCollector({
 prepared:{families:{sla:{id:'sla',rowCount:4,grain:['period','mine'],meta:{unknownSlaRows:3}}}},
 sources:[{id:'itsm_data',available:true,rowCount:20,activeRevision:5,contentHash:'hash-1'}],
 query:{period:'2026-10-01',filters:{mine:'Северный'}}
});
const table={id:'sla',rows:[
 {period:'2026-09-01',mine:'Северный'},
 {period:'2026-10-01',mine:'Северный'},
 {period:'2026-10-01',mine:'Таймырский'},
 {period:'2026-10-01',mine:'Северный'}
]};
const query={period:'2026-10-01',filters:{mine:'Северный'}};
const base=common.selectRows(table,query,{mine:'mine'});
const traced=common.selectRows(table,{...query,audit:collector.forKpi('sla')},{mine:'mine'});
assert.deepEqual(traced.rows,base.rows);
assert.equal(traced.rows.length,2);
const results={sla:{dataState:'available',value:90,components:{slaSuccessCount:9,slaTotalCount:10},formulaVersion:'1.0.0'}};
const t=collector.finalize(results).byKpi.sla;
assert.equal(t.events[0].inputRows,4);
assert.equal(t.events[0].outputRows,2);
assert.deepEqual(t.events[0].stages.map(x=>[x.inputRows,x.outputRows,x.excludedRows]),[[4,3,1],[3,2,1]]);
assert.equal(t.sources[0].sourceRows,20);
assert.equal(t.sources[0].revision,5);
assert.equal(t.preparation[0].preparedRows,4);
assert.equal(t.preparation[0].diagnostics.unknownSlaRows,3);
assert.equal(t.evidence,'observed');
assert.equal(t.value,90);
assert(Object.isFrozen(t.events));
assert(Object.isFrozen(t.events[0].stages));
const invalid=common.selectRows(table,{
 period:'2026-10-01',filters:{mine:'Северный',otherFilter:'x'},
 audit:collector.forKpi('sla')
},{mine:'mine'});
assert.equal(invalid.error,'unsupported-filter');
const second=collector.finalize(results).byKpi.sla.events[1];
assert.equal(second.error,'unsupported-filter');
assert.deepEqual(second.unsupportedFilters,['otherFilter']);
const empty=Trace.createCollector({prepared:{families:{}},sources:[],query:{}}).finalize({});
assert.equal(empty.byKpi.vbr.evidence,'not-calculated');
assert.equal(empty.byKpi.ktg.evidence,'not-calculated');
console.log('Step 8 runtime trace: real row counts, per-filter exclusions, source lineage, errors OK');
