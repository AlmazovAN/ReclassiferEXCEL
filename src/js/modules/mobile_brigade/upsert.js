(() => {
  'use strict';

  function text(value) {
    return value === null || value === undefined
      ? ''
      : String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  function comparable(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (Array.isArray(value)) return value.map(comparable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map(name => [name, comparable(value[name])])
      );
    }
    return value === undefined ? null : value;
  }

  function sameRecord(left, right) {
    return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
  }

  function maxDate(left, right) {
    if (!left) return right || null;
    if (!right) return left || null;
    return String(left) >= String(right) ? left : right;
  }

  function minDate(left, right) {
    if (!left) return right || null;
    if (!right) return left || null;
    return String(left) <= String(right) ? left : right;
  }

  function mergeFreshnessByScope(currentMeta = {}, incomingMeta = {}) {
    const result = Object.assign({}, currentMeta.freshnessByScope || {});
    for (const [scope, freshness] of Object.entries(incomingMeta.freshnessByScope || {})) {
      const name = text(scope);
      if (!name) continue;
      result[name] = maxDate(result[name], freshness);
    }
    return result;
  }

  function mergeSourceFreshness(currentMeta = {}, incomingMeta = {}) {
    const map = new Map();
    for (const item of [
      ...(Array.isArray(currentMeta.sourceFreshness) ? currentMeta.sourceFreshness : []),
      ...(Array.isArray(incomingMeta.sourceFreshness) ? incomingMeta.sourceFreshness : [])
    ]) {
      if (!item || typeof item !== 'object') continue;
      const fileName = text(item.fileName);
      const freshness = text(item.freshness);
      const scopes = Array.isArray(item.scopes) ? item.scopes.map(text).filter(Boolean).sort() : [];
      const identity = [fileName, freshness, scopes.join('|')].join('\u0000');
      map.set(identity, Object.assign({}, item, { scopes }));
    }
    return Array.from(map.values());
  }

  function prepare(currentRecords, incomingRecords, options = {}) {
    if (!Array.isArray(currentRecords) || !Array.isArray(incomingRecords)) {
      throw new Error('Mobile Brigade UPSERT должен получить два массива записей.');
    }

    const currentByKey = new Map();
    let currentRowsWithoutKey = 0;
    let currentDuplicateKeys = 0;

    currentRecords.forEach((record, index) => {
      const recordKey = key(record?.recordKey);
      if (!recordKey) {
        currentRowsWithoutKey += 1;
        return;
      }
      if (currentByKey.has(recordKey)) {
        currentDuplicateKeys += 1;
        currentByKey.get(recordKey).push(index);
      } else {
        currentByKey.set(recordKey, [index]);
      }
    });

    if (currentRowsWithoutKey || currentDuplicateKeys) {
      throw new Error(
        'Текущий Mobile Brigade Data нарушает контракт UPSERT: строк без recordKey ' +
        currentRowsWithoutKey + ', дублирующихся ключей ' + currentDuplicateKeys + '.'
      );
    }

    const incomingByKey = new Map();
    let incomingRowsWithoutKey = 0;
    let incomingDuplicateKeys = 0;

    for (const record of incomingRecords) {
      const recordKey = key(record?.recordKey);
      if (!recordKey) {
        incomingRowsWithoutKey += 1;
        continue;
      }
      if (incomingByKey.has(recordKey)) incomingDuplicateKeys += 1;
      incomingByKey.set(recordKey, Object.assign({}, record));
    }

    if (incomingRowsWithoutKey) {
      throw new Error(
        'Нельзя применить обновление Мобильных бригад: строк без устойчивого recordKey ' +
        incomingRowsWithoutKey + '.'
      );
    }

    const merged = currentRecords.map(record => Object.assign({}, record));
    let matchedKeys = 0;
    let updatedKeys = 0;
    let unchangedKeys = 0;
    let addedKeys = 0;

    for (const [recordKey, record] of incomingByKey.entries()) {
      const indices = currentByKey.get(recordKey) || [];
      if (indices.length) {
        matchedKeys += 1;
        const changed = indices.some(index => !sameRecord(merged[index], record));
        if (changed) updatedKeys += 1;
        else unchangedKeys += 1;
        for (const index of indices) merged[index] = Object.assign({}, record);
      } else {
        addedKeys += 1;
        merged.push(Object.assign({}, record));
      }
    }

    const currentMeta = options.currentMeta || {};
    const incomingMeta = options.incomingMeta || {};
    const freshnessByScope = mergeFreshnessByScope(currentMeta, incomingMeta);
    const sourceFreshness = mergeSourceFreshness(currentMeta, incomingMeta);
    const plan = {
      currentRows: currentRecords.length,
      currentUniqueKeys: currentByKey.size,
      currentRowsWithoutKey,
      currentDuplicateKeys,
      incomingRows: incomingRecords.length,
      incomingUniqueKeys: incomingByKey.size,
      incomingRowsWithoutKey,
      incomingDuplicateKeys,
      matchedKeys,
      updatedKeys,
      unchangedKeys,
      addedKeys,
      untouchedCurrentRows: currentRecords.length - matchedKeys,
      finalRows: merged.length
    };

    return {
      records: merged,
      plan,
      meta: Object.assign({}, incomingMeta, {
        updateMode: 'upsert_by_record_key',
        upsertPlan: plan,
        latestSourceDate: maxDate(currentMeta.latestSourceDate, incomingMeta.latestSourceDate),
        earliestSourceDate: minDate(currentMeta.earliestSourceDate, incomingMeta.earliestSourceDate),
        freshnessByScope,
        sourceFreshness
      }),
      warnings: incomingDuplicateKeys
        ? ['Во входной партии повторяющихся recordKey: ' + incomingDuplicateKeys + '. Использована последняя версия строки.']
        : []
    };
  }

  const api = Object.freeze({
    prepare,
    key,
    mergeFreshnessByScope
  });

  if (typeof globalThis !== 'undefined') globalThis.ReclassifierMobileBrigadeUpsert = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
