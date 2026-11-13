/* Browser storage for one export attempt and an interrupted pair write. */
const PENDING = '.reclassifier-pair.pending.json';
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

async function hashBlob(blob) {
  if (blob.size >= 8 * 1048576) {
    const hash = globalThis.sha256.create();
    for await (const chunk of blob.stream()) hash.update(chunk);
    return hash.hex();
  }
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getFile(directory, name) {
  try { return await directory.getFileHandle(name); }
  catch (error) {
    if (error.name === 'NotFoundError') return null;
    throw error;
  }
}

async function assertExcelExportClosed(target) {
  // Chromium rejects direct lookups of names starting with '~', even if absent.
  const ownerName = '~$'+target.filename.toLowerCase();
  for await (const [name, entry] of target.directory.entries()) {
    if (entry.kind === 'file' && name.toLowerCase() === ownerName) {
      throw new Error('Excel держит открытой книгу «'+target.path+'». Закройте её и повторите обновление. '
        +'Если книга уже закрыта, проверьте, не остался ли служебный файл Excel.');
    }
  }
}

async function assertExcelExportsClosed(root) {
  for (const target of Object.values(await ReclassifierSafeExcelWriter.exportTargets(root))) {
    await assertExcelExportClosed(target);
  }
}

async function writeBlob(handle, blob) {
  const stream = await handle.createWritable();
  await blob.stream().pipeTo(stream);
}

async function put(directory, name, blob) {
  const handle = await directory.getFileHandle(name, {create:true});
  await writeBlob(handle, blob);
  return handle.getFile();
}

function encodeRow(row) {
  const values = Object.entries(row.values).map(([column, value]) =>
    value instanceof Date ? [column, value.getTime(), true] : [column, value]);
  return JSON.stringify({...row, values, fields:row.fields ? [...row.fields] : null}) + '\n';
}

async function* decodeRows(stream) {
  let tail = '';
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      tail += value;
      let start = 0;
      for (let end; (end = tail.indexOf('\n', start)) !== -1; start = end+1) {
        const row = JSON.parse(tail.slice(start,end));
        const values = [];
        for (const [column, value, date] of row.values) {
          values[column] = date ? new Date(value === null ? NaN : value) : value;
        }
        yield {...row, values, fields:row.fields ? new Map(row.fields) : null};
      }
      tail = tail.slice(start);
    }
    if (tail) throw new Error('Временный индекс строк записан не полностью.');
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

let workingDirectory;
let importedOutputBytes = null;
let stagedRowBytes = 0;

async function stageBook(blob) {
  if (importedOutputBytes === null) return put(workingDirectory,'book-'+crypto.randomUUID(),blob);
  importedOutputBytes += blob.size;
  if (importedOutputBytes > 256 * 1048576) {
    throw new Error('Готовые книги превышают 256 МиБ. Для такого объёма подключите рабочую папку с правом записи.');
  }
  return blob;
}

async function saveImportedBook(handle, book) {
  if (handle.name.toLowerCase() !== book.name.toLowerCase()) {
    throw new Error('Выберите файл с именем «'+book.name+'».');
  }
  const currentHash = async () => {
    const current = await handle.getFile();
    return current.size ? hashBlob(current) : null;
  };
  const before = await currentHash();
  if (before === book.sha256) return;
  if (before !== null && before !== book.before) {
    throw new Error('Выбранная книга отличается от импортированной. Импортируйте папку заново или сохраните книгу в пустую папку.');
  }
  const stream = await handle.createWritable({mode:'exclusive'});
  try {
    await stream.write(book.blob);
    if (await currentHash() !== before) throw new Error('Книга изменилась во время сохранения.');
    await stream.close();
  } catch (error) {
    await stream.abort().catch(()=>{});
    throw error;
  }
  if (await currentHash() !== book.sha256) throw new Error('Не удалось подтвердить сохранение книги.');
}

function* rowBatches(rows) {
  let batch = '';
  for (const row of rows.values()) {
    batch += encodeRow(row);
    if (batch.length >= 262144) {
      yield batch;
      batch = '';
    }
  }
  if (batch) yield batch;
}

async function stageRowsOnDisk(rows) {
  const name = 'rows-' + crypto.randomUUID();
  const handle = await workingDirectory.getFileHandle(name,{create:true});
  const output = await handle.createWritable();
  try {
    for (const batch of rowBatches(rows)) await output.write(batch);
    await output.close();
  } catch (error) {
    await output.abort().catch(() => {});
    throw error;
  }
  const file = await handle.getFile();
  return {
    read:()=>file.stream(),
    release:()=>workingDirectory.removeEntry(name).catch(()=>{})
  };
}

async function stageRowsInMemory(rows, progress) {
  const chunks = [];
  const batches = rowBatches(rows);
  const encoder = new TextEncoder();
  let size = 0;
  let rawSize = 0;
  const input = new ReadableStream({pull(controller) {
    const {done,value} = batches.next();
    if (done) {
      controller.close();
      return;
    }
    const bytes = encoder.encode(value);
    rawSize += bytes.byteLength;
    controller.enqueue(bytes);
  }});
  for await (const chunk of input.pipeThrough(new CompressionStream('gzip'))) {
    size += chunk.byteLength;
    if (stagedRowBytes + size > 256 * 1048576) {
      throw new Error('Сжатые временные строки превысили лимит 256 МиБ. Для этой книги требуется обработка с временным хранилищем.');
    }
    chunks.push(chunk);
  }
  stagedRowBytes += size;
  progress('Временные строки · '+(rawSize/1048576).toFixed(1)+' МиБ до сжатия · '
    +(size/1048576).toFixed(1)+' МиБ после сжатия · '+(stagedRowBytes/1048576).toFixed(1)+' МиБ всего в буфере');
  let next = 0;
  return {
    read:()=>new ReadableStream({pull(controller) {
      if (next === chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[next]);
      chunks[next++] = null;
    }}).pipeThrough(new DecompressionStream('gzip')),
    release:()=>{
      chunks.length = 0;
      stagedRowBytes -= size;
    }
  };
}

async function stageRows(rows, progress = () => {}) {
  const count = rows.size;
  let staged = workingDirectory ? await stageRowsOnDisk(rows) : await stageRowsInMemory(rows,progress);
  rows.clear();
  return async destination => {
    try {
      for await (const row of decodeRows(staged.read())) destination.set(row.key,row);
      if (destination.size !== count) throw new Error('Не совпало число восстановленных строк.');
    } finally {
      await staged.release();
      staged = null;
    }
  };
}

async function recoverPair(root, storage, progress) {
  const handle = await getFile(root,PENDING);
  if (!handle) return;
  const file = await handle.getFile();
  if (!file.size) {
    await root.removeEntry(PENDING);
    return;
  }
  const journal = JSON.parse(await file.text());
  const kinds = ['itsm','mb'];
  if (journal.version !== 1 || !UUID.test(journal.id) || kinds.some(kind => {
    const item = journal.books?.[kind];
    return !item || !SHA256.test(item.next) || (item.before !== null && !SHA256.test(item.before));
  })) throw new Error('Служебная запись сохранения пары повреждена.');

  const targets = await ReclassifierSafeExcelWriter.exportTargets(root);
  const states = {};
  for (const kind of kinds) {
    const target = targets[kind];
    const item = journal.books[kind];
    if (target.path !== item.path) throw new Error('Целевой путь изменился после начала записи: ' + item.path);
    const current = await target.handle?.getFile();
    const hash = current?.size ? await hashBlob(current) : null;
    if (hash !== item.before && hash !== item.next) {
      throw new Error('После начала записи файл изменился. Проверьте ' + item.path + '.');
    }
    states[kind] = hash;
  }

  if (kinds.every(kind => states[kind] === journal.books[kind].next)) {
    progress('Обе книги предыдущей записи подтверждены.');
  } else {
    progress('Восстановление пары после прерванной записи');
    const directory = await storage.getDirectoryHandle(journal.id);
    const backups = {};
    for (const kind of kinds) {
      const item = journal.books[kind];
      if (states[kind] !== item.before && item.before) {
        const backup = await (await directory.getFileHandle(kind+'.backup')).getFile();
        if (await hashBlob(backup) !== item.before) throw new Error('Резервная копия не подтверждена: ' + item.path);
        backups[kind] = backup;
      }
    }
    for (const kind of kinds.slice().reverse()) {
      const {handle, directory, filename, path} = targets[kind];
      const item = journal.books[kind];
      const current = await handle?.getFile();
      if ((current?.size ? await hashBlob(current) : null) !== states[kind]) {
        throw new Error('Файл изменился во время восстановления: ' + path);
      }
      if (backups[kind]) await writeBlob(handle,backups[kind]);
      else if (item.before === null && handle) await directory.removeEntry(filename);
    }
    progress('Исходная пара восстановлена.');
  }
  await root.removeEntry(PENDING);
  await storage.removeEntry(journal.id,{recursive:true});
}

async function writePair(root, storage, id, plan, progress) {
  const writer = ReclassifierSafeExcelWriter;
  const targets = await writer.exportTargets(root);
  const journal = {version:1,id,books:{}};
  for (const kind of ['itsm','mb']) {
    const target = targets[kind];
    await assertExcelExportClosed(target);
    const current = await target.handle?.getFile();
    if (current) {
      const backup = await put(workingDirectory,kind+'.backup',current);
      if (await hashBlob(backup) !== plan.hashes[kind]) throw new Error('Изменился файл ' + target.path + '.');
    } else if (plan.hashes[kind] !== null) {
      throw new Error('Файл больше не доступен: ' + target.path);
    }
    journal.books[kind] = {path:target.path,before:plan.hashes[kind],next:plan.books[kind].sha256};
  }
  if (await getFile(root,PENDING)) throw new Error('Обнаружена незавершённая запись пары.');
  await put(root,PENDING,new Blob([JSON.stringify(journal)]));
  try {
    await writer.writeFolderExports({root,books:plan.books,hashes:plan.hashes,
      onStage:async (kind,message,target)=>{
        await assertExcelExportClosed(target);
        progress(message,undefined,{kind,phase:'writing',percent:99});
      },
      onWritten:item=>progress(item.path + ' · запись подтверждена')});
  } catch (error) {
    try { await recoverPair(root,storage,progress); }
    catch (rollback) { throw new Error(error.message + ' · Восстановление: ' + rollback.message); }
    throw error;
  }
  await root.removeEntry(PENDING);
}
