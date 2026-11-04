// TEST_13: append-only diagnostic archive. WAL is written synchronously; IndexedDB
// commits drain WAL asynchronously. Neither storage API guarantees fsync on OS crash.
// Only numeric/phase records supplied by the two existing allowlisted loggers enter here.
(() => {
  'use strict';
  const scope=globalThis.ReclassifierDiagnosticScope;
  const bounded=scope?.enabled===true;
  const MAX_ROWS=bounded?scope.maxEventsPerSession:Infinity;
  const MAX_SESSIONS=bounded?scope.maxSessions:Infinity;
  const DB_NAME=bounded?scope.databaseName:'ReclassifierDiagnosticHistoryV13', DB_VERSION=1;
  const WAL_PREFIX=bounded?scope.walPrefix:'reclassifier.diagnostic-wal.v13.';
  let dbPromise=null, idbStatus='uninitialized', failure=null;
  const pending=new Set();
  const validKinds=new Set(['runtime','xlsx']);
  const safeId=id=>typeof id==='string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(id);
  const withPromise=request=>new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error||Error('IndexedDB error'));
  });
  function openDb() {
    if(dbPromise)return dbPromise;
    if(typeof indexedDB==='undefined') {
      idbStatus='unavailable'; return Promise.resolve(null);
    }
    idbStatus='opening';
    dbPromise=new Promise(resolve=>{
      try {
        const req=indexedDB.open(DB_NAME,DB_VERSION);
        req.onupgradeneeded=()=>{
          const db=req.result;
          if(!db.objectStoreNames.contains('events'))
            db.createObjectStore('events',{keyPath:'id'});
          if(!db.objectStoreNames.contains('sessions'))
            db.createObjectStore('sessions',{keyPath:'id'});
        };
        req.onsuccess=()=>{
          idbStatus='available';resolve(req.result);
          req.result.onversionchange=()=>req.result.close();
        };
        req.onerror=()=>{
          failure='idb-open-failed';idbStatus='error';resolve(null);
        };
        req.onblocked=()=>{
          failure='idb-blocked';idbStatus='blocked';resolve(null);
        };
      }catch(_){failure='idb-open-threw';idbStatus='error';resolve(null);}
    });
    return dbPromise;
  }
  function sessionMeta(kind,sessionId,report) {
    const src=report&&typeof report==='object'?report:{};
    const {events,__lastHeapSample,__lastMainHeapSample,__lastWorkerHeapSample,
      startedEpochMs,...metadata}=src;
    return {id:kind+'|'+sessionId,kind,sessionId,metadata};
  }
  function entryKey(kind,sessionId,seq) {
    return kind+'|'+sessionId+'|'+String(seq).padStart(12,'0');
  }
  function walKey(kind,sessionId,seq) {
    return WAL_PREFIX+entryKey(kind,sessionId,seq);
  }
  function walItems() {
    const entries=[];
    try {
      for(let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if(key?.startsWith(WAL_PREFIX)) {
          try {
            const value=JSON.parse(localStorage.getItem(key));
            if(value?.id&&value?.kind&&value?.sessionId&&
                Number.isSafeInteger(value.seq))entries.push({key,value});
          }catch(_) {failure='wal-corrupt-entry'; /* keep it for manual recovery */ }
        }
      }
    }catch(_) {}
    return entries;
  }
  async function commit(record) {
    const db=await openDb();
    if(!db)return false;
    return new Promise(resolve=>{
      try {
        let tx;
        if(['TEST_16_PR326','TEST_17_PR332','TEST_18_PR335'].includes(globalThis.RECLASSIFIER_BUILD?.testLabel)){
          try {
            const critical=record?.event?.event==='start';
            tx=db.transaction(['events','sessions'],'readwrite',
              {durability:critical?'strict':'relaxed'});
          } catch (_) { /* unsupported durability option */ }
        }
        tx ||= db.transaction(['events','sessions'],'readwrite');
        tx.objectStore('events').put({id:record.id,kind:record.kind,
          sessionId:record.sessionId,seq:record.seq,event:record.event});
        if(bounded&&record.seq>=MAX_ROWS){
          // O(1) fixed-size tail, no scan/allocation on each append.
          tx.objectStore('events').delete(entryKey(record.kind,record.sessionId,
            record.seq-MAX_ROWS));
        }
        tx.objectStore('sessions').put(record.session);
        tx.oncomplete=()=>{
          try {localStorage.removeItem(record.walKey);}catch(_){}
          resolve(true);
        };
        tx.onerror=()=>{failure='idb-transaction-failed';resolve(false);};
        tx.onabort=()=>{failure='idb-transaction-aborted';resolve(false);};
      } catch(_) {failure='idb-transaction-threw';resolve(false);}
    });
  }
  function track(promise) {
    pending.add(promise);
    promise.finally(()=>pending.delete(promise));
  }

  async function pruneSessions() {
    if(!bounded)return;
    const db=await openDb();
    if(!db)return;
    await new Promise(resolve=>{
      try {
        const tx=db.transaction(['events','sessions'],'readwrite');
        const sessions=tx.objectStore('sessions');
        const list=sessions.getAll();
        list.onsuccess=()=>{
          const groups=new Map();
          for(const item of list.result||[]){
            const array=groups.get(item.kind)||[];
            array.push(item);groups.set(item.kind,array);
          }
          const expired=new Set();
          for(const array of groups.values()){
            array.sort((a,b)=>String(b.metadata?.startedAt||'')
              .localeCompare(String(a.metadata?.startedAt||'')));
            for(const old of array.slice(MAX_SESSIONS)){
              expired.add(old.sessionId);
              sessions.delete(old.id);
            }
          }
          if(expired.size){
            const cursor=tx.objectStore('events').openCursor();
            cursor.onsuccess=()=>{
              const item=cursor.result;
              if(!item)return;
              if(expired.has(item.value.sessionId))item.delete();
              item.continue();
            };
          }
        };
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>resolve();
        tx.onabort=()=>resolve();
      }catch(_){resolve();}
    });
  }
  function append(kind,sessionId,seq,event,report) {
    if(!validKinds.has(kind)||!safeId(sessionId)||!Number.isSafeInteger(seq)||seq<0)return false;
    const v2=globalThis.ReclassifierDiagnosticV2;
    const stamp=v2?.enabled?.()?v2.event(kind,sessionId,seq,event):null;
    // Never mutate the caller's ring-buffer entry.
    const storedEvent=stamp?{...event,v2:stamp}:event;
    const record={id:entryKey(kind,sessionId,seq),kind,sessionId,seq,
      event:storedEvent,session:sessionMeta(kind,sessionId,report)};
    record.walKey=walKey(kind,sessionId,seq);
    let written=false;
    try {
      localStorage.setItem(record.walKey,JSON.stringify(record));
      written=true;
    }catch(_) {failure='wal-storage-unavailable-or-full';}
    // If WAL is blocked, IndexedDB may still preserve data, but there is a
    // crash window until its transaction commits. This is reported explicitly.
    v2?.ack?.(stamp?.globalSeq,written);
    const done=commit(record);
    track(done);
    if(bounded&&seq===0)track(done.then(pruneSessions));
    return written;
  }
  async function saveSession(kind,sessionId,report) {
    if(!validKinds.has(kind)||!safeId(sessionId))return false;
    const db=await openDb();if(!db)return false;
    return new Promise(resolve=>{
      try{
        const tx=db.transaction('sessions','readwrite');
        tx.objectStore('sessions').put(sessionMeta(kind,sessionId,report));
        tx.oncomplete=()=>resolve(true);
        tx.onerror=()=>resolve(false);
        tx.onabort=()=>resolve(false);
      }catch(_){resolve(false);}
    });
  }
  async function recoverWal() {
    const rows=walItems().sort((a,b)=>a.value.id.localeCompare(b.value.id));
    const promises=[];
    for(const {key,value} of rows) {
      if(!validKinds.has(value.kind)||!safeId(value.sessionId))continue;
      if(value.walKey!==key)value.walKey=key;
      promises.push(commit(value));
    }
    await Promise.all(promises);
  }
  async function drain() {
    await Promise.all(Array.from(pending));
    await recoverWal();
  }
  async function collect(kind,current=null) {
    if(!validKinds.has(kind))throw Error('Unknown diagnostic journal');
    await drain();
    const sessions=new Map(),eventsBySession=new Map();
    const db=await openDb();
    if(db){
      try{
        const tx=db.transaction(['sessions','events'],'readonly');
        const [ss,es]=await Promise.all([
          withPromise(tx.objectStore('sessions').getAll()),
          withPromise(tx.objectStore('events').getAll())
        ]);
        for(const s of ss)if(s.kind===kind)sessions.set(s.sessionId,{...s.metadata,sessionId:s.sessionId});
        for(const e of es)if(e.kind===kind){
          const events=eventsBySession.get(e.sessionId)||new Map();
          events.set(e.seq,e.event);
          eventsBySession.set(e.sessionId,events);
        }
      }catch(_){failure='idb-read-failed';}
    }
    // WAL is authoritative for uncommitted events when IndexedDB is blocked.
    for(const {value:e} of walItems())if(e.kind===kind){
      // The first WAL event may say "running" while its final checkpoint
      // says "prepared". Recover the newest metadata by eventCount; do not
      // accidentally replace a newer IndexedDB session with an older WAL row.
      const metadata=e.session.metadata;
      const stored=sessions.get(e.sessionId);
      if(!stored || Number(metadata?.eventCount||0)>=Number(stored.eventCount||0))
        sessions.set(e.sessionId,{...metadata,sessionId:e.sessionId});
      const events=eventsBySession.get(e.sessionId)||new Map();
      events.set(e.seq,e.event);eventsBySession.set(e.sessionId,events);
    }
    if(current?.sessionId){
      sessions.set(current.sessionId,{...current});
      const events=eventsBySession.get(current.sessionId)||new Map();
      const offset=Number(current.discardedEvents)||0;
      for(let i=0;i<(current.events?.length||0);i++)events.set(offset+i,current.events[i]);
      eventsBySession.set(current.sessionId,events);
    }
    const ordered=Array.from(sessions.entries()).map(([sessionId,record])=>{
      const ev=eventsBySession.get(sessionId)||new Map();
      return {...record,events:Array.from(ev.entries()).sort((a,b)=>a[0]-b[0]).map(x=>x[1]),
        archivedEventCount:ev.size};
    }).sort((a,b)=>String(a.startedAt||'').localeCompare(String(b.startedAt||'')));
    const count=ordered.reduce((n,s)=>n+s.events.length,0);
    const expected=ordered.reduce((n,s)=>
      n+(bounded?Math.min(Number(s.eventCount||0),MAX_ROWS):
        (s.eventCount||s.events.length)),0);
    // Gaps are a conservative lower bound. Some older loggers replaced their
    // final session metadata entry without creating a new event.
    const missingSequences=Math.max(0,expected-count);
    const v2=globalThis.ReclassifierDiagnosticV2;
    return {schemaVersion:2,testLabel:globalThis.RECLASSIFIER_BUILD?.testLabel||'TEST_13_PR322',kind,
      generatedAt:new Date().toISOString(),
      ...(bounded?{htmlFile:scope.filename,archiveScope:scope.fingerprint,
        archivePolicy:{maxSessionsPerKind:MAX_SESSIONS,
          maxEventsPerSession:MAX_ROWS,retention:'last-N-sessions-and-events'}}:{}),
      ...(v2?.enabled?.()?{diagnosticV2:v2.status()}:{}),
      storage:{
        idbStatus,walPending:walItems().filter(x=>x.value.kind===kind).length,
        error:failure,eventsRecovered:count,
        missingSequences,
        intentionallyPruned:bounded,
        completenessKnown:db!==null&&missingSequences===0,
        warning:'After process/OS crash, IndexedDB/WAL durability is best-effort; file:// storage may be unavailable.'},
      sessions:ordered};
  }
  async function counts() {
    // Read-only cursor, no full array of archived events in JS memory.
    // Include WAL records not yet committed to IndexedDB, deduplicated by ID.
    await drain();
    const pendingWal=new Map(walItems().map(({value})=>[value.id,value.kind]));
    const result={runtime:0,xlsx:0,sessions:0,storage:idbStatus,
      walPending:pendingWal.size};
    const db=await openDb();
    if(db){
      const scan=storeName=>new Promise(resolve=>{
        try{
          const tx=db.transaction(storeName,'readonly');
          const request=tx.objectStore(storeName).openCursor();
          request.onsuccess=()=>{
            const cursor=request.result;
            if(!cursor)return;
            const row=cursor.value;
            if(storeName==='events'){
              if(row.kind==='runtime'||row.kind==='xlsx')result[row.kind]++;
              pendingWal.delete(row.id);
            } else result.sessions++;
            cursor.continue();
          };
          tx.oncomplete=()=>resolve();
          tx.onerror=()=>resolve();
          tx.onabort=()=>resolve();
        }catch(_){resolve();}
      });
      await scan('events');await scan('sessions');
    }
    for(const kind of pendingWal.values())
      if(kind==='runtime'||kind==='xlsx')result[kind]++;
    return result;
  }

  async function download(kind,current,fileName) {
    if(typeof document==='undefined'||typeof Blob==='undefined'||
       typeof URL==='undefined')return false;
    const payload=await collect(kind,current);
    let url=null;
    try{
      url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,bounded?0:2)],
        {type:'application/json;charset=utf-8'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download=fileName;anchor.style.display='none';
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      return true;
    }catch(_){failure='report-download-failed';return false;}
    finally{if(url)setTimeout(()=>URL.revokeObjectURL(url),10000);}
  }
  function status() {
    return {indexedDB:idbStatus,pendingWrites:pending.size,
      walPending:walItems().length,error:failure};
  }
  // Asynchronously promote stale WAL events from a previous tab instance.
  const bootstrap=openDb().then(()=>recoverWal()).catch(()=>{failure='recovery-failed';});
  globalThis.ReclassifierDiagnosticHistory=Object.freeze({
    append,saveSession,drain,collect,counts,download,status,
    bootstrap:()=>bootstrap,
    newSessionId:()=>new Date().toISOString().replace(/[^0-9A-Za-z]/g,'')+
      '_'+Math.random().toString(36).slice(2,10)
  });
})();
