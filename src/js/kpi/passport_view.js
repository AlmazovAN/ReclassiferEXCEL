// FILE CONTRACT: shared read-only KPI passport presentation.
// Owns: HTML for the full methodology and data-lineage contract (modal and future page).
// Reads: immutable KPI Catalog and an existing Report Snapshot.
// Writes: no state; never calculates KPI values, reads Dataset/SQLite or invents execution traces.
// Security: every interpolated Catalog, Dataset, query or result string is HTML-escaped.
(() => {
  'use strict';

  const catalog = globalThis.ReclassifierKpiCatalog;
  const mathPresenter = globalThis.ReclassifierKpiPassportMath;
  if (!catalog?.get || !catalog?.groups || !mathPresenter?.render) {
    throw new Error('KPI Passport View requires Catalog and offline Passport Math renderer.');
  }

  const VALUE_STATES = Object.freeze({
    available: 'Рассчитано',
    'no-data': 'Нет данных',
    unavailable: 'Расчёт недоступен',
    insufficient: 'Недостаточно данных',
    'not-applicable': 'Не рассчитывается',
    error: 'Ошибка расчёта'
  });
  const MONTH_LABELS = Object.freeze(['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']);
  const DIRECTIONS = Object.freeze({
    'higher-is-better': 'Больше — лучше',
    'lower-is-better': 'Меньше — лучше',
    'target-range': 'Целевой диапазон',
    neutral: 'Без заданной оценки'
  });
  const OPERATION_LABELS = Object.freeze({
    FILTER:'Фильтрация',JOIN:'Соединение',MAP:'Преобразование',GROUP:'Группировка',
    COUNT:'Подсчёт',COUNT_DISTINCT:'Уникальные',SUM:'Суммирование',
    ADD:'Сложение',SUBTRACT:'Вычитание',MULTIPLY:'Умножение',
    DIVIDE:'Деление',ROUND:'Округление',IDENTITY:'Результат',CUSTOM:'Специальная операция'
  });
  const NULL_RULES = Object.freeze({
    exclude: 'Исключить',preserve:'Сохранить',unavailable:'Недоступно','not-applicable':'Не применяется'
  });
  const AGGREGATION_RULES = Object.freeze({
    'sum-components-then-formula':'Сложить составляющие → применить формулу',
    'sum-values':'Сумма значений',
    'weighted-average':'Взвешенная агрегация',
    'not-supported':'Не поддерживается'
  });
  const ROLLING_RULES = Object.freeze({
    'ratio-of-sums':'Отношение сумм компонентов',
    sum:'Сумма значений',average:'Среднее значений',unavailable:'Недоступно'
  });

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[char]);
  }

  function present(value, empty = '—') {
    if (value === null || value === undefined || value === '') return empty;
    if (Array.isArray(value)) return value.map(entry => present(entry)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  function field(ref) {
    return ref ? (ref.datasetId ? ref.datasetId + '.' : '') + present(ref.field) : '—';
  }
  function number(value, unit) {
    return Number.isFinite(value)
      ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value) +
        (unit ? ' ' + unit : '')
      : '—';
  }
  function monthLabel(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
    if (!match) return present(value);
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? MONTH_LABELS[month - 1] + ' ' + match[1] : present(value);
  }
  function row(label, value) {
    return `<div class="kpi-passport-fact"><dt>${esc(label)}</dt><dd>${esc(present(value))}</dd></div>`;
  }
  function factGrid(items) {
    return `<dl class="kpi-passport-facts">${items.map(([name,value])=>row(name,value)).join('')}</dl>`;
  }
  function table(headers, rows, empty) {
    if (!rows.length) return `<p class="kpi-passport-empty">${esc(empty || 'Не задано.')}</p>`;
    return `<div class="kpi-passport-table-wrap"><table class="kpi-passport-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(cells=>`<tr>${cells.map((cell,index)=>`<td${index===0?' class="kpi-passport-first-col"':''}>${esc(present(cell))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function section(id,title,content,description='') {
    return `<section class="kpi-passport-section" id="kpi-passport-${esc(id)}"><div class="kpi-passport-section-heading"><h3>${esc(title)}</h3>${description?`<p>${esc(description)}</p>`:''}</div>${content}</section>`;
  }
  // Original Excel headings come from the live Field Registry, never guessed from
  // the semantic field name. Other Dataset kinds have different provenance.
  const MB_COLUMNS=Object.freeze({
    factDate:'Фактическая дата',site:'Участок',
    finalTaskType:'Итоговый тип задачи',
    equipmentPlacement:'Навесное / Стационарное',
    equipmentType:'Тип оборудования',
    transport:'Транспорт',equipmentUnit:'Единица оборудования',
    equipment:'Оборудование',request:'Заявка',
    laborHours:'Фактические трудозатраты'
  });
  const MB_DERIVED=Object.freeze({
    recordKey:'Устойчивый ключ задачи, формируется из участка и номера задачи (или ID задачи в смене)',
    laborState:'Состояние проверки и нормализации трудозатрат',
    laborHours:'Нормализованное числовое значение из колонки «Фактические трудозатраты»'
  });
  const DATASET_NAMES=Object.freeze({
    itsm_data:'ITSM Сириус — обращения',
    mobile_brigade_data:'Мобильные бригады — задачи',
    combined:'Equipment_Combined — сводный парк'
  });
  function sourceHeading(datasetId,item) {
    const fieldId=String(item.field || '');
    if(item.sourceColumn)return item.sourceColumn;
    if(datasetId==='itsm_data'){
      const registry=globalThis.ReclassifierFieldRegistry;
      if(registry?.hasDataset?.('itsm_data')){
        try {
          const title=registry.get('itsm_data',fieldId)?.sourceLabel;
          if(title)return title;
        } catch(_) { /* Full Dataset extension / derived column. */ }
      }
      const columns=globalThis.ReclassifierItsmDatasetSchema?.columns;
      const match=Array.isArray(columns)&&columns.find(row=>row[0]===fieldId);
      if(match?.[1])return match[1];
      return 'Не установлено в схеме ITSM';
    }
    if(datasetId==='mobile_brigade_data') {
      if(MB_DERIVED[fieldId] && !MB_COLUMNS[fieldId])return 'Производное поле МБ';
      return MB_COLUMNS[fieldId] || 'Не установлено в схеме МБ';
    }
    if(datasetId==='combined') {
      if(fieldId==='meta.freshness')return 'Метаданные Dataset (дата снимка)';
      // All other fields in the KPI contract refer to actual named columns
      // of the generated Equipment_Combined table, not raw external catalogs.
      return fieldId;
    }
    return 'Не установлено в реестре источников';
  }
  function sourceFieldNote(datasetId,item) {
    const note=datasetId==='mobile_brigade_data'?MB_DERIVED[item.field]:null;
    return note?item.purpose+'; '+note:item.purpose;
  }

  // Classification guidance is displayed inside the SAME "Как рассчитывается"
  // section used by ВБР and КТГ; do not create a separate passport section.
  function classificationNarrative(kpiId) {
    const common='<p><strong>Что означает результат:</strong> показатель оценивает результат '+
      'проверки первоначальной классификации ITSM Сириус по фактическому '+
      'описанию неисправности, сведениям о диагностике и выполненных работах. '+
      'Специалист по надёжности проверяет соответствие содержания заявки '+
      'выбранным значениям классификатора. Сам KPI считает категории итоговой '+
      'разметки, а не анализирует текст автоматически.</p>'+
      '<p><strong>Четыре составляющие:</strong> A = «INC без изм» '+
      '(классификация не исправлялась); B = «INC с исправлением»; '+
      'C = «INC не классифицирован»; D = «RITM вместо INC». '+
      'A входит в числитель; A + B + C + D — знаменатель. '+
      '«RITM без изм» не учитывается. При нулевом знаменателе результат '+
      'не рассчитывается.</p>';
    const time='<p><strong>Как выбирается месяц:</strong> сначала «Дата выполнения обращения», '+
      'если отсутствует или некорректна — «Дата закрытия». При отсутствии обеих '+
      'дат запись не относится к месяцу и не входит в результат. При выборе '+
      'нескольких месяцев сначала суммируются A, B, C, D, затем '+
      'применяется формула; среднее месячных процентов не используется.</p>';
    if(kpiId==='classification_quality')return common+
      '<p><strong>Область оценки:</strong> все подходящие обращения ITSM Сириус, '+
      'независимо от группы инициаторов, связи с Мобильными бригадами и признаков '+
      '«Считать отказом» / «Исключить» в методиках ВБР и КТГ. '+
      'Все ошибочно созданные RITM категории D учитываются в общем показателе.</p>'+
      '<p><strong>Примечания к вычислениям:</strong> дополнительная сверка ITSM и МБ по номеру обращения '+
      'показывает группы инициаторов из справочника, совпадения и расхождения отчётных месяцев, '+
      'отсутствующие номера и неполноту покрытия выгрузок. Месяц ITSM — выполнение или закрытие, '+
      'месяц МБ — фактические работы. Эти сведения не изменяют числитель и знаменатель '+
      'общего качества классификации. Отсутствие номера в загруженном Dataset не доказывает '+
      'отсутствия заявки в корпоративной системе.</p>'+time;
    if(kpiId==='classification_quality_cgps')return common+
      '<p><strong>В данный показатель включаются только обращения,</strong> '+
      'по которым работы зарегистрированы в актуальных Мобильных бригадах '+
      'в рамках деятельности ЦГПС. Наличие проверяется по точному совпадению '+
      'нормализованного номера обращения ITSM Сириус с полем «Заявка» МБ. '+
      'Несколько задач МБ на один номер дают одно обращение. Сохранённое '+
      'поле «Наличие заявки в МБ» показывает состояние на момент обработки '+
      'и не подменяет проверку по актуальному набору МБ.</p>'+
      '<p><strong>Роль группы инициаторов:</strong> A, B и C учитываются при '+
      'любом инициаторе при подтверждённой связи с МБ. D учитывается '+
      'только при значении расчётного поля «Группа инициаторов» = «ЦГПС». '+
      'Запись «Открыл = Интеграция с МБ» не требуется: обращения могут '+
      'создаваться вручную. Пустая группа инициаторов означает «не ЦГПС» '+
      'для категории D и учитывается в отдельной диагностике.</p>'+ 
      '<p><strong>Границы достоверности:</strong> наличие определяется '+ 
      'только по номеру обращения в текущем загруженном Dataset МБ, '+
      'без проверки даты создания или диапазона свежести выгрузки. '+
      '«Нет в МБ» — номер не найден в загруженном наборе, обращение исключается '+ 
      'из расчёта. «Нет данных МБ» — Dataset МБ отсутствует или недоступен; '+ 
      'процент для затронутого среза не публикуется. Если номер ITSM пустой, '+ 
      'обращение исключается отдельно как несопоставимое. RITM других и '+ 
      'неустановленных инициаторов не входят в показатель ЦГПС, но входят '+ 
      'в общее качество классификации. Неполная выгрузка МБ может '+ 
      'привести к пропуску реально существующих заявок: это ограничение '+ 
      'источника данных, а не проверка полноты по датам.</p>'+time;
    return '';
  }

  function narrativeView(contract,query,kpiId=null) {
    const dateBindings=Array.isArray(contract.temporal?.periodBindings)&&contract.temporal.periodBindings.length
      ? contract.temporal.periodBindings
      : [contract.temporal?.basis].filter(Boolean).map(b=>({...b,purpose:'Дата определения отчётного периода'}));
    const dates=dateBindings.map(b=>{
      const source=(contract.sources||[]).find(s=>s.datasetId===b.datasetId);
      const item=source?.fields?.find(f=>f.field===b.field);
      const name=sourceHeading(b.datasetId,item||{field:b.field});
      return (DATASET_NAMES[b.datasetId]||b.datasetId)+': '+name+' ('+(b.purpose||'дата учёта')+')';
    });
    const preparation=contract.filters.filter(p=>p.stage!=='query');
    const scope=contract.filters.filter(p=>p.stage==='query');
    const runtime=Object.entries(query?.filters||{});
    const operations=(contract.steps||[]).map(step=>
      '<li><strong>'+esc(OPERATION_LABELS[step.operation]||step.operation)+':</strong> '+
        esc(step.description || 'Шаг указан в Calculation Contract.')+'</li>').join('');
    const filterText=preparation.length
      ? '<ul>'+preparation.map(f=>{
          const dataset=(contract.sources||[]).find(s=>s.datasetId===f.field?.datasetId);
          const item=dataset?.fields?.find(x=>x.field===f.field?.field);
          const header=item?sourceHeading(f.field.datasetId,item):f.field?.field;
          const wanted=f.value===null?'значение по условию '+f.operator:present(f.value);
          return '<li><strong>'+esc(header)+':</strong> '+esc(wanted)+
            (f.note?' — '+esc(f.note):'')+'</li>';
        }).join('')+'</ul>'
      : '<p>Отдельные предметные условия подготовки в контракте не заявлены.</p>';
    const dimensions=Array.from(new Set(scope.map(f=>typeof f.value==='string' && f.value.startsWith('$query.filters.') ? f.value.slice('$query.filters.'.length) : null).filter(Boolean)));
    const active=runtime.length
      ? runtime.map(([key,value])=>key+' = '+present(value)).join('; ')
      : 'Все доступные данные (без дополнительных выбранных ограничений)';
    return '<div class="kpi-passport-method">'+
      '<p><strong>Откуда берутся данные:</strong> '+esc(contract.sources.map(s=>
        DATASET_NAMES[s.datasetId]||s.datasetId).join('; '))+'.</p>'+
      '<p><strong>Период учёта:</strong> '+esc(dates.join('; '))+
        '. Группировка — по календарным месяцам.</p>'+
      classificationNarrative(kpiId)+
      '<div class="kpi-passport-method-subsection"><h4>Какие записи учитываются</h4>'+filterText+'</div>'+
      '<p><strong>Разрезы расчёта:</strong> '+esc((dimensions.length?dimensions.join(', '):'По условиям данного KPI')+'.')+'</p>'+
      '<p><strong>Выбранные фильтры текущего отчёта:</strong> '+esc(active)+'.</p>'+
      '<div class="kpi-passport-method-subsection"><h4>Последовательность расчёта</h4>'+
        '<ol>'+operations+'</ol></div>'+
      '<p class="kpi-passport-method-footnote">Здесь изложена документированная последовательность по Calculation Contract. Реальные количества исключённых групп, значения и ревизии источников доступны в разделе «Показать расчёт».</p>'+
    '</div>';
  }

  function technicalDisclosure(contents) {
    return '<details class="kpi-passport-technical">'+
      '<summary>Техническая документация: связи, фильтры, операции, агрегация и периоды</summary>'+
      '<div class="kpi-passport-technical-body">'+contents+'</div></details>';
  }

  function sourceView(contract, sourceStates) {
    const out = [];
    for (const source of contract.sources) {
      const live = sourceStates.get(source.datasetId);
      const stateLabel = live ? (live.available ? 'Подключён' : 'Недоступен') : 'Нет сведений в Snapshot';
      out.push(`<div class="kpi-passport-dataset"><div class="kpi-passport-dataset-head"><h4>${esc(DATASET_NAMES[source.datasetId]||source.datasetId)}</h4><span>${esc(stateLabel)}</span></div>
      <p class="kpi-passport-source-scope">Dataset: <code>${esc(source.datasetId)}</code> · ${source.fields.length} полей в контракте</p>
      <details class="kpi-passport-source-detail"><summary>Показать колонки и реквизиты источника</summary>
      ${factGrid([
        ['Зерно данных',source.grain.join(' × ')],
        ['Ревизия',live?.activeRevision ?? null],
        ['Актуальность',live?.freshness || null],
        ['Контрольная сумма',live?.contentHash || null]
      ])}${table(['Семантическое поле','Заголовок источника','Назначение','Пустые значения'],source.fields.map(item=>[
        item.field, sourceHeading(source.datasetId,item), sourceFieldNote(source.datasetId,item),
        NULL_RULES[item.nullPolicy] || item.nullPolicy
      ]),'Перечень полей ещё не заполнен.')}</details></div>`);
    }
    return out.join('');
  }
  function joinView(joins) {
    return table(['Тип','Левый ключ','Правый ключ','Кардинальность','Нет пары','Дубликаты / правило'],joins.map(join=>[
      join.joinType || join.type,field(join.left),field(join.right),join.cardinality,
      join.onUnmatched,join.onDuplicate+(join.justification?' · '+join.justification:'')
    ]),'Построчные JOIN не заявлены. Источники могут агрегироваться независимо.');
  }
  function filterView(filters,query) {
    const runtime = Object.entries(query?.filters || {}).map(([k,v])=>k + ' = ' + present(v)).join('; ') || 'Нет дополнительных фильтров';
    return factGrid([['Фактические фильтры среза',runtime]]) +
      table(['Стадия','Поле','Оператор','Условие','Действие / область','Основание'],filters.map(filter=>[
        filter.stage,field(filter.field),filter.operator,present(filter.value),
        (filter.effect==='exclude'?'Исключить':'Включить')+(filter.appliesTo?' · '+filter.appliesTo:''),
        filter.note || '—'
      ]),'Дополнительные условия в контракте не перечислены.');
  }
  function stepsView(steps) {
    return table(['Шаг','Операция','Вход','Результат','Описание','Обработчик'],steps.map((step,i)=>[
      (i+1)+'. '+step.id,OPERATION_LABELS[step.operation] || step.operation,
      present(step.inputs),step.output,step.description,step.handlerRef || '—'
    ]),'Шаги расчёта не определены.');
  }
  function aggregationView(c) {
    const components=Object.entries(c.aggregation.componentMethods || {});
    return factGrid([
      ['Зерно агрегации',c.aggregation.grain.join(' × ')],
      ['Объединение периодов',AGGREGATION_RULES[c.aggregation.combinePeriods]||c.aggregation.combinePeriods],
      ['Пропуски / исключения',c.aggregation.missingPolicy],
      ['Нулевой знаменатель',c.formula.zeroDenominator],
      ['Округление',c.formula.roundingDigits+' знаков']
    ]) + table(['Компонент','Операция'],components,'Компоненты агрегации не определены.');
  }
  function temporalView(c) {
    const temporal=c.temporal;
    const dates=Array.isArray(temporal.periodBindings)&&temporal.periodBindings.length
      ? table(['Источник','Поле даты','Роль'],temporal.periodBindings.map(b=>[
          b.datasetId,b.field,b.purpose
        ]))
      : factGrid([['Дата учёта',field(temporal.basis)]]);
    const rolling=temporal.rolling || {};
    const forecast=temporal.forecast || {};
    return dates + factGrid([
      ['Гранулярность',temporal.periodGrain==='month'?'Месяц':temporal.periodGrain],
      ['Неполный период',temporal.incompletePeriod],
      ['Исторический расчёт',temporal.historicalSupported?'Поддерживается':'Не поддерживается'],
      ['Предыдущее значение',temporal.previous?.selection==='previous-calendar-period'?'Предыдущий календарный месяц':temporal.previous?.selection],
      ['Нет прошлого периода',temporal.previous?.whenMissing],
      ['Скользящий показатель',ROLLING_RULES[rolling.method] || rolling.method],
      ['Окно по умолчанию',rolling.method==='unavailable'?'—':rolling.defaultWindow+' мес.'],
      ['Минимальное окно',rolling.method==='unavailable'?'—':rolling.minWindow+' мес.'],
      ['Полное окно обязательно',rolling.requireCompleteWindow?'Да':'Нет'],
      ['Прогноз будущих месяцев: статус',forecast.status],
      ['Прогноз будущих месяцев: метод',forecast.methodId],
      ['Прогноз будущих месяцев: горизонт',forecast.horizon],
      ['Прогноз будущих месяцев: минимум периодов',forecast.minPeriods]
    ]);
  }
  // PR-5: the same model choice is shared with the chart. A manual selection
  // creates a LOCAL PREVIEW; no PDF or immutable Report Snapshot is rewritten.
  function forecastMethodControl(entry) {
    const engine=globalThis.ReclassifierKpiForecastEngine;
    const preference=engine?.forecastPreferences,policy=engine?.strategyRegistry?.forKpi(entry.id);
    if(!preference||!policy||!entry.calculation)return '';
    const methods=preference.methodsFor(entry.id);
    const labels=id=>engine.REPORTING_METHODS?.[id]?.label||
      (id==='linear-trend'?'Линейный тренд':id==='last-value'?'Последнее значение':id);
    const current=preference.get(entry.id)||'auto';
    return '<div class="kpi-passport-forecast-method"><label for="kpiPassportForecastMethod">Метод прогноза</label>'+
      '<select id="kpiPassportForecastMethod" aria-label="Метод прогнозирования KPI" data-kpi-passport-forecast="'+esc(entry.id)+'">'+
      [['auto','Автоматически'],...methods.map(id=>[id,labels(id)])].map(([id,title])=>
        '<option value="'+esc(id)+'"'+(current===id?' selected':'')+'>'+esc(title)+'</option>').join('')+
      '</select><p class="kpi-passport-caution">Выбор действует в текущем сеансе. Ручной метод создаёт аналитический сценарий, не изменяя фактический KPI и исходный Report Snapshot. Сценарный прогноз не включён в PDF.</p></div>';
  }
  function passportScenarioForecast(entry,snapshot) {
    const engine=globalThis.ReclassifierKpiForecastEngine;
    const methodId=engine?.forecastPreferences?.get(entry.id);
    if(!methodId||!snapshot)return null;
    const policy=engine?.strategyRegistry?.forKpi(entry.id)?.policy;
    const series=snapshot.kpiView?.seriesById?.[entry.id]?.points||[];
    const month=snapshot.kpiView?.selectedMonth||snapshot.query?.period?.month||
      snapshot.query?.period?.id||null;
    if(!month)return null;
    const input={kpiId:entry.id,selectedMonth:month};
    if(policy==='reporting-month-components'||policy==='reporting-month-volume'){
      const coverage=snapshot.reportingCoverage?.kpis?.[entry.id]||null;
      input.selectedMonth=coverage?.reportMonth||month;
      input.reportingCoverage=coverage;
      input.current=snapshot.results?.[entry.id]||null;
      input.points=series.filter(p=>p.period<input.selectedMonth);
      input.methodId=methodId;
    }else if(policy==='historical-next-month'){
      input.points=series;
      input.overrides={[entry.id]:{methodId}};
    }else return null;
    try{return engine.strategyRegistry.predictForKpi(input);}
    catch(_){return {dataState:'unavailable',value:null,reason:'forecast-scenario-unavailable',
      requestedMethodId:methodId,methodId:null,methodVersion:null};}
  }
  // A distinct same-cohort correction, NOT the historical-next-month KPI
  // forecast or the dashed current-month line. ITSM has no verified as-of
  // classification change log; only an explicitly supplied audit can unlock it.
  function lagAuditView(entry,snapshot,provided) {
    if(!['classification_quality','classification_quality_cgps'].includes(entry.id))
      return '';
    const model=globalThis.ReclassifierKpiClassificationLagForecast;
    const data=provided?.[entry.id]||null;
    const lag=data&&model
      ?model.evaluateSnapshot(snapshot,entry.id,data)
      :null;
    const status=!data?'История изменений с датами не подключена':
      lag?.dataState==='available'?'Экспериментальная оценка доступна':
      'Недостаточно подтверждённых данных или модель не прошла проверку';
    const reason=!data?'no-versioned-asof-audit-history':lag?.reason||'—';
    const detail=factGrid([
      ['Тип оценки','Возможная корректировка качества того же завершённого месяца'],
      ['Состояние',status],
      ['Основание','Версионированные состояния одних и тех же обращений на разные даты'],
      ['Контроль полноты','Не используются даты событий или время загрузки вместо истории изменений'],
      ['Текущая доля (факт)',number(snapshot?.results?.[entry.id]?.value,entry.definition.unit)],
      ['Оценка после инженерных корректировок',
        lag?.dataState==='available'?number(lag.value,entry.definition.unit):'—'],
      ['Число исторических пар',lag?.auditPairs??'—'],
      ['Проверка на прошлых периодах',lag?.quality?.passed===true?'Пройдена':'Не выполнена / не пройдена'],
      ['MAE модели, п.п.',number(lag?.quality?.mae,'')],
      ['MAE без поправки, п.п.',number(lag?.quality?.baselineMae,'')],
      ['Причина недоступности',reason]
    ]);
    return '<div class="kpi-passport-lag-audit"><h4>Корректировка после реклассификации (экспериментально)</h4>'+
      detail+'<p class="kpi-passport-caution">Этот расчёт не заменяет фактический KPI, обычный прогноз следующего месяца, график или PDF. '+
      'Без датированных ревизий тех же обращений числовая оценка не формируется. '+
      'Смена справочника классификации без сохранённого состояния на дату не является доказанной историей исправлений.</p></div>';
  }

  function forecastView(entry,snapshot) {
    const originalForecast=snapshot?.kpiView?.cards?.[entry.id]?.forecast || null;
    const scenario=passportScenarioForecast(entry,snapshot);
    const forecast=scenario||originalForecast;
    const scenarioNotice=scenario
      ? '<p class="kpi-passport-caution" role="status">Сценарный прогноз по выбранному методу. Фактический KPI не меняется; прогноз не включён в Report Snapshot и PDF.</p>'
      : '';
    const engine=globalThis.ReclassifierKpiForecastEngine;
    const config=engine?.configFor?.(entry.id);
    const volumeForecast=Boolean(engine?.REPORTING_VOLUME_METRICS?.[entry.id]);
    if(entry.id==='vbr'||entry.id==='ktg'||volumeForecast){
      const coverage=snapshot?.reportingCoverage?.kpis?.[entry.id]||{};
      const methodName=id=>engine?.REPORTING_METHODS?.[id]?.label||id||'—';
      const state=coverage.reportMonthStatus==='complete'?'Месяц завершён':
        coverage.reportMonthStatus==='incomplete'?'Неполный месяц':
        'Полнота не подтверждена';
      const components=Object.entries(forecast?.methodComponents||{}).map(([id,model])=>[
        id,methodName(model.methodId),model.methodVersion||'—',
        number(model.expectedDailyRate,''),number(model.validation?.mae,''),
        number(model.validation?.baselineMae,''),
        model.validation?.linearAccepted===false?'Резервный last-value':
          model.validation?.linearAccepted===true?'Линейная модель принята':'Без MAE'
      ]);
      const revisions=Array.from(forecast?.sourceRevisions||[]).map(source=>[
        source.datasetId,source.revision??'—',source.contentHash||'—'
      ]);
      return scenarioNotice+factGrid([
        ['Статус','Экспериментальный прогноз, не фактический KPI'],
        ['Отчётный месяц',forecast?.horizon||coverage.reportMonth||'—'],
        ['Полнота отчётного месяца',state],
        ['Источник',coverage.sourceId||'—'],
        ['Начало покрытия',forecast?.coverageFrom||coverage.coverageFrom||'—'],
        ['Подтверждённые данные по',forecast?.coverageThrough||coverage.coverageThrough||'—'],
        ['Факт за доступные дни',number(forecast?.observedValue,entry.definition.unit)],
        ...(volumeForecast?[['Прогноз оставшихся дней',
          number(forecast?.remainingValue,entry.definition.unit)],
          ['Режим отображения','Накопленный факт + прогноз до конца месяца']]:[]),
        ['Прогноз завершения месяца',number(forecast?.value,entry.definition.unit)],
        ['Запрошенный метод',methodName(forecast?.requestedMethodId||
          engine?.REPORTING_STRATEGY?.defaultMethodId)],
        ['Фактически применённый метод',methodName(forecast?.methodId)],
        ['Версия метода',forecast?.methodVersion||'—'],
        ['Стратегия и версия',forecast?.strategyId
          ?forecast.strategyId+' · '+(forecast.strategyVersion||'—'):'—'],
        ['Учтено дней',forecast?.elapsedDays??'—'],
        ['Прогнозируемых дней',forecast?.remainingDays??'—'],
        ['История обучения',forecast?.quality?.historicalMonths??'—'],
        ['Периодов проверки',forecast?.quality?.validationMonths??'—'],
        ['Причина недоступности',forecast?.reason||coverage.reportMonthReason||'—']
      ])+table(['Компонент','Применённый метод','Версия','Интенсивность в день',
          'MAE','MAE базовой','Итог проверки'],
          components,'Прогнозные компоненты не рассчитаны.')+
        table(['Dataset','Ревизия','Хеш'],revisions,'Ревизии отсутствуют.')+
        '<p class="kpi-passport-caution">'+esc(
          [volumeForecast
              ?'Прогноз абсолютной метрики рассчитывается по суточной интенсивности за оставшиеся дни.'
              :'Прогноз рассчитывается по компонентам, затем применяется формула KPI.',
            'Накопленный факт не перезаписывается.',
            ...(volumeForecast?[]:['Численность оборудования Drivers фиксирована.']),
            ...Array.from(forecast?.caveats||[])].join(' ')
        )+'</p>';
    }
    // PR-4: method provenance is reported from the selected Snapshot.
    return scenarioNotice+factGrid([
      ['Модель по умолчанию',config?.methodId || '—'],
      ['Горизонт по умолчанию',config?.horizonMonths ? config.horizonMonths+' мес.' : '—'],
      ['Минимальная история',config?.minHistoryMonths ? config.minHistoryMonths+' мес.' : '—'],
      ['Запрошенный метод',forecast?.requestedMethodId || '—'],
      ['Фактически применённая модель',forecast?.methodId || '—'],
      ['Версия модели',forecast?.methodVersion || '—'],
      ['Период прогноза',forecast?.horizon || '—'],
      ['Прогноз',Number.isFinite(forecast?.value)?number(forecast.value,entry.definition.unit):'—'],
      ['Причина недоступности',forecast?.reason || '—'],
      ['MAE модели',Number.isFinite(forecast?.quality?.mae)?number(forecast.quality.mae,''):'—'],
      ['MAE простого прогноза',Number.isFinite(forecast?.quality?.baselineMae)?number(forecast.quality.baselineMae,''):'—'],
      ['Проверка качества',forecast?.quality?.passed===true?'Пройдена':forecast?.quality?.passed===false?'Не пройдена':'Не выполнена']
    ]) + '<p class="kpi-passport-caution">Прогноз рассчитывается локально при достаточной непрерывной истории и успешной проверке относительно простого прогноза. Подключение корпоративной ML-модели — отдельный адаптер, сейчас не подключён.</p>';
  }

  function provenanceView(entry,snapshot) {
    const result=snapshot?.results?.[entry.id] || null;
    const card=snapshot?.kpiView?.cards?.[entry.id] || null;
    const current=card?.current;
    const query=snapshot?.query?.calculator || result?.query || {};
    const state=current?.dataState || result?.dataState || 'not-applicable';
    const value=current ? current.value : (state==='available'?result?.value:null);
    const rawComponents=Object.entries(result?.components || {});
    // A declaration without actual Result.components is NOT factual evidence.
    // Preserve the established empty-data message in passports and offline tests.
    const projected=rawComponents.length
      ? catalog.projectComponents?.(entry.id,result)||null:null;
    const known=new Set(projected?.items.map(item=>item.key)||[]);
    const components=projected
      ? [
        ...projected.items.map(item=>[
          item.label+' · '+(item.role==='numerator'?'числитель':
            item.role==='denominator'?'знаменатель':'компонент'),
          item.key,number(item.value,item.unit)
        ]),
        ...rawComponents.filter(([key])=>!known.has(key))
          .map(([key,val])=>['Дополнительный компонент',key,number(val,'')])
      ]
      : rawComponents.map(([key,val])=>[key,key,number(val,'')]);
    const measured=state==='available' && Number.isFinite(value);
    return factGrid([
      ['Значение за выбранный период',measured ? number(value,entry.definition.unit) : '—'],
      ['Состояние',VALUE_STATES[state] || state],
      ['Причина недоступности',current?.reason || result?.reason || '—'],
      ['Период',monthLabel(card?.current?.period || snapshot?.query?.period?.month)],
      ['Рудник',snapshot?.query?.mine?.label || 'Все рудники'],
      ['Оборудование',snapshot?.query?.equipmentClass?.label || 'Всё оборудование'],
      ['Вычислено',snapshot?.calculatedAt || '—'],
      ['Версия формулы',result?.formulaVersion || entry.calculation?.formula?.formulaVersion || '—'],
      ['Snapshot',snapshot?.schemaVersion || '—']
    ]) +
      table(['Компонент KPI Result','Ключ Result.components','Фактическое значение'],components,
        'Фактические компоненты отсутствуют или KPI не рассчитан.')+
      `<p class="kpi-passport-caution">Формула и её компоненты приведены из KPI Result. Реально выполненные фильтры и количества подготовленных групп доступны в разделе «Показать расчёт» ниже.</p>`;
  }

  function executionEvidenceView(entry,snapshot,embedded=false) {
    const trace=snapshot?.executionTrace?.byKpi?.[entry.id] || null;
    if (!trace) {
      const unavailable='<p class="kpi-passport-caution">Фактическая трассировка недоступна для этого снимка отчёта. Декларация выше не заменяет выполненный расчёт.</p>';
      return embedded ? unavailable :
        '<details class="kpi-passport-execution-trace"><summary>Показать расчёт</summary>'+
        unavailable+'</details>';
    }
    const records=[];
    for(const event of trace.events || []) {
      if(event.kind==='selection') {
        records.push([
          'Отбор · '+present(event.tableId),
          'Подготовленных групп: '+present(event.inputRows),
          'После отбора: '+present(event.outputRows),
          event.error || 'Выполнен'
        ]);
        for(const stage of event.stages || []) {
          const detail=stage.stage==='period'
            ? 'Период ∈ '+present(stage.expected)
            : 'Фильтр '+present(stage.filter)+' · '+present(stage.fields)+' = '+present(stage.expected);
          records.push([detail,
            'До: '+present(stage.inputRows),
            'После: '+present(stage.outputRows),
            'Исключено: '+present(stage.excludedRows)
          ]);
        }
        if(event.unsupportedFilters?.length) records.push([
          'Неподдерживаемые фильтры',present(event.unsupportedFilters),'—',present(event.error)
        ]);
      } else if(event.kind==='subset') {
        records.push([
          'Отбор числителя · '+present(event.field)+' ∈ '+present(event.acceptedTypes),
          'До: '+present(event.inputRows),
          'После: '+present(event.outputRows),
          'Исключено: '+present(event.excludedRows)+'; сумма '+present(event.sumField)+': '+present(event.sumValue)
        ]);
      } else if(event.kind==='linkage') {
        records.push([
          'Охват PRB в выбранных группах',
          'Задач: '+present(event.taskCount),
          'Связанных: '+present(event.linkedTaskCount),
          'Без однозначной PRB: '+present(event.unlinkedTaskCount)
        ]);
      }
    }

    const sourceRows=(trace.sources || []).map(source=>[
      source.datasetId,
      source.available?'Доступен':'Недоступен',
      source.sourceRows,
      source.revision,
      source.hash || '—',
      source.freshness || '—'
    ]);
    const prepRows=(trace.preparation || []).map(item=>[
      item.tableId,item.preparedRows,
      item.grain?.join(' × ') || '—',
      Object.keys(item.diagnostics||{}).map(key=>key+' = '+present(item.diagnostics[key])).join('; ') || '—'
    ]);
    const classificationComponentLabels=Object.freeze({
      classificationIncUnchangedCount:'A — INC без изм',
      classificationIncCorrectedCount:'B — INC с исправлением',
      classificationIncUnclassifiedCount:'C — INC не классифицирован',
      classificationRitmInsteadOfIncCount:'D — RITM вместо INC',
      classificationSuccessCount:'Числитель: A',
      classificationFailureCount:'Ошибка классификации: B + C + D',
      classificationTotalCount:'Знаменатель: A + B + C + D',
      excludedNoMbCount:'Исключено: подтверждённо нет в МБ',
      unknownMbCoverageCount:'Нет данных МБ: Dataset недоступен',
      excludedOtherInitiatorRitmCount:'Исключено: RITM других инициаторов',
      excludedUnknownInitiatorRitmCount:'Исключено: RITM без группы инициаторов',
      excludedMissingRequestCount:'Исключено: нет номера ITSM'
    });
    const classified=entry.id==='classification_quality'||
      entry.id==='classification_quality_cgps';
    const actualComponents=Object.entries(trace.components || {}).map(([name,value])=>[
      classified&&classificationComponentLabels[name]
        ? classificationComponentLabels[name]+' ('+name+')' : name,
      Number.isFinite(value)?number(value,''):present(value)
    ]);
    const evidenceLabel={
      observed:'Отборы записаны во время Calculator',
      'source-guarded':'Итог блокирован отсутствующим источником',
      'no-selection-executed':'Отбор не выполнялся — ранний выход Calculator',
      'not-calculated':'Расчёт в текущем Snapshot не выполнялся',
      'not-implemented':'KPI не подключён'
    }[trace.evidence] || trace.evidence;

    const ktgWorkMeta=entry.id==='ktg'
      ? trace.preparation?.find(t=>t.tableId==='ktg_work')?.diagnostics||null
      : null;
    const ktgMatch=entry.id==='ktg'
      ? snapshot?.results?.ktg?.diagnostics||{} : {};
    const ktgEvidence=ktgWorkMeta?`<section class="kpi-passport-trace-caveats">
      <h4>Проверка исходных данных КТГ</h4>
      <p><strong>Источники:</strong> ITSM (после реклассификации) и Drivers.
      По ITSM используются «INC после рекласс», «ТО/ Монтаж/ Разовое»,
      «Наим1», «Территории MES», «Время предбэклога (откр-выполн), час».
      Месяц определяется датой создания; продолжительность берётся из рассчитанной колонки, без перерасчёта дат.
      При отсутствии даты выполнения и закрытия динамический предбэклог открытого обращения
      не принимается за подтверждённый простой.</p>
      <p>Из ITSM: исходных записей ${esc(present(ktgWorkMeta.sourceRows))};
      кандидатов для КТГ ${esc(present(ktgWorkMeta.eligibleRows))};
      сопоставлено с Drivers ${esc(present(ktgWorkMeta.matchedRows))};
      исключённые работы ${esc(present(ktgWorkMeta.ignoredWorkRows))};
      без соответствия Drivers ${esc(present(ktgWorkMeta.unmatchedDriverRows))};
      неоднозначных соответствий ${esc(present(ktgWorkMeta.ambiguousDriverRows))};
      без рудника/Наим1 ${esc(present(ktgWorkMeta.missingDimensionsRows))};
      с некорректной длительностью ${esc(present(ktgWorkMeta.invalidDurationRows))};
      незавершённых ${esc(present(ktgWorkMeta.unfinishedRows))}.
      Эти счётчики относятся ко всему Dataset; выборочные показатели — ниже.</p>
      <p>В выбранном срезе:
      оборудования Drivers ${esc(present(ktgMatch.equipmentUnits))} шт.;
      групп обращений ${esc(present(ktgMatch.selectedWorkGroups))};
      пригодных обращений ${esc(present(ktgMatch.selectedUsableTaskRows))};
      обращений с невалидными часами ${esc(present(ktgMatch.selectedUnknownDurationRows))};
      незавершённых обращений ${esc(present(ktgMatch.selectedUnfinishedRows))}.
      <strong>Допущение:</strong> ТО план = фактическое плановое ТО из ITSM;
      требуется отдельный нормативный источник. По Drivers применяется
      текущая фиксированная численность, не исторические остатки.
      Время предбэклога — длительность обращения, не доказанный простой оборудования.</p>
    </section>`:'';
    const vbrStats=entry.id==='vbr'?snapshot?.results?.vbr?.diagnostics:null;
    const vbrEvidence=vbrStats?`<section class="kpi-passport-trace-caveats">
      <h4>Проверка январского и других месяцев ВБР: наблюдаемость ITSM</h4>
      <p>ВБР за выбранный календарный период: численность берётся из Drivers,
      а фактические отказы — только из завершённых INC, которым присвоено
      решение «Считать отказом». Событие учитывается по дате выполнения,
      при её отсутствии — по дате закрытия. Наличие численности Drivers
      само по себе не подтверждает полноту данных ITSM за период.</p>
      <p>После выбранных фильтров ITSM:
        обращений INC с датой выполнения — ${esc(present(vbrStats.selectedIncCount))};
        событий отказов — ${esc(present(trace.components?.failureCount))};
        подготовленных компонентных групп — ${esc(present(vbrStats.selectedFailureComponentGroups))}.
      </p>
      <p>Во всём ITSM за выбранный период (без рудника и класса):
        INC с датой выполнения — ${esc(present(vbrStats.globalIncCount))};
        учитываемых отказов — ${esc(present(vbrStats.globalFailureCount))};
        отказов без определённого класса — ${esc(present(vbrStats.unclassifiedGlobalFailures))}.
        Месяцев без зарегистрированных ITSM INC/RITM —
        ${esc(present(vbrStats.missingItsmMonths||[]))}.</p>
      <p><strong>Интерпретация:</strong> если в исходном ITSM за месяц есть отказы,
      но после выбора рудника/класса их стало 0, необходимо сверить значения
      «Территории MES» и «Услуга СДГР (по наименованию)».
      Если в исходном ITSM вообще нет датированных INC/RITM за месяц,
      показатель помечается как не имеющий достаточного подтверждения,
      а не автоматически принимается равным 100%.</p>
    </section>`:'';
    const html=factGrid([
      ['Статус доказательств',evidenceLabel],
      ['Время расчёта',snapshot?.calculatedAt || '—'],
      ['Версия трассировки',trace.version],
      ['Версия Calculation Contract',trace.contractVersion],
      ['Версия формулы',trace.formulaVersion],
      ['Выбранный период',present(trace.period)],
      ['Фильтры запроса',Object.entries(trace.filters||{}).map(([key,value])=>
        key+' = '+present(value)).join('; ') || 'Без ограничений'],
      ['Итоговое состояние',VALUE_STATES[trace.dataState] || trace.dataState],
      ['Причина',trace.reason || '—'],
      ['Рассчитанный результат',Number.isFinite(trace.value)?
        number(trace.value,entry.definition.unit):'—']
    ])+
      '<h4>Источники: объём и ревизии Dataset</h4>'+
      table(['Dataset','Доступность','Исходных записей (весь набор)','Ревизия','Хеш','Дата источника'],
        sourceRows,'Источники не подключены.')+
      ktgEvidence+vbrEvidence+
      '<h4>Подготовка: агрегированные компоненты</h4>'+
      table(['Таблица','Подготовленных групп','Измерения','Диагностика подготовки'],
        prepRows,'Подготовленных компонент нет.')+
      '<h4>Выполненные отборы и условия</h4>'+
      table(['Этап / условие','На входе','На выходе','Исключено / результат'],
        records,'Calculator не выполнял инструментированный отбор для этого показателя.')+
      '<h4>Фактические компоненты и результат</h4>'+
      table(['Компонент KPI Result','Значение'],actualComponents,
        'Компоненты не сформированы.')+
      `<div class="kpi-passport-trace-caveats"><h4>Границы наблюдаемости</h4>
        <p>Пошаговая трассировка фильтров зафиксирована при выполнении Calculator. Объёмы подготовленных групп не равны количеству исходных заявок или задач.</p>
        <ul>${(trace.caveats || []).map(item=>`<li>${esc(item)}</li>`).join('')}</ul>
      </div>`;
    const content='<div class="kpi-passport-trace-content">'+html+'</div>';
    if(embedded)return '<p class="kpi-passport-trace-status">'+esc(evidenceLabel)+'</p>'+content;
    return `<details class="kpi-passport-execution-trace">
      <summary>Показать расчёт <span class="kpi-passport-trace-label">${esc(evidenceLabel)}</span></summary>
      ${content}
    </details>`;
  }

  // The reference layout for reliability KPIs shares one technical-document
  // hierarchy. The evidence remains attached to Snapshot and is not recomputed.
  function referenceTechnicalDocument(entry,contract,sourceStates,snapshot) {
    const rawFormula='<code class="kpi-passport-formula-raw">'+
      esc(contract.formula.expression)+'</code>'+
      factGrid([
        ['Версия формулы',contract.formula.formulaVersion],
        ['Подготовка',contract.preparationHandler],
        ['Обработчик расчёта',contract.formulaHandler],
        ['Компоненты',contract.sourceComponents.join(', ')]
      ]);
    const disclosure=(id,title,html)=>'<details class="kpi-passport-tech-item" id="kpi-passport-'+
      esc(id)+'"><summary>'+esc(title)+'</summary><div class="kpi-passport-tech-item-body">'+
      html+'</div></details>';
    const sourceBlocks=contract.sources.map(source=>{
      const single={...contract,sources:[source]};
      return disclosure('source-'+source.datasetId,DATASET_NAMES[source.datasetId]||source.datasetId,
        sourceView(single,sourceStates));
    }).join('');
    const contractBlocks=
      section('joins','Связи данных',joinView(contract.joins))+
      section('filters','Фильтрация и исключения',filterView(contract.filters,snapshot?.query?.calculator))+
      section('steps','Расчётная цепочка',stepsView(contract.steps))+
      section('aggregation','Агрегирование и арифметика',aggregationView(contract))+
      section('periods','Периоды и прогноз',temporalView(contract));
    return section('sources','Источники и колонки · Техническая документация: контракты источников',
      '<div class="kpi-passport-tech-list">'+sourceBlocks+
      disclosure('operations','Связи, фильтры, операции, агрегация и периоды',
        rawFormula+contractBlocks)+
      '</div>');
  }

  // A single format for all KPIs. The catalog is the method source of truth; the
  // Snapshot supplies facts and month series. This view never calculates KPI values.
  const PASSPORT_TABS=Object.freeze([
    ['overview','Обзор'],['method','Методика'],['data','Данные'],['monitor','Динамика и контроль']
  ]);

  function renderMiniTrend(entry,snapshot) {
    const points=Array.from(snapshot?.kpiView?.seriesById?.[entry.id]?.points || []).slice(-12);
    if(!points.length)return '<p class="kpi-passport-empty">Помесячный ряд отсутствует в текущем Report Snapshot. График не строится по предположениям.</p>';
    const valid=points.map(point=>point?.dataState==='available'&&Number.isFinite(point.value)?point.value:null);
    const values=valid.filter(Number.isFinite);
    if(!values.length)return '<p class="kpi-passport-empty">Для выбранных месяцев нет рассчитанных значений. Пропуски не заменяются нулём.</p>';
    const actualMin=Math.min(...values),actualMax=Math.max(...values);
    const range=actualMax-actualMin;
    const left=65,right=740,top=18,bottom=148;
    const x=index=>left+(points.length===1?0:index/(points.length-1)*(right-left));
    const y=value=>range===0?(top+bottom)/2:bottom-(value-actualMin)/range*(bottom-top);
    const segments=[];
    let segment=[];
    valid.forEach((value,index)=>{
      if(value===null){if(segment.length)segments.push(segment);segment=[];return;}
      segment.push(x(index).toFixed(1)+','+y(value).toFixed(1));
    });
    if(segment.length)segments.push(segment);
    const lines=segments.map(coords=>coords.length>1
      ?'<polyline points="'+coords.join(' ')+'" />'
      :'<circle cx="'+coords[0].split(',')[0]+'" cy="'+coords[0].split(',')[1]+'" r="3.5" />').join('');
    const lastIndex=valid.findLastIndex(value=>value!==null);
    const last=points[lastIndex];
    const first=points[0]?.period||'—',ending=points[points.length-1]?.period||'—';
    const chart='<svg viewBox="0 0 760 190" role="img" aria-label="'+
      esc('Фактическая динамика '+entry.definition.title+': '+first+' — '+ending)+
      '" class="kpi-passport-sparkline">'+
      '<line class="kpi-passport-chart-grid" x1="'+left+'" y1="'+top+'" x2="'+right+'" y2="'+top+'" />'+
      '<line class="kpi-passport-chart-grid" x1="'+left+'" y1="'+bottom+'" x2="'+right+'" y2="'+bottom+'" />'+
      '<text x="6" y="'+(top+5)+'">'+esc(number(actualMax,''))+'</text>'+
      '<text x="6" y="'+(bottom+5)+'">'+esc(number(actualMin,''))+'</text>'+
      '<g class="kpi-passport-chart-series">'+lines+'</g>'+
      '<text x="'+left+'" y="179">'+esc(first)+'</text>'+
      '<text x="'+right+'" y="179" text-anchor="end">'+esc(ending)+'</text>'+
      '</svg>';
    return '<figure class="kpi-passport-trend">'+chart+
      '<figcaption>Факт по месяцам из Report Snapshot · показано '+values.length+
      ' из '+points.length+' значений · последнее доступное: '+
      esc(number(last.value,entry.definition.unit))+' ('+esc(last.period)+
      '). Разрывы означают отсутствие расчётных значений. Тренд не является прогнозом.</figcaption></figure>';
  }

  function passportSummary(entry,snapshot) {
    const result=snapshot?.results?.[entry.id]||null;
    const current=snapshot?.kpiView?.cards?.[entry.id]?.current;
    const state=current?.dataState||result?.dataState||(snapshot?'not-applicable':'unavailable');
    const value=state==='available'?(current?.value??result?.value):null;
    const hasValue=Number.isFinite(value);
    return '<div class="kpi-passport-summary" aria-label="Сводка показателя">'+
      '<div><span>Фактическое значение</span><strong>'+
      esc(hasValue?number(value,entry.definition.unit):'—')+'</strong></div>'+
      '<div><span>Цель</span><strong>'+esc(entry.definition.target===null?'Не утверждена':present(entry.definition.target))+'</strong></div>'+
      '<div><span>Состояние</span><strong>'+esc(VALUE_STATES[state]||state)+'</strong></div>'+
      '</div>';
  }

  function passportTabShell(entry,panels,activeTab) {
    const selected=PASSPORT_TABS.some(tab=>tab[0]===activeTab)?activeTab:'overview';
    const tabs='<div class="kpi-passport-tabs" role="tablist" aria-label="Разделы паспорта">'+
      PASSPORT_TABS.map(([id,title])=>'<button type="button" role="tab" data-kpi-passport-tab="'+id+
        '" id="kpi-passport-tab-'+id+'" aria-controls="kpi-passport-panel-'+id+
        '" aria-selected="'+(id===selected)+'" tabindex="'+(id===selected?'0':'-1')+'">'+
        esc(title)+'</button>').join('')+'</div>';
    return '<div class="kpi-passport-layout" data-kpi-id="'+esc(entry.id)+'">'+tabs+
      PASSPORT_TABS.map(([id,title])=>'<div class="kpi-passport-panel" role="tabpanel" id="kpi-passport-panel-'+id+
        '" aria-labelledby="kpi-passport-tab-'+id+'"'+(selected===id?'':' hidden')+'>'+
        panels[id]+'</div>').join('')+'</div>';
  }

  // Event delegation survives asynchronous Snapshot repaint and makes page and
  // dialog use identical tab behavior. Call once per stable container.
  function bindTabs(container,onSelect,onForecastChange) {
    if(!container?.addEventListener)return;
    container.addEventListener('change',event=>{
      const control=event.target?.closest?.('[data-kpi-passport-forecast]');
      if(!control||!container.contains(control))return;
      const id=control.dataset.kpiPassportForecast;
      const preference=globalThis.ReclassifierKpiForecastEngine?.forecastPreferences;
      try{
        preference.set(id,control.value,'passport');
        if(typeof onForecastChange==='function')onForecastChange(id);
      }catch(_){control.value=preference?.get(id)||'auto';}
    });
    container.addEventListener('click',event=>{
      const button=event.target?.closest?.('[data-kpi-passport-tab]');
      if(!button||!container.contains(button))return;
      select(button.dataset.kpiPassportTab,false);
    });
    container.addEventListener('keydown',event=>{
      const button=event.target?.closest?.('[data-kpi-passport-tab]');
      if(!button||!container.contains(button))return;
      const keys=['ArrowLeft','ArrowRight','Home','End'];
      if(!keys.includes(event.key))return;
      const all=Array.from(container.querySelectorAll?.('[data-kpi-passport-tab]')||[]);
      const index=all.indexOf(button);
      if(index<0)return;
      const next=event.key==='Home'?0:event.key==='End'?all.length-1:
        (index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length;
      event.preventDefault?.();
      all[next]?.click?.();
      all[next]?.focus?.();
    });
    function select(tab,focus) {
      const selected=PASSPORT_TABS.some(pair=>pair[0]===tab)?tab:'overview';
      const buttons=Array.from(container.querySelectorAll?.('[data-kpi-passport-tab]')||[]);
      const panels=Array.from(container.querySelectorAll?.('.kpi-passport-panel')||[]);
      buttons.forEach(button=>{
        const active=button.dataset.kpiPassportTab===selected;
        button.setAttribute('aria-selected',String(active));
        button.tabIndex=active?0:-1;
        if(active&&focus)button.focus();
      });
      panels.forEach(panel=>{panel.hidden=panel.id!=='kpi-passport-panel-'+selected;});
      if(typeof onSelect==='function')onSelect(selected);
    }
  }

  function renderContent(kpiId,options={}) {
    const entry=catalog.get(kpiId);
    if(!entry)return '<div class="kpi-passport-missing" role="alert">Паспорт KPI не найден.</div>';
    const def=entry.definition,c=entry.calculation,snap=options.snapshot||null;
    const group=catalog.groups.find(group=>group.id===def.category);
    const stateText=entry.calculationState==='implemented'?'Расчёт подключён':'Расчёт не подключён';
    const introduction='<header class="kpi-passport-intro">'+
      '<div class="kpi-passport-eyebrow">'+esc(group?.title||def.category)+'</div>'+
      '<h2 id="reliabilityKpiPassportTitle" tabindex="-1">'+esc(def.fullTitle||def.title)+'</h2>'+
      '<p class="kpi-passport-intro-definition">'+esc(def.definition)+'</p>'+
      '<div class="kpi-passport-badges"><span>Код: '+esc(def.id)+'</span><span>'+esc(stateText)+'</span>'+
      '<span>Методика: '+esc(def.methodology.status)+'</span>'+
      '<span>Версия: '+esc(def.methodology.version)+'</span></div></header>';
    const info=section('overview','Описание и назначение',
      '<div class="kpi-passport-overview-prose">'+[
        ['Назначение',def.purpose],['Единица измерения',def.unit],
        ['Направление улучшения',DIRECTIONS[def.direction]||def.direction],
        ['Цель / порог',def.target===null?'Не утверждены':present(def.target)]
      ].map(([label,value])=>'<p><strong>'+esc(label)+':</strong> '+esc(present(value))+'</p>').join('')+'</div>');
    const noMethod='<p class="kpi-passport-caution">Расчёт ещё не реализован: колонки, фильтры, формула, связи и агрегирование для этого KPI не утверждены и не подключены. Значения, источники и формулы не подменяются демонстрационными.</p>';
    const introLimits=section('interpretation','Интерпретация и ограничения',
      '<p><strong>Направление улучшения:</strong> '+esc(DIRECTIONS[def.direction]||def.direction)+
      '</p><p><strong>Границы применимости:</strong> '+esc(def.limitation||'Дополнительные ограничения не заданы в каталоге.')+'</p>');
    const control=section('control','Контроль методики',factGrid([
      ['Код',entry.id],['Каталог KPI',catalog.version],
      ['Версия методики',def.methodology.version],
      ['Статус методики',def.methodology.status],
      ['Основание методики',def.methodology.reference||'Не указано'],
      ['Версия формулы',c?.formula?.formulaVersion||'Не назначена'],
      ['Версия расчётного контракта',c?.contractVersion||'Не назначена'],
      ['Дата расчёта',snap?.calculatedAt||'Снимок не загружен']
    ]));
    const panels={
      overview:info+section('fact','Текущий результат и происхождение',provenanceView(entry,snap))+introLimits,
      method:section('formula','Формула расчёта',c
        ?mathPresenter.render(entry.id)+
          '<details class="kpi-passport-formula-technical"><summary>Машинная запись и версия формулы</summary>'+
          '<code class="kpi-passport-formula-raw">'+esc(c.formula.expression)+'</code>'+
          factGrid([['Версия',c.formula.formulaVersion],['Обработчик',c.formulaHandler],
            ['Компоненты',c.sourceComponents.join(', ')]])+'</details>'
        :noMethod)+section('method','Как рассчитывается показатель',
          c?narrativeView(c,snap?.query?.calculator,entry.id):noMethod),
      data:c?referenceTechnicalDocument(entry,c,new Map(Array.from(snap?.sources||[]).map(source=>[source.id,source])),snap)
        :section('sources','Техническая документация',noMethod),
      monitor:section('visual','Динамика',renderMiniTrend(entry,snap))+
        section('forecast','Прогноз и контроль качества',c?forecastMethodControl(entry)+forecastView(entry,snap)+lagAuditView(entry,snap,options.lagAudit):noMethod)+
        section('trace','Фактическая трассировка',executionEvidenceView(entry,snap))+control
    };
    return introduction+passportSummary(entry,snap)+passportTabShell(entry,panels,options.activeTab);
  }

  const api=Object.freeze({renderContent,bindTabs});
  globalThis.ReclassifierKpiPassportView=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
