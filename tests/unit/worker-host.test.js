import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkerHost } from '../../src/offscreen/worker-host.js';
import { SearchLimits } from '../../src/shared/constants.js';

function harness() {
  const timers = new Map();
  const workers = [];
  let timerId = 0;
  const host = createWorkerHost({
    createWorker() {
      const worker = {
        terminations: 0,
        postMessage() {},
        terminate() {
          this.terminations += 1;
        },
      };
      workers.push(worker);
      return worker;
    },
    schedule(callback) {
      timers.set(++timerId, callback);
      return timerId;
    },
    unschedule(id) {
      timers.delete(id);
    },
  });
  return { host, workers, timeout: () => [...timers.values()].forEach((callback) => callback()) };
}
const payload = { texts: ['hello'], query: 'hello', options: {} };

test('a stuck worker is terminated and a late reply cannot settle it twice', async () => {
  const { host, workers, timeout } = harness();
  const response = host.run('task', payload);
  timeout();
  assert.match((await response).error, /too long/);
  workers[0].onmessage({ data: { matches: [] } });
  assert.equal(workers[0].terminations, 1);
});

test('cancellation is scoped to its task and releases its worker', async () => {
  const { host, workers } = harness();
  const first = host.run('one', payload);
  const second = host.run('two', payload);
  host.cancel('one');
  assert.equal((await first).cancelled, true);
  assert.equal(workers[0].terminations, 1);
  assert.equal(workers[1].terminations, 0);
  workers[1].onmessage({ data: { matches: [], error: null } });
  assert.equal((await second).error, null);
});

test('oversized or malformed input is rejected before allocating a worker', async () => {
  const { host, workers } = harness();
  assert(
    (await host.run('large', { ...payload, texts: ['x'.repeat(SearchLimits.textLength + 1)] }))
      .error,
  );
  assert((await host.run('missing', null)).error);
  assert.equal(workers.length, 0);
});
