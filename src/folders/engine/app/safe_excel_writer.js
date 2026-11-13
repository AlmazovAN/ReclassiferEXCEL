// PR-03: explicit, guarded XLSX replacement. No UI hook until PR-04/05.
// No SQLite, auto-write, background processing or network access.
(() => {
  'use strict';

  const MAX_BYTES = 64 * 1024 * 1024;
  const LOCAL_EXPORT = globalThis.ReclassifierLocalExportLimits;
  const MAX_EXPORT_BYTES = LOCAL_EXPORT?.maxBytes ?? 192 * 1048576;
  const MAX_PARTS = 10000;
  const ALLOWED_FOLDERS = new Set(['ITSM', 'MB']);
  const ACTIVE_PATHS = new Set();
  const COMBINED_SHEET = 'Equipment_Combined';
  const COMBINED_FILE = COMBINED_SHEET + '.xlsx';
  const ENCODE_CELL = /^[A-Z]+[1-9][0-9]*$/;
  const ZIP_SIG = Object.freeze({LOCAL:0x04034b50, CENTRAL:0x02014b50, END:0x06054b50});

  function fail(message, details = {}) {
    const error = new Error(message);
    error.code = details.code || 'EXCEL_SAFE_WRITE';
    if (details.backupName) error.backupName = details.backupName;
    if (details.originalStatus) error.originalStatus = details.originalStatus;
    if (details.recoveryError) error.recoveryError = details.recoveryError;
    return error;
  }

  function assert(condition, message) {
    if (!condition) throw fail(message);
  }

  function bytesOf(input) {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw fail('Ожидались байты XLSX в ArrayBuffer или TypedArray.');
  }

  function validLength(bytes) {
    assert(bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES,
      'Размер XLSX вне допустимого диапазона 1–' + (MAX_BYTES / 1048576) + ' МиБ.');
  }

  async function sha256(input) {
    const subtle = globalThis.crypto?.subtle;
    assert(subtle && typeof subtle.digest === 'function',
      'Для записи необходим криптографический SHA-256 (Web Crypto в защищённом контексте).');
    const bytes = bytesOf(input);
    validLength(bytes);
    // Copy to an isolated buffer so the caller cannot mutate bytes during hashing.
    const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
    return Array.from(digest, value => value.toString(16).padStart(2, '0')).join('');
  }

  function safePath(entry) {
    assert(entry && entry.handle?.kind === 'file' && entry.file,
      'Нет дескриптора исходного файла; выбор папки в режиме чтения не подходит для записи.');
    const raw = String(entry.path || '').replaceAll('\\', '/');
    const parts = raw.split('/');
    assert(parts.length >= 2 && parts.length <= 5 &&
      parts.every(part => part && part !== '.' && part !== '..' && !part.includes('\0') && !part.includes('/')),
    'Некорректный относительный путь исходного файла.');
    assert(ALLOWED_FOLDERS.has(parts[0].toUpperCase()),
      'Запись разрешена только в ITSM или MB.');
    const leaf = parts[parts.length - 1];
    assert(/\.xlsx$/i.test(leaf) && !leaf.startsWith('~$') &&
      leaf.toLocaleLowerCase('ru-RU') === String(entry.file.name).toLocaleLowerCase('ru-RU') &&
      leaf.toLocaleLowerCase('ru-RU') === String(entry.handle.name).toLocaleLowerCase('ru-RU'),
    'Прямая запись разрешена только в исходный XLSX с подтверждённым именем.');
    return {parts, name:leaf, path:parts.join('/'), folder:parts[0], handle:entry.handle};
  }

  async function resolve(root, descriptor) {
    assert(root?.kind === 'directory' && typeof root.getDirectoryHandle === 'function',
      'Не предоставлен корневой каталог с доступом к дескрипторам файлов.');
    let directory = root;
    for (const name of descriptor.parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(name, {create:false});
    }
    const handle = await directory.getFileHandle(descriptor.name, {create:false});
    if (typeof handle.isSameEntry === 'function') {
      assert(await handle.isSameEntry(descriptor.handle),
        'Выбранный файл не совпадает с исходным дескриптором.');
    }
    return {directory, handle};
  }

  async function ensureWritePermission(root, handle, requireWritable = true) {
    for (const target of [root, handle]) {
      if (typeof target.queryPermission !== 'function') {
        throw fail('Браузер не подтверждает право записи. Прямая перезапись запрещена.');
      }
      const value = await target.queryPermission({mode:'readwrite'});
      assert(value === 'granted',
        'Нет разрешения на запись. Запросите его явным действием пользователя до запуска обработчика.');
    }
    assert(!requireWritable || typeof handle.createWritable === 'function',
      'Этот браузер не поддерживает безопасную запись через File System Access API.');
  }

  function allowedPart(name, crc, uncompressed) {
    // SheetJS 0.20.3 emits this fixed, default metadata part for plain XLSX.
    if (name === 'xl/metadata.xml') return crc === 0x81008060 && uncompressed === 904;
    if (name.endsWith('/')) return /^(?:_rels|docProps|xl|xl\/_rels|xl\/worksheets|xl\/theme)\/$/i.test(name);
    return name === '[Content_Types].xml' ||
      /^(?:_rels\/\.rels|docProps\/(?:core|app)\.xml|xl\/(?:workbook|styles|sharedStrings)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/worksheets\/sheet[0-9]+\.xml|xl\/theme\/theme[0-9]+\.xml)$/i.test(name);
  }

  function zipParts(input,folderExport=false) {
    const bytes = bytesOf(input);
    if(folderExport) assert(bytes.byteLength>0&&bytes.byteLength<=MAX_EXPORT_BYTES,
      'Неподдерживаемый размер накопительной XLSX.');
    else validLength(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert(bytes.byteLength >= 22 && dv.getUint32(0, true) === ZIP_SIG.LOCAL,
      'Файл не похож на обычный ZIP-контейнер XLSX.');
    let end = -1;
    const limit = Math.max(0, bytes.byteLength - 65557);
    for (let offset = bytes.byteLength - 22; offset >= limit; offset--) {
      if (dv.getUint32(offset, true) === ZIP_SIG.END &&
          offset + 22 + dv.getUint16(offset + 20, true) === bytes.byteLength) {
        end = offset;
        break;
      }
    }
    assert(end >= 0, 'Не найдена корректная запись конца ZIP.');
    const disk = dv.getUint16(end + 4, true);
    const diskCentral = dv.getUint16(end + 6, true);
    const count = dv.getUint16(end + 10, true);
    const total = dv.getUint16(end + 8, true);
    const size = dv.getUint32(end + 12, true);
    const start = dv.getUint32(end + 16, true);
    assert(disk === 0 && diskCentral === 0 && total === count &&
      count > 0 && count <= MAX_PARTS && count < 65535 &&
      start !== 0xffffffff && size !== 0xffffffff &&
      start + size <= end,
    'ZIP64, многотомный, некорректный или слишком сложный XLSX не поддерживается.');
    const decode = new TextDecoder('utf-8', {fatal:true});
    const entries = new Map();
    let offset = start;
    let totalUncompressed = 0;
    for (let i = 0; i < count; i++) {
      assert(offset + 46 <= start + size &&
        dv.getUint32(offset, true) === ZIP_SIG.CENTRAL, 'Повреждён каталог файлов XLSX.');
      const flags = dv.getUint16(offset + 8, true);
      const method = dv.getUint16(offset + 10, true);
      const crc = dv.getUint32(offset + 16, true);
      const compressed = dv.getUint32(offset + 20, true);
      const uncompressed = dv.getUint32(offset + 24, true);
      const nameLength = dv.getUint16(offset + 28, true);
      const extra = dv.getUint16(offset + 30, true);
      const comment = dv.getUint16(offset + 32, true);
      const localOffset = dv.getUint32(offset + 42, true);
      totalUncompressed += uncompressed;
      const maxPart = folderExport
        ? (LOCAL_EXPORT?.maxDataPart ?? LOCAL_EXPORT?.maxPart ?? 192 * 1048576)
        : 192 * 1048576;
      const maxExpanded = folderExport ? (LOCAL_EXPORT?.maxExpanded ?? 1024 * 1048576) : 320 * 1048576;
      assert(uncompressed <= maxPart && totalUncompressed <= maxExpanded,
        'XLSX требует слишком много памяти при распаковке. Запись заблокирована.');
      const entryEnd = offset + 46 + nameLength + extra + comment;
      assert(entryEnd <= start + size && (flags & 1) === 0 &&
        (method === 0 || method === 8) && localOffset + 30 <= start &&
        dv.getUint32(localOffset, true) === ZIP_SIG.LOCAL,
        'XLSX содержит повреждённый, зашифрованный или неподдерживаемый ZIP-элемент.');
      const name = decode.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      assert(name && !name.startsWith('/') && !name.includes('\\') &&
        !name.split('/').includes('..') && allowedPart(name,crc,uncompressed),
        'Обнаружен сложный элемент XLSX, который может потеряться при пересохранении: ' + name);
      const key = name.toLowerCase();
      assert(!entries.has(key), 'XLSX содержит дублирующиеся элементы ZIP: ' + name);
      entries.set(key, {name,crc,uncompressed,compressed,method,localOffset});
      offset = entryEnd;
    }
    assert(offset === start + size, 'Неверная длина центрального каталога XLSX.');
    for (const name of ['[content_types].xml','_rels/.rels','xl/workbook.xml']) {
      assert(entries.has(name), 'В XLSX отсутствует обязательный пакетный файл: ' + name);
    }
    return entries;
  }

  function approveRanges(XLSX, before, ranges, approvedNewSheets) {
    assert(Array.isArray(ranges) && Array.isArray(approvedNewSheets) &&
      ranges.length + approvedNewSheets.length > 0,
    'Не задан явный перечень разрешённых изменений в Excel.');
    const known = new Set(before.SheetNames);
    const newSheets = new Set();
    for (const name of approvedNewSheets) {
      assert(typeof name === 'string' && name.length > 0 && name.length <= 31 &&
        !known.has(name) && !newSheets.has(name),
      'Некорректно задан разрешённый новый лист XLSX.');
      newSheets.add(name);
    }
    const bySheet = new Map();
    for (const rule of ranges) {
      assert(rule && known.has(rule.sheet) && typeof rule.range === 'string' &&
        /^[A-Z]+[1-9][0-9]*:[A-Z]+[1-9][0-9]*$/.test(rule.range),
      'Разрешённые изменения должны указывать существующий лист и строгий диапазон A1:B2.');
      const bounds = XLSX.utils.decode_range(rule.range);
      assert(bounds.s.r <= bounds.e.r && bounds.s.c <= bounds.e.c &&
        bounds.e.r <= 1048575 && bounds.e.c <= 16383,
      'Разрешённый диапазон выходит за пределы Excel.');
      if (!bySheet.has(rule.sheet)) bySheet.set(rule.sheet, []);
      bySheet.get(rule.sheet).push(bounds);
    }
    return {bySheet, newSheets};
  }

  function eachCell(XLSX, sheet, callback) {
    const data = Array.isArray(sheet) ? sheet :
      Array.isArray(sheet['!data']) ? sheet['!data'] : null;
    if (data) {
      for (let r = 0; r < data.length; r++) {
        const row = data[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (!row[c]) continue;
          callback(XLSX.utils.encode_cell({r,c}),row[c],r,c);
        }
      }
    } else {
      for (const [addr, cell] of Object.entries(sheet)) {
        if (!ENCODE_CELL.test(addr)) continue;
        const pos = XLSX.utils.decode_cell(addr);
        callback(addr,cell,pos.r,pos.c);
      }
    }
  }

  function cellAt(sheet, addr, r, c) {
    const data = Array.isArray(sheet) ? sheet :
      Array.isArray(sheet['!data']) ? sheet['!data'] : null;
    return data ? data[r]?.[c] : sheet[addr];
  }

  function canonicalCell(cell) {
    if (cell == null) return null;
    const value = cell.v instanceof Date ? cell.v.toISOString() : cell.v;
    return JSON.stringify([cell.t ?? null,value ?? null,cell.f ?? null,
      cell.F ?? null,cell.z ?? null,cell.s ?? null,cell.l ?? null,
      cell.c ?? null,cell.D ?? null]);
  }

  function same(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

  function validateWorkbooks(original, prepared, ranges, newSheetNames) {
    const XLSX = globalThis.XLSX;
    assert(XLSX?.read && XLSX.utils?.decode_range && XLSX.utils?.decode_cell &&
      XLSX.utils?.encode_cell, 'Нет SheetJS для контроля сохранности Excel.');
    let before = null;
    let after = null;
    try {
      before = XLSX.read(bytesOf(original), {type:'array',dense:true,cellFormula:true,
        cellStyles:true,cellDates:false});
      after = XLSX.read(bytesOf(prepared), {type:'array',dense:true,cellFormula:true,
        cellStyles:true,cellDates:false});
      assert(Array.isArray(before?.SheetNames) && Array.isArray(after?.SheetNames),
        'Не удалось прочитать листы исходного и подготовленного Excel.');
      const permissions = approveRanges(XLSX,before,ranges,newSheetNames);
      const expectedNames = before.SheetNames.concat(Array.from(permissions.newSheets));
      assert(same(expectedNames, after.SheetNames),
        'Порядок/состав исходных листов изменился без разрешения.');
      assert(same(before.Workbook?.Names,after.Workbook?.Names),
        'Изменены имена/именованные диапазоны Workbook.');
      const metaBefore=before.Workbook?.Sheets;
      const metaAfter=after.Workbook?.Sheets;
      if (Array.isArray(metaBefore)) {
        assert(Array.isArray(metaAfter) && metaAfter.length===expectedNames.length &&
          metaBefore.every((sheet,index)=>same(sheet,metaAfter[index])),
          'Изменено состояние существующих листов Workbook.Sheets.');
      }
      for (const name of before.SheetNames) {
        const a=before.Sheets[name], b=after.Sheets[name];
        assert(a && b, 'Отсутствует лист Excel: ' + name);
        for (const property of ['!merges','!cols','!rows','!autofilter',
          '!protect','!margins','!outline','!freeze','!validations']) {
          assert(same(a[property],b[property]),
            'Нарушена структура листа ' + name + ': ' + property);
        }
        const ra=a['!ref']?XLSX.utils.decode_range(a['!ref']):null;
        const rb=b['!ref']?XLSX.utils.decode_range(b['!ref']):null;
        if (ra) assert(rb && rb.s.r===ra.s.r && rb.s.c===ra.s.c &&
          rb.e.r===ra.e.r && rb.e.c>=ra.e.c,
          'Изменились исходные границы строк/столбцов на листе ' + name);
        const allow = (r,c) => (permissions.bySheet.get(name)||[]).some(range =>
          r>=range.s.r && r<=range.e.r && c>=range.s.c && c<=range.e.c);
        eachCell(XLSX,a,(addr,cell,r,c)=>{
          if (!allow(r,c)) assert(canonicalCell(cell)===canonicalCell(cellAt(b,addr,r,c)),
            'Исходная ячейка изменена вне разрешённого диапазона: ' + name + '!' + addr);
        });
        eachCell(XLSX,b,(addr,cell,r,c)=>{
          if (!allow(r,c) && !cellAt(a,addr,r,c)) {
            throw fail('Добавлена ячейка вне разрешённого диапазона: ' + name + '!' + addr);
          }
        });
      }
      return {sheets:after.SheetNames.length, preservedSheets:before.SheetNames.length};
    } finally {before=null;after=null;}
  }

  function readSmallXmlPart(input, part) {
    if (part.compressed > 65536 || part.uncompressed > 65536) return null;
    const bytes = bytesOf(input);
    const dv = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const offset = part.localOffset;
    const start = offset + 30 + dv.getUint16(offset + 26,true) + dv.getUint16(offset + 28,true);
    if (start + part.compressed > bytes.length) return null;
    const raw = bytes.subarray(start,start + part.compressed);
    raw.l = 0;
    // The same bundled ZIP decoder used by SheetJS reads just this small part.
    const xml = part.method === 0 ? raw : globalThis.XLSX?.CFB?.utils?._inflateRaw(raw,part.uncompressed);
    if (!xml || xml.length !== part.uncompressed) return null;
    return new TextDecoder('utf-8',{fatal:true}).decode(xml);
  }

  function acceptedMetadataChange(key, original, part, prepared, next, allowDateStyle) {
    if (key !== 'docprops/app.xml' && (key !== 'xl/styles.xml' || !allowDateStyle)) return false;
    try {
      const before = readSmallXmlPart(original,part);
      const after = readSmallXmlPart(prepared,next);
      if (before === null || after === null) return false;
      if (key === 'docprops/app.xml') {
        // SheetJS writes explicit false flags for omitted default properties.
        const defaultFlags = /<(HyperlinksChanged|SharedDoc|LinksUpToDate|ScaleCrop)>false<\/\1>/g;
        return before.replace(defaultFlags,'') === after.replace(defaultFlags,'');
      }
      // The MB derived date may append one standard date format. Every
      // existing style must be byte-identical; cells outside approved ranges
      // are compared separately including their effective number formats.
      const dateStyle = '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>';
      const extended = before.replace(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/,
        (_,count,styles) => '<cellXfs count="' + (Number(count) + 1) + '">' + styles + dateStyle + '</cellXfs>');
      return extended === after;
    } catch (_) {
      return false;
    }
  }

  function validateBeforeWrite(original, prepared, ranges, newSheetNames, allowDateStyle = false) {
    const a = zipParts(original);
    const b = zipParts(prepared);
    // SheetJS may rewrite workbook XML and worksheet XML, but must preserve
    // all non-cell package assets. Reject changes to themes or styles.
    for (const [key, part] of a) {
      if (part.name.endsWith('/')) continue;
      assert(b.has(key), 'При пересохранении потерян компонент XLSX: ' + part.name);
      if (/^(?:xl\/(?:styles\.xml|theme\/theme\d+\.xml)|docProps\/core\.xml)$/i.test(key) ||
          (key==='docprops/app.xml' && newSheetNames.length===0)) {
        const next=b.get(key);
        const sameBytes = part.crc===next.crc && part.uncompressed===next.uncompressed;
        assert(sameBytes || acceptedMetadataChange(key,original,part,prepared,next,allowDateStyle),
          'Изменены стили, тема или метаданные XLSX: ' + part.name + '. Сохранение запрещено.');
      }
    }
    return validateWorkbooks(original,prepared,ranges,newSheetNames);
  }

  async function readBytes(handle) {
    const file=await handle.getFile();
    validLength({byteLength:file.size});
    const bytes=await file.arrayBuffer();
    validLength(bytesOf(bytes));
    return bytes;
  }

  async function writeAndClose(handle, bytes, beforeWrite) {
    let writable = null;
    try {
      writable = await handle.createWritable({keepExistingData:false,mode:'exclusive'});
      if (beforeWrite) await beforeWrite();
      await writable.write(bytes);
      await writable.close();
      writable=null;
    } catch (error) {
      if (writable && typeof writable.abort === 'function') {
        try {await writable.abort();} catch (_) { /* Retain original failure. */ }
      }
      throw error;
    }
  }

  async function reserveBackup(directory, name) {
    // Backup extension is NOT .xls/.xlsx/.xlsm and is ignored by the scanner.
    for (let i=0; i<100; i++) {
      const backupName = name + '.reclassifier-backup-' + Date.now() + '-' + i;
      let present = false;
      try {await directory.getFileHandle(backupName,{create:false});present=true;}
      catch (error) {
        if (error?.name !== 'NotFoundError') throw error;
      }
      if (present) continue;
      const handle=await directory.getFileHandle(backupName,{create:true});
      return {name:backupName,handle};
    }
    throw fail('Не удалось подобрать уникальное имя резервной копии.');
  }

  async function requestWriteAccess(root) {
    assert(root?.kind==='directory' && typeof root.requestPermission==='function',
      'Браузер не поддерживает запрос разрешения на запись для выбранной папки.');
    // PR-05 must invoke this directly in a user click handler, before async work.
    return (await root.requestPermission({mode:'readwrite'})) === 'granted';
  }

  async function fingerprint(file) {
    assert(file && typeof file.arrayBuffer==='function',
      'Для SHA-256 необходим исходный File.');
    if (Number.isFinite(file.size)) validLength({byteLength:file.size});
    return sha256(await file.arrayBuffer());
  }

  async function verifyPrepared(root, prepared) {
    assert(prepared?.status === 'prepared','Проверка требует подготовленный результат XLSX.');
    const descriptor = safePath(prepared.entry);
    const {handle} = await resolve(root,descriptor);
    await ensureWritePermission(root,handle);
    const original = await readBytes(handle);
    assert(await sha256(original) === prepared.expectedSourceSha256,
      'Исходный XLSX изменён во время предварительной проверки.');
    return validateBeforeWrite(original,prepared.outputBytes,prepared.approvedRanges,prepared.approvedNewSheets,
      descriptor.folder.toUpperCase()==='MB');
  }

  async function writeFile(options = {}) {
    const descriptor = safePath(options.entry);
    return replaceFile({...options,beforeCommit:null}, descriptor, (original,prepared,ranges,newSheets) =>
      validateBeforeWrite(original,prepared,ranges,newSheets,descriptor.folder.toUpperCase()==='MB'));
  }

  async function replaceFile(options, descriptor, validate) {
    const {root,outputBytes,expectedSourceSha256,
      approvedRanges=[],approvedNewSheets=[],onProgress=()=>{},beforeCommit,keepBackup=true}=options;
    assert(/^[0-9a-f]{64}$/.test(String(expectedSourceSha256||'')),
      'Не задан подтверждённый SHA-256 исходного файла.');
    assert(typeof onProgress==='function','Некорректный обработчик прогресса.');
    const out=bytesOf(outputBytes);
    validLength(out);
    const busyKey=descriptor.path.toLocaleLowerCase('ru-RU');
    assert(!ACTIVE_PATHS.has(busyKey),'Этот файл уже перезаписывается.');
    ACTIVE_PATHS.add(busyKey);
    let original=null;
    let backup=null;
    let backupDirectory=null;
    let backupVerified=false;
    let committed=false;
    let attemptedWrite=false;
    try {
      const {directory,handle}=await resolve(root,descriptor);
      await ensureWritePermission(root,handle);
      onProgress({stage:'source-check',path:descriptor.path});
      original=await readBytes(handle);
      const originalHash=await sha256(original);
      assert(originalHash===expectedSourceSha256,
        'Исходный XLSX изменён после подготовки расчётов. Перечитайте файл и пересчитайте данные.');
      const proposedHash=await sha256(out);
      const validation=validate(original,out,approvedRanges,approvedNewSheets);
      if (beforeCommit) await beforeCommit();
      if (proposedHash===originalHash || validation.equivalent) {
        if (beforeCommit) assert(await sha256(await readBytes(handle))===originalHash,
          'Исходный XLSX был изменён параллельно. Запись отменена.');
        return {status:'unchanged',path:descriptor.path,sourceSha256:originalHash,
          resultSha256:originalHash,backupName:null,...validation};
      }
      if (keepBackup) {
        onProgress({stage:'backup',path:descriptor.path});
        backup=await reserveBackup(directory,descriptor.name);
        backupDirectory=directory;
        await writeAndClose(backup.handle,original);
        assert(await sha256(await readBytes(backup.handle))===originalHash,
          'Резервная копия не прошла проверку SHA-256. Исходный файл не менялся.');
        backupVerified=true;
      }
      await writeAndClose(handle,out,async()=>{
        assert(await sha256(await readBytes(handle))===originalHash,
          'Исходный XLSX был изменён параллельно. Запись отменена.');
        onProgress({stage:'writing',path:descriptor.path});
        attemptedWrite=true;
      });
      onProgress({stage:'readback',path:descriptor.path});
      const after=await readBytes(handle);
      assert(await sha256(after)===proposedHash,
        'Записанный XLSX отличается от подготовленного результата.');
      // Second read also assures XLSX is parseable after the disk write.
      zipParts(after);
      committed=true;
      return {status:'written',path:descriptor.path,sourceSha256:originalHash,
        resultSha256:proposedHash,backupName:backup?.name || null,...validation};
    } catch (error) {
      if (backup && !backupVerified && !attemptedWrite) {
        // Never leave an empty/corrupt file presented as a recoverable backup.
        try {await backupDirectory?.removeEntry?.(backup.name);} catch (_) {}
      }
      if (backupVerified && !attemptedWrite) {
        throw fail((error?.message||String(error)) +
          ' Исходный файл не записывался. Проверенная резервная копия: ' + backup.name,
          {backupName:backup.name,originalStatus:'not-written'});
      }
      if (!attemptedWrite || committed) throw error;
      const details={backupName:backup?.name,originalStatus:'unknown'};
      try {
        const {handle}=await resolve(root,descriptor);
        const current=await readBytes(handle);
        const currentHash=await sha256(current);
        const originalHash=await sha256(original);
        const outputHash=await sha256(out);
        if (currentHash===originalHash) {
          details.originalStatus='unchanged';
        } else if (currentHash===outputHash) {
          // Restore only the version produced by this operation.
          await writeAndClose(handle,original,async()=>{
            assert(await sha256(await readBytes(handle))===outputHash,
              'Файл изменился перед восстановлением исходных байтов.');
          });
          assert(await sha256(await readBytes(handle))===originalHash,
            'Восстановление исходных байтов не прошло проверку SHA-256.');
          details.originalStatus='restored';
        } else {
          // Could be partial write OR a concurrent external modification.
          // Preserve an unknown version for manual inspection.
          details.originalStatus='uncertain';
        }
      } catch (restoreError) {
        details.recoveryError=restoreError?.message||String(restoreError);
      }
      throw fail('Не удалось сохранить XLSX: ' + (error?.message||String(error)) +
        (backup ? '. Резервная копия: ' + backup.name : '') +
        '. Статус исходного файла: ' + details.originalStatus + '.',
      details);
    } finally {
      original=null;
      backup=null;
      ACTIVE_PATHS.delete(busyKey);
    }
  }


  function makeCombinedWorkbook(records, columns = EQUIPMENT_COMBINED_COLUMNS) {
    const xlsx = globalThis.XLSX;
    const sheet = xlsx.utils.json_to_sheet(records, {header:columns.slice()});
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, COMBINED_SHEET);
    return xlsx.write(book, {type:'array',bookType:'xlsx',compression:true});
  }

  function sameParts(left, right) {
    return left.size === right.size && [...left].every(([name, part]) => {
      const other = right.get(name);
      return other?.crc === part.crc && other.uncompressed === part.uncompressed;
    });
  }

  function verifyCombinedWorkbook(bytes, expectedRows = null) {
    const parts = zipParts(bytes);
    const xlsx = globalThis.XLSX;
    const book = xlsx.read(bytesOf(bytes), {type:'array',dense:true,cellFormula:true,cellDates:false});
    const previousColumns = EQUIPMENT_COMBINED_COLUMNS.filter(column => !EQUIPMENT_VARIANT_COLUMNS.includes(column));
    assert(same(book.SheetNames,[COMBINED_SHEET]),
      'Equipment_Combined.xlsx содержит непредусмотренные листы.');
    const sheet = book.Sheets[COMBINED_SHEET];
    const range = sheet['!ref'] && xlsx.utils.decode_range(sheet['!ref']);
    const columns = expectedRows === null && range?.e.c === previousColumns.length - 1
      ? previousColumns : EQUIPMENT_COMBINED_COLUMNS;
    assert(range && range.s.r === 0 && range.s.c === 0 &&
      range.e.c === columns.length - 1 && range.e.r > 0 &&
      (expectedRows === null || range.e.r === expectedRows),
      'Equipment_Combined.xlsx имеет неподтверждённый диапазон или число записей.');
    const rows = xlsx.utils.sheet_to_json(sheet, {header:1,raw:true,defval:null});
    assert(same(rows[0],columns) && rows.length === range.e.r + 1 &&
      rows.slice(1).every(row => ['Stationary','Mounted'].includes(row[0])),
      'Equipment_Combined.xlsx не соответствует утверждённой схеме.');
    // Accept only a plain workbook exported by the application. Rebuilding it
    // from values rejects formulas, styles, hidden structures and other custom
    // content even when the visible headers and rows appear to be identical.
    if (expectedRows === null) {
      const records = rows.slice(1).map(row =>
        Object.fromEntries(columns.map((column,index) => [column,row[index]])));
      assert(sameParts(parts, zipParts(makeCombinedWorkbook(records,columns))),
        'Equipment_Combined.xlsx содержит пользовательское или неподтверждённое содержимое.');
    }
    return {parts, rows:range.e.r};
  }

  async function combinedDirectory(root) {
    assert(root?.kind === 'directory' && typeof root.entries === 'function',
      'Корневая папка недоступна для сохранения Equipment_Combined.');
    const matches = [];
    for await (const [name, handle] of root.entries()) {
      if (name.toLowerCase() === 'catalogs' && handle.kind === 'directory') matches.push([name,handle]);
    }
    assert(matches.length === 1, 'Требуется одна рабочая подпапка Catalogs.');
    return matches[0];
  }

  async function findCombinedHandle(directory) {
    let target = null;
    for await (const [name, handle] of directory.entries()) {
      if (name.toLowerCase() !== COMBINED_FILE.toLowerCase()) continue;
      assert(name === COMBINED_FILE && handle.kind === 'file' && !target,
        'В Catalogs уже существует конфликтующий путь Equipment_Combined.xlsx.');
      target = handle;
    }
    return target;
  }

  async function removeCombinedBackups(directory) {
    let removedBackups = 0;
    const cleanupWarnings = [];
    try {
      for await (const [name,handle] of directory.entries()) {
        if (handle.kind !== 'file' || !/^Equipment_Combined\.xlsx\.reclassifier-backup-[0-9]+-[0-9]+$/.test(name)) continue;
        try {
          await directory.removeEntry(name);
          removedBackups++;
        } catch (error) {
          cleanupWarnings.push(name + ': ' + (error?.message || String(error)));
        }
      }
    } catch (error) {
      cleanupWarnings.push(error?.message || String(error));
    }
    return {removedBackups,cleanupWarnings};
  }

  async function writeCombined({root,combined,verifySources,onProgress=()=>{},keepBackup=true}={}) {
    assert(combined?.id === 'combined' && ['valid','warning'].includes(combined.validation?.status) &&
      !combined.validation?.errors?.length && Array.isArray(combined.records) && combined.records.length > 0 &&
      same(combined.meta?.approvedColumns,EQUIPMENT_COMBINED_COLUMNS) &&
      combined.records.every(record => Object.keys(record).length === EQUIPMENT_COMBINED_COLUMNS.length &&
        EQUIPMENT_COMBINED_COLUMNS.every(column => Object.hasOwn(record,column))),
      'Equipment_Combined не прошёл валидацию при обновлении.');
    assert(typeof verifySources === 'function','Не задана проверка исходных каталогов Equipment_Combined.');
    const [folder,directory] = await combinedDirectory(root);
    await ensureWritePermission(root,directory,false);
    const path = folder + '/' + COMBINED_FILE;
    const descriptor = {parts:[folder,COMBINED_FILE],name:COMBINED_FILE,path};
    const outputBytes = makeCombinedWorkbook(combined.records);
    const prepared = verifyCombinedWorkbook(outputBytes,combined.records.length);
    const current = await findCombinedHandle(directory);
    if (current) {
      descriptor.handle = current;
      const expectedSourceSha256 = await fingerprint(await current.getFile());
      const result = await replaceFile({root,outputBytes,expectedSourceSha256,onProgress,beforeCommit:verifySources,keepBackup},
        descriptor, original => {
          const existing = verifyCombinedWorkbook(original);
          return {rows:prepared.rows,equivalent:sameParts(existing.parts,prepared.parts)};
        });
      return keepBackup ? result : {...result,...await removeCombinedBackups(directory)};
    }

    const busyKey = path.toLowerCase();
    assert(!ACTIVE_PATHS.has(busyKey),'Equipment_Combined уже сохраняется.');
    ACTIVE_PATHS.add(busyKey);
    let handle = null;
    let writable = null;
    try {
      const resultSha256 = await sha256(outputBytes);
      await verifySources();
      assert(!await findCombinedHandle(directory),'Equipment_Combined.xlsx появился после проверки.');
      handle = await directory.getFileHandle(COMBINED_FILE,{create:true});
      await ensureWritePermission(root,handle);
      writable = await handle.createWritable({keepExistingData:false,mode:'exclusive'});
      assert((await handle.getFile()).size === 0,'Equipment_Combined.xlsx изменён параллельно.');
      onProgress({stage:'writing',path});
      await writable.write(outputBytes);
      await writable.close();
      writable = null;
      const after = await readBytes(handle);
      assert(await sha256(after) === resultSha256,'Созданный Equipment_Combined.xlsx отличается от расчёта.');
      return {status:'created',path,sourceSha256:null,resultSha256,backupName:null,rows:prepared.rows,
        ...(keepBackup ? {} : await removeCombinedBackups(directory))};
    } catch (error) {
      try {await writable?.abort?.();} catch (_) {}
      if (!handle) throw error;
      let originalStatus = 'uncertain';
      try {
        const actual = await findCombinedHandle(directory);
        if (!actual) originalStatus = 'not-created';
        else if (typeof actual.isSameEntry === 'function' && await actual.isSameEntry(handle) &&
            (await actual.getFile()).size === 0 && typeof directory.removeEntry === 'function') {
          await directory.removeEntry(COMBINED_FILE);
          originalStatus = 'not-created';
        }
      } catch (_) {}
      throw fail('Не удалось создать ' + path + ': ' + (error?.message || String(error)) +
        '. Состояние файла: ' + originalStatus + '.', {originalStatus});
    } finally {
      ACTIVE_PATHS.delete(busyKey);
    }
  }

  const EXPORT_TARGETS=Object.freeze({itsm:['ITSM','export_ITSM.xlsx'],mb:['MB','export_MB.xlsx']});

  // Находим единственную рабочую книгу каждого типа. Несколько совпадающих путей требуют устранить неоднозначность.
  async function exportTargets(root, kinds=Object.keys(EXPORT_TARGETS)) {
    const result={};
    for(const kind of kinds){
      const [folder,filename]=EXPORT_TARGETS[kind];
      const folders=[];
      for await(const [name,handle] of root.entries()){
        if(handle.kind==='directory'&&name.toUpperCase()===folder) folders.push([name,handle]);
      }
      assert(folders.length===1,'Не найдена единственная рабочая папка '+folder+'.');
      const [actual,directory]=folders[0];
      const matches=[];
      async function find(dir,prefix,depth) {
        for await(const [name,entry] of dir.entries()){
          const path=prefix+'/'+name;
          if(name.toLowerCase()===filename.toLowerCase()){
            assert(entry.kind==='file','Конфликт имени '+path+'.');
            matches.push({directory:dir,handle:entry,filename:name,path});
          } else if(LOCAL_EXPORT?.nestedTargets&&entry.kind==='directory'&&depth<4){
            await find(entry,path,depth+1);
          }
        }
      }
      await find(directory,actual,1);
      assert(matches.length<=1,'Найдено несколько итоговых книг '+filename+': '+
        matches.map(item=>item.path).join(' и ')+'. Оставьте в рабочей папке одну книгу.');
      result[kind]=matches[0]??{directory,handle:null,filename,path:actual+'/'+filename};
    }
    return result;
  }

  async function inspectFolderExports(root,{requireWrite=true}={}) {
    const targets=await exportTargets(root);
    const files={};
    for(const [kind,target] of Object.entries(targets)){
      if(requireWrite) await ensureWritePermission(root,target.handle||target.directory,Boolean(target.handle));
      files[kind]=target.handle?await target.handle.getFile():null;
    }
    return files;
  }

  async function exportFingerprint(file) {
    assert(file?.size>0&&file.size<=MAX_EXPORT_BYTES,'Неподдерживаемый размер накопительной XLSX.');
    if(LOCAL_EXPORT?.hashBlob) return LOCAL_EXPORT.hashBlob(file);
    const digest=await globalThis.crypto.subtle.digest('SHA-256',await file.arrayBuffer());
    return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  }

  function unreadableSnapshot(error) {
    return error?.name==='NotReadableError'||/state cached in an interface object/i.test(error?.message??'');
  }

  async function targetFingerprint(handle) {
    try {return await exportFingerprint(await handle.getFile());}
    catch(error){
      if(!unreadableSnapshot(error)) throw error;
      // Retry only the read. The caller still compares the fresh bytes to the expected SHA-256.
      return exportFingerprint(await handle.getFile());
    }
  }

  function pairWriteError(path,phase,error) {
    const detail=unreadableSnapshot(error)
      ? 'Chrome потерял доступ к снимку файла. Закройте книгу в Excel и повторите обновление.'
      : error.message;
    return new Error(path+' · '+phase+' · '+detail,{cause:error});
  }

  async function verifyExportTarget(target, expectedHash) {
    assert(target.handle, target.path+': итоговый XLSX не найден после записи.');
    const actual = await targetFingerprint(target.handle);
    assert(actual === expectedHash, target.path+': содержимое итогового XLSX изменилось.');
    return {path:target.path,resultSha256:actual};
  }

  async function verifyFolderExports(root, hashes) {
    const targets = await exportTargets(root);
    const verified = [];
    for (const [kind,target] of Object.entries(targets)) {
      verified.push(await verifyExportTarget(target,hashes[kind]));
    }
    return verified;
  }

  // Сначала проверяем и подготавливаем обе книги, затем заменяем цели по очереди.
  // Если вторая замена или проверка завершается ошибкой, уже записанную книгу пытаемся вернуть из копии.
  // Отдельная проверка SHA-256 защищает файл, который успели изменить между этапами.
  async function writeFolderExports({root,books,hashes,onWritten=()=>{},onStage=()=>{},checkpoint=()=>{}}) {
    const lock='folder-export-pair';
    assert(!ACTIVE_PATHS.has(lock),'Выгрузки уже сохраняются.');
    ACTIVE_PATHS.add(lock);
    try {
      const targets=await exportTargets(root);
      for(const [kind,target] of Object.entries(targets)){
        checkpoint();
        try {
          const book=books[kind];
          assert(book?.rows>0&&book.blob?.size>0,'Не подтверждён результат.');
          await ensureWritePermission(root,target.handle||target.directory,Boolean(target.handle));
          const actual=target.handle?await targetFingerprint(target.handle):null;
          assert(actual===hashes[kind],'Файл изменился после предпросмотра.');
          const parts=zipParts(await book.blob.arrayBuffer(),true);
          assert(parts.has('xl/styles.xml')&&parts.has('xl/worksheets/sheet1.xml'),
            'Не найдены обязательные части XLSX.');
          assert(await exportFingerprint(book.blob)===book.sha256,'Изменились подготовленные данные.');
        } catch(error) {
          throw pairWriteError(target.path,'Проверка перед записью',error);
        }
      }
      const staged=[];
      const completed=[];
      try {
        for(const [kind,target] of Object.entries(targets)){
          checkpoint();
          const stage={kind,target,handle:target.handle,created:false,stream:null};
          staged.push(stage);
          try {
            const latest=(await exportTargets(root))[kind];
            assert((!target.directory.isSameEntry||await latest.directory.isSameEntry(target.directory))&&
              ((!stage.handle&&!latest.handle)||(stage.handle&&latest.handle&&
                (!latest.handle.isSameEntry||await latest.handle.isSameEntry(stage.handle)))),
            'Целевой путь изменён параллельно.');
            if(!stage.handle){
              stage.handle=await target.directory.getFileHandle(target.filename,{create:true});
              stage.created=true;
            }
            await ensureWritePermission(root,stage.handle);
            stage.stream=await stage.handle.createWritable({keepExistingData:false,mode:'exclusive',
              paired:Boolean(LOCAL_EXPORT?.streamArchive),created:stage.created});
            assert(stage.created?(await stage.handle.getFile()).size===0:await targetFingerprint(stage.handle)===hashes[kind],
              'Целевой файл изменился перед записью.');
            await onStage(kind,'Подготовка к записи · '+target.path,target);
            await stage.stream.write(books[kind].blob);
          }catch(error){throw pairWriteError(target.path,'Подготовка к записи',error);}
        }
        for(const stage of staged){
          const {kind,target,handle,created}=stage;
          checkpoint();
          try {
            assert(created?(await handle.getFile()).size===0:await targetFingerprint(handle)===hashes[kind],
              'Целевой файл изменился перед фиксацией.');
            await onStage(kind,'Сохранение · '+target.path,target);
            await stage.stream.close();
            stage.committed=stage.stream;
            stage.stream=null;
          }catch(error){throw pairWriteError(target.path,'Фиксация книги',error);}
          const persisted=(await exportTargets(root))[kind];
          let verified;
          try {verified=await verifyExportTarget(persisted,books[kind].sha256);}
          catch(error){throw pairWriteError(target.path,'Проверка после записи',error);}
          completed.push({...verified,status:created?'created':'written',sourceSha256:hashes[kind]});
        }
      } catch(error) {
        const failures=[];
        for (const stage of staged.slice().reverse()) {
          if (!stage.committed?.rollback) continue;
          try { await stage.committed.rollback(books[stage.kind].sha256); }
          catch (rollbackError) {
            failures.push(stage.target.path+' · '+rollbackError.message+
              (stage.committed.backupPath?' · резервная копия '+stage.committed.backupPath:''));
          }
        }
        if (failures.length) throw new Error(error.message+' · Не удалось откатить запись: '+failures.join(' | '),{cause:error});
        throw error;
      } finally {
        for(const stage of staged){
          try {await stage.stream?.abort();}catch(_){}
          if(stage.created){
            try {
              const latest=(await exportTargets(root))[stage.kind].handle;
              if(latest?.isSameEntry&&await latest.isSameEntry(stage.handle)&&(await latest.getFile()).size===0) {
                await stage.target.directory.removeEntry(stage.target.filename);
              }
            }catch(_){}
          }
        }
      }
      for (const stage of staged) {
        try { await stage.committed?.finish?.(); }
        catch (error) { console.warn('Временная резервная копия: '+stage.committed.backupPath+' · '+error.message); }
      }
      for (const item of completed) onWritten(item);
    }finally{ACTIVE_PATHS.delete(lock);}
  }

  async function restoreBackup(options) {
    const {root,entry,backupName,expectedBackupSha256,
      expectedCurrentSha256,confirmed}=options||{};
    assert(confirmed===true,
      'Для ручного восстановления требуется явное подтверждение пользователя.');
    const descriptor=safePath(entry);
    assert(typeof backupName==='string' &&
      backupName.startsWith(descriptor.name+'.reclassifier-backup-') &&
      /^.+\.xlsx\.reclassifier-backup-[0-9]+-[0-9]+$/i.test(backupName) &&
      !backupName.includes('/') && !backupName.includes('\\'),
      'Резервная копия не соответствует выбранному исходному XLSX.');
    for (const hash of [expectedBackupSha256,expectedCurrentSha256]) {
      assert(/^[a-f0-9]{64}$/.test(String(hash||'')),
        'Перед восстановлением необходим SHA-256 резервной копии и текущего файла.');
    }
    const busyKey=descriptor.path.toLocaleLowerCase('ru-RU');
    assert(!ACTIVE_PATHS.has(busyKey),'Этот файл уже находится в операции записи.');
    ACTIVE_PATHS.add(busyKey);
    try {
      const {directory,handle}=await resolve(root,descriptor);
      await ensureWritePermission(root,handle);
      const backupHandle=await directory.getFileHandle(backupName,{create:false});
      const backupBytes=await readBytes(backupHandle);
      assert(await sha256(backupBytes)===expectedBackupSha256,
        'Резервная копия не совпадает с подтверждённым SHA-256.');
      zipParts(backupBytes);
      const current=await readBytes(handle);
      assert(await sha256(current)===expectedCurrentSha256,
        'Текущий XLSX изменён после проверки. Восстановление отменено.');
      if (expectedBackupSha256===expectedCurrentSha256) {
        return {status:'unchanged',path:descriptor.path,backupName};
      }
      await writeAndClose(handle,backupBytes);
      assert(await sha256(await readBytes(handle))===expectedBackupSha256,
        'Восстановленный XLSX не совпадает с проверенной копией; не используйте файл до ручной проверки.');
      return {status:'restored',path:descriptor.path,
        sourceSha256:expectedCurrentSha256,resultSha256:expectedBackupSha256,
        backupName};
    } finally {
      ACTIVE_PATHS.delete(busyKey);
    }
  }

  globalThis.ReclassifierSafeExcelWriter=Object.freeze({
    fingerprint,requestWriteAccess,validateBeforeWrite,verifyPrepared,writeFile,writeCombined,restoreBackup,
    exportTargets,inspectFolderExports,verifyFolderExports,writeFolderExports,maxBytes:MAX_BYTES
  });
})();
