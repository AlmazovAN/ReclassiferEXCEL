'use strict';
// V4-01: freeze the legacy 3.3.0 algorithm and its 10-column Reclassification export.
// The independent ITSM comparison-report projection is versioned separately (A:CN).
// These examples are entirely synthetic. They are not V4 product requirements:
// in particular, ordinary RITM output is intentionally pinned AS LEGACY BEHAVIOR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const fixture = require('./fixtures/reclassification_legacy_v4_01_golden.json');
const root = path.join(__dirname, '..');
const gitObjectHash = execFileSync('git', [
  'hash-object', '--path=' + fixture.frozenSource.path, fixture.frozenSource.path
], {cwd:root, encoding:'utf8'}).trim();
assert.equal(gitObjectHash,fixture.frozenSource.gitBlobSha1,
  'Legacy rules.js has changed: keep the v3.3.0 implementation frozen; introduce a NEW V4 module');

globalThis.XLSX = require('../vendor/xlsx.full.min.js');
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
const rules = globalThis[fixture.frozenSource.publicGlobal];
const worker = globalThis.ReclassifierReclassificationWorkerProcessor;
assert.equal(rules.version,fixture.frozenSource.version);
for (const entry of fixture.frozenSource.api)
  assert(Object.hasOwn(rules,entry),'Missing legacy public API: '+entry);
assert(Object.isFrozen(rules),'Legacy public API must remain immutable');

const ctx = rules.buildContext(fixture.classifier,{
  ordinaryRitmTemplates:fixture.ordinaryRitmTemplates
});
assert.equal(ctx.paths.size,fixture.classifier.length);
const inputs = fixture.ruleCases.map(sample=>({...fixture.base,...sample.overrides}));
for(let i=0;i<inputs.length;i++){
  const sample = fixture.ruleCases[i];
  const copy = JSON.stringify(inputs[i]);
  const decision = rules.evaluateRow({row:inputs[i],context:ctx});
  assert.equal(JSON.stringify(inputs[i]),copy,'Legacy mutated input for '+sample.id);
  assert.equal(decision.status,sample.expect.status,'Legacy status: '+sample.id);
  assert.equal(decision.readyForApply,sample.expect.readyForApply,'Legacy applicability: '+sample.id);
  if(sample.expect.candidate)
    assert.deepEqual(decision.candidate,sample.expect.candidate,'Legacy candidate: '+sample.id);
  if(sample.expect.stage!==undefined)
    assert.equal(decision.stage,sample.expect.stage,'Legacy stage: '+sample.id);
  if(sample.expect.firstChanged)
    assert.equal(decision.firstChanged,sample.expect.firstChanged,'Legacy first changed level: '+sample.id);
}

// The following XLSX is built from the pinned synthetic row fixture, not read
// from any confidential ITSM export. Assert semantic content, not ZIP bytes
// or timestamps, because xlsx serializers may produce different metadata.
const inputHeaders=[
 'Дата создания Вызова','Дата выполнения обращения','Дата закрытия','Номер',
 'Территории MES','Наименование оборудования','Элемент','Неисправность',
 'Причина инцидента','Категорированная информация обращения.Краткое описание',
 'Категорированная информация обращения.Описание','Примечания к разрешению',
 'Открыл','Измерение цели обслуживания.Прошло (рабочее время)',
 'Код закрытия','Доп.информация по причине','Состояние'
];
const inputRows=inputs.map(row=>[
 row.createdAt,row.completedAt,row.closedAt,row.number,'Тестовый участок',
 row.sourceEquipment,row.sourceElement,row.sourceFault,row.sourceReason,
 row.shortDescription,row.description,row.closureNote,'Тестовый исполнитель',
 2,row.closingCode,'','Закрыто'
]);
const XLSX = globalThis.XLSX;
const inputBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(inputBook,
 XLSX.utils.aoa_to_sheet([inputHeaders,...inputRows]),'Обращение');
