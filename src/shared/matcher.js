import { SearchLimits } from './constants.js';

const isWordChar = (char) => !!char && /[\p{L}\p{N}\p{M}_]/u.test(char);

/**
 * Pure matching: DOM nodes and extension APIs never cross this boundary.
 * @param {{texts: string[], query: string, options?: {caseSensitive?: boolean, wholeWords?: boolean, useRegex?: boolean}}} request
 * @returns {{matches: Array<{run: number, start: number, end: number}>, error: string|null, limited?: boolean}}
 */
export function matchTexts({ texts, query, options = {} }) {
  if (typeof query !== 'string' || query.length > SearchLimits.queryLength) {
    return { matches: [], error: `Use a query of at most ${SearchLimits.queryLength} characters.` };
  }
  if (!query) {
    return { matches: [], error: null };
  }
  const source = options.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let regex;
  try {
    regex = new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
  } catch {
    return { matches: [], error: 'Invalid regular expression.' };
  }
  const matches = [];
  for (let run = 0; run < texts.length; run += 1) {
    const text = texts[run];
    for (const hit of text.matchAll(regex)) {
      if (hit[0]) {
        const start = hit.index;
        const end = start + hit[0].length;
        const before = Array.from(text.slice(Math.max(0, start - 2), start)).pop();
        const after = Array.from(text.slice(end, end + 2))[0];
        if (!options.wholeWords || (!isWordChar(before) && !isWordChar(after))) {
          if (matches.length === SearchLimits.results) {
            return { matches, error: null, limited: true };
          }
          matches.push({ run, start, end });
        }
      }
    }
  }
  return { matches, error: null, limited: false };
}
