// FILE CONTRACT:
// Purpose: Conservative dependent-path classification with per-field evidence.
// Owns: Date eligibility, event chronology, failure gate, path choices and diagnostics.
// Reads: ITSM source fields and a snapshot of the active Failure Classifier.
// Writes: Pure results only; never modifies incoming rows or references.
// Public API: ReclassifierReclassificationRules.buildContext/evaluateRow.
// Must not: Read expert targets or infer a cause merely from a repair.
// Related tests: test_reclassification_rules.js, test_reclassification_worker_processor.js.
(() => {
  'use strict';
  const RULES_VERSION = '3.3.0';
  const STAGES = Object.freeze([
    '0. Проверка возможности разбора','1. Обычный RITM',
    '2. Проверка RITM на скрытый отказ','3. Проверка факта отказа INC',
    '4. Проверка оборудования','5. Проверка элемента',
    '6. Проверка неисправности','7. Проверка причины','8. Контроль полной ветки'
  ]);
  // Frozen full descriptions from the reviewed prototype. Inputs never train on expert answers.
  const ORDINARY_RITM_TEMPLATES = Object.freeze(["техническое обслуживание оборудования (то)/запросы на обслуживание по сприт/срп","техническое обслуживание оборудования (то)/запросы на обслуживание сприт/срп/идгр/стпп","другое/запросы на обслуживание сприт/срп/идгр/стпп","по: настройка\\изменение/запросы на обслуживание сприт/срп/идгр/стпп","работы по изменению системы: демонтаж существующих элементов системы и перемещение их на склад/запросы на обслуживание сприт/срп/идгр/стпп","работы по развитию системы: установка\\добавление новых элементов системы/запросы на обслуживание сприт/срп/идгр/стпп","работы по развитию системы: установка\\добавление новых элементов системы/запросы на обслуживание по сприт/срп","сервер: настройка\\обслуживание/запросы на обслуживание сприт/срп/идгр/стпп","работы по изменению системы: демонтаж существующих элементов системы и перемещение их на склад/запросы на обслуживание по сприт/срп","другое/запросы на обслуживание по сприт/срп","cвр протон: установка\\оснащение новой техники свр протон/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","работы по развитию системы: установка и добавление новых элементов/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","работы по изменению системы: перенос существующих элементов системы/запросы на обслуживание по сприт/срп","предоставление/изменение прав доступа к асу гр/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","установка по птк \"гд\" и управление правами доступа/запросы на обслуживание сприт/срп/идгр/стпп","замена жестких дисков (карт памяти) свр, передача оборудования заказчику/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","монтаж ранее демонтированных элементов системы/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","консультация/запросы на обслуживание сприт/срп/идгр/стпп","видеокамера: предоставить доступ к просмотру видеокамер, установка по revisor/запросы на обслуживание сприт/срп/идгр/стпп","демонтаж существующих элементов системы на (бвр)/запросы на обслуживание сприт/срп/идгр/стпп","работы по изменению системы: перенос существующих элементов системы/запросы на обслуживание сприт/срп/идгр/стпп","управление паролями в домене srp.local/предоставление доступа srp.local/запросы на обслуживание сприт/срп/идгр/стпп","видеокамера: предоставить доступ к просмотру видеокамер, установка по macroscop/запросы на обслуживание сприт/срп/идгр/стпп","установить по/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","радиотелефон: настроить\\обслужить/запросы на обслуживание сприт/срп/идгр/стпп","демонтаж существующих элементов системы и перемещение их на склад/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","агз: поверка\\демонтаж для поверки(ремонта)/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","создание заявок","консультация/запросы на обслуживание навесного оборудования, установленного на вшт, сдо (сприт/срп/идгр/асугр/спс(антинаезд))","настройка сетевых параметров оборудования инфраструктуры/запросы на обслуживание сприт/срп/идгр/стпп"]);
  const norm = value => String(value ?? '').toLocaleLowerCase('ru-RU').replace(/ё/g,'е')
    .replace(/[\u200b-\u200d\ufeff]/g,'').replace(/поврежл/g,'поврежд').replace(/концетр/g,'концентр').replace(/\s+/g,' ').trim();
  const text = value => String(value ?? '').replace(/\u00a0/g,' ').trim() || null;
  const key = path => JSON.stringify(path.map(norm));
  const sourcePath = row => [row.sourceEquipment,row.sourceElement,row.sourceFault,row.sourceReason].map(text);
  const DEFECT = /обрыв|оборван|перебит|перетерт|окис[а-я]*|корроз|сгорел|сгорев|коротк[а-я]* замыкан|попадани[а-я]* влаги|залит|трещин|поврежд[а-я]*|сломан|выш[а-я]* из строя|неисправ(?:ен|на|ны|ный|ная|ные)|(?:плох[а-я]*|слаб[а-я]*|потер[а-я]*) контакт|пробой изоляц|зависани|завис[а-я]* (?:по|процесс|программ)|сбой (?:по|программ)|программн[а-я]* (?:сбой|отказ)|внутренн[а-я]* отказ/;
  const NEGATIVE = /(?:отказ|неисправност[а-я]*|повреждени[а-я]*|обрыв[а-я]*|дефект[а-я]*)[^.!?\n]{0,35}(?:не (?:подтвержд|выявл|обнаруж|найден)|отсутств)|не (?:выявл|обнаруж|найден)[а-я]*[^.!?\n]{0,35}(?:отказ|неисправност|повреждени|обрыв|дефект)|не является отказом|ложн[а-я]* сработ/;
  const DENIAL = /отказ[^.!?\n]{0,25}не подтвержд|не является отказом/;
  const GLOBAL_NEGATIVE = /отказ[^.!?\n]{0,25}не подтвержд|не является отказом|неисправност[а-я]*[^.!?\n]{0,25}(?:не выявл|не обнаруж|отсутств)/;
  const REPAIR = /(?:устран[а-я]*|восстанов[а-я]*|перезачист[а-я]*|скрутк[а-я]*|перепа[а-я]*|переобж[а-я]*|зачищ[а-я]*|обжат[а-я]*)[^.!?\n]{0,85}(?:обрыв|кабел|провод|контакт|питан|разъем|сбой)|замен[а-я]*[^.!?\n]{0,60}(?:неисправн|поврежден|сгорев|сломан)|включени[а-я]*[^.!?\n]{0,30}автомат/;
  const SYMPTOM = /не работа|не включ|не (?:запис|пиш|переда|показыв)|(?:нет|отсутств[а-я]*) (?:внешнего )?(?:связи|питания|изображения)|работ[а-я]* от акб|завис|сбой|ошибк|авари|неисправ/;
  const COMPLETED_REPLACEMENT = /(?:замен(?:ен|ена|ено|ены|или)|(?:произведен[ао]|выполнен[ао]|произвели|выполнили) замен[ауы])[^.!?\n]{0,70}(?:кабел|провод|блок|камер|датчик|итс[ -]?2|предохранител|индикатор|антенн|разъем)/;
  const RESTORED_FUNCTION = /(?:питан[а-я]*|связь|изображени[а-я]*|работоспособност[а-я]*)[^.!?\n]{0,35}восстанов[а-я]*|восстанов[а-я]*[^.!?\n]{0,35}(?:питан[а-я]*|связь|изображени[а-я]*|работоспособност[а-я]*)/;
  const ORDINARY_PLANNED_REQUEST = /^(?:техническое обслуживание оборудования|предоставление(?:\/изменение)? прав доступа|управление паролями|консультация(?:\/|$)|установить по(?:\/|$))/;
  const PLANNED = /планов|поверк|калибровк|монтаж|дооснащ|^то(?:\s|\/|$)|техническ[а-я]* обслуж/;
  const SERVICE = /согласно|средств[а-я]* мониторинга|по данным мониторинга/;
  const PLACEHOLDER = /^(?:другое|отсутствует классификатор|не классифицирован[ао]?|нет данных)$/;
  const HISTORY = /ранее|раньше|давно|предыдущ|прошл[а-я]*|запасн[а-я]* (?:пар|волокон|волокн)|резервн[а-я]* (?:пар|волокон|волокн)/;
  const OBJECT_PATTERN = /(?:^|[^\p{L}\p{N}])((?:ис|wf|бкм|ббп|ок|а)\s*[№#]?\s*\d+(?:[.=-]\d+)*)/giu;
  const objectsIn = value => [...String(value??'').matchAll(OBJECT_PATTERN)].map(m=>norm(m[1]).replace(/[\s№#]/g,''));

  // Prefix indexes constrain every child to the selected parents.
  function buildContext(records, options = {}) {
    const paths = new Map(), children = new Map();
    for (const record of records || []) {
      if (record?.disabled === true || norm(record?.disabled) === 'да') continue;
      const path = Array.isArray(record) ? record.slice(0,4).map(text) :
        [record?.equipment,record?.element,record?.failure ?? record?.fault,record?.cause].map(text);
      if (path.length !== 4 || path.some(value => !value) || paths.has(key(path))) continue;
      paths.set(key(path),path);
      path.forEach((value,level) => {
        const prefix = key(path.slice(0,level));
        if (!children.has(prefix)) children.set(prefix,new Map());
        children.get(prefix).set(norm(value),value);
      });
    }
    const pathsByEquipment=new Map();
    for(const path of paths.values()) {
      const equipment=norm(path[0]);
      if(!pathsByEquipment.has(equipment))pathsByEquipment.set(equipment,[]);
      pathsByEquipment.get(equipment).push(path);
    }
    return {paths,children,pathsByEquipment,ordinaryRitm:new Set((options.ordinaryRitmTemplates ?? ORDINARY_RITM_TEMPLATES).map(norm))};
  }

  // Eligibility uses a separate analysis date and preserves the original completion field.
  function validDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value < 2958466 ? value : null;
    const raw = text(value);
    if (!raw) return null;
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/) || raw.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
    if (!match) return null;
    const iso = match[1].length === 4;
    const year = Number(iso ? match[1] : match[3]), month = Number(match[2]), day = Number(iso ? match[3] : match[1]);
    const date = new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear() === year && date.getUTCMonth()+1 === month && date.getUTCDate() === day ? value : null;
  }

  // Preserve the introductory note and order timestamped engineer comments chronologically.
  function evidenceUnits(row) {
    const units = [];
    function add(raw,source,order,initial=false) {
      const block=String(raw??'');
      let role='Сообщение';
      for (const clause of block.split(/[!?;\n]+|\.(?!\s*информация)(?=\s|$|[А-ЯЁ])|,\s*/i)) {
        const quote = clause.trim();
        const tag=quote.match(/^(Обнаружено|Выполнено|Доп\.\s*информация|Причина)\s*:/i);
        if(tag)role=tag[1];
        if (quote) units.push({quote,value:norm(quote),source,order,initial,role,block:norm(block),objects:objectsIn(quote)});
      }
    }
    add(row.shortDescription,'Краткое описание',-2,true);
    add(row.description,'Описание',-1,true);
    const raw = String(row.closureNote ?? '');
    const pattern = /\(?(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2}:\d{2})(?:[+-]\d{4})?\)?:?/g;
    const stamps = [...raw.matchAll(pattern)];
    if (!stamps.length) add(raw,'Примечания к разрешению',0);
    else {
      add(raw.slice(0,stamps[0].index),'Примечания к разрешению',0);
      stamps.map((s,i) => {
        const offset=s[0].match(/([+-])(\d{2})(\d{2})/),minutes=offset?(Number(offset[2])*60+Number(offset[3]))*(offset[1]==='+'?1:-1):0;
        return {key:Date.parse(s[3]+'-'+s[2]+'-'+s[1]+'T'+s[4]+'Z')-minutes*60000,raw:raw.slice(s.index+s[0].length,stamps[i+1]?.index ?? raw.length)};
      }).sort((a,b) => a.key-b.key)
        .forEach((message,i) => add(message.raw,'Примечания к разрешению',i+1));
    }
    // The standard ITSM stage has already appended this evidence to closureNote.
    // Preserve the separate-source fallback for callers that pass unmerged rows.
    const extra = String(row.extraReason ?? '').replace(/\u00a0/g, ' ').trim();
    if (extra && !norm(raw).includes(norm('Доп.информация по причине: ' + extra))) {
      add(extra,'Доп.информация по причине',stamps.length+2);
    }
    return units;
  }

  // A normal final state after a repair does not turn the event into NON_FAILURE.
  function failureGate(row,units) {
    const symptom = SYMPTOM.test(norm(row.description));
    const nonPlannedSymptom = symptom && !PLANNED.test(norm(row.shortDescription));
    const positives = [], negatives = [];
    for (const unit of units) {
      if (unit.initial) continue;
      const value = unit.value;
      const repaired = REPAIR.test(value) || nonPlannedSymptom && (COMPLETED_REPLACEMENT.test(value) || RESTORED_FUNCTION.test(value)) || nonPlannedSymptom &&
        /перезагруз|перезапуск|перезапущ|переустанов|откат|восстановлен[а-я]* работоспособност/.test(value);
      const inspectionOnly = /провер|осмотр|диагност/.test(value) && !/обнаруж|выявлен|устран|восстанов|замен|зафиксирован/.test(value);
      const surfaceTrace=/след[а-я]*[^.!?]{0,20}(?:окис|корроз)/.test(value);
      const confirmed = !NEGATIVE.test(value) && DEFECT.test(value) && !inspectionOnly && !HISTORY.test(value) && !surfaceTrace;
      if ((repaired || confirmed) && (!SERVICE.test(value) || repaired)) positives.push(unit);
      if (GLOBAL_NEGATIVE.test(value) && !repaired) negatives.push(unit);
    }
    if (positives.length) {
      const last = positives.at(-1), denied = negatives.filter(unit => DENIAL.test(unit.value)).at(-1);
      if (denied && (denied.order > last.order || denied.order === last.order && !positives.some(unit => REPAIR.test(unit.value)))) {
        return {state:'UNKNOWN',reason:'Отрицание отказа противоречит подтверждённому дефекту',units:[last,denied]};
      }
      return {state:'FAILURE',reason:'Подтверждён дефект или восстановление после нарушения функции',units:positives};
    }
    if (negatives.length) return {state:'NON_FAILURE',reason:'Отказ явно не подтверждён',units:negatives};
    return {state:'UNKNOWN',reason:'Нет однозначного подтверждения или отрицания отказа',units:[]};
  }

  const EQUIPMENT_ALIASES = [
    [/pitram|helper|trek/,'Бортовой комплект АСУГР Pitram'],
    [/вист|(?:^|[^a-z])vist(?:[^a-z]|$)|ipan/,'Бортовой комплект АСУГР ВИСТ'],
    [/proton|протон|свр|видеорегист/,'СВР (система видеорегистрации)'],
    [/агз|буикс|аэрогаз/,'АГЗ (аэрогазовая защита)'],
    [/антинаезд|урпт-ис-т/,'УРПТ-ИС-Т\\СПС']
  ];
  // Defect synonyms identify a node, not an unreported root cause.
  const CONCEPTS = {
    1:[
      [/датчик[^.!?]{0,35}(?:концент|концетр|газ|метан)|итс[ -]?2/,/датчик.*(?:концент|газ|метан)/],
      [/(?:нет|отсутств[а-я]*) внешн[а-я]* (?:электро)?питан|внешн[а-я]* (?:электро)?питан[^.!?]{0,30}восстанов/,/внешн[а-я]* цепь электропитан/],
      [/клемм|контакт[^.!?]{0,20}(?:клемм|питан)|клемм[^.!?]{0,20}контакт/,/клемм|контакт/],
      [/волс|оптическ[а-я]* (?:кабел|волок)|волокн|волокон/,/оптическ[а-я]* кабел|волокон|волс/],
      [/sd[ -]?(?:карт|card)|сд[ -]?карт/,/карт.*памят|sd|сд.*карт/],
      [/кабел|провод/,/кабел|провод|лини[яи] связи/],[/разъем|контакт/,/контакт|разъем|кабел/],
      [/камер/,/камер/],[/датчик скорости/,/датчик.*скорости/],[/датчик давления/,/датчик.*давления/],
      [/глубиномер/,/глубиномер/],[/инклинометр/,/инклинометр/],[/блок питания/,/блок питания/],
      [/акб|аккумулятор/,/акб|аккумулятор/],[/предохранител/,/предохранител/],[/антенн/,/антенн/],
      [/завис|программ|сбой по|перезапуск/,/программ|внутренн[а-я]* по|прошив/]
    ],
    2:[
      [/поврежд[а-я]*[^.!?]{0,40}(?:кабел|волс|лини)|(?:кабел|волс)[^.!?]{0,40}поврежд/,/повреждени[а-я]* (?:лини|кабел)/],
      [/обрыв|оборван|перебит/,/обрыв/],[/коротк[а-я]* замык/,/коротк[а-я]* замык/],
      [/плох[а-я]* контакт|слаб[а-я]* контакт|потер[а-я]* контакт|окисл|корроз|наруш[а-я]* контакт/,/контакт|соединени/],
      [/завис/,/завис/],[/сбой по|программ[а-я]* сбой/,/сбой|некоррект/]
    ],
    3:[
      [/окисл/,/окисл/],[/корроз/,/корроз/],[/попад[а-я]* влаг|залит|след[а-я]* влаг/,/влаг|залит/],
      [/слаб[а-я]* контакт/,/слаб[а-я]* контакт/],[/потер[а-я]* контакт/,/потер[а-я]* контакт/],
      [/взрывн[а-я]* работ|бвр/,/взрыв|бвр/],[/наезд/,/наезд/],[/горн[а-я]* масс/,/горн[а-я]* масс/],
      [/некачественн[а-я]* монтаж/,/некачественн[а-я]* монтаж/],
      [/причин[а-я]*[^.!?]{0,25}не установлен|причину[^.!?]{0,25}установить не удалось/,/причин[а-я]*[^.!?]{0,25}не установлен/],
      [/сбой по|сбой программного обеспечения/,/сбой по|сбой программного обеспечения/]
    ]
  };

  // Evaluate all relevant statements, with confirmed repair objects ahead of reported symptoms.
  function labelEvidence(level,choices,units) {
    const found = new Map();
    const usable = units.filter(unit => !NEGATIVE.test(unit.value) && !SERVICE.test(unit.value));
    const resolved = usable.filter(unit => !unit.initial);
    const actual = resolved.filter(unit => REPAIR.test(unit.value) || DEFECT.test(unit.value));
    const discovered=actual.filter(unit=>norm(unit.role)==='обнаружено');
    const group = level === 1 && actual.length ? discovered.length?discovered:actual : level > 1 ? resolved : usable;
    for (const unit of group) {
      if(level===3 && (/взрыв|бвр/.test(unit.value) && HISTORY.test(unit.block) || HISTORY.test(unit.value)))continue;
      const exact = choices.filter(label => norm(label).length >= 6 && norm(label) !== 'другое' && unit.value.includes(norm(label)));
      let matches = exact;
      if (!matches.length) {
        for (const [input,label] of CONCEPTS[level] || []) {
          if (!input.test(unit.value)) continue;
          matches = choices.filter(choice => norm(choice) !== 'другое' && label.test(norm(choice)));
          if (matches.length) break;
        }
      }
      if (level === 1 && /кабел|провод/.test(unit.value) && matches.length > 1) {
        for (const role of [/камер/,/скорост/,/давлен/,/глубиномер/,/питан/,/антенн/,/инклинометр/]) {
          if (!role.test(unit.value)) continue;
          const specific = matches.filter(label => role.test(norm(label)));
          if (specific.length) matches = specific;
          break;
        }
      }
      for (const label of matches) {
        const entry = found.get(norm(label)) || {value:label,units:[]};
        entry.units.push(unit);found.set(norm(label),entry);
      }
    }
    return [...found.values()];
  }
  function textWarnings(row,units) {
    const primary=String(row.description??'').split(/;|так\s*же затрагивает/i)[0];
    const complaintObjects=objectsIn(primary),warnings=[];
    for(const unit of units.filter(u=>!u.initial&&!NEGATIVE.test(u.value)&&!SERVICE.test(u.value))) {
      if((DEFECT.test(unit.value)||REPAIR.test(unit.value)) && unit.objects.length && complaintObjects.length &&
        !unit.objects.some(object=>complaintObjects.includes(object))) {
        warnings.push('Объект работ '+unit.objects.join(', ')+' отличается от объекта обращения '+complaintObjects.join(', '));
      }
      if(/взрыв|бвр/.test(unit.value) && HISTORY.test(unit.block)) {
        warnings.push('Упоминание взрывных работ связано с прежним повреждением или резервными волокнами; причина текущего события не доказана');
      }
    }
    return [...new Set(warnings)];
  }
  const evidenceText = units => [...new Set(units.map(unit => unit.source+': '+unit.quote))].join('\n').slice(0,12000);
  function firstChanged(original,selected) {
    const i = selected.findIndex((value,level) => norm(value) !== norm(original[level]));
    return i < 0 ? null : ['Оборудование','Элемент','Неисправность','Причина'][i];
  }

  function evaluateRow(input) {
    const row = input?.row || input || {}, context = input?.context;
    const original = sourcePath(row), oldPath = context?.paths.get(key(original));
    const completed = validDate(row.completedAt), closed = validDate(row.closedAt);
    const result = {
      dateRegistered:row.createdAt ?? null,dateCompleted:row.completedAt ?? null,dateClosed:row.closedAt ?? null,
      analysisDate:completed ?? closed,dateSource:completed ? 'Дата выполнения обращения' : closed ? 'Дата закрытия' : 'Нет допустимой даты',
      territory:text(row.territory),number:text(row.number),
      equipment:original[0],element:original[1],fault:original[2],incidentReason:original[3],
      description:text(row.description),closureNote:text(row.closureNote),
      status:'REVIEW',failureState:'UNKNOWN',stage:0,reason:null,candidate:[],levelDecisions:[],
      gateEvidence:null,veto:false,originalValid:Boolean(oldPath),selectedValid:false,
      firstChanged:null,readyForApply:false,_classificationSource:'itsm_source',
      reviewedLevels:0,textConfirmedLevels:0,sourcePreservedLevels:0,
      partial:false,unresolvedLevels:[],evidenceWarnings:[]
    };
    const finish = (stage,status,reason) => {
      result.stage=stage;result.stageText=STAGES[stage];result.status=status;result.reason=reason;
      result.reviewedLevels=result.levelDecisions.length;
      result.textConfirmedLevels=result.levelDecisions.filter(d=>d.mode==='TEXT').length;
      result.sourcePreservedLevels=result.levelDecisions.filter(d=>d.mode==='SOURCE').length;
      result.unresolvedLevels=['Оборудование','Элемент','Неисправность','Причина'].filter((_,i)=>!result.candidate[i]);
      result.partial=status==='REVIEW' && result.candidate.some(Boolean);
      return result;
    };
    if (!result.number) return finish(0,'REVIEW','Нет номера обращения; строка сохранена для проверки');
    if (!/^(?:inc|ritm)/.test(norm(result.number))) return finish(0,'REVIEW','Тип обращения не определён; строка сохранена для проверки');
    if (norm(row.closingCode).startsWith('отмен') || norm(row.state).startsWith('отмен')) return finish(0,'CANCELLED','Явная отмена обращения');
    if (!result.analysisDate) return finish(0,'PENDING','Нет допустимой даты выполнения или закрытия; это не отмена');
    if (!context?.paths.size) return finish(4,'REVIEW','Нет полных действующих веток актуального классификатора');
    const units=evidenceUnits(row),gate=failureGate(row,units),isRitm=norm(row.number).startsWith('ritm');
    result.failureState=gate.state;result.gateEvidence=evidenceText(gate.units);
    result.evidenceWarnings=textWarnings(row,units);
    const initialDefect=units.some(unit => unit.initial && DEFECT.test(unit.value) && !NEGATIVE.test(unit.value));
    if (isRitm && (context.ordinaryRitm.has(norm(row.shortDescription)) || ORDINARY_PLANNED_REQUEST.test(norm(row.shortDescription)))) {
      result.veto=gate.state === 'FAILURE' || initialDefect || units.some(u=>u.initial && SYMPTOM.test(u.value) && !NEGATIVE.test(u.value));
      if (!result.veto) return finish(1,'RITM_OK','Полный шаблон обычного RITM; доказанный отказ не найден');
    }
    const unknownGate=gate.state === 'UNKNOWN';
    if (isRitm && gate.state === 'NON_FAILURE') return finish(2,'RITM_OK',gate.reason);

    const equipmentChoices=[...context.children.get(key([])).values()];
    let equipment=equipmentChoices.find(value => norm(value) === norm(original[0]));
    if (!equipment || ['другое','бк (бортовой компьютер)','вик (весоизмерительный комплекс)'].includes(norm(equipment))) {
      const named=EQUIPMENT_ALIASES.flatMap(([pattern,label]) => {
        const proof=units.filter(unit => pattern.test(unit.value)),canonical=equipmentChoices.find(value => norm(value) === norm(label));
        return proof.length && canonical ? [{value:canonical,units:proof}] : [];
      });
      if (named.length > 1) return finish(4,'REVIEW','Упомянуто несколько систем; оборудование неоднозначно');
      if (named.length === 1) {
        equipment=named[0].value;result.levelDecisions.push({level:0,value:equipment,mode:'TEXT',evidence:evidenceText(named[0].units)});
      }
    }
    if (!equipment) return finish(4,'REVIEW','Оборудование не идентифицировано в актуальном классификаторе');
    if (!result.levelDecisions.length) result.levelDecisions.push({level:0,value:equipment,mode:'SOURCE',evidence:(row.classificationSourceLabel || 'Исходное поле ITSM')+': '+original[0]});
    let selected=[equipment];result.candidate=selected.slice();
    if (gate.state === 'NON_FAILURE') {
      const globalProof=gate.units.filter(unit => DENIAL.test(unit.value));
      // A local healthy inspection cannot overturn a valid fault or create an unconfirmed-fault branch.
      if (!globalProof.length && norm(original[2]) !== 'не является отказом') return finish(3,'REVIEW','Локальное отсутствие неисправности не доказывает отсутствие отказа по обращению');
      const decisions=[];
      for (const [pattern,label] of [
        [/дублир|дубликат/,'Дублирование заявки'],[/предостав[а-я]* информац/,'Предоставление информации'],
        [/предостав[а-я]* доступ/,'Предоставление доступа'],[/демонтаж/,'Демонтаж'],
        [/(?:^|[^а-я])монтаж/,'Монтаж'],[/настройк/,'Настройка']
      ]) {
        const proof=units.filter(unit => !unit.initial && pattern.test(unit.value));
        if (proof.length) decisions.push({label,proof});
      }
      if (decisions.length > 1) return finish(7,'REVIEW','Несколько оснований ветки «Не является отказом»');
      const reason=decisions[0]?.label || 'Отказ не подтверждён';
      const candidates=[...context.paths.values()].filter(path => norm(path[0]) === norm(equipment) &&
        norm(path[2]) === 'не является отказом' && norm(path[3]) === norm(reason));
      if (candidates.length !== 1) return finish(7,'REVIEW','Не найдена единственная допустимая ветка «Не является отказом»');
      selected=candidates[0];result.candidate=selected.slice();
      [1,2,3].forEach(level => result.levelDecisions.push({level,value:selected[level],mode:'TEXT',evidence:evidenceText(decisions[0]?.proof || globalProof)}));
    } else {
      let pool=(context.pathsByEquipment.get(norm(equipment))||[]).filter(path=>gate.state!=='FAILURE'||norm(path[2])!=='не является отказом');
      const supported=new Map();
      selected=[equipment,null,null,null];
      let conflict=false;
      for (let level=1;level<=3;level+=1) {
        const choices=[...new Map(pool.map(path=>[norm(path[level]),path[level]])).values()],hits=labelEvidence(level,choices,units);
        supported.set(level,hits);
        const old=choices.find(value => norm(value) === norm(original[level]));
        const unchangedPrefix=selected.slice(0,level).every((value,i) => !value || norm(value) === norm(original[i]));
        const prefixValid=context.children.get(key(original.slice(0,level)))?.has(norm(original[level]));
        const meaningfulOld=old && (!PLACEHOLDER.test(norm(old)) || level===1 && norm(original[2])==='не является отказом');
        let pick=hits.length === 1 ? hits[0] : null;
        if (meaningfulOld && prefixValid && unchangedPrefix && (!hits.length || hits.some(hit => norm(hit.value) === norm(old)))) {
          pick=hits.length === 1 ? hits[0] : {value:old,units:[],source:true};
        }
        if(pick) {
          selected[level]=pick.value;
          result.levelDecisions.push({level,value:pick.value,mode:pick.source?'SOURCE':'TEXT',
            evidence:pick.source?'Сохранено '+(row.classificationSourceLabel || 'исходное поле ITSM')+'; уровень допустим независимо от полноты причины':evidenceText(pick.units)});
        }
        const allowed=pick?[norm(pick.value)]:hits.map(hit=>norm(hit.value));
        if(allowed.length) {
          const narrowed=pool.filter(path=>allowed.includes(norm(path[level])));
          if(narrowed.length)pool=narrowed;else conflict=true;
        }
      }
      // Later explicit evidence can resolve an earlier ambiguous label, but cannot invent a missing fact.
      for(let level=1;level<=3;level+=1) {
        if(selected[level])continue;
        const hits=(supported.get(level)||[]).filter(hit=>pool.some(path=>norm(path[level])===norm(hit.value)));
        if(hits.length===1) {
          selected[level]=hits[0].value;
          result.levelDecisions.push({level,value:hits[0].value,mode:'TEXT',evidence:evidenceText(hits[0].units)});
        }
      }
      result.levelDecisions.sort((a,b)=>a.level-b.level);
      result.candidate=selected.slice();
      while(result.candidate.length && !result.candidate.at(-1))result.candidate.pop();
      if(conflict)return finish(8,'REVIEW','Текстовые основания разных уровней не образуют совместимую ветку');
    }
    const objectWarning=result.evidenceWarnings.find(w=>w.startsWith('Объект работ'));
    const causeByText=result.levelDecisions.some(d=>d.level===3&&d.mode==='TEXT');
    if(objectWarning || result.evidenceWarnings.length&&!causeByText) {
      return finish(objectWarning?5:7,'REVIEW',result.evidenceWarnings.join('; '));
    }
    if(unknownGate && gate.units.length)return finish(isRitm?2:3,'REVIEW',gate.reason);
    const missing=selected.findIndex(value=>!value);
    if(missing>=0) {
      return finish(missing===0?4:missing+4,'REVIEW','Частичный разбор: нет однозначного основания для уровня «'+['Оборудование','Элемент','Неисправность','Причина'][missing]+'»');
    }
    const full=context.paths.get(key(selected));
    if (!full) return finish(8,'REVIEW','Полная ветка отсутствует в актуальном классификаторе');
    const changed=firstChanged(original,full);
    if (unknownGate) {
      if (!changed && oldPath) {
        result.selectedValid=true;result._classificationSource='standard_preserved_unconfirmed';
        return finish(isRitm ? 2 : 3,'BASELINE','Полная штатная ветка сохранена; отдельного подтверждения факта отказа в тексте нет');
      }
      return finish(isRitm ? 2 : 3,'REVIEW','Уровни разобраны, но факт отказа не подтверждён; кандидат требует проверки');
    }
    const unjustified=result.levelDecisions.some(d => norm(d.value) !== norm(original[d.level]) && (d.mode !== 'TEXT' || !d.evidence));
    if (unjustified) return finish(8,'REVIEW','Изменение поля не имеет собственного основания');
    [result.equipment,result.element,result.fault,result.incidentReason]=full;
    result.candidate=full;result.selectedValid=true;result.readyForApply=true;result.firstChanged=changed;
    result._classificationSource=changed ? 'cascade_proposal' : 'itsm_preserved';
    return finish(8,changed ? 'CHANGE' : 'KEEP',changed ? 'Предложена допустимая ветка с основаниями изменённых полей' : 'Исходная допустимая ветка сохранена');
  }
  // Category of change, not a confidence score or an expert accuracy metric.
  function classificationQuality({row,result,finalPath}) {
    if (result.status === 'CANCELLED') return 'Отменено';
    if (result.status === 'PENDING') return 'Недостаточно данных о завершении';
    const number=norm(row.number);
    if (!number.startsWith('inc') && !number.startsWith('ritm')) return 'Тип обращения не определён';
    const standard=globalThis.ReclassifierItsmRules;
    if(!standard?.classificationQuality)throw new Error('Штатная формула качества ITSM недоступна.');
    return standard.classificationQuality({inc:number.startsWith('ritm')?'RITM':'INC',
      completed:validDate(row.completedAt),closed:validDate(row.closedAt),closureCode:row.closingCode,
      sourceClass:sourcePath(row).slice(1),finalClass:finalPath.slice(1)});
  }
  globalThis.ReclassifierReclassificationRules=Object.freeze({
    version:RULES_VERSION,buildContext,evaluateRow,classificationQuality,stages:STAGES,ordinaryRitmTemplates:ORDINARY_RITM_TEMPLATES
  });
})();
