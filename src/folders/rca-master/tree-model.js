function rcaTreeColumns(record) {
  const children = new Map();
  for (const node of record.rcaNodes) {
    const key = node.parentId ?? node.symptomId;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(node);
  }
  const columns = [record.symptoms];
  for (let level = 0; columns[level].length; level++) {
    const next = columns[level].flatMap(node => children.get(node.id) ?? []);
    if (!next.length) break;
    columns.push(next);
  }
  return columns;
}

function addRcaWhy(record, symptomId, parentId, title) {
  const now = new Date().toISOString();
  const node = {
    id: crypto.randomUUID(), problemId: record.problem.id, symptomId, parentId, title,
    category: '', hypothesisState: 'hypothesis', flagK: false, flagM: false, flagD: false,
    createdAt: now, updatedAt: now
  };
  validateRcaProblem({...record, rcaNodes: [...record.rcaNodes, node]});
  record.rcaNodes.push(node);
  return node;
}

function removeRcaTreeItem(record, id, isSymptom) {
  if (record.rcaNodes.some(node => isSymptom ? node.symptomId === id : node.parentId === id) ||
      record.evidence.some(item => item.nodeId === id) ||
      record.actions.some(item => item.nodeIds.includes(id))) {
    throw new Error('Сначала обработайте дочерние причины, доказательства и мероприятия.');
  }
  const key = isSymptom ? 'symptoms' : 'rcaNodes';
  record[key] = record[key].filter(item => item.id !== id);
}

const RCA_LINKED_FLAGS = {
  evidence: {flag: 'flagD', source: 'auto_flag_d', links: item => [item.nodeId]},
  actions: {flag: 'flagM', source: 'auto_flag_m', links: item => item.nodeIds}
};

function toggleRcaLinkedFlag(record, key, nodeId) {
  if (key === 'actions') return toggleRcaActionFlag(record, nodeId, 'flagM');
  const {flag, source} = RCA_LINKED_FLAGS[key];
  const node = record.rcaNodes.find(item => item.id === nodeId);
  const items = record[key];
  const auto = items.find(item => item.source === source && item.originNodeId === nodeId);
  if (node[flag] && auto) {
    const populated = auto.method || auto.methodDetail || auto.task || auto.dueDate || auto.expected || auto.actual ||
      auto.materials || auto.verdict !== 'unknown';
    if (auto.revision !== 1 || auto.status !== 'draft' || populated ||
        listRcaAttachments(record, 'evidence', auto.id).length) {
      throw new Error('Карточка содержит данные. Сначала явно удалите её или отвяжите от причины.');
    }
    record[key] = items.filter(item => item.id !== auto.id);
  } else if (!node[flag] && !auto) {
    const fields = {nodeId, leader: record.problem.leader, verdict: 'unknown'};
    items.push(newRcaLinkedItem(record, {...fields, originNodeId: nodeId, source}));
  }
  node[flag] = !node[flag];
  node.updatedAt = new Date().toISOString();
}

function toggleRcaActionFlag(record, nodeId, flag) {
  const node = record.rcaNodes.find(item => item.id === nodeId);
  node[flag] = !node[flag];
  node.updatedAt = new Date().toISOString();
  if (node[flag] && !record.actions.some(item => item.nodeIds.includes(nodeId) && item.status !== 'cancelled')) {
    record.actions.push(newRcaLinkedItem(record, {
      nodeIds:[nodeId], sector:'technical', kind:'preventive', originNodeId:nodeId, source:'auto_flag_m'
    }));
  }
  if (!node.flagK && !node.flagM) {
    record.actions = record.actions.filter(item => item.source !== 'auto_flag_m' || item.originNodeId !== nodeId ||
      item.status !== 'draft' || item.revision !== 1 || item.text || item.result || item.assignee || item.dueDate ||
      item.zno || item.plan || item.sector !== 'technical' || item.nodeIds.length !== 1 ||
      listRcaAttachments(record, 'action', item.id).length);
  }
}

function newRcaLinkedItem(record, values) {
  const now = new Date().toISOString();
  return {id: crypto.randomUUID(), problemId: record.problem.id, source: 'manual',
    revision: 1, status: 'draft', createdAt: now, updatedAt: now, ...values};
}

function updateRcaLinkedItem(record, key, previous, values) {
  const item = record[key].find(entry => entry.id === previous?.id);
  if (key === 'actions') validateRcaActionEdit({...item, ...values});
  const nodeId = values.nodeId ?? item?.nodeId;
  const before = key === 'evidence' ? rcaEvidenceState(record, nodeId) : null;
  const edited = {...item, ...values};
  if (key === 'evidence' && ['confirmed','refuted'].includes(edited.verdict) &&
      (!edited.leader?.trim() || !edited.actual?.trim())) {
    throw new Error('Для вердикта укажите проверяющего и результат проверки.');
  }
  if (!item) {
    const created = newRcaLinkedItem(record, values);
    record[key].push(created);
    if (key === 'evidence') recordRcaEvidenceEvent(record, nodeId, created.id, 'evidence-created', before);
    return;
  }
  Object.assign(item, values, {revision: (item.revision ?? 1) + 1, updatedAt: new Date().toISOString()});
  if (key === 'evidence') recordRcaEvidenceEvent(record, nodeId, item.id, 'evidence-edited', before);
  if (item.originNodeId && !RCA_LINKED_FLAGS[key].links(item).includes(item.originNodeId)) {
    clearRcaLinkedFlag(record, key, item);
    delete item.originNodeId;
    item.source = 'manual';
  }
}

function clearRcaLinkedFlag(record, key, item) {
  const {flag, source} = RCA_LINKED_FLAGS[key];
  if (item.source !== source) return;
  const node = record.rcaNodes.find(entry => entry.id === item.originNodeId);
  if (node) {
    node[flag] = false;
    node.updatedAt = new Date().toISOString();
  }
}

async function deleteRcaLinkedItem(commit, key, item) {
  if (!window.confirm('Удалить карточку и её связи?')) return;
  try {
    await commit(next => {
      const before = key === 'evidence' ? rcaEvidenceState(next, item.nodeId) : null;
      next[key] = next[key].filter(entry => entry.id !== item.id);
      const photos = new Set(listRcaAttachments(next, key === 'actions' ? 'action' : 'evidence', item.id));
      next.attachments = next.attachments.filter(entry => !photos.has(entry));
      if (key === 'evidence') recordRcaEvidenceEvent(next, item.nodeId, item.id, 'evidence-deleted', before);
      clearRcaLinkedFlag(next, key, item);
    });
  } catch (error) { window.alert(error.message); }
}
