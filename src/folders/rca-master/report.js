function buildRcaReport(record, official = record.officialSnapshot) {
  validateRcaProblem(record);
  const {problem} = record;
  const nodes = new Map(record.rcaNodes.map(node => [node.id, node]));
  const symptoms = new Map(record.symptoms.map(item => [item.id, item.title]));
  const sections = [];
  const fields = (item, definitions) => definitions.map(([label, key]) => [label, item[key]]);
  const cause = id => nodes.get(id)?.title;
  const photos = (type, id) => listRcaAttachments(record, type, id);

  sections.push({title: 'Паспорт', entries: [{fields: [
    ...fields({...problem, status: RCA_STATUSES[problem.status] ?? problem.status}, RCA_PASSPORT_FIELDS),
    ['Регистрация', problem.createdAt], ['Обновление', problem.updatedAt], ['Ревизия', problem.revision]
  ]}]});
  if (official) sections.push({title:'Официальные данные PRB',entries:[{fields:[
    ['Номер',official.prbNumber],['Статус ITSM',official.itsmStatus],['Название',official.title],
    ['Проект / направление',official.project],['Источник',official.fileName],['Загружено',official.loadedAt]
  ]}]});
  for (const [title, key, definitions] of RCA_PASSPORT_COLLECTIONS) {
    sections.push({title, entries: record[key].filter(item =>
      key !== 'attachments' || item.kind !== 'local_file').map(item => ({fields: fields(item, definitions)}))});
  }
  sections.push({title: 'RCA Master · Цепочки причин', entries: rcaTreeColumns(record).slice(1).flatMap(
    (column, level) => column.map(node => ({title: 'Почему ' + (level + 1) + ' · ' + node.title, fields: [
      ['Симптом', symptoms.get(node.symptomId)], ['Предшествующая причина', cause(node.parentId)],
      ['Категория', node.category],
      ['Статус гипотезы', rcaEvidenceState(record, node.id) === 'unknown' ? 'Гипотеза' : rcaEvidenceVerdict(record, node.id)],
      ['Предполагаемая коренная причина', node.flagK ? 'Да' : ''],
      ['Оценка доказательств', rcaEvidenceVerdict(record, node.id)],
      ['Покрытие мероприятиями', rcaActionCoverage(record, node.id)]
    ]}))
  )});
  sections.push({title: 'Доказательства', entries: record.evidence.map(item => ({photos: photos('evidence', item.id), fields: [
    ['Причина', cause(item.nodeId)], ['Способ проверки', item.method], ['Что нужно сделать?', item.task],
    ['Лидер / проверяющий', item.leader], ['Срок', item.dueDate], ['Ожидаемый результат (развилка)', item.expected],
    ['Результат проверки', item.actual], ['Вердикт', RCA_VERDICTS[item.verdict] ?? RCA_VERDICTS.unknown],
    ['Статус', {draft: 'Черновик', in_progress: 'В работе', closed: 'Завершено', cancelled: 'Отменено'}[item.status]],
    ['Материалы', item.materials]
  ]}))});
  sections.push({title: 'Мероприятия', entries: record.actions.map(item => ({photos: photos('action', item.id), fields: [
    ['Название мероприятия', item.text], ['Сектор', RCA_SECTORS[item.sector]], ['Причины', item.nodeIds.map(cause).join('\n')],
    ['Вид', {corrective: 'Корректирующее', preventive: 'Предупредительное'}[item.kind]],
    ['Ответственный', item.assignee], ['Срок', item.dueDate], ['Статус', RCA_ACTION_STATUSES[item.status]],
    ['Номер ЗНО', item.zno], ['Отчёт о выполнении', item.result]
  ]}))});
  for (const item of record.actions.filter(item=>item.plan)) {
    const {plan} = item;
    sections.push({title:'План · '+(item.text || plan.template.title),entries:[
      {fields:[['Сценарий',plan.template.title],['Начало плана',plan.start],['Окончание плана',plan.end]]},
      ...plan.steps.map((step,index)=>({title:(index+1)+'. '+step.title,fields:[
        ['Календарных дней',step.durationDays],['Начало план',step.plannedStart],['Конец план',step.plannedEnd],
        ['Начало факт',step.actualStart],['Конец факт',step.actualEnd],['Ответственный',step.assignee],
        ['Контрольный результат',step.result],['Примечание',step.note],['Отчёт',step.report],['Статус',RCA_ACTION_STATUSES[step.status]]
      ]}))
    ]});
  }
  return {id: rcaDisplayId(problem), title: problem.title, sections};
}

function renderRcaPrintable(report, thumbnails = new Map()) {
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
      for (const photo of entry.photos ?? []) {
        const figure = rcaElement('figure');
        const url = thumbnails.get(photo.id);
        if (url) {
          const image = rcaElement('img');
          image.src = url;
          image.alt = photo.description || photo.name;
          figure.append(image);
        }
        figure.append(rcaElement('figcaption', 'Фото · ' + photo.name +
          (photo.description ? ' · ' + photo.description : '')));
        section.append(figure);
      }
    }
    article.append(section);
  }
  return article;
}

function printRcaReport(record, official, thumbnails) {
  const report = renderRcaPrintable(buildRcaReport(record, official), thumbnails);
  document.body.append(report);
  document.body.classList.add('rca-printing');
  try {
    window.print();
  } finally {
    document.body.classList.remove('rca-printing');
    report.remove();
  }
}

async function printRcaReportWithPhotos(record, official, store) {
  const urls = new Map();
  try {
    for (const photo of record.attachments.filter(item => item.kind === 'local_file').slice(0, 12)) {
      const blob = await store.loadBinary(record, photo.id);
      const bitmap = await createImageBitmap(blob, {resizeWidth: 320});
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = Math.min(240, bitmap.height);
        const scale = Math.min(1, canvas.height / bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
        const thumb = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .8));
        if (!thumb) throw new Error('Не удалось подготовить миниатюру: ' + photo.name);
        const url = URL.createObjectURL(thumb);
        urls.set(photo.id, url);
        const image = new Image();
        image.src = url;
        await image.decode();
      } finally {
        bitmap.close();
      }
    }
    printRcaReport(record, official, urls);
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url);
  }
}
