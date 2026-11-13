const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(path.join(__dirname,'../dist/ReclassifierEXCEL.html'),'utf8');
const worker = JSON.parse(html.match(/id="folders-worker">([\s\S]*?)<\/script>/)[1]);
const ui = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const {plans} = require('./fixtures/rca-pr13.cjs');

test('Worker recognizes nine templates and 74 steps; editable copies preserve zero days and facts', () => {
  const engine = vm.createContext({TextEncoder,TextDecoder});
  engine.self = engine;
  vm.runInContext(worker,engine);
  const xlsx = engine.XLSX;
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book,xlsx.utils.json_to_sheet(plans.map(plan=>plan.registry)),'Реестр');
  xlsx.utils.book_append_sheet(book,xlsx.utils.json_to_sheet(plans.flatMap(plan=>plan.steps)),'Типовые планы');
  assert.equal(engine.ReclassifierDatasetClassifier.classifyWorkbook(book).id,'rca_plan_templates');
  const templates = engine.readRcaPlanTemplates(book);
  assert.equal(templates.length,9);
  assert.equal(templates.flatMap(item=>item.steps).length,74);
  const app = vm.createContext({crypto,structuredClone});
  vm.runInContext(ui.slice(0,ui.lastIndexOf("\n(() => {")),app);
  const library = {schemaVersion:1,sourceHash:'a'.repeat(64),fileName:'synthetic.xlsx',templates};
  app.validateRcaPlanLibrary(library);
  const first = app.createRcaPlan(templates[0],library,'2026-03-01');
  const second = app.createRcaPlan(templates[0],library,'2026-03-01');
  assert.notEqual(first.steps[0].id,second.steps[0].id);
  assert.equal(first.steps[0].plannedEnd,'2026-03-01');
  assert.equal(first.steps[1].plannedStart,'2026-03-01');
  first.steps[0].durationDays = 3;
  first.steps[0].actualStart = '2026-02-28';
  const updated = app.rebuildRcaPlan(first);
  assert.equal(updated.steps[1].plannedStart,'2026-03-04');
  assert.equal(updated.steps[0].actualStart,'2026-02-28');
  assert.equal(second.steps[0].durationDays,0);
  assert.equal(templates[0].steps[0].durationDays,0);
  assert.throws(()=>app.scheduleRcaPlan(first.start,[{...first.steps[0],predecessorIds:[first.steps[0].id]}]),/зависимости/);
  const record = app.createRcaProblem({title:'План'});
  record.actions.push({id:'action',nodeIds:[],plan:updated});
  app.validateRcaProblem(JSON.parse(JSON.stringify(record)));
  assert.ok(app.buildRcaReport(record).sections.some(section=>section.title.startsWith('План · ')));
});

test('analytics Worker reads a synthetic XLSX and skips identical source versions', async t => {
  const messages = [];
  const app = vm.createContext({Blob,ArrayBuffer,Uint8Array,Date,Map,Set,TextEncoder,TextDecoder,
    TextDecoderStream,ReadableStream,DecompressionStream,CompressionStream,crypto,performance,setTimeout,
    postMessage:message=>messages.push(message)});
  app.self = app;
  vm.runInContext(worker,app);
  const xlsx = app.XLSX;
  const book = xlsx.utils.book_new();
  const row = ['INC1','PRB1','р. Макет','2026-03-01',0,'INC'];
  const rows = [row,row,['INC2','PRB1','Макет','',2,'INC'],
    ['INC3','PRB1','Макет','2026-03-02',2,'INC'],['INC3','PRB1','Макет','2026-03-02',4,'INC'],
    ['RITM4','PRB1','Макет','2026-03-02','1,5','INC'],['INC5','PRB1','Макет','2026-03-02',4,'RITM']];
  const sampleRows = process.env.RCA_PROFILE_LARGE === '1' ? 100000 : 10000;
  for (let i=0;i<sampleRows;i++) rows.push(['INC'+(100+i),'PRB2','Макет','2026-03-01',0,'INC']);
  xlsx.utils.book_append_sheet(book,xlsx.utils.aoa_to_sheet([
    ['Номер','Связан ли с ИТ-проблемой?','Территории MES','Дата выполнения обращения','рез6','INC после рекласс'],...rows
  ]),'ITSM');
  const file = new Blob([xlsx.write(book,{type:'array',bookType:'xlsx',compression:true})]);
  const request = {action:'rca-analytics',imported:true,files:[{path:'Test/ITSM/export_ITSM.xlsx',file}]};
  let heap = process.memoryUsage().heapUsed;
  const timer = setInterval(()=>{heap=Math.max(heap,process.memoryUsage().heapUsed);},5);
  try { await app.onmessage({data:request}); } finally { clearInterval(timer); }
  const result = messages.at(-1);
  assert.equal(result.type,'analytics-ready',JSON.stringify(result));
  assert.equal(result.index.diagnostics.counted,sampleRows+2);
  assert.equal(result.index.days.length,3);
  assert.ok(!JSON.stringify(result.index).includes('RITM4'));
  assert.equal(result.index.diagnostics.conflicts,1);
  assert.equal(result.index.diagnostics.duplicates,1);
  assert.equal(result.index.diagnostics.missingDate,1);
  assert.equal(result.index.days.find(row=>row.prb==='PRB1'&&row.day==='2026-03-02').mbLaborHours,1.5);
  t.diagnostic('Synthetic XLSX: '+rows.length+' rows, '+result.index.elapsedMs+
    ' ms, sampled process JS heap '+Math.round(heap/1048576)+' MiB including test fixture');
  await app.onmessage({data:{...request,previousHash:result.index.sourceHash,previousRules:result.index.rules}});
  assert.equal(messages.at(-1).type,'analytics-unchanged');
});

test('calendar month bounds clamp and query includes both reported endpoints', () => {
  const app = vm.createContext({});
  vm.runInContext(ui.slice(0,ui.lastIndexOf("\n(() => {")),app);
  for (const [months,from] of [[1,'2026-03-01'],[3,'2026-01-01'],[6,'2025-10-01']]) {
    assert.equal(app.rcaMetricWindow(months,'2026-03-31').from,from);
  }
  const index = {days:['2026-02-28','2026-03-01','2026-03-31','2026-04-01'].map(day=>({
    prb:'PRB1',site:'макет',day,incCount:1,mbLaborHours:2
  }))};
  const result = app.getRcaMetric(index,'PRB1','макет','2026-03-01','2026-03-31');
  assert.equal(result.incCount,2);
  assert.equal(result.mbLaborHours,4);
});
