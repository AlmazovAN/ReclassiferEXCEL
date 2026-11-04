const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
class Node {
  constructor() { this.listeners = {}; this.files = []; this.classList = { add() {}, remove() {} }; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.clicked = true; }
  remove() { this.removed = true; }
}
const nodes = { drop: new Node(), button: new Node() };
const inputs = [];
const errors = [];
const context = vm.createContext({
  state: {}, window: {}, equipmentConfig: {}, log() {}, alert: message => errors.push(message),
  document: {
    getElementById: id => nodes[id],
    createElement: () => { const input = new Node(); inputs.push(input); return input; },
    body: { appendChild() {} }
  }
});
vm.runInContext(read('src/js/app/dataset_catalog.js'), context);
vm.runInContext(read('src/js/app/dataset_pipeline.js'), context);
vm.runInContext(read('src/js/references/reference_config.js'), context);
vm.runInContext(read('src/js/references/reference_normalizers.js'), context);
const evaluate = code => vm.runInContext(code, context);
const file = name => ({ name, size: 1 });
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  let selected = null, renders = 0;
  const accept = context.acceptExcelFiles;
  const process = value => { selected = value; };
  const render = () => { renders++; };
  await accept([file('first.XLSX')], process, render);
  const original = selected;
  await accept([], process, render);
  await accept([file('bad.csv')], process, render);
  await accept([file('a.xlsx'), file('b.xlsx')], process, render);
  assert.strictEqual(selected, original);
  assert.equal(renders, 1);
  assert.equal(errors.length, 2);
  await accept([file('a.xlsm'), file('b.xls')], process, render, true);
  assert.equal(selected.length, 2);
  await accept([file('broken.xlsx')], () => { throw Error('read failed'); }, render);
  assert.equal(errors.at(-1), 'read failed');
  assert.equal(renders, 2);

  context.bindDatasetDropzone('drop', 'button', process, render);
  nodes.button.listeners.click();
  let input = inputs.at(-1);
  assert.equal(input.accept, '.xlsx,.xlsm,.xls');
  assert.equal(input.multiple, false);
  const same = file('same.xlsx');
  input.files = [same]; input.listeners.change(); await tick();
  assert.strictEqual(selected, same);
  assert.equal(input.value, '');
  assert.equal(input.removed, true);
  nodes.button.listeners.click();
  input = inputs.at(-1); input.files = [same]; input.listeners.change(); await tick();
  assert.strictEqual(selected, same); // Same file can be picked again.
  nodes.button.listeners.click(); input = inputs.at(-1); input.listeners.cancel();
  assert.equal(input.removed, true);
  const beforeDrop = selected;
  nodes.drop.listeners.drop({ preventDefault() {}, dataTransfer: { files: [file('bad.txt')] } });
  await tick(); assert.strictEqual(selected, beforeDrop);
  const dropped = file('drop.xlsx');
  nodes.drop.listeners.drop({ preventDefault() {}, dataTransfer: { files: [dropped] } });
  await tick(); assert.strictEqual(selected, dropped);

  // Header-only Exceptions is a valid empty ruleset, including actual normalization.
  context.window.XLSX = { utils: { sheet_to_json: sheet => sheet } };
  context.emptyWorkbook = { SheetNames: ['rules'], Sheets: { rules: [
    ['№', 'Ислючение для [Причина инцидента]', 'Решение', 'Категория']
  ] } };
  const normalized = evaluate('normalizeExceptionsWorkbook(emptyWorkbook)');
  assert.equal(normalized.records.length, 0);
  assert.notEqual(normalized.validation.status, 'invalid');
  const pipeline = evaluate('datasetPipeline');
  await pipeline.prepare('exceptions', [file('empty.xlsx')], async () => ({ id: 'exceptions', ...normalized }));
  assert.equal(pipeline.commit('exceptions').records.length, 0);
  await pipeline.prepare('customers', [file('empty.xlsx')], async () => ({ id: 'customers', ...normalized }));
  assert.equal(pipeline.get('customers').candidate.validation.status, 'invalid');
  assert.throws(() => pipeline.commit('customers'));
  assert.throws(() => pipeline.setActive('customers', { id: 'customers', ...normalized }));
  console.log('shared file selection and dataset empty policies: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
