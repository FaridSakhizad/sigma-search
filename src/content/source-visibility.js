export function firstSummary(details) {
  return Array.from(details.children).find((child) => child.tagName === 'SUMMARY');
}

/** Closed details can expose layout rectangles for content that is not painted. */
function isInsideClosedDetails(element) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS' && !parent.open) {
      const summary = firstSummary(parent);
      if (!summary?.contains(element)) {
        return true;
      }
    }
  }
  return false;
}

/** Visibility may be restored by a descendant; opacity/display cannot. */
export function isRenderedSource(element) {
  if (!element?.isConnected || isInsideClosedDetails(element)) {
    return false;
  }
  if (['hidden', 'collapse'].includes(getComputedStyle(element).visibility)) {
    return false;
  }
  for (let parent = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (
      style.display === 'none' ||
      style.contentVisibility === 'hidden' ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
  }
  return true;
}
