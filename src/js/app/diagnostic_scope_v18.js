// TEST_18: diagnostic identity is the HTML artifact, NOT the SQLite filename.
// Diagnostics are private to the local browser profile and URL storage origin.
(() => {
  'use strict';
  const testLabel=String(globalThis.RECLASSIFIER_BUILD?.testLabel||'release');
  const enabled=testLabel.startsWith('TEST_18_');
  let filename='unknown.html',sourcePath='/unknown.html';
  try {
    sourcePath=String(globalThis.location?.pathname||'/unknown.html');
    const last=sourcePath.split('/').pop()||'unknown.html';
    filename=decodeURIComponent(last).slice(0,120);
  }catch(_){}
  // Full path distinguishes equal filenames in different local folders.
  // Only filename and a non-reversible fingerprint appear in diagnostics.
  const key=testLabel+'|'+sourcePath;
  let hash=2166136261;
  for(let i=0;i<key.length;i++)hash=Math.imul(hash^key.charCodeAt(i),16777619)>>>0;
  const suffix=hash.toString(16).padStart(8,'0');
  globalThis.ReclassifierDiagnosticScope=Object.freeze({
    enabled,filename,testLabel,
    fingerprint:suffix,
    maxSessions:4,maxEventsPerSession:384,
    databaseName:'ReclassifierDiagnosticHistoryV18_'+suffix,
    walPrefix:'reclassifier.diagnostic-wal.v18.'+suffix+'.',
    v2Key:'reclassifier.diagnostic-v2.v18.'+suffix,
    runtimeKey:'reclassifier.database.oom-phases.v18.'+suffix
  });
})();
