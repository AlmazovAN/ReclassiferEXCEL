function rcaElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function rcaButton(label, click, className = 'secondary') {
  const button = rcaElement('button', label, className);
  button.type = 'button';
  button.addEventListener('click', click);
  return button;
}

function rcaField(form, label, name, value = '', options = {}) {
  const wrapper = rcaElement('label', label);
  const input = rcaElement(options.choices ? 'select' : options.long ? 'textarea' : 'input');
  if (options.choices) {
    for (const [key, caption] of Object.entries(options.choices)) {
      const option = rcaElement('option', caption);
      option.value = key;
      input.append(option);
    }
  }
  input.name = name;
  if (options.multiple) {
    input.multiple = true;
    for (const option of input.options) option.selected = (value ?? []).includes(option.value);
  } else {
    if (options.type) input.type = options.type;
    input.value = value ?? '';
  }
  input.required = Boolean(options.required);
  wrapper.append(input);
  if (options.suggestions?.length) {
    const list = rcaElement('datalist');
    list.id = 'rca-options-' + crypto.randomUUID();
    input.setAttribute('list', list.id);
    for (const value of options.suggestions) {
      const option = rcaElement('option');
      option.value = value;
      list.append(option);
    }
    wrapper.append(list);
  }
  form.append(wrapper);
}

function rcaEditor(title, fields, apply, discard) {
  const dialog = rcaElement('dialog', '', 'rca-dialog');
  const form = rcaElement('form', '', 'rca-form');
  const error = rcaElement('p', '', 'rca-error');
  error.setAttribute('role', 'alert');
  form.append(rcaElement('h2', title));
  for (const [label, name, value, options] of fields) rcaField(form, label, name, value, options);
  const save = rcaElement('button', 'Сохранить', 'primary');
  const cancel = rcaButton('Отмена', () => dialog.close());
  form.append(error, save, cancel);
  dialog.append(form);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    if (form.failed) discard?.();
    dialog.remove();
  }, {once: true});
  dialog.addEventListener('cancel', event => { if (save.disabled) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (save.disabled) return;
    save.disabled = cancel.disabled = true;
    error.textContent = '';
    try {
      const data = new FormData(form);
      const values = Object.fromEntries(data);
      for (const select of form.querySelectorAll('select[multiple]')) values[select.name] = data.getAll(select.name);
      await apply(values, form);
      form.failed = false;
      dialog.close();
    } catch (failure) {
      form.failed = true;
      error.textContent = failure.message;
    } finally {
      save.disabled = cancel.disabled = false;
    }
  });
  dialog.showModal();
}