const inputBytes=XLSX.write(inputBook,{bookType:'xlsx',type:'array'});
const beforeHash=crypto.createHash('sha256').update(Buffer.from(inputBytes)).digest('hex');
const references={
  reclassification:[],drivers:[],customers:[],type_request:[],initiators:[],
  exceptions:[],problem_grade:[],mobile_brigade_data:[],
  mobile_brigade_meta:{latestSourceDate:'2026-09-01'}
};
const originalReferences=JSON.stringify(references);
const read=bytes=>XLSX.read(new Uint8Array(bytes),{type:'array',cellDates:true});
const cells=sheet=>XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null});
(async()=>{
  const result=await worker.process({
    bytes:inputBytes,fileName:'legacy_fixture.xlsx',
    references,classifierRecords:fixture.classifier,asOfDate:'2026-10-01'
  });
  assert.equal(result.rulesVersion,'3.3.0');
  assert.equal(result.stats.rows,fixture.ruleCases.length);
  assert.equal(result.stats.columns,worker.reportColumns.length);
  assert.equal(result.outputName,'legacy_fixture'+fixture.xlsxContract.fileNameSuffixes[0]);
  assert.equal(result.reclassOutputName,'legacy_fixture'+fixture.xlsxContract.fileNameSuffixes[1]);
  const workbook=read(result.bytes);
  assert.deepEqual(workbook.SheetNames,fixture.xlsxContract.workbookSheetsWithoutOriginalExtra);
  const report=cells(workbook.Sheets.ITSM);
  // The frozen legacy input and 10-column export are unchanged. Its *comparison*
  // report was intentionally expanded from A:AH to A:CN (38 base + 54 V4).
  assert.deepEqual(report[1].slice(0,21),fixture.xlsxContract.reportHeaders.slice(0,21),
    'Legacy A:U report fields changed');
  assert.deepEqual(report[1].slice(21,23),['Примечания к разрешению','Доп.информация по причине'],
    'V/W must be separate and in this order');
  assert.deepEqual(report[1].slice(23,35),fixture.xlsxContract.reportHeaders.slice(22,34),
    'Legacy fields following the split V/W have changed');
  assert.deepEqual(report[1].slice(35,38),['МесОткр','ГодЗакр','МесЗакр'],
    'Base A:AL tail differs from the approved contract');
  assert.deepEqual(report[1].slice(38),globalThis.ReclassifierTechnicalDiagnosticsV4.columns,
    'V4 AM:CN must match the canonical diagnostic projection');
  assert.equal(report[1].length,92,'A:AL and AM:CN must total 92 columns');
  assert(!report[1].includes('этап отсечения'),'Obsolete visible diagnostics must be replaced');
  assert.equal(report.length,fixture.ruleCases.length+2);
  assert.equal(workbook.Sheets.ITSM['!autofilter'].ref,
    'A2:CN'+(fixture.ruleCases.length+2));
  const exported=read(result.reclassBytes);
  assert.deepEqual(exported.SheetNames,['Reclassification']);
  const reclass=cells(exported.Sheets.Reclassification);
  assert.deepEqual(reclass[0],fixture.xlsxContract.reclassificationHeaders,
    'Legacy 10-column Re-Class schema changed');
  const records=result.referenceRecords;
  assert.deepEqual(records.map(r=>r.number).sort(),
    fixture.xlsxContract.admittedFromCases.slice().sort(),
    'Legacy accepted list changed');
  assert.deepEqual(reclass.slice(1).map(r=>r[3]).sort(),
    fixture.xlsxContract.admittedFromCases.slice().sort(),
    'Reference XLSX does not match apply-ready records');
  for(const record of records){
    assert.deepEqual(
      [record.equipment,record.element,record.fault,record.incidentReason],
      fixture.classifier[0], 'Legacy full path changed');
  }
  for(const number of fixture.xlsxContract.excludedFromCases)
    assert(!records.some(record=>record.number===number),
      'Ineligible case exported into Re-Class: '+number);

  // Processing prepares an import proposal, it must NOT commit data to the
  // active Re-Class reference or to SQLite. The UI has a distinct apply step.
  assert.equal(JSON.stringify(references),originalReferences,
    'Generation mutated live reference data');
  assert.equal(crypto.createHash('sha256').update(Buffer.from(inputBytes)).digest('hex'),
    beforeHash,'Generation mutated input XLSX');
  const uiSource=fs.readFileSync(path.join(root,'src/js/modules/reclassification/ui.js'),'utf8');
  assert.match(uiSource,/function applyPendingReclassUpsert\(/,
    'Explicit apply action must remain separate from generation');
  assert(!/\.exec(?:ute)?\s*\(\s*['"\`]?\s*(?:INSERT|UPDATE|DELETE)\b/i.test(
    fs.readFileSync(path.join(root,'src/js/workers/reclassification_processor.js'),'utf8')),
    'The generation worker must not issue direct SQLite writes');
  console.log('V4-01: pinned legacy 3.3.0 source, 7 golden decisions, '+
    'A:CN comparison export and frozen 10-column ReClass; no implicit apply OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
