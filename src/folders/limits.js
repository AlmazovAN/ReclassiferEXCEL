/* Load before the shared workbook engine. Browser storage replaces Node's temporary files. */
globalThis.window = globalThis;
globalThis.document = {getElementById:()=>null,querySelectorAll:()=>[]};

globalThis.ReclassifierLocalExportLimits = Object.freeze({
  maxBytes: 1024 * 1048576,
  maxPart: 512 * 1048576,
  maxDataPart: 3072 * 1048576,
  maxExpanded: 8192 * 1048576,
  chunkRows: 10000,
  flatSheets: true,
  nestedTargets: true,
  streamArchive: true,
  repairExports: true,
  hashBlob,
  stageRows,
  stageBook,
  compactReference(id, records) {
    const fields = {
      reclassification:['number','equipment','element','fault','incidentReason'],
      drivers:['name','mine','value','service','system'],
      initiators:['initiator','group'],
      customers:['mineKey','mine','mineSource','customerInternal'],
      type_request:['requestKey','shortDescription','workType'],
      exceptions:['exceptionKey','exception','decision'],
      problem_grade:['classifierKey','equipment','element','fault','reason','problemId','normalizationDecision']
    }[id];
    return fields ? records.map(record => Object.fromEntries(fields.map(field => [field,record[field]]))) : records;
  }
});
