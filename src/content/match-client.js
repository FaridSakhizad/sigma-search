import { Message } from '../shared/constants.js';

let nextRequest = 0;

export function requestMatches(payload, signal) {
  return new Promise((resolve, reject) => {
    nextRequest += 1;
    const requestId = `${Date.now()}:${nextRequest}`;
    const cancel = () => {
      chrome.runtime.sendMessage({ type: Message.CANCEL_MATCH, requestId }).catch(() => {});
      reject(new DOMException('Search cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    chrome.runtime
      .sendMessage({ type: Message.MATCH, requestId, payload })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}
