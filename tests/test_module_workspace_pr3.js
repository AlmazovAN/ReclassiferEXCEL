const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = file => fs.readFileSync(file, 'utf8');
const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const data = new Map();
const context = vm.createContext({
  escapeHtml, Date, console,
  moduleConfig: {itsm:{title:'ITSM',description:'Work',references:['reclassification']}},
  state:{references:{},baselineReady:true,processingModuleId:null,sourceFile:null,workerReady:true},
  referenceConfig: {
    reclassification:{title:'Реклассификация'}, drivers:{title:'Драйверы'},
    itsm_data:{title:'ITSM'},mobile_brigade_data:{title:'МБ'},customers:{title:'<script>'}
  },
  referenceStatusClass: instance => instance ? 'loaded' : '',
  referenceStatusText: instance => instance ? 'Готов' : 'Не загружен',
  datasetStore:{get:id=>data.get(id)||null},
  el:{pageContent:{innerHTML:''}},
  setHeader(){},bindModuleEvents(){},build:{version:'0.35.1'},
  formatBytes:()=> '2 MB'
});
context.ReclassifierDatasetExcelExport={
  dateKey(value) {
    if (value instanceof Date) return value.getFullYear()+'-'+
      String(value.getMonth()+1).padStart(2,'0')+'-'+String(value.getDate()).padStart(2,'0');
    const m=/^(\d{4}-\d\d-\d\d)/.exec(String(value||''));
    return m ? m[1] : null;
  },
  recordDate: (id,row)=>row?.factDate ? String(row.factDate).slice(0,10):null,
  exportSource(id,instance) {
    if (instance?.fullDataset?.coverage==='complete' &&
        instance.fullDataset.rows.length===instance.records.length) {
      return {mode:'full',columns:instance.fullDataset.columns,
        width:instance.fullDataset.columns.length};
    }
    const keys= id==='itsm_data' ? null : Object.keys(instance.records[0]||{});
    const columns=id==='itsm_data' ? ['Дата','Заявка'] : keys;
    return {mode:'analytical',columns,keys,width:columns.length};
  }
};
vm.runInContext(read('src/js/app/module_workspace.js'),context,{filename:'module_workspace.js'});
const status=context.ReclassifierModuleSourceStatus;
assert(status);

const mb={records:[
  {factDate:null,request:'FUTURE-PLAN'},
  {factDate:'2026-10-14',request:'DONE'},
  {factDate:'2026-10-18',request:'FUTURE-PLAN-2'},
  {factDate:'2026-10-15',request:'DONE-2'},
  {factDate:'2026-03-02',request:'OLDER'}
],meta:{latestSourceDate:'2026-10-31', sourceFileName:'tasks_2026-10-31.xlsx'}};
assert.equal(status.latestActualFactDate(mb,'2026-10-15'),'2026-10-15');
assert.equal(status.referenceDate('mobile_brigade_data',mb,'2026-10-15').date,'2026-10-15',
  'file name and future planned tasks must never inflate actual MB recency');
assert.equal(status.referenceDate('mobile_brigade_data',mb,'2026-10-14').date,'2026-10-14');
assert.equal(status.latestActualFactDate({records:[{factDate:null},{factDate:'2026-11-01'}]},'2026-10-15'),null);
assert.equal(status.referenceDate('itsm_data',{meta:{latestSourceDate:'2026-10-15'}}).date,'2026-10-15');
assert.equal(status.referenceDate('reclassification',{meta:{latestRequestDate:'2026-10-13'}}).date,'2026-10-13');

const modified={records:[{}],meta:{sourceFileModifiedAt:'2026-09-28T12:30:00Z'}};
const modifiedDate=status.referenceDate('drivers',modified);
assert.equal(modifiedDate.label,'Дата файла');
assert.equal(modifiedDate.date,'2026-09-28');
assert.match(modifiedDate.note,/не подтверждает дату выгрузки/);
const explicit={records:[{}],meta:{sourceExportDate:'2026-10-11',sourceFileModifiedAt:'2026-10-14T05:00:00Z'}};
assert.equal(status.referenceDate('customers',explicit).date,'2026-10-11');
assert.equal(status.referenceDate('customers',explicit).label,'Дата выгрузки');
const loaded={records:[{}],meta:{loadedAt:'2026-10-14T17:20:00Z'}};
assert.equal(status.referenceDate('drivers',loaded).label,'Загружено');
assert.match(status.referenceDate('drivers',loaded).note,/не дата выгрузки/);
assert.equal(status.referenceDate('drivers',{records:[{}],meta:{}}).date,null);

