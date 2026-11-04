// FILE CONTRACT: serial, bounded, priority-based async KPI work queue (PR 4).
// No Dataset inspection, UI, SQLite, storage or business rules.
// Lower priority value runs first. A running Worker is not forcibly interrupted;
// cancellation suppresses its result and the next task starts at the safe boundary.
(() => {
  'use strict';

  function createKpiTaskScheduler(options = {}) {
    if (typeof options.run !== 'function') throw new TypeError('KPI scheduler requires run(job, onProgress).');
    const limit = Number.isInteger(options.maxPending) && options.maxPending > 0
      ? options.maxPending : 64;
    const listeners = new Set();
    if (typeof options.onChange === 'function') listeners.add(options.onChange);
    let queue = [];
    let active = null;
    let sequence = 0;
    let generation = 0;
    let disposed = false;
    const jobs = new Map();
    let completed = 0;
    let rejected = 0;

    function failure(code, message) {
      const error = new Error(message);
      error.code = code;
      return error;
    }
    function status() {
      return Object.freeze({
        state: disposed ? 'disposed' : active ? 'running' : queue.length ? 'queued' : 'idle',
        generation, queued: queue.length, active: active ? Object.freeze({
          priority: active.priority
        }) : null,
        completed, rejected
      });
    }
    function publish() {
      const current = status();
      for (const fn of listeners) {
        try { fn(current); } catch (_) { /* status UI must not stop calculations */ }
      }
    }
    function cleanup(task) {
      jobs.delete(task.key);
      if (task.signal && task.abortHandler) task.signal.removeEventListener('abort', task.abortHandler);
    }
    function settle(task, error, value) {
      if (task.settled) return;
      task.settled = true;
      cleanup(task);
      if (error) {
        rejected += 1;
        task.reject(error);
      } else {
        completed += 1;
        task.resolve(value);
      }
    }
    function cancelTask(task, code) {
      const error = failure(code, 'Задача KPI отменена или её данные устарели.');
      if (task !== active) {
        queue = queue.filter(item => item !== task);
      }
      settle(task, error);
      publish();
      pump();
    }
    function pump() {
      if (active || disposed) return;
      while (queue.length) {
        const task = queue.shift();
        if (task.settled || task.generation !== generation) {
          settle(task, failure('RECLASSIFIER_KPI_STALE_TASK', 'Устаревшая задача KPI.'));
          continue;
        }
        active = task;
        publish();
        Promise.resolve().then(() => {
          // Cancellation can happen after dispatch but BEFORE the
          // first microtask. A stale task must not spin up a new 300k-row Worker.
          if(task.settled || task.generation !== generation)
            throw failure('RECLASSIFIER_KPI_STALE_TASK','Отменённый KPI не запускается.');
          return options.run(task.payload, progress => {
          if (!task.settled && task.generation === generation) {
            try { task.onProgress?.(progress); } catch (_) {}
          }
          });
        }).then(value => {
          if (task.generation !== generation || task.settled) {
            settle(task, failure('RECLASSIFIER_KPI_STALE_TASK', 'Устаревший результат KPI.'));
          } else {
            settle(task, null, value);
          }
        }, error => {
          settle(task, error instanceof Error ? error : failure('RECLASSIFIER_KPI_WORKER_ERROR', String(error)));
        }).finally(() => {
          if (active === task) active = null;
          publish();
          pump();
        });
        return;
      }
      publish();
    }

    function enqueue({ key, priority = 2, payload = null, signal = null, onProgress = null } = {}) {
      if (disposed) return Promise.reject(failure('RECLASSIFIER_KPI_QUEUE_DISPOSED', 'Очередь KPI закрыта.'));
      if (typeof key !== 'string' || !key || key.length > 200 ||
          !Number.isInteger(priority) || priority < 0 || priority > 5) {
        return Promise.reject(failure('RECLASSIFIER_KPI_INVALID_TASK', 'Недопустимый ключ или приоритет KPI.'));
      }
      if (signal?.aborted) return Promise.reject(failure('RECLASSIFIER_KPI_CANCELLED', 'Задача KPI отменена.'));
      // Coalesce identical outstanding tasks without copying input Dataset twice.
      const previous = jobs.get(key);
      if (previous && !previous.settled) return previous.promise;
      if (queue.length >= limit) return Promise.reject(failure('RECLASSIFIER_KPI_QUEUE_FULL', 'Очередь KPI заполнена.'));
      let resolve;
      let reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      const task = { key, priority, payload, onProgress, signal, resolve, reject,
        promise, settled: false, sequence: ++sequence, generation, abortHandler: null };
      if (signal?.addEventListener) {
        task.abortHandler = () => cancelTask(task, 'RECLASSIFIER_KPI_CANCELLED');
        signal.addEventListener('abort', task.abortHandler, { once: true });
      }
      jobs.set(key, task);
      queue.push(task);
      queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence);
      publish();
      // Dispatch at the next microtask to allow a higher-priority user request
      // to overtake a background request added in the same browser turn.
      Promise.resolve().then(pump);
      return promise;
    }
    function invalidate() {
      generation += 1;
      for (const task of queue.slice()) cancelTask(task, 'RECLASSIFIER_KPI_STALE_TASK');
      queue = [];
      if (active) settle(active, failure('RECLASSIFIER_KPI_STALE_TASK', 'Источник KPI изменён.'));
      publish();
    }
    function dispose() {
      if (disposed) return;
      invalidate();
      disposed = true;
      listeners.clear();
    }
    return Object.freeze({ enqueue, invalidate, dispose, status,
      subscribe(fn) {
        if (typeof fn !== 'function') throw new TypeError('Expected status subscriber.');
        listeners.add(fn);
        return () => listeners.delete(fn);
      }
    });
  }

  globalThis.ReclassifierKpiTaskScheduler = Object.freeze({ create: createKpiTaskScheduler });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.ReclassifierKpiTaskScheduler;
})();
