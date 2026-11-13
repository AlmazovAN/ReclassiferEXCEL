// FILE CONTRACT: DKN workbook recognition, lossless business rows and stable hierarchy; no DOM/DB/network.
(() => {
  'use strict';
  const schemaVersion='1.0.0';
  const norm=v=>String(v ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU').replace(/ё/g,'е');
  const text=v=>v==null?'':String(v).trim();
  const patterns={prb:/^проблема\s*№|^номер.*проблем/,problemTitle:/краткое.*название.*проблем/,weightHours:/вес.*ч.*ч.*год/,weightFte:/вес.*fte/,potential:/потенциал/,code:/^п\.?\s*п\.?$|^код.*мероприят/,title:/мероприят.*вех/,report:/отчет.*выполн/,owner:/ответствен/,plannedStart:/начало.*план/,plannedEnd:/окончание.*план/,actualStart:/начало.*факт/,actualEnd:/окончание.*факт/,note:/примечани/};
  const required=['prb','problemTitle','code','title','report','owner','plannedStart','plannedEnd','actualStart','actualEnd'];
  const column=c=>{let s='';for(c++;c;c=Math.floor((c-1)/26))s=String.fromCharCode(65+(c-1)%26)+s;return s;};
  const cell=(sheet,r,c)=>c==null?undefined:(sheet[column(c)+(r+1)] || sheet['!data']?.[r]?.[c] || sheet[r]?.[c]);
  const validDay=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T12:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;};
  const prb=v=>{const s=String(v??'').replace(/\s+/g,'').toUpperCase();return /^PRB\d{9}$/.test(s)?s:null;};
  function key(value){let h=14695981039346656037n;for(const ch of value){h^=BigInt(ch.codePointAt(0));h=BigInt.asUintN(64,h*1099511628211n);}return h.toString(16).padStart(16,'0');}
  function detectWorkbook(workbook){
    const matches=[];
    for(const name of workbook?.SheetNames || []){
      const sheet=workbook.Sheets?.[name];if(!sheet)continue;
      for(let r=0;r<40;r++){
        const columns={};for(let c=0;c<128;c++){const value=norm(cell(sheet,r,c)?.v);if(!value)continue;for(const [id,pattern] of Object.entries(patterns))if(columns[id]===undefined && pattern.test(value))columns[id]=c;}
        if(required.every(id=>columns[id]!==undefined))matches.push({sheetName:name,headerRow:r+1,columns});
      }
    }
    if(matches.length>1)throw Error('ДКН: найдены несколько таблиц; выберите однозначный лист.');
    return matches[0] || null;
  }
  function dateValue(source,date1904,xlsx){
    const v=source?.v;
    if(v==null || v==='')return {value:null,warning:source?.f && v==null?'formula_missing_cached_value':null};
    if(source.t==='e')return {value:null,warning:'formula_error'};
    let result;
    if(v instanceof Date){if(!Number.isFinite(v.valueOf()))return {value:null,warning:'invalid_date'};result=[v.getFullYear(),v.getMonth()+1,v.getDate()];}
    else if(typeof v==='number'){
      if(v<=0)return {value:null,warning:'zero_excel_date'};
      const p=xlsx?.SSF?.parse_date_code(v,{date1904});if(p)result=[p.y,p.m,p.d];
    }else{
      const iso=text(v).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/),ru=text(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if(iso)result=iso.slice(1).map(Number);else if(ru)result=[Number(ru[3]),Number(ru[2]),Number(ru[1])];
    }
    const value=result?String(result[0]).padStart(4,'0')+'-'+String(result[1]).padStart(2,'0')+'-'+String(result[2]).padStart(2,'0'):null;
    return value && result[0]>=1900 && validDay(value)?{value,warning:null}:{value:null,warning:'invalid_date'};
  }
  function stage(title){const s=norm(title);if(/оцен[еёи]|оценк.*эффект|эффект.*оценк/.test(s))return 'assessment';if(/анализ|проанализ|причин.*определ/.test(s))return 'analysis';if(/реализован|внедрен|установлен|выполнен.*монтаж|заменен|оснащен/.test(s))return 'implementation';if(/подготов|разработ|согласован|проработ|утвержден|план.*состав/.test(s))return 'preparation';return 'other';}
  function normalizeWorkbook(workbook,options={}){
    const detected=detectWorkbook(workbook);if(!detected)throw Error('ДКН: структура заголовков не распознана.');
    const xlsx=options.xlsx || globalThis.XLSX;if(!xlsx?.utils?.decode_range)throw Error('ДКН: Excel parser недоступен.');
    const sheet=workbook.Sheets[detected.sheetName],bounds=xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');
    if(bounds.e.r>=10000 || bounds.e.c>=128)throw Error('ДКН: таблица превышает 10000 строк или 128 колонок.');
    const columns=detected.columns,date1904=workbook.Workbook?.WBProps?.date1904===true;
    const records=[],diagnostics=[],problems=new Map(),ids=new Set();let problem=null,action=null,sourceRows=0;
    const warn=(row,code,field)=>diagnostics.push({row,code,...(field?{field}:{})});
    const sourceCells=r=>{const out={};for(let c=0;c<=bounds.e.c;c++){const s=cell(sheet,r,c);if(!s || s.v==null && !s.f)continue;out[column(c)]={type:s.t || null,value:s.v instanceof Date?dateValue(s,date1904,xlsx).value:s.v ?? null,...(s.f?{formula:s.f}:{}),...(s.z?{numberFormat:s.z}:{})};}return out;};
    function push(record){if(ids.has(record.rowId))throw Error('ДКН: неоднозначный повтор идентификатора строки '+record.sourceRow);ids.add(record.rowId);records.push(record);}
    for(let r=detected.headerRow;r<=bounds.e.r;r++){
      const get=id=>cell(sheet,r,columns[id])?.v;
      const rawPrb=get('prb');if(text(rawPrb) && typeof rawPrb==='string'){
        const id=prb(rawPrb);if(!id){warn(r+1,'invalid_prb');problem=null;action=null;continue;}
        if(problems.has(id))throw Error('ДКН: PRB повторена отдельной группой: '+id);
        problem={schemaVersion,rowId:'dkn:'+id+':problem',kind:'problem',prbId:id,parentId:null,sourceCode:null,title:text(get('problemTitle')),referenceWeightHoursPerYear:typeof get('weightHours')==='number'?get('weightHours'):null,referenceWeightFte:typeof get('weightFte')==='number'?get('weightFte'):null,planPotentialRaw:text(get('potential')) || null,sourceSheet:detected.sheetName,sourceRow:r+1,sourceCells:sourceCells(r)};
        problems.set(id,problem);push(problem);action=null;
      }
      const code=text(get('code')),title=get('title');
      // Skip the numeric column-number row and genuinely empty business rows.
      if(typeof title!=='string' || !title.trim())continue;
      if(!problem){warn(r+1,'orphan_row');continue;}
      const isAction=/^\d+(?:\.\d+)+\.?$/.test(code),isMilestone=/^веха\s*\d+/i.test(code);
      if(!isAction && !isMilestone){warn(r+1,'unmapped_row');}
      if(isMilestone && !action){warn(r+1,'orphan_milestone');continue;}
      const kind=isAction?'action':isMilestone?'milestone':'unmapped',sourceCode=isAction?code.replace(/\.$/,''):code;
      const parentId=isAction?problem.rowId:action?.rowId || problem.rowId;
      const naturalKey=problem.prbId+'|'+parentId+'|'+kind+'|'+norm(sourceCode);
      const identityKey=isAction?naturalKey:naturalKey+'|'+norm(title);
      let rowId='dkn:'+problem.prbId+':'+kind+':'+key(identityKey);
      if(ids.has(rowId)){let n=2;while(ids.has(rowId+':'+n))n++;rowId+=':'+n;warn(r+1,'identical_duplicate_requires_review');}
      const record={schemaVersion,rowId,kind,prbId:problem.prbId,parentId,sourceCode,title:text(title),report:text(get('report')) || null,owner:text(get('owner')) || null,note:text(get('note')) || null,stage:isAction?stage(title):action?.stage || 'other',technicalMeasureStatus:'requires_review',naturalKey,identityKey,sourceSheet:detected.sheetName,sourceRow:r+1,sourceCells:sourceCells(r)};
      for(const field of ['plannedStart','plannedEnd','actualStart','actualEnd']){const d=dateValue(cell(sheet,r,columns[field]),date1904,xlsx);record[field+'Date']=d.value;if(d.warning)warn(r+1,d.warning,field);if(field.startsWith('actual') && d.value && options.today && d.value>options.today)warn(r+1,'future_actual_date',field);}
      for(const prefix of ['planned','actual'])if(record[prefix+'StartDate'] && record[prefix+'EndDate'] && record[prefix+'StartDate']>record[prefix+'EndDate'])warn(r+1,'reversed_dates',prefix);
      push(record);sourceRows++;if(isAction)action=record;
    }
    const duplicateCodes=new Map();for(const r of records.filter(r=>r.kind==='milestone')){const k=r.parentId+'|'+norm(r.sourceCode);duplicateCodes.set(k,(duplicateCodes.get(k)||0)+1);}
    const errors=diagnostics.filter(d=>['orphan_row','orphan_milestone','invalid_prb'].includes(d.code)).map(d=>'Строка '+d.row+': '+d.code);
    const warnings=diagnostics.filter(d=>!['orphan_row','orphan_milestone','invalid_prb'].includes(d.code)).map(d=>'Строка '+d.row+': '+d.code+(d.field?' ('+d.field+')':''));
    if(!problems.size || !sourceRows)errors.push('ДКН не содержит проблем и мероприятий.');
    return {records,validation:{status:errors.length?'invalid':warnings.length?'warning':'valid',errors,warnings},meta:{schemaVersion,sourceSheet:detected.sheetName,headerRow:detected.headerRow,sourceRows,normalizedRows:records.length,problemCount:problems.size,actionCount:records.filter(r=>r.kind==='action').length,milestoneCount:records.filter(r=>r.kind==='milestone').length,duplicateMilestoneCodeGroups:[...duplicateCodes.values()].filter(n=>n>1).length,date1904,diagnostics,columns,sourceHeaderCells:Array.from({length:detected.headerRow},(_,r)=>({row:r+1,cells:sourceCells(r)})),sourceMerges:sheet['!merges'] || []}};
  }

  // Only this small reference may be materialized. Event datasets stay in bounded SQL projections.
  function assertRecords(records){
    if(!Array.isArray(records) || !records.length || records.length>11000)throw Error('ДКН: ожидается 1–11000 записей.');
    const ids=new Set();
    for(const r of records){
      if(!r || !['problem','action','milestone','unmapped'].includes(r.kind) || !prb(r.prbId) || typeof r.rowId!=='string' || !r.rowId || ids.has(r.rowId))throw Error('ДКН: некорректная или повторная идентичность.');
      ids.add(r.rowId);
      if(r.kind==='problem' ? r.parentId!==null : !ids.has(r.parentId))throw Error('ДКН: нарушена иерархия.');
      if(r.kind!=='problem' && (!r.naturalKey || !r.identityKey))throw Error('ДКН: отсутствует ключ источника.');
    }
    const byId=new Map(records.map(r=>[r.rowId,r]));
    for(const r of records){const parent=byId.get(r.parentId);if(parent && (parent.prbId!==r.prbId || r.kind==='action' && parent.kind!=='problem' || r.kind==='milestone' && parent.kind!=='action'))throw Error('ДКН: неверный родитель.');}
  }
  function reconcile(previous,incoming,mappings={}){
    assertRecords(incoming);if(previous.length)assertRecords(previous);
    const oldById=new Map(previous.map(r=>[r.rowId,r])),used=new Set(),remap=new Map(),ambiguous=[],records=[],decisions={};
    for(const source of incoming){
      const parentId=remap.get(source.parentId) || source.parentId;
      const candidates=previous.filter(r=>r.prbId===source.prbId && r.kind===source.kind && r.parentId===parentId && (r.kind==='problem' || norm(r.sourceCode)===norm(source.sourceCode)));
      const exact=candidates.filter(r=>r.identityKey===source.identityKey && !used.has(r.rowId));
      const chosen=mappings[source.rowId];let match=null;
      if(chosen && chosen!=='new'){
        match=oldById.get(chosen);
        if(!match || !candidates.includes(match) || used.has(chosen))throw Error('ДКН: недопустимое или повторное сопоставление.');
      }else if(chosen!=='new'){
        if(exact.length===1)match=exact[0];
        else if(candidates.length===1 && !used.has(candidates[0].rowId))match=candidates[0];
        else if(candidates.length){ambiguous.push({rowId:source.rowId,sourceRow:source.sourceRow,title:source.title,candidates:candidates.filter(r=>!used.has(r.rowId)).map(r=>({rowId:r.rowId,title:r.title}))});}
      }
      let rowId=match?.rowId || source.rowId;
      if(chosen==='new' && oldById.has(rowId)){
        const base=rowId+':new:'+key([...oldById.keys()].sort().join('|'));rowId=base;let n=2;
        while(oldById.has(rowId) || used.has(rowId) || incoming.some(r=>r.rowId===rowId))rowId=base+':'+n++;
      }
      if(used.has(rowId))throw Error('ДКН: сопоставление создаёт повторный ID.');
      if(match)decisions[rowId]=rowId;else if(chosen==='new')decisions[rowId]='new';
      used.add(rowId);remap.set(source.rowId,rowId);records.push({...source,rowId,parentId});
    }
    assertRecords(records);return {records,ambiguous,decisions};
  }
  function compareVersions(previous,incoming){
    if(incoming.length)assertRecords(incoming);
    const old=new Map(previous.map(r=>[r.rowId,r])),added=[],changed=[],unchanged=[],removed=[];
    const clean=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sourceRow','identityKey','naturalKey'].includes(k)));
    for(const r of incoming){const before=old.get(r.rowId);old.delete(r.rowId);if(!before){added.push(r);continue;}
      const a=clean(before),b=clean(r),fields=[...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k]));
      if(fields.length)changed.push({rowId:r.rowId,title:r.title,fields,before,after:r});else unchanged.push(r.rowId);
    }
    removed.push(...old.values());return {added,changed,unchanged,removed};
  }
  const api=Object.freeze({schemaVersion,detectWorkbook,normalizeWorkbook,dateValue,stage,assertRecords,reconcile,compareVersions});globalThis.ReclassifierDknRoadmap=api;if(typeof module!=='undefined' && module.exports)module.exports=api;
})();
