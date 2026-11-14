function createRcaRepository({handle, mode = 'none', files = []} = {}) {
  const imported = new Map();
  if (mode === 'import') {
    for (const {path, file} of files) {
      const prefix = path.indexOf('/');
      if (prefix >= 0 && path.startsWith('/RCA/', prefix)) imported.set(path.slice(prefix + 5), file);
    }
  }
  let pending = Promise.resolve();

  async function directory(path, create = false) {
    let parent = handle;
    for (const part of ['RCA', ...path]) parent = await parent.getDirectoryHandle(part, {create});
    return parent;
  }

  async function readFile(path, name) {
    if (mode === 'import') {
      const file = imported.get([...path, name].join('/'));
      if (!file) throw new DOMException('Файл RCA отсутствует.', 'NotFoundError');
      return file;
    }
    const parent = await directory(path);
    return (await parent.getFileHandle(name)).getFile();
  }

  async function read(path, name) {
    return (await readFile(path, name)).text();
  }

  async function writeNew(path, name, content) {
    const parent = await directory(path, true);
    const file = await parent.getFileHandle(name, {create: true});
    const stream = await file.createWritable({mode: 'exclusive'});
    try {
      if ((await file.getFile()).size) throw new Error('Конфликт: файл RCA уже опубликован.');
      await stream.write(content);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => {});
      throw error;
    }
    if (typeof content === 'string' && await read(path, name) !== content) {
      throw new Error('Записанный файл RCA не прошёл проверку.');
    }
  }

  async function namesAt(path) {
    const entries = [];
    if (mode === 'import') {
      const prefix = path.join('/') + '/';
      for (const path of imported.keys()) {
        if (path.startsWith(prefix)) entries.push(path.slice(prefix.length));
      }
    } else if (handle) {
      try {
        for await (const entry of (await directory(path)).values()) {
          if (entry.kind === 'file') entries.push(entry.name);
        }
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    }
    return entries;
  }

  async function generations() {
    return (await namesAt(['indexes'])).filter(name => RCA_INDEX_NAME.test(name)).sort().reverse();
  }

  async function* readIndexes(names, issues) {
    for (const name of names) {
      let index;
      try {
        index = validateRcaIndex(JSON.parse(await read(['indexes'], name)), Number(RCA_INDEX_NAME.exec(name)[1]));
      } catch (error) {
        if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
        issues.push('RCA/indexes/' + name);
        continue;
      }
      yield index;
    }
  }

  async function recoverLastValid(names = null) {
    const issues = [];
    for await (const index of readIndexes(names ?? await generations(), issues)) {
      return {index, issues};
    }
    return {index: null, issues};
  }

  async function hash(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function loadProblem(id) {
    const issues = [];
    const tried = new Set();
    let found = false;
    for await (const index of readIndexes(await generations(), issues)) {
      const row = index.records.find(record => record.id === id);
      if (!row && !found) break;
      if (!row || tried.has(row.file)) continue;
      found = true;
      tried.add(row.file);
      try {
        const text = await read(['problems', id], row.file);
        if (await hash(text) !== row.hash) throw new Error('Контрольная сумма RCA не совпадает.');
        const record = validateRcaProblem(JSON.parse(text));
        if (record.problem.id !== id || record.problem.revision !== row.revision) {
          throw new Error('Идентификатор или ревизия RCA не совпадает.');
        }
        return {record, issues};
      } catch (error) {
        if (['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
        issues.push('RCA/problems/' + id + '/' + row.file);
      }
    }
    return {record: null, issues};
  }

  async function getWriteCapability() {
    if (mode !== 'write') return {mode, writable: false};
    const permission = await handle.queryPermission({mode: 'readwrite'});
    return {mode, writable: permission === 'granted'};
  }

  async function publishIndex(index) {
    validateRcaIndex(index, index.generation);
    const name = 'index-' + String(index.generation).padStart(12, '0') + '.json';
    await writeNew(['indexes'], name, JSON.stringify(index));
  }

  function saveBatch(changes, dictionaryChange, photoFiles) {
    const batch = structuredClone(changes);
    const dictionary = structuredClone(dictionaryChange);
    const save = async () => {
      if (!(await getWriteCapability()).writable) throw new Error('Требуется экспорт JSON или разрешение на запись.');
      const names = await generations();
      const {index, issues} = await recoverLastValid(names);
      if (!index && issues.length) throw new Error('Нет валидного поколения индекса RCA.');
      const rows = new Map(index?.records.map(row => [row.id, row]));
      const dictionaries = index?.dictionaries ?? [];
      if (dictionary && JSON.stringify(dictionary.expected) !== JSON.stringify(dictionaries)) {
        throw new Error('Справочники изменились. Откройте окно заново.');
      }
      const staged = [];
      for (const {record: snapshot, expectedRevision} of batch) {
        const {id} = validateRcaProblem(snapshot).problem;
        checkRcaPrb(snapshot.problem, rows.values());
        if ((rows.get(id)?.revision ?? 0) !== expectedRevision) throw new Error('Конфликт ревизий RCA.');
        if (expectedRevision && (await loadProblem(id)).record?.problem.revision !== expectedRevision) {
          throw new Error('Актуальная карточка RCA повреждена. Сначала восстановите данные.');
        }
        const revision = expectedRevision + 1;
        snapshot.problem.revision = revision;
        snapshot.problem.updatedAt = new Date().toISOString();
        const text = JSON.stringify(validateRcaProblem(snapshot));
        const file = revision + '-' + crypto.randomUUID() + '.json';
        const checksum = await hash(text);
        staged.push({id, file, text});
        const {prbNumber, title, status, equipment, location, project, updatedAt} = snapshot.problem;
        rows.set(id, {id, prbNumber, title, status, equipment, location, project, updatedAt, revision, file, hash: checksum});
      }
      const nextDictionaries = validateRcaDictionaries(dictionary?.items ?? dictionaries);
      if (photoFiles) {
        for (const {record} of batch) {
          for (const item of record.attachments.filter(item => item.kind === 'local_file')) {
            const blob = photoFiles.get(item.path);
            if (!blob || blob.size !== item.size || await hashRcaAttachment(blob) !== item.hash) {
              throw new Error('Оригинал отсутствует или повреждён: ' + item.name);
            }
            await validateRcaImage(blob, item.path, item.mime);
            try {
              await attachments.loadBinary(record, item.id);
              continue;
            } catch (error) {
              if (error.name !== 'NotFoundError') throw error;
            }
            const path = rcaAttachmentPath(record.problem.id, item.id, item.mime);
            await writeNew(path.slice(0, -1), path.at(-1), blob);
            await attachments.loadBinary(record, item.id);
          }
        }
      }
      for (const {id, file, text} of staged) await writeNew(['problems', id], file, text);
      const generation = names.length ? Number(RCA_INDEX_NAME.exec(names[0])[1]) + 1 : 1;
      if (generation > 999999999999) throw new Error('Исчерпаны номера поколений RCA.');
      await publishIndex({
        schemaVersion: RCA_SCHEMA_VERSION, recordType: 'rca-index', generation,
        records: [...rows.values()], dictionaries: nextDictionaries
      });
      return batch.map(change => change.record);
    };
    // A stable origin serializes transactions across tabs. Exclusive index files detect concurrent publishers.
    const result = pending.then(() => typeof navigator.locks?.request === 'function'
      ? navigator.locks.request('reclassifier-rca-json', save) : save());
    pending = result.catch(() => {});
    return result;
  }

  const attachments = createRcaAttachmentStore({
    readFile, writeNew, writable: async () => (await getWriteCapability()).writable
  });
  return {
    getWriteCapability, recoverLastValid, loadProblem, saveBatch,
    attachments: {
      loadBinary: attachments.loadBinary,
      listAttachments: attachments.listAttachments,
      async add(record, expectedRevision, photo) {
        const snapshot = structuredClone(record);
        const item = await attachments.stageFile(snapshot, photo);
        snapshot.attachments.push(item);
        return (await saveBatch([{record: snapshot, expectedRevision}]))[0];
      },
      async unlinkAttachment(record, expectedRevision, id) {
        const item = record.attachments.find(entry => entry.id === id && entry.kind === 'local_file');
        if (!item) throw new Error('Фотография не связана с расследованием.');
        const snapshot = {...record, attachments: record.attachments.filter(entry => entry !== item)};
        return (await saveBatch([{record: snapshot, expectedRevision}]))[0];
      }
    },
    officialRegistry: createOfficialRegistryStore({
      names: namesAt, read, write: writeNew, hash, writable: async () => (await getWriteCapability()).writable
    }),
    itsmAnalytics: createOfficialRegistryStore({
      names:namesAt, read, write:writeNew, hash, writable:async () => (await getWriteCapability()).writable, analytics:true
    }),
    planLibrary: createOfficialRegistryStore({
      names:namesAt,read,write:writeNew,hash,writable:async () => (await getWriteCapability()).writable,plans:true
    }),
    async saveRevision(record, expectedRevision) {
      return (await saveBatch([{record, expectedRevision}]))[0];
    },
    async readDictionaries() {
      return (await recoverLastValid()).index?.dictionaries ?? [];
    },
    async listIndex() {
      const {index, issues} = await recoverLastValid();
      return {records: index?.records ?? [], issues};
    },
    flushPending: () => pending
  };
}
