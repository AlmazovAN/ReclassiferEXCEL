// FILE CONTRACT: persistent source-observation and event history for Equipment.
// This history is evidence of catalog observations, NOT proof of commissioning.
// In HTML it travels in source-instance meta; in SQLite in dataset_state.
// Equipment_Combined and Drivers remain derived/independent, respectively.
(() => {
  'use strict';
  const IDS = Object.freeze(['mounted','stationary','transport','transport_start_points','zabbix']);
  const partitionApi = globalThis.ReclassifierEquipmentPartitions;
  const norm = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ')
    .trim().toLocaleLowerCase('ru-RU');
  const validDay = value => {
    const str=String(value||'').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
    const date=new Date(str+'T00:00:00.000Z');
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,10)===str ? str : null;
  };
  const dayFromFile = name => validDay(String(name||'').match(/20\d{2}-\d{2}-\d{2}/)?.[0]);
  const idValue = (id,row) => {
    if (id==='transport_start_points') {
      const u=norm(row?.unit),n=norm(row?.name);
      return u && n ? u+'\u001f'+n : null;
    }
    const field = id==='transport'?'transport__id':
      id==='zabbix'?'zabbix__id':'id';
    const raw=row?.[field];
    return raw===undefined || raw===null || String(raw).trim()==='' ? null :
      String(raw).trim().replace(/\.0$/,'');
  };
  const scope = (id,row) => norm(row?.[id==='zabbix'?'__partition_unit':'unit']);
  const trimText = v => v === undefined || v === null ? null : String(v).trim() || null;
  const stateOf = (id,row) => ({
    id:idValue(id,row),
    unit:trimText(row?.[id==='zabbix'?'__partition_unit':'unit']),
    name:trimText(row?.name || row?.zabbix__name),
    location:trimText(row?.location || row?.transport__location ||
      row?.zabbix__site_address_b),
    transport:trimText(row?.transport),
    equipmentType:trimText(row?.equipment_type || row?.zabbix__zabbix_equipment_type__name),
    notWorkingSince:trimText(row?.not_working_since),
    // Unverified raw field retained as an attribute, never interpreted as
    // confirmed commissioning or used to backdate observations.
    commissioningDateUnverified:trimText(row?.commissioning_date),
    status:row?.not_working_since ? 'Не активен' : 'Активен'
  });
  const stable = value => JSON.stringify(value);
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  function validateUnique(id,rows) {
    const index=new Map();
    for (const row of rows || []) {
      const identifier=idValue(id,row);
      if (!identifier || index.has(identifier)) {
        throw new Error('Equipment History: пустой или повторный ID в '+id+'.');
      }
      index.set(identifier,row);
    }
    return index;
  }
  function recordEvent(history,type,id,before,after,context,eventDate=null) {
    history.events.push({
      type, datasetId:context.datasetId, id,
      sourceDate:context.sourceDate, observedAt:context.recordedAt,
      eventDate, sourceFile:context.sourceName,
      before:before ? copy(before) : null,
      after:after ? copy(after) : null
    });
  }
  function observe(request) {
    const {datasetId,previousRows,nextRows,previousHistory}=request || {};
    if (!IDS.includes(datasetId) ||
        !Array.isArray(previousRows) || !Array.isArray(nextRows)) {
      throw new Error('Equipment History: неправильный исходный каталог.');
    }
    const selected=Array.from(request.sections || [], norm).filter(Boolean);
    if (!selected.length || new Set(selected).size !== selected.length) {
      throw new Error('Equipment History: требуется полный перечень неповторяющихся секций.');
    }
    const selectedSet=new Set(selected);
    const oldIndex=validateUnique(datasetId,previousRows);
    const newIndex=validateUnique(datasetId,nextRows);
    const recordedAt=request.recordedAt || new Date().toISOString();
    if (Number.isNaN(new Date(recordedAt).valueOf())) {
      throw new Error('Equipment History: некорректная дата записи.');
    }
    const ctx={
      datasetId,sourceDate:validDay(request.sourceDate) ||
        dayFromFile(request.sourceName),recordedAt,
      sourceName:request.sourceName || null
    };
    const history=previousHistory ? copy(previousHistory) : {
      schemaVersion:1,events:[],snapshots:[],lastKnown:{}
    };
    if (history.schemaVersion!==1 || !Array.isArray(history.snapshots) ||
        !Array.isArray(history.events) || !history.lastKnown ||
        typeof history.lastKnown!=='object') {
      throw new Error('Equipment History: повреждён persisted журнал.');
    }
    const known=history.lastKnown;
    const scopedOld=Array.from(oldIndex.entries()).filter(([,row]) =>
      selectedSet.has(scope(datasetId,row)));
    const scopedNew=Array.from(newIndex.entries()).filter(([,row]) =>
      selectedSet.has(scope(datasetId,row)));
    // On first update, a pre-existing source is a baseline of unknown
    // observation time. Its freshness date may be recorded, but can never
    // be substituted with today's commit date or a commissioning date.
    const newlyTrackedOld=scopedOld.filter(([id])=>!known[id]);
    if (newlyTrackedOld.length) {
      const priorDate=validDay(request.previousSourceDate) ||
        dayFromFile(request.previousSourceName);
      history.snapshots.push({
        datasetId,kind:'inherited-baseline',sourceDate:priorDate,
        observedAt:null,sourceFile:request.previousSourceName || null,
        sections:selected.slice(),rows:newlyTrackedOld.map(([,r])=>stateOf(datasetId,r))
      });
      for (const [id,row] of newlyTrackedOld) {
        known[id]={snapshot:stateOf(datasetId,row),present:true,
          lastObservedSourceDate:priorDate,terminal:Boolean(row.not_working_since)};
      }
    }
    // Process the union to distinguish a missing row from a movement.
    // A row is absent only when its previous mine belongs to this
    // confirmed full-scope import and its ID no longer exists anywhere.
    const observedIds=new Set([...scopedOld.map(([id])=>id),
      ...scopedNew.map(([id])=>id)]);
    for (const id of observedIds) {
      const oldRow=oldIndex.get(id) || null;
      const newRow=newIndex.get(id) || null;
      const wasScoped=oldRow && selectedSet.has(scope(datasetId,oldRow));
      const isScoped=newRow && selectedSet.has(scope(datasetId,newRow));
      const before=oldRow ? stateOf(datasetId,oldRow) : known[id]?.snapshot || null;
      const after=newRow ? stateOf(datasetId,newRow) : null;
      const terminal=Boolean(known[id]?.terminal || before?.notWorkingSince);
      if (terminal && after &&
          (!after.notWorkingSince || after.notWorkingSince!==before?.notWorkingSince)) {
        throw new Error('Equipment History: окончательное выбытие ID '+id+
          ' нельзя отменить или изменить повторной выгрузкой.');
      }
      if (isScoped && !oldRow) {
        recordEvent(history,known[id]?'returned_to_observation':'first_observed',
          id,before,after,ctx);
      } else if (isScoped && oldRow) {
        if (norm(before?.unit)!==norm(after.unit)) {
          recordEvent(history,'moved',id,before,after,ctx);
        }
        if (!before?.notWorkingSince && after.notWorkingSince) {
          recordEvent(history,'decommissioned',id,before,after,ctx,
            validDay(after.notWorkingSince) ||
            validDay(String(after.notWorkingSince).slice(0,10)));
        }
        if (stable(before)!==stable(after) &&
            norm(before?.unit)===norm(after.unit) &&
            Boolean(before?.notWorkingSince)===Boolean(after.notWorkingSince)) {
          recordEvent(history,'attributes_changed',id,before,after,ctx);
        }
      } else if (wasScoped && !newRow) {
        recordEvent(history,'missing_from_complete_scope',id,before,null,ctx);
      }
      if (after) {
        known[id]={snapshot:after,present:true,
          lastObservedSourceDate:isScoped?ctx.sourceDate:
            (known[id]?.lastObservedSourceDate||null),
          terminal:terminal||Boolean(after.notWorkingSince)};
      } else if (wasScoped && known[id]) {
        known[id].present=false;
      }
    }
    // Record exact observed membership per updated mine only. Other mines
    // are neither refreshed nor silently assumed missing.
    history.snapshots.push({
      datasetId,kind:'observed-complete-scope',
      sourceDate:ctx.sourceDate,observedAt:ctx.recordedAt,
      sourceFile:ctx.sourceName,sections:selected.slice(),
      rows:scopedNew.map(([,row])=>stateOf(datasetId,row))
    });
    return history;
  }
  function timeline(history,id) {
    const k=String(id??'').trim();
    return Array.from(history?.events||[]).filter(x=>x.id===k);
  }
  const api=Object.freeze({
    version:'1.0.0',IDS,idValue,scope,dayFromFile,stateOf,observe,timeline
  });
  globalThis.ReclassifierEquipmentHistory=api;
  if (typeof module!=='undefined' && module.exports) module.exports=api;
})();
