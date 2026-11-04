// One in-flight stage batch per Worker request. Never queue unbounded records.
const stageAcks = new Map();
const exportBatchResolvers = new Map();
function requestExportBatch(requestId, sequence, offset) {
  const key = requestId + ':' + sequence;
  if (exportBatchResolvers.has(key)) {
    return Promise.reject(new Error('Повтор партии Excel.'));
  }
  return new Promise((resolve,reject)=>{
    exportBatchResolvers.set(key,{resolve,reject});
    self.postMessage({
      type:'WORKER_EXPORT_NEED_BATCH',requestId,
      payload:{sequence,offset}
    });
  });
}

function publishStagedBatch(requestId, sequence, rows) {
  const key = requestId + ':' + sequence;
  if (stageAcks.has(key)) return Promise.reject(new Error('Повторная партия SQLite.'));
  return new Promise((resolve, reject) => {
    stageAcks.set(key, {resolve, reject});
    self.postMessage({type:'WORKER_STAGE_BATCH', requestId,
      payload:{sequence, rows}});
  });
}

self.onmessage = async (event) => {
  const message = event.data || {};
  const requestId = message.requestId || null;

  if (message.type === 'WORKER_STAGE_ACK') {
    const key = requestId + ':' + message.sequence;
    const waiting = stageAcks.get(key);
    if (waiting) {
      stageAcks.delete(key);
      if (message.ok) waiting.resolve();
      else waiting.reject(new Error(message.error || 'Ошибка записи пакета SQLite.'));
    }
    return;
  }

  if (message.type === 'WORKER_EXPORT_BATCH') {
    const key = requestId + ':' + message.sequence;
    const waiting = exportBatchResolvers.get(key);
    if (waiting) {
      exportBatchResolvers.delete(key);
      if (message.ok) waiting.resolve(message.payload || {});
      else waiting.reject(new Error(message.error || 'Ошибка чтения SQLite для XLSX.'));
    }
    return;
  }

  if (message.type === 'PING') {
    self.postMessage({
      type: 'READY',
      requestId,
      payload: {
        worker: 'browser-worker',
        version: '1.2.0',
        reclassification: Boolean(self.ReclassifierReclassificationWorkerProcessor),
        itsm: Boolean(self.ReclassifierItsmWorkerProcessor),
        mobileBrigade: Boolean(self.ReclassifierMobileBrigadeWorkerProcessor),
        sheetjs: typeof self.XLSX !== 'undefined'
      }
    });
    return;
  }

  if (message.type === 'PROCESS_RECLASSIFICATION') {
    try {
      if (!self.ReclassifierReclassificationWorkerProcessor) {
        throw new Error('Reclassification worker processor is unavailable.');
      }
      const result = await self.ReclassifierReclassificationWorkerProcessor.process(
        message.payload || {},
        progress => self.postMessage({ type: 'WORKER_PROGRESS', requestId, payload: progress || {} })
      );
      self.postMessage({
        type: 'RECLASSIFICATION_RESULT',
        requestId,
        payload: result
      }, [result.bytes, result.reclassBytes].filter(buffer => buffer instanceof ArrayBuffer));
    } catch (error) {
      self.postMessage({
        type: 'WORKER_ERROR',
        requestId,
        payload: {
          message: error?.message || String(error),
          stack: error?.stack || null
        }
      });
    }
    return;
  }

  if (message.type === 'PROCESS_ITSM') {
    try {
      if (!self.ReclassifierItsmWorkerProcessor) {
        throw new Error('ITSM worker processor is unavailable.');
      }
      const result = await self.ReclassifierItsmWorkerProcessor.process(
        message.payload || {},
        progress => self.postMessage({
          type: 'WORKER_PROGRESS',
          requestId,
          payload: progress || {}
        })
      );
      self.postMessage({
        type: 'ITSM_RESULT',
        requestId,
        payload: result
      }, result.bytes instanceof ArrayBuffer ? [result.bytes] : []);
    } catch (error) {
      self.postMessage({
        type: 'WORKER_ERROR',
        requestId,
        payload: {
          message: error?.message || String(error),
          stack: error?.stack || null
        }
      });
    }
    return;
  }

  if (message.type === 'PROCESS_MOBILE_BRIGADE') {
    try {
      if (!self.ReclassifierMobileBrigadeWorkerProcessor) {
        throw new Error('Mobile Brigade worker processor is unavailable.');
      }
      const result = await self.ReclassifierMobileBrigadeWorkerProcessor.process(
        message.payload || {},
        progress => self.postMessage({
          type: 'WORKER_PROGRESS',
          requestId,
          payload: progress || {}
        }),
        (rows, sequence) => publishStagedBatch(requestId, sequence, rows)
      );
      self.postMessage({
        type: 'MOBILE_BRIGADE_RESULT',
        requestId,
        payload: result
      }, result.bytes instanceof ArrayBuffer ? [result.bytes] : []);
    } catch (error) {
      self.postMessage({
        type: 'WORKER_ERROR',
        requestId,
        payload: {
          message: error?.message || String(error),
          stack: error?.stack || null
        }
      });
    }
    return;
  }

  if (message.type === 'EXPORT_DATASET_XLSX_STREAM') {
    let sequence=0;
    const exportTrace = (phase,event,values={}) => {
      try {
        self.postMessage({type:'WORKER_PROGRESS',requestId,
          payload:{diagnostic:{phase,event,values}}});
      } catch (_) {}
    };
    try {
      exportTrace('xlsx-worker-export','start',{columns:message.payload?.columns?.length || 0});
      const writer=self.ReclassifierDatasetExportWorkerProcessor?.createStream?.(
        message.payload || {}, exportTrace
      );
      if(!writer) throw new Error('Пакетный XLSX Writer недоступен.');
      let offset=0;
      for (;;) {
        const waitingStarted=Date.now();
        exportTrace('xlsx-worker-wait-batch','start',{batchNumber:sequence+1,offset});
        const page=await requestExportBatch(requestId,sequence,offset);
        exportTrace('xlsx-worker-wait-batch','end',{batchNumber:sequence+1,
          batchRows:page.rows?.length || 0,offset,waitMs:Math.max(0,Date.now()-waitingStarted)});
        if (!Array.isArray(page.rows) || page.rows.length>10000 ||
            typeof page.hasMore !== 'boolean') {
          throw new Error('Некорректная партия SQLite для единого XLSX.');
        }
        if(!page.rows.length && page.hasMore) {
          throw new Error('SQLite вернула пустую промежуточную партию.');
        }
        offset=writer.append(page.rows);
        self.postMessage({type:'WORKER_PROGRESS',requestId,payload:{
          label:'Добавлено строк Excel: '+offset.toLocaleString('ru-RU'),
          rows:offset
        }});
        if(!page.hasMore) break;
        sequence++;
      }
      const result=writer.finish(progress=>self.postMessage({
        type:'WORKER_PROGRESS',requestId,payload:progress || {}
      }));
      exportTrace('xlsx-worker-transfer','start',{outputBytes:result.bytes?.byteLength || 0,
        totalRows:result.rows || 0});
      self.postMessage({type:'DATASET_XLSX_RESULT',requestId,payload:result},
        result.bytes instanceof ArrayBuffer?[result.bytes]:[]);
      // Transfer completion is not confirmation of disk saving or main-thread receipt.
    } catch(error) {
      exportTrace('xlsx-worker-export','error',{batchNumber:sequence+1});
      self.postMessage({type:'WORKER_ERROR',requestId,payload:{
        message:error?.message || String(error)
      }});
    } finally {
      for (const [key,waiting] of exportBatchResolvers) {
        if (!key.startsWith(requestId+':')) continue;
        exportBatchResolvers.delete(key);
        waiting.reject(new Error('Экспорт Excel завершён.'));
      }
    }
    return;
  }

  if (message.type === 'EXPORT_DATASET_XLSX') {
    try {
      if (!self.ReclassifierDatasetExportWorkerProcessor?.process) {
        throw new Error('Обработчик экспорта Full Dataset недоступен.');
      }
      const result = await self.ReclassifierDatasetExportWorkerProcessor.process(
        message.payload || {},
        progress => self.postMessage({
          type: 'WORKER_PROGRESS',
          requestId,
          payload: progress || {}
        })
      );
      self.postMessage({
        type: 'DATASET_XLSX_RESULT',
        requestId,
        payload: result
      }, [result.bytes]);
    } catch (error) {
      self.postMessage({
        type: 'WORKER_ERROR',
        requestId,
        payload: { message: error?.message || String(error) }
      });
    }
    return;
  }

  if (message.type === 'PROCESS') {
    self.postMessage({
      type: 'NOT_IMPLEMENTED',
      requestId,
      payload: {
        moduleId: message.moduleId || null,
        message: 'Предметная обработка этого аналитического модуля пока не реализована.'
      }
    });
  }
};
