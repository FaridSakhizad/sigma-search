import { Message, SearchLimits } from '../shared/constants.js';
import { createPopupView } from './popup-view.js';
import { createPopupStorage } from './popup-storage.js';

const view = createPopupView(document);
const { elements } = view;
let tab;
let storage;
let ready = false;
let inputTimer;
let requestVersion = 0;
let state = { totalResults: 0, activeResultIndex: 0, revision: -1 };

function applyState(nextState) {
  if ((nextState.revision ?? 0) < state.revision) {
    return;
  }
  state = nextState;
  view.render(state);
}
function saveDraft(draft = view.readDraft(tab.url)) {
  return storage
    .saveDraft(draft)
    .catch(() => view.showError('The draft could not be saved for this session.'));
}
async function remember(query) {
  try {
    const entries = await storage.remember(query);
    if (entries) {
      view.renderHistory(entries);
    }
  } catch {
    view.showError('Search completed, but history could not be saved.');
  }
}
async function search(saveHistory = false) {
  if (!ready) {
    return;
  }
  clearTimeout(inputTimer);
  const version = ++requestVersion;
  const draft = view.readDraft(tab.url);
  applyState({ ...state, ...draft, busy: true, error: null });
  try {
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: Message.SEARCH,
      ...draft,
      focus: true,
    });
    if (version !== requestVersion || !view.matchesDraft(result)) {
      return;
    }
    applyState(result);
    await saveDraft(draft);
    if (saveHistory && !result.error && version === requestVersion) {
      await remember(draft.searchQuery);
    }
  } catch {
    if (version === requestVersion) {
      applyState({
        ...state,
        busy: false,
        totalResults: 0,
        error: 'Cannot reach this page. Reopen Sigma Search or refresh the page.',
      });
    }
  }
}
async function move(step) {
  if (!ready || state.busy || !view.matchesDraft(state) || !state.totalResults) {
    return;
  }
  try {
    applyState(await chrome.tabs.sendMessage(tab.id, { type: Message.MOVE, step }));
  } catch {
    view.showError('Cannot reach this page. Reopen Sigma Search.');
  }
}
async function clear() {
  clearTimeout(inputTimer);
  requestVersion += 1;
  elements.query.value = '';
  try {
    applyState(await chrome.tabs.sendMessage(tab.id, { type: Message.CLEAR }));
    await saveDraft();
  } catch {
    view.showError('Could not clear the search. Refresh this page.');
  }
}
async function getPageState() {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: Message.GET_STATE });
  } catch {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['src/content/highlight.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/content/content-script.js'],
    });
    return chrome.tabs.sendMessage(tab.id, { type: Message.GET_STATE });
  }
}
async function initialise() {
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/.test(tab.url || '')) {
      throw new Error('Open an HTTP or HTTPS web page to use Sigma Search.');
    }
    const existing = await getPageState();
    if (existing.error && existing.searchQuery === undefined) {
      throw new Error(existing.error);
    }
    storage = createPopupStorage(chrome.storage, tab);
    const history = await storage.loadHistory();
    elements.historyEnabled.checked = history.enabled;
    elements.historyEnabled.disabled = !!tab.incognito;
    view.renderHistory(history.entries);
    const draft = await storage.loadDraft();
    ready = true;
    view.setDraft(existing.searchQuery || existing.busy ? existing : draft);
    applyState(existing);
    if (!existing.searchQuery && !existing.busy && elements.query.value) {
      await search();
    }
    elements.query.disabled = false;
    elements.clear.disabled = false;
    elements.query.focus();
    elements.query.select();
  } catch (error) {
    view.showError(error.message || 'Search cannot start on this page.');
  }
}

function submitSearch(step = 1) {
  if (view.matchesDraft(state) && state.busy) {
    return;
  }
  if (view.matchesDraft(state) && !state.busy && !state.error) {
    if (state.totalResults) {
      remember(elements.query.value);
      move(step);
    }
  } else {
    search(true);
  }
}

// Bind before initialisation awaits Chrome, so no controls depend on load-event timing.
elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  submitSearch();
});
elements.shortcuts.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
elements.clear.addEventListener('click', clear);
elements.previous.addEventListener('click', () => move(-1));
elements.next.addEventListener('click', () => move(1));
elements.query.addEventListener('input', () => {
  clearTimeout(inputTimer);
  requestVersion += 1;
  view.render(state);
  inputTimer = setTimeout(() => search(), SearchLimits.inputDelayMs);
});
Object.values(view.optionInputs).forEach((input) =>
  input.addEventListener('change', () => search()),
);
elements.history.addEventListener('change', () => {
  elements.query.value = elements.history.value;
  elements.history.selectedIndex = -1;
  search();
});
elements.historyEnabled.addEventListener('change', async () => {
  if (!ready) {
    return;
  }
  try {
    await storage.setHistoryEnabled(elements.historyEnabled.checked);
  } catch {
    view.showError('Could not save the history setting.');
  }
});
elements.clearHistory.addEventListener('click', async () => {
  if (!ready) {
    return;
  }
  try {
    await storage.clearHistory();
    view.renderHistory([]);
  } catch {
    view.showError('Could not delete search history.');
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target === elements.query && !event.isComposing) {
    event.preventDefault();
    submitSearch(event.shiftKey ? -1 : 1);
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    window.close();
  }
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    ready &&
    sender.tab?.id === tab.id &&
    message.type === Message.STATE_UPDATED &&
    view.matchesDraft(message.payload)
  ) {
    applyState(message.payload);
  }
});
initialise();
