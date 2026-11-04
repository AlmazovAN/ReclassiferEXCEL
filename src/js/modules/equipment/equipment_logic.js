  const equipmentLogicDatasetLifecycle = globalThis.ReclassifierDatasetLifecycleManager;
  if (!equipmentLogicDatasetLifecycle) {
    throw new Error('Equipment Logic требует Dataset Lifecycle Manager.');
  }

  function normalizeEquipmentHeader(value) {
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
  }

  function normalizeEquipmentText(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    return text === '' ? null : text;
  }

  function equipmentDateFromValue(value, withTime = false) {
    if (value === null || value === undefined || value === '') return null;
    let parts = null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      parts = {
        y: value.getFullYear(), m: value.getMonth() + 1, d: value.getDate(),
        H: value.getHours(), M: value.getMinutes(), S: value.getSeconds()
      };
    } else if (typeof value === 'number' && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      parts = window.XLSX.SSF.parse_date_code(value);
    }
    if (!parts?.y || !parts?.m || !parts?.d) return normalizeEquipmentText(value);
    const date = String(parts.y).padStart(4, '0') + '-' + String(parts.m).padStart(2, '0') + '-' + String(parts.d).padStart(2, '0');
    if (!withTime) return date;
    return date + ' ' + String(parts.H || 0).padStart(2, '0') + ':' + String(parts.M || 0).padStart(2, '0') + ':' + String(Math.round(parts.S || 0)).padStart(2, '0');
  }

  function equipmentHasValue(value) {
    if (value === null || value === undefined) return false;
    return String(value).replace(/\u00a0/g, ' ').trim() !== '';
  }

  function equipmentDateRecognized(value) {
    if (!equipmentHasValue(value)) return true;
    if (value instanceof Date) return !Number.isNaN(value.getTime());
    if (typeof value === 'number' && Number.isFinite(value) && window.XLSX?.SSF?.parse_date_code) {
      const parts = window.XLSX.SSF.parse_date_code(value);
      return Boolean(parts?.y && parts?.m && parts?.d);
    }
    const text = normalizeEquipmentText(value);
    if (!text) return true;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
    if (match) {
      const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }
    match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s.*)?$/);
    if (match) {
      const d = Number(match[1]), m = Number(match[2]), y = Number(match[3]);
      const date = new Date(Date.UTC(y, m - 1, d));
      return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }
    return false;
  }

  function equipmentOperationalStatus(notWorkingSince) {
    return equipmentHasValue(notWorkingSince) ? 'Не активен' : 'Активен';
  }

  function equipmentFieldValue(raw, outputField) {
    if (['not_working_since', 'commissioning_date'].includes(outputField)) return equipmentDateFromValue(raw, false);
    if (outputField === 'zabbix__update') return equipmentDateFromValue(raw, true);
    if (outputField === 'id' || outputField.endsWith('__id')) {
      if (raw === null || raw === undefined || raw === '') return null;
      return String(raw).trim();
    }
    return normalizeEquipmentText(raw);
  }

  function equipmentJoinKey(unit, name) {
    const a = normalizeEquipmentHeader(unit);
    const b = normalizeEquipmentHeader(name);
    return a && b ? a + '\u001f' + b : null;
  }

  function equipmentIdKey(value) {
    const text = normalizeEquipmentText(value);
    return text ? text.replace(/\.0$/, '') : null;
  }

  function identifyEquipmentCatalog(fileName) {
    const name = String(fileName || '').split(/[\\/]/).pop();
    for (const id of ['transport_start_points', 'mounted', 'stationary', 'zabbix', 'transport']) {
      const match = name.match(equipmentConfig[id].filePattern);
      if (match) {
        const dateMatch = name.match(/(20\d{2}-\d{2}-\d{2})/);
        return { id, freshness: dateMatch?.[1] || null };
      }
    }
    return null;
  }

  function isEquipmentCombinedControlFile(fileName) {
    const name = String(fileName || '').split(/[\\/]/).pop();
    return /^Equipment[_\s-]*Combined/i.test(name);
  }

  function findEquipmentTable(workbook, requiredHeaders) {
    const required = requiredHeaders.map(normalizeEquipmentHeader);
    for (const sheetName of workbook.SheetNames) {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
      for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex += 1) {
        const header = (rows[rowIndex] || []).map(normalizeEquipmentHeader);
        if (!required.every(item => header.includes(item))) continue;
        const positions = {};
        header.forEach((item, index) => { if (item && positions[item] === undefined) positions[item] = index; });
        return { sheetName, rows, headerRowIndex: rowIndex, positions };
      }
    }
    return null;
  }

  function rawEquipmentValue(row, positions, header) {
    const index = positions[normalizeEquipmentHeader(header)];
    return index === undefined ? null : row[index];
  }

  function equipmentRowEmpty(row) {
    return !row || row.every(value => value === null || value === undefined || String(value).trim() === '');
  }

  function normalizeEquipmentWorkbook(catalogId, workbook, fileMeta) {
    const config = equipmentConfig[catalogId];
    const match = findEquipmentTable(workbook, config.requiredHeaders);
    if (!match) {
      return {
        id: catalogId,
        records: [],
        joinIndex: new Map(),
        validation: { status: 'invalid', errors: ['Не найден ожидаемый набор колонок для ' + config.title + '.'], warnings: [] },
        meta: Object.assign({}, fileMeta, { sourceRows: 0, normalizedRows: 0, approvedColumns: config.approvedColumns.slice() })
      };
    }

    const records = [];
    const joinIndex = new Map();
    const warnings = [];
    const partitionApi = globalThis.ReclassifierEquipmentPartitions;
    const ownerMap = partitionApi?.ownership({
      mounted: globalThis.ReclassifierRuntimeDataRepository?.get?.('mounted') ||
        state.equipmentCatalogs?.mounted,
      stationary: globalThis.ReclassifierRuntimeDataRepository?.get?.('stationary') ||
        state.equipmentCatalogs?.stationary
    }) || new Map();
    const seenIds = new Set();
    let sourceRows = 0;
    let duplicateIds = 0;
    let duplicateJoinKeys = 0;
    let invalidNotWorkingSince = 0;

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.rows.length; rowIndex += 1) {
      const row = match.rows[rowIndex] || [];
      if (equipmentRowEmpty(row)) continue;
      sourceRows += 1;

      if (catalogId === 'mounted' || catalogId === 'stationary') {
        const record = { source_catalog: config.sourceCatalog };
        for (const field of config.approvedColumns) {
          if (field === 'source_catalog') continue;
          record[field] = equipmentFieldValue(rawEquipmentValue(row, match.positions, field), field);
        }
        const rawNotWorkingSince = rawEquipmentValue(row, match.positions, 'not_working_since');
        if (equipmentHasValue(rawNotWorkingSince) && !equipmentDateRecognized(rawNotWorkingSince)) invalidNotWorkingSince += 1;
        const idKey = equipmentIdKey(record.id);
        if (idKey && seenIds.has(idKey)) duplicateIds += 1;
        if (idKey) seenIds.add(idKey);
        records.push(record);
        continue;
      }

      if (catalogId === 'transport') {
        const record = {
          transport__id: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'id'), 'transport__id'),
          transport__transport_type: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'transport_type'), 'transport__transport_type'),
          transport__description: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'description'), 'transport__description'),
          transport__location: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'location'), 'transport__location'),
          transport__self_moving_type: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'self_moving_type'), 'transport__self_moving_type'),
          // Persist join provenance for later mine-scoped replacements. These
          // two source fields are NOT published in Equipment_Combined.
          unit: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'unit'), 'unit'),
          name: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'name'), 'name')
        };
        records.push(record);
        const key = equipmentJoinKey(rawEquipmentValue(row, match.positions, 'unit'), rawEquipmentValue(row, match.positions, 'name'));
        if (key) {
          if (joinIndex.has(key)) duplicateJoinKeys += 1;
          else joinIndex.set(key, record);
        }
        continue;
      }

      if (catalogId === 'transport_start_points') {
        const unit = equipmentFieldValue(rawEquipmentValue(row, match.positions, 'unit'), 'unit');
        const name = equipmentFieldValue(rawEquipmentValue(row, match.positions, 'name'), 'name');
        // Before PR8 this source persisted an index but zero records, so
        // a scoped replace could not preserve old sections. These lightweight
        // records now keep its original unit/name without public columns.
        records.push({unit,name});
        const key = equipmentJoinKey(unit, name);
        if (key) {
          if (joinIndex.has(key)) duplicateJoinKeys += 1;
          else joinIndex.set(key, true);
        }
        continue;
      }

      if (catalogId === 'zabbix') {
        const record = {
          zabbix__id: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'id'), 'zabbix__id'),
          zabbix__name: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'name'), 'zabbix__name'),
          zabbix__site_address_b: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'site_address_b'), 'zabbix__site_address_b'),
          zabbix__site_address_c: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'site_address_c'), 'zabbix__site_address_c'),
          zabbix__zabbix_equipment_type__name: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'zabbix_equipment_type__name'), 'zabbix__zabbix_equipment_type__name'),
          zabbix__update: equipmentFieldValue(rawEquipmentValue(row, match.positions, 'update'), 'zabbix__update'),
          equipment: equipmentIdKey(rawEquipmentValue(row, match.positions, 'equipment')),
          __partition_unit: null
        };
        record.__partition_unit = ownerMap.get(record.equipment) ||
          partitionApi?.UNKNOWN || '__equipment_unresolved_scope__';
        records.push(record);
        const equipmentKey = equipmentIdKey(rawEquipmentValue(row, match.positions, 'equipment'));
        if (equipmentKey) {
          if (!joinIndex.has(equipmentKey)) joinIndex.set(equipmentKey, []);
          joinIndex.get(equipmentKey).push(record);
        }
      }
    }

    if (!fileMeta.freshness) warnings.push('Дата свежести не распознана из имени файла.');
    if (duplicateIds) warnings.push('Повторяющихся ID: ' + duplicateIds + '.');
    if (duplicateJoinKeys && catalogId !== 'zabbix') warnings.push('Повторяющихся ключей связи: ' + duplicateJoinKeys + '. Использована первая запись.');
    if (invalidNotWorkingSince) warnings.push('not_working_since: значений, не распознанных как дата: ' + invalidNotWorkingSince + '. Статус рассчитан по факту непустого значения.');

    return {
      id: catalogId,
      records,
      joinIndex,
      validation: { status: warnings.length ? 'warning' : 'valid', errors: [], warnings },
      meta: Object.assign({}, fileMeta, {
        sourceSheet: match.sheetName,
        sourceRows,
        normalizedRows: records.length,
        approvedColumns: config.approvedColumns.slice(),
        duplicateIds,
        duplicateJoinKeys,
        invalidNotWorkingSince
      })
    };
  }

  function aggregateZabbixRecords(records) {
    const result = {};
    for (const field of equipmentConfig.zabbix.approvedColumns) {
      const values = [];
      const seen = new Set();
      for (const record of records || []) {
        const value = normalizeEquipmentText(record[field]);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        values.push(value);
      }
      result[field] = values.length ? values.join(' / ') : null;
    }
    return result;
  }

  function buildEquipmentCombinedFromCatalogs(catalogs, sourceType = 'derived') {
    const mounted = catalogs.mounted;
    const stationary = catalogs.stationary;
    const transport = catalogs.transport;
    const zabbix = catalogs.zabbix;
    const baseInstances = [stationary, mounted].filter(instance => instance && instance.validation?.status !== 'invalid');

    if (!baseInstances.length) return null;

    const records = [];
    let transportCandidates = 0;
    let transportMatches = 0;
    let zabbixEquipmentMatches = 0;
    const baseIds = new Set();
    let duplicateBaseIds = 0;

    const appendBase = (instance, isMounted) => {
      for (const source of instance.records || []) {
        const record = {};
        for (const field of EQUIPMENT_COMBINED_COLUMNS) record[field] = source[field] ?? null;
        record[EQUIPMENT_STATUS_COLUMN] = equipmentOperationalStatus(source.not_working_since);

        const idKey = equipmentIdKey(source.id);
        if (idKey && baseIds.has(idKey)) duplicateBaseIds += 1;
        if (idKey) baseIds.add(idKey);

        if (isMounted && source.unit && source.transport) {
          transportCandidates += 1;
          const transportKey = equipmentJoinKey(source.unit, source.transport);
          const transportRecord = transport?.joinIndex?.get(transportKey);
          if (transportRecord) {
            transportMatches += 1;
            for (const field of equipmentConfig.transport.approvedColumns) record[field] = transportRecord[field] ?? null;
          }
        }

        const zabbixRows = idKey ? zabbix?.joinIndex?.get(idKey) : null;
        if (zabbixRows?.length) {
          zabbixEquipmentMatches += 1;
          Object.assign(record, aggregateZabbixRecords(zabbixRows));
        }
        records.push(record);
      }
    };

    if (stationary) appendBase(stationary, false);
    if (mounted) appendBase(mounted, true);

    const warnings = [];
    if (duplicateBaseIds) warnings.push('Повторяющихся Equipment ID после вертикального объединения: ' + duplicateBaseIds + '.');
    const sourceInstances = EQUIPMENT_SOURCE_IDS.map(id => catalogs[id]).filter(Boolean);
    const inheritedWarnings = sourceInstances.flatMap(instance => instance.validation?.warnings || []);
    if (inheritedWarnings.length) warnings.push('В одном или нескольких исходных каталогах есть предупреждения.');

    const allEmbedded = sourceInstances.length === EQUIPMENT_SOURCE_IDS.length &&
      sourceInstances.every(instance => instance.meta?.sourceType === 'embedded');
    const freshnessValues = sourceInstances.map(instance => instance.meta?.freshness).filter(Boolean).sort();
    return {
      id: 'combined',
      records,
      joinIndex: new Map(),
      validation: { status: warnings.length ? 'warning' : 'valid', errors: [], warnings },
      meta: {
        loadedAt: new Date().toISOString(),
        fileName: 'Equipment_Combined.xlsx',
        fileSize: null,
        sourceRows: records.length,
        normalizedRows: records.length,
        schemaVersion: EQUIPMENT_RULES_VERSION,
        approvedColumns: EQUIPMENT_COMBINED_COLUMNS.slice(),
        freshness: freshnessValues.length ? freshnessValues[freshnessValues.length - 1] : null,
        freshnessLabel: 'составная',
        sourceType: sourceType === 'staged' ? 'staged' : (allEmbedded ? 'embedded' : 'derived'),
        transportCandidates,
        transportMatches,
        transportUnmatched: Math.max(0, transportCandidates - transportMatches),
        zabbixEquipmentMatches,
        duplicateBaseIds,
        sourceCatalogs: EQUIPMENT_SOURCE_IDS.map(id => {
          const instance = catalogs[id];
          return { id, fileName: instance?.meta?.fileName || null, freshness: instance?.meta?.freshness || null };
        })
      }
    };
  }

  function rebuildEquipmentCombined() {
    const combined = buildEquipmentCombinedFromCatalogs(state.equipmentCatalogs, 'derived');
    if (combined) equipmentLogicDatasetLifecycle.activate('combined', combined);
    return combined;
  }


  function buildRuntimeEquipmentCombined() {
    const repository = globalThis.ReclassifierRuntimeDataRepository;
    if (!repository?.isSqliteAuthoritative?.()) return null;

    const catalogs = {};
    for (const id of EQUIPMENT_SOURCE_IDS) {
      const instance = repository.get(id);
      if (!instance) return null;
      catalogs[id] = instance;
    }

    const combined = buildEquipmentCombinedFromCatalogs(catalogs, 'sqlite');
    if (combined) {
      combined.meta.sourceType = 'sqlite';
      combined.meta.fileName = 'Equipment_Combined · Reclassifier.db';
    }
    return combined;
  }

  globalThis.ReclassifierRuntimeDataRepository?.registerDerived?.(
    'combined',
    buildRuntimeEquipmentCombined
  );
