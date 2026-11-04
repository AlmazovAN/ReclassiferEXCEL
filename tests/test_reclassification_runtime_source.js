const assert=require('node:assert/strict');
require('../src/js/modules/reclassification/runtime_source.js');
const prepare=globalThis.ReclassifierReclassificationRuntimeSource.prepare;
const columns=Array.from({length:62},(_,i)=>'Поле '+i);
columns[3]='Номер';
const records=[['2026-09-01',null,null,'INC-001'],['2026-09-02',null,null,'INC-002']];
const rows=records.map(record=>Array.from({length:62},(_,i)=>i===3?record[3]:null));
const instance={
  records,meta:{fullDatasetScope:'complete'},
  fullDataset:{package:'itsm-full-dataset',aggregation:'per-source-row',
    columns,rows,coverage:'complete',recordKeys:['inc-001','INC-002']}
};
const valid=prepare(instance);
assert.strictEqual(valid.rows,rows,'No loss or duplication of the full source rows');
assert.strictEqual(valid.columns,columns);
assert.equal(valid.rows.length,2);
assert.equal(valid.package,'itsm-full-dataset');
assert.throws(()=>prepare(null),/нет обращений/);
assert.throws(()=>prepare({...instance,records:[]}),/нет обращений/);
assert.throws(()=>prepare({...instance,fullDataset:null}),/отсутствует полный Full Dataset/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,coverage:'partial'}}),/отсутствует полный Full Dataset/);
assert.throws(()=>prepare({...instance,meta:{fullDatasetScope:'incoming-batch'}}),/отсутствует полный Full Dataset/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,rows:rows.slice(0,1)}}),/отсутствует полный Full Dataset/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,package:'other'}}),/несовместимый формат/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,recordKeys:['INC-001']}}),/привязка/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,recordKeys:['INC-001','INC-OTHER']}}),/не совпадают/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,rows:[rows[1],rows[0]]}}),/не совпадают/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,rows:[rows[0],rows[0]]}}),/не совпадают/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,columns:columns.slice(0,10)}}),/необходимых исходных/);
assert.throws(()=>prepare({...instance,fullDataset:{...instance.fullDataset,rows:[rows[0],rows[1].slice(1)]}}),/Повреждена строка/);
// PR6: the reference stores completion dates of requests, not an engineer's
// actual verification timestamps. Do not infer a review date.
const freshness=globalThis.ReclassifierReclassificationRuntimeSource.reclassFreshness;
assert.deepEqual(freshness(null),{rows:0,latestCompleted:null});
const historical={records:[
  {number:'INC-1',dateCompleted:'2026-10-01'},
  {number:'INC-2',dateCompleted:'03.10.2026'},
  {number:'INC-3',dateCompleted:'2026-10-02'}
],meta:{}};
assert.deepEqual(freshness(historical),{rows:3,latestCompleted:'2026-10-03'});
assert.strictEqual(freshness(historical),freshness(historical),'Identical instance should reuse cached summary');
const withMetadata={records:historical.records,meta:{latestRequestDate:'2026-10-06T12:34:56Z'}};
assert.equal(freshness(withMetadata).latestCompleted,'2026-10-06');
withMetadata.meta.latestRequestDate='invalid';
assert.equal(freshness(withMetadata).latestCompleted,'2026-10-03');
const invalid={records:[{dateCompleted:'31.02.2026'},{dateCompleted:'missing'}],meta:{latestRequestDate:'2026-02-31'}};
assert.equal(freshness(invalid).latestCompleted,null,'Invalid calendar dates must not be displayed');
assert.equal(freshness({records:[['created','2026-09-13']]}).latestCompleted,'2026-09-13');
console.log('Re-Class PR4/6: complete Full Dataset contract, reference freshness with date validation OK');
