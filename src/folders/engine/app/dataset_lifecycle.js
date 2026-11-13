// FILE CONTRACT: neutral Dataset lifecycle manager.
// Purpose: provide one application-level boundary for Dataset prepare/commit/activate/discard
//          operations while Dataset Pipeline remains the low-level state machine.
// Owns: application-level Dataset lifecycle commands, optional load history and file fingerprints.
// Reads: Dataset Pipeline only; callers provide domain-specific processors and instances.
// Writes: Dataset Pipeline through its public low-level API.
// Public API: globalThis.ReclassifierDatasetLifecycleManager.
// Must not: contain Reference, ITSM, Mobile Brigade, Equipment or classifier business rules.
// Related tests: test_dataset_lifecycle_manager.js, test_dataset_pipeline.js,
//                test_architecture_guardrails.py.

  const datasetLifecycleHistory = new Map();

  function datasetLifecycleAction(id, explicit = null) {
    if (explicit) return explicit;
    return datasetPipeline.active(id) ? 'updated' : 'loaded';
  }

  function datasetLifecycleRecordHistory(id, instance, action) {
    const entries = datasetLifecycleHistory.get(id) || [];
    entries.unshift(Object.freeze({
      at: instance?.meta?.loadedAt || new Date().toISOString(),
      fileName: instance?.meta?.fileName || instance?.file?.name || '—',
      fileSize: instance?.meta?.fileSize ?? instance?.file?.size ?? null,
      action: action || 'updated',
      validationStatus: instance?.validation?.status || 'unknown',
      sourceType: instance?.meta?.sourceType || 'user'
    }));
    if (entries.length > 20) entries.length = 20;
    datasetLifecycleHistory.set(id, entries);
  }

  function datasetLifecycleHistoryFor(id) {
    return Object.freeze(Array.from(datasetLifecycleHistory.get(id) || []));
  }

  async function datasetLifecycleFingerprintFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function') {
      throw new Error('Невозможно вычислить fingerprint: источник не является File-подобным объектом.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
    }

    // Deterministic non-cryptographic fallback for file:// / restricted contexts.
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (const value of bytes) {
      h1 ^= value;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= value + ((h1 >>> 16) & 0xff);
      h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  async function datasetLifecyclePrepare(id, files, processor) {
    return datasetPipeline.prepare(id, files, processor);
  }

  function datasetLifecycleCommit(id, options = {}) {
    const action = datasetLifecycleAction(id, options.action || null);
    const instance = datasetPipeline.commit(id);
    if (options.recordHistory === true) {
      datasetLifecycleRecordHistory(id, instance, action);
    }
    return instance;
  }

  function datasetLifecycleActivate(id, instance, options = {}) {
    const action = datasetLifecycleAction(id, options.action || null);
    const active = datasetPipeline.setActive(id, instance);
    if (options.recordHistory === true) {
      datasetLifecycleRecordHistory(id, active, action);
    }
    return active;
  }

  function datasetLifecycleInitialize(id, instance, options = {}) {
    if (datasetPipeline.active(id)) {
      throw new Error('Стартовый Dataset уже инициализирован: ' + id + '.');
    }
    return datasetLifecycleActivate(id, instance, {
      ...options,
      action: options.action || 'loaded'
    });
  }

  function datasetLifecycleActivateBatch(instances) {
    return datasetPipeline.setActiveBatch(instances);
  }

  function datasetLifecycleAssertApplied(instance) {
    const id = instance?.id;
    if (!id || datasetPipeline.active(id) !== instance) {
      throw new Error('Dataset не является активным экземпляром Dataset Pipeline.');
    }
    return instance;
  }

  const datasetLifecycleManager = Object.freeze({
    prepare: datasetLifecyclePrepare,
    commit: datasetLifecycleCommit,
    activate: datasetLifecycleActivate,
    initialize: datasetLifecycleInitialize,
    activateBatch: datasetLifecycleActivateBatch,
    releaseBatch: datasetPipeline.releaseBatch,
    discard: id => datasetPipeline.discard(id),
    state: id => datasetPipeline.get(id),
    active: id => datasetPipeline.active(id),
    candidate: id => datasetPipeline.get(id).candidate,
    assertApplied: datasetLifecycleAssertApplied,
    history: datasetLifecycleHistoryFor,
    fingerprintFile: datasetLifecycleFingerprintFile
  });

  globalThis.ReclassifierDatasetLifecycleManager = datasetLifecycleManager;
