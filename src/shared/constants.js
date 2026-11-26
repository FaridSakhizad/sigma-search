/** Wire protocol shared by the popup, page controller and worker contexts. */
export const Message = Object.freeze({
  SEARCH: 'sigma/page/search',
  CLEAR: 'sigma/page/clear',
  FOCUS: 'sigma/page/focus',
  MOVE: 'sigma/page/move',
  GET_STATE: 'sigma/page/state',
  STATE_UPDATED: 'sigma/page/updated',
  MATCH: 'sigma/match/run',
  CANCEL_MATCH: 'sigma/match/cancel',
  RUN_WORKER: 'sigma/worker/run',
  CANCEL_WORKER: 'sigma/worker/cancel',
});

export const SearchLimits = Object.freeze({
  queryLength: 1000,
  textLength: 250000,
  controlLength: 8192,
  traversalSteps: 20000,
  results: 2000,
  patternTimeoutMs: 1000,
  domBudgetMs: 500,
  frameBudgetMs: 8,
  refreshDelayMs: 120,
  inputDelayMs: 220,
  historyEntries: 50,
});

export const StorageKey = Object.freeze({
  history: 'sigma:searchHistory',
  historyEnabled: 'sigma:historyEnabled',
  session: (tabId) => `sigma:tab:${tabId}`,
  legacyDraft: (tabId) => `${tabId}_sigma_search_query`,
});

export const DEFAULT_SEARCH_OPTIONS = Object.freeze({
  caseSensitive: false,
  wholeWords: false,
  useRegex: false,
});

/** Marks extension-owned DOM so page observers ignore rendering updates. */
export const OWNED_ATTRIBUTE = 'data-sigma-owned';
