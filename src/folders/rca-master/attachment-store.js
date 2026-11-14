const RCA_PHOTO_LIMIT = 20 * 1024 * 1024;
const RCA_PHOTO_COUNT = 20;
const RCA_PHOTO_EXTENSIONS = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};
const RCA_PHOTO_OWNERS = {evidence: 'evidence', action: 'actions'};

function rcaAttachmentPath(problemId, id, mime) {
  if (!RCA_UUID.test(problemId) || !RCA_UUID.test(id) || !Object.hasOwn(RCA_PHOTO_EXTENSIONS, mime)) {
    throw new Error('Некорректный идентификатор или тип фотографии RCA.');
  }
  return ['attachments', problemId, id + '.' + RCA_PHOTO_EXTENSIONS[mime]];
}

function listRcaAttachments(record, ownerType, ownerId) {
  return record.attachments.filter(item => item.kind === 'local_file' &&
    item.ownerType === ownerType && item.ownerId === ownerId);
}

function validateRcaAttachment(record, item) {
  const path = rcaAttachmentPath(record.problem.id, item.id, item.mime).join('/');
  if (item.problemId !== record.problem.id || item.path !== 'RCA/' + path ||
      !Object.hasOwn(RCA_PHOTO_OWNERS, item.ownerType) ||
      !record[RCA_PHOTO_OWNERS[item.ownerType]].some(owner => owner.id === item.ownerId) ||
      !/^[a-f0-9]{64}$/.test(item.hash) || !Number.isSafeInteger(item.size) ||
      item.size < 1 || item.size > RCA_PHOTO_LIMIT || typeof item.name !== 'string' || !item.name ||
      typeof item.description !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) {
    throw new Error('Некорректные метаданные фотографии RCA.');
  }
}

async function validateRcaImage(file, name = file?.name, type = file?.type) {
  if (!file || file.size < 12 || file.size > RCA_PHOTO_LIMIT) {
    throw new Error('Выберите фотографию размером до 20 МБ.');
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const signature = String.fromCharCode(...bytes);
  const mime = signature.startsWith('\xff\xd8\xff') ? 'image/jpeg' :
    signature.startsWith('\x89PNG\r\n\x1a\n') ? 'image/png' :
    signature.startsWith('RIFF') && signature.slice(8) === 'WEBP' ? 'image/webp' : null;
  const ext = name?.split('.').at(-1).toLowerCase();
  if (!mime || (type && type !== mime) ||
      (ext !== RCA_PHOTO_EXTENSIONS[mime] && !(mime === 'image/jpeg' && ext === 'jpeg'))) {
    throw new Error('Расширение, MIME или сигнатура не соответствуют JPEG, PNG или WebP.');
  }
  return mime;
}

async function hashRcaAttachment(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function createRcaAttachmentStore({readFile, writeNew, writable}) {
  async function loadBinary(record, id) {
    const item = record.attachments.find(entry => entry.id === id && entry.kind === 'local_file');
    if (!item) throw new Error('Фотография не связана с расследованием.');
    validateRcaAttachment(record, item);
    const path = rcaAttachmentPath(record.problem.id, item.id, item.mime);
    const file = await readFile(path.slice(0, -1), path.at(-1));
    if (file.size !== item.size || await hashRcaAttachment(file) !== item.hash) {
      throw new Error('Фотография повреждена или заменена.');
    }
    return file.slice(0, file.size, item.mime);
  }

  return {
    loadBinary,
    listAttachments: listRcaAttachments,
    async stageFile(record, {ownerType, ownerId, file, description = ''}) {
      if (!await writable()) throw new Error('Для добавления фото требуется разрешение на запись.');
      if (listRcaAttachments(record, ownerType, ownerId).length >= RCA_PHOTO_COUNT) {
        throw new Error('К карточке можно прикрепить до ' + RCA_PHOTO_COUNT + ' фотографий.');
      }
      const mime = await validateRcaImage(file);
      const id = crypto.randomUUID();
      const problemId = record.problem.id;
      const path = rcaAttachmentPath(problemId, id, mime);
      const item = {kind: 'local_file', id, problemId, ownerType, ownerId, mime,
        path: 'RCA/' + path.join('/'), name: file.name, size: file.size, hash: await hashRcaAttachment(file),
        description, createdAt: new Date().toISOString()};
      validateRcaAttachment(record, item);
      await writeNew(path.slice(0, -1), path.at(-1), file);
      await loadBinary({...record, attachments: [item]}, id);
      return item;
    }
  };
}
