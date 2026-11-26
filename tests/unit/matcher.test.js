import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchTexts } from '../../src/shared/matcher.js';
import { SearchLimits } from '../../src/shared/constants.js';

test('literal search escapes regex syntax', async () => {
  assert.equal(matchTexts({ texts: ['a.b aXb [x]'], query: 'a.b' }).matches.length, 1);
  assert.equal(matchTexts({ texts: ['[x]'], query: '[x]' }).matches.length, 1);
});
test('whole words support Unicode letters and combining marks', async () => {
  const options = { wholeWords: true };
  assert.equal(matchTexts({ texts: ['кот котик КОТ'], query: 'кот', options }).matches.length, 2);
  assert.equal(matchTexts({ texts: ['𐐀cat café'], query: 'cat', options }).matches.length, 0);
  assert.equal(matchTexts({ texts: ['café'], query: 'cafe', options }).matches.length, 0);
});
test('case sensitivity and regex', async () => {
  assert.equal(
    matchTexts({ texts: ['AB ab'], query: 'ab', options: { caseSensitive: true } }).matches.length,
    1,
  );
  assert.equal(
    matchTexts({ texts: ['INV-123 INV-456'], query: 'INV-\\d+', options: { useRegex: true } })
      .matches.length,
    2,
  );
});
test('invalid regex is an explicit empty result; zero-width regex terminates', async () => {
  const invalid = matchTexts({ texts: ['hello'], query: '[', options: { useRegex: true } });
  assert.equal(invalid.matches.length, 0);
  assert.match(invalid.error, /Invalid/);
  assert.equal(
    matchTexts({ texts: ['𐐀abc'], query: '(?:)', options: { useRegex: true } }).matches.length,
    0,
  );
});
test('query and result limits are explicit', async () => {
  assert(matchTexts({ texts: ['x'], query: 'x'.repeat(SearchLimits.queryLength + 1) }).error);
  const result = matchTexts({ texts: ['x'.repeat(SearchLimits.results + 1)], query: 'x' });
  assert.equal(result.matches.length, SearchLimits.results);
  assert.equal(result.limited, true);
  assert.equal(
    matchTexts({ texts: ['x'.repeat(SearchLimits.results)], query: 'x' }).limited,
    false,
  );
});
