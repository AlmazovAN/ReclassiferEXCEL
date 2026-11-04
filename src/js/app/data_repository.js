// FILE CONTRACT: authoritative runtime Dataset read facade.
// Purpose: present one stable Dataset API while switching between legacy HTML data and
//          an opened authoritative SQLite database.
// Owns: runtime caches, derived Dataset dependency graph and resolvers.
// Reads: ReclassifierDatabaseRepository, DatabaseContract and Legacy Dataset Store.
// Writes: no persistent data; only in-memory caches/derived registrations.
// Public API: globalThis.ReclassifierRuntimeDataRepository including derived rebuild controls.
// Must not: silently fall back to HTML while a SQLite handle is open.
// Related tests: test_runtime_data_repository.js, test_dataset_adapters.js,
//                test_architecture_guardrails.py.

  const runtimeDerivedResolvers = new Map();
  const runtimeSqliteInstanceCache = new Map();
  const runtimeKpiInstanceCache = new Map();
  const runtimeDerivedCache = new Map();
  let runtimeCachedDatabaseInfo = undefined;
  let runtimeCachedRegistry = null;
  const runtimeMetadataInstanceCache = new Map();
  const runtimeDerivedMetadataCache = new Map();
  let runtimeCacheEpoch = 0;
  const runtimeTest13 = () => ['TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(
    globalThis.RECLASSIFIER_BUILD?.testLabel);
  const runtimeTest14 = () => ['TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);

// ============================================================================
// RUNTIME CACHE LIFECYCLE
// ============================================================================
  function runtimeCheckpointCacheState() {
    if(!['TEST_16_PR326','TEST_17_PR332'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel))return;
    let rows=0,fullRows=0;
    const seenRecords=new Set(),seenFullRows=new Set();
    // TEST_17 deliberately shares analytical arrays between Full and KPI
    // views. Count each physically distinct JS array only once.
    for(const cache of [runtimeSqliteInstanceCache,runtimeKpiInstanceCache]){
      for(const entry of cache.values()){
        const records=entry.instance?.records;
        const full=entry.instance?.fullDataset?.rows;
        if(Array.isArray(records)&&!seenRecords.has(records)){
          seenRecords.add(records);rows+=records.length;
        }
        if(Array.isArray(full)&&!seenFullRows.has(full)){
          seenFullRows.add(full);fullRows+=full.length;
        }
      }
    }
    globalThis.ReclassifierDiagnosticV2?.checkpoint?.('runtime-cache-state',{
      runtimeCacheInstances:runtimeSqliteInstanceCache.size+runtimeKpiInstanceCache.size,
      runtimeCacheRows:rows,runtimeCacheFullRows:fullRows
    });
  }
  function runtimeInvalidate(changedDatasetIds = null) {
    runtimeCacheEpoch += 1;
    const changed = Array.isArray(changedDatasetIds)
      ? new Set(changedDatasetIds.filter(Boolean))
      : null;
    if(!runtimeTest13() || !changed) {
      runtimeSqliteInstanceCache.clear();
      runtimeKpiInstanceCache.clear();
      runtimeMetadataInstanceCache.clear();
      runtimeDerivedMetadataCache.clear();
    } else {
      for(const id of changed) {
        runtimeSqliteInstanceCache.delete(id);
        runtimeKpiInstanceCache.delete(id);
        runtimeMetadataInstanceCache.delete(id);
      }
    }
    if (!changed) {
      runtimeDerivedCache.clear();
    } else {
      for (const [id, registration] of runtimeDerivedResolvers.entries()) {
        if (!registration.dependencies.length ||
            registration.dependencies.some(dependencyId => changed.has(dependencyId))) {
          runtimeDerivedCache.delete(id);
          runtimeDerivedMetadataCache.delete(id);
        }
      }
    }
    runtimeCachedDatabaseInfo = undefined;
    runtimeCachedRegistry = null;
    runtimeCheckpointCacheState();
  }

// ============================================================================
// BACKEND SELECTION: LEGACY HTML VS AUTHORITATIVE SQLITE
// ============================================================================
  function runtimeLegacyStore() {
    const store = globalThis.ReclassifierLegacyDatasetStore ||
      globalThis.window?.ReclassifierLegacyDatasetStore ||
      null;
    if (!store) throw new Error('Legacy Dataset Store недоступен.');
    return store;
  }

  function runtimeDatabaseRepository() {
    return globalThis.ReclassifierDatabaseRepository || null;
  }

  function runtimeDatabaseInfo() {
    if (runtimeCachedDatabaseInfo !== undefined) return runtimeCachedDatabaseInfo;
    const repository = runtimeDatabaseRepository();
    // A closed handle is the ONLY condition for legacy HTML fallback.
    // Never mistake an error while reading an open database for "closed".
    if (!repository?.hasOpenDatabase?.()) {
      runtimeCachedDatabaseInfo = null;
      return null;
    }
    let info;
    try {
      info = repository.getDatabaseInfo();
    } catch (error) {
      throw new Error(
        'Открытая Reclassifier.db недоступна: ' + (error?.message || String(error)) +
        '. Автоматическое переключение на HTML Dataset запрещено.'
      );
    }
    if (!info?.valid) {
      throw new Error(
        'Открытая Reclassifier.db не прошла проверку: ' +
        (info?.errors || []).join(' ') +
        ' Использование резервных HTML Dataset запрещено.'
      );
    }
    runtimeCachedDatabaseInfo = info;
    return info;
  }

  function runtimeRegistry() {
    if (runtimeCachedRegistry) return runtimeCachedRegistry;
    const repository = runtimeDatabaseRepository();
    if (!runtimeDatabaseInfo() || !repository) return new Map();
    // A failed registry read must also fail closed, not masquerade as
    // an empty SQLite database or re-enable a legacy fallback.
    let rows;
    try {
      rows = repository.listDatasets();
    } catch (error) {
      throw new Error('Не удалось прочитать Dataset Registry SQLite: ' +
        (error?.message || String(error)));
    }
    runtimeCachedRegistry = new Map(rows.map(row => [row.dataset_id, row]));
    return runtimeCachedRegistry;
  }

  function runtimeIsSqliteAuthoritative() {
    return Boolean(runtimeDatabaseInfo());
  }

  function runtimeDatasetDefinition(id) {
    return globalThis.ReclassifierDatabaseContract?.datasets?.[id] || null;
  }

  function runtimeDependencyStatus(definition, state = {}, memo = new Map(), visiting = new Set()) {
    const dependencies = Array.from(definition?.dependencies || []);
    if (!dependencies.length) {
      return { status: 'not-applicable', current: true, mismatches: [] };
    }

    const id = definition.id || '';
    if (id && memo.has(id)) return memo.get(id);
    if (id && visiting.has(id)) {
      return { status: 'stale', current: false, mismatches: [id] };
    }

    const captured = state?.dependencyRevisions;
    if (!captured || typeof captured !== 'object') {
      const result = { status: 'untracked', current: false, mismatches: dependencies.slice() };
      if (id) memo.set(id, result);
      return result;
    }

    const registry = runtimeRegistry();
    const repository = runtimeDatabaseRepository();
    const nextVisiting = new Set(visiting);
    if (id) nextVisiting.add(id);
    const mismatches = [];

    for (const dependencyId of dependencies) {
      const row = registry.get(dependencyId);
      const actual = Number(row?.active_revision || 0);
      const expected = Number(captured[dependencyId]);
      if (!Number.isFinite(expected) || actual !== expected) {
        mismatches.push(dependencyId);
        continue;
      }

      const dependencyDefinition = runtimeDatasetDefinition(dependencyId);
      if (dependencyDefinition?.dependencies?.length && actual > 0) {
        const dependencyState = repository?.getDatasetState?.(dependencyId) || {};
        const nested = runtimeDependencyStatus(
          Object.assign({ id: dependencyId }, dependencyDefinition),
          dependencyState,
          memo,
          nextVisiting
        );
        if (!nested.current) mismatches.push(dependencyId);
      }
    }

    const result = {
      status: mismatches.length ? 'stale' : 'current',
      current: mismatches.length === 0,
      mismatches: Array.from(new Set(mismatches))
    };
    if (id) memo.set(id, result);
    return result;
  }

  function runtimeRestoreJoinIndex(value) {
    if (!Array.isArray(value)) return new Map();
    return new Map(value.map(entry => [
      entry?.[0],
      entry?.[1]
    ]));
  }

// ============================================================================
// SQLITE DATASET ADAPTERS AND CACHE MATERIALIZATION
// ============================================================================
  let runtimeGetReason='get';
  function runtimeSqliteInstance(id,projection='full') {
    const info = runtimeDatabaseInfo();
    const repository = runtimeDatabaseRepository();
    const definition = runtimeDatasetDefinition(id);
    if (!info || !repository || !definition || definition.persisted === false) return null;

    const registry = runtimeRegistry().get(id) || null;
    if (!registry || Number(registry.active_revision || 0) <= 0) return null;

    const cacheKey = [
      info.databaseUuid || '',
      Number(registry.active_revision || 0),
      registry.updated_at || '',
      registry.content_hash || ''
    ].join('|');
    const fullCached=runtimeSqliteInstanceCache.get(id);
    const cache=projection==='kpi'?runtimeKpiInstanceCache:runtimeSqliteInstanceCache;
    const cached=cache.get(id);
    if(projection==='kpi' && !cached && fullCached?.key===cacheKey) {
      // Keep the already materialized analytical records by reference, but
      // NEVER structured-clone the entire Full Dataset into the KPI Worker.
      const instance={...fullCached.instance};
      if(id==='mobile_brigade_data') {
        delete instance.fullDataset;
      } else if(id==='itsm_data' && instance.fullDataset) {
        const source=instance.fullDataset;
        const normalize=value=>String(value??'').replace(/\u00a0/g,' ')
          .replace(/\s+/g,' ').trim().toLocaleLowerCase('ru-RU');
        const sla=normalize('Просрочен по разрешению');
        const index=source.columns?.findIndex(column=>{
          const value=normalize(column);
          return value===sla || value.startsWith(sla+' ') ||
            value.startsWith(sla+'(');
        })??-1;
        instance.fullDataset=index<0?null:{
          ...source,columns:[source.columns[index]],fieldCount:1,
          rows:source.rows.map(row=>[row[index]])
        };
      }
      cache.set(id,{key:cacheKey,instance});
      runtimeCheckpointCacheState();
      return instance;
    }
    const trace=globalThis.ReclassifierDatabaseMemoryDiagnostics;
    const trace12=['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
    if (cached?.key === cacheKey) {
      if (trace12) trace?.mark?.('runtime-cache','progress',{
        datasetId:id,reason:runtimeGetReason,cacheHits:1,fromCache:1,
        cachedRows:cached.instance?.records?.length||0
      });
      return cached.instance;
    }
    if (trace12) trace?.mark?.('runtime-cache','progress',{
      datasetId:id,reason:runtimeGetReason,cacheMisses:1,fromCache:0
    });
    let payload;
    trace?.mark?.('runtime-sqlite-materialize','start',
      trace12 ? {datasetId:id,reason:runtimeGetReason} : {});
    try {
      const projected=runtimeKpiInstanceCache.get(id);
      if(projection==='full'&&projected?.key===cacheKey &&
          typeof repository.getDatasetFullRows==='function'){
        const full=repository.getDatasetFullRows(id);
        // Both views retain the SAME analytical array. Only the source
        // Full Dataset is read again when the user explicitly needs it.
        payload={...full,records:projected.instance.records};
      } else {
        payload=projection==='kpi'&&typeof repository.getKpiDataset==='function'
          ?repository.getKpiDataset(id):repository.getDataset(id);
      }
      trace?.mark?.('runtime-sqlite-materialize','end',
        {rows:payload?.records?.length||0,
          ...(trace12 ? {datasetId:id,reason:runtimeGetReason,
            fullDatasetRows:payload?.fullDataset?.rows?.length||0,
            fullDatasetColumns:payload?.fullDataset?.columns?.length||0} : {})});
    } catch (error) {
      trace?.mark?.('runtime-sqlite-materialize','error',
        trace12 ? {datasetId:id,reason:runtimeGetReason} : {});
      throw new Error('Ошибка чтения Dataset «' + id + '» из открытой SQLite: ' +
        (error?.message || String(error)));
    }
    if (!Array.isArray(payload?.records) ||
        payload.records.length !== Number(registry.record_count)) {
      throw new Error(
        'Dataset «' + id + '» повреждён: количество записей не соответствует Dataset Registry. ' +
        'Проверьте целостность базы.'
      );
    }

    const state = payload.state || {};
    const dependency = runtimeDependencyStatus(definition, state);
    const meta = Object.assign({}, state, {
      loadedAt: registry.updated_at || null,
      fileName: registry.source_file_name || definition.title || id,
      fileSize: null,
      schemaVersion: registry.dataset_schema_version || definition.schemaVersion || null,
      sourceType: 'sqlite',
      sourceKind: 'sqlite-repository',
      databaseUuid: info.databaseUuid || null,
      activeRevision: Number(registry.active_revision || 0),
      contentHash: registry.content_hash || null,
      normalizedRows: Number(registry.record_count || payload.records?.length || 0),
      sourceRows: Number(state.sourceRows ?? registry.record_count ?? payload.records?.length ?? 0),
      earliestSourceDate: registry.freshness_from || state.earliestSourceDate || null,
      latestSourceDate: registry.freshness_to || state.latestSourceDate || null,
      latestRequestDate: id === 'reclassification'
        ? (registry.freshness_to || state.latestRequestDate || null)
        : (state.latestRequestDate || null),
      freshness: registry.freshness_to || state.freshness || null,
      dependencyStatus: dependency.status,
      dependenciesCurrent: dependency.current,
      dependencyMismatches: dependency.mismatches.slice()
    });

    const dependencyWarnings = dependency.current || dependency.status === 'not-applicable'
      ? []
      : [
          dependency.status === 'untracked'
            ? 'Ревизии зависимостей не зафиксированы; Dataset требуется пересчитать.'
            : 'Зависимости изменились после расчёта Dataset: ' +
              dependency.mismatches.join(', ') + '. Требуется пересчёт.'
        ];

    const instance = {
      id,
      file: null,
      records: Array.isArray(payload.records) ? payload.records : [],
      validation: {
        status: dependencyWarnings.length ? 'warning' : 'valid',
        errors: [],
        warnings: dependencyWarnings
      },
      meta
    };

    if (payload.fullDataset) {
      instance.fullDataset = payload.fullDataset;
      meta.fullDatasetFieldCount = payload.fullDataset.columns?.length ?? null;
      meta.fullDatasetRows = payload.fullDataset.rows?.length ?? 0;
      meta.fullDatasetScope = payload.fullDataset.coverage || null;
    }

    if (id === 'failure_classifier') {
      const records = instance.records;
      const uniqueCount = field => new Set(
        records.map(record => String(record?.[field] ?? '').trim()).filter(Boolean)
      ).size;
      meta.latestChangedAt = registry.freshness_to || state.latestChangedAt || null;
      meta.formatLabel = state.formatLabel || 'SQLite Dataset';
      meta.candidateRows = Number(state.candidateRows ?? records.length);
      meta.filteredRows = Number(state.filteredRows ?? 0);
      meta.serviceCount = Number(state.serviceCount ?? uniqueCount('service'));
      meta.equipmentCount = Number(state.equipmentCount ?? uniqueCount('equipment'));
      meta.elementCount = Number(state.elementCount ?? uniqueCount('element'));
      meta.failureCount = Number(state.failureCount ?? uniqueCount('failure'));
      meta.causeCount = Number(state.causeCount ?? uniqueCount('cause'));
      meta.incompleteRows = Number(state.incompleteRows ?? records.filter(record =>
        !record?.equipment || !record?.element || !record?.failure || !record?.cause
      ).length);
    }

    if (runtimeDatasetDefinition(id)?.kind === 'equipment') {
      instance.joinIndex = runtimeRestoreJoinIndex(state.joinIndex);
    }

    cache.set(id, { key: cacheKey, instance });
    runtimeCheckpointCacheState();
    return instance;
  }

// ============================================================================
// STABLE READ FACADE USED BY SUBJECT MODULES
// ============================================================================
  function runtimeGetForKpi(id) {
    if(!['TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel) ||
        (id!=='itsm_data'&&id!=='mobile_brigade_data'))
      return runtimeGet(id);
    if(!runtimeIsSqliteAuthoritative())
      return runtimeLegacyStore().get(id);
    return runtimeSqliteInstance(id,'kpi');
  }
  function runtimeGet(id) {
    if (!runtimeIsSqliteAuthoritative()) {
      return runtimeLegacyStore().get(id);
    }

    const definition = runtimeDatasetDefinition(id);
    if (!definition) return null;
    if (definition.persisted !== false) {
      return runtimeSqliteInstance(id);
    }

    const registration = runtimeDerivedResolvers.get(id);
    if (!registration || typeof registration.resolver !== 'function') return null;

    const cacheKey = runtimeDerivedCacheKey(registration);
    const cached = runtimeDerivedCache.get(id);
    if (cached?.key === cacheKey) return cached.instance;
    const instance = registration.resolver();
    runtimeDerivedCache.set(id, { key: cacheKey, instance });
    return instance;
  }

  function runtimeRecords(id) {
    return runtimeGet(id)?.records || [];
  }

  function runtimeEmbeddedList() {
    return runtimeLegacyStore().list();
  }

  function runtimeMetadataInstance(id,row) {
    if(!row || Number(row.active_revision||0)<=0)return null;
    const key=[row.active_revision,row.updated_at,row.content_hash].join('|');
    const cached=runtimeSqliteInstanceCache.get(id);
    if(cached?.instance && cached.key.endsWith(key))return cached.instance;
    const lightweight=runtimeMetadataInstanceCache.get(id);
    if(lightweight?.key===key)return lightweight.instance;
    const definition=runtimeDatasetDefinition(id);
    const dependencies=Array.from(definition?.dependencies||[]);
    const state=dependencies.length
      ? (runtimeDatabaseRepository()?.getDatasetState?.(id)||{}) : {};
    const dependency=runtimeDependencyStatus(definition,state);
    const warnings=dependency.current||dependency.status==='not-applicable'
      ? [] : ['Зависимости Dataset требуют проверки или пересчёта.'];
    const instance={
      id,file:null,
      meta:{
        sourceType:'sqlite',sourceKind:'sqlite-repository',
        fileName:row.source_file_name||definition?.title||id,
        activeRevision:Number(row.active_revision||0),
        normalizedRows:Number(row.record_count||0),
        sourceRows:Number(state.sourceRows??row.record_count??0),
        earliestSourceDate:row.freshness_from||null,
        latestRequestDate:row.freshness_to||null,
        freshness:row.freshness_to||null,
        schemaVersion:row.dataset_schema_version||definition?.schemaVersion||null,
        dependencyStatus:dependency.status,
        dependenciesCurrent:dependency.current,
        dependencyMismatches:dependency.mismatches.slice()
      },
      validation:{status:warnings.length?'warning':'valid',errors:[],warnings}
    };
    Object.defineProperty(instance,'records',{
      enumerable:true,get:()=>runtimeGet(id)?.records||[]
    });
    Object.defineProperty(instance,'fullDataset',{
      enumerable:true,get:()=>runtimeGet(id)?.fullDataset||null
    });
    runtimeMetadataInstanceCache.set(id,{key,instance});
    return instance;
  }
  // Metadata-only derived Dataset preview for TEST_14. A consumer asking for
  // records, fullDataset, or detailed metadata still receives the real resolver
  // output. Merely listing the 17 Dataset must never build Equipment_Combined.
  function runtimeDerivedMetadataInstance(id, registration) {
    if (!registration || typeof registration.resolver !== 'function') return null;
    const keys = runtimeRegistry();
    if (registration.dependencies.some(dep => {
      const definition = runtimeDatasetDefinition(dep);
      if (definition?.persisted === false)
        return !runtimeDerivedResolvers.has(dep);
      return Number(keys.get(dep)?.active_revision || 0) <= 0;
    })) return null;
    const cacheKey = runtimeDerivedCacheKey(registration);
    const loaded = runtimeDerivedCache.get(id);
    if (loaded?.key === cacheKey) return loaded.instance;
    const cached = runtimeDerivedMetadataCache.get(id);
    if (cached?.key === cacheKey) return cached.instance;
    const instance = {id, file:null,
      validation:{status:'valid',errors:[],warnings:[]},
      meta:{sourceType:'sqlite',sourceKind:'derived',dependencyStatus:'current',
        dependenciesCurrent:true,dependencyMismatches:[]}
    };
    Object.defineProperty(instance,'records',{enumerable:true,
      get:() => runtimeGet(id)?.records || []});
    Object.defineProperty(instance,'fullDataset',{enumerable:true,
      get:() => runtimeGet(id)?.fullDataset || null});
    runtimeDerivedMetadataCache.set(id,{key:cacheKey,instance});
    globalThis.ReclassifierDatabaseMemoryDiagnostics?.mark?.(
      'runtime-derived-lazy','end',{recordCount:registration.dependencies.length});
    return instance;
  }
  function runtimeList() {
    const trace=globalThis.ReclassifierDatabaseMemoryDiagnostics;
    const traceEnabled=['TEST_12_PR322','TEST_13_PR322','TEST_14_PR322','TEST_15_PR324','TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel);
    const legacyItems=runtimeLegacyStore().list();
    if(!runtimeIsSqliteAuthoritative())return legacyItems;
    if(traceEnabled)trace?.mark?.('runtime-list','start',{recordCount:legacyItems.length});
    const previous=runtimeGetReason;
    runtimeGetReason='list';
    try{
      const rows=runtimeTest13()?runtimeRegistry():null;
      const result=legacyItems.map(item=>{
        const def=runtimeDatasetDefinition(item.id);
        const active=rows && def?.persisted!==false
          ? runtimeMetadataInstance(item.id,rows.get(item.id))
          : (runtimeTest14() && def?.persisted===false
            ? runtimeDerivedMetadataInstance(item.id,runtimeDerivedResolvers.get(item.id))
            : runtimeGet(item.id));
        return Object.assign({},item,{active});
      });
      if(traceEnabled)trace?.mark?.('runtime-list','end',{recordCount:result.length});
      return result;
    }finally{runtimeGetReason=previous;}
  }

  function runtimeSource(id = null) {
    const sqlite = runtimeIsSqliteAuthoritative();
    if (!sqlite) return 'legacy';
    if (!id) return 'sqlite';
    const definition = runtimeDatasetDefinition(id);
    if (!definition) return 'missing';
    if (definition.persisted !== false) {
      const row = runtimeRegistry().get(id);
      return row && Number(row.active_revision || 0) > 0 ? 'sqlite' : 'missing';
    }
    if (runtimeTest14()) {
      const registration=runtimeDerivedResolvers.get(id);
      if (registration) return runtimeDerivedMetadataInstance(id,registration)
        ? 'sqlite' : 'missing';
    }
    return runtimeGet(id) ? 'sqlite' : 'missing';
  }

// ============================================================================
// DERIVED DATASET REGISTRATION AND WRITE-SAFETY GUARD
// ============================================================================
  function runtimeDerivedCacheKey(registration) {
    const info = runtimeDatabaseInfo();
    const registry = runtimeRegistry();
    const dependencyIds = registration.dependencies.length
      ? registration.dependencies
      : Array.from(registry.keys());
    const signature = dependencyIds.map(dependencyId => {
      const row = registry.get(dependencyId);
      return dependencyId + ':' +
        Number(row?.active_revision || 0) + ':' +
        (row?.updated_at || '');
    }).join('|');
    return (info?.databaseUuid || '') + '|' + signature;
  }

  function runtimeAssertDerivedDependencies(id, registration) {
    const missing = registration.dependencies.filter(dependencyId => {
      const definition = runtimeDatasetDefinition(dependencyId);
      if (definition?.persisted === false) return runtimeGet(dependencyId) === null;
      const row = runtimeRegistry().get(dependencyId);
      return !row || Number(row.active_revision || 0) <= 0;
    });
    if (missing.length) {
      runtimeDerivedCache.delete(id);
      throw new Error(
        'Нельзя пересчитать derived Dataset «' + id +
        '»: отсутствуют активные зависимости ' + missing.join(', ') + '.'
      );
    }
  }

  function runtimeRegisterDerived(id, resolver, options = {}) {
    if (!id || typeof resolver !== 'function') {
      throw new Error('Некорректный derived Dataset resolver.');
    }
    const definition = runtimeDatasetDefinition(id);
    if (!definition || definition.persisted !== false) {
      throw new Error('Derived resolver можно зарегистрировать только для DERIVED Dataset: ' + id + '.');
    }
    const dependencies = Array.from(
      options.dependencies || definition.dependencies || []
    );
    for (const dependencyId of dependencies) {
      if (!runtimeDatasetDefinition(dependencyId)) {
        throw new Error(
          'Неизвестная зависимость derived Dataset ' + id + ': ' + dependencyId + '.'
        );
      }
    }
    runtimeCacheEpoch += 1;
    runtimeDerivedResolvers.set(id, Object.freeze({
      resolver,
      dependencies: Object.freeze(dependencies)
    }));
    runtimeDerivedCache.delete(id);
    runtimeDerivedMetadataCache.delete(id);
  }

  function runtimeRefreshDerived(changedDatasetIds = null, preparedCandidates = null) {
    if (!runtimeIsSqliteAuthoritative()) return Object.freeze([]);
    const changed = Array.isArray(changedDatasetIds)
      ? new Set(changedDatasetIds.filter(Boolean))
      : null;
    const candidates = preparedCandidates && typeof preparedCandidates === 'object'
      ? preparedCandidates
      : {};
    const rebuilt = [];

    for (const [id, registration] of runtimeDerivedResolvers.entries()) {
      if (changed && registration.dependencies.length &&
          !registration.dependencies.some(dependencyId => changed.has(dependencyId))) {
        continue;
      }

      runtimeAssertDerivedDependencies(id, registration);
      let instance = candidates[id] || null;
      let prepared = false;
      if (instance) {
        runtimeDerivedCache.set(id, {
          key: runtimeDerivedCacheKey(registration),
          instance
        });
        prepared = true;
      } else {
        runtimeDerivedCache.delete(id);
        instance = runtimeGet(id);
      }
      if (!instance) {
        throw new Error('Не удалось пересчитать derived Dataset «' + id + '».');
      }
      runtimeCacheEpoch += 1;
      rebuilt.push(Object.freeze({
        id,
        dependencies: registration.dependencies.slice(),
        records: Array.isArray(instance.records) ? instance.records.length : 0,
        prepared
      }));
    }

    return Object.freeze(rebuilt);
  }

  function runtimeAssertLegacyWriteAllowed() {
    if (runtimeIsSqliteAuthoritative()) {
      throw new Error(
        'Подключена Reclassifier.db. SQLite является активным источником данных; ' +
        'для изменения Dataset используйте раздел «Работа с базой данных».'
      );
    }
  }

  // Cached metadata stamp: never revalidates the whole SQLite file or touches
  // Dataset records on a KPI hot-cache hit. Invalidate() bumps the epoch on
  // every in-app SQLite change and database replacement.
  function runtimeSnapshotCacheStamp() {
    if (!runtimeTest14() || !runtimeIsSqliteAuthoritative()) return null;
    const info=runtimeDatabaseInfo();
    const rows=Array.from(runtimeRegistry().values()).sort((a,b)=>
      String(a.dataset_id).localeCompare(String(b.dataset_id)));
    return JSON.stringify([info.databaseUuid,runtimeCacheEpoch,
      rows.map(row=>[row.dataset_id,row.active_revision,row.updated_at,
        row.content_hash,row.record_count])]);
  }

  globalThis.ReclassifierRuntimeDataRepository = Object.freeze({
    mode: () => runtimeIsSqliteAuthoritative() ? 'sqlite' : 'legacy',
    source: runtimeSource,
    get: runtimeGet,
    getForKpi: runtimeGetForKpi,
    records: runtimeRecords,
    list: runtimeList,
    embeddedList: runtimeEmbeddedList,
    registerDerived: runtimeRegisterDerived,
    refreshDerived: runtimeRefreshDerived,
    invalidate: runtimeInvalidate,
    cacheEpoch: () => runtimeCacheEpoch,
    cacheSnapshotStamp: runtimeSnapshotCacheStamp,
    isSqliteAuthoritative: runtimeIsSqliteAuthoritative,
    assertLegacyWriteAllowed: runtimeAssertLegacyWriteAllowed
  });
