(() => {
  'use strict';

  const RULES_VERSION = '1.5.0';

  const OUTPUT_COLUMNS = [
    'Участок',
    'Подразделение',
    'Ссылка на заявку',
    'Заявка',
    'Номер задачи',
    'Инициатор',
    'Дата запроса',
    'Статус',
    'Описание',
    'Объединённый комментарий',
    'Тип задачи',
    'Навесное / Стационарное',
    'Местоположение',
    'Горизонт',
    'Наименование системы',
    'Тип оборудования',
    'Единица оборудования',
    'Транспорт',
    'Оборудование',
    'Элемент',
    'Неисправность',
    'Причина инцидента',
    'Смена',
    'Бригада',
    'Фактическая дата',
    'Фактические трудозатраты',
    'Количество смен',
    'Количество человек в бригаде',
    '% Фактической загрузки по смене',
    'Статус проверки ОПиН',
    'ФактТрудочас, чел-час',
    'ФактАстрочас, час',
    'Ненулевые Труды',
    'МесСмены',
    'ГодСмены',
    'Итог Новый тип задач',
    'Дата создания вызова ITSM',
    'Возраст пред-бэклога'
  ];


  const FORMAL_COMMENT_PATTERNS = [
    /^выполнено[.! ]*$/i,
    /^закрыто[.! ]*$/i,
    /^завершено[.! ]*$/i,
    /^работы? завершен[аы]?[.! ]*$/i,
    /^задача выполнена[.! ]*$/i,
    /^принято[.! ]*$/i,
    /^устранено[.! ]*$/i,
    /^согласно заявке[.! ]*$/i,
    /^работа проведена[.! ]*$/i
  ];

  const FAULT_PATTERNS = [
    /неисправ/i,
    /отказ/i,
    /полом/i,
    /поврежд/i,
    /не\s*работ/i,
    /неработ/i,
    /отсутств\w*\s+(связ|данн|питан|изображ)/i,
    /нет\s+(связ|данн|питан|изображ)/i,
    /не\s+выходит\s+на\s+связ/i,
    /нестабил/i,
    /некоррект/i,
    /ремонт/i,
    /восстанов/i,
    /дефект/i,
    /диагност/i,
    /поиск\w*\s+неисправ/i,
    /ревизи/i,
    /обследован/i,
    /провер\w*\s+работоспособ/i,
    /провер\w*\s+по\s+факту\s+жалоб/i,
    /замен\w*[^.\n]{0,50}(неисправ|поврежд|отказ|износ)/i,
    /устран\w*\s+(замеч|недостат|отказ|дефект)/i,
    /додел/i,
    /ложн\w*\s+срабатыван/i,
    /отклонен\w*\s+(параметр|показан)/i,
    /просад\w*\s+питан/i,
    /обрыв/i,
    /износ/i
  ];

  const CONSTRUCT_PATTERNS = [
    /монтаж\w*\s+(нов|дополн)/i,
    /установ\w*\s+(нов|дополн)/i,
    /нов\w*\s+(оборуд|камер|датчик|блок|антенн|шкаф|регистратор|лини|кабел|трасс)/i,
    /дополнительн\w*\s+(оборуд|камер|датчик|блок|антенн|элемент|точк|канал)/i,
    /дооснащ/i,
    /дооборуд/i,
    /оснащен\w*\s+техник/i,
    /перенос/i,
    /перемещ\w*\s+на\s+нов/i,
    /измен\w*\s+(мест|зон|схем|конфигурац|комплектац)/i,
    /переоснащ/i,
    /модерниз/i,
    /демонтаж/i,
    /вывод\w*\s+из\s+эксплуатац/i,
    /проклад\w*\s+(нов|дополн)/i,
    /создан\w*\s+(нов|дополн)\w*\s+(лини|канал|точк)/i,
    /rfid/i,
    /uwb/i,
    /поверк/i,
    /консервац/i
  ];

  const MAINTENANCE_PATTERNS = [
    /техническ\w*\s+обслуживан/i,
    /дополнительн\w*\s+то(?=\s|$|[.,;:])/i,
    /внеочередн\w*\s+то(?=\s|$|[.,;:])/i,
    /повторн\w*\s+то(?=\s|$|[.,;:])/i,
    /(?:^|\s)то\s+(нов|исправн|оборуд)/i,
    /обслуживан\w*\s+(вне\s*график|по\s+заявк|нов\w*\s+оборуд)/i,
    /профилакти/i,
    /профилактическ\w*\s+(очист|регулиров|обслуж)/i,
    /дополнительн\w*\s+(очист|протяж|провер)/i
  ];

  const OTHER_PATTERNS = [
    /достав/i,
    /перевоз/i,
    /транспортиров/i,
    /погруз/i,
    /разгруз/i,
    /перемещ\w*\s+(груз|на\s+склад)/i,
    /получен\w*\s+оборуд/i,
    /передач\w*\s+оборуд/i,
    /складск/i,
    /уборк/i,
    /мойк/i,
    /хозяйствен/i,
    /оформлен\w*\s+(документ|допуск|наряд)/i,
    /согласован/i,
    /совещан/i,
    /подготов\w*\s+отчет/i,
    /инвентаризац/i,
    /организац\w*\s+(доступ|сопровожд|поддерж)/i,
    /сопровожд\w*\s+(подряд|работ|груз)/i,
    /ожидан\w*\s+(техник|допуск|окн)/i,
    /консульт/i
  ];

  function text(value) {
    return value === null || value === undefined
      ? ''
      : String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  // Shared ITSM date decoding for the first MB Excel import and subsequent
  // re-enrichment from accumulated ITSM records. Keep wall-clock semantics of
  // the original Worker parser, including historical dd.mm.yyyy exports.
  function parseItsmCreatedAt(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    if (typeof value === 'number' && Number.isFinite(value) &&
        globalThis.XLSX?.SSF?.parse_date_code) {
      const parsed = globalThis.XLSX.SSF.parse_date_code(value);
      if (parsed?.y && parsed?.m && parsed?.d) {
        return new Date(parsed.y, parsed.m - 1, parsed.d,
          parsed.H || 0, parsed.M || 0, Math.floor(parsed.S || 0));
      }
    }
    const normalized = text(value);
    if (!normalized) return null;
    // SQLite stores Date objects as ISO timestamps with explicit UTC offsets.
    // Interpret those as instants, unlike zone-less export wall-clock dates.
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
      const zoned = Date.parse(normalized);
      return Number.isNaN(zoned) ? null : new Date(zoned);
    }
    let match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const year = match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]);
      const date = new Date(year, Number(match[2]) - 1, Number(match[1]),
        Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1,
        Number(match[3]), Number(match[4] || 0), Number(match[5] || 0),
        Number(match[6] || 0));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }

  function roundLaborHours(value, digits = 6) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  }

  function laborResult(hours, state) {
    return Object.freeze({ hours, state });
  }

  function validLaborResult(value) {
    const rounded = roundLaborHours(value);
    if (rounded === null || rounded < 0) return laborResult(null, 'invalid');
    return laborResult(rounded, rounded === 0 ? 'valid_zero' : 'valid');
  }

  function parseLaborHours(value) {
    if (value === null || value === undefined) return laborResult(null, 'missing');
    if (typeof value === 'number') {
      return Number.isFinite(value) ? validLaborResult(value) : laborResult(null, 'invalid');
    }

    const raw = text(value);
    if (!raw) return laborResult(null, 'missing');

    const normalized = raw.toLocaleLowerCase('ru-RU').replace(',', '.');
    const plain = Number(normalized);
    if (Number.isFinite(plain)) return validLaborResult(plain);

    const days = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:д\.?|дн(?:я|ей)?)/i);
    const hours = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:ч\.?|час(?:а|ов)?)/i);
    const minutes = normalized.match(/(-?\d+(?:\.\d+)?)\s*(?:мин\.?|минут(?:а|ы)?)/i);

    if (days || hours || minutes) {
      const total =
        (days ? Number(days[1]) * 24 : 0) +
        (hours ? Number(hours[1]) : 0) +
        (minutes ? Number(minutes[1]) / 60 : 0);
      return validLaborResult(total);
    }

    const clock = normalized.match(/^(-?\d+):(\d{1,2})(?::(\d{1,2}))?$/);
    if (clock) {
      if (clock[1].startsWith('-')) return laborResult(null, 'invalid');
      const clockMinutes = Number(clock[2]);
      const clockSeconds = Number(clock[3] || 0);
      if (clockMinutes > 59 || clockSeconds > 59) return laborResult(null, 'invalid');
      return validLaborResult(
        Number(clock[1]) + clockMinutes / 60 + clockSeconds / 3600
      );
    }

    return laborResult(null, 'invalid');
  }

  function extractTaskForShiftId(value) {
    const match = text(value).match(/\/tasks-for-shift\/(\d+)/i);
    return match ? match[1] : '';
  }

  function mobileBrigadeRecordKey(record) {
    const site = key(record?.site);
    const taskNumber = key(record?.taskNumber);
    if (site && taskNumber) return site + '|' + taskNumber;
    const taskForShiftId = text(record?.taskForShiftId) || extractTaskForShiftId(record?.requestUrl);
    return taskForShiftId ? 'mbid|' + taskForShiftId : '';
  }

  function normalizeTaskType(value) {
    const raw = text(value);
    const upper = raw.toLocaleUpperCase('ru-RU');
    if (upper === 'ETO' || upper === 'ЕТО') return 'ЕТО';
    if (upper === 'ОПИН' || upper === 'OPIN') return 'ОПиН';
    if (upper === 'ЗНО') return 'ЗНО';
    if (upper === 'ПРОЧЕЕ') return 'Прочее';
    if (upper === 'АВР') return 'АВР';
    if (upper === 'ТО') return 'ТО';
    return raw;
  }

  function isFormalComment(value) {
    const normalized = text(value);
    if (!normalized) return true;
    return FORMAL_COMMENT_PATTERNS.some(pattern => pattern.test(normalized));
  }

  function matchesAny(value, patterns) {
    const normalized = text(value);
    return Boolean(normalized) && patterns.some(pattern => pattern.test(normalized));
  }

  function sourceCommentText(value) {
    return value === null || value === undefined
      ? ''
      : String(value).replace(/\u00a0/g, ' ').trim();
  }

  function stripServiceCommentPrefix(value) {
    let result = sourceCommentText(value);
    const prefixPattern = /^\s*[^:\n]{1,160}\(\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}(?:[,\sT]+\d{1,2}:\d{2}(?::\d{2})?)?\s*\)\s*:\s*/u;
    while (prefixPattern.test(result)) result = result.replace(prefixPattern, '');
    return result;
  }

  function comparisonCommentText(value) {
    return stripServiceCommentPrefix(value)
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function hasServiceCommentPrefix(value) {
    return stripServiceCommentPrefix(value) !== sourceCommentText(value);
  }

  function combineDistinctComments(first, second) {
    return 'Комментарий:\n' + first + '\n\nКомментарий по закрытой задаче:\n' + second;
  }

  function preferredDuplicateComment(comment, closeComment) {
    const first = sourceCommentText(comment);
    const second = sourceCommentText(closeComment);
    const firstHasPrefix = hasServiceCommentPrefix(first);
    const secondHasPrefix = hasServiceCommentPrefix(second);

    if (firstHasPrefix && secondHasPrefix && first !== second) {
      return combineDistinctComments(first, second);
    }
    if (firstHasPrefix !== secondHasPrefix) return firstHasPrefix ? first : second;
    return second.length > first.length ? second : first;
  }

  function mergeComments(comment, closeComment) {
    const first = sourceCommentText(comment);
    const second = sourceCommentText(closeComment);

    if (!first) return second;
    if (!second) return first;

    const firstCompare = comparisonCommentText(first);
    const secondCompare = comparisonCommentText(second);

    if (!firstCompare) return second;
    if (!secondCompare) return first;

    if (firstCompare === secondCompare) {
      return preferredDuplicateComment(first, second);
    }

    if (firstCompare.includes(secondCompare)) {
      if (hasServiceCommentPrefix(second) && !hasServiceCommentPrefix(first)) {
        return combineDistinctComments(first, second);
      }
      return first;
    }
    if (secondCompare.includes(firstCompare)) {
      if (hasServiceCommentPrefix(first) && !hasServiceCommentPrefix(second)) {
        return combineDistinctComments(first, second);
      }
      return second;
    }

    return combineDistinctComments(first, second);
  }

  function classifySignals(value) {
    if (!text(value)) return null;
    if (matchesAny(value, FAULT_PATTERNS)) return 'Корректирующее воздействие';
    if (matchesAny(value, CONSTRUCT_PATTERNS)) return 'ЗНО (монтажи, переносы)';
    if (matchesAny(value, MAINTENANCE_PATTERNS)) return 'ТО вне графика';
    if (matchesAny(value, OTHER_PATTERNS)) return 'Прочее';
    return null;
  }

  function classifyTask(record) {
    const sourceType = normalizeTaskType(record?.type);

    if (sourceType === 'АВР') return 'АВР';
    if (sourceType === 'ТО') return 'ТО по графику';
    if (sourceType === 'ЕТО') return 'Прочее';
    if (sourceType === 'ОПиН') return 'Корректирующее воздействие';

    if (sourceType !== 'ЗНО' && sourceType !== 'Прочее') {
      return sourceType;
    }

    const comments = [record?.comment, record?.closeComment]
      .map(text)
      .filter(value => value && !isFormalComment(value));
    const commentText = comments.join(' ');
    const description = text(record?.description);

    // Фактически выполненная работа из комментария имеет приоритет.
    const byComment = classifySignals(commentText);
    if (byComment) return byComment;

    // Затем анализируется исходная постановка и общий контекст.
    const byDescription = classifySignals(description);
    if (byDescription) return byDescription;

    const byCombined = classifySignals([description, commentText].filter(Boolean).join(' '));
    if (byCombined) return byCombined;

    return sourceType === 'ЗНО' ? 'ЗНО (монтажи, переносы)' : 'Прочее';
  }

  const api = Object.freeze({
    version: RULES_VERSION,
    outputColumns: Object.freeze(OUTPUT_COLUMNS.slice()),
    text,
    key,
    parseLaborHours,
    parseItsmCreatedAt,
    normalizeTaskType,
    extractTaskForShiftId,
    mobileBrigadeRecordKey,
    isFormalComment,
    stripServiceCommentPrefix,
    mergeComments,
    classifySignals,
    classifyTask
  });

  if (typeof globalThis !== 'undefined') globalThis.ReclassifierMobileBrigadeRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
