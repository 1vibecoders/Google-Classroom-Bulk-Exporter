// Sending scanned classes to the Academic Scheduler website (SPEC.md § 12.2).
//
// One-way and versioned: the extension opens the website address the person
// chose (after they granted access to that one origin), and a script injected
// into that tab hands the scans to the page with window.postMessage, repeating
// until the page confirms receipt. The website validates the data and shows
// its import preview, so nothing changes until the person imports. The
// extension never takes commands from the page; it only reads the receipt.
//
// What is sent is the scan as read from Classroom's pages (titles, texts,
// dates as displayed, links); the website turns it into its import batch.

import * as store from './store.js';

export const PROTOCOL = 'academic-scheduler/extension-import';
export const PROTOCOL_VERSION = 1;
/** Classes kept for sending (the most recently scanned). */
export const MAX_CLASSES = 40;
const LOAD_TIMEOUT_MS = 30000;

/** The part of a class scan the website uses. */
export function sendableSnapshot(snapshot) {
  const info = snapshot.classInfo || {};
  return {
    createdAt: snapshot.createdAt,
    classInfo: { courseId: info.courseId, name: info.name, section: info.section || null, url: info.url || null },
    topics: (snapshot.topics || []).map((t) => ({ id: t.id || null, name: t.name })),
    items: (snapshot.items || []).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      topic: item.topic || null,
      description: item.description || '',
      classroomUrl: item.classroomUrl || null,
      meta: { dueText: item.meta?.dueText || null, pointsText: item.meta?.pointsText || null, postedText: item.meta?.postedText || null },
      resources: (item.resources || []).map((r) => ({ kind: r.kind, title: r.title || null, url: r.url })),
    })),
    warnings: snapshot.warnings || [],
  };
}

/** Keep the newest scan of each class (one per course id). */
export async function rememberSnapshot(snapshot) {
  const courseId = snapshot?.classInfo?.courseId;
  if (!courseId) return;
  const kept = (await store.getSendable()).filter((s) => s.classInfo.courseId !== courseId);
  kept.push(sendableSnapshot(snapshot));
  await store.setSendable(kept.slice(-MAX_CLASSES));
}

/** The origin of a website address the person typed: https, or http on this computer. Null otherwise. */
export function siteOrigin(text) {
  try {
    const url = new URL(String(text).trim());
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  } catch {
    // not a URL
  }
  return null;
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const done = (fn) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      fn();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') done(resolve);
    };
    const onRemoved = (id) => {
      if (id === tabId) done(() => reject(new Error('The website tab was closed.')));
    };
    const timer = setTimeout(() => done(() => reject(new Error('The website did not finish loading.'))), LOAD_TIMEOUT_MS);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((tab) => tab.status === 'complete' && done(resolve), () => {});
  });
}

/**
 * Injected into the website tab (must be self-contained). Posts the message to
 * the page until the page answers with a receipt for this message id.
 */
export function deliver(message, origin) {
  return new Promise((resolve) => {
    if (location.origin !== origin) {
      resolve({ ok: false, message: 'The tab is not showing the Academic Scheduler.' });
      return;
    }
    let finished = false;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearInterval(repeat);
      clearTimeout(limit);
      window.removeEventListener('message', onReply);
      resolve(result);
    };
    const onReply = (event) => {
      const d = event.data;
      if (event.source !== window || event.origin !== origin || !d || d.protocol !== message.protocol || d.type !== 'received' || d.id !== message.id) return;
      finish(d.ok === true ? { ok: true } : { ok: false, message: typeof d.message === 'string' ? d.message.slice(0, 300) : 'The website could not use the scan.' });
    };
    window.addEventListener('message', onReply);
    const post = () => window.postMessage(message, origin);
    const repeat = setInterval(post, 500);
    const limit = setTimeout(() => finish({ ok: false, message: 'The website did not answer. Check the address, and that the website is up to date.' }), 20000);
    post();
  });
}

/** Open the website and hand it every remembered class scan. */
export async function sendToScheduler(siteUrl) {
  const origin = siteOrigin(siteUrl);
  if (!origin) throw new Error('Enter the website address, starting with https://');
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) throw new Error(`The extension may not open ${origin} yet. Click Send again and allow it.`);
  const snapshots = await store.getSendable();
  if (!snapshots.length) throw new Error('Scan or export a class first.');
  await store.setSchedulerSite(origin);
  const tab = await chrome.tabs.create({ url: `${origin}/#/import` });
  await waitForLoad(tab.id);
  const message = { protocol: PROTOCOL, version: PROTOCOL_VERSION, type: 'import', id: crypto.randomUUID(), sentAt: new Date().toISOString(), snapshots };
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deliver, args: [message, origin] });
  const result = injection && injection.result;
  if (!result || !result.ok) throw new Error((result && result.message) || 'The website did not receive the scan.');
  return { classes: snapshots.length };
}
