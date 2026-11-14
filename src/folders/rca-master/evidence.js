const RCA_VERDICTS = {unknown: 'Не определено', confirmed: 'Подтверждено', refuted: 'Опровергнуто'};
const RCA_METHODS = Object.fromEntries([
  '', 'Осмотр инженером', 'Выезд ОПиН', 'Фото-отчёт МБ', 'Стендовое тестирование', 'Лаборатория', 'Тесты от вендора', 'Другое'
].map(method => [method, method || 'Выберите метод']));

function rcaEvidenceState(record, nodeId) {
  const verdicts = new Set(record.evidence.filter(item => item.nodeId === nodeId &&
    item.leader?.trim() && item.actual?.trim() && item.status !== 'cancelled').map(item => item.verdict));
  if (verdicts.has('confirmed') && verdicts.has('refuted')) return 'conflict';
  return verdicts.has('confirmed') ? 'confirmed' : verdicts.has('refuted') ? 'refuted' : 'unknown';
}

function rcaEvidenceVerdict(record, nodeId) {
  const state = rcaEvidenceState(record, nodeId);
  return state === 'conflict' ? 'Противоречие — решение инженера' : RCA_VERDICTS[state];
}

function recordRcaEvidenceEvent(record, nodeId, itemId, operation, before) {
  record.history.push({id:crypto.randomUUID(), type:operation, nodeId, itemId, at:new Date().toISOString(),
    before, after:rcaEvidenceState(record, nodeId)});
}

function editRcaEvidence(record, commit, dictionaries, item, nodeId, verdict, editor = rcaEditor) {
    const choices = Object.fromEntries([['', 'Выберите причину'], ...record.rcaNodes.map(node => [node.id, node.title])]);
    const fields = item?.source === 'auto_flag_d' || nodeId ? [] : [
      ['Причина RCA', 'nodeId', item?.nodeId, {choices, required: true}]
    ];
    fields.push(
      ['Способ проверки', 'method', item?.method, {choices: {
        ...RCA_METHODS,
        ...Object.fromEntries(dictionaries.filter(entry => entry.category === 'evidence_methods' && entry.status === 'active')
          .map(entry => [entry.value, entry.value])),
        ...(item?.method ? {[item.method]: item.method} : {})
      }}],
      ['Что нужно сделать?', 'task', item?.task, {long:true, hint:'Для планируемой проверки опишите действие.'}],
      ['Лидер / проверяющий', 'leader', item?.leader ?? record.problem.leader],
      ['Срок', 'dueDate', item?.dueDate, {type: 'date'}],
      ['Ожидаемый результат (развилка)', 'expected', item?.expected, {long: true, hint:'Что подтвердит или опровергнет гипотезу?'}],
      ['Результат проверки', 'actual', item?.actual, {long: true,
        hint:'Что установлено при проверке? Укажите ФИО, фото, ссылку, номер акта/протокола при наличии'}],
      ['Вердикт', 'verdict', verdict ?? item?.verdict ?? 'unknown', {choices: RCA_VERDICTS}],
      ['Статус выполнения', 'status', item?.status ?? 'draft', {choices: {
        draft: 'Черновик', in_progress: 'В работе', closed: 'Завершено', cancelled: 'Отменено'
      }}],
      ['Материалы — имена файлов или ссылки', 'materials', item?.materials, {long: true}]
    );
    const linked = record.rcaNodes.find(node => node.id === (nodeId ?? item?.nodeId));
    editor(linked ? 'Проверка: ' + linked.title : 'Новое доказательство', fields, values => commit(next => {
      updateRcaLinkedItem(next, 'evidence', item, {...values, nodeId:nodeId ?? values.nodeId ?? item?.nodeId});
    }), item?.id);
}

function renderRcaEvidence(record, commit, navigate, dictionaries, editor) {
  const panel = rcaElement('section', '', 'card');
  const edit = item => editRcaEvidence(record, commit, dictionaries, item, undefined, undefined, editor);
  panel.append(rcaElement('h2', 'Доказательства'));
  const add = rcaButton('+ Доказательство', () => edit(), 'primary');
  add.disabled = !record.rcaNodes.length;
  panel.append(add);
  if (!record.rcaNodes.length) panel.append(rcaElement('p', 'Добавьте причину в дереве RCA.'));
  else if (!record.evidence.length) panel.append(rcaElement('p', 'Доказательств пока нет.'));
  for (const item of record.evidence) {
    const row = rcaElement('article', '', 'rca-linked-row');
    const node = record.rcaNodes.find(node => node.id === item.nodeId);
    const info = rcaElement('div', '', 'rca-linked-info');
    info.append(rcaElement('strong', node.title),
      rcaElement('p', item.method || 'Способ проверки не выбран'),
      rcaElement('p', RCA_VERDICTS[item.verdict] ?? RCA_VERDICTS.unknown, 'rca-row-status'),
      rcaElement('small', item.dueDate ? 'Срок · ' + item.dueDate : 'Без срока'));
    const photos = listRcaAttachments(record, 'evidence', item.id).length;
    if (photos) info.append(rcaElement('small', 'Фото · ' + photos));
    const controls = rcaElement('div', '', 'rca-linked-controls');
    controls.append(
      rcaButton('Открыть', () => edit(item), 'rca-open-row'),
      rcaButton('К причине', () => navigate(node.id), 'rca-quiet'),
      rcaRowActions(node.title, () => void deleteRcaLinkedItem(commit, 'evidence', item)));
    row.append(info, controls);
    panel.append(row);
  }
  return panel;
}
