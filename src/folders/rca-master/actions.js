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

function renderRcaActions(record, commit, navigate) {
  const panel = rcaElement('div', '', 'rca-passport');
  const coverage = rcaElement('section', '', 'card');
  coverage.append(rcaElement('h2', 'Покрытие причин'));
  const tracked = record.rcaNodes.filter(node => node.flagK || node.flagM);
  if (!tracked.length) coverage.append(rcaElement('p', 'Отметьте причины кнопками «К» или «М» в дереве RCA.'));
  for (const node of tracked) {
    const row = rcaElement('div', '', 'rca-passport-row');
    row.append(rcaButton(node.title, () => navigate(node.id)), rcaElement('span', rcaActionCoverage(record, node.id)));
    coverage.append(row);
  }
  panel.append(coverage);

  function edit(sector, item) {
    rcaEditor('Мероприятие', [
      ['Причины RCA', 'nodeIds', item?.nodeIds ?? [], {
        multiple: true, choices: Object.fromEntries(record.rcaNodes.map(node => [node.id, node.title]))
      }],
      ['Сектор', 'sector', sector, {choices: RCA_SECTORS}],
      ['Содержание', 'text', item?.text, {long: true}],
      ['Вид', 'kind', item?.kind ?? 'corrective', {choices: {corrective: 'Корректирующее', preventive: 'Предупредительное'}}],
      ['Ответственный', 'assignee', item?.assignee],
      ['Срок', 'dueDate', item?.dueDate, {type: 'date'}],
      ['Статус', 'status', item?.status ?? 'draft', {choices: RCA_ACTION_STATUSES}],
      ['Факт выполнения / результат', 'result', item?.result, {long: true}]
    ], values => commit(next => updateRcaLinkedItem(next, 'actions', item, values)));
  }

  for (const [sector, title] of Object.entries(RCA_SECTORS)) {
    const section = rcaElement('section', '', 'card');
    section.append(rcaElement('h2', title));
    for (const item of record.actions.filter(item => item.sector === sector)) {
      const row = rcaElement('article', '', 'rca-linked-row');
      row.append(rcaElement('strong', item.text || 'Черновик мероприятия'),
        rcaElement('p', RCA_ACTION_STATUSES[item.status] ?? item.status));
      for (const id of item.nodeIds) {
        const node = record.rcaNodes.find(node => node.id === id);
        row.append(rcaButton(node.title, () => navigate(id)));
      }
      row.append(rcaButton('Редактировать', () => edit(sector, item)),
        rcaButton('Удалить', () => void deleteRcaLinkedItem(commit, 'actions', item)));
      section.append(row);
    }
    section.append(rcaButton('+ Мероприятие', () => edit(sector)));
    panel.append(section);
  }
  return panel;
}
