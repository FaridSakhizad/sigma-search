import { SearchEngine } from '../../src/content/search-engine.js';
import { HighlightRenderer } from '../../src/content/highlight-renderer.js';
import { matchTexts } from '../../src/shared/matcher.js';
const fixture = document.getElementById('fixture');
const results = [];
const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const active = () => [...(CSS.highlights.get('sigma-search-active') || [])][0];
async function test(name, html, run, options = {}) {
  fixture.innerHTML = html;
  const engine = new SearchEngine({ match: async (payload) => matchTexts(payload), ...options });
  try {
    await run(engine);
    results.push({ name, passed: true });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  } finally {
    engine.dispose();
  }
}
await test(
  'inline ranges and multiline highlights',
  '<p style="width:70px">hello <strong>world</strong> again</p>',
  async (engine) => {
    assert((await engine.search('hello world')).totalResults === 1, 'One logical result');
    const range = [...CSS.highlights.get('sigma-search-results')][0];
    assert(range.toString() === 'hello world', 'Source range spans markup');
    assert(range.getClientRects().length >= 2, 'Highlight every fragment');
    assert(!engine.focus(-1) && !engine.focus(1), 'Invalid focus indices are safe');
  },
);
await test(
  'collapsed spaces map back to source offsets',
  '<p>hello   <b> world</b> hello world</p>',
  async (engine) => {
    assert((await engine.search('hello world')).totalResults === 2, 'Normalize visible whitespace');
    const ranges = [...CSS.highlights.get('sigma-search-results')];
    assert(ranges[0].toString() === 'hello    world', 'Original offsets retained');
  },
);
await test(
  'hidden inline elements do not break a phrase',
  '<p>hello<span hidden>ignored</span> world</p>',
  async (engine) => {
    assert((await engine.search('hello world')).totalResults === 1, 'Search visible phrase');
  },
);
await test(
  'block and explicit break boundaries',
  '<p>hello</p><p>world</p><p>hello<br>world</p>',
  async (engine) => {
    assert((await engine.search('helloworld')).totalResults === 0, 'Do not join separate blocks');
  },
);
await test('preformatted whitespace preserved', '<pre>hello   world</pre>', async (engine) => {
  assert((await engine.search('hello world')).totalResults === 0, 'Preserve pre spaces');
  assert((await engine.search('hello   world')).totalResults === 1, 'Exact pre search');
});
await test(
  'literal punctuation, Unicode words and combining marks',
  '<p>a.b aXb кот котик КОТ 𐐀cat café</p>',
  async (engine) => {
    assert((await engine.search('a.b')).totalResults === 1, 'Escape punctuation');
    assert(
      (await engine.search('кот', { wholeWords: true })).totalResults === 2,
      'Unicode whole words',
    );
    assert(
      (await engine.search('кот', { caseSensitive: true, wholeWords: true })).totalResults === 1,
      'Match case',
    );
    assert((await engine.search('cat', { wholeWords: true })).totalResults === 0, 'Astral letters');
    assert(
      (await engine.search('cafe', { wholeWords: true })).totalResults === 0,
      'Combining mark is part of a word',
    );
  },
);
await test(
  'empty, invalid and zero-width regex clear old results',
  '<p>hello</p>',
  async (engine) => {
    await engine.search('hello');
    const bad = await engine.search('[', { useRegex: true });
    assert(bad.totalResults === 0 && bad.error, 'Explicit error');
    assert(!CSS.highlights.has('sigma-search-results'), 'Remove old paint');
    assert((await engine.search('^', { useRegex: true })).totalResults === 0, 'Skip zero-width');
    assert((await engine.search('')).totalResults === 0, 'Empty query');
  },
);
await test(
  'form controls counted once; secrets excluded',
  '<textarea>hello</textarea><select><option>hello</option><option>hello</option></select><input value="hello"><input type="password" value="hello"><p hidden>hello</p><p style="opacity:0">hello</p>',
  async (engine) => {
    assert((await engine.search('hello')).totalResults === 3, 'Only three visible controls');
  },
);
await test(
  'permanently clipped text excluded',
  '<div style="height:40px;overflow:hidden"><div style="height:100px"></div><p>needle</p></div>',
  async (engine) => {
    assert((await engine.search('needle')).totalResults === 0, 'Exclude clipped result');
  },
);
await test(
  'navigate nested scroller using source range',
  '<div id="scroller" style="height:80px;overflow:auto"><div style="height:300px"></div><p>needle</p><div style="height:300px"></div></div>',
  async (engine) => {
    assert(
      (await engine.search('needle')).totalResults === 1,
      'Scrollable text remains searchable',
    );
    assert(engine.focus(0), 'Focus source match');
    const scroller = fixture.querySelector('#scroller');
    assert(scroller.scrollTop > 0, 'Scroll the actual container');
    const rect = active().getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    assert(rect.top >= box.top && rect.bottom <= box.bottom, 'Match visible inside container');
    scroller.scrollTop -= 20;
    assert(
      active().startContainer.parentElement === fixture.querySelector('p'),
      'Highlight remains attached to source',
    );
  },
);
await test('dynamic text replacement removes stale matches', '<p>needle</p>', async (engine) => {
  await engine.search('needle');
  fixture.querySelector('p').textContent = 'replacement';
  await wait(350);
  assert(engine.snapshot().totalResults === 0, 'Results refreshed');
  assert(!CSS.highlights.has('sigma-search-results'), 'No ghost highlight');
});
await test(
  'dynamic insertion preserves active result',
  '<p>hello one</p><p>hello two</p>',
  async (engine) => {
    await engine.search('hello');
    engine.focus(1, { scroll: false });
    const node = active().startContainer;
    const p = document.createElement('p');
    p.textContent = 'hello zero';
    fixture.prepend(p);
    await wait(350);
    assert(
      engine.snapshot().totalResults === 3 && engine.snapshot().activeResultIndex === 2,
      'Preserve identity, not old index',
    );
    assert(active().startContainer === node, 'Same active source');
  },
);
await test('clear cancels a pending mutation refresh', '<p>hello</p>', async (engine) => {
  await engine.search('hello');
  fixture.querySelector('p').textContent = 'hello again';
  await wait(10);
  engine.clear();
  await wait(350);
  assert(
    engine.snapshot().searchQuery === '' && engine.snapshot().totalResults === 0,
    'No resurrection',
  );
});
await test('new query wins an asynchronous search race', '<p>hello world</p>', async (engine) => {
  const first = engine.search('hello');
  const second = engine.search('world');
  await Promise.all([first, second]);
  assert(
    engine.snapshot().searchQuery === 'world' && engine.snapshot().totalResults === 1,
    'Latest wins',
  );
  assert(active().toString() === 'world', 'Paint latest query');
});
await test(
  'query and result limits are explicit',
  '<p>' + 'x '.repeat(2100) + '</p>',
  async (engine) => {
    const result = await engine.search('x');
    assert(
      result.totalResults === 2000 && result.warning,
      'Bound results and disclose partial coverage',
    );
    assert((await engine.search('x'.repeat(1001))).error, 'Limit query length');
  },
);
await test('form editing triggers refresh', '<input value="hello">', async (engine) => {
  await engine.search('hello');
  const input = fixture.querySelector('input');
  input.value = 'bye';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(350);
  assert(engine.snapshot().totalResults === 0, 'Recheck control values');
});
await test(
  'fallback works without native text highlights',
  '<p>hello</p>',
  async (engine) => {
    assert((await engine.search('hello')).totalResults === 1, 'Fallback finds match');
    assert(document.querySelector('sigma-search-overlay'), 'Isolated overlay host');
  },
  { renderer: new HighlightRenderer({ nativeHighlights: false }) },
);
await test(
  'mutations during async matching do not starve results',
  '<p>hello</p>',
  async (engine) => {
    let tick = 0;
    const timer = setInterval(
      () => fixture.querySelector('p').setAttribute('data-tick', String(tick++)),
      20,
    );
    try {
      const result = await engine.search('hello');
      assert(
        result.totalResults === 1 && !result.busy,
        'Complete a bounded pass while page changes',
      );
    } finally {
      clearInterval(timer);
    }
  },
  {
    match: async (payload) => {
      await wait(180);
      return matchTexts(payload);
    },
  },
);
await test(
  'oversized control geometry is bounded and disclosed',
  '<textarea>' + 'x'.repeat(9000) + '</textarea>',
  async (engine) => {
    const result = await engine.search('x');
    assert(result.totalResults === 0 && result.warning, 'Omitted control must be disclosed');
  },
);
await test(
  'partial document scan is disclosed',
  '<p>' + 'x'.repeat(250001) + 'needle</p>',
  async (engine) => {
    const result = await engine.search('needle');
    assert(
      result.totalResults === 0 && result.warning,
      'Do not present a partial scan as a complete no-match result',
    );
  },
);
await test(
  'visible descendants override inherited visibility without exposing hidden text',
  '<div style="visibility:hidden">needle hidden<span style="visibility:visible">needle shown</span><input style="visibility:visible" value="needle control"><span>needle hidden</span></div>',
  async (engine) => {
    assert(
      (await engine.search('needle')).totalResults === 2,
      'Visible descendants remain searchable',
    );
    assert(
      (await engine.search('hidden')).totalResults === 0,
      'Inherited hidden text stays excluded',
    );
  },
);
await test(
  'closed details index only the first summary and refresh when toggled',
  '<details><summary>needle title</summary><p>needle body</p><summary>needle secondary</summary></details>',
  async (engine) => {
    assert((await engine.search('needle')).totalResults === 1, 'Only the visible summary counts');
    const details = fixture.querySelector('details');
    details.open = true;
    await wait(350);
    assert(engine.snapshot().totalResults === 3, 'Opening includes body and secondary summary');
    details.open = false;
    await wait(350);
    assert(engine.snapshot().totalResults === 1, 'Closing removes unpainted matches');
  },
);
await test(
  'closed details do not exhaust budgets before visible content',
  '<details><summary>Title</summary><p>' +
    'needle '.repeat(40000) +
    '</p></details><p>needle visible</p>',
  async (engine) => {
    const result = await engine.search('needle');
    assert(
      result.totalResults === 1 && !result.warning,
      'Hidden text consumes neither text nor match budget',
    );
  },
);
await test(
  'nested details respect each closed ancestor',
  '<details><summary>outer</summary><details open><summary>needle</summary><p>needle</p></details></details>',
  async (engine) => {
    assert(
      (await engine.search('needle')).totalResults === 0,
      'An open inner details cannot escape a closed ancestor',
    );
    fixture.querySelector('details').open = true;
    await wait(350);
    assert(engine.snapshot().totalResults === 2, 'Opening outer reveals inner matches');
  },
);
fixture.replaceChildren();
window.__report = {
  passed: results.filter((result) => result.passed).length,
  total: results.length,
  results,
};
document.getElementById('test-output').textContent = JSON.stringify(window.__report);
