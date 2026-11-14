const RCA_ZIP_LIMIT = 192 * 1024 * 1024;
const RCA_ZIP_ENTRIES = 2048;
const RCA_ZIP_MANIFEST = 'manifest.json';
const RCA_ZIP_PHOTO = /^RCA\/attachments\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(jpg|png|webp)$/;
const RCA_ZIP_CRC = Uint32Array.from({length:256}, (_, index) => {
  for (let i = 0; i < 8; i++) index = (index >>> 1) ^ ((index & 1) ? 0xedb88320 : 0);
  return index;
});

async function rcaZipCrc(blob) {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += 65536) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + 65536).arrayBuffer());
    for (const byte of bytes) crc = (crc >>> 8) ^ RCA_ZIP_CRC[(crc ^ byte) & 255];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rcaZipHeader(size, signature, shorts, integers, name = new Uint8Array()) {
  const bytes = new Uint8Array(size + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  for (const [offset, value] of shorts) view.setUint16(offset, value, true);
  for (const [offset, value] of integers) view.setUint32(offset, value, true);
  bytes.set(name, size);
  return bytes;
}

async function exportRcaZip(rows, dictionaries, load, store) {
  const snapshots = [];
  const manifest = await exportRcaArchive(rows, dictionaries, async id => {
    const record = await load(id);
    if (record) snapshots.push(record);
    return record;
  }, true);
  const parts = [];
  const central = [];
  let offset = 0;
  let centralSize = 0;
  async function add(path, blob) {
    const name = new TextEncoder().encode(path);
    const length = 30 + name.length + blob.size;
    centralSize += 46 + name.length;
    if (central.length >= RCA_ZIP_ENTRIES || offset + length + centralSize + 22 > RCA_ZIP_LIMIT) {
      throw new Error('ZIP превышает 192 МиБ или содержит слишком много файлов.');
    }
    const crc = await rcaZipCrc(blob);
    parts.push(rcaZipHeader(30, 0x04034b50, [[4,20],[12,33],[26,name.length]],
      [[14,crc],[18,blob.size],[22,blob.size]], name), blob);
    central.push(rcaZipHeader(46, 0x02014b50, [[4,20],[6,20],[14,33],[28,name.length]],
      [[16,crc],[20,blob.size],[24,blob.size],[42,offset]], name));
    offset += length;
  }
  await add(RCA_ZIP_MANIFEST, manifest);
  for (const record of snapshots) {
    for (const item of record.attachments.filter(item => item.kind === 'local_file')) {
      await add(item.path, await store.loadBinary(record, item.id));
    }
  }
  return new Blob([...parts, ...central, rcaZipHeader(22, 0x06054b50,
    [[8,central.length],[10,central.length]], [[12,centralSize],[16,offset]])], {type:'application/zip'});
}

async function readRcaZip(source) {
  const invalid = () => new Error('Некорректный ZIP RCA. Выберите архив, созданный в ReclassifierEXCEL.');
  if (source.size < 22 || source.size > RCA_ZIP_LIMIT) throw invalid();
  const at = async (offset, length) => new DataView(await source.slice(offset, offset + length).arrayBuffer());
  const end = await at(source.size - 22, 22);
  const count = end.getUint16(10, true);
  const size = end.getUint32(12, true);
  const start = end.getUint32(16, true);
  if (end.getUint32(0, true) !== 0x06054b50 || end.getUint32(4, true) || end.getUint16(20, true) ||
      count !== end.getUint16(8, true) || !count || count > RCA_ZIP_ENTRIES ||
      size > count * 160 || start + size !== source.size - 22) throw invalid();
  const directory = await at(start, size);
  const files = new Map();
  let cursor = 0;
  let offset = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > size || directory.getUint32(cursor, true) !== 0x02014b50 ||
        directory.getUint32(cursor + 8, true) || directory.getUint32(cursor + 30, true) ||
        directory.getUint16(cursor + 34, true)) throw invalid();
    const length = directory.getUint16(cursor + 28, true);
    const bytes = directory.getUint32(cursor + 24, true);
    const crc = directory.getUint32(cursor + 16, true);
    if (cursor + 46 + length > size || directory.getUint32(cursor + 20, true) !== bytes ||
        directory.getUint32(cursor + 42, true) !== offset || offset + 30 + length + bytes > start) throw invalid();
    const name = new Uint8Array(directory.buffer, cursor + 46, length);
    const path = new TextDecoder().decode(name);
    if (files.has(path) || (path !== RCA_ZIP_MANIFEST && !RCA_ZIP_PHOTO.test(path)) ||
        bytes > (path === RCA_ZIP_MANIFEST ? RCA_ARCHIVE_LIMIT : RCA_PHOTO_LIMIT)) throw invalid();
    const local = await at(offset, 30 + length);
    if (local.getUint32(0, true) !== 0x04034b50 || local.getUint32(6, true) ||
        local.getUint32(14, true) !== crc || local.getUint32(18, true) !== bytes ||
        local.getUint32(22, true) !== bytes || local.getUint16(26, true) !== length ||
        local.getUint16(28, true) || name.some((byte, index) => byte !== local.getUint8(30 + index))) throw invalid();
    const from = offset + 30 + length;
    const blob = source.slice(from, from + bytes);
    if (await rcaZipCrc(blob) !== crc) throw new Error('Контрольная сумма ZIP не совпала: ' + path);
    files.set(path, blob);
    cursor += 46 + length;
    offset = from + bytes;
  }
  if (cursor !== size || offset !== start || !files.has(RCA_ZIP_MANIFEST)) throw invalid();
  const archive = readRcaArchive(await files.get(RCA_ZIP_MANIFEST).text());
  if (archive.attachments?.binaryIncluded !== true) throw invalid();
  files.delete(RCA_ZIP_MANIFEST);
  const expected = new Set();
  for (const record of archive.problems) {
    for (const item of record.attachments.filter(item => item.kind === 'local_file')) {
      const blob = files.get(item.path);
      if (!blob || blob.size !== item.size || await hashRcaAttachment(blob) !== item.hash) {
        throw new Error('Оригинал отсутствует или повреждён: ' + item.name);
      }
      await validateRcaImage(blob, item.path, item.mime);
      expected.add(item.path);
    }
  }
  if (expected.size !== files.size) throw invalid();
  return {archive, files};
}
