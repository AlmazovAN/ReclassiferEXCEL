// FILE CONTRACT: pure preparation of failure/request calculation components.
// Period semantics: request counts use completion month; VBR failures use completion date
// with closure-date fallback. Failure downtime independently uses creation month.
// Output: subject-specific component tables only; no final KPI formulas.

(() => {
  'use strict';

  const common = globalThis.ReclassifierKpiPreparationCommon;
  if (!common?.componentTable) throw new Error('KPI Preparation Common is required for failures.');

  const EVENT_GRAIN = ['period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'];
  const DOWNTIME_GRAIN = ['period', 'branch', 'mine', 'equipmentClass', 'equipmentType', 'equipmentName'];

  function dims(fact, periodInfo) {
    return {
      year: periodInfo.year,
      month: periodInfo.month,
      period: periodInfo.period,
      branch: fact.branch || null,
      mine: fact.mine || null,
      equipmentClass: fact.equipmentClass || null,
      equipmentType: fact.equipmentType || null,
      equipmentName: fact.equipmentName || null
    };
  }

  function sourceFactsDecision(fact) {
    return String(fact?.failureDecision || '').trim().toLocaleLowerCase('ru-RU');
  }

  function prepare(itsmFacts = []) {
    const eventRows = new Map();
    const downtimeRows = new Map();
    let rowsWithoutCompletionDate = 0;
    let failureRowsWithoutCreationDate = 0;
    let reclassifiedIncRows = 0;
    let excludedByVbrDecisionRows = 0;
    let incRowsWithOtherVbrDecision = 0;
    let failureRowsUsingCompletionDate = 0;
    let failureRowsUsingCloseDate = 0;
    let failureRowsWithoutEventDate = 0;

    for (const fact of Array.isArray(itsmFacts) ? itsmFacts : []) {
      const requestType = String(fact?.requestType || '').toUpperCase();
      const completionPeriod = common.monthPeriod(fact?.completedAt);
      const isRequest = requestType === 'INC' || requestType === 'RITM';
      if (requestType === 'INC') {
        reclassifiedIncRows += 1;
        const decision = sourceFactsDecision(fact);
        if (decision === 'исключить') excludedByVbrDecisionRows += 1;
        else if (decision !== 'считать отказом') incRowsWithOtherVbrDecision += 1;
      }
      // Preserve completion-only semantics for the other request counters.
      // Only a confirmed VBR failure may fall back to its closure month.
      const failurePeriod = fact?.failure
        ? (completionPeriod || common.monthPeriod(fact?.closedAt))
        : null;
      const eventPeriod = completionPeriod || failurePeriod;

      if (isRequest && eventPeriod) {
        const base = dims(fact, eventPeriod);
        const id = common.groupKey(EVENT_GRAIN.map(field => base[field]));
        if (!eventRows.has(id)) {
          eventRows.set(id, {
            ...base,
            incCount: 0,
            ritmCount: 0,
            failureCount: 0,
            integratedFailureCount: 0,
            incidentDurationHours: 0,
            incidentDurationKnownCount: 0,
            requestDurationHours: 0,
            requestDurationKnownCount: 0,
            failureWorkHours: 0,
            failureWorkHoursKnownCount: 0
          });
        }
        const row = eventRows.get(id);
        if (completionPeriod) {
          if (requestType === 'INC') {
            row.incCount += 1;
            if (common.addNumber(row, 'incidentDurationHours', fact.requestDurationHours)) {
              row.incidentDurationKnownCount += 1;
            }
          } else {
            row.ritmCount += 1;
          }
          if (common.addNumber(row, 'requestDurationHours', fact.requestDurationHours)) {
            row.requestDurationKnownCount += 1;
          }
        } else {
          rowsWithoutCompletionDate += 1;
        }

        if (fact.failure) {
          row.failureCount += 1;
          if (completionPeriod) failureRowsUsingCompletionDate += 1;
          else failureRowsUsingCloseDate += 1;
          if (fact.integratedFromMobileBrigade) row.integratedFailureCount += 1;
          if (common.addNumber(row, 'failureWorkHours', fact.failureWorkHours)) {
            row.failureWorkHoursKnownCount += 1;
          }
        }
      } else if (isRequest) {
        rowsWithoutCompletionDate += 1;
        if (fact?.failure) failureRowsWithoutEventDate += 1;
      }

      if (!fact?.failure) continue;
      const creationPeriod = common.monthPeriod(fact.createdAt);
      if (!creationPeriod) {
        failureRowsWithoutCreationDate += 1;
        continue;
      }
      const base = dims(fact, creationPeriod);
      const id = common.groupKey(DOWNTIME_GRAIN.map(field => base[field]));
      if (!downtimeRows.has(id)) {
        downtimeRows.set(id, {
          ...base,
          failureDowntimeHours: 0,
          failureDowntimeKnownCount: 0,
          failureCount: 0
        });
      }
      const row = downtimeRows.get(id);
      row.failureCount += 1;
      if (common.addNumber(row, 'failureDowntimeHours', fact.requestDurationHours)) {
        row.failureDowntimeKnownCount += 1;
      }
    }

    return Object.freeze({
      events: common.componentTable(
        'failure_events',
        EVENT_GRAIN,
        Array.from(eventRows.values()),
        {
          periodBasis: 'completedAt',
          failurePeriodBasis: 'completedAt-or-closedAt',
          rowsWithoutCompletionDate,
          inputItsmFactRows: Array.isArray(itsmFacts) ? itsmFacts.length : 0,
          reclassifiedIncRows,
          excludedByVbrDecisionRows,
          incRowsWithOtherVbrDecision,
          failureRowsUsingCompletionDate,
          failureRowsUsingCloseDate,
          failureRowsWithoutEventDate
        }
      ),
      downtime: common.componentTable(
        'failure_downtime',
        DOWNTIME_GRAIN,
        Array.from(downtimeRows.values()),
        {
          periodBasis: 'createdAt',
          durationField: 'requestDurationHours',
          failureRowsWithoutCreationDate
        }
      )
    });
  }

  const api = Object.freeze({ prepare });
  globalThis.ReclassifierKpiPrepareFailures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
