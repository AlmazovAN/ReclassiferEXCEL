'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

require('../src/js/app/dataset_catalog.js');
require('../src/js/app/field_registry.js');
require('../src/js/modules/itsm/dataset_schema.js');
const schema = globalThis.ReclassifierItsmDatasetSchema;
const project = schema.mobileBrigadeLinkRows;
assert.equal(schema.mobileBrigadeLinkVersion, '1.0.0');
assert.equal(typeof project,'function');

const source = Array(schema.fields.length).fill(null);
source[schema.fields.indexOf('number')] = 'INC-001';
source[schema.fields.indexOf('createdAt')] = '2026-01-15T08:30:00';
source[schema.fields.indexOf('sourceEquipment')] = 'Камера';
const projected = project([source]);
assert.deepEqual(projected,[{number:'INC-001',createdAt:'2026-01-15T08:30:00'}]);
assert.equal(source[schema.fields.indexOf('number')],'INC-001',
  'Projection must not mutate saved ITSM data.');

// Historical versions may store a different positional layout. Use the
// persisted field list, not fixed indexes 0 / 3.
assert.deepEqual(project([['RITM-009','ignore','2025-11-01']],[
  'number','legacyField','createdAt'
]),[{number:'RITM-009',createdAt:'2025-11-01'}]);
assert.deepEqual(project([{number:'INC-OLD',createdAt:'2025-02-10'}]),[
  {number:'INC-OLD',createdAt:'2025-02-10'}
]);
assert.deepEqual(project([{number:'INC-MISSING-DATE'}]),[
  {number:'INC-MISSING-DATE',createdAt:null}
]);
assert.deepEqual(project([]),[]);

assert.throws(()=>project([['INC-X','2025-01-01']],['number','unexpected']),
  /number и createdAt/);
assert.throws(()=>project([['INC-X']],['number','createdAt']),
  /ширина записи/);
assert.throws(()=>project([['INC-X','2025-01-01']],['number','number']),
  /number и createdAt/);
assert.throws(()=>project([null]),/некорректная запись/);

// The HTML route uses the canonical adapter. SQLite uses a bounded SQL
// projection so it does not materialize the full ITSM Dataset in memory.
const htmlUI=fs.readFileSync('src/js/modules/mobile_brigade/ui.js','utf8');
const sqliteUI=fs.readFileSync('src/js/app/database_integration.js','utf8');
const sqliteCore=fs.readFileSync('src/js/app/database_core.js','utf8');
assert.match(htmlUI,/ReclassifierItsmDatasetSchema\?\.mobileBrigadeLinkRows/);
assert.match(htmlUI,/const itsmData = itsmLink\(/);
assert.match(sqliteUI,/repository\.getItsmMobileBrigadeLinkRows\(\)/);
assert.match(sqliteCore,/function getItsmMobileBrigadeLinkRows\(\)/);
assert.match(sqliteCore,/getItsmMobileBrigadeLinkRows: databaseSyncOperation/);
assert.match(sqliteCore,/FROM dataset_records WHERE dataset_id = 'itsm_data'/);

const catalog=globalThis.ReclassifierDatasetCatalog;
assert.deepEqual(catalog.fieldDependents('itsm_data','createdAt').map(x=>x.datasetId),
  ['mobile_brigade_data']);
assert.deepEqual(catalog.fieldDependents('mobile_brigade_data','request').map(x=>x.datasetId),
  ['itsm_data']);
assert.equal(catalog.get('mobile_brigade_data').dependencies.length,0,
  'Field-level enrichment must not create a cyclic DB revision dependency.');

console.log('PR2 ITSM/MB link contract: HTML adapter, bounded SQLite projection and acyclic lineage OK');
