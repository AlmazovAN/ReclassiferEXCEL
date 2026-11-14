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

function rcaRowActions(title, remove) {
  const menu = rcaElement('details', '', 'rca-row-menu');
  const trigger = rcaElement('summary', '⋯');
  trigger.setAttribute('aria-label', 'Действия: ' + title);
  const button = rcaButton('Удалить', () => {
    menu.open = false;
    trigger.focus();
    remove();
  }, 'rca-danger');
  menu.append(trigger, button);
  menu.addEventListener('focusout', event => {
    if (!menu.contains(event.relatedTarget)) menu.open = false;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      trigger.focus();
    }
  });
  return menu;
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
  if (options.hint) input.placeholder = options.hint;
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

function rcaEditor(title, fields, apply, discard, workspace, submitLabel = 'Сохранить') {
  const dialog = workspace ? null : rcaElement('dialog', '', 'rca-dialog');
  const form = rcaElement('form', '', 'rca-form');
  const error = rcaElement('p', '', 'rca-error');
  error.setAttribute('role', 'alert');
  const heading = rcaElement('h2', title);
  form.append(heading);
  for (const [label, name, value, options] of fields) rcaField(form, label, name, value, options);
  const save = rcaElement('button', submitLabel, 'primary');
  const cancel = rcaButton(workspace ? 'К списку' : 'Отмена', () => {
    if (workspace) workspace.close();
    else dialog.close();
  });
  form.append(error, save, cancel);
  dialog?.append(form);
  if (dialog) document.body.append(dialog);
  dialog?.addEventListener('close', () => {
    if (form.failed) discard?.();
    dialog.remove();
  }, {once: true});
  dialog?.addEventListener('cancel', event => { if (save.disabled) event.preventDefault(); });
  bindRcaSaveShortcut(form, save);
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
      if (workspace) workspace.close(true);
      else dialog.close();
    } catch (failure) {
      form.failed = true;
      error.textContent = failure.message;
    } finally {
      save.disabled = cancel.disabled = false;
    }
  });
  if (workspace) {
    heading.tabIndex = -1;
    form.classList.add('card', 'rca-detail');
    form.prepend(cancel);
    workspace.open(form);
    heading.focus();
  } else dialog.showModal();
}

function bindRcaSaveShortcut(form, save) {
  form.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || event.key !== 'Enter' ||
        event.isComposing || event.defaultPrevented || save.disabled ||
        event.target.closest('select, button, [contenteditable]')) return;
    event.preventDefault();
    form.requestSubmit(save);
  });
}

