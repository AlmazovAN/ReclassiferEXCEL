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
const sources=['facts_v4.js','event_v4.js','diagnostics_v4.js'].map(file=>
  fs.readFileSync(path.join(root,'src/js/modules/reclassification',file),'utf8'));
for (const [name,body] of [['browser',browser],['worker',worker]]) {
  new vm.Script(body,{filename:name+'-v4-06-bundle.js'});
  let previous=-1;
  for(const source of sources) {
    const position=body.indexOf(source);
    assert(position>previous,name+': missing source or invalid dependency order');
    previous=position;
  }
  assert(previous<body.indexOf('ReclassifierReclassificationRulesV4 = Object.freeze'));
  const sandbox={};
  vm.runInNewContext(sources.join('\n'),sandbox);
  const result=sandbox.ReclassifierEventAssessmentV4.analyze({number:'RITM-1',closureNote:'Обнаружен обрыв кабеля.'});
  assert.equal(result.failureState,'FAILURE');
  assert.equal(sandbox.ReclassifierTechnicalDiagnosticsV4.cells(result).length,54);
  assert(body.includes('V4_NOT_IMPLEMENTED'),name+': V4 must remain unavailable');
}
console.log('V4-06 CORE: exact facts/event/diagnostics sources, load order and syntax in Browser/Worker PASS');
