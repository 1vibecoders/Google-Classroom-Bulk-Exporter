// Offscreen document: hosts the export engine.
//
// The service worker can be suspended when idle, which would lose in-flight
// downloads; this document lives until the background closes it. It owns the
// downloaded Blobs and the final archive's object URL, which chrome.downloads
// (in the service worker) saves to disk.

import '../shared/protocol.js';
import { runExport } from '../engine/export-engine.js';

const P = globalThis.GCX_PROTOCOL;

let job = null; // { jobId, controller, blobUrl, done }

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

async function start({ jobId, snapshot, options }) {
  release();
  const controller = new AbortController();
  job = { jobId, controller, blobUrl: null, done: false };
  const current = job;
  const report = throttle((progress) => send({ type: P.MSG.ENGINE_PROGRESS, jobId, progress }), 250);
  // Keep the service worker informed (and awake) during long single downloads.
  let lastProgress = {};
  const heartbeat = setInterval(() => send({ type: P.MSG.ENGINE_PROGRESS, jobId, progress: { ...lastProgress, heartbeat: Date.now() } }), 5000);
  try {
    const { blob, archiveName, report: exportReport } = await runExport({
      snapshot,
      options,
      signal: controller.signal,
      version: P.VERSION,
      onProgress: (progress) => {
        lastProgress = progress;
        report(progress);
      },
    });
    if (job !== current) return;
    current.blobUrl = URL.createObjectURL(blob);
    current.done = true;
    current.controller = null;
    await send({ type: P.MSG.ENGINE_DONE, jobId, blobUrl: current.blobUrl, archiveName, archiveBytes: blob.size, report: exportReport });
  } catch (err) {
    if (job !== current) return;
    const cancelled = controller.signal.aborted || (err && err.code === 'cancelled');
    await send({
      type: P.MSG.ENGINE_ERROR,
      jobId,
      error: { message: cancelled ? 'Export cancelled' : (err && err.message) || String(err), code: cancelled ? 'cancelled' : (err && err.code) || 'error' },
    });
  } finally {
    clearInterval(heartbeat);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== P.TARGET.OFFSCREEN) return false;
  switch (message.type) {
    case P.MSG.OFF_PING:
      sendResponse({ ok: true, jobId: job && job.jobId, running: !!(job && !job.done), blobUrl: job && job.blobUrl });
      return false;
    case P.MSG.OFF_START:
      start(message);
      sendResponse({ accepted: true });
      return false;
    case P.MSG.OFF_CANCEL:
      if (job && (!message.jobId || job.jobId === message.jobId) && job.controller) job.controller.abort();
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
