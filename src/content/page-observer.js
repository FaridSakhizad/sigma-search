import { OWNED_ATTRIBUTE } from '../shared/constants.js';

/** Observe the page and return a symmetric cleanup function. */
export function observePage({ onContentChange, onOverlayChange }) {
  let frame;
  const observer = new MutationObserver((records) => {
    const relevant = records.some((record) => {
      if (
        record.target.nodeType === Node.ELEMENT_NODE &&
        record.target.closest(`[${OWNED_ATTRIBUTE}]`)
      ) {
        return false;
      }
      if (record.target.parentElement?.closest(`[${OWNED_ATTRIBUTE}]`)) {
        return false;
      }
      if (record.type !== 'childList') {
        return true;
      }
      const nodes = [...record.addedNodes, ...record.removedNodes];
      return nodes.some(
        (node) => node.nodeType !== Node.ELEMENT_NODE || !node.hasAttribute(OWNED_ATTRIBUTE),
      );
    });
    if (relevant) {
      onContentChange();
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const layoutChanged = () => {
    onOverlayChange();
    onContentChange();
  };
  const scrolled = () => {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      onOverlayChange();
    });
  };
  window.addEventListener('scroll', scrolled, true);
  window.addEventListener('resize', layoutChanged);
  document.addEventListener('input', layoutChanged, true);
  document.addEventListener('change', layoutChanged, true);
  document.addEventListener('load', layoutChanged, true);
  const fontChanged = () => onContentChange();
  document.fonts?.addEventListener('loadingdone', fontChanged);
  return () => {
    observer.disconnect();
    window.removeEventListener('scroll', scrolled, true);
    window.removeEventListener('resize', layoutChanged);
    document.removeEventListener('input', layoutChanged, true);
    document.removeEventListener('change', layoutChanged, true);
    document.removeEventListener('load', layoutChanged, true);
    document.fonts?.removeEventListener('loadingdone', fontChanged);
    if (frame) {
      cancelAnimationFrame(frame);
    }
  };
}
