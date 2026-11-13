// Evidence extraction only: no failure verdict, classifier branch or repair inference.
(() => {
  'use strict';
  const version = '4.0.0-facts.2';
  const fields = Object.freeze(['shortDescription', 'description', 'closureNote', 'extraReason']);
  const labels = Object.freeze({symptoms:'Симптомы', diagnosis:'Диагностика', action:'Действие', result:'Результат', unknown:'Не определено'});
  const normalize = text => text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const headings = /^(симптомы|диагностика|действие|действия|результат)\s*:\s*/i;
  const categories = {'симптомы':'symptoms', 'диагностика':'diagnosis', 'действие':'action', 'действия':'action', 'результат':'result'};
  // Mentions are lexical anchors, never a choice of failed equipment.
  const objects = [
    ['camera', /камер[а-я]*|видеокамер[а-я]*/giu],
    ['cable', /кабел[а-я]*|кабель/giu],
    ['power_supply', /блок[а-я]*\s+питания|бп/giu],
    ['switch', /коммутатор[а-я]*/giu],
    ['sensor', /датчик[а-я]*/giu]
  ];
  function category(text, field, explicit) {
    if (explicit) return explicit;
    if (/восстановлен[а-я]*|устранен[а-я]*|заработал[а-я]*|работоспособн[а-я]*|без изменений|не помог[а-я]*|результат/.test(text)) return 'result';
    if (/замен[а-я]*|перезагруз[а-я]*|переподключ[а-я]*|демонт[а-я]*|установлен[а-я]*|выполнен[а-я]*|проверить|заменить|настро[а-я]*/.test(text)) return 'action';
    if (/выявлен[а-я]*|обнаружен[а-я]*|диагност[а-я]*|провер[а-я]*|подтвержден[а-я]*|исправен|исправна|обрыв|замер[а-я]*|измерен[а-я]*/.test(text)) return 'diagnosis';
    if (/нет (?:изображения|связи|питания|напряжения|видеопотока|сигнала)|не работает|не включается|пропада[а-я]*|отсутств[а-я]*|перегрев|неисправ[а-я]*|отказ/.test(text)) return 'symptoms';
    return 'unknown';
  }
  function assertion(text, kind) {
    if (/возможн[а-я]*|вероятн[а-я]*|предполож[а-я]*|подозрен[а-я]*|не исключ[а-я]*|может быть|(?:^|\s)если(?:\s|$)|\?/.test(text)) return 'hypothesis';
    if (/необходимо|требуется|планиру[а-я]*|рекоменд[а-я]*|проверить|заменить|будет|предстоит/.test(text)) return 'planned';
    // Absence of a symptom ("нет изображения") asserts that symptom. Only
    // explicit denial of an observation/action is negation here.
    if (/не\s+(?:подтвержден[а-я]*|выявлен[а-я]*|обнаружен[а-я]*|выполнен[а-я]*|проводил[а-я]*|менял[а-я]*|замен[а-я]*|перезагруз[а-я]*|устранен[а-я]*|восстановлен[а-я]*)|нет\s+(?:дефект[а-я]*|поврежден[а-я]*|неисправност[а-я]*)|(?:дефект[а-я]*|поврежден[а-я]*|обрыв[а-я]*)\s+нет/.test(text)) return 'negated';
    return kind === 'symptoms' ? 'reported' : 'stated';
  }
  function extract(source) {
    const facts = [], warnings = [], missingFields = [];
    for (const field of fields) {
      const raw = source?.[field];
      if (raw == null || raw === '') { missingFields.push(field); continue; }
      if (typeof raw !== 'string') { warnings.push({code:'NON_TEXT_FIELD', field}); continue; }
      let inherited = null, sequence = 0;
      // Keep original offsets and punctuation. Never manufacture chronology
      // from record completion dates or assume fields are time ordered.
      const boundaries = /[;\n\r]+|[.!?]+(?=\s|$)|,\s*(?=но\s|а\s|затем\s|после этого\s)|\s+(?=затем\s|после этого\s)/giu;
      let start = 0;
      const ranges = [];
      for (const match of raw.matchAll(boundaries)) {
        const end = match.index + (/^[.!?]/.test(match[0]) ? match[0].length : 0);
        ranges.push([start, end]); start = match.index + match[0].length;
      }
      ranges.push([start, raw.length]);
      // Separate clear compound action/result clauses, keeping uncertainty
      // attached to its whole original fragment rather than losing its scope.
      const atomic = [];
      const compound = /,\s*|\s+и\s+(?=(?:связь|изображение|кабель|камера|блок питания|бп)\s+(?:восстановлен[а-я]*|замен[а-я]*|исправ[а-я]*|неисправ[а-я]*|заработал[а-я]*))/giu;
      for (const [begin,end] of ranges) {
        const part = raw.slice(begin,end);
        if (['hypothesis','planned'].includes(assertion(normalize(part),'unknown'))) { atomic.push([begin,end]); continue; }
        let cursor = begin;
        for (const match of part.matchAll(compound)) {
          atomic.push([cursor,begin+match.index]);
          cursor = begin+match.index+match[0].length;
        }
        atomic.push([cursor,end]);
      }
      for (let [begin, end] of atomic) {
        while (begin < end && /\s/.test(raw[begin])) begin++;
        while (end > begin && /\s/.test(raw[end-1])) end--;
        if (end <= begin) continue;
        const text = raw.slice(begin, end), heading = text.match(headings);
        if (heading) inherited = categories[normalize(heading[1])];
        const normalized = normalize(text);
        let kind = category(normalized, field, inherited);
        let status = assertion(normalized, kind);
        const hasAction = /замен[а-я]*|перезагруз[а-я]*|переподключ[а-я]*/.test(normalized);
        const hasObservation = /обнаружен[а-я]*|выявлен[а-я]*|восстановлен[а-я]*|заработал[а-я]*/.test(normalized);
        const mixed = hasAction && hasObservation;
        if (mixed) { kind = 'unknown'; if (!['hypothesis','planned'].includes(status)) status = 'ambiguous'; }

        const mentions = [];
        for (const [type, regex] of objects) {
          regex.lastIndex = 0;
          for (const match of text.matchAll(regex)) {
            const left = text[match.index-1] || '', right = text[match.index+match[0].length] || '';
            if (/[\p{L}\p{N}_]/u.test(left) || /[\p{L}\p{N}_]/u.test(right)) continue;
            mentions.push({type, text:match[0], start:begin+match.index, end:begin+match.index+match[0].length});
          }
        }
        mentions.sort((a,b) => a.start-b.start);
        const markers = Array.from(text.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b|сначала|затем|после этого|до замены|после замены|ранее|повторно/giu), m => ({text:m[0], start:begin+m.index, end:begin+m.index+m[0].length}));
        facts.push({id:'fact-'+(facts.length+1), field, start:begin, end, text,
          kind, label:labels[kind], assertion:status, mentions, temporalMarkers:markers,
          // A textual assertion is evidence of what was written, not verification.
          independentlyVerified:false, sequenceInField:sequence++});
        if (mixed) warnings.push({code:'MIXED_STATEMENTS', factId:facts.at(-1).id});
        if (kind === 'unknown') warnings.push({code:'UNRESOLVED_ROLE', factId:facts.at(-1).id});
      }
    }
    return freeze({version, facts, warnings, missingFields,
      chronology:{basis:'source_order_within_field', crossFieldOrderKnown:false},
      readyForClassification:false});
  }
  globalThis.ReclassifierTechnicalFactsV4 = Object.freeze({version, fields, labels, extract});
})();
