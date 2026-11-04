'use strict';
// End-to-end synthetic Re-Class acceptance: full Active Runtime -> standard
// ITSM -> machine classification -> 92-column zipped, portable XLSX.
const assert=require('node:assert/strict');
const fs=require('node:fs');
globalThis.XLSX=require('../vendor/xlsx.full.min.js');
require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/mb_presence.js');
require('../src/js/modules/itsm/dataset_schema.js');
require('../src/js/kpi/source_facts.js');
require('../src/js/modules/itsm/kpi_source.js');
require('../src/js/modules/itsm/rules.js');
require('../src/js/workers/itsm_processor.js');
require('../src/js/modules/reclassification/rules.js');
require('../src/js/modules/reclassification/rules_v4.js');
require('../src/js/modules/reclassification/engine_registry.js');
require('../src/js/modules/reclassification/runtime_source.js');
require('../src/js/workers/reclassification_xlsx_format.js');
require('../src/js/modules/reclassification/classifier_index_v4.js');
require('../src/js/modules/reclassification/facts_v4.js');
require('../src/js/modules/reclassification/event_v4.js');
require('../src/js/modules/reclassification/objects_v4.js');
require('../src/js/modules/reclassification/elements_v4.js');
require('../src/js/modules/reclassification/failure_v4.js');
require('../src/js/modules/reclassification/cause_v4.js');
require('../src/js/modules/reclassification/path_review_v4.js');
require('../src/js/modules/reclassification/review_policy_v4.js');
require('../src/js/modules/reclassification/diagnostics_v4.js');
require('../src/js/workers/reclassification_processor.js');

const ROWS=5000;
const HEADERS=[
  'Дата создания Вызова','Дата выполнения обращения','Дата закрытия',
  'Номер','Территории MES','Наименование оборудования','Элемент',
  'Неисправность','Причина инцидента',
  'Категорированная информация обращения.Краткое описание',
  'Категорированная информация обращения.Описание','Примечания к разрешению',
  'Открыл','Измерение цели обслуживания.Прошло (рабочее время)',
  'Код закрытия','Доп.информация по причине','Состояние',
  ...Array.from({length:45},()=> '')
];
const PATH=['СВР','Кабель камеры','Обрыв кабеля','Механическое воздействие'];
const classifier=[PATH,['СВР','Другое','Другое','Другое'],
  ['СВР','Другое','Не является отказом','Отказ не подтверждён']];
const sourceRows=Array.from({length:ROWS},(_,index)=>{
  const number=(index%17===0?'RITM':'INC')+'-SCALE-'+String(index).padStart(6,'0');
  const row=Array(HEADERS.length).fill(null);
  row[0]='2026-09-01';row[1]=index%13===0?null:'2026-09-02';
  row[2]='2026-09-03';row[3]=number;row[4]='р. Северный';
  [row[5],row[6],row[7],row[8]]=PATH;
  row[9]='Неисправность камеры';row[10]='Нет изображения';
  row[11]=index%19===0?'Отказ не подтверждён.':'Обнаружен обрыв кабеля камеры. Кабель восстановлен.';
  row[12]='Тестовый инициатор';row[13]=2;row[14]='Выполнено полностью';
  row[16]='Закрыто';
  return row;
});
const references={reclassification:[],drivers:[],customers:[],type_request:[],
  initiators:[],exceptions:[],problem_grade:[],mobile_brigade_data:[],
  mobile_brigade_meta:{latestSourceDate:'2026-10-01'}};
const source={package:'itsm-full-dataset',aggregation:'per-source-row',
  columns:HEADERS,rows:sourceRows};
