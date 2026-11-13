const folderDirectory = (() => {
  'use strict';

  const EXCEL_NAME = /\.(?:xlsx|xlsm|xls)$/i;
  const MAX_FILES = 500;
  // Saved Combined copies share Stationary headers. Exclude known outputs
  // and auxiliary workbooks before classification and fingerprinting.
  const NON_INPUT_CATALOG = /^(?:equipment[_\s-]*combined|catalogpspataskeffortmapper|реестр\s+ит[\s–—-]*проблем)(?=[._\s(-]|$)/i;
  const RETIRED_TRANSPORT_EXPORT = /^(?:CatalogTransport.*|transport[ _-]*)start[ _-]*points/i;

  function includeExcel(name, folder) {
    return EXCEL_NAME.test(name) && !name.startsWith('~$') &&
      (folder === 'catalogs' || !/^export_(itsm|mb)\.xlsx$/i.test(name)) &&
      (folder !== 'catalogs' || !RETIRED_TRANSPORT_EXPORT.test(name) && !NON_INPUT_CATALOG.test(name));
  }

  // Only these three top-level folders are in scope; other siblings are ignored.
  const WORKSPACE_FOLDERS = Object.freeze([
    Object.freeze({id:'catalogs', name:'Catalogs', purpose:'Справочники'}),
    Object.freeze({id:'itsm', name:'ITSM', purpose:'Выгрузки ITSM'}),
    Object.freeze({id:'mb', name:'MB', purpose:'Выгрузки МБ'})
  ]);
  const FOLDER_IDS = new Set(WORKSPACE_FOLDERS.map(folder => folder.id));

  function folderId(name) {
    const value = String(name || '').toLowerCase();
    return FOLDER_IDS.has(value) ? value : null;
  }

  function workspaceLayout(found, mode, extras = 0, writePermission = 'unknown') {
    const folders = WORKSPACE_FOLDERS.map(folder => {
      const names = found.get(folder.id) || [];
      return Object.freeze({
        ...folder,
        status: names.length > 1 ? 'warning' :
          names.length === 1 ? 'ready' :
          mode === 'files' ? 'unconfirmed' : 'missing',
        actualName: names[0] || null,
        count: names.length
      });
    });
    return Object.freeze({
      mode, folders: Object.freeze(folders),
      ready: folders.every(folder => folder.status === 'ready'),
      extraDirectories: extras, readPermission:'granted', writePermission,
      note: mode === 'files'
        ? 'Браузер предоставил только файлы: пустые подпапки не определяются, запись итоговых файлов недоступна.'
        : 'Для создания недостающих подпапок требуется право записи в корневую папку.'
    });
  }

  async function inspectRoot(root) {
    if (!root || typeof root.entries !== 'function') {
      throw new Error('Не удалось получить доступ к выбранной корневой папке.');
    }
    const found = new Map();
    let extras = 0;
    for await (const [name, entry] of root.entries()) {
      if (entry?.kind !== 'directory') continue;
      const id = folderId(name);
      if (!id) { extras += 1; continue; }
      const names = found.get(id) || [];
      names.push(name);
      found.set(id, names);
    }
    let permission = 'unknown';
    if (typeof root.queryPermission === 'function') {
      try {
        const result = await root.queryPermission({mode:'readwrite'});
        if (['granted', 'prompt', 'denied'].includes(result)) permission = result;
      } catch (_) { /* Read-write permissions are browser-specific. Do not prompt. */ }
    }
    return workspaceLayout(found, 'handles', extras, permission);
  }

  async function ensureWorkspaceFolders(root) {
    let layout = await inspectRoot(root);
    for (const {id} of WORKSPACE_FOLDERS) {
      if (layout.ready || layout.writePermission !== 'granted' ||
          layout.folders.some(folder => folder.status === 'warning') ||
          typeof root.getDirectoryHandle !== 'function') break;
      const folder = layout.folders.find(item => item.id === id);
      if (folder.status !== 'missing') continue;
      try {
        await root.getDirectoryHandle(folder.name, {create:true});
      } catch (error) {
        throw new Error('Не удалось создать подпапку «' + folder.name + '»: ' +
          (error?.message || String(error)), {cause:error});
      }
      layout = await inspectRoot(root);
    }
    return layout;
  }

  function inspectSelection(files) {
    const found = new Map();
    const extraNames = new Set();
    for (const file of Array.from(files || [])) {
      const parts = String(file?.webkitRelativePath || '').replaceAll('\\', '/').split('/');
      if (parts.length < 3) continue;
      const name = parts[1];
      const id = folderId(name);
      if (!id) { extraNames.add(name); continue; }
      const names = found.get(id) || [];
      if (!names.includes(name)) names.push(name);
      found.set(id, names);
    }
    return workspaceLayout(found, 'files', extraNames.size, 'unsupported');
  }


  // webkitdirectory includes the selected root in webkitRelativePath.
  // Do not accept unrelated nested folders named MB/ITSM/catalogs.
  function relativeFiles(files) {
    return Array.from(files || []).map(file => {
      const path = file.webkitRelativePath || file.name;
      const parts = String(path).replaceAll('\\', '/').split('/');
      return {file, handle:null, path, folder:folderId(parts[1])};
    }).filter(entry => entry.folder !== null && includeExcel(entry.file.name, entry.folder));
  }

  async function enumerate(root, onlyFolder = null) {
    if (!root?.entries) throw new Error('Браузер не предоставил доступ к выбранному каталогу.');
    const entries = [];
    async function walk(handle, path, depth, folder) {
      if (depth > 4) throw new Error('Слишком глубокая структура папок (не более 4 уровней).');
      for await (const [name, entry] of handle.entries()) {
        const next = path + '/' + name;
        if (entry.kind === 'directory') {
          await walk(entry, next, depth + 1, folder);
        } else if (entry.kind === 'file' && includeExcel(name, folder)) {
          if (entries.length >= MAX_FILES) {
            throw new Error('В трёх рабочих папках более 500 Excel-файлов. Ограничьте выбор.');
          }
          const file = await entry.getFile();
          entries.push({file, handle:entry, path:next, folder});
        }
      }
    }
    // Explicitly skip extra sibling folders and files stored in root itself.
    for await (const [name, entry] of root.entries()) {
      const id = folderId(name);
      if (entry?.kind === 'directory' && id && (!onlyFolder || id === onlyFolder)) {
        await walk(entry, name, 1, id);
      }
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path, 'ru'));
  }

  return Object.freeze({maxFiles:MAX_FILES, includeExcel, enumerate, relativeFiles,
    inspectRoot, ensureWorkspaceFolders, inspectSelection});
})();
