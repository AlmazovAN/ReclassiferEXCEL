'use strict';
// Opt-in OOM live-stage markers must precede blocking work and contain no source data.
const assert = require('node:assert/strict');
const XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XLSX = XLSX;
require('../src/js/modules/mobile_brigade/rules.js');
require('../src/js/workers/mobile_brigade_processor.js');

const workbook = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ['Участок','Номер задачи','Тип задачи','Фактическая дата',
   'Фактические трудозатраты','Заявка','Описание'],
  ['Участок','T-1','АВР','2026-10-20','1ч','INC-SECRET','Уникальный комментарий'],
  ['Участок','T-2','АВР','2026-10-20','1ч','INC-2','Другая запись']
]);
XLSX.utils.book_append_sheet(workbook,sheet,'Секретное имя листа');
const raw = XLSX.write(workbook,{type:'array',bookType:'xlsx'});
const bytes = raw instanceof ArrayBuffer ? raw :
  raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength);

(async () => {
  const events=[];
  const result=await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files:[{fileName:'CONFIDENTIAL_2026-10-20.xlsx',bytes}],
    itsmData:[],streamToSqlite:true,deferExport:true,batchSize:500,
    memoryDiagnostics:true
  }, progress => {
    if(progress?.mbMemoryDiag) events.push(progress.mbMemoryDiag);
  }, async (batch, sequence) => {
    assert.equal(sequence,1);
    assert.equal(batch.length,2);
  });
  const phases=events.map(item => item.stage+':'+item.event);
  for(const phase of [
    'xlsx-read:start','xlsx-read:end','sheet-parse:start','sheet-parse:end',
    'classify:start','classify:end','batch-send:start','batch-ack:end'
  ]) assert(phases.includes(phase),'Missing '+phase);
  assert(phases.indexOf('xlsx-read:start') < phases.indexOf('xlsx-read:end'));
  assert(phases.indexOf('sheet-parse:start') < phases.indexOf('sheet-parse:end'));
  assert(phases.indexOf('batch-send:start') < phases.indexOf('batch-ack:end'));
  assert.equal(events.at(-1).confirmedBatches,1);
  assert.equal(result.stats.rows,2);
  assert.equal(result.stats.batches,1);
  assert.equal(result.bytes,null);
  const encoded=JSON.stringify(events);
  for(const secret of ['CONFIDENTIAL','INC-SECRET','Уникальный комментарий',
    'Секретное имя листа']) assert(!encoded.includes(secret),'Leaked '+secret);

  // Existing processing must not emit extra events unless explicitly enabled.
  const eventsWithoutOptIn=[];
  await globalThis.ReclassifierMobileBrigadeWorkerProcessor.process({
    files:[{fileName:'a.xlsx',bytes}],itsmData:[],
    streamToSqlite:true,deferExport:true,batchSize:500
  }, progress => {
    if(progress?.mbMemoryDiag) eventsWithoutOptIn.push(progress.mbMemoryDiag);
  },async () => {});
  assert.equal(eventsWithoutOptIn.length,0);
  console.log('PASS: opt-in metadata-only live phases and SQLite ACK order');
})().catch(error => {console.error(error);process.exitCode=1;});
