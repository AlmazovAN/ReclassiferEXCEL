// Engine selection and compatibility adapter; never change the frozen 3.3 rules.
// Loaded after rules.js and rules_v4.js in both application and WebWorker.
(() => {
  'use strict';
  const legacy = globalThis.ReclassifierReclassificationRules;
  const independent = globalThis.ReclassifierReclassificationRulesV4;
  if (!legacy?.buildContext || !legacy?.evaluateRow || !legacy?.classificationQuality ||
      legacy.version !== '3.3.0')
    throw new Error('Не загружен неизменный алгоритм Re-Class 3.3.0.');
  if (!independent?.buildContext || !independent?.evaluateRow ||
      independent.id !== 'independent-4.0')
    throw new Error('Не загружен отдельный модуль Re-Class 4.0.');

  const DEFAULT_ID = 'legacy-3.3';
  const legacyStatuses = Object.freeze([
    'KEEP', 'CHANGE', 'BASELINE', 'REVIEW', 'RITM_OK', 'PENDING', 'CANCELLED'
  ]);
  function legacyStatus(status) {
    if (!legacyStatuses.includes(status)) {
      const error = new Error('Неизвестный статус legacy Re-Class: ' + String(status));
      error.code = 'RECLASS_UNKNOWN_STATUS';
      throw error;
    }
    return status;
  }

  const engines = Object.freeze({
    'legacy-3.3': Object.freeze({
      id: DEFAULT_ID, version: legacy.version,
      available: true, globalName: 'ReclassifierReclassificationRules',
      buildContext: (...args) => legacy.buildContext(...args),
      evaluateRow: (...args) => legacy.evaluateRow(...args),
      classificationQuality: (...args) => legacy.classificationQuality(...args),
      adaptStatus: legacyStatus,
      assertAvailable: () => true
    }),
    'independent-4.0': Object.freeze({
      id: independent.id, version: independent.version,
      available: false, globalName: 'ReclassifierReclassificationRulesV4',
      buildContext: (...args) => independent.buildContext(...args),
      evaluateRow: (...args) => independent.evaluateRow(...args),
      projectRow: row => independent.projectRow(row),
      // A future V4 result needs a separately approved status mapping.
      adaptStatus: () => { throw independent.unavailableError(); },
      classificationQuality: () => { throw independent.unavailableError(); },
      assertAvailable: () => { throw independent.unavailableError(); }
    })
  });

  function resolve(engineId) {
    const id = engineId == null ? DEFAULT_ID : engineId;
    if (!Object.prototype.hasOwnProperty.call(engines, id)) {
      const error = new Error('Неизвестный алгоритм реклассификации: ' + String(id));
      error.code = 'RECLASS_ENGINE_UNKNOWN';
      error.engineId = id;
      throw error;
    }
    return engines[id];
  }
  function requireAvailable(engineId) {
    const engine = resolve(engineId);
    engine.assertAvailable();
    return engine;
  }
  const list = () => Object.freeze(Object.values(engines).map(engine => Object.freeze({
    id: engine.id, version: engine.version, available: engine.available,
    globalName: engine.globalName
  })));

  globalThis.ReclassifierReclassificationEngineRegistry = Object.freeze({
    defaultId: DEFAULT_ID, ids: Object.freeze(Object.keys(engines)),
    resolve, requireAvailable, list
  });
})();
