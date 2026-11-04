// Reader-oriented, OFFLINE mathematical typography and illustrative examples for KPI passports.
// Strictly presentation metadata: Calculator is the ONLY source of actual KPI values.
// Every symbolic layout is guarded by its exact existing Calculation Contract formula.
(() => {
  'use strict';
  const catalog=globalThis.ReclassifierKpiCatalog;
  if (!catalog?.getCalculation) throw new Error('KPI Passport Math requires KPI Catalog.');

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
  const symbol=(base,sub=null,meaning='')=>Object.freeze({base,sub,meaning});
  const S=Object.freeze({
    vbr:symbol('ВБР'),
    failures:symbol('N','отказов','Количество учтённых отказов за отчётный месяц или выбранный диапазон месяцев.'),
    equipment:symbol('N','оборудования','Численность оборудования по Drivers, шт., на выбранный состав рудников и оборудования.'),
    reportMonths:symbol('M',null,'Количество отчётных месяцев с наблюдениями ITSM за выбранный диапазон.'),
    ktg:symbol('КТГ'),
    calendar:symbol('КФРВ',null,'Календарный фонд рабочего времени: число единиц оборудования из Drivers × 24 часа × календарные дни.'),
    incident:symbol('T','INC','Продолжительность обращений INC после реклассификации, независимо от поля типа работ.'),
    actualTo:symbol('T','ТО.факт','Фактическая продолжительность планового ТО по ITSM.'),
    outsideTo:symbol('T','ТО.вн','Продолжительность внепланового ТО по ITSM.'),
    other:symbol('T','проч','Продолжительность прочих работ, включая неопределённые типы работ. Монтажи и консультации исключены.'),

    planTo:symbol('T','ТО план','Допущение: плановые часы ТО равны фактическим часам ТО по графику.'),
    sla:symbol('SLA'),
    slaGood:symbol('N','вовремя','Количество обращений с известным SLA, разрешённых без просрочки.'),
    slaTotal:symbol('N','SLA','Всего обращений с известным SLA в выбранном периоде.'),
    classification:symbol('K','кл'),
    classificationCgps:symbol('K','ЦГПС'),
    classificationA:symbol('A',null,'Количество обращений «INC без изм»: положительный результат инженерной проверки классификации.'),
    classificationB:symbol('B',null,'Количество обращений «INC с исправлением»: классификация исправлена.'),
    classificationC:symbol('C',null,'Количество обращений «INC не классифицирован»: классификация не установлена.'),
    classificationD:symbol('D',null,'Количество обращений «RITM вместо INC»: выбран неверный тип обращения.'),
    classificationMbA:symbol('A','МБ','«INC без изм» с подтверждённым номером заявки в актуальных Мобильных бригадах.'),
    classificationMbB:symbol('B','МБ','«INC с исправлением» с подтверждённой связью с МБ, независимо от группы инициаторов.'),
    classificationMbC:symbol('C','МБ','«INC не классифицирован» с подтверждённой связью с МБ, независимо от группы инициаторов.'),
    classificationMbD:symbol('D','ЦГПС,МБ','«RITM вместо INC» с подтверждённой связью с МБ и расчётной группой инициаторов «ЦГПС».'),
    laborTotal:symbol('L','общ'),
    laborAvr:symbol('L','АВР'),
    laborMaintenance:symbol('L','ТО'),
    laborCorrective:symbol('L','кор'),
    laborLinked:symbol('L','PRB'),
    laborHour:symbol('h','i','Пригодные к расчёту трудозатраты i-й задачи МБ, чел.-ч.'),
    laborShareAvr:symbol('D','АВР'),
    laborShareReactive:symbol('D','реакт'),
    laborShareLinked:symbol('D','PRB'),
    taskLinked:symbol('N','связ','Число задач МБ с однозначной связью с ИТ-проблемой.'),
    taskTotal:symbol('N','задач','Число всех задач МБ выбранного периода.'),
    uniqueProblems:symbol('N','проблем','Количество различных кодов ИТ-проблем среди однозначных связей.')
  });
  const labors={
    total_labor:[S.laborTotal,'Σ LaborHours'],
    avr_labor:[S.laborAvr,'Σ LaborHours, FinalTaskType = АВР'],
    maintenance_labor:[S.laborMaintenance,'Σ LaborHours, FinalTaskType ∈ {ТО по графику, ТО вне графика}'],
    corrective_labor:[S.laborCorrective,'Σ LaborHours, FinalTaskType = Корректирующее воздействие'],
    problem_coverage_absolute:[S.laborLinked,'Σ LinkedLaborHours']
  };
  const specs={
    vbr:{
      signature:'(1 - FailureCount / EquipmentCount) × 100',
      kind:'vbr-exposure',left:S.vbr,a:S.failures,b:S.equipment,c:S.reportMonths,
      intro:'За три месяца зарегистрировано 10, 5 и 5 отказов. Численность оборудования по Drivers — 100 единиц.',
      example:[10,5,5,100,3,'93,33'],
      periodExplanation:'За M месяцев с наблюдениями ITSM фонд наблюдения равен численности оборудования Drivers, умноженной на M (ед.·мес.). Отказы суммируются по тем же месяцам, включая повторные, а месячные значения ВБР не усредняются. Для объединения рудников и классов сначала суммируются численность и отказы выбранных групп. Месяцы без наблюдений ITSM исключаются из M, а расчёт помечается как неполный. Численность Drivers фиксирована на весь рассматриваемый период.',
      limitation:'При повторных отказах одной единицы число отказов не равно числу отказавших единиц. Это расчётная относительная оценка, а не строгая индивидуальная вероятность.'
    },
    ktg:{
      signature:'(CalendarHours - IncidentHours - ActualMaintenanceHours - UnplannedMaintenanceHours - OtherHours) / (CalendarHours - PlannedMaintenanceHours) × 100',
      kind:'ktg',left:S.ktg,a:S.calendar,b:S.incident,c:S.actualTo,d:S.outsideTo,e:S.other,f:S.planTo,
      intro:'КФРВ 12 000 ч; INC 1 472 ч; плановое ТО факт 453 ч; внеплановое ТО и прочее 0 ч. ТО план временно принят равным фактическому плановому ТО: 453 ч.',
      example:[12000,1472,453,0,0,453,'87,25'],
      downtimeExplanation:'INC + TТО.факт + TТО.вн + Tпроч. Если «INC после рекласс» = INC, это обращение всегда относится только к INC, включая обращения с типом работ «Монтаж» или без типа работ. Для не-INC исключаются монтажи, «ПО доступ» и консультации. Фактическая продолжительность берётся из «Время предбэклога (откр-выполн), час» ITSM. ТО план в знаменателе временно равно ТО факт (плановое); отдельный нормативный график ещё не подключён.',
      limitation:'Расчётная оценка: предбэклог измеряет время обращения, а не обязательно реальную техническую недоступность. Для многомесячных периодов учитывается месяц создания обращения; распределение часов по календарным дням не выполняется. Количество оборудования берётся из текущего справочника Drivers; история парка и нормативные часы планового ТО пока отсутствуют.'
    },
    sla:{
      signature:'SlaSuccessCount / SlaTotalCount × 100',
      kind:'percent',left:S.sla,a:S.slaGood,b:S.slaTotal,
      intro:'9 обращений без просрочки из 10 обращений с известным SLA.',
      example:[9,10,90]
    },
    classification_quality:{
      signature:'A / (A + B + C + D) × 100',
      kind:'classification-four',left:S.classification,
      a:S.classificationA,b:S.classificationB,c:S.classificationC,d:S.classificationD,
      intro:'Из 100 обращений ITSM Сириус: 90 «INC без изм», 0 «INC с исправлением», 0 «INC не классифицирован», 10 «RITM вместо INC». Результат — 90%.',
      example:[90,0,0,10,90],
      scope:'Все четыре категории A/B/C/D независимо от инициатора и наличия в Мобильных бригадах. «RITM без изм» не входит в знаменатель.',
      periodExplanation:'Месяц определяется датой выполнения обращения, если её нет или она непригодна — датой закрытия. За диапазон месяцев сначала суммируются A, B, C и D и только затем применяется формула; усреднение месячных процентов не используется.',
      limitation:'Показатель рассчитывается по существующей разметке инженерной проверки, а не по автоматическому анализу смыслового содержания текста обращения.'
    },
    classification_quality_cgps:{
      signature:'A_MB / (A_MB + B_MB + C_MB + D_CGPS_MB) × 100',
      kind:'classification-four',left:S.classificationCgps,
      a:S.classificationMbA,b:S.classificationMbB,c:S.classificationMbC,d:S.classificationMbD,
      intro:'Из 100 обращений с подтверждённой связью с МБ: 90 «INC без изм», 5 «RITM вместо INC» группы ЦГПС и 5 «RITM вместо INC» других инициаторов; последние пять не входят в данный показатель.',
      example:[90,0,0,5,'94,74'],
      scope:'В данный показатель включаются только обращения с подтверждённой связью с актуальным Dataset МБ в рамках деятельности ЦГПС. A/B/C — при любой группе инициаторов; D — только при группе «ЦГПС». Наличие в МБ проверяется по номеру обращения, не по оборудованию и не по автору открытия.',
      periodExplanation:'Дата выполнения имеет приоритет над датой закрытия. При объединении месяцев сначала суммируются A, B, C и D. Много задач МБ по одному номеру обращения не увеличивает счётчик.',
      limitation:'«Нет в МБ» — номер не найден в загруженном Dataset МБ, обращение исключается вне зависимости от дат. «Нет данных МБ» — Dataset отсутствует или недоступен: итог не публикуется. Пустой номер ITSM исключается отдельно. Неустановленная группа инициаторов для ошибочного RITM не считается ЦГПС. Неполная выгрузка МБ может повлиять на полноту выборки. Сама формула не выполняет автоматическую проверку текста и не устанавливает личную ответственность за каждую запись.'
    },
    avr_share:{
      signature:'AvrLaborHours / TotalLaborHours × 100',
      kind:'percent',left:S.laborShareAvr,
      a:{...S.laborAvr,meaning:'Пригодные трудозатраты задач МБ по виду «АВР».'},
      b:{...S.laborTotal,meaning:'Все пригодные трудозатраты задач МБ выбранного среза.'},
      intro:'40 чел.-ч АВР из 100 чел.-ч пригодной трудоёмкости.',
      example:[40,100,40]
    },
    reactive_share:{
      signature:'(AvrLaborHours + CorrectiveLaborHours) / TotalLaborHours × 100',
      kind:'percent-add',left:S.laborShareReactive,
      a:{...S.laborAvr,meaning:'Пригодные трудозатраты АВР.'},
      b:{...S.laborCorrective,meaning:'Пригодные трудозатраты корректирующих воздействий.'},
      c:{...S.laborTotal,meaning:'Все пригодные трудозатраты МБ.'},
      intro:'40 чел.-ч АВР, 10 чел.-ч корректирующих воздействий и 100 чел.-ч всего.',
      example:[40,10,100,50]
    },
    problem_linked_tasks:{
      signature:'Σ LinkedTaskCount',
      kind:'sum-task',left:S.taskLinked,a:S.taskLinked,
      intro:'В двух группах задач зарегистрировано 6 и 2 задачи с однозначными связями; итог 8 задач.',
      example:[6,2,8],
      scope:'Все связанные задачи МБ, включая записи без пригодных человеко-часов. Неоднозначные и не найденные связи исключены.'
    },
    problem_task_coverage:{
      signature:'LinkedTaskCount / TaskCount × 100',
      kind:'percent',left:symbol('D','задач'),
      a:S.taskLinked,b:S.taskTotal,
      intro:'8 связанных задач из 15 зарегистрированных задач выбранного периода.',
      example:[8,15,'53,33'],
      scope:'Число задач МБ, а не сумма трудозатрат. Знаменатель включает задачи без пригодных часов.'
    },
    problem_active_count:{
      signature:'COUNT_DISTINCT(ProblemId WHERE ProblemLinkState = linked)',
      kind:'distinct',left:S.uniqueProblems,a:S.uniqueProblems,
      intro:'Задачи связаны с PRB001047, PRB001047 и PRB001048; различных кодов две.',
      example:[3,2,2],
      scope:'Коды ИТ-проблем, по которым есть однозначно связанные задачи МБ. Один код учитывается один раз за весь период.'
    },
    problem_coverage_relative:{
      signature:'LinkedLaborHours / LaborHours × 100',
      kind:'percent',left:S.laborShareLinked,
      a:{...S.laborLinked,meaning:'Пригодные трудозатраты МБ с однозначной связью с PRB.'},
      b:{...S.laborTotal,meaning:'Всего пригодных трудозатрат МБ в том же срезе.'},
      intro:'30 чел.-ч связано с PRB из общего объёма 100 чел.-ч.',
      example:[30,100,30]
    }
  };
  const sumMeaning={
    total_labor:'Все пригодные задачи МБ выбранного среза.',
    avr_labor:'Только пригодные задачи с итоговым видом «АВР».',
    maintenance_labor:'Только пригодные задачи «ТО по графику» и «ТО вне графика».',
    corrective_labor:'Только пригодные задачи «Корректирующее воздействие».',
    problem_coverage_absolute:'Только пригодная трудоёмкость задач с однозначной связью с PRB.'
  };
  for (const [id,[left,signature]] of Object.entries(labors)){
    specs[id]={
      signature,kind:'sum',left,a:{...S.laborHour,meaning:S.laborHour.meaning},
      intro:'Две учтённые в соответствующем срезе записи: 4 и 6 чел.-ч.',
      example:[4,6,10],
      scope:sumMeaning[id]
    };
  }

  function mi(v){return '<mi>'+esc(v)+'</mi>';}
  function mn(v){return '<mn>'+esc(v)+'</mn>';}
  function mo(v){return '<mo>'+esc(v)+'</mo>';}
  function mtext(v){return '<mtext>'+esc(v)+'</mtext>';}
  function mrow(...values){return '<mrow>'+values.join('')+'</mrow>';}
  function subs(v){return v.sub?'<msub>'+mi(v.base)+mtext(v.sub)+'</msub>':mi(v.base);}
  function fraction(numerator,denominator){return '<mfrac>'+mrow(numerator)+mrow(denominator)+'</mfrac>';}
  function grouped(expression){return mrow(mo('('),expression,mo(')'));}
  const percentage=()=>mrow(mo('×'),mn(100),mo('%'));
  function formulaExpression(spec){
    if(spec.kind==='ktg')return mrow(fraction(mrow(subs(spec.a),mo('−'),
      grouped(mrow(subs(spec.b),mo('+'),subs(spec.c),mo('+'),subs(spec.d),mo('+'),subs(spec.e)))),
      mrow(subs(spec.a),mo('−'),subs(spec.f))),percentage());
    if(spec.kind==='vbr-exposure')return mrow(mo('('),mn(1),mo('−'),fraction(subs(spec.a),mrow(subs(spec.b),mo('×'),subs(spec.c))),mo(')'),percentage());
    if(spec.kind==='one-minus-ratio')return mrow(mo('('),mn(1),mo('−'),fraction(subs(spec.a),subs(spec.b)),mo(')'),percentage());
    if(spec.kind==='classification-four')return mrow(fraction(subs(spec.a),
      mrow(subs(spec.a),mo('+'),subs(spec.b),mo('+'),subs(spec.c),mo('+'),subs(spec.d))),percentage());
    if(spec.kind==='percent')return mrow(fraction(subs(spec.a),subs(spec.b)),percentage());
    if(spec.kind==='percent-add')return mrow(fraction(grouped(mrow(subs(spec.a),mo('+'),subs(spec.b))),subs(spec.c)),percentage());
    if(spec.kind==='distinct')return mrow(mi('COUNT_DISTINCT'),mo('('),mi('PRB'),mo(')'));
    return mrow(mo('∑'),subs(spec.a));
  }
  function sampleExpression(spec) {
    const values=spec.example;
    if(spec.kind==='ktg')return mrow(fraction(
      mrow(mn(values[0]),mo('−'),grouped(mrow(mn(values[1]),mo('+'),mn(values[2]),mo('+'),mn(values[3]),mo('+'),mn(values[4])))),
      mrow(mn(values[0]),mo('−'),mn(values[5]))),percentage(),mo('≈'),mn(values[6]),mo('%'));
    if(spec.kind==='vbr-exposure')return mrow(mo('('),mn(1),mo('−'),fraction(mrow(mn(values[0]),mo('+'),mn(values[1]),mo('+'),mn(values[2])),mrow(mn(values[3]),mo('×'),mn(values[4]))),mo(')'),percentage(),mo('≈'),mn(values[5]),mo('%'));
    if(spec.kind==='one-minus-ratio')return mrow(mo('('),mn(1),mo('−'),fraction(mn(values[0]),mn(values[1])),mo(')'),percentage(),mo('='),mn(values[2]),mo('%'));
    if(spec.kind==='classification-four')return mrow(fraction(mn(values[0]),
      mrow(mn(values[0]),mo('+'),mn(values[1]),mo('+'),mn(values[2]),mo('+'),mn(values[3]))),
      percentage(),mo('≈'),mn(values[4]),mo('%'));
    if(spec.kind==='percent')return mrow(fraction(mn(values[0]),mn(values[1])),percentage(),mo('='),mn(values[2]),mo('%'));
    if(spec.kind==='percent-add')return mrow(fraction(grouped(mrow(mn(values[0]),mo('+'),mn(values[1]))),mn(values[2])),percentage(),mo('='),mn(values[3]),mo('%'));
    if(spec.kind==='sum-task')return mrow(mn(values[0]),mo('+'),mn(values[1]),mo('='),mn(values[2]),mtext(' задач'));
    if(spec.kind==='distinct')return mrow(mn(values[0]),mtext(' связей'),mo('→'),mn(values[2]),mtext(' уникальных проблем'));
    return mrow(mn(values[0]),mo('+'),mn(values[1]),mo('='),mn(values[2]),mtext(' чел.-ч'));
  }
  function math(body,spoken,mode='block'){
    // All XML sub-elements are emitted from fixed constructors; human text is escaped.
    return '<math xmlns="http://www.w3.org/1998/Math/MathML" display="'+mode+
      '" aria-label="'+esc(spoken)+'">'+mrow(body)+'</math>';
  }
  function variables(spec){
    const terms=[spec.a,spec.b,spec.c,spec.d,spec.e,spec.f].filter(Boolean);
    const used=new Set();
    return terms.filter(v=>{
      const key=v.base+':'+(v.sub||'');if(used.has(key))return false;used.add(key);return true;
    });
  }
  function render(kpiId) {
    const contract=catalog.getCalculation(kpiId);
    if(!contract)return '<p class="kpi-passport-empty">Для этого KPI расчётная формула пока не подключена; пример не приводится.</p>';
    const spec=specs[kpiId];
    const declared=globalThis.ReclassifierKpiDeclarative?.get?.(kpiId);
    if(declared&&!spec){
      const items=declared.components.map(component=>
        '<li><strong>'+esc(component.label)+'</strong> ('+esc(component.key)+
        ') — '+esc(component.unit)+(component.where?
        '; отбор: '+esc(JSON.stringify(component.where)):'')+'</li>').join('');
      return '<div class="kpi-passport-math-document">'+
        '<p><strong>Формула:</strong> <code>'+esc(contract.formula.expression)+'</code></p>'+
        '<div class="kpi-passport-math-where"><strong>Расчётные компоненты:</strong><ul>'+
        items+'</ul></div><p class="kpi-passport-math-scope">'+
        'Данные подготовленного источника суммируются за выбранные месяцы. '+
        'Для отношения сначала суммируются числитель и знаменатель, затем рассчитывается процент. '+
        'Искусственные примеры и неподтверждённые значения не используются.</p></div>';
    }
    if(!spec||spec.signature!==contract.formula.expression)
      return '<p class="kpi-passport-caution">Математическое представление требует сверки с текущей версией формулы Calculator. Иллюстрация отключена во избежание расхождений.</p>';
    const formula=math(mrow(subs(spec.left),mo('='),formulaExpression(spec)),contract.formula.expression);
    const example=math(mrow(subs(spec.left),mo('='),sampleExpression(spec)),'Иллюстративный пример расчёта');
    const glossary=variables(spec).map(variable=>
      '<li class="kpi-passport-math-definition"><span class="kpi-passport-math-symbol">'+
        math(subs(variable),variable.base+(variable.sub?' '+variable.sub:''),'inline')+
      '</span><span>— '+esc(variable.meaning||'Обозначение расчётного компонента')+'</span></li>'
    ).join('');
    return '<div class="kpi-passport-math-document">'+
      '<div class="kpi-passport-math-block">'+formula+'</div>'+
      '<div class="kpi-passport-math-where"><strong>Где:</strong><ul>'+glossary+'</ul></div>'+
      '<div class="kpi-passport-math-example"><strong>Пример расчёта</strong>'+
        '<p>'+esc(spec.intro)+'</p>'+
        '<div class="kpi-passport-math-block">'+example+'</div>'+
        '<small>Пример условный, не является значением из текущего отчёта.</small>'+
      '</div>'+
      (spec.scope?'<p class="kpi-passport-math-scope"><strong>Учитываются:</strong> '+esc(spec.scope)+'</p>':'')+
      (spec.downtimeExplanation?'<p class="kpi-passport-math-scope"><strong>Состав продолжительности работ:</strong> '+esc(spec.downtimeExplanation)+'</p>':'')+
      (spec.periodExplanation?'<p class="kpi-passport-math-scope"><strong>Многомесячный расчёт и фонд наблюдения:</strong> '+esc(spec.periodExplanation)+'</p>':'')+
      (spec.limitation?'<p class="kpi-passport-caution">'+esc(spec.limitation)+'</p>':'')+
    '</div>';
  }

  const api=Object.freeze({version:'1.0.0',ids:Object.freeze(Object.keys(specs)),render});
  globalThis.ReclassifierKpiPassportMath=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
