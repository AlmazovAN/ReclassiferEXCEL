const activeFolderReclassificationEngineId = 'independent-4.0';

function createFolderReclassificationRegistry(engines) {
  const byId = new Map();
  for (const engine of engines) {
    if (!engine.id || !engine.version || typeof engine.run !== 'function' || byId.has(engine.id)) {
      throw new Error('Некорректная регистрация движка реклассификации: '+engine.id);
    }
    byId.set(engine.id,Object.freeze(engine));
  }
  return Object.freeze({
    resolve(id) {
      const engine = byId.get(id);
      if (!engine) throw new Error('Движок реклассификации недоступен: '+id);
      return engine;
    }
  });
}

function resolveActiveFolderReclassificationEngine() {
  const {id,version} = ReclassifierReclassificationEngineRegistry.requireAvailable('legacy-3.3');
  const registry = createFolderReclassificationRegistry([
    createFolderLegacyReclassificationEngine({
      id, version, report:ReclassifierReclassificationWorkerProcessor.process
    }),
    createFolderIndependentReclassificationEngine({
      rules:ReclassifierReclassificationRulesV4,
      cascade:createFolderV4Cascade({
        projectRow:ReclassifierReclassificationRulesV4.projectRow,
        buildContext:ReclassifierObjectAssessmentV4.fromPreparedRecords,
        event:ReclassifierEventAssessmentV4.analyze,
        object:ReclassifierObjectAssessmentV4.analyze,
        element:ReclassifierElementAssessmentV4.analyze,
        failure:ReclassifierFailureAssessmentV4.analyze,
        cause:ReclassifierCauseAssessmentV4.analyze,
        path:ReclassifierPathReviewV4.analyze,
        review:ReclassifierReviewPolicyV4.assess
      }),
      parseItsm:ReclassifierReclassificationWorkerProcessor.parseItsmWorkbook,
      parseDate:ReclassifierItsmWorkerProcessor.dateValue,
      xlsx:XLSX
    })
  ]);
  return registry.resolve(activeFolderReclassificationEngineId);
}
