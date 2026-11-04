// Browser-origin recovery checkpoint: explicit, optional and independent of the
// user-authorized OS .db. One rolling checkpoint bounds storage growth.
// This is NOT a replacement for a verified disk backup: browser/site data may
// be unavailable on file:// origins, blocked by enterprise policy, or evicted.
(() => {
  'use strict';
  const DB_NAME = 'reclassifier-sqlite-recovery-v1';
  const STORE = 'checkpoints';
  const KEY = 'latest';
  const MAX_BYTES = 1024 * 1024 * 1024;

  function environment() {
    if (typeof indexedDB === 'undefined' || !indexedDB ||
        typeof Blob === 'undefined') {
      throw new Error('Хранилище точек восстановления недоступно в этом браузере.');
    }
  }

  function requestDone(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ||
        new Error('Ошибка доступа к хранилищу браузера.'));
    });
  }

  async function openStore() {
    environment();
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    return requestDone(request);
  }

  async function withStore(mode, operation) {
    const database = await openStore();
    try {
      const transaction = database.transaction(STORE, mode);
      const completed = new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error ||
          new Error('Ошибка транзакции хранилища восстановления.'));
        transaction.onabort = () => reject(transaction.error ||
          new Error('Сохранение точки восстановления было отменено.'));
      });
      let result;
      try {
        result = await requestDone(operation(transaction.objectStore(STORE)));
      } catch (error) {
        try { transaction.abort(); } catch (_) {}
        // Avoid an unhandled rejection from the aborted transaction.
        await completed.catch(() => {});
        throw error;
      }
      await completed;
      return result;
    } finally {
      database.close();
    }
  }

  async function estimate() {
    if (typeof navigator === 'undefined' ||
        typeof navigator.storage?.estimate !== 'function') {
      return null;
    }
    const data = await navigator.storage.estimate();
    return {
      usage: Number(data?.usage) || 0,
      quota: Number(data?.quota) || 0
    };
  }

  async function save(bytes, metadata) {
    environment();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 100 ||
        bytes.byteLength > MAX_BYTES) {
      throw new Error('Недопустимый размер контрольной копии SQLite.');
    }
    const uuid = String(metadata?.databaseUuid || '').trim();
    const fileName = String(metadata?.fileName || '').trim();
    if (!uuid || !fileName) {
      throw new Error('Для точки восстановления нужны UUID и имя SQLite.');
    }
    const quota = await estimate();
    // Conservative budget check; browser may decline even when estimate fits.
    // Do not start copying a large Blob when the declared headroom is too small.
    if (quota?.quota && quota.quota - quota.usage < bytes.byteLength * 1.25) {
      throw new Error('В хранилище браузера недостаточно свободной квоты для SQLite.');
    }
    const snapshot = {
      key: KEY, databaseUuid: uuid, fileName,
      revision: Number(metadata.workingRevision) || 0,
      createdAt: new Date().toISOString(),
      size: bytes.byteLength,
      bytes: new Blob([bytes], { type: 'application/x-sqlite3' })
    };
    await withStore('readwrite', store => store.put(snapshot));
    return Object.freeze({
      databaseUuid: uuid, fileName, revision: snapshot.revision,
      createdAt: snapshot.createdAt, size: snapshot.size
    });
  }

  async function latest() {
    const item = await withStore('readonly', store => store.get(KEY));
    if (!item) return null;
    if (!(item.bytes instanceof Blob) || item.bytes.size !== item.size ||
        item.size < 100 || item.size > MAX_BYTES) {
      throw new Error('Сохранённая точка восстановления повреждена.');
    }
    return item;
  }

  async function remove() {
    await withStore('readwrite', store => store.delete(KEY));
  }

  globalThis.ReclassifierSqliteRecoveryStore = Object.freeze({
    estimate, save, latest, remove
  });
})();
