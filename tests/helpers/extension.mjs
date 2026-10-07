// Launch Chromium with the unpacked extension against a local HTTPS mock of
// classroom.google.com / drive / docs. Hostnames are mapped to 127.0.0.1 with
// --host-resolver-rules, so every request (page, content script, service
// worker, offscreen document) reaches the mock, exactly like real traffic.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createHandler, MOCK_HOSTS } from '../mock/classroom-mock.mjs';
import { chromiumPath, ROOT } from './browser.mjs';
import { tempDir } from './zip.mjs';

function makeCertificate(dir) {
  const config = `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=classroom.google.com\n[ext]\nsubjectAltName=${MOCK_HOSTS.map((h) => `DNS:${h}`).join(',')},DNS:*.googleusercontent.com\n`;
  writeFileSync(join(dir, 'openssl.cnf'), config);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-config', join(dir, 'openssl.cnf')], { stdio: 'pipe' });
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

export async function startMockServer(scenario, port = 443) {
  const dir = tempDir('gcx-e2e-cert-');
  const log = [];
  const handler = createHandler(scenario, log);
  const server = createServer(makeCertificate(dir), async (req, res) => {
    try {
      const out = await handler({ method: req.method, url: `https://${req.headers.host}${req.url}` });
      res.writeHead(out.status, out.headers);
      res.end(out.body);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(err && err.stack));
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, log, close: () => new Promise((r) => server.close(r)) };
}

export async function launchWithExtension() {
  const userDataDir = tempDir('gcx-e2e-profile-');
  const rules = [...MOCK_HOSTS, '*.googleusercontent.com', 'www.youtube.com', 'example.com'].map((h) => `MAP ${h} 127.0.0.1`).join(',');
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromiumPath(),
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      `--host-resolver-rules=${rules}`,
      '--ignore-certificate-errors',
      '--no-proxy-server',
    ],
    env: { ...process.env, HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '' },
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;
  return { context, worker, extensionId, userDataDir };
}

/** Open the popup for `tabId` in its own window so the Classroom tab stays active. */
export async function openPopup(context, worker, extensionId, tabId) {
  const url = `chrome-extension://${extensionId}/src/popup/popup.html?tabId=${tabId}`;
  const pagePromise = context.waitForEvent('page', (p) => p.url().startsWith(url.split('?')[0]));
  await worker.evaluate((u) => chrome.windows.create({ url: u, type: 'popup', width: 380, height: 640 }), url);
  const popup = await pagePromise;
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

export async function classroomTabId(worker, urlPrefix) {
  return worker.evaluate(async (prefix) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((t) => t.url && t.url.startsWith(prefix));
    return tab ? tab.id : null;
  }, urlPrefix);
}

/** Poll the persisted job until `predicate(job)` holds. */
export async function waitForJob(page, predicate, { timeout = 180000 } = {}) {
  const started = Date.now();
  let job = null;
  while (Date.now() - started < timeout) {
    job = await page.evaluate(async () => (await chrome.storage.session.get('gcx.job'))['gcx.job'] || null);
    if (job && predicate(job)) return job;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for job; last state: ${JSON.stringify(job && { phase: job.phase, error: job.error, discovery: job.discovery, progress: job.progress })}`);
}
