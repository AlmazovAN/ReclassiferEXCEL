'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const coreSource=fs.readFileSync('src/js/app/database_core.js','utf8');
const exporterSource=fs.readFileSync('src/js/app/dataset_excel_export.js','utf8');
const uiSource=fs.readFileSync('src/js/modules/mobile_brigade/ui.js','utf8');
const stagingFacadeSource=fs.readFileSync('src/js/app/mobile_brigade_staging.js','utf8');

function segment(src,begin,end) {
  const a=src.indexOf(begin),b=src.indexOf(end,a);
  assert(a>=0 && b>a,'Missing source segment '+begin);
  return src.slice(a,b);
}

const records=Array.from({length:10003},(_,i)=>({
  factDate:i===10002?null:i===10001?'2026-01-02':'2025-01-02',
  key:'k'+i,row:['TASK-'+i,i],
  // Deliberate legacy analytical-only record: it is present in SQLite
  // but its matching source row was never stored.
  hasFull:i!==5,
  analytic:{taskNumber:'TASK-'+i,factDate:i===10002?null:
    i===10001?'2026-01-02':'2025-01-02',laborHours:i}
}));
let queryCount=0,visited=0,decodedRows=0,finalized=0;
const db={
  prepare(sql) {
    queryCount++;
    const joined=sql.includes('LEFT JOIN dataset_full_records');
    assert.match(sql,/WHERE .*dataset_id = 'mobile_brigade_data'/);
    let index=-1;
    return {
      step() {index++; if(index<records.length) visited++; return index<records.length;},
      get(n) {
        const record=records[index];
        if(n===0) return record.factDate;
        if(n===1) {
          assert(joined);
          return record.hasFull ? record.key : null;
        }
        if(n===2) {
          assert(joined && record.hasFull);
          decodedRows++;
          return JSON.stringify(record.row);
        }
        if(n===3) return JSON.stringify(record.analytic);
        throw Error('Unexpected SQL column: '+n);
      },
      finalize() { finalized++; }
    };
  }
};
const globals={
  ReclassifierDatasetExcelExport:{
    recordDate:(_id,r)=>r.factDate&&/^\d{4}-\d{2}-\d{2}/.test(r.factDate)
      ? r.factDate.slice(0,10):null,
    dateKey:value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value)?value:null
  }
};
const core=segment(coreSource,'  function mobileBrigadeExportDay(value) {',
  '  function getMobileBrigadeRowsForRequests(');
const createCore=new Function('globalThis','db',
  'const requireOpenDatabase=()=>db;'+
  'const getDatasetRegistry=()=>({active_revision:3,record_count:recordsCount});'+
  'const getDatasetState=()=>({fullDataset:{columns:["Номер задачи","Значение"]}});'+
  'const getDatabaseInfo=()=>({databaseUuid:"db-123"});'+
  'const recordsCount=10003;'+core+
  '\nreturn {getMobileBrigadeExportInfo,getMobileBrigadeExportPage};');
const repo=createCore(globals,db);
const info=repo.getMobileBrigadeExportInfo();
assert.deepEqual(
  {rows:info.rows,dated:info.dated,undated:info.undated,from:info.from,to:info.to},
  {rows:10003,dated:10002,undated:1,from:'2025-01-02',to:'2026-01-02'}
);
assert.equal(info.missingFullRows,1);
assert.equal(info.fullRows,10002);
assert.equal(decodedRows,0,'Metadata scan must not decode any Full Dataset rows');
const first=repo.getMobileBrigadeExportPage('2025-01-02','2026-01-02',0,10000);
assert.equal(first.rows.length,10000);
assert.equal(first.hasMore,true);
assert.equal(first.nextOffset,10000);
assert.deepEqual(first.rows[0],['TASK-0',0]);
assert.deepEqual(first.rows.at(-1),['TASK-10000',10000]);
const second=repo.getMobileBrigadeExportPage('2025-01-02','2026-01-02',10000,10000);
assert.equal(second.rows.length,1);
assert.equal(second.hasMore,false);
assert.deepEqual(second.rows.map(r=>r[0]),['TASK-10001']);
assert.equal(decodedRows,10001,
  'Full mode must decode only the 10,001 selected rows');
assert.equal(finalized,queryCount,'Every SQLite cursor must be finalized');
assert.throws(()=>repo.getMobileBrigadeExportPage('2025-01-02','2026-01-02',0,10001),
  /10 000/);
assert.throws(()=>repo.getMobileBrigadeExportPage('bad','2026-01-02'),/период/);

