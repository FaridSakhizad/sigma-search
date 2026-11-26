import { collectRuns, abortIfNeeded } from './text-index.js';
import { requestMatches } from './match-client.js';
import { rectsFor, scrollToMatch, buildSourceMatches } from './match-geometry.js';
import { HighlightRenderer } from './highlight-renderer.js';
import { observePage } from './page-observer.js';
import { DEFAULT_SEARCH_OPTIONS, SearchLimits } from '../shared/constants.js';

function preserveActiveMatch(matches, previous, previousIndex) {
  const index = previous
    ? matches.findIndex(
        (entry) =>
          (entry.control && entry.control === previous.control && entry.start === previous.start) ||
          (entry.range &&
            previous.range &&
            entry.range.startContainer === previous.range.startContainer &&
            entry.range.startOffset === previous.range.startOffset),
      )
    : -1;
  return index >= 0 ? index : Math.max(0, Math.min(previousIndex, matches.length - 1));
}

/** Coordinates cancellable searches; source matches remain independent of rendering. */
export class SearchEngine {
  constructor({
    match = requestMatches,
    onUpdate = () => {},
    renderer = new HighlightRenderer(),
  } = {}) {
    this.match = match;
    this.onUpdate = onUpdate;
    this.matches = [];
    this.generation = 0;
    this.state = {
      searchQuery: '',
      searchParams: { ...DEFAULT_SEARCH_OPTIONS },
      totalResults: 0,
      activeResultIndex: 0,
      error: null,
      warning: null,
      busy: false,
      revision: 0,
    };
    this.renderer = renderer;
    this.stopObserving = observePage({
      onContentChange: () => this.scheduleRefresh(),
      onOverlayChange: () => this.renderer.updateOverlays(),
    });
  }

  snapshot() {
    return { ...this.state, searchParams: { ...this.state.searchParams } };
  }

  emit() {
    this.state.revision += 1;
    this.onUpdate(this.snapshot());
  }

  clear() {
    this.generation += 1;
    this.controller?.abort();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.matches = [];
    this.pendingRefresh = false;
    this.renderer.clear();
    this.state = {
      ...this.state,
      searchQuery: '',
      totalResults: 0,
      activeResultIndex: 0,
      busy: false,
      error: null,
      warning: null,
    };
    this.emit();
    return this.snapshot();
  }

  scheduleRefresh() {
    if (!this.state.searchQuery || this.state.error || this.refreshTimer) {
      return;
    }
    if (this.state.busy) {
      this.pendingRefresh = true;
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.search(this.state.searchQuery, this.state.searchParams, { preserve: true });
    }, SearchLimits.refreshDelayMs);
  }

  async search(query, options = {}, { preserve = false, focus = false } = {}) {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.controller?.abort();
    this.controller = new AbortController();
    this.pendingRefresh = false;
    const { signal } = this.controller;
    this.generation += 1;
    const { generation } = this;
    const previous = preserve ? this.matches[this.state.activeResultIndex] : null;
    const previousIndex = preserve ? this.state.activeResultIndex : 0;
    this.state = {
      ...this.state,
      searchQuery: query,
      searchParams: { ...DEFAULT_SEARCH_OPTIONS, ...options },
      error: null,
      warning: null,
      busy: !!query,
    };
    this.emit();
    this.renderer.clear();
    if (!query) {
      return this.clear();
    }
    try {
      const { runs, limited } = await collectRuns(signal);
      const result = await this.match(
        { texts: runs.map((run) => run.text), query, options: this.state.searchParams },
        signal,
      );
      abortIfNeeded(signal);
      if (result.error) {
        throw new Error(result.error);
      }
      const { matches, limited: geometryLimited } = await buildSourceMatches(
        runs,
        result.matches,
        signal,
      );
      if (generation !== this.generation) {
        return this.snapshot();
      }
      this.matches = matches;
      this.state.totalResults = matches.length;
      this.state.activeResultIndex = preserveActiveMatch(matches, previous, previousIndex);
      this.state.busy = false;
      this.state.warning =
        limited || result.limited || geometryLimited
          ? 'Search limit reached. Results cover only part of this page or pattern.'
          : null;
      this.renderer.render(this.matches, this.state.activeResultIndex);
      if (focus && matches.length) {
        scrollToMatch(matches[this.state.activeResultIndex]);
      }
      this.renderer.updateOverlays();
      this.emit();
    } catch (error) {
      if (error.name === 'AbortError' || generation !== this.generation) {
        return this.snapshot();
      }
      this.matches = [];
      this.state = {
        ...this.state,
        totalResults: 0,
        activeResultIndex: 0,
        busy: false,
        error: error.message,
      };
      this.renderer.clear();
      this.emit();
    }
    if (this.pendingRefresh && generation === this.generation) {
      this.pendingRefresh = false;
      this.scheduleRefresh();
    }
    return this.snapshot();
  }

  focus(index, { scroll = true } = {}) {
    if (!Number.isInteger(index) || index < 0 || !this.matches[index] || this.state.busy) {
      return false;
    }
    if (!rectsFor(this.matches[index]).length) {
      this.scheduleRefresh();
      return false;
    }
    this.state.activeResultIndex = index;
    this.renderer.setActive(index);
    if (scroll) {
      scrollToMatch(this.matches[index]);
    }
    this.renderer.updateOverlays();
    this.emit();
    return true;
  }

  dispose() {
    this.clear();
    this.stopObserving();
  }
}
