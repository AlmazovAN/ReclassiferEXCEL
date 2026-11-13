const RCA_ARCHIVE_LIMIT = 16 * 1024 * 1024;
const RCA_ATTACHMENT_WARNING = 'Файлы приложений не включены в JSON.';

function readRcaArchive(text) {
  const archive = JSON.parse(text);
  if (archive?.format !== 'reclassifier-rca-archive' || archive.schemaVersion !== RCA_SCHEMA_VERSION ||
      !Array.isArray(archive.problems)) throw new Error('Неизвестный формат или версия архива RCA.');
  validateRcaDictionaries(archive.dictionaries);
  const ids = new Set();
  const numbers = new Set();
  for (const record of archive.problems) {
    validateRcaProblem(record);
    const {id, prbNumber} = record.problem;
    const number = normalizeRcaPrb(prbNumber ?? '');
    if (ids.has(id) || (number && numbers.has(number))) throw new Error('В архиве повторяется UUID или PRB.');
    ids.add(id);
    if (number) numbers.add(number);
  }
  return archive;
}

function rcaSameData(left, right) {
  function ordered(_key, value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]]));
    }
    return value;
  }
  function encode(record) {
    const copy = structuredClone(record);
    delete copy.problem.revision;
    delete copy.problem.updatedAt;
    return JSON.stringify(copy, ordered);
  }
  return encode(left) === encode(right);
}

async function planRcaArchive(archive, rows, dictionaries, load) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const problems = [];
  for (const record of archive.problems) {
    const existing = byId.get(record.problem.id);
    let collision = false;
    try { checkRcaPrb(record.problem, rows); } catch { collision = true; }
    const current = existing && await load(existing.id);
    const kind = collision ? 'blocked' : !existing ? 'new' :
      !current || current.problem.revision !== existing.revision ? 'blocked' :
      rcaSameData(current, record) ? 'same' : 'conflict';
    problems.push({record, kind, expectedRevision: existing?.revision ?? 0});
  }
  const items = [...dictionaries];
  let added = 0;
  let skipped = 0;
  for (const item of archive.dictionaries) {
    if (items.some(existing => existing.id === item.id || rcaDictionaryKey(existing) === rcaDictionaryKey(item))) skipped++;
    else { items.push(item); added++; }
  }
  return {problems, items, added, skipped};
}

async function exportRcaArchive(rows, dictionaries, load) {
  const chunks = [];
  const encoder = new TextEncoder();
  let size = 0;
  function append(text) {
    size += encoder.encode(text).byteLength;
    if (size > RCA_ARCHIVE_LIMIT) throw new Error('Архив превышает 16 МБ. Выгрузите нужные карточки по отдельности.');
    chunks.push(text);
  }
  const header = {
    format: 'reclassifier-rca-archive', schemaVersion: RCA_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    dictionaries, counts: {problems: rows.length, dictionaries: dictionaries.length},
    warnings: [RCA_ATTACHMENT_WARNING], attachments: {binaryIncluded: false}
  };
  append(JSON.stringify(header).slice(0, -1) + ',"problems":[');
  for (const [index, row] of rows.entries()) {
    const record = await load(row.id);
    if (!record) throw new Error('Карточка недоступна: ' + rcaDisplayId(row));
    append((index ? ',' : '') + JSON.stringify(validateRcaProblem(record)));
  }
  append(']}');
  return new Blob(chunks, {type: 'application/json'});
}
