const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chromeBin =
  process.env.CHROME_BIN ||
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
assert(chromeBin, 'Set CHROME_BIN to a Chrome/Chromium executable.');
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sigma-browser-'));
let browser;
let sequence = 0;
const pending = new Map();
let buffer = '';
const errors = [];
function send(method, params, sessionId) {
  return new Promise((resolve, reject) => {
    sequence += 1;
    const id = sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    browser.stdio[3].write(
      `${JSON.stringify({
        id,
        method,
        params,
        sessionId,
      })}\0`,
    );
  });
}
function received(data) {
  buffer += data;
  while (buffer.includes('\0')) {
    const end = buffer.indexOf('\0');
    const msg = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(item.timer);
      if (msg.error) {
        item.reject(new Error(JSON.stringify(msg.error)));
      } else {
        item.resolve(msg.result);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails);
    }
  }
}
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  return sessionId;
}
async function evaluate(sessionId, expression) {
  const result = await send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}
async function until(fn, description, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) {
      return result;
    }
    await sleep(70);
  }
  throw new Error(`Timed out: ${description}`);
}
const server = http.createServer((req, res) => {
  const filename = path.resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`);
  if (
    !filename.startsWith(`${root}${path.sep}`) ||
    !fs.existsSync(filename) ||
    !fs.statSync(filename).isFile()
  ) {
    res.writeHead(404).end();
    return;
  }
  let mime = 'text/html';
  if (filename.endsWith('.mjs') || filename.endsWith('.js')) {
    mime = 'text/javascript';
  }
  if (filename.endsWith('.css')) {
    mime = 'text/css';
  }
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filename).pipe(res);
});
async function main() {
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = spawn(
    chromeBin,
    [
      '--headless',
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      `--user-data-dir=${profile}`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  );
  browser.stdio[4].on('data', received);
  browser.stderr.on('data', () => {});
  const page = await send('Target.createTarget', { url: `${base}/tests/search.browser.html` });
  const pageSession = await attach(page.targetId);
  const report = await until(
    () => evaluate(pageSession, 'window.__report'),
    'DOM regressions',
    30000,
  );
  report.results.forEach((result) =>
    process.stdout.write(
      `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}\n`,
    ),
  );
  assert.equal(report.passed, report.total, 'DOM regression failure.');
  await send('Target.closeTarget', { targetId: page.targetId });

  const extension = await send('Extensions.loadUnpacked', {
    path: process.env.SIGMA_EXTENSION_PATH || root,
  });
  const fixture = await send('Target.createTarget', {
    url: `${base}/tests/extension.fixture.html`,
  });
  const fixtureSession = await attach(fixture.targetId);
  await until(
    () => evaluate(fixtureSession, 'document.readyState === "complete"'),
    'fixture loading',
  );
  async function openPopup() {
    await send('Target.activateTarget', { targetId: fixture.targetId });
    const tabTarget = (
      await send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })
    ).targetInfos.find((target) => target.url === `${base}/tests/extension.fixture.html`);
    assert(tabTarget, 'Fixture tab target exists.');
    await send('Extensions.triggerAction', { id: extension.id, targetId: tabTarget.targetId });
    const popup = await until(
      async () =>
        (await send('Target.getTargets')).targetInfos.find(
          (target) => target.url === `chrome-extension://${extension.id}/src/popup/popup.html`,
        ),
      'extension popup',
    );
    const session = await attach(popup.targetId);
    await until(async () => {
      const value = await evaluate(
        session,
        '({ready: !!document.querySelector("#search-query") && !document.querySelector("#search-query").disabled, status: document.querySelector("#search-status")?.textContent})',
      );
      if (value.ready) {
        return true;
      }
      if (
        value.status &&
        !value.status.includes('Searching') &&
        !value.status.includes('Opening search')
      ) {
        throw new Error(`Popup init: ${value.status}`);
      }
      return false;
    }, 'popup readiness');
    return { ...popup, session };
  }
  let popup = await openPopup();
  const query = async (value, regex = false) => {
    await evaluate(
      popup.session,
      `document.querySelector('#search-query').value=${JSON.stringify(value)};document.querySelector('#use-regex').checked=${regex};document.querySelector('#search-form').requestSubmit();`,
    );
    const snapshot = await until(async () => {
      const current = await evaluate(
        popup.session,
        'chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>chrome.tabs.sendMessage(tab.id,{type:"sigma/page/state"}))',
      );
      return current.searchQuery === value && !current.busy ? current : false;
    }, 'search completed');
    await until(
      () =>
        evaluate(
          popup.session,
          `document.querySelector('#result-count').textContent === ${JSON.stringify(String(snapshot.totalResults))} && document.querySelector('#search-query').getAttribute('aria-busy') !== 'true'`,
        ),
      'popup rendered results',
    );
    if (snapshot.error) {
      process.stdout.write(`Search feedback: ${snapshot.error}\n`);
    }
  };
  assert.equal(await evaluate(popup.session, 'document.querySelector("#results").hidden'), false);
  await evaluate(
    popup.session,
    `document.querySelector('#search-query').value='not-on-this-fixture';document.querySelector('#search-query').dispatchEvent(new Event('input',{bubbles:true}));`,
  );
  await until(
    () =>
      evaluate(
        popup.session,
        'document.querySelector("#search-status").textContent.includes("No matches found in visible")',
      ),
    'live no-match feedback',
  );
  assert.equal(await evaluate(popup.session, 'document.querySelector("#results").hidden'), false);
  await evaluate(popup.session, 'document.querySelector("#clear-button").click()');
  await until(
    () =>
      evaluate(
        popup.session,
        'document.querySelector("#search-status").textContent.includes("Type to search")',
      ),
    'clear returns to idle',
  );
  process.stdout.write('PASS installed extension: live search, stable results and empty states\n');
  await query('hello world');
  assert.equal(
    await evaluate(popup.session, 'document.querySelector("#result-count").textContent'),
    '1',
  );
  process.stdout.write(
    'PASS installed extension: popup → content → offscreen → worker → results\n',
  );
  await query('hello');
  await evaluate(popup.session, 'document.querySelector("#next-button").click()');
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-index").textContent === "2"'),
    'next result',
  );
  await send('Target.closeTarget', { targetId: popup.targetId });
  popup = await openPopup();
  assert.equal(
    await evaluate(popup.session, 'document.querySelector("#result-index").textContent'),
    '2',
  );
  process.stdout.write('PASS installed extension: reopening preserves current result\n');
  await evaluate(fixtureSession, 'document.querySelectorAll("p")[1].textContent="replacement"');
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-count").textContent === "1"'),
    'dynamic result refresh',
  );
  process.stdout.write('PASS installed extension: mutation refresh\n');

  await query('HELLO');
  await evaluate(popup.session, 'document.querySelector("#match-case").click()');
  await until(
    () =>
      evaluate(
        popup.session,
        'document.querySelector("#result-count").textContent === "0" && document.querySelector("#search-query").getAttribute("aria-busy") !== "true"',
      ),
    'case option re-search',
  );
  await evaluate(popup.session, 'document.querySelector("#match-case").click()');
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-count").textContent === "1"'),
    'case option reset',
  );
  process.stdout.write('PASS installed extension: options apply immediately\n');
  await evaluate(
    fixtureSession,
    'const extra=document.createElement("p");extra.id="extra";extra.textContent="hello extra";document.body.appendChild(extra)',
  );
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-count").textContent === "2"'),
    'added match',
  );
  await evaluate(popup.session, 'document.querySelector("#search-query").focus()');
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    },
    popup.session,
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    },
    popup.session,
  );
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-index").textContent === "2"'),
    'Enter navigation',
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 8,
    },
    popup.session,
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      modifiers: 8,
    },
    popup.session,
  );
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-index").textContent === "1"'),
    'Shift Enter navigation',
  );
  await evaluate(popup.session, 'document.querySelector("#search-form").requestSubmit()');
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-index").textContent === "2"'),
    'submit advances like Enter',
  );
  await evaluate(popup.session, 'document.querySelector("#search-form").requestSubmit()');
  assert.equal(
    await evaluate(popup.session, 'document.querySelector("#result-index").textContent'),
    '2',
    'Submit at the end must not reset the search',
  );
  await evaluate(
    popup.session,
    `document.querySelector('#search-query').value='changed draft';document.querySelector('#search-query').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#next-button').click();`,
  );
  assert.equal(
    await evaluate(popup.session, 'document.querySelector("#next-button").disabled'),
    true,
    'Do not navigate stale results during input debounce',
  );
  await query('HELLO');
  process.stdout.write('PASS installed extension: submit navigation and stale-draft protection\n');
  await evaluate(fixtureSession, 'document.getElementById("extra").remove()');
  process.stdout.write('PASS installed extension: Enter and Shift+Enter navigation\n');

  await query('nested needle');
  assert(await evaluate(fixtureSession, 'document.querySelector("#scroller").scrollTop > 0'));
  process.stdout.write('PASS installed extension: nested scroll navigation\n');
  await evaluate(
    fixtureSession,
    'const large=document.createElement("p");large.id="large";large.textContent="x".repeat(250001);document.body.prepend(large)',
  );
  await query('not-on-this-fixture');
  assert(
    await evaluate(
      popup.session,
      '!document.querySelector("#search-warning").hidden && document.querySelector("#search-status").textContent.includes("searched portion")',
    ),
  );
  await evaluate(fixtureSession, 'document.getElementById("large").remove()');
  process.stdout.write('PASS installed extension: partial scan is distinct from no matches\n');
  await query('[', true);
  assert.match(
    await evaluate(popup.session, 'document.querySelector("#search-status").textContent'),
    /Invalid regular expression/,
  );
  await evaluate(
    fixtureSession,
    'document.body.appendChild(document.createTextNode("a".repeat(40000)+"!"))',
  );
  await query('(a+)+$', true);
  assert.match(
    await evaluate(popup.session, 'document.querySelector("#search-status").textContent'),
    /took too long/,
  );
  assert.equal(await evaluate(fixtureSession, '1+1'), 2);
  process.stdout.write(
    'PASS installed extension: catastrophic regex terminated; page remains responsive\n',
  );
  await query('hello');
  await evaluate(popup.session, 'document.querySelector("#clear-button").click()');
  await until(
    () => evaluate(popup.session, 'document.querySelector("#result-count").textContent === "0"'),
    'clear search',
  );
  process.stdout.write('PASS installed extension: recovery and Clear\n');
  assert.equal(
    await evaluate(popup.session, 'document.querySelector("#history-enabled").checked'),
    false,
  );
  await evaluate(
    popup.session,
    'document.querySelector("#history-enabled").checked=true;document.querySelector("#history-enabled").dispatchEvent(new Event("change"))',
  );
  await sleep(100);
  await query('hello');
  await until(
    async () =>
      Object.keys(await evaluate(popup.session, 'chrome.storage.local.get()')).includes(
        'sigma:searchHistory',
      ),
    'saved history',
  );
  await evaluate(popup.session, 'document.querySelector("#clear-history-button").click()');
  await until(
    async () =>
      !(await evaluate(popup.session, 'chrome.storage.local.get()'))['sigma:searchHistory'],
    'history deletion',
  );
  process.stdout.write('PASS installed extension: opt-in history and deletion\n');
  const permissions = await evaluate(popup.session, 'chrome.permissions.getAll()');
  assert(!permissions.origins?.length, 'No persistent host access.');
  process.stdout.write('PASS installed extension: no persistent host permissions\n');
  // Inspect a real popup render while leaving the user's normal browser untouched.
  if (process.env.SIGMA_SCREENSHOT) {
    const image = await send('Page.captureScreenshot', { format: 'png' }, popup.session);
    fs.writeFileSync(process.env.SIGMA_SCREENSHOT, Buffer.from(image.data, 'base64'));
    await send(
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
      popup.session,
    );
    const dark = await send('Page.captureScreenshot', { format: 'png' }, popup.session);
    const darkPath = process.env.SIGMA_SCREENSHOT.replace(/\.png$/i, '') + '-dark.png';
    fs.writeFileSync(darkPath, Buffer.from(dark.data, 'base64'));
  }
  process.stdout.write(
    `${report.total} DOM regressions and 13 installed-extension scenarios passed.\n`,
  );
}
main()
  .catch((error) => {
    process.stderr.write(`${error.stack}\n${JSON.stringify(errors.slice(-5))}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) {
      try {
        await send('Browser.close');
      } catch {
        browser.kill();
      }
    }
    server.close();
    pending.forEach((item) => {
      clearTimeout(item.timer);
    });
    await sleep(300);
    fs.rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });
