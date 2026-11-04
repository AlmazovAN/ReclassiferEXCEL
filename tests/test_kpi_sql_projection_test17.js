'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('src/js/app/database_core.js','utf8');
const begin=source.indexOf('  // TEST_17: a cursor decodes one JSON record at a time.');
const end=source.indexOf('\n// ============================================================================\n// KPI SNAPSHOT CACHE',begin);
assert(begin>=0&&end>begin,'Cannot locate SQL projection implementation');

const payload={
  itsm_data:{
    records:[['INC-1','2026-01-01'],['INC-2','2026-01-02'],['INC-3','2026-01-03']],
    metadata:{columns:['Номер','Просрочен по разрешению (факт)','Длинный текст'],
      coverage:'complete',rowCount:3},
    full:[
      {key:'INC-2',row:['INC-2',true,'A'.repeat(30000)]},
      {key:'INC-1',row:['INC-1',false,'B'.repeat(30000)]},
      {key:'INC-3',row:['INC-3','Просрочен','C'.repeat(30000)]}
    ]
  },
  mobile_brigade_data:{
    records:[{task:'TASK-1',laborHours:2},{task:'TASK-2',laborHours:0}],
    metadata:{columns:['Номер','Очень длинное описание'],coverage:'complete',rowCount:2},
    full:[{key:'TASK-1',row:['TASK-1','X'.repeat(30000)]},
      {key:'TASK-2',row:['TASK-2','Y'.repeat(30000)]}]
  }
};
let statements=0,finalized=0,fullJsonReads=0,projectionRows=0;
const sqlLog=[];
let throwAfter=null;
const db={
  prepare(sql){
    statements++;sqlLog.push(sql);
    let bind=[],index=-1;
    let dataset=null;
    let mode=sql.includes('dataset_records')?'analytic':
      sql.includes('json_extract(row_json')?'sla':'full';
    return {
      bind(args){bind=args;dataset=payload[mode==='sla'?bind[2]:bind[0]];
        assert(dataset,'Unknown test dataset')},
      step(){
        index++;
        if(throwAfter && mode===throwAfter && index===1)throw Error('Simulated sqlite cursor fault');
        return index<(mode==='analytic'?dataset.records.length:dataset.full.length)
      },
      get(col){
        if(mode==='analytic') {
          assert.equal(col,0);return JSON.stringify(dataset.records[index]);
        }
        if(mode==='full'){
          if(col===0)return dataset.full[index].key;
          assert.equal(col,1);fullJsonReads++;return JSON.stringify(dataset.full[index].row);
        }
        const cell=dataset.full[index].row[Number(/\$\[(\d+)\]/.exec(bind[0])[1])];
        if(col===0)return dataset.full[index].key;
        if(col===1) {
          projectionRows++;
          return cell!=null && typeof cell==='object'?JSON.stringify(cell):
            typeof cell==='boolean'?Number(cell):cell;
        }
        if(col===2)return cell===null?'null':typeof cell==='boolean'?String(cell):
          Array.isArray(cell)?'array':typeof cell==='object'?'object':typeof cell;
        throw Error('Unexpected column '+col)
      },
      finalize(){finalized++}
    }
  }
};
const queryRows=(_db,sql,bind)=> {
  assert.match(sql,/FROM dataset_state/);
  return [JSON.stringify({fullDataset:payload[bind[0]].metadata})];
};
const getDatasetRegistry=id=>({record_count:payload[id].records.length,active_revision:1});
const fn=new Function('globalThis','db','queryRows','getDatasetRegistry',
  'const requireOpenDatabase=()=>db;\n'+source.slice(begin,end)+
  '\nreturn {getDataset,getKpiDataset,getDatasetFullRows};');
const repo=fn({ReclassifierDiagnosticV2:{checkpoint:()=>{}}},db,queryRows,getDatasetRegistry);
const mobileKpi=repo.getKpiDataset('mobile_brigade_data');
assert.equal(mobileKpi.records.length,2);
assert.equal(mobileKpi.fullDataset,null,'KPI must not decode Mobile Brigade Full Dataset');
assert.equal(fullJsonReads,0,'Mobile Brigade Full Dataset should not even enter JS');
const itsmKpi=repo.getKpiDataset('itsm_data');
assert.deepEqual(itsmKpi.fullDataset.columns,['Просрочен по разрешению (факт)']);
assert.deepEqual(itsmKpi.fullDataset.recordKeys,['INC-2','INC-1','INC-3']);
assert.deepEqual(itsmKpi.fullDataset.rows,[[true],[false],['Просрочен']]);
assert.equal(itsmKpi.fullDataset.rowCount,3);
assert.equal(fullJsonReads,0,'ITSM SQL projection must never fetch full JSON row');
assert.equal(projectionRows,3);
assert(sqlLog.some(sql=>sql.includes('json_extract(row_json, ?)')));
const itsmFull=repo.getDataset('itsm_data');
const mobileFull=repo.getDataset('mobile_brigade_data');
assert.equal(itsmFull.fullDataset.fieldCount,3,'Generic ITSM read retains original width');
assert.equal(mobileFull.fullDataset.fieldCount,2,'Generic Mobile read retains original width');
assert.equal(itsmFull.fullDataset.rows[0][2].length,30000);
// Compare the exact production SLA lookup on generic and SQL-projected rows.
const factsSource=fs.readFileSync('src/js/kpi/source_facts.js','utf8');
const lookupStart=factsSource.indexOf('  function fullDatasetSlaLookup(');
const lookupEnd=factsSource.indexOf('  function itsmDatasetFacts(',lookupStart);
assert(lookupStart>0&&lookupEnd>lookupStart,'Production SLA lookup not found');
const normalize=value=>String(value??'').replace(/\\u00a0/g,' ')
  .replace(/\\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
const lookup=new Function('key',
  factsSource.slice(lookupStart,lookupEnd)+'return fullDatasetSlaLookup;')(normalize);
const fullLookup=lookup(itsmFull.fullDataset);
const kpiLookup=lookup(itsmKpi.fullDataset);
assert.deepEqual([...kpiLookup.byRequest],[...fullLookup.byRequest],
  'KPI SQL projection must preserve request-key SLA interpretation');
assert.deepEqual(kpiLookup.positional,fullLookup.positional,
  'KPI SQL projection must preserve positional SLA fallback');
assert.equal(fullJsonReads,5,'Full reads must preserve original payloads');
const beforeFullOnly=sqlLog.filter(sql=>sql.includes('FROM dataset_records')).length;
const fullOnly=repo.getDatasetFullRows('mobile_brigade_data');
assert.equal(fullOnly.records,undefined,'Full-only read must not decode analytical rows');
assert.equal(fullOnly.fullDataset.rows.length,2);
assert.equal(sqlLog.filter(sql=>sql.includes('FROM dataset_records')).length,beforeFullOnly,
  'Full-only upgrade must reuse cached analytical records');
assert.equal(finalized,statements,'Every successful statement must be finalized');
assert.throws(()=>repo.getKpiDataset('drivers'),/только ITSM/);
throwAfter='analytic';
assert.throws(()=>repo.getKpiDataset('mobile_brigade_data'),/cursor fault/);
assert.equal(finalized,statements,'Failed cursor must still be finalized');
assert(!source.slice(begin,end).includes('db.exec({'),
  'KPI and generic read must not materialize an intermediate exec resultRows array');
console.log('PASS TEST_17 SQL: no mobile Full Dataset on KPI, one ITSM SLA column, full-only upgrade, exact SLA parity and cursor finalization');
