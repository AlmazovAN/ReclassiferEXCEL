function buildRcaReport(record) {
  validateRcaProblem(record);
  const {problem} = record;
  const nodes = new Map(record.rcaNodes.map(node => [node.id, node]));
  const symptoms = new Map(record.symptoms.map(item => [item.id, item.title]));
  const sections = [];
  const fields = (item, definitions) => definitions.map(([label, key]) => [label, item[key]]);
  const cause = id => nodes.get(id)?.title;

  sections.push({title: 'Паспорт', entries: [{fields: [
    ...fields({...problem, status: RCA_STATUSES[problem.status] ?? problem.status}, RCA_PASSPORT_FIELDS),
    ['Регистрация', problem.createdAt], ['Обновление', problem.updatedAt], ['Ревизия', problem.revision]
  ]}]});
  for (const [title, key, definitions] of RCA_PASSPORT_COLLECTIONS) {
    sections.push({title, entries: record[key].map(item => ({fields: fields(item, definitions)}))});
  }
  sections.push({title: 'RCA Master · Цепочки причин', entries: rcaTreeColumns(record).slice(1).flatMap(
    (column, level) => column.map(node => ({title: 'Почему ' + (level + 1) + ' · ' + node.title, fields: [
      ['Симптом', symptoms.get(node.symptomId)], ['Предшествующая причина', cause(node.parentId)],
      ['Категория', node.category],
      ['Статус гипотезы', {hypothesis: 'Гипотеза', confirmed: 'Подтверждено', refuted: 'Опровергнуто'}[node.hypothesisState]],
      ['Предполагаемая коренная причина', node.flagK ? 'Да' : ''],
      ['Оценка доказательств', rcaEvidenceVerdict(record, node.id)],
      ['Покрытие КД/ПД', rcaActionCoverage(record, node.id)]
    ]}))
  )});
  sections.push({title: 'Доказательства', entries: record.evidence.map(item => ({fields: [
    ['Причина', cause(item.nodeId)], ['Метод', item.method], ['Уточнение метода', item.methodDetail],
    ['Лидер', item.leader], ['Срок', item.dueDate], ['Ожидаемый результат', item.expected],
    ['Фактический результат / отчёт', item.actual], ['Вердикт', RCA_VERDICTS[item.verdict] ?? RCA_VERDICTS.unknown],
    ['Статус', {draft: 'Черновик', in_progress: 'В работе', closed: 'Завершено', cancelled: 'Отменено'}[item.status]],
    ['Материалы', item.materials]
  ]}))});
  sections.push({title: 'Мероприятия · КД/ПД', entries: record.actions.map(item => ({fields: [
    ['Содержание', item.text], ['Сектор', RCA_SECTORS[item.sector]], ['Причины', item.nodeIds.map(cause).join('\n')],
    ['Вид', {corrective: 'Корректирующее', preventive: 'Предупредительное'}[item.kind]],
    ['Ответственный', item.assignee], ['Срок', item.dueDate], ['Статус', RCA_ACTION_STATUSES[item.status]],
    ['Факт выполнения / результат', item.result]
  ]}))});
  return {id: rcaDisplayId(problem), title: problem.title, sections};
}

function renderRcaPrintable(report) {
  const article = rcaElement('article', '', 'rca-print-report');
  article.append(rcaElement('h1', 'Отчёт о расследовании ИТ-проблемы'),
    rcaElement('p', report.id + ' · ' + report.title));
  for (const {title, entries} of report.sections) {
    const section = rcaElement('section');
    section.append(rcaElement('h2', title));
    if (!entries.length) section.append(rcaElement('p', 'Нет записей.'));
    for (const entry of entries) {
      const details = rcaElement('dl');
      if (entry.title) section.append(rcaElement('h3', entry.title));
      for (const [label, value] of entry.fields) {
        if (value === undefined || value === null || value === '') continue;
        const row = rcaElement('div');
        row.append(rcaElement('dt', label), rcaElement('dd', String(value)));
        details.append(row);
      }
      section.append(details);
    }
    article.append(section);
  }
  return article;
}

function printRcaReport(record) {
  const report = renderRcaPrintable(buildRcaReport(record));
  document.body.append(report);
  document.body.classList.add('rca-printing');
  try {
    window.print();
  } finally {
    document.body.classList.remove('rca-printing');
    report.remove();
  }
}
