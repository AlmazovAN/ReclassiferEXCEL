const RCA_PASSPORT_FIELDS = [
  ['Номер PRB', 'prbNumber'], ['Название', 'title', {required: true}],
  ['Описание', 'description', {long: true}], ['Статус PRB', 'status', {choices: RCA_STATUSES}],
  ['Проект / направление', 'project'],
  ['Лидер расследования', 'leader'],
  ['Участок', 'location'], ['Горизонт', 'level'], ['Место установки', 'installation'],
  ['Оборудование / система', 'equipment'],
  ['Инвентарный / технический ID', 'equipmentId'], ['Когда и как проявился отказ', 'occurrence', {long: true}],
  ['Восстановите хронологию событий', 'timeline', {long: true}],
  ['Первичная версия', 'initialHypothesis', {long: true, hint:'Не заполняйте домыслами'}],
  ['Затраты ЗИП', 'partsCost']
];

function renderOfficialPrb(record, registry) {
  const panel = rcaElement('section', '', 'card rca-official');
  panel.append(rcaElement('h2', 'Официальные данные PRB'));
  const fields = [
    ['Номер', 'prbNumber'], ['Статус ITSM', 'itsmStatus'], ['Название', 'title'],
    ['Описание', 'description'], ['Проект / направление', 'project'], ['Ответственный ITSM', 'assignee'],
    ['Инициатор', 'initiator'], ['Дата создания', 'createdAt'], ['Дата закрытия', 'closedAt'],
    ['Исходная корневая причина', 'rootCause'], ['Постоянное решение', 'permanentSolution'],
    ['Обходное решение', 'workaround'], ['Ход анализа', 'analysis'], ['Примечание к закрытию', 'closingNote'],
    ['Паспорт', 'passport'], ['Отчёт', 'report']
  ];
  const details = rcaElement('dl');
  for (const [label, key] of fields) {
    if (record[key]) details.append(rcaElement('dt', label), rcaElement('dd', record[key]));
  }
  panel.append(details);
  if (registry) panel.append(rcaElement('small', 'Источник: ' + registry.fileName + ' · ' +
    new Date(registry.loadedAt).toLocaleString('ru-RU')));
  return panel;
}

const RCA_PASSPORT_COLLECTIONS = [
  ['Участники', 'participants', [['Имя', 'name'], ['Роль', 'role']]],
  ['Симптомы', 'symptoms', [['Симптом (опишите как именно проявляется отказ)', 'title'], ['Наблюдение', 'description', {long: true}], ['Дата', 'date']]],
  ['Связи с INC', 'incidents', [['Номер INC', 'incNumber'], ['Дата', 'date'], ['Описание', 'description'], ['Источник', 'source']]],
  ['Классификационные цепочки', 'classifications', [
    ['Оборудование', 'equipment'], ['Элемент', 'element'], ['Неисправность', 'fault'], ['Причина', 'reason'], ['Источник', 'source']
  ]],
  ['Материалы', 'attachments', [['Название', 'name'], ['Описание', 'description'], ['Ссылка / имя файла', 'reference'], ['Тип', 'type']]]
];

function editRcaCollection(record, key, title, fields, commit, item = {}) {
  rcaEditor(title, fields.map(([label, name, options], index) => [
    label, name, item[name], {...options, required: index === 0 || (key === 'classifications' && index < 4)}
  ]), values => commit(next => {
    const clean = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()]));
    if (!clean[fields[0][1]] || (key === 'classifications' && fields.slice(0, 4).some(([, name]) => !clean[name]))) {
      throw new Error('Заполните обязательные поля.');
    }
    const index = next[key].findIndex(entry => entry.id === item.id);
    if (index >= 0) Object.assign(next[key][index], clean);
    else next[key].push({id: crypto.randomUUID(), problemId: record.problem.id, source: 'manual', ...clean});
  }));
}

function renderRcaPassport(record, commit, references) {
  const pane = rcaElement('div', '', 'rca-passport');
  const details = rcaElement('dl');
  for (const [label, name] of RCA_PASSPORT_FIELDS) {
    const value = name === 'status' ? RCA_STATUSES[record.problem.status] : record.problem[name];
    if (value) details.append(rcaElement('dt', label), rcaElement('dd', value));
  }
  details.append(rcaElement('dt', 'Регистрация'), rcaElement('dd', record.problem.createdAt),
    rcaElement('dt', 'Обновление'), rcaElement('dd', record.problem.updatedAt));
  pane.append(details, rcaButton('Редактировать паспорт', () => {
    rcaEditor('Паспорт', RCA_PASSPORT_FIELDS.map(([label, key, options]) =>
      [label, key, record.problem[key], {...options, suggestions: references.suggestions[key]}]), values => commit(next => {
      if (values.status === 'closed' && next.problem.status !== 'closed' &&
          (next.rcaNodes.some(node => (node.flagK || node.flagM) && rcaActionCoverage(next, node.id) !== 'Выполнено') ||
           [...next.evidence, ...next.actions].some(item => !['closed', 'cancelled'].includes(item.status)))) {
        if (!window.confirm('Есть причины без выполненных мероприятий или незавершённые проверки. Закрыть проблему?')) {
          throw new Error('Закрытие отменено.');
        }
      }
      Object.assign(next.problem, values, {title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)});
    }));
  }));
  for (const [label, key, fields] of RCA_PASSPORT_COLLECTIONS) {
    const section = rcaElement('section', '', 'card');
    section.append(rcaElement('h2', label));
    if (key === 'classifications' && references.paths.length) {
      section.append(rcaElement('h3', 'Связи из ProblemGrade'));
      const list = rcaElement('ul');
      for (const path of references.paths) list.append(rcaElement('li', path.join(' → ')));
      section.append(list, rcaElement('h3', 'Ручные цепочки'));
    }
    for (const item of record[key]) {
      const row = rcaElement('div', '', 'rca-passport-row');
      row.append(rcaElement('span', fields.map(([, name]) => item[name]).filter(Boolean).join(' · ')),
        rcaButton('Редактировать', () => editRcaCollection(record, key, label, fields, commit, item)),
        rcaButton('Удалить', async () => {
          if (!window.confirm('Удалить запись?')) return;
          try {
            await commit(next => {
              if (key === 'symptoms') removeRcaTreeItem(next, item.id, true);
              else next[key] = next[key].filter(entry => entry.id !== item.id);
            });
          } catch (error) { window.alert(error.message); }
        }));
      section.append(row);
    }
    section.append(rcaButton(key === 'symptoms' ? '+ Симптом' : 'Добавить', () =>
      editRcaCollection(record, key, label, fields, commit)));
    pane.append(section);
  }
  return pane;
}
