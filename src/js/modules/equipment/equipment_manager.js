  const equipmentDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  if (!equipmentDatasetLifecycle) {
    throw new Error('Equipment Manager требует Dataset Lifecycle Manager.');
  }

  function addEquipmentHistory(id, instance, action) {
    if (!state.equipmentHistory[id]) state.equipmentHistory[id] = [];
    state.equipmentHistory[id].unshift({
      at: new Date().toISOString(),
      fileName: instance?.meta?.fileName || '—',
      action,
      status: instance?.validation?.status || 'unknown',
      warnings: instance?.validation?.warnings || []
    });
    if (state.equipmentHistory[id].length > 20) state.equipmentHistory[id].length = 20;
  }

  async function readEquipmentFile(file, expectedId = null, sourceType = 'user') {
    if (!window.XLSX) throw new Error('Excel parser XLSX не включён в сборку.');
    const identified = identifyEquipmentCatalog(file.name);
    if (!identified) throw new Error('Не удалось определить тип каталога по имени файла: ' + file.name);
    if (expectedId && expectedId !== identified.id) {
      throw new Error('Ожидался ' + equipmentConfig[expectedId].title + ', но выбран файл ' + equipmentConfig[identified.id].title + '.');
    }

    const startedAt = performance.now();
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
    const instance = normalizeEquipmentWorkbook(identified.id, workbook, {
      loadedAt: new Date().toISOString(),
      fileName: file.name,
      fileSize: file.size,
      freshness: identified.freshness,
      schemaVersion: equipmentConfig[identified.id].schemaVersion,
      processingMs: null,
      sourceType
    });
    instance.file = sourceType === 'user' ? file : null;
    instance.meta.processingMs = Math.round(performance.now() - startedAt);
    return instance;
  }

  async function inspectEquipmentCombinedControlFile(file) {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
    const match = findEquipmentTable(workbook, EQUIPMENT_LEGACY_COMBINED_COLUMNS);
    if (!match) throw new Error('Equipment_Combined не соответствует базовой схеме итогового справочника.');
    const header = (match.rows[match.headerRowIndex] || []).map(normalizeEquipmentHeader);
    const hasStatus = header.includes(normalizeEquipmentHeader(EQUIPMENT_STATUS_COLUMN));
    let rows = 0;
    for (let i = match.headerRowIndex + 1; i < match.rows.length; i += 1) {
      if (!equipmentRowEmpty(match.rows[i])) rows += 1;
    }
    return { fileName: file.name, rows, columns: hasStatus ? 26 : 25, hasStatus };
  }

  function setEquipmentStagingFiles(fileList) {
    const files = Array.from(fileList || []);
    equipmentDatasetLifecycle.discard('combined');
    state.equipmentStaging = {
      files: files.slice(0, 6), catalogs: {}, combined: null,
      controlCombined: null, processedAt: null,
      messages: files.length > 6 ? ['Выбрано больше шести файлов. В обработку взяты первые 6.'] : []
    };
  }

  function stationaryPartitionKey(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('ru-RU');
  }

  function buildStationaryPartitionCandidate(current, incomingInstances) {
    const field = equipmentConfig.stationary.partitionField || 'unit';
    const partitionLabels = new Map();
    const partitionOwners = new Map();
    const incomingRecords = [];
    const warnings = [];
    let incomingFileSize = 0;

    for (const instance of incomingInstances) {
      const localPartitions = new Map();
      for (let index = 0; index < (instance.records || []).length; index += 1) {
        const record = instance.records[index];
        const raw = record?.[field];
        const key = stationaryPartitionKey(raw);
        if (!key) {
          throw new Error(
            (instance.meta?.fileName || 'Stationary') + ': пустая секция ' +
            field + ' в строке ' + (index + 1) + '.'
          );
        }
        if (!localPartitions.has(key)) localPartitions.set(key, String(raw).trim());
        incomingRecords.push(record);
      }
      for (const [key, label] of localPartitions) {
        const previousOwner = partitionOwners.get(key);
        if (previousOwner) {
          throw new Error(
            'Секция Stationary «' + label + '» присутствует одновременно в файлах «' +
            previousOwner + '» и «' + (instance.meta?.fileName || '—') + '».'
          );
        }
        partitionOwners.set(key, instance.meta?.fileName || '—');
        partitionLabels.set(key, label);
      }
      incomingFileSize += Number(instance.meta?.fileSize || 0);
      warnings.push(...(instance.validation?.warnings || []));
    }

    if (!partitionLabels.size) {
      throw new Error('Stationary: не удалось определить рудники по полю ' + field + '.');
    }

    const preserved = [];
    let replacedRows = 0;
    for (const record of current?.records || []) {
      const key = stationaryPartitionKey(record?.[field]);
      if (partitionLabels.has(key)) replacedRows += 1;
      else preserved.push(record);
    }

    const records = preserved.concat(incomingRecords);
    const seenIds = new Set();
    let duplicateIds = 0;
    for (const record of records) {
      const idKey = equipmentIdKey(record?.id);
      if (!idKey) continue;
      if (seenIds.has(idKey)) duplicateIds += 1;
      else seenIds.add(idKey);
    }
    if (duplicateIds) {
      warnings.push(
        'Повторяющихся Equipment ID после секционной замены Stationary: ' +
        duplicateIds + '.'
      );
    }

    const freshnessValues = [
      current?.meta?.freshness,
      ...incomingInstances.map(instance => instance.meta?.freshness)
    ].filter(Boolean).sort();
    const files = incomingInstances.map(instance => instance.meta?.fileName || '—');

    return {
      id: 'stationary',
      records,
      joinIndex: new Map(),
      validation: {
        status: warnings.length ? 'warning' : 'valid',
        errors: [],
        warnings
      },
      meta: {
        loadedAt: new Date().toISOString(),
        fileName: files.length === 1
          ? files[0]
          : 'CatalogStationaryEquipment (' + files.length + ' файлов)',
        fileSize: incomingFileSize || null,
        freshness: freshnessValues.at(-1) || null,
        schemaVersion: equipmentConfig.stationary.schemaVersion,
        sourceType: 'user',
        sourceRows: records.length,
        normalizedRows: records.length,
        approvedColumns: equipmentConfig.stationary.approvedColumns.slice(),
        partitionField: field,
        replacedPartitions: Array.from(partitionLabels.values()),
        replacedRows,
        preservedRows: preserved.length,
        incomingRows: incomingRecords.length,
        sourceFiles: files,
        duplicateIds
      }
    };
  }

  async function buildEquipmentStaging(staging, files) {
    staging.catalogs = {};
    staging.combined = null;
    staging.controlCombined = null;
    staging.messages = [];
    staging.processedAt = new Date().toISOString();

    if (!files.length) {
      staging.messages.push('Сначала выберите хотя бы один Excel-файл.');
      return staging.messages;
    }
    if (!window.XLSX) {
      staging.messages.push('Excel parser XLSX не включён в сборку.');
      return staging.messages;
    }

    const seen = new Set();
    const scopedCandidates = new Map();
    let hasErrors = false;
    for (const file of files) {
      if (isEquipmentCombinedControlFile(file.name)) {
        if (seen.has('combined_control')) {
          staging.messages.push(file.name + ': второй Equipment_Combined в одной партии не допускается.');
          hasErrors = true;
          continue;
        }
        seen.add('combined_control');
        try {
          staging.controlCombined = await inspectEquipmentCombinedControlFile(file);
          staging.messages.push(file.name + ': контрольный Equipment_Combined распознан (' + staging.controlCombined.rows + ' строк, ' + staging.controlCombined.columns + ' колонок). В расчёт как источник не подставляется.');
        } catch (error) {
          staging.messages.push(file.name + ': ' + (error.message || String(error)));
          hasErrors = true;
        }
        continue;
      }

      const identified = identifyEquipmentCatalog(file.name);
      if (!identified) {
        staging.messages.push(file.name + ': тип Equipment-каталога не распознан.');
        hasErrors = true;
        continue;
      }
      // Multiple files of one source type are supported only when their
      // affected mine scopes do not overlap (checked before publication).

      try {
        const instance = await readEquipmentFile(file, identified.id, 'user');
        if (instance.validation?.status === 'invalid') {
          staging.messages.push(file.name + ': ошибка схемы; рабочий каталог не изменён.');
          hasErrors = true;
          continue;
        }
        if (!scopedCandidates.has(identified.id)) scopedCandidates.set(identified.id, []);
        scopedCandidates.get(identified.id).push(instance);
        staging.messages.push(file.name + ': подготовлено ' + instance.meta.normalizedRows + ' строк.');
      } catch (error) {
        staging.messages.push(file.name + ': ' + (error.message || String(error)));
        hasErrors = true;
      }
    }

    if (!hasErrors && scopedCandidates.size) {
      const partitionApi = globalThis.ReclassifierEquipmentPartitions;
      if (!partitionApi?.merge) {
        staging.messages.push('Сервис секционной замены Equipment недоступен.');
        hasErrors = true;
      } else {
        // Apply Mounted and Stationary first to supply current mine ownership
        // for a Zabbix equipment-id lookup.
        for (const id of EQUIPMENT_SOURCE_IDS) {
          const instances = scopedCandidates.get(id);
          if (!instances?.length) continue;
          try {
            const field = equipmentConfig[id].partitionField;
            const current = state.equipmentCatalogs[id];
            const labels = new Set();
            for (const instance of instances) {
              const sourceLabels = new Set((instance.records || [])
                .map(row => partitionApi.key(row?.[field]))
                .filter(value => value && value !== partitionApi.key(partitionApi.UNKNOWN)));
              for (const label of sourceLabels) {
                if (labels.has(label)) {
                  throw new Error(id + ': одна секция встречается в нескольких файлах.');
                }
                labels.add(label);
              }
            }
            const owners = partitionApi.ownership({
              mounted: staging.catalogs.mounted || state.equipmentCatalogs.mounted,
              stationary: staging.catalogs.stationary || state.equipmentCatalogs.stationary
            });
            const merged = partitionApi.merge(id, current,
              instances.flatMap(instance => instance.records), owners);
            const files = instances.map(instance => instance.meta?.fileName || '—');
            const warnings = instances.flatMap(instance => instance.validation?.warnings || []);
            staging.catalogs[id] = {
              id, records: merged.records, joinIndex: merged.joinIndex,
              validation: {status:warnings.length?'warning':'valid',errors:[],warnings},
              meta: {
                loadedAt:new Date().toISOString(),
                fileName:files.join('; '),
                fileSize:instances.reduce((sum,item)=>sum+Number(item.meta?.fileSize||0),0),
                freshness:instances.map(item=>item.meta?.freshness).filter(Boolean).sort().at(-1) ||
                  current?.meta?.freshness || null,
                schemaVersion:equipmentConfig[id].schemaVersion,
                sourceType:'user',
                sourceRows:merged.records.length,
                normalizedRows:merged.records.length,
                approvedColumns:equipmentConfig[id].approvedColumns.slice(),
                partitionField:merged.partitionField,
                replacedPartitions:merged.replacedPartitions,
                replacedRows:merged.removedRows,
                preservedRows:merged.preservedRows,
                incomingRows:merged.incomingRows,
                sourceFiles:files
              }
            };
            staging.messages.push(id + ': заменяются рудники ' +
              merged.replacedPartitions.join(', ') + '; удалится старых строк ' +
              merged.removedRows + ', будет вставлено ' + merged.incomingRows +
              ', сохранится вне секций ' + merged.preservedRows + '.');
          } catch (error) {
            staging.messages.push(id + ': ' + (error.message || String(error)));
            hasErrors = true;
          }
        }
      }
    }

    if (hasErrors) {
      staging.messages.push('Кандидат не сформирован: исправьте ошибки входных файлов.');
      return staging.messages;
    }

    const candidateCatalogs = {};
    const missing = [];
    for (const id of EQUIPMENT_SOURCE_IDS) {
      const instance = staging.catalogs[id] || state.equipmentCatalogs[id];
      if (!instance || instance.validation?.status === 'invalid') missing.push(equipmentConfig[id].title);
      else candidateCatalogs[id] = instance;
    }
    if (missing.length) {
      staging.messages.push('Для полного пересчёта отсутствуют текущие каталоги: ' + missing.join(', ') + '.');
      return staging.messages;
    }

    staging.combined = buildEquipmentCombinedFromCatalogs(candidateCatalogs, 'staged');
    if (!staging.combined) {
      staging.messages.push('Не удалось сформировать кандидат Equipment_Combined.');
      return staging.messages;
    }
    const changed = Object.keys(staging.catalogs).map(id => equipmentConfig[id].title);
    staging.messages.push('Кандидат рассчитан: ' + staging.combined.records.length + ' строк, ' + EQUIPMENT_COMBINED_COLUMNS.length + ' колонок. Заменяемые источники: ' + (changed.length ? changed.join(', ') : 'нет; выполнен контрольный пересчёт') + '.');
    return staging.messages;
  }

  async function processEquipmentStaging() {
    const staging = state.equipmentStaging;
    const files = Array.from(staging.files || []);
    if (!files.length) {
      staging.messages = ['Сначала выберите хотя бы один Excel-файл.'];
      equipmentDatasetLifecycle.discard('combined');
      return staging.messages;
    }
    const candidate = await equipmentDatasetLifecycle.prepare('combined', files, async () => {
      await buildEquipmentStaging(staging, files);
      if (!staging.combined) throw new Error(staging.messages.join(' '));
      // Source catalogs travel with the combined candidate until the user applies it.
      staging.combined.sourceCatalogCandidates = staging.catalogs;
      return staging.combined;
    });
    if (state.equipmentStaging === staging && candidate.validation?.status === 'invalid') {
      staging.combined = null;
    }
    return staging.messages;
  }

  function commitEquipmentStaging() {
    const staging = state.equipmentStaging;
    const candidate = equipmentDatasetLifecycle.candidate('combined');
    if (!candidate || !staging.combined || candidate !== staging.combined) return false;
    const affected = Object.entries(staging.catalogs).map(([id, item]) =>
      id + ': ' + (item.meta?.replacedPartitions || []).join(', ') +
      ' (будет удалено старых строк: ' + (item.meta?.replacedRows || 0) + ')');
    if (affected.length && !window.confirm(
      'Подтвердите: загруженные файлы содержат ПОЛНЫЙ состав указанных секций.\\n' +
      'Отсутствующие в выгрузках записи этих секций будут удалены.\\n\\n' +
      affected.join('\\n') + '\\n\\nПрименить секционную замену?'
    )) return false;
    // Calculate every history candidate before modifying any active source.
    // The journal is attached to its source Dataset and survives HTML snapshot
    // export instead of living only in the transient UI history array.
    const historyApi = globalThis.ReclassifierEquipmentHistory;
    if (!historyApi?.observe) throw new Error('Equipment History не загружен.');
    const historyTimestamp = new Date().toISOString();
    for (const id of EQUIPMENT_SOURCE_IDS) {
      const incoming = candidate.sourceCatalogCandidates?.[id];
      if (!incoming) continue;
      const previous = state.equipmentCatalogs[id] || null;
      incoming.meta.equipmentHistory = historyApi.observe({
        datasetId:id,
        previousRows:previous?.records || [],
        nextRows:incoming.records,
        previousHistory:previous?.meta?.equipmentHistory || null,
        sections:incoming.meta?.replacedPartitions || [],
        sourceDate:incoming.meta?.freshness || null,
        sourceName:incoming.meta?.fileName || null,
        previousSourceDate:previous?.meta?.freshness || null,
        previousSourceName:previous?.meta?.fileName || null,
        recordedAt:historyTimestamp
      });
    }
    const combined = equipmentDatasetLifecycle.commit('combined');

    for (const id of EQUIPMENT_SOURCE_IDS) {
      const instance = combined.sourceCatalogCandidates[id];
      if (!instance) continue;
      const previous = state.equipmentCatalogs[id];
      equipmentDatasetLifecycle.activate(id, instance);
      addEquipmentHistory(id, instance, previous ? 'updated' : 'loaded');
      log('Equipment: ' + equipmentConfig[id].title + ' — распределено ' + instance.meta.normalizedRows + ' строк.', 'INFO', 'import_export');
    }

    combined.meta.sourceType = 'derived';
    combined.meta.loadedAt = new Date().toISOString();
    addEquipmentHistory('combined', combined, 'rebuilt');

    state.equipmentStaging = {
      files: [],
      catalogs: {},
      combined: null,
      messages: ['Данные распределены. Рабочий Equipment_Combined пересчитан из полного текущего набора источников.'],
      processedAt: new Date().toISOString(),
      controlCombined: null
    };
    return true;
  }

  window.ReclassifierEquipment = Object.freeze({
    list: () => EQUIPMENT_CATALOG_ORDER.map(id => {
      const instance = id === 'combined' ? state.equipmentCombined : state.equipmentCatalogs[id];
      return { id, title: equipmentConfig[id].title, status: equipmentStatusInfo(instance).text, records: instance?.records?.length || 0, freshness: equipmentFreshnessLabel(id, instance) };
    }),
    get: id => datasetStore.get(id),
    records: id => {
      return datasetStore.records(id);
    },
    combined: () => datasetStore.records('combined'),
    rulesVersion: EQUIPMENT_RULES_VERSION,
    history: id => {
      const source = globalThis.ReclassifierRuntimeDataRepository?.get?.(id) ||
        (id === 'combined' ? state.equipmentCombined : state.equipmentCatalogs[id]);
      return source?.meta?.equipmentHistory || null;
    },
    timeline: (id, equipmentId) => globalThis.ReclassifierEquipmentHistory?.timeline(
      window.ReclassifierEquipment.history(id), equipmentId
    ) || [],
    population: options => {
      const histories = {};
      for (const id of globalThis.ReclassifierEquipmentPopulation?.SOURCES || []) {
        histories[id] = window.ReclassifierEquipment.history(id);
      }
      if (!globalThis.ReclassifierEquipmentPopulation) {
        throw new Error('Equipment Population недоступен.');
      }
      return globalThis.ReclassifierEquipmentPopulation.evaluate(histories, options);
    }
  });
