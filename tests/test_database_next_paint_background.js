// PR-2: database progress must not stall if requestAnimationFrame is paused.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/js/app/database_ui_state.js'), 'utf8');
const match = source.match(/function databaseNextPaint\(\)\s*\{[\s\S]*?\n\s*\}(?=\s*\n\s*function )/);
assert(match, 'databaseNextPaint source function found');
const declaration = match[0];

async function check(label, documentHidden, raf, maximumMs) {
  const ctx = { setTimeout, clearTimeout, Promise, document: { hidden: documentHidden } };
  if (raf) ctx.requestAnimationFrame = raf;
  vm.createContext(ctx);
  vm.runInContext(declaration + '\nthis.nextPaint = databaseNextPaint;', ctx);
  const before = performance.now();
  await Promise.race([
    ctx.nextPaint(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' stalled')), 500))
  ]);
  assert(performance.now() - before < maximumMs, label + ' should resolve promptly');
}

(async () => {
  await check('foreground frame never arrives', false, () => {}, 450);
  await check('hidden tab skips frame scheduling', true,
    () => { throw new Error('hidden tab must not request animation frame'); }, 450);
  await check('no requestAnimationFrame', false, null, 450);
  await check('requestAnimationFrame throws', false,
    () => { throw new Error('frame scheduling failure'); }, 450);
  console.log('PASS databaseNextPaint background fallback and no-rAF cases');
})().catch(error => { console.error(error); process.exitCode = 1; });