data.set('reclassification',{records:[{}],meta:{latestRequestDate:'2026-10-13'}});
data.set('customers',explicit);
const referenceHtml=status.referenceRows(['reclassification','customers','drivers']);
assert.match(referenceHtml,/Последнее выполненное обращение: <strong class="module-reference-date">13\.10\.2026<\/strong>/);
assert.match(referenceHtml,/Дата выгрузки: <strong class="module-reference-date">11\.10\.2026<\/strong>/);
assert.match(referenceHtml,/Не загружен/);
assert.doesNotMatch(referenceHtml,/<script>/,'all reference source labels must be escaped');

const columns=['Первое поле','Второе поле','Текст <script>alert(1)</script>'];
const all=Array.from({length:7},(_,i)=>['2026-10-'+String(i+1).padStart(2,'0'), 'INC'+i,'<img src=x onerror=alert(1)>']);
const itsm={records:all.map(row=>row.slice(0,2)),
  meta:{sourceType:'sqlite',latestSourceDate:'2026-10-15',fieldCount:2},
  fullDataset:{columns,rows:all,coverage:'complete'}};
const html=status.datasetSummary('itsm_data',itsm);
assert.match(html,/Данные в текущей базе/);
assert.match(html,/7 из 7 · полный/);
assert.match(html,/Просмотр ITSM Dataset · 5 строк/);
assert.match(html,/Текст &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert(!html.includes('<img '),'sample values must be escaped');
assert.equal((html.match(/<tbody><tr>/g)||[]).length,1,'one table');
assert.equal((html.match(/<tr>/g)||[]).length,6,'one header plus precisely five rows');
assert.match(html,/module-dataset-preview-scroll/);
// Fallback for stripped smoke/legacy harnesses without the XLSX exporter.
const originalExporter=context.ReclassifierDatasetExcelExport;
delete context.ReclassifierDatasetExcelExport;
context.ReclassifierItsmDatasetSchema={labels:['Дата','Номер']};
const leanPreview=status.previewMarkup('itsm_data', {
  records:[['2026-10-15','INC-BASELINE']],meta:{fields:['createdAt','number']}
});
assert.match(leanPreview,/INC-BASELINE/);
assert.match(leanPreview,/Номер/);
context.ReclassifierDatasetExcelExport=originalExporter;

const partial={records:[{factDate:'2026-10-14',request:'REQ-1',description:'a'},
                           {factDate:'2026-10-15',request:'REQ-2',description:'b'}],
  meta:{sourceType:'sqlite'},fullDataset:{columns:['One'],rows:[['x']],coverage:'partial'}};
const mbHtml=status.datasetSummary('mobile_brigade_data',partial);
assert.match(mbHtml,/1 из 2 · частичный/);
assert.match(mbHtml,/доступные аналитические поля/);
assert.match(mbHtml,/Просмотр Mobile Brigade Dataset/);

const itsmUi=read('src/js/modules/itsm/ui.js');
const mbUi=read('src/js/modules/mobile_brigade/ui.js');
const exp=read('src/js/app/dataset_excel_export.js');
for(const ui of [itsmUi,mbUi]){
  assert(!ui.includes("compactCard('Контроль входных данных'"));
  assert(ui.includes('module-algorithm'));
  assert(ui.includes('datasetSummary('));
  assert(ui.includes('Используемые справочники'));
  assert(ui.includes('Версия правил'))
  assert(!ui.includes('Версия обработчика'));
}
assert(itsmUi.indexOf('ReclassifierDatasetExcelExport?.markup') <
       itsmUi.indexOf('module-references-card'));
assert(mbUi.indexOf('ReclassifierDatasetExcelExport?.markup') <
       mbUi.indexOf('module-references-card'));
assert(exp.includes("escapeHtml(source?.width ?? '—')"),'export must label actual Full / analytical width');
assert(exp.includes('settings.dateLabel'),'export must show authoritative period field');
assert(!itsmUi.includes('Сохранённые поля') && !mbUi.includes('Сохранённые поля'),
  'duplicate source-field catalog was removed without altering data');
const manager=read('src/js/references/reference_manager.js');
const sqlite=read('src/js/app/database_integration.js');
assert(manager.includes('sourceFileModifiedAt:'));
assert(sqlite.includes('sourceFileModifiedAt:'));
console.log('PASS PR3: correct source dates, truthful metadata, full 5-row previews and unified layout');
