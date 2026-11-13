function createFolderLegacyReclassificationEngine({id, version, report}) {
  return {
    id,
    version,
    async run({source,classifier,references,asOfDate,dateFrom,dateTo}, onProgress) {
      if (dateFrom || dateTo) throw new Error('Фильтр по дате выполнения доступен для V4.');
      const {bytes,outputName,stats} = await report({
        engineId:id, baselineMode:'standard',
        bytes:await source.arrayBuffer(), fileName:source.name,
        classifierRecords:classifier.records, classifierMeta:classifier.meta,
        references, asOfDate
      },onProgress);
      return {bytes,outputName,stats:{rows:stats.rows,readyRows:stats.readyRows}};
    }
  };
}
