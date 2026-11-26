import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPageController } from '../../src/content/page-controller.js';
import { Message } from '../../src/shared/constants.js';

function controller() {
  let state = { searchQuery: '', totalResults: 0, activeResultIndex: 0 };
  return createPageController({
    createEngine: () => ({
      snapshot: () => state,
      async search(searchQuery, searchParams) {
        state = { searchQuery, searchParams, totalResults: 3, activeResultIndex: 0 };
        return state;
      },
      clear() {
        state = { searchQuery: '', totalResults: 0, activeResultIndex: 0 };
        return state;
      },
      focus(index) {
        if (index < 0 || index >= state.totalResults) {
          return false;
        }
        state.activeResultIndex = index;
        return true;
      },
    }),
  });
}

test('navigation survives subsequent popup state reads', async () => {
  const handle = controller();
  await handle({ type: Message.SEARCH, searchQuery: 'hello', searchParams: {} });
  const result = await handle({ type: Message.MOVE, step: 1 });
  assert.equal(result.activeResultIndex, 1);
  assert.equal((await handle({ type: Message.GET_STATE })).activeResultIndex, 1);
});

test('Clear resets the active query and result set', async () => {
  const handle = controller();
  await handle({ type: Message.SEARCH, searchQuery: 'hello', searchParams: {} });
  const result = await handle({ type: Message.CLEAR });
  assert.equal(result.searchQuery, '');
  assert.equal(result.totalResults, 0);
});

test('invalid indices and unrelated commands do not change focus', async () => {
  const handle = controller();
  await handle({ type: Message.SEARCH, searchQuery: 'hello', searchParams: {} });
  assert.equal((await handle({ type: Message.FOCUS, index: 99 })).focused, false);
  assert.equal((await handle({ type: Message.GET_STATE })).activeResultIndex, 0);
  assert.equal(await handle({ type: 'unrelated' }), undefined);
});
