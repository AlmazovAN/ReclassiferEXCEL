// FILE CONTRACT: ITSM ↔ Mobile Brigade request presence; independent of equipment names.
// Reusable by ITSM Worker (human-readable XLSX/Dataset column) and live KPI facts.
// Lookup uses the current MB Dataset ONLY: request ID membership, not date coverage.
// A saved ITSM value is a snapshot, not authoritative after Mobile Brigade changes.
(() => {
  'use strict';

  const STATUS = Object.freeze({
    PRESENT: 'Есть в МБ',
    ABSENT: 'Нет в МБ',
    UNKNOWN: 'Нет данных МБ'
  });

  function requestKey(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
      .trim().toLocaleLowerCase('ru-RU');
  }

  function day(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null :
        value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate();
    }
    const source = String(value ?? '').trim();
    let match = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!match) {
      match = source.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (!match) return null;
      return Number(match[3]) * 10000 + Number(match[2]) * 100 + Number(match[1]);
    }
    return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
  }

  function buildIndex(records = []) {
    const index = new Set();
    for (const record of Array.isArray(records) ? records : []) {
      const id = requestKey(record?.request);
      if (id) index.add(id);
    }
    return index;
  }

  function hasRequest(index, id) {
    if (!index) return false;
    if (index instanceof Map || index instanceof Set) return index.has(id);
    throw new Error('MB presence index must be a Map or Set.');
  }

  // Keep the legacy argument signature for the ITSM Worker, but neither
  // createdAt nor MB freshness is a condition for request-ID membership.
  // UNKNOWN is reserved for an unavailable Dataset or an unusable ITSM ID.
  function evaluate(index, number, _createdAt, _meta = {}, available = true) {
    const id = requestKey(number);
    if (!id || !available || !(index instanceof Set || index instanceof Map)) {
      return STATUS.UNKNOWN;
    }
    return hasRequest(index, id) ? STATUS.PRESENT : STATUS.ABSENT;
  }

  function fromCurrentDatasets(number, createdAt, mbDataset) {
    if (!mbDataset || !Array.isArray(mbDataset.records)) return STATUS.UNKNOWN;
    const index = buildIndex(mbDataset.records);
    return evaluate(index, number, createdAt, mbDataset.meta || {}, true);
  }

  const api = Object.freeze({ STATUS, requestKey, day, buildIndex, evaluate, fromCurrentDatasets });
  globalThis.ReclassifierItsmMbPresence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
