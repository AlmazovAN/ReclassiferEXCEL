// FILE CONTRACT: central registry of Dataset field identities and presentation metadata.
// Purpose: decouple stable stored field keys from semantic aliases and user-facing labels.
// Owns: field metadata lookup and alias resolution per Dataset.
// Reads: no UI/module state.
// Writes: no application state or persistence.
// Public API: globalThis.ReclassifierFieldRegistry.
// Must not: rename persisted record keys, mutate Dataset rows, or contain calculation logic.

(() => {
  'use strict';

  const datasets = new Map();

  function freezeStringArray(values) {
    return Object.freeze(Array.from(values || [], value => String(value)));
  }

  function normalizeDefinition(datasetId, input) {
    const field = String(input?.field || '').trim();
    const semanticName = String(input?.semanticName || field).trim();
    const sourceLabel = String(input?.sourceLabel || '').trim();
    const label = String(input?.label || sourceLabel || semanticName || field).trim();
    const aliases = freezeStringArray(input?.aliases || []);

    if (!datasetId || !field || !semanticName || !label) {
      throw new Error('Field Registry: incomplete field definition for ' + String(datasetId || 'unknown') + '.');
    }

    return Object.freeze({
      datasetId,
      field,
      semanticName,
      sourceLabel: sourceLabel || null,
      label,
      aliases
    });
  }

  function registerDataset(datasetId, definitions) {
    const id = String(datasetId || '').trim();
    if (!id) throw new Error('Field Registry: datasetId is required.');
    if (datasets.has(id)) throw new Error('Field Registry: Dataset already registered: ' + id + '.');

    const byField = new Map();
    const byName = new Map();
    const list = [];

    for (const input of definitions || []) {
      const definition = normalizeDefinition(id, input);
      if (byField.has(definition.field)) {
        throw new Error('Field Registry: duplicate field ' + id + '.' + definition.field + '.');
      }

      const names = [definition.field, definition.semanticName, ...definition.aliases]
        .map(value => String(value || '').trim())
        .filter(Boolean);

      for (const name of names) {
        const existing = byName.get(name);
        if (existing && existing.field !== definition.field) {
          throw new Error('Field Registry: duplicate alias "' + name + '" in Dataset ' + id + '.');
        }
        byName.set(name, definition);
      }

      byField.set(definition.field, definition);
      list.push(definition);
    }

    const datasetRegistry = Object.freeze({
      id,
      fields: Object.freeze(list),
      byField,
      byName
    });
    datasets.set(id, datasetRegistry);
    return datasetRegistry;
  }

  function getDataset(datasetId) {
    const registry = datasets.get(String(datasetId || '').trim());
    if (!registry) throw new Error('Field Registry: Dataset is not registered: ' + String(datasetId || 'unknown') + '.');
    return registry;
  }

  function get(datasetId, field) {
    const definition = getDataset(datasetId).byField.get(String(field || '').trim());
    if (!definition) {
      throw new Error('Field Registry: field is not registered: ' + datasetId + '.' + String(field || 'unknown') + '.');
    }
    return definition;
  }

  function resolve(datasetId, name) {
    const definition = getDataset(datasetId).byName.get(String(name || '').trim());
    if (!definition) {
      throw new Error('Field Registry: name is not registered: ' + datasetId + '.' + String(name || 'unknown') + '.');
    }
    return definition;
  }

  function resolveField(datasetId, name) {
    return resolve(datasetId, name).field;
  }

  function createAccessor(datasetId, fields) {
    const fieldList = Array.from(fields || [], value => String(value));
    const indexByField = new Map(fieldList.map((field, index) => [field, index]));

    function definition(name) {
      return resolve(datasetId, name);
    }

    function index(name) {
      const field = definition(name).field;
      const fieldIndex = indexByField.get(field);
      if (fieldIndex === undefined) {
        throw new Error('Field Registry: field is absent from active schema: ' + datasetId + '.' + field + '.');
      }
      return fieldIndex;
    }

    function value(row, name) {
      if (!Array.isArray(row)) {
        throw new Error('Field Registry: record must be an array for Dataset ' + datasetId + '.');
      }
      return row[index(name)];
    }

    function column(records, name) {
      const fieldIndex = index(name);
      return Array.from(records || [], row => Array.isArray(row) ? row[fieldIndex] : undefined);
    }

    return Object.freeze({
      datasetId,
      field: name => definition(name).field,
      semanticName: name => definition(name).semanticName,
      label: name => definition(name).label,
      index,
      value,
      column
    });
  }

  function list(datasetId) {
    return getDataset(datasetId).fields;
  }

  function hasDataset(datasetId) {
    return datasets.has(String(datasetId || '').trim());
  }

  globalThis.ReclassifierFieldRegistry = Object.freeze({
    registerDataset,
    getDataset,
    get,
    resolve,
    resolveField,
    createAccessor,
    list,
    hasDataset
  });
})();
