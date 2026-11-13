function validateRcaProblem(record) {
  const problem = record?.problem;
  if (record?.schemaVersion !== RCA_SCHEMA_VERSION || record.recordType !== 'rca-problem' ||
      !problem || !RCA_UUID.test(problem.id) ||
      !(problem.prbNumber === null || typeof problem.prbNumber === 'string') ||
      !['title', 'status', 'description', 'leader', 'equipment', 'location'].every(
        key => typeof problem[key] === 'string'
      ) || !problem.title.trim() || !problem.status.trim() ||
      !['createdAt', 'updatedAt'].every(key =>
        typeof problem[key] === 'string' && Number.isFinite(Date.parse(problem[key]))
      ) || !Number.isSafeInteger(problem.revision) || problem.revision < 1) {
    throw new Error('Некорректный паспорт RCA.');
  }

  const ids = new Map();
  for (const key of RCA_COLLECTIONS) {
    const items = record[key];
    if (!Array.isArray(items)) throw new Error('Некорректная коллекция RCA: ' + key);
    const collection = new Map();
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || !item.id || collection.has(item.id) ||
          (item.problemId !== undefined && item.problemId !== problem.id)) {
        throw new Error('Некорректный идентификатор в коллекции RCA: ' + key);
      }
      collection.set(item.id, item);
    }
    ids.set(key, collection);
  }

  const nodes = ids.get('rcaNodes');
  const checked = new Set();
  for (const node of nodes.values()) {
    if (!ids.get('symptoms').has(node.symptomId)) throw new Error('Узел RCA ссылается на чужой симптом.');
    const chain = new Set();
    let cursor = node;
    while (!checked.has(cursor.id)) {
      if (chain.has(cursor.id)) throw new Error('Цикл в дереве RCA.');
      chain.add(cursor.id);
      if (cursor.parentId === null) break;
      cursor = nodes.get(cursor.parentId);
      if (!cursor || cursor.symptomId !== node.symptomId) throw new Error('Некорректный родитель узла RCA.');
    }
    for (const id of chain) checked.add(id);
  }
  for (const item of record.evidence) {
    if (!nodes.has(item.nodeId)) throw new Error('Доказательство ссылается на чужой узел RCA.');
  }
  for (const item of record.actions) {
    if (!Array.isArray(item.nodeIds) || item.nodeIds.some(id => !nodes.has(id))) {
      throw new Error('Мероприятие ссылается на чужой узел RCA.');
    }
    if (item.sector !== undefined && !Object.hasOwn(RCA_SECTORS, item.sector)) {
      throw new Error('Выберите сектор мероприятия.');
    }
    if (item.status === 'closed' && (!item.text?.trim() || !item.result?.trim())) {
      throw new Error('Для выполненного мероприятия укажите содержание и результат.');
    }
  }
  return record;
}

function createRcaProblem({title, prbNumber = null, equipment = ''}) {
  const now = new Date().toISOString();
  return validateRcaProblem({
    schemaVersion: RCA_SCHEMA_VERSION,
    recordType: 'rca-problem',
    problem: {
      id: crypto.randomUUID(), prbNumber, title, status: 'draft', description: '',
      leader: '', equipment, location: '', createdAt: now, updatedAt: now, revision: 1
    },
    ...Object.fromEntries(RCA_COLLECTIONS.map(key => [key, []]))
  });
}

function validateRcaIndex(index, generation) {
  if (index?.schemaVersion !== RCA_SCHEMA_VERSION || index.recordType !== 'rca-index' ||
      index.generation !== generation || !Array.isArray(index.records)) {
    throw new Error('Некорректный индекс RCA.');
  }
  const ids = new Set();
  for (const row of index.records) {
    if (!row || !RCA_UUID.test(row.id) || ids.has(row.id) ||
        !Number.isSafeInteger(row.revision) || row.revision < 1 ||
        !RCA_SNAPSHOT_NAME.test(row.file) || !row.file.startsWith(row.revision + '-') ||
        !/^[0-9a-f]{64}$/.test(row.hash) ||
        !(row.prbNumber === null || typeof row.prbNumber === 'string') ||
        !['title', 'status', 'equipment', 'updatedAt'].every(key => typeof row[key] === 'string')) {
      throw new Error('Некорректная запись индекса RCA.');
    }
    ids.add(row.id);
  }
  if (index.dictionaries !== undefined) validateRcaDictionaries(index.dictionaries);
  return index;
}
