// FILE CONTRACT: non-destructive Reference directory probe UI.
// Purpose: enumerate selected folders and classify Excel files by internal workbook structure.
// Owns: Directory Handle/WebKit Directory diagnostic state and probe rendering.
// Reads: SheetJS, ReclassifierDatasetClassifier and browser file/directory APIs.
// Writes: diagnostic UI state only; never applies or persists a Dataset.
// Public API: renderReferenceDirectoryProbe, probeDirectoryHandle, probeWebkitDirectory.
// Must not: normalize/apply Reference datasets or persist to SQLite.
// Related tests: test_reference_architecture.py, test_database_workspace_contract.py,
//                smoke_app_runtime.js, test_architecture_guardrails.py.

// ============================================================================
// NON-DESTRUCTIVE WORKBOOK / DIRECTORY PROBE
// Used only to identify likely file types before normal ingestion.
// ============================================================================
// ============================================================================
// DIRECTORY ENUMERATION AND PROBE EXECUTION
// ============================================================================
  async function collectDirectoryFiles(directoryHandle, prefix = '', stats = { objects: 0, folders: 0 }) {
    const result = [];
    for await (const [name, handle] of directoryHandle.entries()) {
      stats.objects += 1;
      const path = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') {
        stats.folders += 1;
        const nested = await collectDirectoryFiles(handle, path, stats);
        result.push(...nested);
      } else if (handle.kind === 'file') {
        result.push({ path, handle });
      }
    }
    return result;
  }

  async function classifyProbeFile(file, path) {
    try {
      const workbook = window.XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellDates: true,
        cellFormula: true
      });
      return {
        path,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        classification: globalThis.ReclassifierDatasetClassifier.classifyWorkbook(workbook)
      };
    } catch (error) {
      return {
        path,
        name: file.name || path.split('/').at(-1),
        size: Number.isFinite(file.size) ? file.size : null,
        lastModified: Number.isFinite(file.lastModified) ? file.lastModified : null,
        classification: {
          id: 'read_error',
          group: 'Ошибка чтения',
          label: 'Ошибка чтения',
          sheetName: null,
          headerRow: null,
          reason: (error?.name ? error.name + ': ' : '') + (error?.message || String(error))
        }
      };
    }
  }

  function buildProbeResult(method, directoryName, folderCount, files) {
    const sorted = files.slice().sort((left, right) => left.path.localeCompare(right.path, 'ru'));
    const groups = {};
    for (const item of sorted) {
      const key = item.classification.label;
      groups[key] = (groups[key] || 0) + 1;
    }
    return {
      status: 'ok',
      method,
      directoryName: directoryName || 'Data',
      folderCount,
      files: sorted,
      groups,
      unknownCount: sorted.filter(item => item.classification.id === 'unknown').length
    };
  }

  function renderReferenceDirectoryProbe() {
    const handleSupported = typeof window.showDirectoryPicker === 'function';
    const webkitSupported = 'webkitdirectory' in document.createElement('input');
    const secure = window.isSecureContext === true;
    const result = state.referenceDirectoryProbeResult || null;

    let resultHtml = '<p class="small" style="margin-top:10px">Проверка ещё не запускалась. Оба теста читают папку только для диагностики и используют один и тот же распознаватель Excel по внутренней структуре.</p>';
    if (result) {
      if (result.status === 'ok') {
        const rows = (result.files || []).map(item =>
          '<tr>' +
          '<td><strong>' + escapeHtml(item.classification.label) + '</strong><div class="small">' + escapeHtml(item.classification.group) + '</div></td>' +
          '<td>' + escapeHtml(item.path) + '<div class="small">' + escapeHtml(formatBytes(item.size)) + '</div></td>' +
          '<td>' + escapeHtml(item.classification.sheetName || '—') + '</td>' +
          '<td>' + escapeHtml(item.classification.headerRow ?? '—') + '</td>' +
          '<td>' + escapeHtml(item.classification.reason || '—') + '</td>' +
          '</tr>'
        ).join('');

        const groupSummary = Object.entries(result.groups || {})
          .sort((left, right) => left[0].localeCompare(right[0], 'ru'))
          .map(([name, count]) => '<span class="consumer-chip">' + escapeHtml(name) + ': ' + escapeHtml(count) + '</span>')
          .join('');

        resultHtml =
          '<div class="validation-ok" style="margin-top:12px">Метод: ' + escapeHtml(result.method || '—') +
          '. Корневая папка: ' + escapeHtml(result.directoryName || '—') +
          '. Вложенных папок: ' + escapeHtml(result.folderCount || 0) +
          '. Excel-файлов: ' + escapeHtml(result.files?.length || 0) +
          '. Нераспознанных: ' + escapeHtml(result.unknownCount || 0) + '.</div>' +
          '<div class="consumer-list" style="margin-top:12px">' + groupSummary + '</div>' +
          '<div class="table-scroll" style="margin-top:12px"><table class="reference-table">' +
          '<thead><tr><th>Распознано как</th><th>Путь</th><th>Лист</th><th>Строка заголовков</th><th>Основание</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="5">Excel-файлы не найдены.</td></tr>') + '</tbody></table></div>';
      } else if (result.status === 'cancelled') {
        resultHtml = '<div class="notice" style="margin-top:12px">' + escapeHtml(result.message || 'Выбор папки не завершён.') + '</div>';
      } else {
        resultHtml = '<div class="validation-block invalid" style="margin-top:12px"><strong>Тест не выполнен</strong><p>' + escapeHtml(result.message || 'Неизвестная ошибка.') + '</p></div>';
      }
    }

    return '<article class="card" style="margin-top:18px">' +
      '<h2>Диагностика</h2>' +
      '<details><summary>Проверка доступа к папке Data</summary>' +
      '<p>Служебная проверка двух браузерных способов чтения папки. Оба режима только читают Excel и определяют тип файлов по структуре.</p>' +
      '<div class="info-list">' +
      '<div class="info-row"><span class="info-key">Directory Handle</span><strong>' + escapeHtml(handleSupported ? 'доступен' : 'недоступен') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">WebKit Directory</span><strong>' + escapeHtml(webkitSupported ? 'доступен' : 'недоступен') + '</strong></div>' +
      '<div class="info-row"><span class="info-key">Secure context</span><strong>' + escapeHtml(secure ? 'да' : 'нет') + '</strong></div>' +
      '</div>' +
      '<div class="action-row">' +
      '<button class="button" id="testDirectoryHandleButton"' + (handleSupported ? '' : ' disabled') + '>Проверить Directory Handle</button> ' +
      '<button class="button" id="testWebkitDirectoryButton"' + (webkitSupported ? '' : ' disabled') + '>Проверить WebKit Directory</button>' +
      '</div>' +
      resultHtml +
      '</details></article>';
  }

  async function probeDirectoryHandle() {
    if (typeof window.showDirectoryPicker !== 'function') return;

    let directoryHandle;
    try {
      directoryHandle = await window.showDirectoryPicker({ mode: 'read' });
    } catch (error) {
      if (error?.name === 'AbortError') {
        state.referenceDirectoryProbeResult = {
          status: 'cancelled',
          message: 'DirectoryHandle не получен. Браузер вернул AbortError: это может быть отмена выбора либо отказ предоставить доступ к выбранной папке.'
        };
      } else {
        state.referenceDirectoryProbeResult = {
          status: 'error',
          message: 'Ошибка выбора папки через Directory Handle: ' + (error?.name ? error.name + ': ' : '') + (error?.message || String(error))
        };
      }
      log('Тест Directory Handle: ' + state.referenceDirectoryProbeResult.message, state.referenceDirectoryProbeResult.status === 'error' ? 'ERROR' : 'INFO');
      render();
      return;
    }

    state.referenceDirectoryHandle = directoryHandle;
    try {
      const scanStats = { objects: 0, folders: 0 };
      const discovered = await collectDirectoryFiles(directoryHandle, '', scanStats);
      const excelEntries = discovered.filter(item => /\.(xlsx|xlsm|xls)$/i.test(item.path));
      const files = [];
      for (const entry of excelEntries) {
        const file = await entry.handle.getFile();
        files.push(await classifyProbeFile(file, entry.path));
      }
      state.referenceDirectoryProbeResult = buildProbeResult(
        'Directory Handle',
        directoryHandle.name || 'Data',
        scanStats.folders,
        files
      );
      log('Тест Directory Handle: Excel-файлов ' + files.length + ', не распознано ' + state.referenceDirectoryProbeResult.unknownCount + '.');
    } catch (error) {
      state.referenceDirectoryProbeResult = {
        status: 'error',
        message: 'Directory Handle получен, но ошибка возникла при обходе/чтении: ' +
          (error?.name ? error.name + ': ' : '') + (error?.message || String(error))
      };
      log('Тест Directory Handle: ' + state.referenceDirectoryProbeResult.message, 'ERROR');
    }
    render();
  }

  function probeWebkitDirectory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.setAttribute('webkitdirectory', '');
    input.hidden = true;
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const selected = Array.from(input.files || []);
      input.remove();
      if (!selected.length) {
        state.referenceDirectoryProbeResult = {
          status: 'cancelled',
          message: 'WebKit Directory не вернул файлы из выбранной папки.'
        };
        render();
        return;
      }

      try {
        const relativePaths = selected.map(file => file.webkitRelativePath || file.name);
        const rootName = (relativePaths[0] || '').split('/')[0] || 'Data';
        const directoryPaths = new Set();
        for (const path of relativePaths) {
          const parts = path.split('/');
          for (let index = 1; index < parts.length - 1; index += 1) {
            directoryPaths.add(parts.slice(0, index + 1).join('/'));
          }
        }

        const excelFiles = selected.filter(file => /\.(xlsx|xlsm|xls)$/i.test(file.name));
        const files = [];
        for (const file of excelFiles) {
          files.push(await classifyProbeFile(file, file.webkitRelativePath || file.name));
        }

        state.referenceDirectoryProbeResult = buildProbeResult(
          'WebKit Directory',
          rootName,
          directoryPaths.size,
          files
        );
        log('Тест WebKit Directory: получено файлов ' + selected.length +
          '; Excel-файлов ' + files.length +
          '; не распознано ' + state.referenceDirectoryProbeResult.unknownCount + '.');
      } catch (error) {
        state.referenceDirectoryProbeResult = {
          status: 'error',
          message: 'Ошибка обработки WebKit Directory: ' +
            (error?.name ? error.name + ': ' : '') + (error?.message || String(error))
        };
        log('Тест WebKit Directory: ' + state.referenceDirectoryProbeResult.message, 'ERROR');
      }
      render();
    }, { once: true });

    input.addEventListener('cancel', () => {
      input.remove();
      state.referenceDirectoryProbeResult = {
        status: 'cancelled',
        message: 'Окно WebKit Directory закрыто без выбора.'
      };
      render();
    }, { once: true });

    input.click();
  }

