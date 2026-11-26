import { SearchEngine } from './search-engine.js';
import { Message } from '../shared/constants.js';

/** Translate extension commands into engine operations without depending on Chrome. */
export function createPageController({
  onUpdate,
  createEngine = (options) => new SearchEngine(options),
}) {
  const engine = createEngine({ onUpdate });

  return async (message) => {
    switch (message.type) {
      case Message.SEARCH:
        return engine.search(message.searchQuery, message.searchParams, {
          focus: message.focus !== false,
        });
      case Message.CLEAR:
        return engine.clear();
      case Message.FOCUS:
      case Message.MOVE: {
        const index =
          message.type === Message.MOVE
            ? engine.snapshot().activeResultIndex + message.step
            : message.index;
        const focused = engine.focus(index);
        return { ...engine.snapshot(), focused };
      }
      case Message.GET_STATE:
        return engine.snapshot();
      default:
        return undefined;
    }
  };
}

/** Keep Chrome messaging in this adapter; command routing remains independently testable. */
export function createPageBridge(runtime) {
  return createPageController({
    onUpdate: (payload) =>
      runtime.sendMessage({ type: Message.STATE_UPDATED, payload }).catch(() => {}),
  });
}