function createRcaUi(state, downloadBlob) {
  const register = document.getElementById('rca-register');
  const search = document.getElementById('rca-search');
  const add = document.getElementById('rca-add');
  const content = document.getElementById('rca-content');
  const message = document.getElementById('rca-message');
  const title = document.getElementById('rca-master-title');
  const tabs = ['Паспорт', 'RCA Master', 'Доказательства', 'Мероприятия'];
  const local = new Map();
  const unexported = new Set();
  const dictionaryButton = document.getElementById('rca-dictionaries');
  let dictionaries = [];
  let temporaryDictionaries = false;
  let unexportedDictionaries = false;
  const viewports = new Map();
  let rows = [];
  let active = null;
  let tab = 0;
  let request = 0;
  let busy = false;
  let targetNode = null;

  function navigateToNode(id) {
    targetNode = id;
    tab = 1;
    render();
  }

  function renderRegister() {
    const all = new Map(rows.map(row => [row.id, row]));
    for (const [id, record] of local) all.set(id, record.problem);
    register.replaceChildren(...filterRcaRegistry([...all.values()], search.value).map(row => {
      const item = rcaElement('li');
      const button = rcaButton(row.title, () => void select(row.id));
      button.prepend(rcaElement('small', rcaDisplayId(row)));
      button.append(rcaElement('small', RCA_STATUSES[row.status] ?? row.status));
      button.setAttribute('aria-pressed', String(active?.problem.id === row.id));
      item.append(button);
      return item;
    }));
  }

  function render() {
    renderRegister();
    content.replaceChildren();
    title.textContent = active ? active.problem.title : 'RCA Master';
    if (!active) {
      content.append(rcaElement('p', 'Выберите или создайте проблему'));
      return;
    }
    const problem = active.problem;
    content.append(rcaElement('p', rcaDisplayId(problem) + ' · ' + (RCA_STATUSES[problem.status] ?? problem.status)));
    content.append(rcaButton('Распечатать отчёт', () => {
      if (busy || !state.canLeave()) {
        message.textContent = 'Завершите сохранение перед печатью отчёта.';
        return;
      }
      try { printRcaReport(active); }
      catch (error) { message.textContent = error.message; }
    }));
    content.append(rcaButton('Экспорт карточки в JSON', async () => {
      try {
        const blob = await exportRcaArchive([problem], [], () => active);
        downloadBlob(blob, problem.id + '.json');
        unexported.delete(problem.id);
      } catch (error) { message.textContent = error.message; }
    }));
    const navigation = rcaElement('nav', '', 'rca-tabs');
    navigation.setAttribute('aria-label', 'Разделы карточки');
    tabs.forEach((label, index) => {
      const count = index === 2 ? active.evidence.length : index === 3 ? active.actions.length : 0;
      const button = rcaButton(count ? label + ' (' + count + ')' : label, () => { tab = index; render(); });
      button.setAttribute('aria-pressed', String(index === tab));
      navigation.append(button);
    });
    content.append(navigation);
    if (tab === 0) content.append(renderRcaPassport(active, commit, dictionaries));
    if (tab === 1) {
      if (!viewports.has(problem.id)) viewports.set(problem.id, {scale: 1, left: 0, top: 0});
      content.append(renderRcaTree(active, commit, viewports.get(problem.id), targetNode));
      targetNode = null;
    }
    if (tab === 2) content.append(renderRcaEvidence(active, commit, navigateToNode, dictionaries));
    if (tab === 3) content.append(renderRcaActions(active, commit, navigateToNode));
  }

  function showSaved(record) {
    if (!record?.problem) return;
    active = record;
    const index = rows.findIndex(row => row.id === record.problem.id);
    if (index >= 0) rows[index] = record.problem;
    else rows.push(record.problem);
    render();
  }

  async function refresh() {
    const current = state.getRepository();
    const result = await current.listIndex();
    const items = await current.readDictionaries();
    if (current === state.getRepository()) {
      rows = result.records;
      if (!temporaryDictionaries) dictionaries = items;
    }
  }

  async function select(id) {
    if (busy || !state.canLeave()) return;
    const sequence = ++request;
    try {
      const result = local.has(id) ? {record: local.get(id), issues: []}
        : await state.getRepository().loadProblem(id);
      if (sequence !== request) return;
      if (!result.record) throw new Error('Карточка недоступна.');
      active = result.record;
      tab = 0;
      message.textContent = result.issues.length ? 'Прочитана доступная версия. Повреждённые файлы: ' + result.issues.join(', ') : '';
      render();
    } catch (error) {
      if (sequence === request) message.textContent = error.message;
    }
  }

  async function commit(change, original = active) {
    if (busy) throw new Error('Дождитесь завершения сохранения.');
    const next = structuredClone(original);
    change(next);
    checkRcaPrb(next.problem, [...rows, ...Array.from(local.values(), record => record.problem)]);
    validateRcaProblem(next);
    busy = true;
    ++request;
    try {
      const repository = state.getRepository();
      const capability = await repository.getWriteCapability();
      if (repository !== state.getRepository()) throw new Error('Рабочая папка изменилась.');
      if (capability.mode !== 'write') {
        next.problem.updatedAt = new Date().toISOString();
        local.set(next.problem.id, next);
        unexported.add(next.problem.id);
        state.useTemporaryCopy();
        active = next;
      } else {
        const expected = rows.some(row => row.id === next.problem.id) ? original.problem.revision : 0;
        state.setDraft(next, expected);
        const saved = await state.flushPending();
        if (!saved) throw new Error('Изменения остались в черновике. Повторите сохранение.');
        showSaved(saved);
      }
      message.textContent = '';
      render();
    } finally {
      busy = false;
    }
  }

  add.disabled = search.disabled = false;
  add.addEventListener('click', () => rcaEditor('Добавить проблему', [
    ['Номер PRB (необязательно)', 'prbNumber'],
    ['Краткое название проблемы', 'title', '', {required: true}],
    ['Оборудование / система', 'equipment']
  ], async (values, form) => {
    form.problem ??= createRcaProblem({...values, title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)});
    tab = 0;
    await commit(next => Object.assign(next.problem, values, {
      title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)
    }), form.problem);
  }, state.discardDraft));
  search.addEventListener('input', renderRegister);
  dictionaryButton.disabled = false;
  dictionaryButton.addEventListener('click', () => {
    if (busy || !state.canLeave()) return;
    void openRcaDictionaries({
      button: dictionaryButton, repository: state.getRepository(),
      getRows: async repository => {
        const {records} = await repository.listIndex();
        const all = new Map(records.map(row => [row.id, row]));
        for (const [id, record] of local) all.set(id, record.problem);
        return [...all.values()];
      },
      load: async (repository, id) => local.get(id) ?? (await repository.loadProblem(id)).record,
      read: repository => temporaryDictionaries ? dictionaries : repository.readDictionaries(),
      download(blob, name) {
        downloadBlob(blob, name);
        unexported.clear();
        unexportedDictionaries = false;
      },
      async apply(repository, changes, dictionary) {
        if (repository !== state.getRepository()) throw new Error('Рабочая папка изменилась.');
        const capability = await repository.getWriteCapability();
        if (capability.mode === 'write') {
          const saved = await repository.saveBatch(changes, dictionary);
          await refresh();
          active = saved.find(record => record.problem.id === active?.problem.id) ?? active;
        } else {
          for (const {record} of changes) {
            local.set(record.problem.id, record);
            unexported.add(record.problem.id);
            if (active?.problem.id === record.problem.id) active = record;
          }
          if (dictionary) {
            dictionaries = dictionary.items;
            temporaryDictionaries = true;
            unexportedDictionaries = true;
          }
          state.useTemporaryCopy();
        }
        render();
      }
    });
  });
  state.onWorkspaceChanged(async () => {
    const sequence = ++request;
    rows = [];
    active = null;
    local.clear();
    unexported.clear();
    dictionaries = [];
    temporaryDictionaries = false;
    unexportedDictionaries = false;
    viewports.clear();
    message.textContent = '';
    render();
    try {
      await refresh();
      if (sequence === request) render();
    } catch (error) {
      if (sequence === request) message.textContent = error.message;
    }
  });
  window.addEventListener('beforeunload', event => {
    if (!state.canLeave() || unexported.size || unexportedDictionaries) {
      event.preventDefault();
      event.returnValue = true;
    }
  });
  return {hasTemporaryChanges: () => busy || unexported.size > 0 || unexportedDictionaries, showSaved};
}
