'use strict';
// Run after "python build/build.py"; inspects browser and embedded worker copies.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const directory=path.join(__dirname,'..','dist');
const explicit=process.argv[2];
const files=explicit?[explicit]:fs.readdirSync(directory)
  .filter(x=>/^Reclassifier_v.*_CORE\.html$/.test(x))
  .map(x=>path.join(directory,x));
assert(files.length,'Build CORE HTML before checking assembly.');
const file=explicit||files.sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
const html=fs.readFileSync(file,'utf8');
const encoded=html.match(/"worker"\s*:\s*("(?:\\.|[^"\\])*")/);
assert(encoded,'Embedded worker JSON missing in HTML');
const worker=JSON.parse(encoded[1]);
const appStart=html.lastIndexOf('<script>\n');
const appEnd=html.lastIndexOf('</script>');
assert(appStart>=0 && appEnd>appStart,'Browser application script is missing');
const browser=html.slice(appStart,appEnd);
for(const [name,body] of [['browser',browser],['worker',worker]]){
  const old=body.indexOf('ReclassifierReclassificationRules=Object.freeze');
  const future=body.indexOf('ReclassifierReclassificationRulesV4 = Object.freeze');
  const registry=body.indexOf('ReclassifierReclassificationEngineRegistry = Object.freeze');
  assert(old>=0 && future>old && registry>future,name+': engine loading/order broken');
  assert(body.includes('V4_NOT_IMPLEMENTED'),name+': no explicit V4 error');
}
console.log('V4-02: browser bundle and embedded worker both contain ordered engines: '+file);
