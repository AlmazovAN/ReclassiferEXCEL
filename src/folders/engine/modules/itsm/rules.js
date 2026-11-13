(() => {
  'use strict';

  const RULES_VERSION = '1.2.1';
  const PLACEHOLDER = '\u200B';
  const OUTPUT_COLUMNS = [
    'НаименованиеТехники',
    'Драйверов по Нименованию',
    'Драйверов по Руднику',
    'рез1 по Наименованию техники',
    'рез3 КТГ по Наименованию оборудования',
    'рез4 КТГ по Руднику',
    'Группа инициаторов',
    'рез6',
    'INC',
    'Наим1',
    'Элем1',
    'Неис1',
    'Прич1',
    'Кач классификации',
    'INC после рекласс',
    'ИсклВБР-ЦГПС',
    'ИсклВБР-Спутник',
    'Связан ли с ИТ-проблемой?',
    'Услуга СДГР (по наименованию)',
    'КФ/ЗФ',
    'ТО/ Монтаж/ Разовое',
    'Система',
    'Время статуса заявки в работе (SLA), час',
    'Время предбэклога (откр-выполн), час',
    'Уровень бэклога, нед',
    'Допустимо 4 чел в бригаде',
    'ГодОткр',
    'МесОткр',
    'НедОткр',
    'ДеньОткр',
    'ГодЗакр',
    'МесЗакр',
    'НедЗакр',
    'Выполненные за последние 14 дней'
  ];

  const NORTH_EXCEPTION_RULES = [
    ['Демонтаж', 'Исключить'],
    ['Дублирование заявки', 'Исключить'],
    ['Отказ не подтверждён', 'Исключить'],
    ['Монтаж', 'Исключить'],
    ['Настройка', 'Исключить'],
    ['Загрязнение объектива', 'Исключить'],
    ['Несвоевременная очистка', 'Исключить'],
    ['Загрязнение объектива при эксплуатации', 'Исключить'],
    ['Закрыт обзор камеры', 'Исключить'],
    ['Запотевание секла СДО', 'Исключить'],
    ['Смещение персоналом в результате эксплуатации', 'Исключить'],
    ['Смонтирован посторонний предмет', 'Исключить'],
    ['Запрос на доступ', 'Исключить'],
    ['Корекция нулевого значения', 'Исключить'],
    ['Корпус залит торкретом при проведении смежных работ', 'Исключить'],
    ['Не закреплена после завершения смежных работ', 'Исключить'],
    ['Недозаряд АКБ (частые перебои в электроснабжении)', 'Исключить'],
    ['Отключение персоналом в процессе эксплуатации', 'Исключить'],
    ['Отключением персоналом', 'Исключить'],
    ['Отсутствие внешнего питания', 'Исключить'],
    ['Отсутствие питания от внешнего источника', 'Исключить'],
    ['Отсутствие питания от источника', 'Исключить'],
    ['Отсутствует SD накопитель (фото, Акт №)', 'Исключить'],
    ['Отсутствует SSD накопитель (фото, Акт №)', 'Исключить'],
    ['Частые сбои рудничного питания', 'Исключить'],
    ['Ошибочное уменьшение яркости персоналом', 'Исключить'],
    ['Предоставление информации', 'Исключить'],
    ['Работа от АКБ без отключения', 'Исключить'],
    ['Смежные работы на гидравлике СДО', 'Исключить'],
    ['Вандализм (Акт, фото)', 'Исключить'],
    ['Умышленное воздействие', 'Исключить'],
    ['умышленное выведение из строя  (Акт №)', 'Исключить'],
    ['Умышленное выведение из строя  (фото, Акт №)', 'Исключить'],
    ['Умышленное выведение из строя (фото, Акт №)', 'Исключить'],
    ['Устаревание значений коэффициентов', 'Исключить'],
    ['Повреждение в результате смежных работ', 'Исключить'],
    ['Повреждение персоналом в процессе эксплуатации', 'Исключить'],
    ['Повреждение персоналом в результате эксплуатации', 'Исключить'],
    ['повреждение при проведении смежных работ', 'Исключить'],
    ['Повреждение при производстве смежных работ', 'Исключить'],
    ['Повреждение кабеля персоналом во время эксплуатации', 'Считать отказом'],
    ['Сбой калибровки', 'Считать отказом'],
    ['повреждение в процессе эксплуатации', 'Считать отказом'],
    ['Внешнее механическое воздействие', 'Считать отказом'],
    ['Механическое воздействие', 'Считать отказом'],
    ['Демонтировано персоналом заказчика ', 'Исключить'],
    ['Умышленное закрытие обзора', 'Исключить'],
    ['Несанкционированное отключение (фото, Акт №)', 'Исключить'],
    ['Несвоевременная очистка в ЕТО', 'Исключить'],
    ['Загораживание посторонними предметами', 'Исключить'],
    ['Повёрнут угол обзора', 'Исключить'],
    ['Отсутствует SD-карта (фото, Акт №)', 'Исключить']
  ];

  function key(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function text(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\u00a0/g, ' ').trim();
  }

  function cleanMineName(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:р\.|ш\.)\s*/i, '');
  }

  function mineKey(value) {
    return key(cleanMineName(value));
  }

  function number(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = text(value).replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function asDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dayStamp(value) {
    if (!value) return null;

    if (typeof value === 'string') {
      const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
    }

    const date = asDate(value);
    if (!date) return null;
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  function diffHours(end, start) {
    if (!end || !start) return null;
    return (end.getTime() - start.getTime()) / 3600000;
  }

  function isoWeek(date) {
    if (!date) return '';
    const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    return Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  }

  function monthName(date) {
    if (!date) return '';
    return ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'][date.getMonth()];
  }

  function classifierKey(equipment, element, fault, reason) {
    return JSON.stringify([equipment, element, fault, reason].map(value => key(value)));
  }

  function sameClassification(left, right) {
    return left.length === right.length && left.every((value, index) => key(value) === key(right[index]));
  }

  function buildLookups(references) {
    const reclassification = new Map();
    for (const record of references.reclassification || []) {
      const recordKey = key(record.number);
      if (recordKey && !reclassification.has(recordKey)) reclassification.set(recordKey, record);
    }

    const driversByName = new Map();
    for (const record of references.drivers || []) {
      const recordKey = key(record.name);
      if (!recordKey) continue;
      if (!driversByName.has(recordKey)) driversByName.set(recordKey, []);
      driversByName.get(recordKey).push(record);
    }

    const initiators = new Map();
    for (const record of references.initiators || []) {
      const recordKey = key(record.initiator);
      if (recordKey && !initiators.has(recordKey)) initiators.set(recordKey, record);
    }

    const customers = new Map();
    for (const record of references.customers || []) {
      const recordKey = record.mineKey || mineKey(record.mine || record.mineSource);
      if (recordKey && !customers.has(recordKey)) customers.set(recordKey, record);
    }

    const typeRequests = new Map();
    for (const record of references.type_request || []) {
      const recordKey = record.requestKey || key(record.shortDescription);
      if (recordKey && !typeRequests.has(recordKey)) typeRequests.set(recordKey, record);
    }

    const exceptions = new Map();
    for (const record of references.exceptions || []) {
      const recordKey = record.exceptionKey || key(record.exception);
      if (recordKey && !exceptions.has(recordKey)) exceptions.set(recordKey, record);
    }

    const northExceptions = new Map(NORTH_EXCEPTION_RULES.map(([reason, decision]) => [key(reason), decision]));

    const problems = new Map();
    for (const record of references.problem_grade || []) {
      const recordKey = record.classifierKey || classifierKey(record.equipment, record.element, record.fault, record.reason);
      if (!problems.has(recordKey)) problems.set(recordKey, []);
      problems.get(recordKey).push(record);
    }

    const problemConflicts = new Map();
    for (const [classifier, records] of problems) {
      const ids = [...new Set(records.map(record =>
        text(record.problemId).toLocaleUpperCase('ru-RU')
      ).filter(id => id.startsWith('PRB')))].sort();
      if (ids.length > 1) problemConflicts.set(classifier, ids);
    }

    const mobileBrigadeAvailable = Array.isArray(references.mobile_brigade_data);
    const mobileBrigadeLatestSourceDay = dayStamp(references.mobile_brigade_meta?.latestSourceDate);
    const mobileBrigadeByRequest = new Map();
    for (const record of references.mobile_brigade_data || []) {
      const recordKey = key(record.request);
      if (!recordKey) continue;
      if (!mobileBrigadeByRequest.has(recordKey)) mobileBrigadeByRequest.set(recordKey, []);
      mobileBrigadeByRequest.get(recordKey).push(record);
    }

    return {
      reclassification,
      driversByName,
      initiators,
      customers,
      typeRequests,
      exceptions,
      northExceptions,
      problems,
      problemConflicts,
      mobileBrigadeAvailable,
      mobileBrigadeLatestSourceDay,
      mobileBrigadeByRequest
    };
  }

  function driverSummary(records, territory) {
    if (!records?.length) return { total: '', mine: '', service: '', system: '' };
    const territoryKey = mineKey(territory);
    const physicalRecords = records.filter(record => mineKey(record.mine) !== 'все рудники');
    const numericPhysical = physicalRecords.filter(record => Number.isFinite(record.value));
    const total = numericPhysical.length
      ? numericPhysical.reduce((sum, record) => sum + record.value, 0)
      : (() => {
          const totalRecord = records.find(record => mineKey(record.mine) === 'все рудники' && Number.isFinite(record.value));
          return totalRecord ? totalRecord.value : '';
        })();
    const mineValues = records
      .filter(record => mineKey(record.mine) === territoryKey && Number.isFinite(record.value))
      .map(record => record.value);
    const mine = mineValues.length ? mineValues.reduce((sum, value) => sum + value, 0) : '';
    const serviceRecord = records.find(record => text(record.service));
    const service = serviceRecord ? serviceRecord.service : (records.length ? 0 : '');
    const system = records.find(record => text(record.system))?.system || '';
    return { total, mine, service, system };
  }

  function mobileBrigadeSummary(records, created, latestSourceDay) {
    if (!records?.length) {
      const createdDay = dayStamp(created);
      const coveredByMobileBrigade = createdDay !== null
        && latestSourceDay !== null
        && createdDay <= latestSourceDay;

      return {
        equipment: coveredByMobileBrigade ? 'нет в МБ' : 'нет данных МБ',
        laborHours: 0
      };
    }

    const identifiers = [];
    const seenIdentifiers = new Set();
    let laborHours = 0;

    for (const record of records) {
      const parsedLabor = number(record.laborHours);
      if (parsedLabor !== null) laborHours += parsedLabor;

      const placement = key(record.equipmentPlacement);
      const candidates = [];
      if (placement.includes(key('Навесное'))) candidates.push(text(record.transport));
      if (placement.includes(key('Стационарное'))) candidates.push(text(record.equipmentUnit));

      for (const candidate of candidates) {
        for (const identifier of candidate.split(';').map(text).filter(Boolean)) {
          const identifierKey = key(identifier);
          if (identifierKey && !seenIdentifiers.has(identifierKey)) {
            seenIdentifiers.add(identifierKey);
            identifiers.push(identifier);
          }
        }
      }
    }

    return {
      equipment: identifiers.join('; '),
      laborHours: Math.round((laborHours + Number.EPSILON) * 1000000) / 1000000
    };
  }

  function classificationQuality({ inc, completed, closed, closureCode, sourceClass, finalClass }) {
    if (!completed && !closed) return inc + ' без изм';
    if (key(closureCode) !== key('Выполнено полностью')) return inc + ' без изм';

    if (inc === 'RITM') {
      if (sameClassification(sourceClass, finalClass)) return 'RITM без изм';
      if (key(finalClass[1]) === key('Не является отказом')) return 'RITM без изм';
      return 'RITM вместо INC';
    }

    if (key(finalClass[1]) === key('Другое')) return 'INC не классифицирован';
    if (sameClassification(sourceClass, finalClass)) return 'INC без изм';
    return 'INC с исправлением';
  }

  function afterReclass(quality, inc) {
    if (quality === 'INC без изм') return inc;
    if (quality === 'RITM без изм') return inc;
    if (quality === 'RITM вместо INC') return 'INC';
    if (quality === 'INC с исправлением') return 'INC';
    if (quality === 'INC не классифицирован') return 'INC';
    return false;
  }

  function evaluateRow(input, lookups, options = {}) {
    const today = asDate(options.asOfDate) || new Date();
    today.setHours(0, 0, 0, 0);

    const created = asDate(input.created);
    const completed = asDate(input.completed);
    const closed = asDate(input.closed);
    const numberValue = text(input.number);
    const territory = text(input.territory);
    const sourceEquipment = text(input.equipment);
    const sourceElement = text(input.element);
    const sourceFault = text(input.fault);
    const sourceReason = text(input.reason);
    const shortDescription = text(input.shortDescription);
    const openedBy = text(input.openedBy);
    const closureCode = text(input.closureCode);

    const cancelled = key(closureCode) === key('Отменено пользователем');
    const inc = cancelled ? '' : (numberValue.toLocaleUpperCase('ru-RU').startsWith('INC') ? 'INC' : 'RITM');

    const reclass = lookups.reclassification.get(key(numberValue));
    // During historical recalculation ReClass may be a partial update. If a
    // request is absent, use its previously approved classification for all
    // dependent calculations instead of reverting to source classification.
    // Normal Excel processing does not pass this option and is unchanged.
    const effectiveClass = reclass || options.fallbackClassification || null;
    const finalEquipment = effectiveClass ? text(effectiveClass.equipment) : sourceEquipment;
    const finalElement = effectiveClass ? text(effectiveClass.element) : sourceElement;
    const finalFault = effectiveClass ? text(effectiveClass.fault) : sourceFault;
    const finalReason = effectiveClass ? text(effectiveClass.incidentReason) : sourceReason;

    const driverRecords = lookups.driversByName.get(key(finalEquipment)) || [];
    const driver = driverSummary(driverRecords, territory);
    const initiator = lookups.initiators.get(key(openedBy));
    const customer = lookups.customers.get(mineKey(territory));
    const requestType = lookups.typeRequests.get(key(shortDescription));

    const mobileBrigade = lookups.mobileBrigadeAvailable
      ? mobileBrigadeSummary(
          Array.isArray(options.mobileBrigadeRows)
            ? options.mobileBrigadeRows
            : (lookups.mobileBrigadeByRequest.get(key(numberValue)) || []),
          created,
          lookups.mobileBrigadeLatestSourceDay
        )
      : { equipment: PLACEHOLDER, laborHours: PLACEHOLDER };

    const sourceClass = [sourceElement, sourceFault, sourceReason];
    const finalClass = [finalElement, finalFault, finalReason];
    const quality = classificationQuality({ inc, completed, closed, closureCode, sourceClass, finalClass });
    const incAfter = afterReclass(quality, inc);

    const problemKey = classifierKey(finalEquipment, finalElement, finalFault, finalReason);
    const problemConflict = lookups.problemConflicts?.get(problemKey) || null;
    if (problemConflict && options.requireUnambiguousProblem) {
      throw new Error('Неоднозначная связь с IT-проблемами для заявки ' + (numberValue || 'без номера') +
        ' по цепочке «' + [finalEquipment, finalElement, finalFault, finalReason].join(' → ') +
        '»: ' + problemConflict.join(', ') + '. Уточните привязку в ProblemGrade.');
    }
    const problemRecord = problemConflict ? null : lookups.problems.get(problemKey)?.[0];
    const linkedProblem = problemRecord && text(problemRecord.problemId).toLocaleUpperCase('ru-RU').startsWith('PRB')
      ? text(problemRecord.problemId)
      : 'нет';

    let sputnikException;
    let exceptionSource = 'default';
    if (cancelled || incAfter === 'RITM') {
      sputnikException = 'Исключить';
      exceptionSource = cancelled ? 'cancelled' : 'ritm';
    } else if (mineKey(territory) === mineKey('р. Северный')) {
      sputnikException = lookups.northExceptions.get(key(finalReason)) || 'Считать отказом';
      exceptionSource = 'north';
    } else {
      sputnikException = lookups.exceptions.get(key(finalReason))?.decision || 'Считать отказом';
      exceptionSource = 'general';
    }

    let cgpsException;
    if (sputnikException === 'Исключить') cgpsException = 'Нормализовать';
    else if (incAfter !== 'INC') cgpsException = 'Нормализовать';
    else cgpsException = problemRecord?.normalizationDecision || 'Не нормализовывать';

    const slaSeconds = number(input.slaWorking);
    const slaHours = slaSeconds === null ? 0 : slaSeconds / 3600;

    let preBacklogHours = 0;
    if (created) {
      if (completed) preBacklogHours = diffHours(completed, created);
      else if (closed) preBacklogHours = diffHours(closed, created);
      else preBacklogHours = Math.max(diffHours(today, created) || 0, 0);
    }

    let backlogLevel;
    if (completed || closed) backlogLevel = 'закрыт';
    else if (!created) backlogLevel = 'н/д';
    else {
      const days = (today.getTime() - created.getTime()) / 86400000;
      backlogLevel = days > 30 ? 'BL5-F' : days > 21 ? 'BL4-A' : days > 14 ? 'BL3' : days > 7 ? 'BL2' : days >= 0 ? 'BL1' : 'н/д';
    }

    const closeDate = completed || closed;
    // The header is retained for XLSX/schema compatibility; no moving 14-day flag is calculated.

    const values = [
      mobileBrigade.equipment,
      driver.total,
      driver.mine,
      PLACEHOLDER,
      PLACEHOLDER,
      PLACEHOLDER,
      initiator?.group || '',
      mobileBrigade.laborHours,
      inc,
      finalEquipment,
      finalElement === '0' ? '' : finalElement,
      finalFault === '0' ? '' : finalFault,
      finalReason === '0' ? '' : finalReason,
      quality,
      incAfter,
      cgpsException,
      sputnikException,
      linkedProblem,
      driver.service,
      customer?.customerInternal || '',
      requestType?.workType || '',
      driver.system,
      slaHours,
      preBacklogHours,
      backlogLevel,
      PLACEHOLDER,
      created ? created.getFullYear() : '',
      monthName(created),
      isoWeek(created),
      created ? created.getDate() : '',
      closeDate ? closeDate.getFullYear() : '',
      monthName(closeDate),
      isoWeek(closeDate),
      ''
    ];

    return {
      values,
      output: Object.fromEntries(OUTPUT_COLUMNS.map((column, index) => [column, values[index]])),
      audit: {
        reclassified: Boolean(reclass),
        missingDrivers: !driverRecords.length,
        missingInitiator: !initiator,
        missingCustomer: !customer,
        missingTypeRequest: !requestType,
        linkedProblem: linkedProblem !== 'нет',
        problemConflict,
        exceptionSource,
        sputnikExcluded: sputnikException === 'Исключить'
      }
    };
  }

  const api = Object.freeze({
    version: RULES_VERSION,
    placeholder: PLACEHOLDER,
    outputColumns: Object.freeze(OUTPUT_COLUMNS.slice()),
    northExceptionRules: Object.freeze(NORTH_EXCEPTION_RULES.map(item => Object.freeze(item.slice()))),
    key,
    text,
    mineKey,
    classifierKey,
    dayStamp,
    buildLookups,
    mobileBrigadeSummary,
    classificationQuality,
    evaluateRow
  });

  if (typeof globalThis !== 'undefined') globalThis.ReclassifierItsmRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
