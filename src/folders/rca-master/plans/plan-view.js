function rcaPlanControls(item, library, commit) {
  const panel = rcaElement('div','','rca-plan');
  const save = plan => commit(next => {
    const action = next.actions.find(entry=>entry.id===item.id);
    action.plan = plan;
    action.revision = (action.revision ?? 1) + 1;
    action.updatedAt = new Date().toISOString();
  });
  if (!item.plan) {
    const add = rcaButton('Добавить типовой план', () => rcaEditor('Типовой план',[
      ['Сценарий','id','',{required:true,choices:Object.fromEntries([['','Выберите сценарий'],
        ...library.templates.map(template=>[template.id,template.id+' · '+template.title])])}],
      ['Дата начала','start','',{type:'date',required:true}]
    ], values=>save(createRcaPlan(library.templates.find(template=>template.id===values.id),library,values.start))));
    add.disabled = !library;
    panel.append(add);
    if (!library) panel.append(rcaElement('small','Загрузите библиотеку через «Обновить справочники».'));
    return panel;
  }
  const plan = item.plan;
  panel.append(rcaElement('h3', plan.template.title), rcaElement('p', 'Плановый период · ' + plan.start + ' — ' + plan.end));
  const update = async (steps,start=plan.start) => save(rebuildRcaPlan({...plan,start,steps}));
  const perform = async task => {
    try { await task(); } catch(error) { window.alert(error.message); }
  };
  panel.append(rcaButton('Изменить начало',()=>rcaEditor('Начало плана',[
    ['Дата начала','start',plan.start,{type:'date',required:true}]
  ],values=>update(plan.steps,values.start))));
  if (validRcaDay(item.dueDate)) panel.append(rcaButton('Начать план со срока мероприятия',
    ()=>void perform(()=>update(plan.steps,item.dueDate))));
  const table = rcaElement('table');
  const head = rcaElement('thead');
  const header = rcaElement('tr');
  for(const caption of ['№','Шаг','Дни','Начало план','Конец план','Начало факт','Конец факт',
    'Ответственный','Контрольный результат','Примечание / отчёт','Статус','Действия']) {
    const cell = rcaElement('th',caption);
    cell.scope = 'col';
    header.append(cell);
  }
  head.append(header);
  const body = rcaElement('tbody');
  function edit(index, insert) {
    const step = insert ? {durationDays:0,status:'planned'} : plan.steps[index];
    rcaEditor(insert?'Добавить шаг':'Редактировать шаг',[
      ['Название','title',step.title,{required:true}],['Календарных дней','durationDays',step.durationDays,{type:'number',required:true}],
      ['Начало факт','actualStart',step.actualStart,{type:'date'}],['Конец факт','actualEnd',step.actualEnd,{type:'date'}],
      ['Ответственный','assignee',step.assignee],['Контрольный результат','result',step.result,{long:true}],
      ['Примечание','note',step.note,{long:true}],['Отчёт','report',step.report,{long:true}],
      ['Статус','status',step.status,{choices:RCA_ACTION_STATUSES}]
    ],values=>{
      const steps = [...plan.steps];
      steps.splice(index,insert?0:1,{id:crypto.randomUUID(),templateStepId:null,...step,...values,
        title:values.title.trim(),durationDays:Number(values.durationDays)});
      return update(steps);
    });
  }
  plan.steps.forEach((step,index)=>{
    const row = rcaElement('tr');
    for(const value of [index+1,step.title,step.durationDays,step.plannedStart,step.plannedEnd,step.actualStart,
      step.actualEnd,step.assignee,step.result,[step.note,step.report].filter(Boolean).join('\n'),RCA_ACTION_STATUSES[step.status]]) {
      row.append(rcaElement('td',String(value ?? '')));
    }
    const controls = rcaElement('td');
    for(const [offset,label] of [[-1,'Выше'],[1,'Ниже']]) {
      const button = rcaButton(label,()=>void perform(()=>{
        const steps = [...plan.steps];
        [steps[index],steps[index+offset]] = [steps[index+offset],steps[index]];
        return update(steps);
      }));
      button.disabled = !plan.steps[index+offset];
      controls.append(button);
    }
    controls.append(rcaButton('Редактировать',()=>edit(index,false)),
      rcaButton('Вставить ниже',()=>edit(index+1,true)),
      rcaButton('Удалить',()=>{ if(window.confirm('Удалить шаг плана?')) void perform(()=>update(plan.steps.filter(entry=>entry.id!==step.id))); }));
    row.append(controls);
    body.append(row);
  });
  table.append(head,body);
  const scroll = rcaElement('div','','rca-plan-table');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Шаги типового плана');
  scroll.append(table);
  panel.append(scroll,rcaButton('Добавить шаг',()=>edit(plan.steps.length,true)));
  return panel;
}
