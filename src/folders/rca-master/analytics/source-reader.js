const RCA_ITSM_HEADERS = {
  inc:'Номер', prb:'Связан ли с ИТ-проблемой?', site:'Территории MES',
  day:'Дата выполнения обращения', hours:'рез6', type:'INC после рекласс'
};

async function* readRcaItsmRows(file) {
  const archive = await ReclassifierFolderExportXlsx.open(file);
  const sheets = await archive.worksheetIds();
  const context = await archive.excelContext(() => {});
  let found = false;
  let missing = [];
  for (const [name, id] of sheets) {
    if (name.startsWith('_')) continue;
    const rows = archive.rows(id, 16384, context);
    for await (const header of rows) {
      if (!header.some(value => String(value ?? '').trim())) continue;
      const keys = new Map(header.map((value, i) => [datasetClassifierNormalizeHeader(value), i]));
      const columns = Object.fromEntries(Object.entries(RCA_ITSM_HEADERS).map(([key, label]) =>
        [key, keys.get(datasetClassifierNormalizeHeader(label))]));
      missing = Object.keys(columns).filter(key => key !== 'type' && columns[key] === undefined);
      if (missing.length) {
        if (/^ITSM(?:$|[_ ]?\d)/i.test(name)) throw new Error('В листе ' + name + ' отсутствуют поля: ' + missing.map(key => RCA_ITSM_HEADERS[key]).join(', '));
        break;
      }
      found = true;
      for await (const row of rows) yield {
        ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, row[column]])),
        hasType:columns.type !== undefined, date1904:context.date1904
      };
      break;
    }
  }
  if (!found) throw new Error('Нет листа ITSM с обязательными полями: ' +
    (missing.length ? missing : Object.keys(RCA_ITSM_HEADERS).filter(key => key !== 'type'))
      .map(key => RCA_ITSM_HEADERS[key]).join(', '));
}
