const RCA_PASSPORT_FIELDS = [
  ['Номер PRB', 'prbNumber'], ['Название', 'title', {required: true}],
  ['Описание', 'description', {long: true}], ['Статус', 'status', {choices: RCA_STATUSES}],
  ['Лидер расследования', 'leader'], ['Рудник / подразделение', 'division'],
  ['Участок', 'location'], ['Горизонт', 'level'], ['Место установки', 'installation'],
  ['Тип / класс', 'equipmentClass'], ['Оборудование / система', 'equipment'],
  ['Инвентарный / технический ID', 'equipmentId'], ['Когда и как проявился отказ', 'occurrence', {long: true}],
  ['Условия и ограничения', 'conditions', {long: true}], ['Последовательность событий', 'timeline', {long: true}],
  ['Первичная версия', 'initialHypothesis', {long: true}], ['Количество связанных INC', 'incidentCount'],
  ['Человеко-часы', 'laborHours'], ['Затраты ЗИП', 'partsCost'], ['Источник и период оценки', 'estimateSource']
];

const RCA_PASSPORT_COLLECTIONS = [
  ['Участники', 'participants', [['Имя', 'name'], ['Роль', 'role']]],
  ['Симптомы', 'symptoms', [['Формулировка', 'title'], ['Наблюдение', 'description', {long: true}], ['Дата', 'date']]],
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

function renderRcaPassport(record, commit, dictionaries) {
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
      [label, key, record.problem[key], {...options, suggestions: dictionaries
        .filter(item => item.status === 'active' && item.category === key).map(item => item.value)}]), values => commit(next => {
      if (values.status === 'closed' && next.problem.status !== 'closed' &&
          (next.rcaNodes.some(node => (node.flagK || node.flagM) && rcaActionCoverage(next, node.id) !== 'Выполнено') ||
           [...next.evidence, ...next.actions].some(item => !['closed', 'cancelled'].includes(item.status)))) {
        if (!window.confirm('Есть причины без мероприятий или незавершённые проверки и КД/ПД. Закрыть проблему?')) {
          throw new Error('Закрытие отменено.');
        }
      }
      Object.assign(next.problem, values, {title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)});
    }));
  }));
  for (const [label, key, fields] of RCA_PASSPORT_COLLECTIONS) {
    const section = rcaElement('section', '', 'card');
    section.append(rcaElement('h2', label));
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
