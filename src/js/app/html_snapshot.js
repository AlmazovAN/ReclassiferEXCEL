  const SNAPSHOT_FORMAT_VERSION = 2;
  const SUPPORTED_SNAPSHOT_FORMAT_VERSIONS = new Set([1, 2]);

  // SQLite is the authoritative source whenever connected.
  function snapshotChecksum(bytes) {
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  function snapshotBase64(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 16384) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
    }
    return btoa(chunks.join(''));
  }

  function snapshotBytes(base64) {
    const binary = atob(base64);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  async function snapshotCompress(bytes) {
    if (typeof CompressionStream !== 'function') return { encoding: 'json/base64', bytes };
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return { encoding: 'json/gzip+base64', bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
  }

  async function snapshotDecompress(entry) {
    const bytes = snapshotBytes(entry.payload);
    if (entry.encoding === 'json/base64') return bytes;
    if (entry.encoding !== 'json/gzip+base64' || typeof DecompressionStream !== 'function') {
      throw new Error('Неподдерживаемое кодирование снимка: ' + entry.encoding);
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function snapshotFullDatasetOptions(id) {
    if (id === 'itsm_data') {
      return { packageId: 'itsm-full-dataset', aggregation: 'per-source-row' };
    }
    if (id === 'mobile_brigade_data') {
      return { packageId: 'mobile-brigade-full-dataset', aggregation: 'per-task-row' };
    }
    return {};
  }

  function snapshotFullDataset(instance) {
    if (!instance?.fullDataset) return null;
    const fullDataset = globalThis.ReclassifierFullDatasetContract.validate(
      instance.fullDataset,
      snapshotFullDatasetOptions(instance.id)
    );
    const scope = instance.meta?.fullDatasetScope || fullDataset.coverage ||
      (fullDataset.rows.length === instance.records.length ? 'complete' : 'partial');
    if (scope === 'complete' && fullDataset.rows.length !== instance.records.length) {
      throw new Error(
        'Dataset «' + instance.id + '»: Full Dataset помечен полным, но число строк не совпадает.'
      );
    }
    return { fullDataset, scope };
  }

  function sqliteSnapshotFingerprint() {
    const repository = globalThis.ReclassifierDatabaseRepository;
    if (!repository?.hasOpenDatabase?.()) throw new Error('SQLite не подключена.');
    const info = repository.getDatabaseInfo();
    const registry = repository.listDatasets();
    return JSON.stringify({
      uuid:info?.databaseUuid,
      registry:registry.map(row=>[
        row.dataset_id,row.active_revision,row.content_hash,row.updated_at,row.record_count
      ]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))
    });
  }

  async function buildDatasetPack() {
    const datasets = [];
    const sqlite = globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.() === true;
    const fingerprint = sqlite ? sqliteSnapshotFingerprint() : null;
    for (const registered of datasetStore.list()) {
      const instance = registered.active;
      // Combined is deterministically rebuilt from its five source catalogs.
      if (!instance || registered.id === 'combined' ||
          (!sqlite && instance.meta?.sourceType === 'embedded')) continue;
      const full = snapshotFullDataset(instance);
      const payload = {
        id: registered.id,
        records: instance.records,
        validation: instance.validation,
        meta: instance.meta,
        fullDataset: full?.fullDataset || null
      };
      const raw = new TextEncoder().encode(JSON.stringify(payload));
      const compressed = await snapshotCompress(raw);
      datasets.push({
        id: registered.id,
        kind: registered.kind,
        schemaVersion: registered.schemaVersion,
        dataVersion: instance.meta?.dataVersion || null,
        rowCount: instance.records.length,
        fullDatasetFieldCount: full?.fullDataset?.columns?.length || 0,
        fullDatasetRowCount: full?.fullDataset?.rows?.length || 0,
        fullDatasetScope: full?.scope || null,
        encoding: compressed.encoding,
        checksum: snapshotChecksum(raw),
        payload: snapshotBase64(compressed.bytes)
      });
    }
    if (sqlite && fingerprint !== sqliteSnapshotFingerprint()) {
      throw new Error('SQLite изменилась при подготовке снимка. Повторите операцию.');
    }
    return {
      source: sqlite ? 'sqlite' : 'html',
      sourceFingerprint: fingerprint,
      formatVersion: SNAPSHOT_FORMAT_VERSION,
      appVersion: build.version,
      createdAt: new Date().toISOString(),
      equipmentCombinedRows: datasetStore.get('combined')?.records.length ?? null,
      datasets
    };
  }

  async function prepareSnapshotEntry(entry, known, seen, formatVersion, restoreMode = 'snapshot') {
    const id = String(entry?.id || '');
    const config = known.get(id);
    if (!config || seen.has(id) || id === 'combined' ||
        entry.kind !== config.kind || entry.schemaVersion !== config.schemaVersion) {
      throw new Error('Dataset «' + (id || '—') + '»: ID или версия схемы не соответствуют приложению.');
    }
    seen.add(id);

    let raw;
    try {
      raw = await snapshotDecompress(entry);
    } catch (error) {
      throw new Error('Dataset «' + id + '»: ' + (error?.message || String(error)));
    }
    if (snapshotChecksum(raw) !== entry.checksum) {
      throw new Error('Dataset «' + id + '»: контрольная сумма не совпала.');
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
      throw new Error('Dataset «' + id + '»: JSON снимка повреждён.');
    }
    if (payload.id !== id || !Array.isArray(payload.records) ||
        payload.records.length !== entry.rowCount || !payload.meta || !payload.validation) {
      throw new Error('Dataset «' + id + '»: некорректная структура или количество строк.');
    }

    let fullDataset = null;
    let fullDatasetScope = null;
    if (payload.fullDataset) {
      try {
        fullDataset = globalThis.ReclassifierFullDatasetContract.validate(
          payload.fullDataset,
          snapshotFullDatasetOptions(id)
        );
      } catch (error) {
        throw new Error(
          'Dataset «' + id + '»: Full Dataset повреждён: ' +
          (error?.message || String(error))
        );
      }
      fullDatasetScope = entry.fullDatasetScope || payload.meta?.fullDatasetScope ||
        fullDataset.coverage ||
        (fullDataset.rows.length === payload.records.length ? 'complete' : 'partial');

      if (formatVersion >= 2) {
        if (Number(entry.fullDatasetFieldCount || 0) !== fullDataset.columns.length ||
            Number(entry.fullDatasetRowCount || 0) !== fullDataset.rows.length) {
          throw new Error(
            'Dataset «' + id + '»: метаданные Full Dataset не совпадают с payload.'
          );
        }
      }
      if (fullDatasetScope === 'complete' &&
          fullDataset.rows.length !== payload.records.length) {
        throw new Error(
          'Dataset «' + id + '»: полный Full Dataset не совпадает по числу строк.'
        );
      }
    } else if (formatVersion >= 2 &&
        (Number(entry.fullDatasetFieldCount || 0) !== 0 ||
         Number(entry.fullDatasetRowCount || 0) !== 0 ||
         entry.fullDatasetScope)) {
      throw new Error('Dataset «' + id + '»: Full Dataset отсутствует при наличии метаданных.');
    }

    const restored = {
      id,
      records: payload.records,
      validation: payload.validation,
      meta: {
        ...payload.meta,
        originSourceType: payload.meta.sourceType,
        sourceType: restoreMode
      },
      file: null
    };
    // SQLite equipment imports store a serialized Map of join keys in meta.
    // Recreate that index for consumers of HTML-only Equipment snapshots.
    if (Array.isArray(restored.meta.joinIndex)) {
      if (restored.meta.joinIndex.some(pair => !Array.isArray(pair) || pair.length !== 2)) {
        throw new Error('Dataset «' + id + '»: joinIndex повреждён.');
      }
      restored.joinIndex = new Map(restored.meta.joinIndex);
    }
    if (fullDataset) {
      restored.fullDataset = fullDataset;
      restored.meta.fullDatasetFieldCount = fullDataset.columns.length;
      restored.meta.fullDatasetRows = fullDataset.rows.length;
      restored.meta.fullDatasetScope = fullDatasetScope;
    }
    return restored;
  }

  async function prepareDatasetPackRestore(pack, restoreMode = 'snapshot') {
    const formatVersion = Number(pack?.formatVersion);
    if (!pack || !SUPPORTED_SNAPSHOT_FORMAT_VERSIONS.has(formatVersion) ||
        pack.appVersion !== build.version || !Array.isArray(pack.datasets)) {
      throw new Error('Неподдерживаемый формат или версия снимка данных.');
    }

    const known = new Map(datasetStore.list().map(item => [item.id, item]));
    const seen = new Set();
    const prepared = [];
    for (const entry of pack.datasets) {
      prepared.push(await prepareSnapshotEntry(entry, known, seen, formatVersion, restoreMode));
    }
    return prepared;
  }

  async function restoreDatasetPack(pack, restoreMode = 'snapshot') {
    if (globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.()) {
      throw new Error('Восстановление HTML запрещено при подключённой SQLite.');
    }

    // Phase 1: decompress and validate every Dataset without touching active state.
    const prepared = await prepareDatasetPackRestore(pack, restoreMode);

    // Phase 2: publish all prepared instances in one atomic legacy-store commit.
    globalThis.ReclassifierDatasetLifecycleManager.activateBatch(prepared);
    return prepared.length;
  }

  async function hydrateDatasetPack() {
    const source = document.getElementById('reclassifierDataPack');
    if (!source?.textContent?.trim()) return 0;
    try {
      return await restoreDatasetPack(JSON.parse(source.textContent));
    } catch (error) {
      log('Снимок данных повреждён: ' + (error.message || String(error)) + '.', 'ERROR');
      return 0;
    }
  }

  // HTML application export is independent from current SQLite/legacy Dataset state.
  // Runtime overlays and an existing HTML Dataset pack are intentionally omitted.
  function cloneHtmlForExport() {
    const root = document.documentElement.cloneNode(true);
    const page = root.querySelector('#pageContent');
    if (page) page.textContent = '';
    root.querySelectorAll?.('.nav-item').forEach(item =>
      item.classList.toggle('active', item.dataset.route === 'home'));
    const defaults = [
      ['#pageTitle', 'Главная'],
      ['#pageEyebrow', 'Рабочая область'],
      ['#pageDescription', 'Единая оболочка для обработки Excel-выгрузок.'],
      ['#runtimeState', 'Подготовка…']
    ];
    for (const [selector, value] of defaults) {
      const node = root.querySelector(selector);
      if (node) node.textContent = value;
    }
    const source = root.querySelector('#reclassifierDataPack');
    if (!source) throw new Error('В HTML отсутствует контейнер снимка данных.');
    return { root, source };
  }

  function saveHtmlExport(root, suffix) {
    const html = '<!doctype html>\n' + root.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Reclassifier_v' + String(build.version || 'dev').replaceAll(/[^\w.-]/g, '_') +
      '_' + suffix + '_' + new Date().toISOString().slice(0, 10) + '.html';
    anchor.style.display = 'none';
    try {
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return { bytes: blob.size, fileName: anchor.download };
  }

  function downloadApplicationHtml() {
    if (!state.baselineReady) throw new Error('Дождитесь завершения загрузки стартовых данных.');
    const { root, source } = cloneHtmlForExport();
    // A previously downloaded HTML snapshot may already include a dataset pack.
    // Do not leak that pack or accidentally label its stale rows as SQLite data.
    source.textContent = '';
    const result = saveHtmlExport(root, 'Application');
    log('HTML приложения скачан без текущих изменений SQLite и HTML Dataset: ' +
      result.fileName + ' (' + formatBytes(result.bytes) + ').');
    return Object.freeze({ ...result, mode: 'application' });
  }

  async function synchronizeSqliteToHtml() {
    if (!globalThis.ReclassifierRuntimeDataRepository?.isSqliteAuthoritative?.()) {
      throw new Error('Для синхронизации подключите SQLite.');
    }
    const pack=await buildDatasetPack();
    if (pack.source!=='sqlite' || pack.sourceFingerprint!==sqliteSnapshotFingerprint()) {
      throw new Error('SQLite изменилась. Синхронизация отменена.');
    }
    const prepared=await prepareDatasetPackRestore(pack);
    if (pack.sourceFingerprint!==sqliteSnapshotFingerprint()) {
      throw new Error('SQLite изменилась во время проверки. Синхронизация отменена.');
    }
    datasetPipeline.replaceSqliteMirror(prepared);
    log('SQLite → HTML Dataset Store: синхронизировано '+prepared.length+
      ' наборов, снимок '+pack.createdAt+'.');
    return Object.freeze({count:prepared.length,createdAt:pack.createdAt,source:'sqlite'});
  }

  async function downloadUpdatedHtml() {
    if (!state.baselineReady) throw new Error('Дождитесь завершения загрузки стартовых данных.');
    const pack = await buildDatasetPack();
    // buildDatasetPack validates SQLite revisions before publishing the file.
    const { root, source } = cloneHtmlForExport();
    source.textContent = JSON.stringify(pack).replaceAll('<', '\\u003c');
    const result = saveHtmlExport(root, 'Data');
    log('HTML-снимок скачан: ' + pack.datasets.length + ' наборов; размер ' +
      formatBytes(result.bytes) + '.');
    return Object.freeze({ ...result, count: pack.datasets.length, mode: 'snapshot' });
  }
