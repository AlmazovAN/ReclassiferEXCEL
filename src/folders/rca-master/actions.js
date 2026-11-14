const RCA_SECTORS = {
  technical: 'Технические мероприятия',
  organizational: 'Организационные мероприятия',
  documentation: 'Документационное / нормативное обеспечение',
  safety: 'Промышленная безопасность',
  quality: 'Контроль качества работ',
  supplies: 'Материально-техническое обеспечение',
  competencies: 'Компетенции персонала'
};
const RCA_ACTION_STATUSES = {
  draft: 'Черновик', planned: 'Запланировано', in_progress: 'В работе', closed: 'Выполнено', cancelled: 'Отменено'
};

function rcaActionCoverage(record, nodeId) {
  const items = record.actions.filter(item => item.nodeIds.includes(nodeId) && item.status !== 'cancelled');
  const formulated = items.filter(item => item.text?.trim());
  if (formulated.some(item => item.status === 'closed' && item.result?.trim())) return 'Выполнено';
  if (formulated.some(item => ['planned', 'in_progress'].includes(item.status))) return 'Запланировано / исполняется';
  if (formulated.length) return 'Сформулировано';
  return items.length ? 'Пустой черновик' : 'Нет действий';
}

function validateRcaActionEdit(item) {
  if (item.kind === 'corrective' && ['planned','in_progress','closed'].includes(item.status) &&
      (typeof item.zno !== 'string' || !item.zno.trim())) {
    throw new Error('Укажите номер ЗНО для корректирующего мероприятия.');
  }
  if (item.status === 'closed' && (!item.text?.trim() || !item.result?.trim())) {
    throw new Error('Укажите название мероприятия и отчёт о выполнении.');
  }
}

function editRcaAction(record, commit, editor, sector, item) {
  editor(item?.text || (item ? 'Черновик мероприятия' : 'Новое мероприятие'), [
    ['Причины RCA', 'nodeIds', item?.nodeIds ?? [], {
      multiple: true, choices: Object.fromEntries(record.rcaNodes.map(node => [node.id, node.title]))
    }],
    ['Сектор', 'sector', sector, {choices: RCA_SECTORS}],
    ['Название мероприятия', 'text', item?.text, {long: true}],
    ['Вид', 'kind', item?.kind ?? 'preventive', {choices: {corrective: 'Корректирующее', preventive: 'Предупредительное'}}],
    ['Номер ЗНО', 'zno', item?.zno, {hint:'Для корректирующего мероприятия при планировании и выполнении'}],
    ['Ответственный', 'assignee', item?.assignee],
    ['Срок', 'dueDate', item?.dueDate, {type: 'date'}],
    ['Статус', 'status', item?.status ?? 'draft', {choices: RCA_ACTION_STATUSES}],
    ['Отчёт о выполнении', 'result', item?.result, {long: true}]
  ], values => commit(next => updateRcaLinkedItem(next, 'actions', item, values)), item?.id);
}

function renderRcaActions(record, commit, navigate, editor) {
  const panel = rcaElement('div', '', 'rca-action-list');
  const coverage = rcaElement('section', '', 'card');
  coverage.append(rcaElement('h2', 'Причины, требующие мероприятий'));
  const tracked = record.rcaNodes.filter(node => (node.flagK || node.flagM) &&
    !record.actions.some(item => item.nodeIds.includes(node.id) && item.status !== 'cancelled' && item.text?.trim()));
  if (!tracked.length) coverage.append(rcaElement('p', 'Все отмеченные причины имеют сформулированные мероприятия.'));
  for (const node of tracked) {
    const row = rcaElement('div', '', 'rca-passport-row');
    row.append(rcaButton(node.title, () => navigate(node.id)), rcaElement('span', rcaActionCoverage(record, node.id)));
    coverage.append(row);
  }
  panel.append(coverage);

  const edit = (sector, item) => editRcaAction(record, commit, editor, sector, item);

  for (const [sector, title] of Object.entries(RCA_SECTORS)) {
    const items = record.actions.filter(item => item.sector === sector);
    const section = rcaElement('details', '', 'card');
    section.open = items.length > 0;
    section.append(rcaElement('summary', title + ' (' + items.length + ')'));
    for (const item of items) {
      const row = rcaElement('article', '', 'rca-linked-row');
      const info = rcaElement('div', '', 'rca-linked-info');
      info.append(rcaElement('strong', item.text || 'Черновик мероприятия'),
        rcaElement('p', RCA_ACTION_STATUSES[item.status] ?? item.status, 'rca-row-status'),
        rcaElement('small', item.dueDate ? 'Срок · ' + item.dueDate : 'Без срока'));
      if (item.plan) info.append(rcaElement('p', item.plan.template.title + ' · до ' + item.plan.end));
      const photos = listRcaAttachments(record, 'action', item.id).length;
      if (photos) info.append(rcaElement('small', 'Фото · ' + photos));
      const controls = rcaElement('div', '', 'rca-linked-controls');
      controls.append(rcaButton('Открыть', () => edit(sector, item), 'rca-open-row'));
      for (const id of item.nodeIds) {
        const node = record.rcaNodes.find(node => node.id === id);
        const link = rcaButton(item.nodeIds.length === 1 ? 'К причине' : node.title, () => navigate(id), 'rca-quiet');
        link.title = node.title;
        controls.append(link);
      }
      controls.append(rcaRowActions(item.text || 'Черновик мероприятия',
        () => void deleteRcaLinkedItem(commit, 'actions', item)));
      row.append(info, controls);
      section.append(row);
    }
    section.append(rcaButton('+ Мероприятие', () => edit(sector)));
    panel.append(section);
  }
  return panel;
}
