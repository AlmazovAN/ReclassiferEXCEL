/* Real offline Chromium acceptance for the CORE build: no private data needed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find(p => p && fs.existsSync(p));
if (!chrome) throw new Error('CORE acceptance requires local Chromium');
const dist = process.env.RECLASSIFIER_CORE_HTML_DIR || path.join(__dirname, '..', 'dist');
const artifacts = fs.readdirSync(dist).filter(name => /^Reclassifier_v.*_CORE\.html$/.test(name));
assert.equal(artifacts.length, 1, 'Expected exactly one CORE artifact');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'reclassifier-core-test-'));
const downloads = path.join(profile, 'downloads');
fs.mkdirSync(downloads);
const child = spawn(chrome, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--disable-background-networking', '--disable-default-apps',
  '--disable-component-update', '--disable-extensions', '--no-first-run',
  '--remote-allow-origins=*', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-3000); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pending = new Map();
let socket;
let commandId = 0;
const requests = [];
async function command(method, params = {}, timeout = 30000) {
  const id = ++commandId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Chromium timeout: ' + method));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, timeout = 30000) {
  let result;
  try {
    result = await command('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    }, timeout);
  } catch (error) {
    throw Error(error.message + ' while evaluating: ' + expression.slice(0, 240));
  }
  if (result.exceptionDetails) {
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}
async function until(description, expression, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { if (await evaluate(expression)) return; } catch (_) {}
    await pause(250);
  }
  throw new Error('Timeout waiting for: ' + description);
}
async function downloaded(extension, existing = new Set()) {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    const match = fs.readdirSync(downloads).find(name =>
      !existing.has(name) && name.toLowerCase().endsWith(extension) &&
      !name.endsWith('.crdownload'));
    if (match && fs.statSync(path.join(downloads, match)).size > 1000) {
      return path.join(downloads, match);
    }
    await pause(200);
  }
  throw new Error('Download not found for file type: ' + extension);
}
const existingDownloads = () => new Set(fs.readdirSync(downloads));
(async () => {
  try {
    const activeFile = path.join(profile, 'DevToolsActivePort');
    const start = Date.now();
    while (!fs.existsSync(activeFile) && Date.now() - start < 45000) {
      if (child.exitCode !== null) throw Error('Chromium exited: ' + stderr);
      await pause(150);
    }
    assert(fs.existsSync(activeFile), 'No CDP port: ' + stderr);
    const port = Number(fs.readFileSync(activeFile, 'utf8').split('\n')[0]);
    let pages;
    for (let n = 0; n < 30; n++) {
      try {
        pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        if (pages.some(p => p.type === 'page')) break;
      } catch (_) {}
      await pause(100);
    }
    const target = pages?.find(p => p.type === 'page');
    assert(target, 'No Chromium target');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch (_) { return; }
      if (message.method === 'Page.javascriptDialogOpening') {
        void command('Page.handleJavaScriptDialog', { accept: true }, 5000).catch(() => {});
      }
      if (message.method === 'Network.requestWillBeSent') {
        if (/^https?:/i.test(message.params?.request?.url || '')) {
          requests.push(message.params.request.url);
        }
      }
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      clearTimeout(callback.timer);
      if (message.error) callback.reject(Error(JSON.stringify(message.error)));
      else callback.resolve(message.result || {});
    });
    await command('Page.enable');
    await command('Runtime.enable');
    await command('Network.enable');
    await command('Network.emulateNetworkConditions',
      { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    try {
      await command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    } catch (_) {
      await command('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    }
    await command('Page.navigate', { url: pathToFileURL(path.join(dist, artifacts[0])).href });
    console.log('CORE browser: page navigated, checking startup');
    await until('CORE database controls enabled', `(() => {
      document.querySelector('[data-testid="nav-database"]')?.click();
      return window.RECLASSIFIER_BUILD?.coreBuild &&
        Boolean(window.ReclassifierDatabaseRepository?.openDatabase) &&
        Boolean(document.querySelector('[data-testid="database-open"]')) &&
        !document.querySelector('[data-testid="database-export-html-snapshot"]')?.disabled;
    })()`);
    console.log('CORE browser: startup complete, checking empty Dataset store');
    const baseline = await evaluate(`(() => ({
      mode: window.RECLASSIFIER_BUILD.dataMode,
      embeddedGlobals: Object.keys(window).filter(key => key.startsWith('RECLASSIFIER_EMBEDDED_')),
      active: window.ReclassifierLegacyDatasetStore.list().filter(row => row.active).length,
      hasOpenButton: !document.querySelector('[data-testid="database-open"]').disabled,
      allRecalculationButton: Boolean(document.getElementById('databaseRecalculationAllButton')),
      checkpointControl: Boolean(document.getElementById('databaseCreateRecovery')),
      autosaveControl: Boolean(document.getElementById('databaseAutoSaveToggle')),
      autosaveStartsOff: !document.getElementById('databaseAutoSaveToggle')?.textContent.includes('Выключить')
    }))()`);
    assert.equal(baseline.mode, 'core-no-data');
    assert.deepEqual(baseline.embeddedGlobals, [], 'CORE must not publish embedded dataset globals');
    assert.equal(baseline.active, 0, 'CORE unexpectedly loaded business records');
    assert.equal(baseline.hasOpenButton, true);
    assert.equal(baseline.allRecalculationButton, true,
      'CORE must expose the complete supported recalculation entrypoint');
    assert.equal(baseline.checkpointControl, true,
      'CORE must expose explicit local checkpoint control');
    assert.equal(baseline.autosaveControl, true,
      'CORE must expose session-only autosave control');
    assert.equal(baseline.autosaveStartsOff, true,
      'CORE must never enable automatic disk writes without opt-in');

    // The original SQLite repository must work without any embedded Dataset.
    console.log('CORE browser: empty Dataset store confirmed, checking SQLite roundtrip');
    const sqlite = await evaluate(`(async () => {
      const repo = window.ReclassifierDatabaseRepository;
      await repo.createDatabase({ fileName:'CoreRoundtrip.db',
        appVersion:window.RECLASSIFIER_BUILD.version });
      const id = repo.getDatabaseInfo().databaseUuid;
      const bytes = repo.exportDatabase();
      repo.closeDatabase();
      await repo.openDatabase(bytes, { fileName:'CoreRoundtrip.db' });
      const info = repo.getDatabaseInfo();
      const checked = repo.runHealthCheck();
      return { originalId:id, reopenedId:info.databaseUuid,
        schema:info.schemaVersion, valid:info.valid, healthOk:checked.ok,
        size:bytes.length, authoritative:window.ReclassifierRuntimeDataRepository.isSqliteAuthoritative() };
    })()`, 120000);
    assert.equal(sqlite.reopenedId, sqlite.originalId);
    assert(sqlite.size > 1000);
    assert.equal(sqlite.valid, true);
    assert.equal(sqlite.healthOk, true);
    assert.equal(sqlite.authoritative, true);

    // The same save-snapshot button remains operable with SQLite authoritative.
    console.log('CORE browser: SQLite roundtrip complete, checking HTML exports');
    const beforeSnapshot = existingDownloads();
    await evaluate('document.querySelector("[data-testid=nav-database]").click(); ' +
      'document.querySelector("[data-testid=database-export-html-snapshot]").click(); true');
    const snapshot = await downloaded('.html',beforeSnapshot);
    // Snapshot completion shows an alert; dismiss it before the next command.
    try { await command('Page.handleJavaScriptDialog', { accept: true }, 5000); } catch (_) {}
    const snapshotHtml = fs.readFileSync(snapshot, 'utf8');
    assert(snapshotHtml.includes('"source":"sqlite"'), 'HTML snapshot did not use SQLite');
    assert(snapshotHtml.includes('"datasets":[]'), 'Empty SQLite snapshot should have empty dataset list');
    const beforeApplication = existingDownloads();
    await evaluate('document.querySelector("[data-testid=database-export-application]").click(); true');
    const application = await downloaded('.html',beforeApplication);
    assert(fs.readFileSync(application, 'utf8').includes('"coreBuild": true'));
    assert.equal(requests.length, 0, 'CORE attempted an external network request');
    console.log('CORE browser accepted offline: '+artifacts[0]+'; SQLite roundtrip bytes='+sqlite.size+
      '; HTML snapshot bytes='+fs.statSync(snapshot).size);
  } finally {
    try { socket?.close(); } catch (_) {}
    // Chromium may keep creating profile files after the parent is signalled.
    // Await its exit and retry transient ENOTEMPTY/EBUSY cleanup races, rather
    // than failing an otherwise successful offline CORE acceptance.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGKILL');
      await Promise.race([exited, pause(5000)]);
    }
    try {
      fs.rmSync(profile, {
        recursive: true, force: true, maxRetries: 20, retryDelay: 100
      });
    } catch (error) {
      // Detached Chromium children may write back to the profile after their
      // parent has exited. GitHub-hosted runner is ephemeral, so a transient
      // nonempty/busy profile is cleanup-only and must not invalidate a fully
      // passed SQLite and offline browser acceptance. Other errors still fail.
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      console.warn('CORE test cleanup deferred (temporary Chromium profile): ' +
        error.code + ' · ' + profile);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
