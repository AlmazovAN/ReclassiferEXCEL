  // Low-level Dataset state machine. Application code mutates it through DatasetLifecycleManager.
  // A rejected candidate never changes the active instance.
  function createDatasetPipeline() {
    const entries = new Map();
    const registry = new Map();

    function register(id, config) {
      if (!id || !config?.kind || !config?.schemaVersion) throw new Error('Неполное описание Dataset.');
      if (registry.has(id)) throw new Error('Dataset уже зарегистрирован: ' + id);
      registry.set(id, Object.freeze({ id, kind: config.kind, schemaVersion: config.schemaVersion,
        allowEmpty: config.allowEmpty === true }));
    }

    function requireRegistered(id) {
      if (!registry.has(id)) throw new Error('Dataset не зарегистрирован: ' + id);
      return registry.get(id);
    }

    function entry(id) {
      requireRegistered(id);
      if (!entries.has(id)) entries.set(id, { active: null, candidate: null, revision: 0 });
      return entries.get(id);
    }

    function get(id) {
      const current = entry(id);
      return { active: current.active, candidate: current.candidate };
    }

    function validateActiveInstance(id, instance) {
      const config = requireRegistered(id);
      if (!instance || instance.id !== id || !['valid', 'warning'].includes(instance.validation?.status) ||
          instance.validation?.errors?.length || !Array.isArray(instance.records) ||
          (instance.meta?.schemaVersion && instance.meta.schemaVersion !== config.schemaVersion) ||
          (!config.allowEmpty && !instance.records.length)) {
        throw new Error('Нельзя применить некорректный набор данных.');
      }
      return config;
    }

    function notifyKpiSourceChange(ids) {
      globalThis.ReclassifierKpiAutoRefresh?.request?.('folders-dataset-committed',ids);
    }

    function setActive(id, instance) {
      validateActiveInstance(id, instance);
        const current = entry(id);
      current.revision += 1;
      current.active = instance;
      current.candidate = null;
      notifyKpiSourceChange([id]);
      return instance;
    }

    // Validate the complete batch before publishing any instance. The mutation
    // phase is synchronous and rollback-protected so snapshot restore is all-or-nothing.
    function setActiveBatch(instances) {
      if (!Array.isArray(instances)) throw new Error('Пакет Dataset должен быть массивом.');
      const seen = new Set();
      const prepared = instances.map(instance => {
        const id = instance?.id;
        if (!id || seen.has(id)) throw new Error('Повторный или некорректный Dataset в пакете: ' + (id || '—'));
        seen.add(id);
        validateActiveInstance(id, instance);
        return { id, instance };
      });

  
      // Resolve mutable entries only after the complete batch passed validation.
      for (const item of prepared) item.current = entry(item.id);
      const previous = prepared.map(item => ({
        current: item.current,
        active: item.current.active,
        candidate: item.current.candidate,
        revision: item.current.revision
      }));
      try {
        for (const item of prepared) {
          item.current.revision += 1;
          item.current.active = item.instance;
          item.current.candidate = null;
        }
      } catch (error) {
        for (const snapshot of previous) {
          snapshot.current.active = snapshot.active;
          snapshot.current.candidate = snapshot.candidate;
          snapshot.current.revision = snapshot.revision;
        }
        throw error;
      }
      notifyKpiSourceChange(prepared.map(item => item.id));
      return prepared.map(item => item.instance);
    }

    function releaseBatch(instances) {
      const released = [];
      for (const [id,instance] of instances) {
        const current = entry(id);
        if (current.active !== instance) continue;
        current.active = null;
        released.push(id);
      }
      if (released.length) notifyKpiSourceChange(released);
    }

    async function prepare(id, files, processor) {
      const current = entry(id);
      const revision = ++current.revision;
      current.candidate = null;
      if (!Array.isArray(files) || !files.length) throw new Error('Выберите исходный файл.');
      if (typeof processor !== 'function') throw new Error('Обработчик набора данных не задан.');
      let candidate;
      try {
        candidate = await processor(files);
        if (!candidate || candidate.id !== id || !candidate.validation || !Array.isArray(candidate.records)) {
          throw new Error('Обработчик вернул некорректный набор данных.');
        }
        if (!requireRegistered(id).allowEmpty && !candidate.records.length) {
          candidate.validation = { ...candidate.validation, status: 'invalid',
            errors: [...(candidate.validation.errors || []), 'Для этого набора требуется хотя бы одна запись.'] };
        }
      } catch (error) {
        candidate = {
          id, file: files[0], records: [],
          validation: { status: 'invalid', errors: [error?.message || String(error)], warnings: [] },
          meta: { loadedAt: new Date().toISOString(), fileName: files[0]?.name || '—', sourceType: 'user' }
        };
      }
      // A slower previous operation must not overwrite a newer selection.
      if (revision === current.revision) current.candidate = candidate;
      return candidate;
    }

    function commit(id) {
      const current = entry(id);
      const candidate = current.candidate;
      const config = requireRegistered(id);
      if (!candidate || !['valid', 'warning'].includes(candidate.validation.status) ||
          candidate.validation.errors?.length || (!config.allowEmpty && !candidate.records.length)) {
        throw new Error('Нет проверенного кандидата для применения.');
      }
      return setActive(id, candidate);
    }

    function discard(id) {
      const current = entry(id);
      current.revision += 1;
      current.candidate = null;
    }

    function active(id) { return registry.has(id) ? entry(id).active : null; }
    function list() {
      return Array.from(registry.values(), config => ({ ...config, active: active(config.id) }));
    }

    return Object.freeze({ register, get, active, list, setActive, setActiveBatch, releaseBatch, prepare, commit, discard });
  }


  const datasetPipeline = createDatasetPipeline();
  const runtimeDatasetCatalog = globalThis.ReclassifierDatasetCatalog;
  if (!runtimeDatasetCatalog?.list) {
    throw new Error('Dataset Catalog не загружен до Dataset Pipeline.');
  }
  for (const definition of runtimeDatasetCatalog.list()) {
    datasetPipeline.register(definition.id, {
      kind: definition.kind,
      schemaVersion: definition.schemaVersion,
      allowEmpty: definition.allowEmpty
    });
  }

  const folderDatasetStore = Object.freeze({
    get: id => datasetPipeline.active(id),
    records: id => datasetPipeline.active(id)?.records || [],
    list: () => datasetPipeline.list()
  });

  const datasetStore = folderDatasetStore;

  // Compatibility views read from the active runtime repository.
  function datasetView(ids, selector = instance => instance) {
    return Object.fromEntries(ids.map(id => [id, datasetStore.get(id)])
      .filter(([, instance]) => instance)
      .map(([id, instance]) => [id, selector(instance)]));
  }
  Object.defineProperties(state, {
    references: { configurable: true, get: () => datasetView(Object.keys(referenceConfig)) },
    referenceMeta: { configurable: true, get: () => datasetView(Object.keys(referenceConfig), instance => instance.meta) },
    failureClassifier: { configurable: true, get: () => datasetStore.get('failure_classifier') },
    equipmentCatalogs: { configurable: true, get: () => datasetView(Object.keys(equipmentConfig)) },
    equipmentCombined: { configurable: true, get: () => datasetStore.get('combined') }
  });
  globalThis.ReclassifierDatasetStore = datasetStore;

