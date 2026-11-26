import { Message } from '../shared/constants.js';
import { createWorkerHost } from './worker-host.js';

const host = createWorkerHost({
  createWorker: () =>
    new Worker(chrome.runtime.getURL('src/worker/match-worker.js'), { type: 'module' }),
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }
  if (message.type === Message.CANCEL_WORKER) {
    host.cancel(message.key);
    return false;
  }
  if (message.type !== Message.RUN_WORKER) {
    return false;
  }
  host.run(message.key, message.payload).then(respond, () =>
    respond({
      matches: [],
      error: 'Search worker is unavailable. Reload the extension.',
    }),
  );
  return true;
});
