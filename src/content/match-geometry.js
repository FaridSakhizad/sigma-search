import { rangeFor, abortIfNeeded, yieldToPage } from './text-index.js';
import { isRenderedSource } from './source-visibility.js';
import { SearchLimits } from '../shared/constants.js';
import {
  getInputTextRangeClientRects,
  getTextareaRangeClientRects,
  getSelectedOptionRangeClientRects,
} from './control-geometry.js';

function usableRect(rect) {
  return (
    rect &&
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

// Scrollable content remains searchable; permanently clipped content is excluded.
function unclippedRects(rects, element, includeScroll = false) {
  let visible = rects.filter(usableRect).map((rect) => ({
    left: rect.left,
    top: rect.top,
    right: rect.right ?? rect.left + rect.width,
    bottom: rect.bottom ?? rect.top + rect.height,
    width: rect.width,
    height: rect.height,
  }));
  for (let parent = element; parent && visible.length; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipped = includeScroll ? ['hidden', 'clip', 'auto', 'scroll'] : ['hidden', 'clip'];
    const clipX = clipped.includes(style.overflowX);
    const clipY = clipped.includes(style.overflowY);
    if (clipX || clipY) {
      const box = parent.getBoundingClientRect();
      const left = box.left + parent.clientLeft;
      const top = box.top + parent.clientTop;
      visible = visible
        .map((rect) => {
          const x = clipX ? Math.max(rect.left, left) : rect.left;
          const y = clipY ? Math.max(rect.top, top) : rect.top;
          const right = clipX ? Math.min(rect.right, left + parent.clientWidth) : rect.right;
          const bottom = clipY ? Math.min(rect.bottom, top + parent.clientHeight) : rect.bottom;
          return {
            left: x,
            top: y,
            right,
            bottom,
            width: right - x,
            height: bottom - y,
          };
        })
        .filter(usableRect);
    }
  }
  return visible;
}

function controlRects(match) {
  const { control, start, end } = match;
  if (!control.isConnected) {
    return [];
  }
  if (control.tagName === 'INPUT') {
    return getInputTextRangeClientRects(control, start, end);
  }
  if (control.tagName === 'SELECT') {
    return getSelectedOptionRangeClientRects(control, start, end);
  }
  const box = control.getBoundingClientRect();
  return getTextareaRangeClientRects(control, start, end).map((rect) => {
    const left = Math.max(rect.left, box.left + control.clientLeft);
    const top = Math.max(rect.top, box.top + control.clientTop);
    const right = Math.min(rect.right, box.left + control.clientLeft + control.clientWidth);
    const bottom = Math.min(rect.bottom, box.top + control.clientTop + control.clientHeight);
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  });
}

function elementFor(match) {
  return (
    match.control ||
    (match.range.startContainer.nodeType === Node.ELEMENT_NODE
      ? match.range.startContainer
      : match.range.startContainer.parentElement)
  );
}
export function rectsFor(match, includeScroll = false) {
  if (match.range && !match.range.startContainer.isConnected) {
    return [];
  }
  const element = elementFor(match);
  if (!isRenderedSource(element)) {
    return [];
  }
  const rects = match.range ? Array.from(match.range.getClientRects()) : controlRects(match);
  return unclippedRects(rects, element, includeScroll);
}
export function scrollToMatch(match) {
  const element = elementFor(match);
  for (let parent = element; parent; parent = parent.parentElement) {
    const rect = rectsFor(match)[0];
    if (!rect) {
      return;
    }
    const root = parent === document.scrollingElement;
    const style = getComputedStyle(parent);
    const scrollX = root || ['auto', 'scroll'].includes(style.overflowX);
    const scrollY = root || ['auto', 'scroll'].includes(style.overflowY);
    const bounds = root
      ? {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
        }
      : parent.getBoundingClientRect();
    const dx =
      scrollX && (rect.left < bounds.left || rect.right > bounds.left + bounds.width)
        ? rect.left + rect.width / 2 - (bounds.left + bounds.width / 2)
        : 0;
    const dy =
      scrollY && (rect.top < bounds.top || rect.bottom > bounds.top + bounds.height)
        ? rect.top + rect.height / 2 - (bounds.top + bounds.height / 2)
        : 0;
    if (dx || dy) {
      parent.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    }
  }
}

/** Resolve worker offsets to live DOM sources within a bounded geometry pass. */
export async function buildSourceMatches(runs, hits, signal) {
  const matches = [];
  let checkpoint = performance.now();
  const deadline = checkpoint + SearchLimits.domBudgetMs;
  let geometryLimited = false;
  for (let i = 0; i < hits.length; i += 1) {
    if (performance.now() > deadline) {
      geometryLimited = true;
      break;
    }
    const hit = hits[i];
    const run = runs[hit.run];
    const entry = run.control
      ? { control: run.control, start: hit.start, end: hit.end }
      : { range: rangeFor(run, hit.start, hit.end) };
    if ((entry.control || entry.range) && rectsFor(entry).length) {
      matches.push(entry);
    }
    if (performance.now() - checkpoint > SearchLimits.frameBudgetMs) {
      // Yield intentionally between bounded batches of DOM work.
      await yieldToPage();
      abortIfNeeded(signal);
      checkpoint = performance.now();
    }
  }
  return { matches, limited: geometryLimited };
}
