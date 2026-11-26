# Validation and supported scope

## Automated checks

`npm run check` runs Prettier, ESLint and Node's built-in test runner. Unit tests import
production modules directly; no source rewriting or mocked DOM implementation is
required. They cover matching, command routing, worker cleanup, serialized history
writes, incognito policy and session/legacy-draft handling.

`npm run test:browser` starts a local HTTP server and an isolated headless Chrome.
It tests source ranges, whitespace, clipping, mutation refresh, async races and
geometry budgets. It also loads the real unpacked extension and invokes its browser
action, exercising popup → content → service worker → offscreen document → worker
communication with actual `activeTab` access.

Installed-extension scenarios cover reopening at the selected result, page updates,
option changes, keyboard navigation, nested scrolling, pathological-regex termination,
recovery, history deletion and absence of permanent host permissions.

The browser test uses DevTools Protocol over a pipe. No normal browser profile is
opened. Hosted Linux CI sets `CHROME_NO_SANDBOX=1` for its isolated fixture run;
local runs keep the browser sandbox enabled unless explicitly overridden. A screenshot, when requested through `SIGMA_SCREENSHOT`, contains fixture
content only. These tests establish behavior on fixtures; they do not establish
compatibility with arbitrary websites or all operating systems.

## Limits

Policy values live in `src/shared/constants.js`:

| Resource                   | Limit                                                        |
| -------------------------- | ------------------------------------------------------------ |
| Query                      | 1,000 characters                                             |
| Searchable text            | 250,000 characters per pass                                  |
| Traversal                  | 20,000 steps per pass                                        |
| Candidate results          | 2,000 per pass                                               |
| Collection / geometry work | 500 ms elapsed time per phase, with yielding between batches |
| Control value measurement  | 8,192 characters per control                                 |
| Worker lifetime            | 1 second, including startup                                  |
| Saved history              | 50 unique queries, only after opt-in                         |

Limits produce partial-coverage feedback. The DOM work budgets are cooperative;
a browser layout operation cannot be preempted while it is executing. Pattern
execution has a separate worker termination timer. Timed-out patterns require a
user edit/retry instead of entering an automatic refresh loop.

## Current unsupported or approximate behavior

- Visible main-document text only: collapsed/hidden text, image descriptions, iframe,
  shadow DOM, PDF and canvas text are outside the beta scope. Closed `<details>`
  contributes only its first summary; opening it includes the revealed content.
- Virtualized/unloaded content is unavailable until the page renders it.
- Blocks and explicit `<br>` elements separate searchable runs; ordinary collapsed
  whitespace is normalized, while preformatted whitespace is preserved.
- Native form-control typography is approximate, and internally clipped value text
  can be omitted. Oversized controls are excluded with a warning.
- Programmatic value changes without DOM/input/change events, CSSOM-only updates,
  CSS text transformation and unusual bidirectional text are not fully supported.
- Native CSS highlights are the primary path; an isolated overlay fallback exists.

## Before public release

1. Run both automated check commands from a clean `npm ci` installation.
2. Check a fixed set of at least ten real pages, including a long document, nested
   scrollers, a form and a dynamic interface. Record failures and observed latency.
3. Verify expected matches and exclusions, accurate navigation, clearing during an
   update, popup reopening and recovery after an invalid or slow pattern.
4. Manually check light/dark appearance, keyboard-only use and browser shortcut conflicts.
5. Resolve misleading results and unresponsive-page failures within the declared scope.

## Product pilot

The intended audience is people who need more control over everyday find-in-page.
Regex is an optional advanced mode. The pilot has not been run; demand is not yet validated.

With consent, observe 5–10 people finding a known phrase, distinguishing case and
whole words, navigating multiple results, and resuming after closing the popup.
Include disclosure sections to verify that the beta scope is understood. Test regex
and history separately with people who need those optional features. Compare task success and time to their existing workflow. Record confusing
controls, wrong/missing matches and voluntary repeat use. Do not collect page contents
or raw queries. Recruitment and store publication are separate user-owned actions.

## Beta regressions added

- Visible descendants of `visibility:hidden` ancestors remain searchable, including controls.
- Hidden inherited text stays excluded; closed and nested disclosures are handled consistently.
- Closed disclosure content cannot consume text or candidate-result limits.
- Opening/closing disclosures refreshes the result set.
- Live input, clear, Enter/form submission and stale-draft navigation agree.
- Result controls remain present in empty states; partial zero results have distinct feedback.
