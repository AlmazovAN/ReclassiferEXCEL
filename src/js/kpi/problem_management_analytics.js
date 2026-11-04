// FILE CONTRACT: eight immutable factual charts of work linked to IT problems.
// Reads only selected prepared MB→ITSM→PRB rows and computed monthly KPI Results.
// No source reads, new formulas, side effects, status inference or demo values.
(() => {
  'use strict';
  const STATES=Object.freeze([
    ['linked','Связано с ИТ-проблемой'],
    ['not-linked','Не связано с ИТ-проблемой'],
    ['request-not-found','Обращение ITSM не найдено'],
    ['ambiguous','Неоднозначная связь']
  ]);
  const names=new Map(STATES);
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  function freeze(value){
    if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
    Object.values(value).forEach(freeze);return Object.freeze(value);
  }
  function groups(rows, keyFn, valueFn, limit=8){
    const values=new Map();
    for(const row of rows){
      const raw=keyFn(row);
      const name=String(raw||'Не указано').trim()||'Не указано';
      const amount=valueFn(row);
      if(!finite(amount)||amount<0)continue;
      values.set(name,(values.get(name)||0)+amount);
    }
    const sorted=[...values].map(([label,value])=>({label,value}))
      .sort((a,b)=>b.value-a.value||a.label.localeCompare(b.label,'ru'));
    const shown=sorted.slice(0,limit);
    if(sorted.length>limit)shown.push({
      label:'Прочие категории',
      value:sorted.slice(limit).reduce((a,b)=>a+b.value,0)
    });
    return shown;
  }
  function chart(id,title,unit,items,note){
    const data=Array.from(items||[]).map(item=>({
      label:String(item.label||'—'),
      value:finite(item.value)?item.value:null
    }));
    return freeze({id,title,unit,items:data,description:note});
  }
  function create(rows=[],months=[],sources=[]){
    const selected=Array.from(rows||[]);
    const monthly=Array.from(months||[]);
    const missing=Array.from(sources||[]).filter(s=>
      ['itsm_data','mobile_brigade_data'].includes(s.id)&&!s.available);
    const caveat=missing.length
      ? 'Часть источников недоступна; состояние связей нельзя считать полным.'
      : 'Только однозначные связи МБ → обращение ITSM → ИТ-проблема.';
    // Explicit no-data: no zero bars are invented for an empty selection.
    const knownStates=selected.length
      ? STATES.map(([id,label])=>({label,value:selected.filter(r=>r.problemLinkState===id)
          .reduce((sum,r)=>sum+Number(r.taskCount||0),0)}))
      : [];
    const stateHours=selected.length
      ? STATES.map(([id,label])=>({label,value:selected.filter(r=>r.problemLinkState===id)
          .reduce((sum,r)=>sum+Number(r.laborHours||0),0)}))
      : [];
    const linked=selected.filter(r=>r.problemLinkState==='linked'&&
      Number(r.linkedTaskCount||0)>0&&r.problemId);
    const series=id=>monthly.map(m=>({
      label:String(m.label||m.period||'—'),
      value:m[id]?.dataState==='available'&&finite(m[id].value)?m[id].value:null
    }));
    return freeze([
      chart('prb-linkage','Задачи по состоянию связи','задач',knownStates,caveat),
      chart('problem-link-labor','Трудозатраты по состоянию связи','чел.-ч',stateHours,caveat),
      chart('problem-linked-months','Связанные задачи по месяцам','задач',
        series('problem_linked_tasks'),'Месяц определяется датой факта задачи МБ.'),
      chart('problem-coverage-months','Доля связанных задач по месяцам','%',
        series('problem_task_coverage'),'Доля числа задач, а не доля трудозатрат.'),
      chart('problem-labor-months','Доля связанных трудозатрат по месяцам','%',
        series('problem_coverage_relative'),'Доля только пригодных человеко-часов МБ.'),
      chart('problem-task-types','Связанные трудозатраты по видам работ','чел.-ч',
        groups(linked,r=>r.finalTaskType,r=>Number(r.linkedLaborHours||0)),
        'Задачи с однозначным номером ИТ-проблемы.'),
      chart('problem-mines','Связанные трудозатраты по рудникам','чел.-ч',
        groups(linked,r=>r.mine,r=>Number(r.linkedLaborHours||0)),
        'Место определяется рудником связанного обращения ITSM.'),
      chart('problem-identifiers','Трудозатраты по ИТ-проблемам','чел.-ч',
        groups(linked,r=>r.problemId,r=>Number(r.linkedLaborHours||0)),
        'Первые восемь кодов ИТ-проблем; прочие объединены.')
    ]);
  }
  const api=Object.freeze({version:'1.0.0',create});
  globalThis.ReclassifierProblemManagementAnalytics=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