// Load export closure with a fake SQLite, Worker and DOM downloads. No
// datasetStore.get is allowed in any SQLITE-only UI or export operation.
let workerCalls=0,downloaded=[];
const fakeDb={
  hasOpenDatabase:()=>true,
  getDatabaseInfo:()=>({databaseUuid:'db-123'}),
  getDatasetRegistry:()=>({active_revision:3,record_count:10003}),
  getMobileBrigadeExportInfo:()=>info,
  getMobileBrigadeExportPage:(from,to,offset,limit,mode)=>
    repo.getMobileBrigadeExportPage(from,to,offset,limit,mode)
};
const fakeGlobal={
  ReclassifierDatabaseRepository:fakeDb,
  ReclassifierRuntimeDataRepository:{mode:()=> 'sqlite'},
  ReclassifierModuleSourceStatus:{formatDate:s=>s}
};
// Subject module UI must access ITSM source counts via the application facade.
// Never call the low-level database repository (or read its whole Dataset).
new Function('globalThis',stagingFacadeSource)(fakeGlobal);
assert.equal(fakeGlobal.ReclassifierMobileBrigadeStaging.itsmRowCount(),10003);

const fakeState={processingModuleId:null};
const fakeStore={get(){throw Error('Full Runtime materialization forbidden');}};
const fakeDocument={
  body:{appendChild(){ }},
  createElement:()=>({click(){downloaded.push(this.download)},remove(){},style:{}})
};
const exporter=new Function('globalThis','datasetStore','state','workerRequest',
  'escapeHtml','document','Blob','URL','setTimeout','log',
  exporterSource+'\nreturn globalThis.ReclassifierDatasetExcelExport;')(
  fakeGlobal,fakeStore,fakeState,async(type,payload,_transfer,_progress,onBatch)=>{
    workerCalls++;
    assert.equal(type,'EXPORT_DATASET_XLSX_STREAM');
    assert.equal(typeof onBatch,'function');
    let offset=0, rows=0, groups=0;
    const seen=new Set();
    const taskColumn=payload.columns.indexOf('Номер задачи');
    assert(taskColumn>=0);
    for (;;) {
      const page=await onBatch({offset,sequence:groups});
      assert(page.rows.length<=10000);
      for(const row of page.rows) {
        const id=String(row[taskColumn]);
        assert(!seen.has(id),'Export must not duplicate task rows');
        seen.add(id);
      }
      rows+=page.rows.length;
      offset+=page.rows.length;
      groups++;
      if(!page.hasMore) break;
      assert(groups<5,'Infinite export cursor');
    }
    assert(groups>=2,'More than 10k source rows must be streamed');
    return {bytes:new ArrayBuffer(4),rows};
  },value=>String(value),fakeDocument,Blob,
  {createObjectURL:()=> 'blob:mock',revokeObjectURL(){}},
  ()=>0,()=>{}
);
globals.ReclassifierDatasetExcelExport.sqliteMobileAnalyticalSchema =
  exporter.sqliteMobileAnalyticalSchema;
assert.match(exporter.sqliteMobileSummary(),/2025-01-02/);
assert.match(exporter.sqliteMobileSummary(),/без исходной строки/);
assert.match(exporter.sqliteMobileMarkup(),/sqliteMbExportFrom/);
assert.match(exporter.sqliteMobileMarkup(),/sqliteMbExportMode/);
assert(exporter.sqliteMobileMarkup().includes('<option value="full" selected'),
  '38-column processed Full Dataset must be selected by default, despite coverage gaps');
assert.match(exporter.sqliteMobileMarkup(),/Скачать XLSX/);
assert(!exporter.sqliteMobileMarkup().includes('часть 1'),
  'User-facing pagination must be removed');
(async()=>{
  let result=await exporter.sqliteMobileExportPeriod(
    '2025-01-02','2026-01-02',undefined,'analytical');
  assert.equal(result.rows,10002);
  assert.match(result.outputName,/analytical_.*\.xlsx$/);
  assert(!result.outputName.includes('part'));
  result=await exporter.sqliteMobileExportPeriod(
    '2025-01-02','2026-01-02',undefined,'full');
  assert.equal(result.rows,10001);
  assert.match(result.outputName,/full_.*\.xlsx$/);
  assert(!result.outputName.includes('part'));
  assert.equal(workerCalls,2,'One Worker export call per user click');
  assert.equal(downloaded.length,2,'Exactly one XLSX per mode and period');
  assert.match(uiSource,/sqliteMobileSummary/);
  assert.match(uiSource,/sqliteMobileMarkup/);
  assert.match(uiSource,/bindSqliteMobile/);
  assert(uiSource.includes('ReclassifierMobileBrigadeStaging?.itsmRowCount?.()'),
    'Subject module must read ITSM count through application facade');
  assert(!uiSource.includes('ReclassifierDatabaseRepository'),
    'Subject module must not bypass the application facade');
  assert(!uiSource.includes('ReclassifierRuntimeDataRepository.get(\'mobile_brigade_data\')'),
    'Mobile page must not fetch full active SQLite instance');
  console.log('SQLite MB date coverage + single XLSX streaming across internal SQLite pages: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
