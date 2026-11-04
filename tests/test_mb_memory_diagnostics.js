// Regression check for MB memory diagnostics, no corporate data required.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../src/js/workers/mobile_brigade_processor.js'), 'utf8');
new Function(source);
const stages = [
  'start', 'xlsx-read', 'sheet-to-json', 'classification',
  'duplicate-key-resolution', 'export-row-preparation',
  'aoa-to-sheet', 'xlsx-write', 'finish'
];
for (const stage of stages) assert(source.includes("snapshot('"+stage+"'"), 'Missing diagnostic stage '+stage);
assert(source.includes("memoryMetric: 'unavailable'"), 'Memory availability must be explicit');
assert(source.includes('diagnostics,'), 'Diagnostic output must be available to callers');
assert(source.includes('bookSST: false'), 'Chunked XLSX writer must avoid shared strings table');
assert(source.includes('sheet_add_aoa'), 'Expected bounded chunked XLSX sheet writing');
console.log('MB memory diagnostics static regression: OK');
