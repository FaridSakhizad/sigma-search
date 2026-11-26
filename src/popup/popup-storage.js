import { SearchLimits, StorageKey } from '../shared/constants.js';

/** Serialize writes and keep incognito/history policy outside the UI controller. */
export function createPopupStorage(storage, tab) {
  let sessionWrites = Promise.resolve();
  let historyWrites = Promise.resolve();

  return {
    async loadDraft() {
      const key = StorageKey.session(tab.id);
      const session = (await storage.session.get(key))[key];
      const legacyKey = StorageKey.legacyDraft(tab.id);
      const legacy = tab.incognito ? null : (await storage.local.get(legacyKey))[legacyKey];
      await storage.local.remove(legacyKey);
      if (session?.url === tab.url) {
        return session;
      }
      return {
        searchQuery: typeof legacy === 'string' ? legacy : legacy?.searchQuery,
        searchParams: legacy?.searchParams,
      };
    },
    saveDraft(draft) {
      sessionWrites = sessionWrites
        .catch(() => {})
        .then(() =>
          storage.session.set({
            [StorageKey.session(tab.id)]: draft,
          }),
        );
      return sessionWrites;
    },
    async loadHistory() {
      if (tab.incognito) {
        return { enabled: false, entries: [] };
      }
      const data = await storage.local.get({
        [StorageKey.history]: [],
        [StorageKey.historyEnabled]: false,
      });
      return {
        enabled: !!data[StorageKey.historyEnabled],
        entries: Array.isArray(data[StorageKey.history]) ? data[StorageKey.history] : [],
      };
    },
    setHistoryEnabled(enabled) {
      if (tab.incognito) {
        return Promise.resolve();
      }
      return storage.local.set({ [StorageKey.historyEnabled]: enabled });
    },
    remember(query) {
      if (tab.incognito || !query) {
        return Promise.resolve(null);
      }
      historyWrites = historyWrites
        .catch(() => {})
        .then(async () => {
          const data = await storage.local.get({
            [StorageKey.history]: [],
            [StorageKey.historyEnabled]: false,
          });
          if (!data[StorageKey.historyEnabled]) {
            return null;
          }
          const previous = Array.isArray(data[StorageKey.history]) ? data[StorageKey.history] : [];
          const entries = [
            { value: query },
            ...previous.filter((entry) => entry.value !== query),
          ].slice(0, SearchLimits.historyEntries);
          await storage.local.set({ [StorageKey.history]: entries });
          return entries;
        });
      return historyWrites;
    },
    async clearHistory() {
      await historyWrites.catch(() => {});
      await storage.local.remove(StorageKey.history);
    },
  };
}
