// This entry runs as a classic content script. Its controller is a native ES module.
(function installPageBridge() {
  const key = Symbol.for('sigma-search.page-controller');
  if (globalThis[key]) {
    return;
  }

  const ready = import(chrome.runtime.getURL('src/content/page-controller.js')).then(
    ({ createPageBridge }) => createPageBridge(chrome.runtime),
  );
  globalThis[key] = ready;

  // Register synchronously so the first popup message can wait for module loading.
  const listener = (message, _sender, respond) => {
    if (!message?.type?.startsWith('sigma/page/')) {
      return false;
    }
    ready
      .then((handle) => handle(message))
      .then(respond, () =>
        respond({
          error: 'Search could not start. Reload the extension and this page.',
          totalResults: 0,
        }),
      );
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  ready.catch(() => {
    chrome.runtime.onMessage.removeListener(listener);
    delete globalThis[key];
  });
})();
