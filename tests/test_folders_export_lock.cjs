const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('Excel owner marker blocks export preflight without touching either book', async () => {
  const calls = [];
  let excelOpen = true;
  const targets = Object.fromEntries(['itsm','mb'].map(kind=>{
    const folder = kind.toUpperCase();
    const filename = 'export_'+folder+'.xlsx';
    return [kind,{filename,path:folder+'/'+filename,directory:{
      async getFileHandle() {
        throw new TypeError('Name is not allowed.');
      },
      async *entries() {
        calls.push(folder);
        yield [filename,{kind:'file'}];
        if (excelOpen && kind === 'mb') yield ['~$EXPORT_mb.xlsx',{kind:'file'}];
      }
    }}];
  }));
  const app = vm.createContext({
    ReclassifierSafeExcelWriter:{async exportTargets(){return targets;}}
  });
  const source = fs.readFileSync(path.join(__dirname,'../src/folders/storage.js'),'utf8');
  vm.runInContext(source,app);

  await assert.rejects(app.assertExcelExportsClosed({}),/Excel держит открытой книгу.*MB\/export_MB\.xlsx/);
  assert.deepEqual(calls,['ITSM','MB']);
  excelOpen = false;
  await app.assertExcelExportsClosed({});
  assert.deepEqual(calls,['ITSM','MB','ITSM','MB']);
});
