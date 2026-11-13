const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('imported exports do not request OPFS or reread prepared references', async () => {
  const messages = [];
  let storageCalls = 0;
  let workspaceVerifications = 0;
  const catalog = new File(['catalog'], 'reference.xlsx');
  const input = new File(['new ITSM'], 'source.xlsx');
  const history = new File(['history'], 'export_ITSM.xlsx');
  const inputs = [];
  const context = vm.createContext({
    Blob, TextEncoder, TextDecoderStream, ReadableStream, CompressionStream, DecompressionStream, crypto, Map,
    self:{postMessage: message => messages.push(message)},
    navigator:{
      locks:{request:async (_name, run) => run()},
      storage:{async getDirectory() {
        storageCalls++;
        throw new DOMException('Storage is denied.','SecurityError');
      }}
    },
    ReclassifierDirectoryEngine:{
      release(){},
      async enumerate(root, group) {
        const directory = new Map(root.entries()).get(group === 'catalogs' ? 'Catalogs' : group.toUpperCase());
        const entries = [];
        for (const [name, entry] of directory.entries()) {
          if (!name.startsWith('export_') && !name.startsWith('~$')) entries.push({path:name,file:await entry.getFile()});
        }
        return entries;
      },
      async scan(entries, _progress, options) {
        for (const entry of entries) await entry.file.arrayBuffer();
        if (options.preparedReferences) inputs.push(...entries);
        return {statuses:new Map(),exportReferences:{},
          files:new Map(entries.map(entry=>[entry.path,{sha256:'a'.repeat(64)}])),
          work:{itsm:options.preparedReferences ? entries : [],mobileBrigade:[]}};
      },
      exportReferenceHashes:()=>[],
      async verifyExportSources(){workspaceVerifications++;}
    },
    ReclassifierSafeExcelWriter:{
      async exportTargets(root) {
        const directory = new Map(root.entries()).get('MB');
        return {mb:{directory,filename:'export_MB.xlsx',path:'MB/export_MB.xlsx'}};
      },
      async inspectFolderExports(root, options) {
        assert.equal(options.requireWrite,false);
        const itsm = new Map(root.entries()).get('ITSM');
        return {itsm:await new Map(itsm.entries()).get(history.name).getFile(),mb:null};
      }
    },
    ReclassifierFolderExportProcessor:{async process({current,sources}) {
      assert.equal(await new Blob([current.itsm.slice(0,4)]).text(),'hist');
      await current.itsm.slice(0,4).arrayBuffer();
      const stream = current.itsm.stream();
      await stream.cancel();
      await sources.itsm[0].file.arrayBuffer();
      const rows = new Map([['row',{key:'row',values:['value']}]]);
      const restore = await context.stageRows(rows);
      await restore(rows);
      assert.equal(rows.get('row').values[0],'value');
      const blob = await context.stageBook(new Blob(['prepared']));
      return {status:'prepared',hashes:{itsm:null,mb:null},summary:{itsm:{rows:1},mb:{rows:1}},
        books:{itsm:{blob},mb:{blob}}};
    }}
  });
  for (const filename of ['storage.js','workspace/imported-directory.js','worker.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/folders',filename),'utf8'),context);
  }
  const files = [
    {path:'Reclassifier/Catalogs/reference.xlsx',file:catalog},
    {path:'Reclassifier/ITSM/source.xlsx',file:input},
    {path:'Reclassifier/ITSM/export_ITSM.xlsx',file:history},
    {path:'Reclassifier/MB/~$export_MB.xlsx',file:new File(['owner'],'~$export_MB.xlsx')}
  ];
  await context.self.onmessage({data:{action:'references',files,imported:true,diagnostics:true}});
  assert.ok(messages.some(message=>message.type === 'done' && message.action === 'references'));
  messages.length = 0;
  await context.self.onmessage({data:{action:'exports',imported:true,diagnostics:true}});
  const done = messages.find(message=>message.type === 'done');
  assert.ok(done, JSON.stringify(messages));
  assert.equal(await done.files.itsm.blob.text(),'prepared');
  assert.equal(inputs.length,1);
  assert.equal(storageCalls,0);
  assert.equal(workspaceVerifications,0);
  assert.ok(messages.some(message=>message.type === 'diagnostics' && /CATALOGS: буферы 0, потоки 0 · ITSM: буферы 3, потоки 1/.test(message.message)));
});
