import { OWNED_ATTRIBUTE } from '../shared/constants.js';

function resolveTextAlign(align, isRTL) {
  if (align === 'start') {
    return isRTL ? 'right' : 'left';
  }
  if (align === 'end') {
    return isRTL ? 'left' : 'right';
  }
  return align;
}

function contentBox(element, style) {
  const bounds = element.getBoundingClientRect();
  const left =
    bounds.left +
    (parseFloat(style.borderLeftWidth) || 0) +
    (parseFloat(style.paddingInlineStart || style.paddingLeft) || 0);
  const right =
    bounds.right -
    (parseFloat(style.borderRightWidth) || 0) -
    (parseFloat(style.paddingInlineEnd || style.paddingRight) || 0);
  const top =
    bounds.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
  const bottom =
    bounds.bottom -
    (parseFloat(style.borderBottomWidth) || 0) -
    (parseFloat(style.paddingBottom) || 0);
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

function lineHeightFor(style) {
  const fontSize = parseFloat(style.fontSize) || 16;
  if (!style.lineHeight || style.lineHeight === 'normal') {
    return fontSize * 1.2;
  }
  if (style.lineHeight.endsWith('px')) {
    return parseFloat(style.lineHeight) || 0;
  }
  const multiplier = parseFloat(style.lineHeight);
  return Number.isFinite(multiplier) ? multiplier * fontSize : fontSize * 1.2;
}

function measurementContext(style) {
  const context = document.createElement('canvas').getContext('2d');
  context.font =
    style.font ||
    [
      style.fontStyle,
      style.fontVariant,
      style.fontWeight,
      `${style.fontSize}/${style.lineHeight || 'normal'}`,
      style.fontFamily,
    ]
      .filter(Boolean)
      .join(' ');
  return context;
}

/** Approximate a visible single-line input range using canvas text metrics. */
export function getInputTextRangeClientRects(input, startOffset, endOffset) {
  let start = startOffset;
  let end = endOffset;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Pass an HTMLInputElement');
  }

  const value = input.value ?? '';
  if (start > end) {
    [start, end] = [end, start];
  }
  start = Math.max(0, Math.min(start, value.length));
  end = Math.max(0, Math.min(end, value.length));
  if (start === end) {
    return [];
  }

  const style = getComputedStyle(input);
  const {
    left: contentLeft,
    right: contentRight,
    top: contentTop,
    width: contentWidth,
    height: contentHeight,
  } = contentBox(input, style);

  const lineHeight = lineHeightFor(style);
  const rowTop = contentTop + Math.max(0, (contentHeight - lineHeight) / 2);

  const context = measurementContext(style);

  const fullWidth = context.measureText(value).width;
  const prefixWidth = context.measureText(value.slice(0, start)).width;
  const matchWidth = context.measureText(value.slice(start, end)).width;

  const isRTL = style.direction === 'rtl';
  const textIndent = parseFloat(style.textIndent) || 0;

  const overflow = fullWidth > contentWidth + 0.5;
  const scrollLeft = input.scrollLeft;
  const align = resolveTextAlign(style.textAlign, isRTL);

  let baseX;
  if (!overflow && Math.abs(scrollLeft) < 0.5) {
    if (align === 'center') {
      baseX = contentLeft + (contentWidth - fullWidth) / 2 + textIndent;
    } else if (align === 'right') {
      baseX = contentLeft + (contentWidth - fullWidth) + textIndent;
    } else {
      baseX = contentLeft + textIndent;
    }
  } else {
    if (isRTL) {
      baseX = contentRight + textIndent + scrollLeft - fullWidth;
    } else {
      baseX = contentLeft + textIndent - scrollLeft;
    }
  }

  const left = isRTL ? baseX + (fullWidth - (prefixWidth + matchWidth)) : baseX + prefixWidth;

  const width = matchWidth;

  const clipLeft = Math.max(left, contentLeft);
  const clipRight = Math.min(left + width, contentRight);

  if (clipRight <= clipLeft) {
    return [];
  }

  const rect = {
    left: clipLeft,
    top: rowTop,
    width: clipRight - clipLeft,
    height: lineHeight,
    right: clipRight,
    bottom: rowTop + lineHeight,
    x: clipLeft,
    y: rowTop,
  };

  return [rect];
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Mirror textarea typography to measure multiline ranges without changing its value. */
export function getTextareaRangeClientRects(textarea, startOffset, endOffset) {
  let start = startOffset;
  let end = endOffset;
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('Pass an HTMLTextAreaElement');
  }

  if (start > end) {
    [start, end] = [end, start];
  }

  const style = getComputedStyle(textarea);

  const mirror = document.createElement('div');
  mirror.setAttribute(OWNED_ATTRIBUTE, '');
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.boxSizing = 'border-box';
  mirror.style.overflow = 'auto';
  mirror.style.tabSize = style.tabSize;

  mirror.style.font = style.font;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.height = `${textarea.clientHeight}px`;

  mirror.style.left = '-9999px';
  mirror.style.top = '-9999px';

  const value = textarea.value;
  const before = escapeHtml(value.slice(0, start));
  const target = escapeHtml(value.slice(start, end)) || ' ';
  const after = escapeHtml(value.slice(end));

  const toHtml = (s) => s.replace(/\n/g, '<br/>');

  mirror.innerHTML = `${toHtml(before)}<span data-hit>${toHtml(target)}</span>${toHtml(after)}`;

  document.body.appendChild(mirror);

  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;

  const hit = mirror.querySelector('[data-hit]');
  const matchRects = Array.from(hit.getClientRects());
  const mirrorBounds = mirror.getBoundingClientRect();
  const textareaBounds = textarea.getBoundingClientRect();

  const rects = matchRects.map((bounds) => ({
    x: textareaBounds.left + (bounds.left - mirrorBounds.left),
    y: textareaBounds.top + (bounds.top - mirrorBounds.top),
    left: textareaBounds.left + (bounds.left - mirrorBounds.left),
    top: textareaBounds.top + (bounds.top - mirrorBounds.top),
    right: textareaBounds.left + (bounds.right - mirrorBounds.left),
    bottom: textareaBounds.top + (bounds.bottom - mirrorBounds.top),
    width: bounds.width,
    height: bounds.height,
  }));

  mirror.remove();

  return rects;
}

