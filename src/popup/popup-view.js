function describeSearch(state, count, pending) {
  if (pending) {
    return 'Searching…';
  }
  if (state.error) {
    return state.error;
  }
  if (!state.searchQuery) {
    return 'Type to search visible text on this page.';
  }
  if (count === 1) {
    return 'One match found.';
  }
  if (count && state.activeResultIndex === count - 1) {
    return 'Last match. Use Previous or Shift+Enter to go back.';
  }
  if (count) {
    return 'Use Next or Enter to move between matches.';
  }
  if (state.warning) {
    return 'No matches found in the searched portion.';
  }
  return 'No matches found in visible page text.';
}

/** Cache DOM bindings once; rendering has no storage or extension API side effects. */
export function createPopupView(document) {
  const get = (id) => document.getElementById(id);
  const elements = {
    form: get('search-form'),
    query: get('search-query'),
    status: get('search-status'),
    warning: get('search-warning'),
    shortcuts: get('shortcuts-link'),
    clear: get('clear-button'),
    previous: get('previous-button'),
    next: get('next-button'),
    results: get('results'),
    index: get('result-index'),
    count: get('result-count'),
    historyEnabled: get('history-enabled'),
    history: get('history-select'),
    historyRow: get('history-row'),
    clearHistory: get('clear-history-button'),
  };
  const optionInputs = {
    caseSensitive: get('match-case'),
    wholeWords: get('whole-words'),
    useRegex: get('use-regex'),
  };
  const options = () =>
    Object.fromEntries(Object.entries(optionInputs).map(([key, input]) => [key, input.checked]));

  return {
    elements,
    optionInputs,
    readDraft: (url) => ({ searchQuery: elements.query.value, searchParams: options(), url }),
    matchesDraft: (state) =>
      state.searchQuery === elements.query.value &&
      Object.entries(optionInputs).every(
        ([key, input]) => !!state.searchParams?.[key] === input.checked,
      ),
    setDraft(draft) {
      elements.query.value = draft.searchQuery || '';
      Object.entries(optionInputs).forEach(([key, input]) => {
        input.checked = !!draft.searchParams?.[key];
      });
    },
    render(state) {
      const count = state.totalResults || 0;
      const current = this.matchesDraft(state);
      const pending = !!state.busy || !current;
      elements.results.setAttribute('aria-busy', String(pending));
      elements.index.textContent = String(!pending && count ? state.activeResultIndex + 1 : 0);
      elements.count.textContent = pending ? '…' : String(count);
      elements.previous.disabled = pending || !count || state.activeResultIndex === 0;
      elements.next.disabled = pending || !count || state.activeResultIndex >= count - 1;
      elements.status.dataset.kind = state.error && !pending ? 'error' : 'info';
      elements.status.textContent = describeSearch(state, count, pending);
      elements.warning.hidden = pending || !state.warning;
      elements.warning.textContent = state.warning || '';
      elements.query.setAttribute('aria-busy', String(pending));
    },
    showError(message) {
      elements.status.dataset.kind = 'error';
      elements.status.textContent = message;
    },
    renderHistory(history) {
      elements.history.replaceChildren();
      history.forEach(({ value }) => {
        if (!value) {
          return;
        }
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        elements.history.appendChild(option);
      });
      elements.history.selectedIndex = -1;
      elements.historyRow.hidden = !elements.history.options.length;
      elements.clearHistory.disabled = !elements.history.options.length;
    },
  };
}