function createRcaUi(state, downloadBlob, calculateItsmMetrics) {
  const register = document.getElementById('rca-register');
  const search = document.getElementById('rca-search');
  const statusFilter = document.getElementById('rca-itsm-filter');
  const officialStatus = document.getElementById('rca-official-status');
  const officialDownload = document.getElementById('rca-official-download');
  const officialWarnings = document.getElementById('rca-official-warnings');
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
  let detail = null;
  let detailDirty = false;
  let detailReturnTab = 0;
  let planActionId = null;
  let gallery = null;

  function leaveDetail(saved = false) {
    if (!detail) return true;
    if (!saved && busy) return false;
    const pendingPlan = planActionId && !state.canLeave();
    if (!saved && (detailDirty || pendingPlan) &&
        !window.confirm('Выйти без сохранения изменений?')) return false;
    if (detail.failed || pendingPlan) state.discardDraft();
    detail = null;
    gallery?.dispose();
    gallery = null;
    detailDirty = false;
    planActionId = null;
    return true;
  }

  function detailEditor(section) {
    return (heading, fields, apply, ownerId) => rcaEditor(heading, fields, apply, undefined, {
      open(form) {
        ++request;
        detailReturnTab = section;
        tab = section;
        detail = form;
        detailDirty = false;
        if (ownerId && section === 3) {
          const openPlan = rcaButton('Открыть типовой план', () => {
            if (busy || !state.canLeave()) return;
            planActionId = ownerId;
            render();
            content.querySelector('.rca-plan-screen h2')?.focus();
          });
          openPlan.classList.add('rca-open-plan');
          form.querySelector('h2').after(openPlan);
        }
        if (ownerId) {
          const repository = state.getRepository();
          gallery = createRcaAttachmentGallery({
            record: active, ownerType: section === 2 ? 'evidence' : 'action', ownerId, repository,
            canWrite: async () => rows.some(row => row.id === active?.problem.id) &&
              !local.has(active.problem.id) && (await repository.getWriteCapability()).writable,
            async mutate(operation, updateGallery) {
              if (busy || !state.canLeave() || repository !== state.getRepository() || detail !== form) {
                throw new Error('Завершите текущее сохранение и повторите действие.');
              }
              if (local.has(active.problem.id)) throw new Error('Сначала сохраните карточку в рабочей папке.');
              busy = true;
              try {
                await operation(repository.attachments, active, saved => {
                  updateGallery(saved);
                  showSaved(saved);
                });
              } finally {
                busy = false;
              }
            }
          });
        }
        form.addEventListener('input', () => { detailDirty = true; });
        form.addEventListener('change', () => { detailDirty = true; });
        render();
      },
      close(saved) {
        if (!leaveDetail(saved)) return;
        tab = detailReturnTab;
        render();
        content.querySelector('.rca-tabs [aria-pressed=true]')?.focus();
      }
    });
  }

  function openTreeLinks(key, nodeId) {
    if (busy || !active) return;
    const record = active;
    const evidence = key === 'evidence';
    const items = record[key].filter(item => item.status !== 'cancelled' &&
      (evidence ? item.nodeId === nodeId : item.nodeIds.includes(nodeId)));
    const open = item => {
      if (record !== active) return;
      if (evidence) editRcaEvidence(record, commit, dictionaries, item, undefined, undefined, detailEditor(2));
      else editRcaAction(record, commit, detailEditor(3), item.sector, item);
    };
    if (items.length === 1) open(items[0]);
    if (items.length > 1) {
      const choices = Object.fromEntries([['', 'Выберите запись'], ...items.map((item, index) => [
        item.id, (index + 1) + '. ' + (evidence ? item.task || item.method || 'Черновик проверки' :
          item.text || 'Черновик мероприятия')
      ])]);
      rcaEditor(evidence ? 'Связанные доказательства' : 'Связанные мероприятия',
        [['Запись', 'id', '', {choices, required: true}]], ({id}, form) => {
          form.closest('dialog').addEventListener('close', () => open(items.find(item => item.id === id)), {once: true});
        }, undefined, undefined, 'Открыть');
    }
  }
  let officialRegistry = null;
  let planLibrary = null;
  let planStatus = '';
  let planRequest = 0;
  async function updatePlanLibrary(library, details = []) {
    const repository = state.getRepository();
    const request = ++planRequest;
    try {
      const saved = library ? await repository.planLibrary.publish(library) : false;
      const next = library ?? planLibrary ?? await repository.planLibrary.readLatest();
      if (repository !== state.getRepository() || request !== planRequest) return;
      planLibrary = next;
      planStatus = library ? (saved ? 'Библиотека сохранена.' : 'Библиотека доступна в этой вкладке.') :
        (next ? 'Используется предыдущая библиотека. ' : 'Библиотека не подключена. ') + details.join(' ');
    } catch (error) {
      if (repository !== state.getRepository() || request !== planRequest) return;
      planStatus = error.message;
    }
    render();
  }
  let references = null;
  let selectedOfficial = null;
  let officialRequest = 0;
  let pendingOfficial = null;
  let officialWrite = null;
  let tab = 0;
  let request = 0;
  let busy = false;
  const analytics = {
    index:null, months:1, busy:false, status:'Обновите расчёты из export_ITSM.xlsx.',
    normalizeSite:normalizeRcaMetricSite,
    async refresh() {
      if (analytics.busy) return;
      const repository = state.getRepository();
      analytics.busy = true;
      analytics.status = 'Проверка источника…';
      render();
      try {
        const result = await calculateItsmMetrics(analytics.index, status => {
          analytics.status = status;
          render();
        });
        if (result.type === 'analytics-ready') {
          const saved = await repository.itsmAnalytics.publish(result.index);
          analytics.index = result.index;
          analytics.status = saved ? 'Расчёт обновлён.' : 'Расчёт доступен в текущей вкладке.';
        } else if (result.type === 'analytics-unchanged') analytics.status = 'Источник и правила не изменились.';
        else analytics.status = analytics.index ? 'Источник не найден. Показан предыдущий расчёт.' : 'Источник export_ITSM.xlsx не найден.';
      } catch (error) {
        analytics.status = (analytics.index ? 'Показан предыдущий расчёт. ' : '') + error.message;
      } finally {
        analytics.busy = false;
        render();
      }
    }
  };
  let targetNode = null;

  function navigateToNode(id) {
    targetNode = id;
    tab = 1;
    render();
  }

  function renderRegister() {
    const all = new Map(rows.map(row => [row.id, row]));
    for (const [id, record] of local) all.set(id, record.problem);
    const rowsToShow = mergeRcaRegistry([...all.values()], officialRegistry?.records ?? [])
      .filter(row => !statusFilter.value || row.official?.itsmStatus === statusFilter.value);
    register.replaceChildren(...filterRcaRegistry(rowsToShow, search.value).map(row => {
      const item = rcaElement('li');
      const button = rcaButton('', () => {
        if (!row.unstarted) return void select(row.id);
        if (busy || !leaveDetail() || !state.canLeave()) return;
        ++request;
        active = null;
        selectedOfficial = row.prbNumber;
        message.textContent = '';
        render();
      });
      button.append(rcaElement('small', rcaDisplayId(row), 'rca-register-id'),
        rcaElement('span', row.title, 'rca-register-name'));
      button.append(rcaElement('small', row.unstarted ? 'Расследование не начато' :
        row.official ? 'Расследование ведётся · ' + row.official.itsmStatus :
        row.prbNumber ? 'Официальная запись недоступна' : RCA_STATUSES[row.status] ?? row.status));
      button.setAttribute('aria-pressed', String((active?.problem.id ?? selectedOfficial) === row.id));
      item.append(button);
      return item;
    }));
  }

  function render() {
    renderRegister();
    content.replaceChildren();
    const official = officialRegistry?.records.find(row => row.prbNumber ===
      (active?.problem.prbNumber?.toUpperCase() ?? selectedOfficial));
    title.textContent = active?.problem.title ?? official?.title ?? 'RCA Master';
    if (!active) {
      if (official) {
        content.append(renderOfficialPrb(official, officialRegistry), rcaButton('Начать расследование', async () => {
          try {
            if (pendingOfficial?.problem.prbNumber !== official.prbNumber) {
              pendingOfficial = createRcaProblem({title: official.title, prbNumber: official.prbNumber});
            }
            tab = 0;
            await commit(next => {
              next.problem.description = official.description ?? '';
              next.problem.project = official.project ?? '';
              next.problem.officialSource = {sourceHash: officialRegistry.sourceHash, fileName: officialRegistry.fileName,
                loadedAt: officialRegistry.loadedAt, prbNumber: official.prbNumber};
            }, pendingOfficial);
            pendingOfficial = null;
            selectedOfficial = null;
          } catch (error) { message.textContent = error.message; }
        }, 'primary'));
        return;
      }
      content.append(rcaElement('p', 'Выберите проблему в реестре или нажмите «Добавить проблему».', 'card rca-empty'));
      return;
    }
    const problem = active.problem;
    const toolbar = rcaElement('div', '', 'rca-investigation-bar');
    const context = rcaElement('div', '', 'rca-investigation-context');
    context.append(rcaElement('strong', rcaDisplayId(problem)),
      rcaElement('span', 'Статус PRB · ' + (RCA_STATUSES[problem.status] ?? problem.status)),
      rcaElement('span', 'Статус ITSM · ' + (official?.itsmStatus || 'Нет данных')));
    toolbar.append(context);
    toolbar.append(rcaButton('Печать отчёта', () => {
      if (busy || !state.canLeave()) {
        message.textContent = 'Завершите сохранение перед печатью отчёта.';
        return;
      }
      const record = active;
      const official = withOfficialSnapshot(record).officialSnapshot;
      if (!record.attachments.some(item => item.kind === 'local_file')) {
        try { printRcaReport(record, official); }
        catch (error) { message.textContent = error.message; }
        return;
      }
      const repository = state.getRepository();
      rcaEditor('Печать отчёта', [['Фотографии', 'mode', 'list', {choices: {
        list: 'Перечень с подписями', thumbnails: 'Перечень и до 12 миниатюр'
      }}]], async ({mode}, form) => {
        const dialog = form.closest('dialog');
        dialog.addEventListener('close', () => {
          void (async () => {
            busy = true;
            try {
              message.textContent = '';
              if (mode === 'thumbnails') await printRcaReportWithPhotos(record, official, repository.attachments);
              else printRcaReport(record, official);
            } catch (error) { message.textContent = error.message; }
            finally { busy = false; }
          })();
        }, {once:true});
      }, undefined, undefined, 'Печать');
    }));
    toolbar.append(rcaButton('Экспорт JSON', async () => {
      try {
        const blob = await exportRcaArchive([problem], [], () => withOfficialSnapshot(active));
        downloadBlob(blob, problem.id + '.json');
        unexported.delete(problem.id);
      } catch (error) { message.textContent = error.message; }
    }));
    const navigation = rcaElement('nav', '', 'rca-tabs');
    navigation.setAttribute('aria-label', 'Разделы карточки');
    tabs.forEach((label, index) => {
      const count = index === 2 ? active.evidence.length : index === 3 ? active.actions.length : 0;
      const button = rcaButton(label, () => {
        if ((!detail && tab === index) || !leaveDetail()) return;
        tab = index;
        render();
        content.querySelector('.rca-tabs [aria-pressed=true]')?.focus();
      });
      if (count) button.append(rcaElement('span', String(count), 'rca-tab-count'));
      button.setAttribute('aria-pressed', String(index === tab));
      navigation.append(button);
    });
    content.append(toolbar, navigation);
    if (planActionId) {
      const action = active.actions.find(item => item.id === planActionId);
      if (action) {
        const panel = rcaElement('section', '', 'card rca-plan-screen');
        const heading = rcaElement('h2', 'Типовой план');
        heading.tabIndex = -1;
        panel.append(rcaButton('← К мероприятию', () => {
          if (busy) return;
          if (!state.canLeave()) {
            if (!window.confirm('Выйти без сохранения изменений плана?')) return;
            state.discardDraft();
          }
          planActionId = null;
          render();
          detail.querySelector('.rca-open-plan')?.focus();
        }), heading, rcaElement('p', action.text || 'Черновик мероприятия'),
        rcaPlanControls(action, planLibrary, commit));
        content.append(panel);
        return;
      }
      planActionId = null;
    }
    if (detail) {
      content.append(detail);
      if (gallery) content.append(gallery.panel);
      return;
    }
    if (tab === 0) {
      if (official) content.append(renderOfficialPrb(official, officialRegistry));
      else if (problem.prbNumber) content.append(rcaElement('p', 'Официальная запись недоступна.'));
      content.append(renderRcaMetrics(problem, analytics), renderRcaPassport(active, commit,
        rcaPassportReferences(dictionaries, officialRegistry, references, problem.prbNumber)));
    }
    if (tab === 1) {
      if (!viewports.has(problem.id)) viewports.set(problem.id, {scale: 1, left: 0, top: 0});
      content.append(renderRcaTree(active, commit, viewports.get(problem.id), targetNode, dictionaries,
        detailEditor(2), openTreeLinks));
      targetNode = null;
    }
    if (tab === 2) content.append(renderRcaEvidence(active, commit, navigateToNode, dictionaries, detailEditor(2)));
    if (tab === 3) content.append(renderRcaActions(active, commit, navigateToNode, detailEditor(3)));
  }

  function withOfficialSnapshot(record) {
    const number = record.problem.prbNumber?.toUpperCase();
    const current = officialRegistry?.records.find(row => row.prbNumber === number);
    const snapshot = current ? {...current,fileName:officialRegistry.fileName,loadedAt:officialRegistry.loadedAt} :
      record.officialSnapshot?.prbNumber === number ? record.officialSnapshot : undefined;
    return {...record,officialSnapshot:snapshot};
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
    const hadDetail = Boolean(detail);
    if (busy || !leaveDetail() || !state.canLeave()) return;
    if (hadDetail) render();
    const sequence = ++request;
    try {
      const result = local.has(id) ? {record: local.get(id), issues: []}
        : await state.getRepository().loadProblem(id);
      if (sequence !== request) return;
      if (!result.record) throw new Error('Карточка недоступна.');
      active = result.record;
      selectedOfficial = null;
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
  add.addEventListener('click', () => {
    if (detail) return;
    rcaEditor('Добавить проблему', [
      ['Номер PRB (необязательно)', 'prbNumber'],
      ['Краткое название проблемы', 'title', '', {required: true}],
      ['Оборудование / система', 'equipment']
    ], async (values, form) => {
      form.problem ??= createRcaProblem({...values, title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)});
      tab = 0;
      await commit(next => Object.assign(next.problem, values, {
        title: values.title.trim(), prbNumber: normalizeRcaPrb(values.prbNumber)
      }), form.problem);
    }, state.discardDraft);
  });
  search.addEventListener('input', renderRegister);
  statusFilter.addEventListener('change', renderRegister);

  function setOfficialRegistry(registry, status) {
    const previous = statusFilter.value;
    officialRegistry = registry;
    statusFilter.replaceChildren(new Option('Все статусы ITSM', ''), ...Array.from(
      new Set(registry?.records.map(row => row.itsmStatus) ?? [])
    ).sort((left, right) => left.localeCompare(right, 'ru')).map(value => new Option(value, value)));
    if (Array.from(statusFilter.options).some(option => option.value === previous)) statusFilter.value = previous;
    officialStatus.textContent = status;
    officialDownload.hidden = !registry;
    const warnings = registry?.warnings ?? [];
    officialWarnings.hidden = !warnings.length;
    officialWarnings.querySelector('ul').replaceChildren(...warnings.map(warning => rcaElement('li', warning)));
    render();
  }

  async function updateOfficialRegistry(registry, details = []) {
    const repository = state.getRepository();
    const sequence = ++officialRequest;
    const current = () => repository === state.getRepository() && sequence === officialRequest;
    try {
      if (!registry) {
        const cached = officialRegistry ?? await repository.officialRegistry.readLatest();
        if (current()) setOfficialRegistry(cached,
          (cached ? 'Источник не обновлялся. ' : 'Справочник не подключён. ') + details.join(' '));
        return;
      }
      validateOfficialRegistry(registry);
      let status;
      try {
        const write = repository.officialRegistry.publish(registry);
        officialWrite = write;
        status = await write ? 'Реестр сохранён в рабочей папке.' :
          'Реестр загружен в память. Прямая запись недоступна.';
      } catch (error) {
        if (current()) officialStatus.textContent = 'Реестр не обновлён: ' + error.message;
        return;
      }
      if (current()) setOfficialRegistry(registry,
        status + ' PRB: ' + registry.records.length + (registry.warnings.length ? ' · Предупреждений: ' + registry.warnings.length : ''));
    } catch (error) {
      if (current()) officialStatus.textContent = error.message;
    } finally {
      if (current()) officialWrite = null;
    }
  }

  officialDownload.addEventListener('click', () => {
    if (!officialRegistry) return;
    downloadBlob(new Blob([JSON.stringify(officialRegistry, null, 2)], {type:'application/json'}), 'it-problem-registry.json');
  });
  dictionaryButton.disabled = false;
  dictionaryButton.addEventListener('click', () => {
    if (busy || !state.canLeave()) return;
    void openRcaDictionaries({
      button: dictionaryButton, repository: state.getRepository(),
      planLibrary, planStatus,
      getRows: async repository => {
        const {records} = await repository.listIndex();
        const all = new Map(records.map(row => [row.id, row]));
        for (const [id, record] of local) all.set(id, record.problem);
        return [...all.values()];
      },
      load: async (repository, id) => {
        const record = local.get(id) ?? (await repository.loadProblem(id)).record;
        return record ? withOfficialSnapshot(record) : null;
      },
      read: repository => temporaryDictionaries ? dictionaries : repository.readDictionaries(),
      download(blob, name) {
        downloadBlob(blob, name);
        unexported.clear();
        unexportedDictionaries = false;
      },
      async apply(repository, changes, dictionary, photoFiles) {
        if (repository !== state.getRepository()) throw new Error('Рабочая папка изменилась.');
        const capability = await repository.getWriteCapability();
        if (photoFiles && (!capability.writable || local.size || temporaryDictionaries)) {
          throw new Error('Для импорта ZIP подключите папку с разрешением на запись и завершите работу с временными данными.');
        }
        if (capability.mode === 'write') {
          const saved = await repository.saveBatch(changes, dictionary, photoFiles);
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
    const repository = state.getRepository();
    planLibrary = null;
    planStatus = '';
    void updatePlanLibrary(null);
    analytics.index = null;
    analytics.status = 'Обновите расчёты из export_ITSM.xlsx.';
    const sequence = ++request;
    rows = [];
    active = null;
    detail = null;
    gallery?.dispose();
    gallery = null;
    detailDirty = false;
    planActionId = null;
    selectedOfficial = null;
    pendingOfficial = null;
    references = null;
    setOfficialRegistry(null, 'Справочник не подключён.');
    local.clear();
    unexported.clear();
    dictionaries = [];
    temporaryDictionaries = false;
    unexportedDictionaries = false;
    viewports.clear();
    message.textContent = '';
    render();
    try {
      await Promise.all([refresh(), updateOfficialRegistry(null), repository.itsmAnalytics.readLatest().then(index => {
        if (repository !== state.getRepository() || analytics.busy || !index) return;
        analytics.index = index;
        analytics.status = 'Сохранённый расчёт. Актуальность источника ещё не проверена.';
      })]);
      if (sequence === request) render();
    } catch (error) {
      if (sequence === request) message.textContent = error.message;
    }
  });
  window.addEventListener('beforeunload', event => {
    if (detailDirty || !state.canLeave() || unexported.size || unexportedDictionaries) {
      event.preventDefault();
      event.returnValue = true;
    }
  });
  return {
    closeDetail() {
      if (!detail) return true;
      if (!leaveDetail()) return false;
      render();
      return true;
    },
    hasTemporaryChanges: () => detailDirty || busy || analytics.busy || Boolean(officialWrite) || unexported.size > 0 || unexportedDictionaries,
    showSaved, updateOfficialRegistry, updatePlanLibrary, setReferences(value) { references = value; render(); },
    markAnalyticsStale() {
      if (!analytics.index) return;
      analytics.status = 'Выгрузка ITSM могла измениться. Обновите расчёты.';
      render();
    }
  };
}
