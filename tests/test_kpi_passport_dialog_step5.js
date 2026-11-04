// Step 5: exercise real dashboard <dialog> binding in a minimal fake DOM.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Node {
  constructor(id) {
    this.id=id;this.listeners={};this.innerHTML='';this.textContent='';this.focusCount=0;
    this.isConnected=true;this.open=false;this.showModalCalls=0;this.scrollTop=-1;
  }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type,event={}) { for(const cb of this.listeners[type]||[]) cb({target:this,...event}); }
  focus() { this.focusCount += 1; }
  showModal() { this.showModalCalls += 1; this.open=true; }
  close() { this.open=false; this.emit('close'); }
}

const ids=['reliabilityKpiPassportDialog','reliabilityKpiPassportBody',
  'reliabilityKpiPassportClose','reliabilityKpiPassportOpen_sla',
  'reliabilityKpiPassportOpen_ktg'];
const map=new Map(ids.map(id=>[id,new Node(id)]));
const loaded=[];
const scope={
 console,Intl,
 escapeHtml: value=>String(value ?? '').replace(/[&<>"']/g,ch=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
 }[ch])),
 document:{getElementById:id=>map.get(id)||null},
 ReclassifierKpiPassportView:{
  renderContent:(id,options)=>{
    loaded.push({id,options});
    return '<h2 id="reliabilityKpiPassportTitle">'+id+'</h2>';
  }
 }
};
const src=fs.readFileSync('src/js/app/reliability_dashboard.js','utf8');
const page=vm.runInNewContext(src+'\n;({bindReliabilityPassportDialog,renderReliabilityKpiCard})',scope);
const snapshot={schemaVersion:'1.0.0',kpiView:{cards:{}}};
const dashboard={
 snapshot,
 kpiGroups:{
  dataQuality:[{id:'sla'}],
  technicalReliability:[{id:'ktg'}],
  organizationalReadiness:[]
 },
 labor:{summaryKpis:[]},
 problemManagement:{summaryKpis:[]}
};
page.bindReliabilityPassportDialog(dashboard);
const dialog=map.get('reliabilityKpiPassportDialog');
const body=map.get('reliabilityKpiPassportBody');
const close=map.get('reliabilityKpiPassportClose');
const sla=map.get('reliabilityKpiPassportOpen_sla');
const ktg=map.get('reliabilityKpiPassportOpen_ktg');

sla.emit('click');
assert.equal(dialog.showModalCalls,1);
assert.equal(dialog.open,true);
assert.equal(dialog.scrollTop,0);
assert.equal(close.focusCount,1);
assert(body.innerHTML.includes('>sla</h2>'));
assert.equal(loaded[0].id,'sla');
assert.equal(loaded[0].options.snapshot,snapshot);
close.emit('click');
assert.equal(dialog.open,false);
assert.equal(sla.focusCount,1,'Focus returns to origin button.');

ktg.emit('click');
assert.equal(dialog.showModalCalls,2);
assert(body.innerHTML.includes('>ktg</h2>'));
dialog.close(); // browser closes modal after Escape / cancel.
assert.equal(ktg.focusCount,1,'Escape close also restores trigger focus.');

sla.emit('click');
dialog.emit('click',{target:dialog});
assert.equal(dialog.open,false);
assert.equal(sla.focusCount,2,'Backdrop click closes the modal.');

sla.emit('click');
dialog.emit('click',{target:body});
assert.equal(dialog.open,true,'Inner-body click must not close the dialog.');
close.emit('click');
assert.equal(sla.focusCount,3);

// Opening second KPI replaces the content of the single dialog; no per-card dialogs.
assert.equal(map.has('reliabilityKpiPassportDialog'),true);
assert.equal(loaded.length,4);
assert(!src.includes('window.open('));
assert(!src.includes('renderReliabilityMethodology('));
const item={id:'sla',title:'SLA',unit:'%',value:90,previousValue:80,change:10,
 changeUnit:'п.п.',forecast:null,status:'neutral',dataState:'available',dataStatus:'calculated'};
const rendered=page.renderReliabilityKpiCard(item);
assert.match(rendered,/id="reliabilityKpiPassportOpen_sla"/);
assert.match(rendered,/data-kpi-passport-open="sla"/);
assert.match(rendered,/aria-haspopup="dialog"/);
assert.doesNotMatch(rendered,/<details\b/);
console.log('KPI Passport Modal Step 5: native open, Escape/close/backdrop, focus return and shared content OK');
