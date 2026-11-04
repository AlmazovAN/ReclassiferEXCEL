// PR-6: single declarative onboarding surface for simple COUNT/SUM/RATIO KPIs.
// No eval, dynamic SQL, DOM, input Dataset access or approval of a methodology.
// Future KPI registration: add exactly one object to REGISTERED. Nothing is
// activated in the production catalog until a reviewed object is present.
(() => {
  'use strict';
  const common=globalThis.ReclassifierKpiCalculatorCommon;
  if(!common?.selectRows||!common?.result||!common?.percent)
    throw new Error('Declarative KPI registration requires Calculator Common.');
  const SOURCE_REGISTRY=Object.freeze({
    labor:Object.freeze({
      family:'labor',datasetId:'mobile_brigade_data',tableId:'mobile_brigade_labor',
      baseKpi:'total_labor',sourceComponent:'mobile_brigade_labor',
      filters:Object.freeze({mine:'site',equipmentClass:'equipmentClass',
        equipmentType:'equipmentType',equipmentName:'equipmentName'}),
      allowedFields:Object.freeze(['taskCount','laborHours','usableLaborTaskCount',
        'unusableLaborTaskCount','zeroLaborTaskCount']),
      whereFields:Object.freeze(['finalTaskType']),
      safePeriod:'factDate'
    }),
    sla:Object.freeze({
      family:'sla',datasetId:'itsm_data',tableId:'sla',
      baseKpi:'sla',sourceComponent:'sla',
      filters:Object.freeze({branch:'branch',mine:'mine',
        equipmentClass:'equipmentClass',equipmentType:'equipmentType',
        equipmentName:'equipmentName'}),
      allowedFields:Object.freeze(['slaSuccessCount','slaOverdueCount','slaTotalCount']),
      whereFields:Object.freeze([]),safePeriod:'closedAt'
    })
  });
  // Reviewed KPI Definition V2 configurations will be added here in PR-7.
  // PR-7: pilot management METRIC (methodology draft), not an approved
  // corporate KPI. All semantics use already validated MB prepared fields.
  const REGISTERED=Object.freeze([{
    id:'avr_task_count',
    title:'Количество задач АВР',
    fullTitle:'Количество зарегистрированных задач аварийно-восстановительных работ',
    category:'labor',kind:'count',source:'labor',unit:'шт.',
    direction:'neutral',formulaVersion:'1.0.0',
    definition:'Количество записей задач ИС «Мобильные бригады» с итоговым видом работы «АВР» и определённой датой фактического выполнения за выбранный период.',
    purpose:'Контроль числа зарегистрированных задач АВР по месяцам, рудникам и оборудованию; сопоставление количества задач с трудоёмкостью АВР без смешения единиц измерения.',
    limitation:'Методика — черновик, показатель не утверждён. Учитываются записи задач МБ, а не уникальные обращения ITSM или физические отказы. Месяц определяется по factDate. Строки без действительной даты исключаются; без итогового типа «АВР» в числитель не входят. Непригодные или нулевые трудозатраты не исключают задачу из счётчика. Дублирующиеся записи источника автоматически не объединяются. При отсутствии строк подготовленного источника результат недоступен, при наличии других задач, но отсутствии АВР — 0.',
    components:[
      {key:'avrTaskCount',label:'Количество задач АВР',unit:'шт.',
        role:'primary',field:'taskCount',where:{finalTaskType:['АВР']}},
      {key:'avrUsableTaskCount',label:'АВР с пригодной трудоёмкостью',unit:'шт.',
        role:'context',field:'usableLaborTaskCount',where:{finalTaskType:['АВР']}},
      {key:'avrUnusableTaskCount',label:'АВР без пригодной трудоёмкости',unit:'шт.',
        role:'context',field:'unusableLaborTaskCount',where:{finalTaskType:['АВР']}}
    ]
  }]);

  function deepFreeze(value) {
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(deepFreeze);
      Object.freeze(value);
    }
    return value;
  }
  function createRegistry(configs=REGISTERED) {
    if(!Array.isArray(configs))throw new Error('KPI registrations must be an array.');
    const byId=new Map();
    const categories=['dataQuality','technicalReliability','organizationalReadiness',
      'labor','problemManagement'];
    const VALID_ID=/^[a-z][a-z0-9_]{2,79}$/;
    const plainString=(x,max=400)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
    function normalizedComponent(source,c,index,kind) {
      if(!c||!/^[a-z][A-Za-z0-9_]{2,79}$/.test(c.key||'')||
         !plainString(c.label,120)||!plainString(c.unit,32)||
         !source.allowedFields.includes(c.field)||
         !['numerator','denominator','primary','context'].includes(c.role))
        throw new Error('Invalid KPI component declaration');
      if(c.where!==undefined&&
         (typeof c.where!=='object'||!c.where||
          Object.keys(c.where).some(k=>!source.whereFields.includes(k))||
          Object.values(c.where).some(v=>!Array.isArray(v)||!v.length||
            v.some(t=>!plainString(t,120)))))
        throw new Error('Unsafe or unsupported KPI subset');
      const role=kind==='ratio'?(index===0?'numerator':'denominator'):
        index===0?'primary':'context';
      if(c.role!==role)throw new Error('Incorrect component role');
      return {key:c.key,label:c.label,unit:c.unit,field:c.field,role,
        where:c.where?Object.fromEntries(Object.entries(c.where)
          .map(([k,v])=>[k,[...v]])):null};
    }
    for(const config of configs){
      if(!config||!VALID_ID.test(config.id||'')||byId.has(config.id)||
         !categories.includes(config.category)||
         !['count','sum','ratio'].includes(config.kind)||
         !plainString(config.title,140)||!plainString(config.unit,32)||
         !plainString(config.definition,2000)||!plainString(config.purpose,1500)||
         !['neutral','higher-is-better','lower-is-better'].includes(config.direction)||
         !SOURCE_REGISTRY[config.source]||
         !Array.isArray(config.components))
        throw new Error('Invalid/duplicate declarative KPI registration');
      const source=SOURCE_REGISTRY[config.source];
      const components=config.components.map((c,i)=>normalizedComponent(source,c,i,config.kind));
      if((config.kind==='ratio'&&components.length!==2)||
         (config.kind!=='ratio'&&(components.length<1||components.length>8))||
         new Set(components.map(c=>c.key)).size!==components.length||
         (config.kind==='count'&&(!components[0].field.endsWith('Count')||
           config.unit!=='шт.'))||
         (config.kind==='ratio'&&config.unit!=='%')||
         (config.kind==='sum'&&config.unit!=='чел.-ч'))
        throw new Error('Unsupported declarative KPI formula');
      // Prepared tables already aggregate records. COUNT is the SUM of an
      // explicitly approved prepared *Count field*, never rows.length.
      const formula=config.kind==='ratio'?
        components[0].key+' / '+components[1].key+' × 100':
        'Σ '+components[0].key;
      const entry={
        id:config.id,title:config.title,fullTitle:config.fullTitle||config.title,
        category:config.category,definition:config.definition,purpose:config.purpose,
        limitation:config.limitation||'Черновая методика. Учитываются только пригодные подготовленные данные.',
        unit:config.unit,direction:config.direction,kind:config.kind,
        source:config.source,sourceConfig:source,components,
        formula,formulaVersion:config.formulaVersion||'1.0.0',
        calculationState:'implemented',visibleInReport:true,
        // Historical forecast only until reporting-coverage contracts for
        // new KPI families are tested in the follow-up implementation.
        forecastPolicy:'historical-next-month'
      };
      if(!/^\d+\.\d+\.\d+$/.test(entry.formulaVersion))
        throw new Error('Invalid KPI formula version');
      byId.set(entry.id,deepFreeze(entry));
    }
    const definitions=Object.freeze(Array.from(byId.values()));
    function get(id){return byId.get(String(id||''))||null;}
    function calculatorFormula(id) {
      const d=get(id);
      if(!d)return null;
      return deepFreeze({
        id:d.id,title:d.title,unit:d.unit,formula:d.formula,
        formulaVersion:d.formulaVersion,methodologyStatus:'draft',
        sourceComponents:[d.sourceConfig.sourceComponent]
      });
    }
    function calculate(id,families={},query={}) {
      const d=get(id);
      if(!d)throw new Error('Unregistered declarative KPI: '+id);
      const definition=calculatorFormula(id),source=d.sourceConfig;
      if(!families[source.family]||!Array.isArray(families[source.family].rows))
        return common.unavailable(definition,query,'source-not-loaded');
      const selection=common.selectRows(families[source.family],query,source.filters);
      if(selection.error)return common.unavailable(definition,query,selection.error,{
        diagnostics:{unsupportedFilters:selection.unsupportedFilters}});
      const components={};
      const matchingRows=component=>selection.rows.filter(row=>!component.where||
        Object.entries(component.where).every(([field,accepted])=>
          accepted.some(val=>common.key(row?.[field])===common.key(val))));
      const fieldTotal=component=>{
        const matching=matchingRows(component);
        if(component.where&&query.audit?.subset){
          const [field,acceptedTypes]=Object.entries(component.where)[0]||[];
          query.audit.subset({
            tableId:source.tableId,field,
            componentKey:component.key,
            acceptedTypes:[...(acceptedTypes||[])],
            inputRows:selection.rows.length,
            outputRows:matching.length,
            excludedRows:selection.rows.length-matching.length,
            sumField:component.field,
            sumValue:common.sum(matching,component.field)
          });
        }
        return common.sum(matching,component.field);
      };
      for(const component of d.components)
        components[component.key]=fieldTotal(component);
      if(!selection.rows.length)return common.unavailable(definition,query,'no-source-rows',{
        dataState:'no-data',components});
      // For labor SUM, unusable rows must not be silently interpreted as
      // valid zero hours. Partial usable rows keep the real measured sum.
      if(d.kind==='sum'&&d.components[0].field==='laborHours' &&
         common.sum(matchingRows(d.components[0]),'usableLaborTaskCount')===0)
        return common.unavailable(definition,query,'no-usable-labor',{
          dataState:'no-data',components});
      if(d.kind==='ratio'&&components[d.components[1].key]===0)
        return common.unavailable(definition,query,'zero-denominator',{
          dataState:'no-data',components});
      const value=d.kind==='ratio'
        ?common.percent(components[d.components[0].key],components[d.components[1].key]).value
        :components[d.components[0].key];
      return common.result(definition,{
        value,query:selection.query,components,
        diagnostics:{sourceFamily:source.family,selectedRows:selection.rows.length}
      });
    }
    return Object.freeze({
      version:'1.0.0',definitions,get,calculatorFormula,calculate,
      sourceRegistry:SOURCE_REGISTRY
    });
  }
  const api=createRegistry();
  globalThis.ReclassifierKpiDeclarative=Object.freeze({
    ...api,createRegistry
  });
  if(typeof module!=='undefined'&&module.exports)
    module.exports=globalThis.ReclassifierKpiDeclarative;
})();
