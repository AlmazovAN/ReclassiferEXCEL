function readRcaPlanTemplates(book) {
  const clean = value => String(value ?? '').trim();
  const normalizeHeader = value => clean(value).replace(/\s+/gu, ' ').toLowerCase().replace(/ё/gu, 'е');
  function readSheet(name, required) {
    const sheet = book.Sheets?.[name];
    if (!sheet?.['!ref']) throw new Error('Отсутствует лист «' + name + '».');
    const range = XLSX.utils.decode_range(sheet['!ref']);
    range.e.r = range.s.r;
    const header = XLSX.utils.sheet_to_json(sheet, {header:1, raw:true, range})[0] ?? [];
    const headers = new Set(header.map(normalizeHeader));
    const missing = required.filter(label => !headers.has(normalizeHeader(label)));
    if (missing.length) throw new Error('Лист «' + name + '»: отсутствуют столбцы ' + missing.join(', ') + '.');
    return XLSX.utils.sheet_to_json(sheet, {defval:null, raw:true}).map(row => ({
      line:row.__rowNum__ + 1,
      cells:Object.fromEntries(Object.entries(row).map(([label, value]) => [normalizeHeader(label), value]))
    }));
  }
  const code = (value, location) => {
    const match = /^ТП\s*№\s*0*(\d+)$/iu.exec(clean(value));
    if (!match || Number(match[1]) < 1) throw new Error(location + ': некорректный код типового плана.');
    return 'ТП №' + match[1].padStart(2,'0');
  };
  const templates = new Map();
  for (const {line, cells} of readSheet('Реестр', ['Код', 'Сценарий'])) {
    if (!clean(cells.код) && !clean(cells.сценарий)) continue;
    const location = 'Лист «Реестр», строка ' + line;
    const id = code(cells.код, location);
    const title = clean(cells.сценарий);
    if (!title || templates.has(id)) throw new Error(location + ': проверьте код и название сценария ' + id + '.');
    templates.set(id,{id,title,steps:[]});
  }
  let id;
  for (const {line, cells} of readSheet('Типовые планы', ['Код', 'Шаг', 'Ориент. дней'])) {
    if (!Object.values(cells).some(value => clean(value))) continue;
    const location = 'Лист «Типовые планы», строка ' + line;
    if (clean(cells.код)) id = code(cells.код, location);
    if (!id) throw new Error(location + ': укажите код первого сценария.');
    const template = templates.get(id);
    const step = clean(cells.шаг);
    const result = clean(cells['контрольный результат']);
    const numbered = typeof cells.шаг === 'number' || /^\d+$/u.test(step);
    const title = numbered ? result : step;
    const duration = clean(cells['ориент. дней']);
    const durationDays = Number(duration);
    const ordinal = numbered ? step : clean(cells['№ шага'] ?? cells['№']);
    const expected = (template?.steps.at(-1)?.number ?? 0) + 1;
    const number = ordinal ? Number(ordinal) : expected;
    if (!template) throw new Error(location + ': сценарий ' + id + ' отсутствует в реестре.');
    if (!title || !/^\d+$/u.test(duration) || !Number.isSafeInteger(durationDays) || number !== expected) {
      throw new Error(location + ': проверьте название, длительность и номер шага ' + expected + ' сценария ' + id + '.');
    }
    template.steps.push({id:id+'/'+number,number,title,durationDays,
      result, document:clean(cells['отчет о выполнении']),
      participant:clean(cells['типовой участник — уточнить']) || clean(cells.ответственный),
      note:clean(cells['примечание / решение'])});
  }
  const records = [...templates.values()];
  if (!records.length) throw new Error('Лист «Реестр»: нет сценариев.');
  const empty = records.find(item => !item.steps.length);
  if (empty) throw new Error('Лист «Типовые планы»: нет шагов для ' + empty.id + '.');
  return records;
}
