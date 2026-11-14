function validateRcaPlanLibrary(library) {
  if (library?.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(library.sourceHash) ||
      typeof library.fileName !== 'string' || !Array.isArray(library.templates) ||
      !library.templates.length || new Set(library.templates.map(item=>item?.id)).size !== library.templates.length ||
      library.templates.some(item=>!item?.id || !item.title || !Array.isArray(item.steps) || !item.steps.length ||
        item.steps.some(step=>!step?.id || !step.title || !Number.isSafeInteger(step.durationDays) || step.durationDays < 0))) {
    throw new Error('Некорректная библиотека типовых планов.');
  }
  return library;
}

function scheduleRcaPlan(start, steps) {
  if (!validRcaDay(start) || !Array.isArray(steps)) throw new Error('Укажите корректную дату начала плана.');
  const seen = new Map();
  const scheduled = steps.map(step => {
    if (!RCA_UUID.test(step.id) || seen.has(step.id) || !step.title?.trim() ||
        !Number.isSafeInteger(step.durationDays) || step.durationDays < 0 ||
        !Array.isArray(step.predecessorIds) || step.predecessorIds.some(id=>!seen.has(id)) ||
        [step.actualStart,step.actualEnd].some(day=>day && !validRcaDay(day)) ||
        (step.actualStart && step.actualEnd && step.actualStart > step.actualEnd)) {
      throw new Error('Проверьте шаги, даты, длительности и зависимости плана.');
    }
    const plannedStart = step.predecessorIds.reduce((day,id)=>seen.get(id)>day?seen.get(id):day,start);
    const end = new Date(Date.parse(plannedStart) + step.durationDays*86400000);
    const plannedEnd = Number.isFinite(+end) ? end.toISOString().slice(0,10) : '';
    if (!validRcaDay(plannedEnd)) throw new Error('Дата окончания шага вне допустимого диапазона.');
    seen.set(step.id,plannedEnd);
    return {...step,plannedStart,plannedEnd};
  });
  return {steps:scheduled,end:scheduled.reduce((day,step)=>step.plannedEnd>day?step.plannedEnd:day,start)};
}

function rebuildRcaPlan(plan) {
  const steps = plan.steps.map((step,index)=>({...step,sortOrder:index+1,
    predecessorIds:index ? [plan.steps[index-1].id] : []}));
  return {...plan,...scheduleRcaPlan(plan.start,steps)};
}

function createRcaPlan(template, library, start) {
  return rebuildRcaPlan({schemaVersion:1,start,sourceHash:library.sourceHash,template:structuredClone(template),
    steps:template.steps.map(({id,title,durationDays,result,participant,note})=>({
      id:crypto.randomUUID(),templateStepId:id,title,durationDays,result,participant,note,
      assignee:'',actualStart:'',actualEnd:'',report:'',status:'planned'
    }))});
}
