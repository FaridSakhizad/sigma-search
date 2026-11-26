import { OWNED_ATTRIBUTE } from '../shared/constants.js';
import { rectsFor } from './match-geometry.js';

const NORMAL = 'sigma-search-results';
const ACTIVE = 'sigma-search-active';

/** Owns document highlights and isolated form-control overlays. */
export class HighlightRenderer {
  constructor({ nativeHighlights = !!(globalThis.CSS?.highlights && globalThis.Highlight) } = {}) {
    this.native = nativeHighlights;
    this.matches = [];
  }

  clear() {
    if (this.native) {
      CSS.highlights.delete(NORMAL);
      CSS.highlights.delete(ACTIVE);
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.matches = [];
  }

  render(matches, activeResultIndex) {
    this.clear();
    this.matches = matches;
    this.activeResultIndex = activeResultIndex;
    if (!this.matches.length) {
      return;
    }
    if (this.native) {
      const ranges = this.matches.filter((match) => match.range).map((match) => match.range);
      CSS.highlights.set(NORMAL, new Highlight(...ranges));
      const active = this.matches[this.activeResultIndex]?.range;
      CSS.highlights.set(ACTIVE, new Highlight(...(active ? [active] : [])));
    }
    this.updateOverlays();
  }

  updateOverlays() {
    if (!this.matches.length) {
      return;
    }
    const overlays = this.matches.flatMap((match, index) =>
      match.control || !this.native
        ? rectsFor(match, true).map((rect) => ({ rect, active: index === this.activeResultIndex }))
        : [],
    );
    if (!overlays.length) {
      this.host?.remove();
      this.host = null;
      this.shadow = null;
      return;
    }
    if (!this.host) {
      this.host = document.createElement('sigma-search-overlay');
      this.host.setAttribute(OWNED_ATTRIBUTE, '');
      this.host.style.cssText =
        'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      this.shadow = this.host.attachShadow({ mode: 'closed' });
      document.documentElement.appendChild(this.host);
    }
    this.shadow.replaceChildren();
    overlays.forEach(({ rect, active }) => {
      const element = document.createElement('span');
      element.style.cssText = `position:fixed;pointer-events:none;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:${active ? '#ff923480' : '#ffe66b80'};outline:1px solid ${active ? '#a43a00' : '#ad8b00'};`;
      this.shadow.appendChild(element);
    });
  }

  setActive(index) {
    this.activeResultIndex = index;
    if (this.native) {
      const range = this.matches[index]?.range;
      CSS.highlights.set(ACTIVE, new Highlight(...(range ? [range] : [])));
    }
    this.updateOverlays();
  }
}
