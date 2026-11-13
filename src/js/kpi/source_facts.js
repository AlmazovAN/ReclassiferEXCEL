// FILE CONTRACT: pure KPI source-fact projection.
// Purpose: interpret already-processed Dataset fields into stable semantic facts for KPI preparation.
// Owns: ITSM fact flags, Driver quantity semantics, Equipment population snapshots and MB<->PRB linkage.
// Reads: normalized records supplied by callers only.
// Writes: nothing.
// Public API: globalThis.ReclassifierKpiSourceFacts.
// Must not: parse Excel, render UI, persist Dataset state or calculate final KPI coefficients.

(() => {
  'use strict';

  // Approved four-category denominator for the general indicator (A/B/C/D).
  // RITM без изм and all other outcomes are outside the denominator.
  const CLASSIFICATION_CODES = Object.freeze({
    'inc без изм': 'A',
    'inc с исправлением': 'B',
    'inc не классифицирован': 'C',
    'ritm вместо inc': 'D'
  });

  const USABLE_LABOR_STATES = new Set(['valid', 'valid_zero']);

  function text(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  function equipmentClass(value) {
    const normalized = key(value);
    if (!normalized) return null;
    if (normalized === 'mounted' || normalized.includes('навесн')) return 'mounted';
    if (normalized === 'stationary' || normalized.includes('стационар')) return 'stationary';
    return null;
  }

  function mineName(value) {
    const normalized = text(value);
    if (!normalized) return null;
    // ITSM uses composite territory names for the Kaierkansky shafts,
    // while Drivers/Equipment and chart filters identify the shaft itself.
    // Normalize only these documented composite locations, not arbitrary
    // multi-site strings which could hide an unknown mine association.
    const shaft=normalized.match(/(?:^|[,;]\s*)(?:ш\.\s*|шахта\s+)(Ангидрит|Известняков)(?=$|[,;\s])/iu);
    if(shaft)return shaft[1];
    return normalized.replace(/^(?:рудник\s+|[рш]\.\s*|шахта\s+)/iu, '').trim() || null;
  }

  function finiteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = text(value).replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function slaState(value) {
    if (value === true) return 'overdue';
    if (value === false) return 'success';
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value === 1) return 'overdue';
      if (value === 0) return 'success';
    }
    const normalized = key(value);
    if (!normalized) return 'unknown';
    if (['нет', 'false', 'ложь', '0', 'не просрочен', 'не просрочено'].includes(normalized)) {
      return 'success';
    }
    if (['да', 'true', 'истина', '1', 'просрочен', 'просрочено'].includes(normalized)) {
      return 'overdue';
    }
    return 'unknown';
  }

  function problemId(value) {
    const normalized = text(value);
    return /^prb/i.test(normalized) ? normalized : null;
  }

  function itsmFact(record = {}) {
    const requestType = text(record.typeAfterReclassification).toUpperCase();
    const classification = key(record.classificationQuality);
    const classificationCode = CLASSIFICATION_CODES[classification] || null;
    const classificationIncluded = classificationCode !== null;
    const prbId = problemId(record.problemLink);
    const failureDecision = text(record.sputnikVbrDecision);

    return Object.freeze({
      requestNumber: text(record.number) || null,
      initiatorGroup: text(record.initiatorGroup) || null,
      // Stored mbPresence is a historical snapshot; the CGPS KPI joins live MB records.
      storedMbPresence: text(record.mbPresence) || null,
      createdAt: record.createdAt ?? null,
      completedAt: record.completedAt ?? null,
      closedAt: record.closedAt ?? null,
      requestType,
      failureDecision,
      failure: requestType === 'INC' &&
        key(failureDecision) === key('Считать отказом'),
      integratedFromMobileBrigade: key(record.openedBy) === key('Интеграция с МБ'),
      classificationCode,
      classificationState: classificationIncluded
        ? (classification === key('INC без изм') ? 'success' : 'failure')
        : 'not-applicable',
      classificationIncluded,
      classificationSuccess: classificationIncluded &&
        classification === key('INC без изм'),
      slaState: slaState(record.slaOverdue),
      problemId: prbId,
      problemLinked: Boolean(prbId),
      branch: text(record.division) || null,
      mine: mineName(record.territory),
      equipmentClass: equipmentClass(record.sdgrService),
      equipmentType: text(record.sdgrService) || null,
      reclassifiedEquipmentName: text(record.reclassifiedEquipment) || null,
      equipmentName: text(record.reclassifiedEquipment || record.sourceEquipment) || null,
      workType: text(record.workType) || null,
      requestDurationHours: finiteNumber(record.preBacklogHours),
      failureWorkHours: finiteNumber(record.slaHours),
      linkedMobileBrigadeLaborHours: finiteNumber(record.result6LaborHours)
    });
  }

  function driverFact(record = {}) {
    const state = text(record.valueState) || 'unknown';
    const value = finiteNumber(record.value);
    const unit = text(record.unit) || null;
    const nonNegative = value !== null && value >= 0;
    const countUnit = key(unit) === key('шт');
    const integralCount = nonNegative && Number.isInteger(value);

    return Object.freeze({
      mine: mineName(record.mine),
      name: text(record.name) || null,
      service: text(record.service) || null,
      system: text(record.system) || null,
      quantityValue: state === 'value' && nonNegative ? value : null,
      quantityUnit: unit,
      quantityState: state,
      equipmentCountCandidate: state === 'value' && countUnit && integralCount ? value : null,
      equipmentCountCandidateState:
        state !== 'value' ? 'not-a-value'
          : !countUnit ? 'wrong-unit'
            : !integralCount ? 'non-integer'
              : 'candidate-only',
      officialEquipmentPopulation: false
    });
  }

  // Drivers is a reference table of quantities per mine/name/service, not an
  // ITSM-event measure.  Each physical mine cell is counted once; a summary
  // column "Все рудники" is never added to the physical mine quantities.
  function driverPopulationSnapshot(instance = {}) {
    const sources = Array.isArray(instance.records) ? instance.records : [];
    const groups = new Map();
    let usableRows = 0;
    let summaryRowsSkipped = 0;
    let unusableQuantityRows = 0;
    let unidentifiedRows = 0;

    for (const source of sources) {
      const fact = driverFact(source);
      const mine = fact.mine;
      if (key(mine) === 'все рудники') {
        summaryRowsSkipped += 1;
        continue;
      }
      const equipmentClassValue = equipmentClass(fact.service);
      if (!mine || !fact.name || !equipmentClassValue) {
        unidentifiedRows += 1;
        continue;
      }
      if (fact.equipmentCountCandidate === null) {
        unusableQuantityRows += 1;
        continue;
      }
      const signature = JSON.stringify([
        key(mine), equipmentClassValue, key(fact.service), key(fact.name)
      ]);
      if (!groups.has(signature)) {
        groups.set(signature, {
          organizationalUnit: mine,
          equipmentClass: equipmentClassValue,
          equipmentType: fact.service,
          equipmentName: fact.name,
          sourceCatalog: 'Drivers',
          equipmentCount: 0,
          sourceRowCount: 0
        });
      }
      const group = groups.get(signature);
      group.equipmentCount += fact.equipmentCountCandidate;
      group.sourceRowCount += 1;
      usableRows += 1;
    }

    return Object.freeze({
      sourceDataset: 'drivers',
      snapshotKind: 'fixed-reference',
      referenceFreshness: text(instance.meta?.freshness || instance.meta?.loadedAt) || null,
      supportsHistoricalPeriods: false,
      usableRows,
      summaryRowsSkipped,
      unusableQuantityRows,
      unidentifiedRows,
      records: Object.freeze(Array.from(groups.values(), row => Object.freeze({ ...row }))
        .sort((left, right) =>
          String(left.organizationalUnit).localeCompare(String(right.organizationalUnit), 'ru') ||
          String(left.equipmentType).localeCompare(String(right.equipmentType), 'ru') ||
          String(left.equipmentName).localeCompare(String(right.equipmentName), 'ru')))
    });
  }

  function equipmentFact(record = {}) {
    const status = text(record['Статус эксплуатации']);
    const normalizedStatus = key(status);
    const active = normalizedStatus === key('Активен')
      ? true
      : normalizedStatus === key('Не активен')
        ? false
        : null;

    return Object.freeze({
      equipmentId: text(record.id) || null,
      sourceCatalog: text(record.source_catalog) || null,
      equipmentClass: equipmentClass(record.source_catalog) || equipmentClass(record.equipment_type),
      organizationalUnit: mineName(record.unit),
      department: text(record.unit_department) || null,
      equipmentType: text(record.equipment_type) || null,
      equipmentName: text(record.name) || null,
      operationalStatus: status || null,
      active
    });
  }

  function equipmentPopulationSnapshot(instance = {}) {
    const records = Array.isArray(instance.records) ? instance.records : [];
    const snapshotDate = text(instance.meta?.freshness) || null;
    const seenIds = new Set();
    const groups = new Map();

    let activeEquipmentCount = 0;
    let inactiveEquipmentCount = 0;
    let unknownStatusCount = 0;
    let missingIdCount = 0;
    let duplicateIdCount = 0;

    for (const source of records) {
      const fact = equipmentFact(source);
      if (!fact.equipmentId) {
        missingIdCount += 1;
        continue;
      }

      const idKey = key(fact.equipmentId);
      if (seenIds.has(idKey)) {
        duplicateIdCount += 1;
        continue;
      }
      seenIds.add(idKey);

      if (fact.active === true) activeEquipmentCount += 1;
      else if (fact.active === false) inactiveEquipmentCount += 1;
      else unknownStatusCount += 1;

      if (fact.active !== true) continue;
      const groupKey = JSON.stringify([
        fact.organizationalUnit,
        fact.equipmentClass,
        fact.equipmentType,
        fact.equipmentName,
        fact.sourceCatalog
      ]);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          organizationalUnit: fact.organizationalUnit,
          equipmentClass: fact.equipmentClass,
          equipmentType: fact.equipmentType,
          equipmentName: fact.equipmentName,
          sourceCatalog: fact.sourceCatalog,
          equipmentCount: 0
        });
      }
      groups.get(groupKey).equipmentCount += 1;
    }

    return Object.freeze({
      sourceDataset: 'combined',
      snapshotKind: 'current-snapshot',
      snapshotDate,
      supportsHistoricalPeriods: false,
      activeEquipmentCount,
      inactiveEquipmentCount,
      unknownStatusCount,
      missingIdCount,
      duplicateIdCount,
      records: Object.freeze(
        Array.from(groups.values(), item => Object.freeze({ ...item }))
          .sort((left, right) => [
            String(left.organizationalUnit || '').localeCompare(String(right.organizationalUnit || ''), 'ru'),
            String(left.equipmentType || '').localeCompare(String(right.equipmentType || ''), 'ru'),
            String(left.equipmentName || '').localeCompare(String(right.equipmentName || ''), 'ru')
          ].find(value => value !== 0) || 0)
      )
    });
  }

  function rowsToObjects(fields, records) {
    const names = Array.from(fields || []);
    return Array.from(records || [], row =>
      Object.fromEntries(names.map((field, index) => [field, row?.[index] ?? null]))
    );
  }

  function fullDatasetSlaLookup(fullDataset) {
    const columns = Array.from(fullDataset?.columns || []);
    const rows = Array.from(fullDataset?.rows || []);
    if (!columns.length || !rows.length) return null;

    const expected = key('Просрочен по разрешению');
    const slaIndex = columns.findIndex(column => {
      const normalized = key(column);
      return normalized === expected ||
        normalized.startsWith(expected + ' ') ||
        normalized.startsWith(expected + '(');
    });
    if (slaIndex < 0) return null;

    const byRequest = new Map();
    const recordKeys = Array.from(fullDataset?.recordKeys || []);
    if (recordKeys.length === rows.length) {
      recordKeys.forEach((requestNumber, index) => {
        const requestKey = key(requestNumber);
        if (requestKey) byRequest.set(requestKey, rows[index]?.[slaIndex] ?? null);
      });
    }

    return Object.freeze({
      byRequest,
      positional: Object.freeze(rows.map(row => row?.[slaIndex] ?? null))
    });
  }

  function itsmDatasetFacts(fields, records, fullDataset = null) {
    const objects = rowsToObjects(fields, records);
    const slaLookup = fullDatasetSlaLookup(fullDataset);

    return Object.freeze(objects.map((record, rowIndex) => {
      let slaOverdue = record.slaOverdue;
      if (slaLookup) {
        const requestKey = key(record.number);
        if (requestKey && slaLookup.byRequest.has(requestKey)) {
          slaOverdue = slaLookup.byRequest.get(requestKey);
        } else if (slaLookup.positional.length === objects.length) {
          slaOverdue = slaLookup.positional[rowIndex];
        }
      }
      return itsmFact(Object.assign({}, record, { slaOverdue }));
    }));
  }

  function mobileLaborFact(record = {}) {
    const laborState = text(record.laborState) || 'missing';
    const parsedLabor = finiteNumber(record.laborHours);
    const laborUsable = USABLE_LABOR_STATES.has(laborState) &&
      parsedLabor !== null && parsedLabor >= 0;
    const equipmentPlacement = text(record.equipmentPlacement) || null;
    const placementKey = key(equipmentPlacement);
    const equipmentName = placementKey.includes(key('Навесное'))
      ? text(record.transport)
      : placementKey.includes(key('Стационарное'))
        ? text(record.equipmentUnit)
        : text(record.equipment || record.equipmentUnit || record.transport);

    return Object.freeze({
      recordKey: text(record.recordKey) || null,
      request: text(record.request) || null,
      factDate: record.factDate ?? null,
      site: mineName(record.site),
      finalTaskType: text(record.finalTaskType) || null,
      equipmentPlacement,
      equipmentClass: equipmentClass(equipmentPlacement),
      equipmentType: text(record.equipmentType) || null,
      equipmentName: equipmentName || null,
      laborHours: laborUsable ? parsedLabor : null,
      laborState,
      laborUsable,
      zeroLabor: laborUsable && parsedLabor === 0
    });
  }

  function linkMobileBrigadeToProblems(mobileRecords, itsmRecords) {
    const itsmByRequest = new Map();
    const ambiguous = new Set();

    for (const source of Array.isArray(itsmRecords) ? itsmRecords : []) {
      const fact = source?.requestType !== undefined &&
        Object.prototype.hasOwnProperty.call(source, 'problemLinked')
        ? source
        : itsmFact(source);
      const requestKey = key(fact.requestNumber);
      if (!requestKey) continue;

      if (!itsmByRequest.has(requestKey)) {
        itsmByRequest.set(requestKey, fact);
        continue;
      }

      const current = itsmByRequest.get(requestKey);
      if (current.problemId !== fact.problemId) ambiguous.add(requestKey);
    }

    const linked = [];
    let requestMatched = 0;
    let requestUnmatched = 0;
    let problemLinkedRows = 0;
    let usableLaborRows = 0;
    let unusableLaborRows = 0;

    for (const record of Array.isArray(mobileRecords) ? mobileRecords : []) {
      const mobileFact = mobileLaborFact(record);
      const requestKey = key(mobileFact.request);
      const fact = requestKey ? itsmByRequest.get(requestKey) : null;
      const laborState = mobileFact.laborState;
      const laborHours = mobileFact.laborHours;
      const laborUsable = mobileFact.laborUsable;
      const isAmbiguous = requestKey ? ambiguous.has(requestKey) : false;

      if (fact) requestMatched += 1;
      else requestUnmatched += 1;
      if (fact?.problemLinked && !isAmbiguous) problemLinkedRows += 1;
      if (laborUsable) usableLaborRows += 1;
      else unusableLaborRows += 1;

      linked.push(Object.freeze({
        recordKey: mobileFact.recordKey,
        request: mobileFact.request,
        factDate: mobileFact.factDate,
        site: mobileFact.site,
        finalTaskType: mobileFact.finalTaskType,
        equipmentPlacement: mobileFact.equipmentPlacement,
        equipmentClass: mobileFact.equipmentClass || fact?.equipmentClass || null,
        mobileEquipmentType: mobileFact.equipmentType,
        mobileEquipmentName: mobileFact.equipmentName,
        laborHours,
        laborState,
        laborUsable,
        zeroLabor: mobileFact.zeroLabor,
        branch: fact?.branch || null,
        mine: fact?.mine || null,
        equipmentType: fact?.equipmentType || null,
        equipmentName: fact?.equipmentName || null,
        problemId: isAmbiguous ? null : (fact?.problemId || null),
        problemLinked: Boolean(fact?.problemLinked) && !isAmbiguous,
        problemLinkState: isAmbiguous
          ? 'ambiguous'
          : fact
            ? (fact.problemLinked ? 'linked' : 'not-linked')
            : 'request-not-found'
      }));
    }

    return Object.freeze({
      records: Object.freeze(linked),
      stats: Object.freeze({
        rows: linked.length,
        requestMatched,
        requestUnmatched,
        problemLinkedRows,
        usableLaborRows,
        unusableLaborRows,
        ambiguousRequestCount: ambiguous.size
      })
    });
  }


  // Reporting cut-offs describe completeness of a source EXPORT, not the last
  // date of an observed event. ITSM latestSourceDate currently comes from
  // createdAt and MUST NOT be treated as proof of a complete reporting day.
  // This is a pure opt-in metadata contract; no present-day/clock fallback.
  function reportingDay(value) {
    const raw = String(value ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    const day = Number(raw.slice(8, 10));
    if (year < 2000 || year > 9999 || month < 1 || month > 12 || day < 1) return null;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return day <= lastDay ? raw : null;
  }

  // Manual assertion concerns FULL COVERAGE of the accumulated Dataset, not
  // the latest event, file name, or partial import. Call only after an explicit
  // user confirmation of all reporting days AND all relevant mine/scope slices.
  function certifyReportingCoverage(input,options={}) {
    const from=reportingDay(input?.coverageFrom);
    const through=reportingDay(input?.coverageThrough);
    if(!from||!through||from>through)
      throw new Error('Укажите корректный интервал покрытия в формате ГГГГ-ММ-ДД.');
    if(!options.confirmed)
      throw new Error('Требуется явное подтверждение полноты выгрузки пользователем.');
    if(!['itsm_data','mobile_brigade_data'].includes(options.datasetId))
      throw new Error('Подтверждение допускается только для ITSM и Мобильных бригад.');
    if(typeof options.timestamp!=='string'||!Number.isFinite(Date.parse(options.timestamp)))
      throw new Error('Отсутствует время фиксации подтверждения.');
    return Object.freeze({
      confirmed:true,basis:'source-export-cutoff',
      coverageFrom:from,coverageThrough:through,
      certifiedBy:'user-explicit-dataset-attestation',
      certifiedAt:options.timestamp,
      scope:'entire-accumulated-dataset'
    });
  }

  // Trusted only when the producer explicitly certifies that an export covers
  // every reporting day in [coverageFrom, coverageThrough]. File names, upload
  // timestamps, event maxima and generic freshness are NOT such evidence.
  function sourceReportingCoverage(id, instance) {
    const meta = instance?.meta || {};
    const observedLatestDate = reportingDay(meta.latestSourceDate) || null;
    const base = {
      sourceId: id, coverageFrom: null, coverageThrough: null,
      basis: null, observedLatestDate,
      status: 'unknown', reason: 'reporting-cutoff-unconfirmed'
    };
    if (!instance || meta.sourceType === 'error') {
      return Object.freeze({
        ...base, status: 'unavailable', reason: 'source-unavailable'
      });
    }
    const declaration = meta.reportingCoverage;
    if (!declaration) return Object.freeze(base);
    if (declaration.confirmed !== true ||
        declaration.basis !== 'source-export-cutoff') {
      return Object.freeze({
        ...base, reason: 'reporting-cutoff-not-certified'
      });
    }
    const from = reportingDay(declaration.coverageFrom);
    const through = reportingDay(declaration.coverageThrough);
    if (!from || !through || from > through) {
      return Object.freeze({
        ...base, reason: 'invalid-reporting-coverage-range'
      });
    }
    // The maximum observed event date can NEVER certify completeness, but
    // an event AFTER the attested boundary disproves the assertion.
    if (declaration.certifiedBy==='user-explicit-dataset-attestation' &&
        observedLatestDate && observedLatestDate > through) {
      return Object.freeze({
        ...base, reason:'observations-after-certified-cutoff'
      });
    }
    return Object.freeze({
      ...base, status: 'confirmed', reason: null,
      basis: declaration.basis, coverageFrom: from, coverageThrough: through
    });
  }

  function reportingMonthStatus(month, coverage) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
      return Object.freeze({ status: 'unknown', reason: 'report-month-missing' });
    }
    if (coverage?.status !== 'confirmed') {
      return Object.freeze({
        status: 'unknown',
        reason: coverage?.reason || 'reporting-cutoff-unconfirmed'
      });
    }
    const first = month + '-01';
    const end = month + '-' + String(new Date(Date.UTC(
      Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0
    )).getUTCDate()).padStart(2, '0');
    if (coverage.coverageFrom > first) {
      return Object.freeze({
        status: 'unknown', reason: 'report-month-start-uncovered'
      });
    }
    if (coverage.coverageThrough < first) {
      return Object.freeze({
        status: 'unknown', reason: 'report-month-after-cutoff'
      });
    }
    if (coverage.coverageThrough >= end) {
      return Object.freeze({ status: 'complete', reason: null });
    }
    return Object.freeze({ status: 'incomplete', reason: null });
  }

  const api = Object.freeze({
    text,
    key,
    equipmentClass,
    mineName,
    finiteNumber,
    slaState,
    problemId,
    itsmFact,
    driverFact,
    driverPopulationSnapshot,
    equipmentFact,
    equipmentPopulationSnapshot,
    rowsToObjects,
    fullDatasetSlaLookup,
    itsmDatasetFacts,
    mobileLaborFact,
    linkMobileBrigadeToProblems,
    reportingDay,
    certifyReportingCoverage,
    sourceReportingCoverage,
    reportingMonthStatus
  });

  if (typeof globalThis !== 'undefined') globalThis.ReclassifierKpiSourceFacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
