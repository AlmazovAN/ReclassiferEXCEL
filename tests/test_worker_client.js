const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'js', 'app', 'worker_client.js'),
  'utf8'
);
const createWorkerClient = new Function(source + '\nreturn createWorkerClient;')();

class FakeWorker {
  constructor(name) {
    this.name = name;
    this.listeners = new Map();
    this.posted = [];
    this.terminated = false;
    this.failTypes = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message) {
    const failure = this.failTypes.get(message?.type);
    if (failure) {
      this.failTypes.delete(message.type);
      throw failure;
    }
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  requestMessage(type) {
    return this.posted.find(message => message?.type === type && message?.requestId);
  }
}

function deferredTick() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const workers = [];
  const fatalEvents = [];
  const routedMessages = [];
  const timers = new Map();
  let timerSequence = 0;

  const client = createWorkerClient({
    createWorker() {
      const worker = new FakeWorker('worker-' + (workers.length + 1));
      workers.push(worker);
      return worker;
    },
    requestTimeoutMs: 600000,
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 600000);
      const id = ++timerSequence;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) {
      timers.delete(id);
    },
    onWorkerCreated(worker) {
      worker.postMessage({ type: 'PING' });
    },
    onMessage(message, meta) {
      routedMessages.push({ message, meta });
    },
    onFatal(error, meta) {
      fatalEvents.push({ error, meta });
    }
  });

  assert.equal(client.start(), true);
  assert.equal(workers.length, 1);
  const firstWorker = workers[0];
  assert.deepEqual(firstWorker.posted[0], { type: 'PING' });

  const requestA = client.request('PROCESS_A', { value: 1 });
  const requestB = client.request('PROCESS_B', { value: 2 });
  assert.equal(client.state().pendingRequests, 2);
  assert.equal(timers.size, 2);

  firstWorker.emit('error', { message: 'synthetic crash' });

  const [settledA, settledB] = await Promise.allSettled([requestA, requestB]);
  for (const result of [settledA, settledB]) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason.code, 'RECLASSIFIER_WORKER_FATAL');
    assert.match(result.reason.message, /synthetic crash/);
  }
  assert.equal(firstWorker.terminated, true);
  assert.equal(timers.size, 0, 'Fatal failure must clear every request timeout.');
  assert.equal(client.state().pendingRequests, 0);
  assert.equal(client.state().active, false);
  assert.equal(fatalEvents.length, 1);
  assert.equal(fatalEvents[0].meta.kind, 'error');
  assert.equal(fatalEvents[0].meta.rejectedRequests, 2);

  // The next request must recreate the Worker instead of leaving the client dead.
  const progressC = [];
  const requestC = client.request('PROCESS_C', { value: 3 }, [], progress => progressC.push(progress));
  assert.equal(workers.length, 2);
  const secondWorker = workers[1];
  assert.deepEqual(secondWorker.posted[0], { type: 'PING' });
  const sentC = secondWorker.requestMessage('PROCESS_C');
  assert(sentC?.requestId);

  secondWorker.emit('message', {
    data: {
      type: 'READY',
      payload: { reclassification: true }
    }
  });
  secondWorker.emit('message', {
    data: {
      type: 'WORKER_PROGRESS',
      requestId: sentC.requestId,
      payload: { percent: 42, label: 'Обработка строк' }
    }
  });
  assert.equal(client.state().pendingRequests, 1, 'Progress must not settle the request.');
  assert.deepEqual(progressC, [{ percent: 42, label: 'Обработка строк' }]);
  secondWorker.emit('message', {
    data: {
      type: 'ITSM_RESULT',
      requestId: sentC.requestId,
      payload: { ok: true }
    }
  });
  assert.deepEqual(await requestC, { ok: true });
  assert.equal(client.state().pendingRequests, 0);
  assert(routedMessages.some(item => item.message.type === 'READY' && item.meta.settled === false));
  assert(routedMessages.some(item => item.message.type === 'WORKER_PROGRESS' && item.meta.settled === false));
  assert(routedMessages.some(item => item.message.type === 'ITSM_RESULT' && item.meta.settled === true));

  // A request-scoped WORKER_ERROR rejects only that request; the Worker stays alive.
  const requestD = client.request('PROCESS_D', {});
  const requestE = client.request('PROCESS_E', {});
  const sentD = secondWorker.requestMessage('PROCESS_D');
  const sentE = secondWorker.requestMessage('PROCESS_E');
  secondWorker.emit('message', {
    data: {
      type: 'WORKER_ERROR',
      requestId: sentD.requestId,
      payload: { message: 'business processing error' }
    }
  });
  await assert.rejects(requestD, /business processing error/);
  assert.equal(secondWorker.terminated, false);
  assert.equal(client.state().pendingRequests, 1);

  secondWorker.emit('message', {
    data: {
      type: 'MOBILE_BRIGADE_RESULT',
      requestId: sentE.requestId,
      payload: { ok: 'still-alive' }
    }
  });
  assert.deepEqual(await requestE, { ok: 'still-alive' });

  // messageerror is transport-fatal and must reject all pending work immediately.
  const requestF = client.request('PROCESS_F', {});
  secondWorker.emit('messageerror', {});
  await assert.rejects(
    requestF,
    error => error?.code === 'RECLASSIFIER_WORKER_FATAL' &&
      error?.workerFailureKind === 'messageerror'
  );
  assert.equal(secondWorker.terminated, true);
  assert.equal(client.state().active, false);

  // A stale event from an old generation must not kill the replacement Worker.
  const requestG = client.request('PROCESS_G', {});
  assert.equal(workers.length, 3);
  const thirdWorker = workers[2];
  const sentG = thirdWorker.requestMessage('PROCESS_G');
  secondWorker.emit('error', { message: 'late stale error' });
  assert.equal(client.state().pendingRequests, 1);
  assert.equal(thirdWorker.terminated, false);

  thirdWorker.emit('message', {
    data: {
      type: 'RECLASSIFICATION_RESULT',
      requestId: sentG.requestId,
      payload: { ok: 'replacement-alive' }
    }
  });
  assert.deepEqual(await requestG, { ok: 'replacement-alive' });

  // A synchronous postMessage/DataClone failure belongs to one request and must
  // not be promoted to a fatal Worker crash.
  thirdWorker.failTypes.set('BAD_TRANSFER', new Error('DataCloneError: synthetic'));
  await assert.rejects(
    () => client.request('BAD_TRANSFER', { impossible: true }),
    /DataCloneError/
  );
  assert.equal(client.state().pendingRequests, 0);
  assert.equal(client.state().active, true);
  assert.equal(thirdWorker.terminated, false);

  // No cleared timeout callback should still be able to reject settled requests.
  for (const callback of timers.values()) callback();
  await deferredTick();

  client.dispose();
  assert.equal(thirdWorker.terminated, true);
  assert.equal(client.state().disposed, true);

  // Reclassification timeout is an inactivity watchdog. Each progress message
  // renews it; a genuinely stalled Worker is terminated, not left running.
  const slowWorkers = [];
  const watchdogTimers = new Map();
  let watchdogSequence = 0;
  const slowClient = createWorkerClient({
    createWorker() {
      const worker = new FakeWorker('slow-' + slowWorkers.length);
      slowWorkers.push(worker);
      return worker;
    },
    requestTimeoutMs: 600000,
    reclassificationTimeoutMs: 1200000,
    setTimeoutFn(callback, delay) {
      assert.equal(delay, 1200000);
      const id = ++watchdogSequence;
      watchdogTimers.set(id, callback);
      return id;
    },
    clearTimeoutFn(id) { watchdogTimers.delete(id); }
  });
  const slowRequest = slowClient.request('PROCESS_RECLASSIFICATION', {});
  const slowWorker = slowWorkers[0];
  const slowId = slowWorker.requestMessage('PROCESS_RECLASSIFICATION').requestId;
  const firstTimer = [...watchdogTimers.keys()][0];
  slowWorker.emit('message', { data: { type: 'WORKER_PROGRESS', requestId: slowId,
    payload: { percent: 87, label: 'Формирование Excel' } } });
  assert.equal(watchdogTimers.has(firstTimer), false, 'Progress should restart the watchdog');
  assert.equal(watchdogTimers.size, 1);
  const expired = [...watchdogTimers.values()][0];
  expired();
  await assert.rejects(slowRequest, error =>
    error.code === 'RECLASSIFIER_WORKER_TIMEOUT' &&
    /Формирование Excel/.test(error.message));
  assert.equal(slowWorker.terminated, true, 'Timed-out Worker must be terminated');
  assert.equal(slowClient.state().active, false);
  assert.equal(watchdogTimers.size, 0);
  const recovered = slowClient.request('PROCESS_RECLASSIFICATION', {});
  assert.equal(slowWorkers.length, 2, 'New processing must use a clean Worker');
  const cleanWorker = slowWorkers[1];
  cleanWorker.emit('message', {data:{type:'RECLASSIFICATION_RESULT',
    requestId:cleanWorker.requestMessage('PROCESS_RECLASSIFICATION').requestId,
    payload:{ok:true}}});
  assert.deepEqual(await recovered, {ok:true});
  slowClient.dispose();

  console.log('WebWorker client fatal cleanup, recreation and request isolation: OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
