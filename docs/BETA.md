# Beta handoff

## Purpose and scope

Sigma provides familiar find-in-page with case and whole-word controls, keyboard
navigation and optional regex. This beta searches visible main-document text.
It does not yet search collapsed content, image descriptions, iframe/shadow DOM,
PDF/canvas text or unloaded content. Opening a disclosure includes its text.

## Engineering acceptance

- [x] Run `npm ci --ignore-scripts` with Node 24, then `npm run check`.
- [x] Run `npm run test:browser` against a recent Chrome.
- [x] Inspect the popup screenshot in light and dark modes.
- [x] Run `npm run package`; verify the extracted runtime with `SIGMA_EXTENSION_PATH`.
- [ ] Confirm the intended source changes are included in the beta Git snapshot.

Verified on 2026-11-21 with Node 24.21.0 on macOS: formatting, ESLint,
17 unit tests, 24 DOM regressions and 13 installed-extension scenarios passed.
The extension scenarios also passed with the runtime extracted from the beta ZIP.
The final archive is reproducible across two consecutive package runs. Light/dark
popup screenshots are stored in `docs/images/`.

The automated browser suite uses local fixtures and an isolated browser profile.
Passing it does not establish compatibility with arbitrary sites or operating systems.

## Tester installation

1. Extract the beta ZIP and load its directory as an unpacked extension at
   `chrome://extensions`, or load the repository root when testing source.
2. Open an HTTP/HTTPS page, then open Sigma from the extensions menu or Alt+Shift+F.
3. Type plain text; toggle Match case or Whole words to refine results.
4. Use Enter/Shift+Enter or Previous/Next; navigation stops at the ends.
5. Close the popup and try Alt+Shift+N/P. Configure conflicts from Help & shortcuts.
6. Reopen Sigma: the selected result should be preserved. Clear resets the search.

After replacing extension files, reload the extension and refresh pages running
an earlier content script. Browser-internal pages are outside the beta scope.

## Beta feedback

Record the extension version, Chrome version, OS, page type, action, expected and
actual result, and whether the issue is repeatable. Include a public URL or a
minimal local reproduction only when safe to share. Do not send private page text,
queries, session files or saved history by default. There is no built-in telemetry.

## Before public release

- Exercise at least ten real pages: long articles, documentation, tables, forms,
  nested scrollers, a dynamic app and disclosure-heavy pages. Record correctness
  and observed search latency, including partial-result feedback.
- Observe 5–8 people completing ordinary searches without coaching; record task
  success, confusion and voluntary repeat use. Recruitment is not yet complete.
- Check keyboard use, screen-reader announcements, light/dark appearance and zoom
  on supported desktop operating systems. Automated semantic checks are not a
  substitute for assistive-technology testing.
- Publish the privacy policy, support route and accurate store listing; create and
  verify a clean distributable package. Do not promise hidden-content search yet.

These public-release checks remain open until actual observations are recorded.
