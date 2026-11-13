const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname,'../dist/ReclassifierEXCEL.html'),'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function openPage(session, {discarded = false, denyStorage = false, navigation = false} = {}) {
  const nodes = new Map();
  const windowEvents = new Map();
  const downloads = [];
  let objectUrl;
  let worker;
  const makeNode = () => ({
    children:[], dataset:{}, style:{setProperty(){},removeProperty(){}},
    setAttribute(){}, removeAttribute(){}, toggleAttribute(){},
    addEventListener(name, callback){this[name] = callback;},
    focus(){this.focused = true;},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children = children;},
    querySelector(){return {};}
  });
  const node = id => {
    if (!nodes.has(id)) nodes.set(id,makeNode());
    return nodes.get(id);
  };
  const checkboxes = ['general','import_export','diagnostics','performance','runtime'].map(id=>{
    const checkbox = node(id);
    checkbox.dataset.log = id;
    checkbox.checked = false;
    return checkbox;
  });
  node('folders-worker').textContent = JSON.stringify('worker source');
  const pageButtons = navigation ? ['folders','journal','rca-master'].map(id => {
    const button = node('page-' + id);
    button.dataset.page = id;
    button.textContent = id;
    return button;
  }) : [];
  vm.runInNewContext(source,{
    location:{protocol:'file:',pathname:'/Reclassifier_Folders.html',hash:''},
    window:{
      isSecureContext:true,
      get sessionStorage(){
        if (denyStorage) throw new DOMException('Denied','SecurityError');
        return {getItem:key=>session.get(key) ?? null,setItem:(key,value)=>session.set(key,value)};
      },
      addEventListener:(type,callback)=>windowEvents.set(type,callback)
    },
    document:{
      wasDiscarded:discarded, getElementById:node, addEventListener(){},
      querySelectorAll:selector=>selector === '[data-log]' ? checkboxes : pageButtons,
      createTextNode:text=>({text}),
      createElement:()=>({click(){downloads.push({name:this.download,blob:objectUrl});}})
    },
    navigator:{storage:{estimate:async()=>({usage:1024,quota:4*1024**3})}},
    performance, URLSearchParams, Blob, console:{info(){}},
    setTimeout:()=>1, clearTimeout(){},
    URL:{createObjectURL:blob=>{objectUrl=blob; return 'blob:test';}, revokeObjectURL(){}},
    Worker:class {
      constructor(){worker=this;}
      postMessage(message){this.sent=message;}
      terminate(){}
    }
  });
  return {node,windowEvents,downloads,get worker(){return worker;}};
}

test('RCA switches the existing sidebar and returns to Folders on every visit', () => {
  const {node} = openPage(new Map(), {navigation:true});
  assert.equal((html.match(/<aside\b/g) ?? []).length, 1);
  for (let visit = 0; visit < 20; visit++) {
    node('page-journal').click();
    assert.equal(node('journal').hidden, false);
    node('page-rca-master').click();
    assert.equal(node('main-menu').hidden, true);
    assert.equal(node('rca-menu').hidden, false);
    assert.equal(node('rca-master').hidden, false);
    assert.equal(node('journal').hidden, true);
    node('rca-back').click();
    assert.equal(node('folders').hidden, false);
    assert.equal(node('rca-master').hidden, true);
    assert.equal(node('rca-menu').hidden, true);
    assert.equal(node('main-menu').hidden, false);
  }
});

test('journal entries, checkboxes and an interrupted stage survive reloading the same tab', async () => {
  const session = new Map();
  const page = openPage(session);
  assert.equal(page.node('download-log-json').disabled,true);
  for (const id of ['import_export','diagnostics']) {
    page.node(id).checked = true;
    page.node(id).change();
  }
  const input = page.node('folder-files');
  input.files = [{webkitRelativePath:'Reclassifier/Catalogs/reference.xlsx'}];
  input.change();
  page.node('refresh-references').click();
  page.worker.onmessage({data:{type:'done',action:'references'}});
  page.node('refresh-exports').click();
  page.worker.onmessage({data:{type:'error',action:'exports',message:'Excel держит открытую книгу.'}});
  assert.equal(page.node('refresh-exports').disabled,false);
  page.node('refresh-exports').click();
  assert.equal(page.worker.sent.action,'exports');
  page.worker.onmessage({data:{type:'progress',action:'exports',message:'Чтение книги МБ'}});
  page.windowEvents.get('pagehide')();

  const restored = openPage(session,{discarded:true});
  assert.equal(restored.node('diagnostics').checked,true);
  assert.equal(restored.node('import_export').checked,true);
  assert.equal(restored.node('operation-log-empty').hidden,true);
  assert.equal(restored.node('download-log').disabled,false);
  assert.equal(restored.node('download-log-json').disabled,false);
  await Promise.resolve();
  restored.node('download-log-json').click();
  restored.node('download-log').click();
  const report = JSON.parse(await restored.downloads[0].blob.text());
  assert.ok(report.entries.some(entry=>entry.message==='Чтение книги МБ'));
  assert.ok(report.entries.some(entry=>entry.message.includes('последний этап: Чтение книги МБ')));
  assert.ok(report.entries.some(entry=>entry.message.includes('выгружалась браузером: да')));
  assert.match(await restored.downloads[1].blob.text(),/Чтение книги МБ/);
});

test('browser-restored checkboxes start logging even when session storage is blocked', () => {
  const page = openPage(new Map(),{denyStorage:true});
  assert.match(page.node('journal-storage-status').textContent,/не разрешил/);
  page.node('general').checked = true;
  page.windowEvents.get('pageshow')();
  assert.equal(page.node('download-log-json').disabled,false);
});
