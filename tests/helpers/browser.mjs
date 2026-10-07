// Headless Chromium for DOM tests (no extension): pages are served from the
// mock Classroom through request interception and the real content scripts
// are injected into them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createHandler, MOCK_HOSTS } from '../mock/classroom-mock.mjs';
import { CONTENT_FILES } from './content.mjs';

export const ROOT = new URL('../..', import.meta.url).pathname;

export function chromiumPath() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  return found || undefined; // fall back to playwright's own lookup
}

export async function launchBrowser() {
  return chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-proxy-server'] });
}

/** A browser context whose Google hosts are answered by the mock. */
export async function mockContext(browser, scenario, log = []) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const handler = createHandler(scenario, log);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!MOCK_HOSTS.includes(url.host)) return route.abort();
    const res = await handler({ method: route.request().method(), url: url.href });
    return route.fulfill({ status: res.status, headers: res.headers, body: res.body });
  });
  return context;
}

export async function injectContentScripts(page) {
  for (const file of CONTENT_FILES) await page.addScriptTag({ path: join(ROOT, file) });
}

/** Run one discovery step in the page and return its result. */
export function runStep(page, step, payload = {}) {
  return page.evaluate(
    async ({ step, payload }) => {
      const reports = [];
      const result = await globalThis.GCX.discovery.runStep(step, payload, {
        signal: new AbortController().signal,
        report: (p) => reports.push(p),
      });
      return { result, reports };
    },
    { step, payload },
  );
}
