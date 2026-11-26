import { SearchLimits } from '../shared/constants.js';
import { firstSummary } from './source-visibility.js';

const BLOCKLESS = new Set(['inline', 'contents']);
const EXCLUDED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'number']);

export function abortIfNeeded(signal) {
  if (signal?.aborted) {
    throw new DOMException('Search cancelled', 'AbortError');
  }
}
export const yieldToPage = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * @typedef {Object} TextSegment
 * @property {Text} node Start node in the original DOM.
 * @property {Text} endNode End node, which may differ for collapsed whitespace.
 * @property {number} rawStart UTF-16 offset in node.
 * @property {number} rawEnd UTF-16 offset in endNode.
 * @property {number} from Start offset in the normalized search text.
 * @property {number} to Exclusive end offset in the normalized search text.
 * @property {boolean} collapsed Whether multiple source characters represent one space.
 */

/** Collect normalized text while retaining enough source information to rebuild ranges. */
export async function collectRuns(signal) {
  const runs = [];
  let run = { text: '', segments: [] };
  let length = 0;
  let visited = 0;
  let limited = false;
  let checkpoint = performance.now();
  const deadline = checkpoint + SearchLimits.domBudgetMs;
  const flush = () => {
    if (run.text) {
      runs.push(run);
    }
    run = { text: '', segments: [] };
  };
  const append = (node, rawStart, rawEnd, value, collapsed) => {
    if (collapsed && value === ' ' && run.text.endsWith(' ')) {
      const previous = run.segments[run.segments.length - 1];
      previous.endNode = node;
      previous.rawEnd = rawEnd;
      return;
    }
    const from = run.text.length;
    run.text += value;
    run.segments.push({
      node,
      endNode: node,
      rawStart,
      rawEnd,
      from,
      to: run.text.length,
      collapsed,
    });
    length += value.length;
  };
  const stack = document.body ? [{ node: document.body }] : [];
  while (stack.length) {
    abortIfNeeded(signal);
    const { node, exit } = stack.pop();
    if (exit) {
      flush();
    } else if (node.nodeType === Node.TEXT_NODE) {
      const style = getComputedStyle(node.parentElement);
      const hidden = ['hidden', 'collapse'].includes(style.visibility);
      if (hidden) {
        flush();
      }
      const preserve = ['pre', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace);
      const raw = hidden ? '' : node.nodeValue.slice(0, SearchLimits.textLength - length);
      if (preserve) {
        if (raw) {
          append(node, 0, raw.length, raw, false);
        }
      } else {
        const pattern =
          style.whiteSpace === 'pre-line'
            ? /[ \t\r\f\u00a0]+|[^ \t\r\f\u00a0]+/g
            : /[ \t\r\n\f\u00a0]+|[^ \t\r\n\f\u00a0]+/g;
        Array.from(raw.matchAll(pattern)).forEach((hit) => {
          const whitespace =
            /^[ \t\r\n\f\u00a0]+$/.test(hit[0]) &&
            !(style.whiteSpace === 'pre-line' && hit[0].includes('\n'));
          append(node, hit.index, hit.index + hit[0].length, whitespace ? ' ' : hit[0], whitespace);
        });
      }
      if (!hidden && raw.length < node.nodeValue.length) {
        limited = true;
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const style = getComputedStyle(node);
      const tag = node.tagName;
      if (
        !EXCLUDED.has(tag) &&
        style.display !== 'none' &&
        style.contentVisibility !== 'hidden' &&
        Number(style.opacity) !== 0
      ) {
        if (tag === 'BR') {
          flush();
        } else if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
          flush();
          if (
            !['hidden', 'collapse'].includes(style.visibility) &&
            (tag !== 'INPUT' || TEXT_INPUTS.has(node.type))
          ) {
            const value =
              tag === 'SELECT' ? (node.options[node.selectedIndex]?.text ?? '') : node.value;
            // Geometry adapters mirror/measure the full value; bound this work too.
            const text =
              value.length > SearchLimits.controlLength
                ? ''
                : value.slice(0, SearchLimits.textLength - length);
            if (text) {
              runs.push({ text, control: node });
            }
            length += text.length;
            if (text.length < value.length) {
              limited = true;
            }
          }
        } else {
          const block = !BLOCKLESS.has(style.display);
          if (block) {
            flush();
            stack.push({ node, exit: true });
          }
          if (tag === 'DETAILS' && !node.open) {
            // Index only the first summary; hidden contents must not consume match budgets.
            const summary = firstSummary(node);
            if (summary) {
              stack.push({ node: summary });
            }
          } else {
            for (let child = node.lastChild; child; child = child.previousSibling) {
              stack.push({ node: child });
            }
          }
        }
      }
    }
    visited += 1;
    if (
      length >= SearchLimits.textLength ||
      visited >= SearchLimits.traversalSteps ||
      performance.now() > deadline
    ) {
      limited = limited || stack.length > 0;
      break;
    }
    if (visited % 100 === 0 && performance.now() - checkpoint > SearchLimits.frameBudgetMs) {
      // Yield intentionally while scanning large documents.
      await yieldToPage();
      checkpoint = performance.now();
    }
  }
  flush();
  return { runs, limited };
}

function segmentAt(segments, position) {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const segment = segments[mid];
    if (position < segment.from) {
      high = mid - 1;
    } else if (position >= segment.to) {
      low = mid + 1;
    } else {
      return segment;
    }
  }
  return null;
}

/** Map a normalized match back to a live range; return null if the page changed. */
export function rangeFor(run, start, end) {
  const first = segmentAt(run.segments, start);
  const last = segmentAt(run.segments, end - 1);
  if (!first || !last || !first.node.isConnected || !last.endNode.isConnected) {
    return null;
  }
  const endNode = last.collapsed ? last.endNode : last.node;
  const startOffset = first.collapsed ? first.rawStart : first.rawStart + start - first.from;
  const endOffset = last.collapsed ? last.rawEnd : last.rawStart + end - last.from;
  if (startOffset > first.node.length || endOffset > endNode.length) {
    return null;
  }
  const range = document.createRange();
  range.setStart(first.node, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}
