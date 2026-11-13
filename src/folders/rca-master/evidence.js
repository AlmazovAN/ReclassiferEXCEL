const RCA_VERDICTS = {unknown: 'Не определено', confirmed: 'Подтверждено', refuted: 'Опровергнуто'};
const RCA_METHODS = Object.fromEntries([
  '', 'Выезд ОПиН', 'Фото-отчёт МБ', 'Стендовое тестирование', 'Лаборатория', 'Тесты от вендора', 'Другое'
].map(method => [method, method || 'Выберите метод']));

function rcaEvidenceVerdict(record, nodeId) {
  const verdicts = new Set(record.evidence.filter(item => item.nodeId === nodeId).map(item => item.verdict));
  if (verdicts.has('confirmed') && verdicts.has('refuted')) return 'Противоречие — решение инженера';
  return RCA_VERDICTS[verdicts.has('confirmed') ? 'confirmed' : verdicts.has('refuted') ? 'refuted' : 'unknown'];
}

function renderRcaEvidence(record, commit, navigate, dictionaries) {
  const panel = rcaElement('section', '', 'card');
  function edit(item) {
    const choices = Object.fromEntries([['', 'Выберите причину'], ...record.rcaNodes.map(node => [node.id, node.title])]);
    const fields = item?.source === 'auto_flag_d' ? [] : [
      ['Причина RCA', 'nodeId', item?.nodeId, {choices, required: true}]
    ];
    fields.push(
      ['Как доказать?', 'method', item?.method, {choices: {
        ...RCA_METHODS,
        ...Object.fromEntries(dictionaries.filter(entry => entry.category === 'evidence_methods' && entry.status === 'active')
          .map(entry => [entry.value, entry.value])),
        ...(item?.method ? {[item.method]: item.method} : {})
      }}],
      ['Уточнение метода', 'methodDetail', item?.methodDetail],
      ['Лидер', 'leader', item?.leader ?? record.problem.leader],
      ['Срок', 'dueDate', item?.dueDate, {type: 'date'}],
      ['Ожидаемый результат', 'expected', item?.expected, {long: true}],
      ['Фактический результат / отчёт', 'actual', item?.actual, {long: true}],
      ['Доказано?', 'verdict', item?.verdict ?? 'unknown', {choices: RCA_VERDICTS}],
      ['Статус выполнения', 'status', item?.status ?? 'draft', {choices: {
        draft: 'Черновик', in_progress: 'В работе', closed: 'Завершено', cancelled: 'Отменено'
      }}],
      ['Материалы — имена файлов или ссылки', 'materials', item?.materials, {long: true}]
    );
    rcaEditor('Доказательство', fields, values => commit(next => {
      if (values.method === 'Другое' && !values.methodDetail.trim()) throw new Error('Уточните метод проверки.');
      updateRcaLinkedItem(next, 'evidence', item, values);
    }));
  }
  panel.append(rcaElement('h2', 'Доказательства'));
  const add = rcaButton('+ Доказательство', () => edit());
  add.disabled = !record.rcaNodes.length;
  panel.append(add);
  if (!record.rcaNodes.length) panel.append(rcaElement('p', 'Добавьте причину в дереве RCA.'));
  for (const item of record.evidence) {
    const row = rcaElement('article', '', 'rca-linked-row');
    const node = record.rcaNodes.find(node => node.id === item.nodeId);
    row.append(rcaElement('strong', item.method || 'Черновик проверки'),
      rcaElement('p', RCA_VERDICTS[item.verdict] ?? RCA_VERDICTS.unknown),
      rcaButton(node.title, () => navigate(node.id)),
      rcaButton('Редактировать', () => edit(item)),
      rcaButton('Удалить', () => void deleteRcaLinkedItem(commit, 'evidence', item)));
    panel.append(row);
  }
  return panel;
}
