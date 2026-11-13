function readRcaPlanTemplates(book) {
  const rows = name => XLSX.utils.sheet_to_json(book.Sheets[name], {defval:null, raw:true});
  const clean = value => String(value ?? '').trim();
  const code = value => {
    const match = /^ТП\s*№\s*0*(\d+)$/iu.exec(clean(value));
    if (!match || Number(match[1]) < 1) throw new Error('Некорректный код типового плана.');
    return 'ТП №' + match[1].padStart(2,'0');
  };
  const templates = new Map();
  for (const row of rows('Реестр')) {
    if (!clean(row.Код) && !clean(row.Сценарий)) continue;
    const id = code(row.Код);
    const title = clean(row.Сценарий);
    if (!title || templates.has(id)) throw new Error('Проверьте код и название сценария ' + id + '.');
    templates.set(id,{id,title,steps:[]});
  }
  for (const row of rows('Типовые планы')) {
    if (!clean(row.Код) && !clean(row.Шаг)) continue;
    const id = code(row.Код);
    const template = templates.get(id);
    const title = clean(row.Шаг);
    const duration = clean(row['Ориент. дней']);
    const durationDays = Number(duration);
    const ordinal = clean(row['№ шага'] ?? row['№']);
    const number = ordinal ? Number(ordinal) : (template?.steps.at(-1)?.number ?? 0) + 1;
    if (!template || !title || !duration || !Number.isSafeInteger(durationDays) || durationDays < 0 ||
        !Number.isSafeInteger(number) || number <= (template.steps.at(-1)?.number ?? 0)) {
      throw new Error('Проверьте шаги и длительности сценария ' + id + '.');
    }
    template.steps.push({id:id+'/'+number,number,title,durationDays,
      result:clean(row['Контрольный результат']), document:clean(row['Отчёт о выполнении']),
      participant:clean(row['Типовой участник — уточнить']) || clean(row.Ответственный),
      note:clean(row['Примечание / решение'])});
  }
  const records = [...templates.values()];
  if (records.length !== 9 || records.some(item=>!item.steps.length) ||
      records.reduce((count,item)=>count+item.steps.length,0) !== 74) {
    throw new Error('В библиотеке ожидаются 9 сценариев и 74 шага.');
  }
  return records;
}