async function main(){
  const start=process.hrtime.bigint();
  let maxHeap=0,maxRss=0,lastProgress=0;
  const measure=()=>{
    const m=process.memoryUsage();
    maxHeap=Math.max(maxHeap,m.heapUsed);
    maxRss=Math.max(maxRss,m.rss);
  };
  measure();
  const result=await globalThis.ReclassifierReclassificationWorkerProcessor.process({
    runtimeSource:source,fileName:'ITSM_5000.xlsx',classifierRecords:classifier,
    references,asOfDate:'2026-10-18'
  },progress=>{
    assert(progress.percent>=lastProgress,'Progress must be monotonic');
    lastProgress=progress.percent;
    measure();
  });
  measure();
  assert.equal(lastProgress,100);
  assert.equal(result.stats.rows,ROWS);
  assert.equal(result.stats.columns,globalThis.ReclassifierReclassificationWorkerProcessor.reportColumns.length);
  assert.equal(Object.values(result.stats.statusCounts).reduce((a,b)=>a+b),ROWS);
  assert.equal(result.stats.expertComparison.noMarking,ROWS);
  assert.equal(result.stats.batchSizes.diagnostic,400);
  assert(result.stats.batchSizes.reference<=400);
  assert(result.bytes instanceof ArrayBuffer&&result.bytes.byteLength>0);
  assert(result.reclassBytes instanceof ArrayBuffer&&result.reclassBytes.byteLength>0);
  assert(result.bytes.byteLength<30*1024*1024,
    'Synthetic 5000-row zipped report unexpectedly exceeds 30 MiB');
  const wb=XLSX.read(new Uint8Array(result.bytes),
    {type:'array',cellDates:true,cellStyles:true});
  measure();
  const sheet=wb.Sheets.ITSM;
  assert(sheet,'ITSM sheet is missing');
  assert.equal(sheet['!ref'],'A1:CN5002','No omissions or trailing phantom rows');
  assert.equal(sheet.C3.v,'RITM-SCALE-000000');
  assert.equal(sheet.C2502.v,'RITM-SCALE-002499');
  assert.equal(sheet.C5002.v,'INC-SCALE-004999');
  assert.equal(sheet['!autofilter'].ref,'A2:CN5002');
  assert.equal(sheet['!merges'].length,3);
  assert.equal(sheet['!cols']?.length,globalThis.ReclassifierReclassificationWorkerProcessor.reportColumns.length);
  assert(wb.SheetNames.includes('KPI_Source'));
  assert(wb.SheetNames.includes('Reclassification'));
  assert(wb.SheetNames.includes('Сводка алгоритма'));
  const separate=XLSX.read(new Uint8Array(result.reclassBytes),{type:'array'});
  const reclass=separate.Sheets.Reclassification;
  assert(reclass);
  assert.equal(result.referenceRecords.length,
    XLSX.utils.decode_range(reclass['!ref']).e.r);
  assert(maxRss<1800*1024*1024,
    'Synthetic Re-Class peak RSS exceeds 1.8 GiB');
  const seconds=Number(process.hrtime.bigint()-start)/1e9;
  const metrics={
    records:ROWS,reportBytes:result.bytes.byteLength,
    reclassBytes:result.reclassBytes.byteLength,
    readyRows:result.stats.readyRows,
    elapsedSeconds:Number(seconds.toFixed(2)),
    peakRssMiB:Number((maxRss/1048576).toFixed(1)),
    peakHeapMiB:Number((maxHeap/1048576).toFixed(1)),
    sheets:wb.SheetNames.length
  };
  console.log('PR-7 synthetic Active Runtime Re-Class acceptance:',JSON.stringify(metrics));
  if(process.env.GITHUB_STEP_SUMMARY){
    const items=[
      '', '## PR-7 — нагрузочная проверка Re-Class (синтетика)', '',
      '| Показатель | Значение |','|---|---:|',
      '| Обращений | '+metrics.records+' |',
      '| Готовых решений | '+metrics.readyRows+' |',
      '| XLSX, МиБ | '+(metrics.reportBytes/1048576).toFixed(2)+' |',
      '| Время, с | '+metrics.elapsedSeconds+' |',
      '| Пик RSS процесса, МиБ | '+metrics.peakRssMiB+' |','',
      'Показатели относятся только к синтетическому набору, не к реальной SQLite.'
    ];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,items.join('\n')+'\n');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
