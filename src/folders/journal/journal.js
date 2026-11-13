'use strict';

function createFoldersJournal({downloadBlob, getOperation, openedAsFile, supportsFolderPicker, memoryMiB}) {
  const logging = new Map([...document.querySelectorAll('[data-log]')].map(checkbox=>[checkbox.dataset.log,checkbox]));
  const entries = [];
  const logLimit = 2000;
  const journalKey = 'reclassifier.folders.journal.v1:'+location.pathname;
  let journalStorage;
  let journalTimer;
  let omittedEntries = 0;
  const logEmpty = document.getElementById('operation-log-empty');
  const journalStatus = document.getElementById('journal-storage-status');
  const lines = document.getElementById('operation-lines');
  const downloadLog = document.getElementById('download-log');
  const downloadLogJson = document.getElementById('download-log-json');

  function isLogging(category) {
    return logging.get(category)?.checked === true;
  }

  function updateJournalControls() {
    const empty = entries.length === 0;
    logEmpty.hidden = !empty;
    downloadLog.disabled = empty;
    downloadLogJson.disabled = empty;
  }

  function journalStorageUnavailable() {
    journalStorage = null;
    journalStatus.textContent = 'Браузер не разрешил сохранять журнал этой вкладки. Скачайте его перед перезагрузкой страницы.';
  }

  function persistJournal() {
    clearTimeout(journalTimer);
    journalTimer = undefined;
    if (!journalStorage) return;
    const categories = [...logging.keys()].filter(isLogging);
    if (!entries.length && !categories.length) return;
    try {
      let count = entries.length;
      let snapshot;
      do {
        const dropped = entries.length-count;
        snapshot = JSON.stringify({categories,entries:entries.slice(dropped),
          omittedEntries:omittedEntries+dropped,operation:getOperation()});
        if (snapshot.length <= 1000000 || !count) break;
        count = Math.floor(count/2);
      } while (true);
      journalStorage.setItem(journalKey,snapshot);
    } catch {
      journalStorageUnavailable();
    }
  }

  function scheduleJournal() {
    if (journalStorage && journalTimer === undefined) journalTimer = setTimeout(persistJournal,500);
  }

  function restoreJournal() {
    let saved;
    try {
      journalStorage = window.sessionStorage;
      saved = JSON.parse(journalStorage.getItem(journalKey));
    } catch {
      journalStorageUnavailable();
    }
    if (Array.isArray(saved?.categories)) {
      for (const [category,checkbox] of logging) checkbox.checked = saved.categories.includes(category);
    }
    if (Array.isArray(saved?.entries)) {
      const valid = saved.entries.filter(entry=>typeof entry?.timestamp === 'string' &&
        logging.has(entry.category) && typeof entry.message === 'string');
      entries.push(...valid.slice(-logLimit));
      omittedEntries = Number.isSafeInteger(saved.omittedEntries) && saved.omittedEntries >= 0 ? saved.omittedEntries : 0;
      omittedEntries += Math.max(0,valid.length-logLimit);
      lines.replaceChildren(...entries.map(entry=>document.createTextNode(entry.message+'\n')));
    }
    updateJournalControls();
    if (saved?.operation) {
      const message = 'Страница открылась заново во время операции · '+saved.operation.action+
        ' · последний этап: '+saved.operation.stage+'.';
      capture(isLogging('diagnostics') ? 'diagnostics' : 'import_export',message,saved.operation.action === 'reclassification');
      persistJournal();
    }
    logEnvironment();
  }

  function capture(category, message, always = false) {
    if (!always && !isLogging(category)) return;
    entries.push({ timestamp: new Date().toISOString(), category, message });
    if (entries.length > logLimit) {
      entries.shift();
      omittedEntries++;
      lines.firstChild?.remove();
    }
    updateJournalControls();
    lines.append(document.createTextNode(message+'\n'));
    console.info('[Reclassifier]', category, message);
    scheduleJournal();
  }

  function downloadReport(content, type, extension) {
    const name = 'Reclassifier-'+new Date().toISOString().slice(0,19).replaceAll(':','-')+'Z.'+extension;
    downloadBlob(new Blob([content],{type}),name);
  }

  downloadLog.addEventListener('click', () => {
    if (!entries.length) return;
    const header = omittedEntries ? ['Ранних записей вне лимита журнала: '+omittedEntries] : [];
    const report = [...header,...entries.map(({timestamp,category,message})=>
      timestamp+' ['+category+'] '+message)].join('\r\n')+'\r\n';
    downloadReport('\uFEFF'+report, 'text/plain;charset=utf-8', 'txt');
  });

  downloadLogJson.addEventListener('click', () => {
    if (!entries.length) return;
    downloadReport(JSON.stringify({ entries, omittedEntries }, null, 2), 'application/json', 'json');
  });

  async function logEnvironment() {
    if (!isLogging('diagnostics')) return;
    capture('diagnostics','Диагностика файлового доступа: file-io-4.');
    const navigation = performance.getEntriesByType('navigation')[0]?.type || 'неизвестно';
    capture('diagnostics','Запуск: '+(openedAsFile ? 'HTML-файл' : location.protocol)
      +' · навигация: '+navigation+' · вкладка выгружалась браузером: '
      +(typeof document.wasDiscarded === 'boolean' ? (document.wasDiscarded ? 'да' : 'нет') : 'нет данных')
      +' · безопасный контекст: '+(window.isSecureContext ? 'да' : 'нет')
      +' · изоляция контекста: '+(window.crossOriginIsolated ? 'да' : 'нет')
      +' · выбор папки: '+(supportsFolderPicker ? 'доступен' : 'недоступен')
      +' · сохранение журнала в сессии: '+(journalStorage ? 'доступно' : 'недоступно'));
    try {
      const storage = navigator.storage;
      if (!storage?.estimate) {
        capture('diagnostics','Оценка дисковой квоты браузера недоступна.');
        return;
      }
      const {usage,quota} = await storage.estimate();
      capture('diagnostics','Оценка дисковой квоты браузера · занято: '+
        (Number.isFinite(usage) ? memoryMiB(usage)+' МиБ' : 'нет данных')+' · всего: '+
        (Number.isFinite(quota) ? memoryMiB(quota)+' МиБ' : 'нет данных')+'. Это оценка хранилища, не оперативной памяти.');
    } catch (error) {
      capture('diagnostics','Браузер не предоставил оценку дисковой квоты · '+(error.name || 'Error')+'.');
    }
  }

  for (const [category,checkbox] of logging) {
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        capture(category, 'Запись событий категории включена.');
        if (category === 'diagnostics') void logEnvironment();
      }
      persistJournal();
    });
  }
  restoreJournal();
  window.addEventListener('pageshow',()=>{
    if (entries.length) return;
    for (const category of logging.keys()) capture(category,'Запись событий категории активна.');
  });
  window.addEventListener('pagehide',persistJournal);
  document.addEventListener('visibilitychange',()=>{
    if (document.visibilityState === 'hidden') persistJournal();
  });

  return {capture, isLogging, persistJournal, scheduleJournal};
}