/** Measure the selected option; native control insets are intentionally approximate. */
export function getSelectedOptionRangeClientRects(select, startOffset, endOffset) {
  let start = startOffset;
  let end = endOffset;
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error('select required');
  }
  const selectedIndex = select.selectedIndex;
  if (selectedIndex < 0) {
    return [];
  }

  const option = select.options[selectedIndex];
  const text = option?.text ?? '';
  if (!text) {
    return [];
  }

  if (start > end) {
    [start, end] = [end, start];
  }
  start = Math.max(0, Math.min(start, text.length));
  end = Math.max(0, Math.min(end, text.length));
  if (start === end) {
    return [];
  }

  const style = getComputedStyle(select);
  const {
    left: contentLeft,
    top: contentTop,
    bottom: contentBottom,
    width: contentWidth,
  } = contentBox(select, style);

  const isClosed = !select.multiple && (select.size === 0 || select.size === 1);

  const lineHeight = lineHeightFor(style);

  const rowTop = isClosed
    ? contentTop
    : contentTop + (selectedIndex * lineHeight - select.scrollTop);

  const rowBottom = rowTop + lineHeight;
  if (rowBottom < contentTop || rowTop > contentBottom) {
    return [];
  }

  const CHROME_CLOSED_START_INSET_PX = 4;
  const textIndent = parseFloat(style.textIndent) || 0;
  const isRTL = style.direction === 'rtl';

  const context = measurementContext(style);

  const fullWidth = context.measureText(text).width;
  const prefixWidth = context.measureText(text.slice(0, start)).width;
  const matchWidth = context.measureText(text.slice(start, end)).width;

  const normAlign = resolveTextAlign(style.textAlign, isRTL);

  const startInset = (isClosed ? CHROME_CLOSED_START_INSET_PX : 0) + textIndent;

  let xBase = contentLeft + startInset;
  if (normAlign === 'right') {
    xBase = contentLeft + (contentWidth - fullWidth) - startInset;
  }
  if (normAlign === 'center') {
    xBase = contentLeft + (contentWidth - fullWidth) / 2;
  }

  const left = isRTL ? xBase + (fullWidth - (prefixWidth + matchWidth)) : xBase + prefixWidth;

  const rect = {
    x: left,
    y: rowTop,
    left,
    top: rowTop,
    width: matchWidth,
    height: lineHeight,
    right: left + matchWidth,
    bottom: rowTop + lineHeight,
  };

  return [rect];
}
