// Offscreen document: hosts the export engine.
//
// The service worker can be suspended when idle, which would lose in-flight
// downloads; this document lives until the background closes it. It owns the
// downloaded Blobs and the final archive's object URL, which chrome.downloads
// (in the service worker) saves to disk. For an account export it also keeps
// the archive being built between classes.

import '../shared/protocol.js';
import { AccountExport, runExport } from '../engine/export-engine.js';

const P = globalThis.GCX_PROTOCOL;
const ARCHIVE_LOST = 'The archive being built is no longer available (the browser closed the exporter in the background). Please export again.';
const WATCHDOG_MS = 30000;

// { jobId, controller, blobUrl, done, account: AccountExport|null,
//   adding: index of the class being added|null, finishing }
let job = null;

function send(message) {
  return chrome.runtime.sendMessage({ target: P.TARGET.BACKGROUND, ...message }).catch(() => {});
}

function throttle(fn, ms) {
  let last = 0;
  let timer = null;
  let pending = null;
  return (value) => {
    pending = value;
    const wait = ms - (Date.now() - last);
    if (wait <= 0) {
      last = Date.now();
      fn(pending);
      pending = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        if (pending) fn(pending);
        pending = null;
      }, wait);
    }
  };
}

function release() {
  if (job && job.blobUrl) URL.revokeObjectURL(job.blobUrl);
  if (job && job.controller) job.controller.abort();
  job = null;
}

/**
 * Throttled progress messages, plus a heartbeat that keeps the service worker
 * informed (and awake) during long single downloads. Progress of an account
 * export carries the class index, so late messages about a class are ignored.
 */
function progressReporter(jobId, classIndex) {
  const post = (progress) => send({ type: P.MSG.ENGINE_PROGRESS, jobId, classIndex, progress });
  const report = throttle(post, 250);
  let last = {};
  const heartbeat = setInterval(() => post({ ...last, heartbeat: Date.now() }), 5000);
  return {
    onProgress(progress) {
      last = progress;
      report(progress);
    },
    stop() {
      clearInterval(heartbeat);
    },
  };
}

function newJob(jobId, account = null) {
  release();
  job = { jobId, controller: new AbortController(), blobUrl: null, done: false, account, adding: null, finishing: false };
  return job;
}

async function archiveDone(current, { blob, archiveName, report }) {
  if (job !== current) return;
  current.blobUrl = URL.createObjectURL(blob);
  current.done = true;
  current.controller = null;
  current.account = null;
  await send({ type: P.MSG.ENGINE_DONE, jobId: current.jobId, blobUrl: current.blobUrl, archiveName, archiveBytes: blob.size, report });
}

async function archiveFailed(current, err) {
  if (job !== current) return;
  const cancelled = current.controller.signal.aborted || (err && err.code === 'cancelled');
  await send({
    type: P.MSG.ENGINE_ERROR,
    jobId: current.jobId,
    error: { message: cancelled ? 'Export cancelled' : (err && err.message) || String(err), code: cancelled ? 'cancelled' : (err && err.code) || 'error' },
  });
}

async function start({ jobId, snapshot, options }) {
  const current = newJob(jobId);
  const progress = progressReporter(jobId);
  try {
    const result = await runExport({ snapshot, options, signal: current.controller.signal, version: P.VERSION, onProgress: progress.onProgress });
    await archiveDone(current, result);
  } catch (err) {
    await archiveFailed(current, err);
  } finally {
    progress.stop();
  }
}

// Account export: start, then one message per class, then finish. A request
// repeated by a background that resumed a stalled job is not carried out twice.

function startAccount({ jobId, accountIndex, options }) {
  const current = newJob(jobId, new AccountExport({ accountIndex, options, version: P.VERSION }));
  // While the archive is open, wake the background now and then, so a job it
  // lost track of (its worker was suspended at a bad moment) is resumed
  // without waiting for the popup to be opened.
  const watchdog = setInterval(() => {
    if (job === current && current.account) send({ type: P.MSG.ENGINE_WATCHDOG, jobId });
    else clearInterval(watchdog);
  }, WATCHDOG_MS);
}

async function addClass({ classIndex, snapshot, ref }) {
  const current = job;
  if (current.adding === classIndex || current.account.added.has(classIndex)) return;
  current.adding = classIndex;
  const progress = progressReporter(current.jobId, classIndex);
  try {
    const outcome = await current.account.addClass(classIndex, { snapshot, ref }, { signal: current.controller.signal, onProgress: progress.onProgress });
    if (job === current) await send({ type: P.MSG.ENGINE_CLASS_DONE, jobId: current.jobId, classIndex, outcome });
  } catch (err) {
    await archiveFailed(current, err);
  } finally {
    progress.stop();
    current.adding = null;
  }
}

async function finishAccount({ classes, warnings }) {
  const current = job;
  if (current.finishing) return;
  current.finishing = true;
  try {
    await archiveDone(current, await current.account.finish(classes, { warnings }));
  } catch (err) {
    current.account = null; // the archive cannot be finished; frees its classes
    await archiveFailed(current, err);
  }
}

/** Where the account archive is, for the background to resume a stalled job. */
function accountState(current) {
  const outcomes = {};
  for (const index of current.account.added.keys()) outcomes[index] = current.account.outcome(index);
  return { adding: current.adding, finishing: current.finishing, outcomes };
}

function hasAccountJob(message) {
  return !!(job && job.jobId === message.jobId && job.account && !job.controller.signal.aborted);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== P.TARGET.OFFSCREEN) return false;
  switch (message.type) {
    case P.MSG.OFF_PING:
      sendResponse({ ok: true, jobId: job && job.jobId, running: !!(job && !job.done), blobUrl: job && job.blobUrl, account: job && job.account ? accountState(job) : null });
      return false;
    case P.MSG.OFF_START:
      start(message);
      sendResponse({ accepted: true });
      return false;
    case P.MSG.OFF_ACCOUNT_START:
      startAccount(message);
      sendResponse({ accepted: true });
      return false;
    case P.MSG.OFF_ACCOUNT_CLASS:
    case P.MSG.OFF_ACCOUNT_FINISH:
      if (!hasAccountJob(message)) {
        sendResponse({ accepted: false, error: ARCHIVE_LOST });
        return false;
      }
      if (message.type === P.MSG.OFF_ACCOUNT_CLASS) addClass(message);
      else finishAccount(message);
      sendResponse({ accepted: true });
      return false;
    case P.MSG.OFF_CANCEL:
      if (job && (!message.jobId || job.jobId === message.jobId) && job.controller) {
        job.controller.abort();
        job.account = null; // frees the classes already archived
      }
      sendResponse({ ok: true });
      return false;
    case P.MSG.OFF_RELEASE:
      if (!message.jobId || (job && job.jobId === message.jobId)) release();
      sendResponse({ ok: true });
      return false;
    default:
      return false;
  }
});

send({ type: P.MSG.ENGINE_READY });
