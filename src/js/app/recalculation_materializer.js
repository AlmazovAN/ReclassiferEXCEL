// FILE CONTRACT: pure patch validation and Full Dataset projection for recalculation.
// Reads: ITSM / MB analytical rows, original Full Dataset and preview field deltas.
// Writes: NEW in-memory records only; does not mutate input or persistent storage.
(() => {
  'use strict';
  const MB_EDITABLE = Object.freeze(['itsmCreatedAt']);
  const MB_FULL_LABEL = 'Дата создания вызова ITSM';
  const MB_FULL_LEGACY_LABEL = 'Дата создания заявки ITSM';
  const ITSM_OUTPUT_START = 27;
  const ITSM_SOURCE_FIELDS = 17;

  function key(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
  }

  function serial(value) {
    return JSON.stringify(value);
  }
  function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    }
    return value;
  }

  function fieldsFor(id, storedFields, itsmSchema) {
    if (id === 'mobile_brigade_data') return null;
    if (id !== 'itsm_data') throw new Error('Recalculation: неизвестный Dataset ' + id + '.');
    const standard = Array.from(itsmSchema?.fields || []);
    const fields = Array.from(storedFields || standard);
    if (!standard.length || fields.length !== standard.length ||
        standard.some(name => !fields.includes(name)) ||
        new Set(fields).size !== fields.length) {
      throw new Error('Recalculation: порядок или состав полей ITSM не подтверждён.');
    }
    return fields;
  }

  function canEdit(id, field, itsmSchema) {
    if (id === 'mobile_brigade_data') return MB_EDITABLE.includes(field);
    if (id === 'itsm_data') {
      return Array.from(itsmSchema?.fields || []).slice(ITSM_SOURCE_FIELDS).includes(field);
    }
    return false;
  }

  function originalKey(id, record, fields) {
    if (id === 'mobile_brigade_data') return key(record?.recordKey);
    const numberIndex = fields.indexOf('number');
    return key(Array.isArray(record) ? record[numberIndex] : record?.number);
  }

  function projectFullRow(id, oldRow, columns, changes, itsmSchema) {
    if (!Array.isArray(oldRow) || !Array.isArray(columns) ||
        oldRow.length !== columns.length) {
      throw new Error('Recalculation: повреждена сохранённая строка Full Dataset.');
    }
    let next = null;
    const assign = (column, value) => {
      if (!Number.isInteger(column) || column < 0 || column >= columns.length) return;
      if (!next) next = oldRow.slice();
      next[column] = clone(value);
    };

    for (const [field, delta] of Object.entries(changes)) {
      if (id === 'itsm_data') {
        const index = itsmSchema.fields.indexOf(field);
        const label = itsmSchema.labels[index];
        const expectedIndex = index === itsmSchema.fields.indexOf('mbPresence')
          ? ITSM_OUTPUT_START + itsmSchema.outputFieldCount
          : ITSM_OUTPUT_START + index - ITSM_SOURCE_FIELDS;
        // Full ITSM output occupies a fixed position (AB:BJ). It must NOT
        // search the arbitrary original workbook for matching raw headings.
        if (index >= ITSM_SOURCE_FIELDS && expectedIndex >= ITSM_OUTPUT_START &&
            columns[expectedIndex] === label) {
          assign(expectedIndex, delta.after);
        }
      } else if (id === 'mobile_brigade_data' && field === 'itsmCreatedAt') {
        const matches = [];
        columns.forEach((label, index) => {
          if (label === MB_FULL_LABEL || label === MB_FULL_LEGACY_LABEL) matches.push(index);
        });
        // Never overwrite ambiguous "raw vs generated" duplicate headings.
        if (matches.length === 1) assign(matches[0], delta.after);
      }
    }
    return next || oldRow;
  }

  function validateAndPatch(id, record, change, storedFields, itsmSchema) {
    const fields = fieldsFor(id, storedFields, itsmSchema);
    if (!record || typeof record !== 'object' ||
        (id === 'mobile_brigade_data' && Array.isArray(record)) ||
        (id === 'itsm_data' && Array.isArray(record) &&
         record.length !== fields.length) ||
        !change || !change.fields || typeof change.fields !== 'object' ||
        Array.isArray(change.fields) || !Object.keys(change.fields).length ||
        key(change.key) !== originalKey(id, record, fields)) {
      throw new Error('Recalculation: некорректный ключ/схема изменений для ' + id + '.');
    }
    const next = Array.isArray(record) ? record.slice() : Object.assign({}, record);
    for (const [field, delta] of Object.entries(change.fields)) {
      if (!canEdit(id, field, itsmSchema) || !delta ||
          !Object.prototype.hasOwnProperty.call(delta, 'after') ||
          !Object.prototype.hasOwnProperty.call(delta, 'before') ||
          delta.after === undefined) {
        throw new Error('Recalculation: запрещено изменять исходное/неизвестное поле ' + id + '.' + field + '.');
      }
      const position = fields?.indexOf(field) ?? -1;
      const before = Array.isArray(record) ? record[position] : record[field];
      if (serial(before) !== serial(delta.before)) {
        throw new Error('Recalculation: исходная запись ' + id + '/' + change.key +
          ' изменилась после предпросмотра (' + field + ').');
      }
      if (serial(before) === serial(delta.after)) {
        throw new Error('Recalculation: повторное/пустое изменение ' + id + '.' + field + '.');
      }
      if (Array.isArray(next)) next[position] = clone(delta.after);
      else next[field] = clone(delta.after);
    }
    return next;
  }

  function materialize(id, instance, changes, itsmSchema) {
    if (!instance || !Array.isArray(instance.records) || !Array.isArray(changes)) {
      throw new Error('Recalculation: неизвестный накопленный Dataset.');
    }
    const fields = fieldsFor(id, instance.meta?.fields, itsmSchema);
    const index = new Map();
    instance.records.forEach((row, rowIndex) => {
      const recordKey = originalKey(id, row, fields);
      if (!recordKey || index.has(recordKey)) {
        throw new Error('Recalculation: пустой/дублирующий ключ Dataset ' + id + '.');
      }
      index.set(recordKey, rowIndex);
    });
    const rows = instance.records.slice();
    const full = instance.fullDataset || null;
    const byFullKey = new Map();
    if (full?.rows && full?.columns) {
      if (Array.isArray(full.recordKeys)) {
        if (full.recordKeys.length !== full.rows.length) {
          throw new Error('Recalculation: некорректные recordKeys Full Dataset.');
        }
        full.recordKeys.forEach((value, n) => {
          const k = key(value);
          if (!k || byFullKey.has(k)) throw new Error('Recalculation: повторный ключ Full Dataset.');
          byFullKey.set(k, n);
        });
      } else if (full.rows.length === rows.length && full.coverage !== 'partial') {
        instance.records.forEach((row, n) => byFullKey.set(originalKey(id, row, fields), n));
      } else if (full.rows.length) {
        throw new Error('Recalculation: частичный Full Dataset требует recordKeys.');
      }
    }
    let fullRows = null;
    const seen = new Set();
    for (const change of changes) {
      const k = key(change?.key);
      if (!k || seen.has(k) || !index.has(k) ||
          !Number.isInteger(change.rowIndex) || index.get(k) !== change.rowIndex) {
        throw new Error('Recalculation: ключ/позиция изменённой строки не совпадают с Dataset.');
      }
      seen.add(k);
      rows[index.get(k)] = validateAndPatch(id, rows[index.get(k)],
        change, fields, itsmSchema);
      if (byFullKey.has(k)) {
        const position = byFullKey.get(k);
        const patch = projectFullRow(id, full.rows[position], full.columns,
          change.fields, itsmSchema);
        if (patch !== full.rows[position]) {
          if (!fullRows) fullRows = full.rows.slice();
          fullRows[position] = patch;
        }
      }
    }
    return {
      records: rows,
      fullDataset: fullRows ? Object.assign({}, full, { rows: fullRows }) : full
    };
  }

  const api = Object.freeze({
    version: '1.0.0',
    normalizeKey: key,
    validateAndPatch,
    projectFullRow,
    materialize
  });
  globalThis.ReclassifierRecalculationMaterializer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
