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
// Attached course documents (Google Docs and Slides, PDFs, Word and PowerPoint
// files) are downloaded with the person's own Google session, the same way the
// ZIP export downloads them, and sent as files for the website to read.

import { planDownload } from '../engine/download-resolver.js';
import { downloadWithRetry } from '../engine/fetcher.js';
import * as store from './store.js';

export const PROTOCOL = 'academic-scheduler/extension-import';
export const PROTOCOL_VERSION = 2;
/** Course documents sent with the classes: at most this many, this large each and in total. */
export const MAX_DOCUMENTS = 40;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_DOCUMENT_BYTES = 25 * 1024 * 1024;
const DOCUMENT_KINDS = new Set(['google-doc', 'google-slides', 'drive-file']);
const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const TYPE_BY_EXT = { '.pdf': PDF, '.docx': DOCX, '.pptx': PPTX };
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
      resources: (item.resources || []).map((r) => ({
        kind: r.kind,
        title: r.title || null,
        url: r.url,
        id: r.id || null,
        source: r.source || null,
        resourceKey: r.resourceKey || null,
        authuser: r.authuser ?? null,
        hint: r.hint || null,
        published: !!r.published,
      })),
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

function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Downloads the documents attached to the scanned items for the website to
 * read. A file that cannot be downloaded or is not a document is reported
 * with a status; it never stops the sending.
 */
export async function collectDocuments(snapshots, { download = downloadWithRetry } = {}) {
  const out = [];
  const seen = new Set();
  let total = 0;
  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      for (const r of item.resources) {
        if (!DOCUMENT_KINDS.has(r.kind) || !r.id || r.source !== 'attachment' || seen.has(r.id) || out.length >= MAX_DOCUMENTS) continue;
        seen.add(r.id);
        const doc = { fileId: r.id, courseId: snapshot.classInfo.courseId, itemId: item.id, itemType: item.type, title: r.title || 'Document', url: r.url };
        const plan = planDownload(r, { googleFormat: 'office' });
        if (!plan.downloadable) continue;
        let got = null;
        for (const attempt of plan.attempts) {
          try {
            got = { ...(await download(attempt.url, { retries: 1 })), ext: attempt.ext };
            break;
          } catch {
            // try the next way of downloading it
          }
        }
        if (!got) {
          out.push({ ...doc, status: 'inaccessible' });
          continue;
        }
        const mime = TYPE_BY_EXT[got.ext] || String(got.contentType || '').split(';')[0].trim();
        if (![PDF, DOCX, PPTX].includes(mime)) out.push({ ...doc, status: 'unsupported' });
        else if (got.size > MAX_DOCUMENT_BYTES || total + got.size > MAX_TOTAL_DOCUMENT_BYTES) out.push({ ...doc, status: 'too_large' });
        else {
          total += got.size;
          out.push({ ...doc, status: 'file', mime, data: base64(await got.blob.arrayBuffer()) });
        }
      }
    }
  }
  return out;
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
  const documents = await collectDocuments(snapshots);
  const message = { protocol: PROTOCOL, version: PROTOCOL_VERSION, type: 'import', id: crypto.randomUUID(), sentAt: new Date().toISOString(), snapshots, documents };
  const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: deliver, args: [message, origin] });
  const result = injection && injection.result;
  if (!result || !result.ok) throw new Error((result && result.message) || 'The website did not receive the scan.');
  return { classes: snapshots.length, documents: documents.filter((d) => d.status === 'file').length };
}
