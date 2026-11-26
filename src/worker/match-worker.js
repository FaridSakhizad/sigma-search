import { matchTexts } from '../shared/matcher.js';

globalThis.onmessage = ({ data }) => {
  globalThis.postMessage(matchTexts(data));
};
