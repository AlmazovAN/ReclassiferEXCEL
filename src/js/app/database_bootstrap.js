(() => {
  'use strict';

  function bootstrapLegacyStore() {
    return globalThis.ReclassifierLegacyDatasetStore ||
      globalThis.window?.ReclassifierLegacyDatasetStore ||
      null;
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (item instanceof Map) return Array.from(item.entries());
      if (item instanceof Date) return item.toISOString();
      return item;
    }));
  }

  function bootstrapState(id, instance) {
    const meta = cloneSerializable(instance?.meta || {}) || {};
    const state = {
      schemaVersion: meta.schemaVersion || null,
      sourceType: meta.sourceType || null,
      sourceKind: meta.sourceKind || null,
      sourceRows: meta.sourceRows ?? instance.records.length,
      normalizedRows: meta.normalizedRows ?? instance.records.length
    };

    for (const key of [
      'fields', 'columns', 'fieldCount', 'sourceFileSha256', 'dataFingerprint',
      'processingAsOfDate', 'approvedColumns', 'freshnessByScope',
      'lastImportedRulesVersion', 'itsmLinkContractVersion',
      'format', 'formatLabel', 'candidateRows', 'filteredRows',
      'filteredServiceRows', 'filteredDeactivatedRows', 'filteredSaduRows',
      'filteredUnknownDeactivatedRows', 'filteredUnknownSaduRows',
      'serviceCount', 'equipmentCount', 'elementCount', 'failureCount',
      'causeCount', 'duplicatesRemoved', 'incompleteRows',
      'equipmentHistory', 'reportingCoverage', 'fullDatasetScope',
      'dependencyRevisions'
    ]) {
      if (meta[key] !== undefined) state[key] = meta[key];
    }

    if (id === 'itsm_data' && !Array.isArray(state.fields)) {
      const schema = globalThis.ReclassifierItsmDatasetSchema;
      if (Array.isArray(schema?.fields)) state.fields = Array.from(schema.fields);
      if (Array.isArray(schema?.labels)) state.columns = Array.from(schema.labels);
    }

    if (instance?.joinIndex instanceof Map) {
      state.joinIndex = Array.from(instance.joinIndex.entries())
        .map(([key, value]) => [key, cloneSerializable(value)]);
    }

    return state;
  }

  function bootstrapFreshness(meta = {}) {
    const from = meta.earliestSourceDate || meta.freshnessFrom || null;
    const to = meta.latestRequestDate ||
      meta.latestSourceDate ||
      meta.latestChangedAt ||
      meta.freshnessTo ||
      meta.freshness ||
      null;
    return { from, to };
  }

  function collectSeeds() {
    const store = bootstrapLegacyStore();
    const contract = globalThis.ReclassifierDatabaseContract;
    if (!store || !contract) {
      throw new Error('Стартовый Dataset Store или Database Contract недоступен.');
    }

    const seeds = [];
    const missing = [];
    for (const [id, definition] of Object.entries(contract.datasets)) {
      if (definition.persisted === false) continue;
      const instance = store.get(id);
      if (!instance || !Array.isArray(instance.records)) {
        missing.push(definition.title || id);
        continue;
      }
      if (!definition.allowEmpty && instance.records.length === 0) {
        missing.push((definition.title || id) + ' (пустой)');
        continue;
      }

      const meta = instance.meta || {};
      const freshness = bootstrapFreshness(meta);
      const fullDatasetComplete = Boolean(
        instance.fullDataset &&
        Array.isArray(instance.fullDataset.rows) &&
        instance.fullDataset.rows.length === instance.records.length &&
        meta.fullDatasetScope !== 'incoming-batch' &&
        meta.fullDatasetScope !== 'partial' &&
        instance.fullDataset.coverage !== 'partial'
      );
      const partialFullDataset = Boolean(
        instance.fullDataset &&
        (meta.fullDatasetScope === 'partial' ||
         instance.fullDataset.coverage === 'partial') &&
        Array.isArray(instance.fullDataset.rows) &&
        Array.isArray(instance.fullDataset.recordKeys) &&
        instance.fullDataset.recordKeys.length === instance.fullDataset.rows.length
      );
      if (instance.fullDataset && !fullDatasetComplete && !partialFullDataset &&
          meta.fullDatasetScope !== 'incoming-batch') {
        throw new Error(
          'Dataset «' + id + '»: частичный Full Dataset невозможно перенести без recordKeys.'
        );
      }
      seeds.push({
        id,
        records: instance.records,
        options: {
          freshnessFrom: freshness.from,
          freshnessTo: freshness.to,
          sourceFileName: meta.fileName || ('HTML baseline · ' + (definition.title || id)),
          sourceFingerprint: meta.dataFingerprint || meta.contentHash || null,
          contentHash: meta.dataFingerprint || meta.contentHash || null,
          state: bootstrapState(id, instance),
          fullDataset: fullDatasetComplete || partialFullDataset
            ? instance.fullDataset : null,
          allowSparseFullDataset: partialFullDataset,
          details: {
            bootstrap: 'embedded-html',
            sourceType: meta.sourceType || 'embedded',
            sourceKind: meta.sourceKind || null,
            dataVersion: meta.dataVersion || null,
            fullDatasetScope: instance.fullDataset
              ? (fullDatasetComplete ? 'complete' : (meta.fullDatasetScope || 'partial'))
              : null
          }
        }
      });
    }

    if (missing.length) {
      throw new Error(
        'Нельзя развернуть полную БД: в HTML не готовы стартовые Dataset: ' +
        missing.join(', ') + '.'
      );
    }

    // A new DB starts with revision 1 for every persisted seed. Capture that
    // dependency snapshot immediately so the freshly bootstrapped ITSM/KPI
    // remains semantically identical to the embedded HTML baseline.
    const seedIds = new Set(seeds.map(seed => seed.id));
    for (const seed of seeds) {
      const definition = contract.datasets[seed.id];
      const dependencyIds = Array.from(definition?.dependencies || []);
      if (!dependencyIds.length) continue;
      const state = seed.options.state || {};
      // SQLite creates a NEW registry with revision 1 per seed. Any historical
      // dependencyRevisions from the source SQLite refer to a
      // DIFFERENT registry and must not be inherited into the new database.
      // The content and equipment/source histories remain unchanged.
      seed.options.state = Object.assign({}, state, {
        dependencyRevisions: Object.fromEntries(
          dependencyIds.map(dependencyId => [
            dependencyId,
            seedIds.has(dependencyId) ? 1 : 0
          ])
        )
      });
    }

    return seeds;
  }

  globalThis.ReclassifierDatabaseBootstrap = Object.freeze({
    collectSeeds
  });
})();
