const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const journalSource = fs.readFileSync(path.join(root, 'src/js/app/diagnostic_journal.js'), 'utf8');
const systemSource = fs.readFileSync(path.join(root, 'src/js/app/system.js'), 'utf8');

const nodes = new Map();
const links = [];
const blobs = [];
const intervals = new Map();
let timerId = 0;
const node = id => {
  if (!nodes.has(id)) nodes.set(id, {
    id, textContent:'', innerHTML:'', style:{}, dataset:{},
    listeners:{}, addEventListener(type,handler){this.listeners[type]=handler;},
    click(){this.clicked=true;}, remove(){this.removed=true;}
  });
  return nodes.get(id);
};
const categories = ['general', 'import_export', 'runtime', 'diagnostics', 'performance'];
const pageContent = {
  innerHTML:'',
  querySelectorAll(selector) {
    if (selector === '[data-journal-toggle]') return categories.map(id => {
      const n = node('journalToggle_' + id);
      n.dataset.journalToggle=id;
      return n;
    });
    if (selector === '[data-journal-download]') return categories.map(id => {
      const n = node('journalDownload_' + id);
      n.dataset.journalDownload=id;
      return n;
    });
    return [];
  }
};
const env = {
  state:{route:'log', log:[]},
  el:{pageContent},
  build:{version:'PR09'},
  document:{
    visibilityState:'visible', hasFocus:()=>true,
    getElementById: node,
    createElement(){return {click(){this.clicked=true;},remove(){this.removed=true;}};},
    body:{appendChild(link){links.push(link);}}
  },
  navigator:{deviceMemory:8},
  performance:{memory:{
    usedJSHeapSize: 80 * 1048576,
    totalJSHeapSize: 120 * 1048576,
    jsHeapSizeLimit: 1024 * 1048576
  }},
  setInterval(callback){const id=++timerId;intervals.set(id,callback);return id;},
  clearInterval(id){intervals.delete(id);},
  ReclassifierPerformanceProfiler:{
    setEnabled(value){this.enabled=value;},
    snapshot(){return {enabled:this.enabled!==false,retainedEventCount:2,
      usedJsHeapBytes:16, timings:[{name:'SQLite.commit',count:2,totalMs:123,
        avgMs:61.5,maxMs:90}],counters:{'sqlite.commit':2}};},
    reset(){}
  },
  setHeader() {},
  escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
  formatBytes:v=>Number(v).toFixed(0)+' B',
  Blob:class{constructor(parts,opts){this.json=JSON.parse(parts[0]);this.type=opts.type;blobs.push(this);}},
  URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},
  setTimeout:fn=>fn()
};
env.globalThis=env;
const keys=Object.keys(env);
const ui=new Function(...keys,journalSource+'\n'+systemSource+
  '\nreturn {renderLog,refreshJournalVisibleRows,downloadDiagnosticCategoryJson};')
  (...keys.map(key=>env[key]));
const journal=env.ReclassifierDiagnosticJournal;

for (const category of categories) journal.setEnabled(category, true);
journal.capture('Open SQLite', 'INFO', 'import_export');
journal.capture('Worker error', 'ERROR', 'runtime');
journal.capture('User navigated', 'DEBUG', 'general');
journal.capture('Profiler reached 90ms', 'INFO', 'performance');
ui.renderLog();
assert.match(pageContent.innerHTML, /id="journalToggle_general"/);
assert.match(pageContent.innerHTML, /id="journalDiagnosticsPanel"/);
assert.match(pageContent.innerHTML, /Показания JavaScript heap/);
assert.match(pageContent.innerHTML, /соседними вкладками/);
for (const category of categories) {
  assert.match(pageContent.innerHTML, new RegExp('id="journalDownload_' + category + '"'));
  assert.equal(typeof node('journalDownload_' + category).listeners.click, 'function');
  node('journalDownload_' + category).listeners.click();
  const file='Reclassifier_Journal_' + category + '.json';
  assert.equal(links.at(-1).download,file);
  const data=blobs.at(-1).json;
  assert.equal(data.category,category);
  assert.ok(data.events.every(event=>event.category===category));
  assert.equal(data.applicationVersion,'PR09');
  assert.equal(data.schemaVersion,1);
}
assert.equal(blobs.at(-1).json.performance.timings[0].name,'SQLite.commit');
node('journalToggle_import_export').listeners.change({target:{checked:false}});
assert.equal(journal.capture('NOT RECORDED','INFO','import_export'),null);
node('journalDownload_import_export').listeners.click();
assert.equal(blobs.at(-1).json.retainedEventCount,1);
assert.equal(blobs.at(-1).json.captureEnabled,false);
node('journalToggle_import_export').listeners.change({target:{checked:true}});
assert.ok(journal.capture('RESTORED','INFO','import_export'));
node('journalToggle_general').listeners.change({target:{checked:false}});
assert.equal(journal.capture('NOT RECORDED','INFO','general'),null);
node('journalToggle_general').listeners.change({target:{checked:true}});
assert.ok(journal.capture('RESUMED','INFO','general'));

node('journalToggle_diagnostics').listeners.change({target:{checked:true}});
assert.equal(intervals.size,1);
assert.equal(journal.diagnosticsReport().sampleCount,1);
assert.match(pageContent.innerHTML,/раз в 30 секунд/);
env.performance.memory.usedJSHeapSize=90*1048576;
node('journalDiagnosticsSampleButton').listeners.click();
assert.equal(journal.diagnosticsReport().sampleCount,2);
node('journalDiagnosticsDownloadButton').listeners.click();
assert.equal(links.at(-1).download,'Reclassifier_Journal_diagnostics.json');
assert.equal(blobs.at(-1).json.diagnostics.memory.deltaUsedJsHeapBytes,10*1048576);
assert.equal(blobs.at(-1).json.diagnostics.tab.visibility,'visible');
node('journalToggle_diagnostics').listeners.change({target:{checked:false}});
assert.equal(intervals.size,0);
const prior=journal.diagnosticsReport().sampleCount;
assert.equal(journal.sampleDiagnostics('manual'),null);
assert.equal(journal.diagnosticsReport().sampleCount,prior);
assert.match(pageContent.innerHTML,/новых замеров нет/);

console.log('PR-09 category JSON buttons, immediate toggles and memory UI: OK');
