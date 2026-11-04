// FILE CONTRACT: pure KPI Source aggregation contract for processed ITSM rows.
// Purpose: accumulate compact monthly KPI numerators, denominators and duration sums in O(n).
// Owns: KPI_Source schema, period routing and in-memory aggregation only.
// Reads: semantic values supplied by the ITSM processor; no workbook columns or storage engines.
// Writes: transient Map state returned as normalized KPI Source records.
// Public API: globalThis.ReclassifierKpiSource.
// Must not: read/write XLSX, render UI, persist Dataset state or duplicate ITSM classification rules.

(() => {
  'use strict';

  const DATASET_ID = 'kpi_source';
  const SCHEMA_VERSION = '1.0.0';
  const sourceFacts = globalThis.ReclassifierKpiSourceFacts;
  if (!sourceFacts?.itsmFact) {
    throw new Error('KPI Source Facts must be loaded before KPI Source.');
  }

  const COLUMNS = Object.freeze([
    ['rowType', 'RowType', 'text'],
    ['year', 'Year', 'number'],
    ['month', 'Month', 'number'],
    ['period', 'Period', 'date-text'],
    ['branch', 'Branch', 'text'],
    ['mine', 'Mine', 'text'],
    ['equipmentType', 'EquipmentType', 'text'],
    ['equipmentName', 'EquipmentName', 'text'],
    ['equipmentCount', 'EquipmentCount', 'number|null'],
    ['failureCount', 'FailureCount', 'number'],
    ['integratedFailureCount', 'IntegratedFailureCount', 'number'],
    ['incCount', 'IncCount', 'number'],
    ['ritmCount', 'RitmCount', 'number'],
    ['incidentDurationHours', 'IncidentDurationHours', 'number'],
    ['requestDurationHours', 'RequestDurationHours', 'number'],
    ['failureDowntimeHours', 'FailureDowntimeHours', 'number'],
    ['failureWorkHours', 'FailureWorkHours', 'number'],
    ['slaSuccessCount', 'SlaSuccessCount', 'number'],
    ['slaTotalCount', 'SlaTotalCount', 'number'],
    ['classificationSuccessCount', 'ClassificationSuccessCount', 'number'],
    ['classificationTotalCount', 'ClassificationTotalCount', 'number'],
    ['personnelCount', 'PersonnelCount', 'number|null']
  ].map(column => Object.freeze(column)));

  function text(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function key(value) {
    return text(value).toLocaleLowerCase('ru-RU');
  }

  function finiteNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const normalized = text(value).replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dateParts(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return {
        year: value.getFullYear(),
        month: value.getMonth() + 1
      };
    }

    const normalized = text(value);
    if (!normalized) return null;

    let match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return { year: Number(match[1]), month: Number(match[2]) };
    }

    match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4}|\d{2})/);
    if (match) {
      return {
        year: match[3].length === 2 ? Number('20' + match[3]) : Number(match[3]),
        month: Number(match[2])
      };
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
      year: parsed.getFullYear(),
      month: parsed.getMonth() + 1
    };
  }

  function monthPeriod(value) {
    const parts = dateParts(value);
    if (!parts || !Number.isInteger(parts.year) ||
        !Number.isInteger(parts.month) || parts.month < 1 || parts.month > 12) {
      return null;
    }
    return Object.freeze({
      year: parts.year,
      month: parts.month,
      period: String(parts.year) + '-' + String(parts.month).padStart(2, '0') + '-01'
    });
  }

  function dimensions(record = {}) {
    return {
      branch: text(record.division),
      mine: text(record.territory),
      equipmentType: text(record.sdgrService),
      equipmentName: text(record.reclassifiedEquipment || record.sourceEquipment)
    };
  }

  function aggregateKey(rowType, periodInfo, dims) {
    return JSON.stringify([
      rowType,
      periodInfo.period,
      dims.branch,
      dims.mine,
      dims.equipmentType,
      dims.equipmentName
    ]);
  }

  function blankRow(rowType, periodInfo, dims) {
    return {
      rowType,
      year: periodInfo.year,
      month: periodInfo.month,
      period: periodInfo.period,
      branch: dims.branch,
      mine: dims.mine,
      equipmentType: dims.equipmentType,
      equipmentName: dims.equipmentName,
      equipmentCount: null,
      failureCount: 0,
      integratedFailureCount: 0,
      incCount: 0,
      ritmCount: 0,
      incidentDurationHours: 0,
      requestDurationHours: 0,
      failureDowntimeHours: 0,
      failureWorkHours: 0,
      slaSuccessCount: 0,
      slaTotalCount: 0,
      classificationSuccessCount: 0,
      classificationTotalCount: 0,
      personnelCount: null
    };
  }

  function compareRows(left, right) {
    return [
      left.period.localeCompare(right.period),
      left.rowType.localeCompare(right.rowType),
      left.branch.localeCompare(right.branch, 'ru'),
      left.mine.localeCompare(right.mine, 'ru'),
      left.equipmentType.localeCompare(right.equipmentType, 'ru'),
      left.equipmentName.localeCompare(right.equipmentName, 'ru')
    ].find(value => value !== 0) || 0;
  }

  function createAggregator() {
    const rows = new Map();

    function ensure(rowType, periodInfo, dims) {
      const id = aggregateKey(rowType, periodInfo, dims);
      if (!rows.has(id)) rows.set(id, blankRow(rowType, periodInfo, dims));
      return rows.get(id);
    }

    function ensureItsm(periodInfo, record) {
      return ensure('ITSM', periodInfo, dimensions(record));
    }

    function assignScalar(row, field, value, label) {
      const parsed = finiteNumber(value);
      if (parsed === null) return;
      if (row[field] === null) {
        row[field] = parsed;
        return;
      }
      if (row[field] !== parsed) {
        throw new Error(
          'KPI Source: конфликт значений ' + label + ' для ' +
          [row.period, row.branch, row.mine, row.equipmentType, row.equipmentName]
            .filter(Boolean).join(' / ') + ': ' + row[field] + ' и ' + parsed + '.'
        );
      }
    }

    function metricRow(periodInfo, record) {
      return ensureItsm(periodInfo, record);
    }

    function consume(record = {}) {
      const fact = sourceFacts.itsmFact(record);
      const requestType = fact.requestType;
      const failure = fact.failure;
      const preBacklogHours = finiteNumber(record.preBacklogHours);
      const slaHours = finiteNumber(record.slaHours);

      const completionPeriod = monthPeriod(record.completedAt);
      if (completionPeriod && (requestType === 'INC' || requestType === 'RITM')) {
        const row = metricRow(completionPeriod, record);

        if (requestType === 'INC') {
          row.incCount += 1;
          if (preBacklogHours !== null) row.incidentDurationHours += preBacklogHours;
        } else {
          row.ritmCount += 1;
        }
        if (preBacklogHours !== null) row.requestDurationHours += preBacklogHours;

        if (failure) {
          row.failureCount += 1;
          if (key(record.openedBy) === key('Интеграция с МБ')) {
            row.integratedFailureCount += 1;
          }
          if (slaHours !== null) row.failureWorkHours += slaHours;
        }
      }

      // Compatibility with the current Reliability Report KTG block:
      // failure downtime is bucketed by request creation month.
      const creationPeriod = monthPeriod(record.createdAt);
      if (creationPeriod && failure && preBacklogHours !== null) {
        metricRow(creationPeriod, record).failureDowntimeHours += preBacklogHours;
      }

      // General classification quality counts by completion month; only when
      // completion is absent/invalid, use closure month. SLA stays closure-based.
      const closePeriod = monthPeriod(record.closedAt);
      const classificationPeriod = completionPeriod || closePeriod;
      if (classificationPeriod && fact.classificationIncluded) {
        const row = metricRow(classificationPeriod, record);
        row.classificationTotalCount += 1;
        if (fact.classificationSuccess) row.classificationSuccessCount += 1;
      }

      if (closePeriod && fact.slaState !== 'unknown') {
        const row = metricRow(closePeriod, record);
        row.slaTotalCount += 1;
        if (fact.slaState === 'success') row.slaSuccessCount += 1;
      }
    }

    function seedEquipmentCount(reference = {}) {
      const periodInfo = monthPeriod(reference.period || reference.date);
      if (!periodInfo) throw new Error('KPI Source: для EquipmentCount не задан корректный период.');
      const row = ensureItsm(periodInfo, reference);
      assignScalar(row, 'equipmentCount', reference.equipmentCount, 'EquipmentCount');
    }

    function seedPersonnelCount(reference = {}) {
      const periodInfo = monthPeriod(reference.period || reference.date);
      if (!periodInfo) throw new Error('KPI Source: для PersonnelCount не задан корректный период.');
      const dims = {
        branch: text(reference.division ?? reference.branch),
        mine: text(reference.territory ?? reference.mine),
        equipmentType: '',
        equipmentName: ''
      };
      const row = ensure('REFERENCE', periodInfo, dims);
      assignScalar(row, 'personnelCount', reference.personnelCount, 'PersonnelCount');
    }

    function finalize() {
      return {
        id: DATASET_ID,
        schemaVersion: SCHEMA_VERSION,
        fields: COLUMNS.map(column => column[0]),
        columns: COLUMNS.map(column => column[1]),
        records: Array.from(rows.values(), row => ({ ...row })).sort(compareRows)
      };
    }

    return Object.freeze({
      consume,
      seedEquipmentCount,
      seedPersonnelCount,
      finalize,
      size: () => rows.size
    });
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

    const recordKeys = Array.from(fullDataset?.recordKeys || []);
    const byRequest = new Map();
    if (recordKeys.length === rows.length) {
      recordKeys.forEach((requestNumber, index) => {
        const normalized = key(requestNumber);
        if (normalized) byRequest.set(normalized, rows[index]?.[slaIndex] ?? null);
      });
    }

    return {
      byRequest,
      positional: rows.map(row => row?.[slaIndex] ?? null)
    };
  }

  function aggregateItsmDataset(fields, records, fullDataset = null) {
    const sourceFields = Array.from(fields || []);
    const sourceRows = Array.from(records || []);
    const index = new Map(sourceFields.map((field, position) => [field, position]));
    const value = (row, field) => {
      const position = index.get(field);
      return position === undefined ? null : row?.[position];
    };
    const fullSla = fullDatasetSlaLookup(fullDataset);
    const numberIndex = index.get('number');
    const aggregator = createAggregator();

    sourceRows.forEach((row, rowIndex) => {
      let slaOverdue = value(row, 'slaOverdue');
      if (fullSla) {
        const requestNumber = numberIndex === undefined ? '' : key(row?.[numberIndex]);
        if (requestNumber && fullSla.byRequest.has(requestNumber)) {
          slaOverdue = fullSla.byRequest.get(requestNumber);
        } else if (fullSla.positional.length === sourceRows.length) {
          slaOverdue = fullSla.positional[rowIndex];
        }
      }

      aggregator.consume({
        createdAt: value(row, 'createdAt'),
        completedAt: value(row, 'completedAt'),
        closedAt: value(row, 'closedAt'),
        territory: value(row, 'territory'),
        sourceEquipment: value(row, 'sourceEquipment'),
        reclassifiedEquipment: value(row, 'reclassifiedEquipment'),
        openedBy: value(row, 'openedBy'),
        classificationQuality: value(row, 'classificationQuality'),
        typeAfterReclassification: value(row, 'typeAfterReclassification'),
        sputnikVbrDecision: value(row, 'sputnikVbrDecision'),
        sdgrService: value(row, 'sdgrService'),
        division: value(row, 'division'),
        slaHours: value(row, 'slaHours'),
        preBacklogHours: value(row, 'preBacklogHours'),
        problemLink: value(row, 'problemLink'),
        result6LaborHours: value(row, 'result6LaborHours'),
        // Drivers quantity is intentionally NOT projected to equipmentCount.
        // Official equipment population must come from an explicit Equipment snapshot.
        // Compact ITSM intentionally omits the raw SLA-overdue flag. When a
        // complete/partial Full Dataset is available, recover it by request key.
        slaOverdue
      });
    });
    return aggregator.finalize();
  }

  function datasetPayload(aggregate, sourceRows = null) {
    const rows = aggregate.records.map(record =>
      aggregate.fields.map(field => record[field] ?? null)
    );
    const periods = aggregate.records.map(record => record.period).filter(Boolean);
    return {
      schemaVersion: SCHEMA_VERSION,
      package: 'kpi-source',
      aggregation: 'monthly-dimensions',
      fields: Array.from(aggregate.fields),
      columns: Array.from(aggregate.columns),
      records: rows,
      sourceRows: sourceRows ?? null,
      aggregateRows: rows.length,
      earliestPeriod: periods.length ? periods[0] : null,
      latestPeriod: periods.length ? periods[periods.length - 1] : null
    };
  }

  globalThis.ReclassifierKpiSource = Object.freeze({
    id: DATASET_ID,
    schemaVersion: SCHEMA_VERSION,
    columns: COLUMNS,
    fields: Object.freeze(COLUMNS.map(column => column[0])),
    labels: Object.freeze(COLUMNS.map(column => column[1])),
    monthPeriod,
    createAggregator,
    aggregateItsmDataset,
    datasetPayload
  });
})();
