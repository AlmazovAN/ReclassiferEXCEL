// FILE CONTRACT: mine-scoped Equipment source merge and safe join-index regeneration.
// Source-only provenance (unit, name, equipment, __partition_unit) is not
// published as an extra column of Equipment_Combined.
(() => {
  'use strict';
  const IDS = Object.freeze(['mounted','stationary','transport','transport_start_points','zabbix']);
  const UNKNOWN = '__equipment_unresolved_scope__';
  const key = v => String(v ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ')
    .trim().toLocaleLowerCase('ru-RU');
  const idKey = v => String(v ?? '').trim().replace(/\.0$/, '');
  const joinKey = (unit,name) => key(unit) && key(name) ? key(unit)+'\u001f'+key(name) : null;
  function ownership(catalogs) {
    const owners = new Map();
    for (const id of ['mounted','stationary']) {
      for (const row of catalogs?.[id]?.records || []) {
        const rid=idKey(row?.id), unit=key(row?.unit);
        if (!rid || !unit) continue;
        if (owners.has(rid) && owners.get(rid) !== unit) owners.set(rid,null);
        else if (!owners.has(rid)) owners.set(rid,unit);
      }
    }
    return owners;
  }
  function upgrade(id, current, ownerMap) {
    let rows = Array.from(current?.records || [], x => ({...x}));
    const index=current?.joinIndex instanceof Map ? current.joinIndex : new Map();
    if (id === 'transport_start_points' && !rows.length && index.size) {
      rows=Array.from(index.keys(), k => {
        const parts=String(k).split('\u001f');
        return {unit:parts[0] || null,name:parts[1] || null};
      });
    }
    if (id === 'transport' && index.size) {
      const links=new Map();
      for (const [compound,value] of index) {
        const rid=idKey(value?.transport__id);
        if (!rid) continue;
        if (links.has(rid) && links.get(rid) !== compound) links.set(rid,null);
        else links.set(rid,compound);
      }
      rows=rows.map(row=>{
        if (row.unit && row.name) return row;
        const compound=links.get(idKey(row.transport__id));
        if (!compound) return {...row, unit:row.unit || UNKNOWN,
          name:row.name || UNKNOWN};
        const [unit,name]=compound.split('\u001f');
        return {...row,unit:row.unit || unit,name:row.name || name};
      });
    }
    if (id === 'zabbix') {
      const links=new Map();
      for (const [equipment, records] of index) {
        for (const linked of records || []) {
          const rid=idKey(linked?.zabbix__id);
          if (!rid) continue;
          const old=links.get(rid);
          if (old && old !== idKey(equipment)) links.set(rid,null);
          else if (!links.has(rid)) links.set(rid,idKey(equipment));
        }
      }
      rows=rows.map(row=>{
        const equipment=idKey(row.equipment || links.get(idKey(row.zabbix__id)));
        const unit=ownerMap?.get(equipment);
        return {...row,equipment:equipment || null,
          __partition_unit:unit || row.__partition_unit || UNKNOWN};
      });
    }
    return rows;
  }
  function joinIndex(id,rows) {
    const result=new Map();
    for (const row of rows) {
      if (id==='transport' || id==='transport_start_points') {
        const k=joinKey(row.unit,row.name);
        if (!k || row.unit===UNKNOWN) continue;
        if (!result.has(k)) result.set(k,id==='transport' ? row : true);
      } else if (id==='zabbix') {
        const k=idKey(row.equipment);
        if (!k) continue;
        if (!result.has(k)) result.set(k,[]);
        result.get(k).push(row);
      }
    }
    return result;
  }
  function mergeFileRows(id, batches, owners) {
    const baseCatalog = id === 'mounted' || id === 'stationary';
    const sections = new Map();
    const recordsById = new Map();

    for (const rows of batches) {
      const fileSections = new Map();
      for (const row of rows) {
        const unit = id === 'zabbix' ? owners?.get(idKey(row.equipment)) || row.__partition_unit : row.unit;
        const section = key(unit);
        if (!section || section === key(UNKNOWN)) {
          throw new Error('Equipment ' + id + ': секция не определена.');
        }
        if (!fileSections.has(section)) {
          fileSections.set(section, {schema: Object.keys(row).sort().join('|'), ids: new Set()});
        }
        if (!baseCatalog) continue;

        const k = idKey(row.id);
        const fileIds = fileSections.get(section).ids;
        const previous = recordsById.get(k);
        if (!k || fileIds.has(k) || (previous && previous.section !== section)) {
          throw new Error('Equipment ' + id + ': пустой или повторный ID в партии.');
        }
        fileIds.add(k);
        recordsById.set(k, {section, row: previous ? {...previous.row, ...row} : row});
      }

      for (const [section, {schema, ids}] of fileSections) {
        const previous = sections.get(section);
        if (!previous) {
          sections.set(section, {schemas: new Set([schema]), ids});
          continue;
        }
        // Overlapping exports must describe the same section snapshot in different formats.
        if (!baseCatalog || previous.schemas.has(schema) || ids.size !== previous.ids.size ||
            [...ids].some(k => !previous.ids.has(k))) {
          throw new Error('Equipment ' + id + ': неоднозначные файлы секции «' + section + '».');
        }
        previous.schemas.add(schema);
      }
    }

    return baseCatalog ? [...recordsById.values()].map(entry => entry.row) : batches.flat();
  }

  function merge(id,current,incoming,owners,options={}) {
    if (!IDS.includes(id)||!Array.isArray(incoming)||!incoming.length)
      throw new Error('Equipment: требуется непустая секционная партия '+id+'.');
    const field=id==='zabbix'?'__partition_unit':'unit';
    const upgraded=upgrade(id,current,owners);
    const incomingRows=upgrade(id,{records:incoming},owners);
    const labels=new Map();
    for (let i=0;i<incomingRows.length;i++) {
      const value=incomingRows[i][field], k=key(value);
      if (!k || k===key(UNKNOWN))
        throw new Error('Equipment '+id+': не определён рудник для записи '+(i+1)+
          '. Добавьте идентификатор секции или проверьте связь оборудования.');
      labels.set(k,String(value).trim());
    }
    const previous=[];
    let removed=0;
    for (const row of upgraded) {
      if (labels.has(key(row[field]))) removed++;
      else previous.push(row);
    }
    if (id === 'mounted' || id === 'stationary') {
      const existingById = new Map(upgraded.map(row => [idKey(row.id), row]));
      for (let i = 0; i < incomingRows.length; i++) {
        const row = incomingRows[i];
        incomingRows[i] = {...existingById.get(idKey(row.id)), ...row};
      }
    }
    const result=previous.concat(incomingRows);
    const idField={mounted:'id',stationary:'id',transport:'transport__id',zabbix:'zabbix__id'}[id];
    if (idField) {
      const seen=new Set();
      for (const row of result) {
        const k=idKey(row[idField]);
        if (!k) throw new Error('Equipment '+id+': пустой ID после секционной замены.');
        if (seen.has(k)) throw new Error('Equipment '+id+': повторный ID '+k+
          ' после секционной замены.');
        seen.add(k);
      }
    }
    if (id==='transport'||id==='transport_start_points') {
      const seen=new Set();
      for (const row of result) {
        const k=joinKey(row.unit,row.name);
        if (!k || row.unit===UNKNOWN) continue;
        if (seen.has(k)) throw new Error('Equipment '+id+': повторная связка unit/name '+k+'.');
        seen.add(k);
      }
    }
    return {
      records:result,
      joinIndex:joinIndex(id,result),
      partitionField:field,
      replacedPartitions:Array.from(labels.values()),
      removedRows:removed,
      preservedRows:previous.length,
      incomingRows:incomingRows.length
    };
  }
  const api=Object.freeze({key,idKey,joinKey,ownership,upgrade,joinIndex,mergeFileRows,merge,UNKNOWN});
  globalThis.ReclassifierEquipmentPartitions=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
