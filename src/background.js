import { Message, StorageKey } from './shared/constants.js';
let creatingOffscreen;
const jobs = new Map();
async function ensureOffscreen() {
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen/offscreen.html',
        reasons: ['WORKERS'],
        justification:
          'Run local search patterns in terminable workers without blocking web pages.',
      });
    }
  })();
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.tab) {
    return false;
  }
  const key = `${sender.tab.id}:${message.requestId}`;
  if (message.type === Message.CANCEL_MATCH) {
    const job = jobs.get(key);
    if (job) {
      job.cancelled = true;
    }
    chrome.runtime.sendMessage({ type: Message.CANCEL_WORKER, key }).catch(() => {});
    return false;
  }
  if (message.type !== Message.MATCH) {
    return false;
  }
  const job = { cancelled: false };
  jobs.set(key, job);
  (async () => {
    await ensureOffscreen();
    if (job.cancelled) {
      return { matches: [], cancelled: true };
    }
    return chrome.runtime.sendMessage({ type: Message.RUN_WORKER, key, payload: message.payload });
  })()
    .then(respond, () =>
      respond({ matches: [], error: 'Search worker is unavailable. Reload the extension.' }),
    )
    .finally(() => jobs.delete(key));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(StorageKey.session(tabId)).catch(() => {});
  chrome.storage.local.remove(StorageKey.legacyDraft(tabId)).catch(() => {});
});
chrome.commands.onCommand.addListener(async (command) => {
  if (!['next-result', 'previous-result'].includes(command)) {
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }
  chrome.tabs
    .sendMessage(tab.id, {
      type: Message.MOVE,
      step: command === 'next-result' ? 1 : -1,
    })
    .catch(() => {});
});
