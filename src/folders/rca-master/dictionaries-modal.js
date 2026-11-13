async function openRcaDictionaries({button, repository, getRows, load, read, apply, download}) {
  button.disabled = true;
  const dialog = rcaElement('dialog', '', 'rca-dialog');
  const body = rcaElement('div');
  const notice = rcaElement('p', RCA_ATTACHMENT_WARNING);
  notice.setAttribute('role', 'status');
  const preview = rcaElement('div');
  const file = rcaElement('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  const search = rcaElement('input');
  search.type = 'search';
  search.placeholder = 'Поиск по справочнику';
  search.setAttribute('aria-label', search.placeholder);
  const categories = rcaElement('nav');
  let category = 'equipment';
  let items = [];
  let busy = false;

  async function run(task) {
    if (busy) return;
    busy = true;
    try { await task(); }
    catch (error) { notice.textContent = error.message; }
    finally { busy = false; }
  }

  function render() {
    for (const tab of categories.children) tab.setAttribute('aria-pressed', String(tab.dataset.category === category));
    body.replaceChildren();
    const term = search.value.trim().toLocaleLowerCase('ru');
    for (const item of items.filter(entry => entry.category === category && entry.value.toLocaleLowerCase('ru').includes(term))) {
      const row = rcaElement('div', '', 'rca-passport-row');
      row.append(rcaElement('span', item.value + (item.status === 'archived' ? ' (архив)' : '')),
        rcaButton('Редактировать', () => edit(item)),
        rcaButton(item.status === 'archived' ? 'Восстановить' : 'Архивировать', () => void run(async () => {
          if (item.status === 'active' && !window.confirm('Архивировать значение? Оно останется в ранее заполненных карточках.')) return;
          await update({...item, status: item.status === 'active' ? 'archived' : 'active'});
        })));
      body.append(row);
    }
    if (!body.children.length) body.append(rcaElement('p', 'Значения не найдены.'));
    body.append(rcaButton('Добавить значение', () => edit()));
  }

  async function update(item) {
    const next = [...items.filter(entry => entry.id !== item.id), {...item, updatedAt: new Date().toISOString()}];
    validateRcaDictionaries(next);
    await apply(repository, [], {expected: items, items: next});
    items = next;
    preview.replaceChildren();
    render();
  }

  function edit(item) {
    const form = rcaElement('form', '', 'rca-form');
    rcaField(form, 'Значение', 'value', item?.value, {required: true});
    const save = rcaElement('button', 'Сохранить', 'primary');
    form.append(save, rcaButton('Отмена', render));
    body.replaceChildren(form);
    form.addEventListener('submit', event => {
      event.preventDefault();
      void run(() => update({
        id: item?.id ?? crypto.randomUUID(), category: item?.category ?? category,
        status: item?.status ?? 'active', value: new FormData(form).get('value').trim()
      }));
    });
  }

  for (const [key, label] of Object.entries(RCA_DICTIONARIES)) {
    const tab = rcaButton(label, () => { category = key; search.value = ''; render(); });
    tab.dataset.category = key;
    categories.append(tab);
  }
  search.addEventListener('input', render);
  const exportButton = rcaButton('Экспорт в JSON', () => void run(async () => {
    const rows = await getRows(repository);
    const blob = await exportRcaArchive(rows, await read(repository), id => load(repository, id));
    download(blob, 'RCA-archive.json');
    notice.textContent = 'Расследований: ' + rows.length + '. ' + RCA_ATTACHMENT_WARNING;
  }));
  const importButton = rcaButton('Импорт из JSON', () => { if (!busy) file.click(); });
  file.addEventListener('change', () => void run(async () => {
    const source = file.files[0];
    file.value = '';
    preview.replaceChildren();
    if (!source) return;
    if (!/\.json$/i.test(source.name) || !['', 'application/json', 'text/plain', 'application/octet-stream'].includes(source.type) ||
        source.size > RCA_ARCHIVE_LIMIT) throw new Error('Выберите JSON-архив размером до 16 МБ.');
    const archive = readRcaArchive(await source.text());
    const expected = await read(repository);
    const plan = await planRcaArchive(archive, await getRows(repository), expected, id => load(repository, id));
    const labels = {new: 'Новая', same: 'Совпадает', conflict: 'Конфликт UUID', blocked: 'Отклонена: конфликт PRB или повреждение'};
    const list = rcaElement('ul', '', 'rca-archive-preview');
    const selected = new Map();
    for (const change of plan.problems) {
      const row = rcaElement('li', labels[change.kind] + ' · ' + rcaDisplayId(change.record.problem) + ' · ' + change.record.problem.title);
      if (change.kind === 'conflict') {
        const label = rcaElement('label', ' Заменить эту карточку');
        const checkbox = rcaElement('input');
        checkbox.type = 'checkbox';
        selected.set(change, checkbox);
        label.prepend(checkbox);
        row.append(label);
      }
      list.append(row);
    }
    preview.append(rcaElement('h2', 'Предпросмотр импорта'), list,
      rcaElement('p', 'Значения справочников — новых: ' + plan.added + ', совпадений или конфликтов: ' + plan.skipped + '.'),
      rcaButton('Применить импорт', () => void run(async () => {
        const changes = plan.problems.filter(change => change.kind === 'new' || selected.get(change)?.checked);
        if (changes.some(change => change.kind === 'conflict') && !window.confirm('Заменить выбранные карточки?')) return;
        if (changes.length || plan.added) {
          await apply(repository, changes, plan.added ? {expected, items: plan.items} : undefined);
          items = await read(repository);
          render();
        }
        preview.replaceChildren();
        const rejected = plan.problems.filter(change => change.kind === 'blocked').length;
        notice.textContent = 'Импортировано карточек: ' + changes.length + ', пропущено: ' +
          (plan.problems.length - changes.length - rejected) + ', отклонено: ' + rejected + '. ' + RCA_ATTACHMENT_WARNING;
      })), rcaButton('Отмена импорта', () => preview.replaceChildren()));
  }));
  dialog.append(rcaElement('h2', 'Справочники RCA Master'), categories, search, body,
    exportButton, importButton, file, notice, preview,
    rcaButton('Закрыть', () => { if (!busy) dialog.close(); }));
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    button.disabled = false;
    button.focus();
  }, {once: true});
  document.body.append(dialog);
  dialog.showModal();
  await run(async () => { items = await read(repository); render(); });
}
