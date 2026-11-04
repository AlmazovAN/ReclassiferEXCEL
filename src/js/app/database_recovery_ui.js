// PR-5 session-only opt-in autosave and optional single-slot recovery checkpoint.
// Never schedule a database write in beforeunload, and never treat browser
// checkpoints as proof that the attached OS .db has been updated.
const databaseAutoSaveSession = {
  enabled: false,
  databaseUuid: null,
  timer: null,
  lastError: null
};

function databaseAutoSaveStop(reason = null) {
  if (databaseAutoSaveSession.timer !== null) {
    clearInterval(databaseAutoSaveSession.timer);
    databaseAutoSaveSession.timer = null;
  }
  databaseAutoSaveSession.enabled = false;
  databaseAutoSaveSession.databaseUuid = null;
  if (reason) databaseAutoSaveSession.lastError = reason;
}

async function databaseAutoSaveTick() {
  if (!databaseAutoSaveSession.enabled || databaseWorkspaceState.busy) return;
  const repository = getDatabaseRepository();
  if (repository.getOperationState().busy) return;
  const info = databaseCurrentInfo();
  const linked = databaseWorkspaceState.fileConnection;
  if (!info || !linked || info.databaseUuid !== linked.databaseUuid ||
      databaseAutoSaveSession.databaseUuid !== info.databaseUuid) {
    databaseAutoSaveStop('Подключённая база изменилась; автосохранение отключено.');
    return;
  }
  if (!info.dirty) return;
  const succeeded = await databaseSaveConnected(true);
  if (!succeeded) {
    databaseAutoSaveStop('Автосохранение остановлено после ошибки записи. Проверьте файл.');
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

async function databaseToggleAutoSave() {
  if (databaseAutoSaveSession.enabled) {
    databaseAutoSaveStop();
    if (state.route === 'database') renderDatabaseWorkspace();
    return;
  }
  const info = databaseCurrentInfo();
  const linked = databaseWorkspaceState.fileConnection;
  if (databaseWorkspaceState.busy || !info || !linked ||
      linked.databaseUuid !== info.databaseUuid) {
    alert('Автосохранение требует подключённую для записи SQLite.');
    return;
  }
  try {
    // Permission request is an explicit user gesture, never a timer callback.
    if (typeof linked.handle.requestPermission === 'function') {
      const granted = await linked.handle.requestPermission({ mode: 'readwrite' });
      if (granted !== 'granted') {
        throw new Error('Нет разрешения браузера на запись в исходную SQLite.');
      }
    } else if (typeof linked.handle.queryPermission === 'function') {
      if (await linked.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('Нет подтверждённого разрешения на автоматическую запись.');
      }
    }
    databaseAutoSaveSession.enabled = true;
    databaseAutoSaveSession.databaseUuid = info.databaseUuid;
    databaseAutoSaveSession.lastError = null;
    // Polling covers all Repository commits without coupling to Dataset
    // business handlers; a single interval, no concurrent save operations.
    databaseAutoSaveSession.timer = setInterval(() => {
      void databaseAutoSaveTick();
    }, 12000);
    log('Автосохранение SQLite включено только для текущей вкладки. ' +
      'Запись выполняется после операций, с проверкой файла; не на каждом COMMIT.', 'INFO', 'import_export');
    if (state.route === 'database') renderDatabaseWorkspace();
    // Dirty state may already exist when opt-in happens.
    void databaseAutoSaveTick();
  } catch (error) {
    databaseAutoSaveStop(error?.message || String(error));
    log('Не удалось включить автосохранение SQLite: ' + databaseAutoSaveSession.lastError, 'ERROR', 'import_export');
    alert('Не удалось включить автосохранение: ' + databaseAutoSaveSession.lastError);
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

function databaseRecoveryStore() {
  const store = globalThis.ReclassifierSqliteRecoveryStore;
  if (!store) throw new Error('Модуль локального восстановления отсутствует.');
  return store;
}

async function databaseInspectRecovery() {
  if (databaseWorkspaceState.busy) return;
  try {
    const store = databaseRecoveryStore();
    const [checkpoint, space] = await Promise.all([store.latest(), store.estimate()]);
    const title = checkpoint
      ? 'Точка: ' + checkpoint.fileName + ', ' +
        databaseFormatTimestamp(checkpoint.createdAt) + ', ' +
        formatBytes(checkpoint.size) + ', ревизия ' + checkpoint.revision + '.'
      : 'Точки восстановления в этом браузере нет.';
    const quota = space?.quota
      ? ' Хранилище: ' + formatBytes(space.usage) + ' занято из ' +
        formatBytes(space.quota) + ' (оценка браузера).'
      : ' Квота хранилища браузером не сообщена.';
    databaseWorkspaceState.recoveryStatus = title + quota;
    if (state.route === 'database') renderDatabaseWorkspace();
  } catch (error) {
    databaseWorkspaceState.recoveryStatus = 'Недоступно: ' + (error?.message || String(error));
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

async function databaseCreateRecovery() {
  const info = databaseCurrentInfo();
  if (!info || databaseWorkspaceState.busy) return;
  if (!confirm('Создать контрольную копию SQLite в хранилище этого браузера? ' +
      'Потребуется дополнительное место размером примерно с базу. ' +
      'Браузер может удалить эти данные; это не замена отдельной резервной копии.')) return;
  databaseWorkspaceState.busy = true;
  if (state.route === 'database') renderDatabaseWorkspace();
  try {
    const store = databaseRecoveryStore();
    const available = await store.estimate();
    const linked = databaseWorkspaceState.fileConnection;
    if (available?.quota && linked?.size &&
        available.quota - available.usage < linked.size * 1.25) {
      throw new Error('Квоты браузера недостаточно для копии выбранной SQLite.');
    }
    // The Repository exports a validated, coherent point-in-time SQLite.
    // It is allocated only on explicit user request, never after each COMMIT.
    const bytes = getDatabaseRepository().exportDatabase();
    const result = await store.save(bytes, {
      fileName: info.fileName, databaseUuid: info.databaseUuid,
      workingRevision: info.storage?.workingRevision
    });
    databaseWorkspaceState.recoveryStatus = 'Контрольная точка сохранена: ' +
      result.fileName + ', ' + formatBytes(result.size) + ', ' +
      databaseFormatTimestamp(result.createdAt) + '.';
    log(databaseWorkspaceState.recoveryStatus +
      ' Это копия в браузере, а не запись в исходный .db.', 'INFO', 'import_export');
  } catch (error) {
    databaseWorkspaceState.recoveryStatus = 'Ошибка контрольной копии: ' +
      (error?.message || String(error));
    log(databaseWorkspaceState.recoveryStatus, 'ERROR', 'import_export');
    alert(databaseWorkspaceState.recoveryStatus);
  } finally {
    databaseWorkspaceState.busy = false;
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

async function databaseRestoreRecovery() {
  if (databaseWorkspaceState.busy) return;
  let checkpoint;
  try {
    checkpoint = await databaseRecoveryStore().latest();
    if (!checkpoint) {
      alert('Контрольной точки в хранилище этого браузера нет.');
      return;
    }
  } catch (error) {
    alert('Не удалось прочитать точку восстановления: ' + (error?.message || String(error)));
    return;
  }
  if (!confirm('Восстановить «' + checkpoint.fileName + '» из браузера (' +
    databaseFormatTimestamp(checkpoint.createdAt) + ')? ' +
    'Текущая открытая SQLite будет заменена в памяти. ' +
    'Исходный .db на диске НЕ будет перезаписан. ' +
    'Восстановленную базу необходимо сохранить в отдельный файл.')) return;
  if (!databaseConfirmReplaceCurrent()) return;
  databaseWorkspaceState.busy = true;
  if (state.route === 'database') renderDatabaseWorkspace();
  try {
    const info = await getDatabaseRepository().openDatabase(checkpoint.bytes, {
      fileName: checkpoint.fileName, recovered: true
    });
    if (info.databaseUuid !== checkpoint.databaseUuid) {
      // Do not leave a mismatched recovery file looking like a valid restore.
      getDatabaseRepository().closeDatabase();
      throw new Error('UUID контрольной точки не соответствует содержимому SQLite.');
    }
    databaseAutoSaveStop();
    databaseWorkspaceState.fileConnection = null;
    databaseWorkspaceState.bootstrap = null;
    databaseResetIntegrationState();
    databaseResetSynchronizationState();
    const health = databaseRunHealthCheck({ render: false });
    if (!health?.ok) throw new Error('Восстановленная база не прошла проверку целостности.');
    const synced = databaseSynchronizeWorkspace('database-recovered', {
      checkHealth: false, render: false
    });
    if (!synced.ok) throw new Error(synced.error || 'Ошибка синхронизации Runtime.');
    databaseWorkspaceState.recoveryStatus = 'Восстановлена точка ' +
      databaseFormatTimestamp(checkpoint.createdAt) +
      '. Изменения только в браузере; скачайте обновлённую SQLite.';
    log(databaseWorkspaceState.recoveryStatus, 'INFO', 'import_export');
    alert(databaseWorkspaceState.recoveryStatus);
  } catch (error) {
    databaseWorkspaceState.lastError = error?.message || String(error);
    alert('Не удалось восстановить SQLite: ' + databaseWorkspaceState.lastError);
    log('Ошибка восстановления SQLite: ' + databaseWorkspaceState.lastError, 'ERROR', 'import_export');
  } finally {
    databaseWorkspaceState.busy = false;
    if (databaseCurrentInfo()) databaseRequestQueuePreparation('database-recovered');
    if (state.route === 'database') renderDatabaseWorkspace();
  }
}

async function databaseDeleteRecovery() {
  if (databaseWorkspaceState.busy) return;
  if (!confirm('Удалить сохранённую в браузере точку восстановления SQLite?')) return;
  try {
    await databaseRecoveryStore().remove();
    databaseWorkspaceState.recoveryStatus = 'Контрольная точка удалена из браузера.';
    if (state.route === 'database') renderDatabaseWorkspace();
  } catch (error) {
    alert('Не удалось удалить контрольную точку: ' + (error?.message || String(error)));
  }
}
