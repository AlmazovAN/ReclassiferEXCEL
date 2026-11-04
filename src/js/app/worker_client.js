// FILE CONTRACT: shared WebWorker request client and fatal-error lifecycle.
// Purpose: create/recreate the browser Worker, correlate Promise requests and fail all
//          pending work immediately when the Worker transport/runtime dies.
// Owns: Worker instance, request registry, request timeout handles and worker generation.
// Reads: caller-provided Worker factory and callbacks only.
// Writes: transient Worker/request state only.
// Public API: createWorkerClient() inside the assembled application scope.
// Must not: render UI, inspect Dataset business data or access SQLite/storage directly.
// Related tests: test_worker_client.js, smoke_app_runtime.js, test_architecture_guardrails.py.

  function createWorkerClient(options = {}) {
    const createWorkerInstance = options.createWorker;
    if (typeof createWorkerInstance !== 'function') {
      throw new Error('Worker client требует createWorker().');
    }

    const requestTimeoutMs = Number(options.requestTimeoutMs) > 0
      ? Number(options.requestTimeoutMs)
      : 10 * 60 * 1000;
    // Reclassification includes two large XLSX serializations. Treat its timeout as
    // an inactivity watchdog, not a ten-minute deadline for the entire job.
    const reclassificationTimeoutMs = Number(options.reclassificationTimeoutMs) > 0
      ? Number(options.reclassificationTimeoutMs)
      : 20 * 60 * 1000;
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimer = options.clearTimeoutFn || clearTimeout;
    const onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {};
    const onFatal = typeof options.onFatal === 'function' ? options.onFatal : () => {};
    const onWorkerCreated = typeof options.onWorkerCreated === 'function'
      ? options.onWorkerCreated
      : () => {};
    // Terminate memory-heavy completed processors only when no other job is
    // using this shared Worker. The next request recreates it lazily.
    const recycleTypes = new Set(options.recycleAfterTypes || []);
    const onWorkerRecycled = typeof options.onWorkerRecycled === 'function'
      ? options.onWorkerRecycled : () => {};

    const pendingRequests = new Map();
    let requestSequence = 0;
    let workerGeneration = 0;
    let activeWorker = null;
    let disposed = false;
    let recyclePending = false;

    function clientState() {
      return Object.freeze({
        active: Boolean(activeWorker),
        generation: workerGeneration,
        pendingRequests: pendingRequests.size,
        disposed
      });
    }

    function requestError(message, code = null) {
      const error = new Error(message);
      if (code) error.code = code;
      return error;
    }

    function clearPending(requestId, error = null, payload = undefined) {
      const pending = pendingRequests.get(requestId);
      if (!pending) return false;
      pendingRequests.delete(requestId);
      clearTimer(pending.timeout);
      if (error) pending.reject(error);
      else pending.resolve(payload);
      return true;
    }

    function rejectAllPending(error) {
      const pending = Array.from(pendingRequests.entries());
      pendingRequests.clear();
      for (const [, request] of pending) {
        clearTimer(request.timeout);
        request.reject(error);
      }
      return pending.length;
    }

    function fatalWorkerError(kind, event, generation, worker) {
      if (worker !== activeWorker || generation !== workerGeneration) return;

      const message = kind === 'messageerror'
        ? 'WebWorker передал сообщение, которое не удалось прочитать.'
        : 'WebWorker аварийно завершил работу' +
          (event?.message ? ': ' + String(event.message) : '.');
      const error = event instanceof Error
        ? event
        : requestError(message, 'RECLASSIFIER_WORKER_FATAL');
      if (!error.code) error.code = 'RECLASSIFIER_WORKER_FATAL';
      error.workerFailureKind = kind;
      error.workerFailureReported = true;

      try { worker.terminate?.(); } catch (_) {}
      activeWorker = null;
      recyclePending = false;
      const rejectedRequests = rejectAllPending(error);
      onFatal(error, Object.freeze({
        kind,
        generation,
        rejectedRequests
      }));
    }

    function bindWorker(worker, generation) {
      worker.addEventListener('message', event => {
        if (worker !== activeWorker || generation !== workerGeneration) return;
        const message = event.data || {};
        const requestId = message.requestId || null;
        let settled = false;

        let completedType = null;
        if (requestId && pendingRequests.has(requestId)) {
          const pending = pendingRequests.get(requestId);
          if (message.type === 'WORKER_PROGRESS') {
            if (pending.heartbeat) pending.heartbeat(message.payload || {});
            try {
              pending.onProgress?.(message.payload || {});
            } catch (_) {}
          } else if (message.type === 'WORKER_STAGE_BATCH') {
            if (pending.heartbeat) pending.heartbeat({label:'Запись партии в SQLite'});
            // Backpressure: the Worker must wait for this ACK before sending
            // another batch. Exceptions are forwarded, never swallowed.
            Promise.resolve().then(() => {
              if (typeof pending.onBatch !== 'function') {
                throw new Error('Worker передал пакет без обработчика SQLite.');
              }
              return pending.onBatch(message.payload || {});
            }).then(() => {
              if (worker === activeWorker && generation === workerGeneration) {
                worker.postMessage({type:'WORKER_STAGE_ACK', requestId,
                  sequence:message.payload?.sequence, ok:true});
              }
            }, error => {
              if (worker === activeWorker && generation === workerGeneration) {
                worker.postMessage({type:'WORKER_STAGE_ACK', requestId,
                  sequence:message.payload?.sequence, ok:false,
                  error:error?.message || String(error)});
              }
            });
          } else if (message.type === 'WORKER_EXPORT_NEED_BATCH') {
            // Backpressure in the reverse direction: only read the next
            // bounded SQLite page after the Worker has appended the previous.
            if (pending.heartbeat) pending.heartbeat({label:'Чтение партии SQLite'});
            Promise.resolve().then(() => {
              if (typeof pending.onBatch !== 'function') {
                throw new Error('Не задан обработчик пакетного XLSX из SQLite.');
              }
              return pending.onBatch(message.payload || {});
            }).then(page => {
              if (worker === activeWorker && generation === workerGeneration) {
                worker.postMessage({type:'WORKER_EXPORT_BATCH', requestId,
                  sequence:message.payload?.sequence,ok:true,payload:page});
              }
            }, error => {
              if (worker === activeWorker && generation === workerGeneration) {
                worker.postMessage({type:'WORKER_EXPORT_BATCH', requestId,
                  sequence:message.payload?.sequence,ok:false,
                  error:error?.message || String(error)});
              }
            });
          } else if (message.type === 'WORKER_ERROR') {
            completedType = pending.type;
            settled = clearPending(
              requestId,
              requestError(message.payload?.message || 'Ошибка WebWorker.')
            );
          } else {
            completedType = pending.type;
            settled = clearPending(requestId, null, message.payload);
          }
        }

        onMessage(message, Object.freeze({ settled, generation }));
        if (settled && recycleTypes.has(completedType)) recyclePending = true;
        if (recyclePending && pendingRequests.size === 0 &&
            worker === activeWorker) {
          try { worker.terminate?.(); } catch (_) {}
          activeWorker = null;
          recyclePending = false;
          try { onWorkerRecycled({generation,completedType}); } catch (_) {}
        }
      });

      worker.addEventListener('error', event => {
        fatalWorkerError('error', event, generation, worker);
      });

      worker.addEventListener('messageerror', event => {
        fatalWorkerError('messageerror', event, generation, worker);
      });
    }

    function ensureWorker() {
      if (disposed) {
        throw requestError('WebWorker client уже остановлен.', 'RECLASSIFIER_WORKER_DISPOSED');
      }
      if (activeWorker) return activeWorker;

      let worker;
      try {
        worker = createWorkerInstance();
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      if (!worker) throw new Error('WebWorker недоступен.');

      workerGeneration += 1;
      activeWorker = worker;
      bindWorker(worker, workerGeneration);
      try {
        onWorkerCreated(worker, Object.freeze({ generation: workerGeneration }));
      } catch (error) {
        fatalWorkerError('initialization', error, workerGeneration, worker);
        throw error;
      }
      return worker;
    }

    function post(message, transfer = []) {
      const worker = ensureWorker();
      worker.postMessage(message, transfer);
      return worker;
    }

    function request(type, payload, transfer = [], onProgress = null, onBatch = null) {
      if (disposed) {
        return Promise.reject(
          requestError('WebWorker client уже остановлен.', 'RECLASSIFIER_WORKER_DISPOSED')
        );
      }

      let worker;
      try {
        worker = ensureWorker();
      } catch (error) {
        return Promise.reject(error);
      }

      const requestId = 'wrk-' + (++requestSequence);
      return new Promise((resolve, reject) => {
        const isReclassification = type === 'PROCESS_RECLASSIFICATION';
        const isStreamingExport = type === 'EXPORT_DATASET_XLSX_STREAM';
        const stagedMobile = type === 'PROCESS_MOBILE_BRIGADE' && payload?.streamToSqlite === true;
        const timeoutMs = isStreamingExport ? 30 * 60 * 1000 :
          (isReclassification ? reclassificationTimeoutMs : requestTimeoutMs);
        const timeoutMessage = isReclassification
          ? 'Нет ответа от WebWorker реклассификации более ' + Math.round(timeoutMs / 60000) +
            ' минут. Последний этап: '
          : 'WebWorker не завершил операцию за ' + Math.round(timeoutMs / 60000) + ' минут.';
        let lastStage = 'запуск';
        const pending = { resolve, reject, timeout: null, type,
          onProgress: typeof onProgress === 'function' ? onProgress : null,
          onBatch: typeof onBatch === 'function' ? onBatch : null };
        const arm = () => {
          if (pending.timeout !== null) clearTimer(pending.timeout);
          pending.timeout = setTimer(() => {
            if (!pendingRequests.has(requestId)) return;
            const message = isReclassification ? timeoutMessage + lastStage + '.' : timeoutMessage;
            fatalWorkerError('timeout', requestError(message, 'RECLASSIFIER_WORKER_TIMEOUT'),
              workerGeneration, worker);
          }, timeoutMs);
        };
        if (isReclassification || stagedMobile || isStreamingExport) {
          pending.heartbeat = progress => {
            if (progress?.label) lastStage = String(progress.label);
            arm();
          };
        }
        pendingRequests.set(requestId, pending);
        arm();
        try {
          worker.postMessage({ type, requestId, payload }, transfer);
        } catch (error) {
          clearPending(
            requestId,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      });
    }

    function start() {
      try {
        ensureWorker();
        return true;
      } catch (error) {
        if (!error?.workerFailureReported) {
          onFatal(error instanceof Error ? error : new Error(String(error)), Object.freeze({
            kind: 'create',
            generation: workerGeneration,
            rejectedRequests: 0
          }));
        }
        return false;
      }
    }

    function dispose(reason = 'WebWorker client остановлен.') {
      if (disposed) return;
      disposed = true;
      const error = requestError(reason, 'RECLASSIFIER_WORKER_DISPOSED');
      const worker = activeWorker;
      activeWorker = null;
      try { worker?.terminate?.(); } catch (_) {}
      rejectAllPending(error);
    }

    return Object.freeze({
      start,
      request,
      post,
      state: clientState,
      dispose
    });
  }
