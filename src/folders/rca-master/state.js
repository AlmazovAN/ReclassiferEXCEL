function createRcaState(statusElement) {
  let repository = createRcaRepository();
  let draft = null;
  let saving = null;
  let workspaceChanged;
  const messages = {
    ready: 'Подключена папка для записи RCA.',
    dirty: 'Есть несохранённые изменения.',
    saving: 'Сохранение…',
    saved: 'Сохранено в папку.',
    error: 'Не удалось сохранить.',
    export_required: 'Прямая запись недоступна. Для сохранения требуется экспорт JSON.'
  };

  function show(status, detail = '') {
    if (!statusElement) return;
    statusElement.dataset.status = status;
    statusElement.textContent = messages[status] + (detail ? ' ' + detail : '');
  }

  async function openWorkspace(context) {
    if (!canLeave()) return false;
    const next = createRcaRepository(context);
    repository = next;
    workspaceChanged?.();
    try {
      const capability = await next.getWriteCapability();
      const {issues} = await next.listIndex();
      if (next === repository) show(capability.writable ? 'ready' : 'export_required',
        issues.length ? 'Повреждённые индексы: ' + issues.join(', ') : '');
    } catch (error) {
      if (next === repository) show('error', error.message);
    }
    return true;
  }

  function setDraft(record, expectedRevision) {
    if (saving) throw new Error('Дождитесь завершения сохранения.');
    draft = {record: structuredClone(validateRcaProblem(record)), expectedRevision};
    show('dirty');
  }

  function flushPending() {
    if (!draft) return Promise.resolve(true);
    saving ??= (async () => {
      try {
        if (!(await repository.getWriteCapability()).writable) {
          show('export_required');
          return false;
        }
        show('saving');
        const saved = await repository.saveRevision(draft.record, draft.expectedRevision);
        draft = null;
        show('saved');
        return saved;
      } catch (error) {
        show('error', error.message);
        return false;
      }
    })().finally(() => { saving = null; });
    return saving;
  }

  function canLeave() {
    return !draft && !saving;
  }

  show('export_required');
  return {
    openWorkspace, setDraft, flushPending, canLeave, getRepository: () => repository,
    onWorkspaceChanged(callback) { workspaceChanged = callback; },
    useTemporaryCopy() { draft = null; show('export_required'); },
    discardDraft() {
      if (!saving) { draft = null; show('ready'); }
    }
  };
}
