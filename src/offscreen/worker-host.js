import { SearchLimits } from '../shared/constants.js';

function validPayload(payload) {
  return (
    payload &&
    Array.isArray(payload.texts) &&
    payload.texts.every((text) => typeof text === 'string') &&
    payload.texts.reduce((sum, text) => sum + text.length, 0) <= SearchLimits.textLength &&
    typeof payload.query === 'string' &&
    payload.query.length <= SearchLimits.queryLength
  );
}

/** One terminable worker per task; settlement always releases its timer and worker. */
export function createWorkerHost({
  createWorker,
  schedule = setTimeout,
  unschedule = clearTimeout,
}) {
  const tasks = new Map();

  return {
    run(key, payload) {
      if (!validPayload(payload)) {
        return Promise.resolve({ matches: [], error: 'Search input exceeds the supported limit.' });
      }
      return new Promise((resolve) => {
        const worker = createWorker();
        let timer;
        let finished = false;
        const finish = (result) => {
          if (finished) {
            return;
          }
          finished = true;
          unschedule(timer);
          worker.terminate();
          tasks.delete(key);
          resolve(result);
        };
        tasks.set(key, () => finish({ matches: [], cancelled: true }));
        timer = schedule(
          () =>
            finish({
              matches: [],
              error: 'Search took too long. Simplify the pattern and try again.',
            }),
          SearchLimits.patternTimeoutMs,
        );
        worker.onmessage = ({ data }) => finish(data);
        worker.onerror = () =>
          finish({
            matches: [],
            error: 'Search worker could not run. Reload the extension and try again.',
          });
        worker.postMessage(payload);
      });
    },
    cancel(key) {
      tasks.get(key)?.();
    },
  };
}
