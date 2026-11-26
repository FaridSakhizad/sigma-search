import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPopupStorage } from '../../src/popup/popup-storage.js';
import { StorageKey, SearchLimits } from '../../src/shared/constants.js';

function storageArea(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(keys) {
      if (typeof keys === 'string') {
        return { [keys]: values[keys] };
      }
      return { ...keys, ...values };
    },
    async set(entries) {
      Object.assign(values, entries);
    },
    async remove(key) {
      delete values[key];
    },
  };
}
function harness({ incognito = false, local = {}, session = {} } = {}) {
  const storage = { local: storageArea(local), session: storageArea(session) };
  const tab = { id: 7, url: 'https://example.test/docs', incognito };
  return { ...storage, store: createPopupStorage(storage, tab), tab };
}

test('history requires explicit opt-in', async () => {
  const { store, local } = harness();
  assert.equal((await store.loadHistory()).enabled, false);
  assert.equal(await store.remember('secret'), null);
  assert.equal(local.values[StorageKey.history], undefined);
});

test('history writes serialize, deduplicate and retain the newest entries', async () => {
  const { store } = harness({ local: { [StorageKey.historyEnabled]: true } });
  await Promise.all(Array.from({ length: 55 }, (_, index) => store.remember(String(index))));
  const entries = await store.remember('54');
  assert.equal(entries.length, SearchLimits.historyEntries);
  assert.equal(entries[0].value, '54');
  assert.equal(entries.filter((entry) => entry.value === '54').length, 1);
});

test('history deletion waits for pending writes', async () => {
  const { store, local } = harness({ local: { [StorageKey.historyEnabled]: true } });
  const pending = store.remember('query');
  await store.clearHistory();
  await pending;
  assert.equal(local.values[StorageKey.history], undefined);
});

test('private windows neither expose saved history nor persist new queries', async () => {
  const initial = {
    [StorageKey.historyEnabled]: true,
    [StorageKey.history]: [{ value: 'regular window' }],
  };
  const { store, local } = harness({ incognito: true, local: initial });
  assert.deepEqual(await store.loadHistory(), { enabled: false, entries: [] });
  await store.remember('private query');
  await store.setHistoryEnabled(false);
  assert.deepEqual(local.values, initial);
});

test('session drafts are scoped to their page and never written to local storage', async () => {
  const { store, local, session, tab } = harness();
  const draft = { searchQuery: 'hello', searchParams: {}, url: tab.url };
  await store.saveDraft(draft);
  assert.deepEqual(await store.loadDraft(), draft);
  assert.deepEqual(session.values[StorageKey.session(tab.id)], draft);
  assert.deepEqual(local.values, {});
  session.values[StorageKey.session(tab.id)].url = 'https://other.test';
  assert.equal((await store.loadDraft()).searchQuery, undefined);
});

test('legacy disk drafts are migrated without retaining their old key', async () => {
  const { store, local } = harness({ local: { [StorageKey.legacyDraft(7)]: 'legacy query' } });
  assert.equal((await store.loadDraft()).searchQuery, 'legacy query');
  assert.equal(local.values[StorageKey.legacyDraft(7)], undefined);
});
