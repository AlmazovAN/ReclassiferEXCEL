'use strict';
// Unit-level SQLite streaming projection test. No real database or private
// source data is needed: exercise the actual repository method with a fake
// SQLite statement that reads only the fields requested by the SQL query.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const code = fs.readFileSync('src/js/app/database_core.js','utf8');
const begin = code.indexOf('  function getItsmMobileBrigadeLinkRows() {');
const end = code.indexOf('  function getMobileBrigadeRowsForRequests',begin);
assert(begin >= 0 && end > begin, 'Missing isolated projection method');
const method = code.slice(begin,end);
assert(!method.includes("getDataset('itsm_data')"),
  'Projection must never materialize entire ITSM Dataset or Full Dataset');

function fakeRepository(rows,fields) {
  let finalized = false;
  let sqlText = '';
  const db = {
    prepare(sql) {
      sqlText = sql;
      assert.match(sql,/FROM dataset_records WHERE dataset_id = 'itsm_data'/);
      assert.match(sql,/ORDER BY ordinal, record_key/);
      assert(!/SELECT \*/.test(sql),'Do not fetch complete ITSM rows');
      const paths = [...sql.matchAll(/\$\[(\d+)\]/g)].map(m => Number(m[1]));
      assert.strictEqual(paths.length,2);
      let index = -1;
      return {
        step() { index++; return index < rows.length; },
        get(col) {
          const record=rows[index];
          if(col === 0)return Array.isArray(record) ? 'array' : 'object';
          if(col === 1)return Array.isArray(record) ? record.length : 0;
          if(col === 2)return Array.isArray(record) ? record[paths[0]] : record.number;
          if(col === 3)return Array.isArray(record) ? record[paths[1]] : record.createdAt;
          throw new Error('Unexpected SQLite field '+col);
        },
        finalize() { finalized=true; }
      };
    }
  };
  const build = new Function('getOpen','getState','schema',
    'const requireOpenDatabase=getOpen;'+
    'const getDatasetState=getState;'+
    'const globalThis={ReclassifierItsmDatasetSchema:schema};'+
    method+'\nreturn getItsmMobileBrigadeLinkRows;');
  const getLinks = build(()=>db,()=>({fields}),{fields});
  return {getLinks,wasFinalized:()=>finalized,sql:()=>sqlText};
}

const legacyOrder=['number','unrelated','createdAt'];
const arrayDb=fakeRepository([
  [' INC-100 ','ignored','2026-09-01T08:00:00'],
  ['RITM-200','ignored',null]
],legacyOrder);
assert.deepStrictEqual(arrayDb.getLinks(),[
  {number:' INC-100 ',createdAt:'2026-09-01T08:00:00'},
  {number:'RITM-200',createdAt:null}
]);
assert(arrayDb.wasFinalized());

const objectDb=fakeRepository([
  {number:'INC-OLD',createdAt:'2025-09-01',other:'must-not-escape'}
],['createdAt','number']);
assert.deepStrictEqual(objectDb.getLinks(),[
  {number:'INC-OLD',createdAt:'2025-09-01'}
]);
assert(objectDb.wasFinalized());

const wrongWidth=fakeRepository([['INC-1']],[ 'number','createdAt']);
assert.throws(()=>wrongWidth.getLinks(),/ширина записи ITSM/);
assert(wrongWidth.wasFinalized(),'SQLite statement must finalize after error');
assert.throws(()=>fakeRepository([],['other']).getLinks(),/number и createdAt/);

const noRows=fakeRepository([],['number','createdAt']);
assert.deepStrictEqual(noRows.getLinks(),[]);
assert(noRows.wasFinalized());
console.log('SQLite ITSM->MB read-only SQL projection: ordered arrays, objects, widths, empty, finally OK');
