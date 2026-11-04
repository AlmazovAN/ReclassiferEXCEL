'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const directory = path.join(root, 'dist');
const candidates = fs.readdirSync(directory).filter(x => /^Reclassifier_v.*_CORE\.html$/.test(x))
  .map(x => path.join(directory, x)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
assert(candidates.length, 'Run python build/build.py');
const html = fs.readFileSync(candidates[0], 'utf8');
const match = html.match(/"worker"\s*:\s*("(?:\\.|[^"\\])*")/);
assert(match, 'Embedded worker missing');
const worker = JSON.parse(match[1]);
const start = html.lastIndexOf('<script>\n') + '<script>\n'.length;
const browser = html.slice(start, html.lastIndexOf('</script>'));
const source = fs.readFileSync(path.join(root, 'src/js/modules/reclassification/classifier_index_v4.js'), 'utf8');
for (const [name, body] of [['browser', browser], ['worker', worker]]) {
  assert(body.includes(source), name + ': V4 index source not bundled verbatim');
  assert(body.indexOf(source) < body.indexOf('ReclassifierReclassificationRulesV4 = Object.freeze'), name + ': load order');
  new vm.Script(body, {filename: name + '-v4-04-bundle.js'});
  const sandbox = {};
  vm.runInNewContext(body.slice(body.indexOf(source), body.indexOf(source) + source.length), sandbox);
  assert.equal(sandbox.ReclassifierClassifierIndexV4.buildIndex({
    records: [], validation: {status: 'valid'}
  }).list().length, 0);
  assert(body.includes('V4_NOT_IMPLEMENTED'), name + ': V4 must remain unavailable');
}
console.log('V4-04 CORE: exact index source and syntax valid in browser/worker; V4 remains unavailable');
