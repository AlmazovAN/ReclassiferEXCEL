async function readFolderWorkbook(file, xlsx) {
  return xlsx.read(await file.arrayBuffer(),{type:'array',dense:true,cellDates:true});
}

function createFolderReferenceReader({
  referenceIds, equipmentIds, readWorkbook, processReferenceFile, sha256,
  normalizeEquipmentWorkbook, equipmentConfig, identifyEquipmentCatalog,
  normalizeFailureClassifierWorkbook, getDatasetSchemaVersion, dkn, xlsx
}) {
  const handlers = new Map(referenceIds.map(id=>[
    id, (file,fingerprint)=>processReferenceFile(id,file,fingerprint,sha256)
  ]));
  const workbookHandler = (getSchemaVersion, normalize) => async file => {
    const normalized = normalize(await readWorkbook(file,xlsx),file);
    return {
      ...normalized,
      file, records:normalized.records || [],
      meta:{...normalized.meta,sourceType:'user',fileName:file.name,fileSize:file.size,
        schemaVersion:getSchemaVersion(),loadedAt:new Date().toISOString()}
    };
  };

  for (const id of equipmentIds) {
    handlers.set(id,workbookHandler(()=>equipmentConfig[id].schemaVersion,(workbook,file)=>
      normalizeEquipmentWorkbook(id,workbook,{
        loadedAt:new Date().toISOString(),fileName:file.name,fileSize:file.size,
        freshness:identifyEquipmentCatalog?.(file.name)?.freshness || null,
        schemaVersion:equipmentConfig[id].schemaVersion,sourceType:'user'
      })));
  }
  handlers.set('failure_classifier',workbookHandler(
    ()=>getDatasetSchemaVersion('failure_classifier'),normalizeFailureClassifierWorkbook));
  handlers.set('dkn_roadmap',workbookHandler(()=>dkn.schemaVersion,
    workbook=>dkn.normalizeWorkbook(workbook,{xlsx})));

  return async ({file},id,fingerprint) => {
    const handler = handlers.get(id);
    if (!handler) throw new Error('Для типа ' + id + ' отсутствует обработчик.');
    const result = await handler(file,fingerprint);
    return referenceIds.includes(id) ? result : {...result,id};
  };
}
