// Independent 4.0 engine placeholder. No legacy inference or baseline access.
// Future input is deliberately limited to original request facts (not expert labels).
(() => {
  'use strict';
  const id = 'independent-4.0';
  const version = '4.0.0-dev';
  const allowedFields = Object.freeze([
    'number','createdAt','completedAt','closedAt','state','closingCode','territory',
    'shortDescription','description','closureNote','extraReason'
  ]);

  function projectRow(source) {
    const input = {};
    for (const field of allowedFields) input[field] = source?.[field] ?? null;
    return Object.freeze(input);
  }

  function unavailableError() {
    const error = new Error('Алгоритм 4.0 ещё не реализован (V4_NOT_IMPLEMENTED).');
    error.code = 'V4_NOT_IMPLEMENTED';
    error.engineId = id;
    error.diagnostic = Object.freeze({
      engineId: id, version, status: 'UNAVAILABLE', code: error.code,
      message: error.message, readyForApply: false
    });
    return error;
  }

  function buildContext() { throw unavailableError(); }
  function evaluateRow() { throw unavailableError(); }

  globalThis.ReclassifierReclassificationRulesV4 = Object.freeze({
    id, version, allowedFields, projectRow, unavailableError,
    buildContext, evaluateRow
  });
})();
