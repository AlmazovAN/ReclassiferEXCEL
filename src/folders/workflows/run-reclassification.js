async function runFolderReclassification({
  root, source, prepared, preparedRoot, progress, enumerateCatalogs, readClassifier, engine, dateFrom, dateTo
}) {
  if (!prepared || !root || !await root.isSameEntry(preparedRoot)) {
    throw new Error('Сначала обновите справочники.');
  }
  const paths = prepared.statuses.get('failure_classifier')?.files || [];
  if (paths.length !== 1) {
    throw new Error('В Catalogs должен быть один распознанный классификатор отказов. Обновите справочники.');
  }
  progress('Чтение классификатора отказов', 0);
  const catalogs = await enumerateCatalogs(root);
  const classifier = catalogs.find(entry => entry.path === paths[0]);
  if (!classifier) throw new Error('Классификатор отказов перемещён. Обновите справочники.');
  const normalized = await readClassifier(classifier.file);
  if (normalized.validation?.errors?.length || !normalized.records.length) {
    throw new Error('Классификатор отказов не содержит действующих записей. Проверьте файл в Catalogs.');
  }
  const asOfDate = new Date();
  asOfDate.setHours(0,0,0,0);
  const result = await engine.run({
    source, classifier:normalized, dateFrom, dateTo,
    references:prepared.exportReferences, asOfDate:asOfDate.toISOString()
  }, ({label,percent})=>progress(label,percent));
  return {...result,sourceName:source.name,engineId:engine.id,engineVersion:engine.version};
}
