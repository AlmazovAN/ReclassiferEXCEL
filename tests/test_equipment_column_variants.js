const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('../vendor/xlsx.full.min.js');

const common = ['id', 'unit', 'name', 'equipment_type', 'location', 'transport',
  'not_working_since', 'customer', 'parent', 'commissioning_date'];

function verifyVariants(sourceRoot) {
  const app = vm.createContext({XLSX, state:{}, ReclassifierDatasetLifecycleManager:{}});
  app.window = app;
  for (const file of ['app/dataset_catalog.js', 'app/dataset_classifier.js',
    ...['config', 'partitions', 'logic'].map(part => `modules/equipment/equipment_${part}.js`)]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', sourceRoot, file), 'utf8'), app);
  }
  const partitions = app.ReclassifierEquipmentPartitions;

  for (const id of ['mounted', 'stationary']) {
    const required = id === 'stationary' ? [...common, 'address', 'horizon'] : common;
    const identifier = id === 'mounted' ? 'identifier_number' : 'identifier';
    const kfHeaders = [...required, 'transport_or_warehouse', identifier, 'level', 'group_number'];
    const zfHeaders = [...required, 'unit_department', 'identifier', 'level'];
    if (id === 'stationary') zfHeaders.push('transport_or_warehouse');

    function normalize(headers, values) {
      const book = XLSX.utils.book_new();
      const row = {id:1, unit:'Mine-A', name:'Equipment', ...values};
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, headers.map(h => row[h])]), 'Data');
      assert.equal(app.ReclassifierDatasetClassifier.classifyWorkbook(book).id, `equipment:${id}`);
      const instance = app.normalizeEquipmentWorkbook(id, book, {freshness:'2026-11-03'});
      assert.equal(instance.validation.status, 'valid');
      return instance;
    }

    const kf = normalize(kfHeaders, {[identifier]:'001', group_number:7, transport_or_warehouse:'Depot', level:0});
    const zf = normalize(zfHeaders, {unit_department:'Dept', identifier:'002', level:null});
    const legacy = normalize(id === 'stationary' ? [...required, 'unit_department'] : required, {});
    assert.equal(kf.records[0].identifier, '001');
    assert.equal(kf.records[0].level, '0');
    assert.equal(Object.hasOwn(zf.records[0], 'group_number'), false);
    assert.equal(zf.records[0].level, null);
    assert.equal(Object.hasOwn(legacy.records[0], 'group_number'), false);

    const records = partitions.mergeFileRows(id, [kf.records, zf.records]);
    assert.equal(records.length, 1);
    assert.deepEqual(records, partitions.merge(id, kf, zf.records, new Map()).records);
    const combined = app.buildEquipmentCombinedFromCatalogs({[id]:{...zf, records}}).records[0];
    assert.equal(combined.group_number, '7');
    assert.equal(combined.unit_department, 'Dept');
    assert.equal(combined.identifier, '002');
    assert.equal(combined.level, null);
    assert.equal(combined.transport_or_warehouse, id === 'mounted' ? 'Depot' : null);
    assert.equal(app.buildEquipmentCombinedFromCatalogs({[id]:zf}).records[0].group_number, null);
    const reverse = partitions.merge(id, zf, kf.records, new Map()).records[0];
    assert.equal(reverse.unit_department, 'Dept');
    assert.throws(() => partitions.mergeFileRows(id, [kf.records, kf.records]), /секци/);
    const differentId = {...zf.records[0], id:'2'};
    assert.throws(() => partitions.mergeFileRows(id, [kf.records, [differentId]]), /секци/);
  }
}

verifyVariants('src/js');
console.log('KF/ZF Equipment variants: recognition, field presence, overlap guards and Combined OK');
