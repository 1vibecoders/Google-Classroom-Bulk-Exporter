// Export job state machine.
//
//   preparing -> discovering (classwork -> stream -> details) -> scanned
//                                                           \-> downloading -> zipping -> saving -> complete
//   any active phase -> failed | cancelled
//
// Every transition is triggered by an event (popup command, content-script or
// offscreen message, tab or download event) and persisted, so the service
// worker can be suspended and restarted between any two events.

import '../shared/protocol.js';
import '../content/namespace.js';
import '../content/url-model.js';
import { planDownload } from '../engine/download-resolver.js';
import * as store from './store.js';
import { ensureContentScript, getTab, pingTab, sendToTab } from './tab-bridge.js';
import { closeOffscreen, ensureOffscreen, pingOffscreen, sendToOffscreen } from './offscreen-bridge.js';

const P = globalThis.GCX_PROTOCOL;
const urls = globalThis.GCX.url;
const STALE_MS = 90000;
const SNAPSHOT_REUSE_MS = 15 * 60 * 1000;

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Counts shown in the popup
// ---------------------------------------------------------------------------

export function countSnapshot(snapshot, options) {
  const counts = { items: 0, assignment: 0, material: 0, question: 0, announcement: 0, other: 0, files: 0, links: 0 };
  for (const item of snapshot.items || []) {
    counts.items++;
    counts[item.type in counts ? item.type : 'other']++;
    for (const r of item.resources || []) {
      if (planDownload(r, { googleFormat: options.googleFormat }).downloadable) counts.files++;
      else counts.links++;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Popup commands
// ---------------------------------------------------------------------------

export async function inspectTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab) return { supported: false, reason: 'no-tab' };
  const parsed = urls.parse(tab.url || '');
  if (!parsed.isClassroom) return { supported: false, reason: 'not-classroom' };
  if (!parsed.courseId) return { supported: false, reason: 'no-class', page: parsed.page };
  const base = { supported: true, tabId, courseId: parsed.courseId, page: parsed.page, className: null, section: null };
  if (tab.status !== 'complete') return { ...base, loading: true };
  try {
    await ensureContentScript(tabId);
    const res = await sendToTab(tabId, { type: P.MSG.CS_INSPECT });
    if (res && res.ok) return { ...base, className: res.info.className, section: res.info.section, page: res.info.page };
  } catch (err) {
    return { ...base, inspectError: err.message };
  }
  return base;
}

export async function startJob({ tabId, mode, options: requested }) {
  const options = await store.setOptions(requested || {});
  return store.withLock(async () => {
    const existing = await store.getJob();
    if (store.isActive(existing)) throw new Error('An export is already running.');
    const tab = await getTab(tabId);
    const parsed = urls.parse((tab && tab.url) || '');
    if (!tab || !parsed.isClassroom || !parsed.courseId) {
      throw new Error('Open a class in Google Classroom (classroom.google.com) first.');
    }
    if (existing && existing.result && existing.result.blobUrl) {
      sendToOffscreen({ type: P.MSG.OFF_RELEASE, jobId: existing.id }, { attempts: 1 }).catch(() => {});
    }
    const steps = [P.STEP.CLASSWORK];
    if (options.includeAnnouncements) steps.push(P.STEP.STREAM);
    steps.push(P.STEP.DETAILS);
    const job = {
      id: newId(),
      mode: mode === 'scan' ? 'scan' : 'export',
      tabId,
      courseId: parsed.courseId,
      classContext: { courseId: parsed.courseId, authuser: parsed.authuser, prefix: parsed.prefix },
      className: null,
      originalUrl: tab.url,
      options,
      phase: P.PHASE.PREPARING,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      steps,
      stepIndex: 0,
      nav: null,
      discovery: { message: 'Preparing…', itemsFound: 0 },
      counts: null,
      progress: null,
      result: null,
      error: null,
      warnings: [],
    };

    // Reuse the scan when the user exports right after "Scan only".
    const snapshot = await store.getSnapshot();
    if (
      job.mode === 'export' &&
      existing &&
      existing.phase === P.PHASE.SCANNED &&
      urls.sameId(existing.courseId, job.courseId) &&
      snapshot &&
      urls.sameId(snapshot.classInfo && snapshot.classInfo.courseId, job.courseId) &&
      Date.now() - Date.parse(snapshot.createdAt) < SNAPSHOT_REUSE_MS &&
      snapshot.optionsKey === optionsKey(options)
    ) {
      job.className = snapshot.classInfo.name;
      job.counts = countSnapshot(snapshot, options);
      job.reusedScan = true;
      await store.setJob(job);
      queueMicrotask(() => startEngine(job.id).catch((err) => failJob(job.id, err.message)));
      return job;
    }

    await store.setStepData({});
    await store.setSnapshot(null);
    job.phase = P.PHASE.DISCOVERING;
    await store.setJob(job);
    queueMicrotask(() => beginStep(job.id).catch((err) => failJob(job.id, err.message)));
    return job;
  });
}

function optionsKey(options) {
  return `${options.includeAnnouncements ? 1 : 0}${options.readDetailPages ? 1 : 0}`;
}

export async function cancelJob() {
  const job = await store.updateJob((j) => {
    if (!store.isActive(j)) return false;
    j.phase = P.PHASE.CANCELLED;
    j.error = { message: 'Export cancelled.', code: 'cancelled' };
  });
  if (!job || job.phase !== P.PHASE.CANCELLED) return job;
  sendToTab(job.tabId, { type: P.MSG.CS_CANCEL, jobId: job.id }).catch(() => {});
  sendToOffscreen({ type: P.MSG.OFF_CANCEL, jobId: job.id }, { attempts: 1 }).catch(() => {});
  if (job.result && job.result.downloadId != null) chrome.downloads.cancel(job.result.downloadId).catch(() => {});
  await restoreTab(job);
  return job;
}

export async function resetJob() {
  return store.withLock(async () => {
    const job = await store.getJob();
    if (store.isActive(job)) return job;
    if (job) {
      sendToOffscreen({ type: P.MSG.OFF_RELEASE, jobId: job.id }, { attempts: 1 }).catch(() => {});
      closeOffscreen();
    }
    await store.setJob(null);
    return null;
  });
}

export async function showArchive() {
  const job = await store.getJob();
  if (job && job.result && job.result.downloadId != null) chrome.downloads.show(job.result.downloadId);
}

export async function retrySave() {
  const job = await store.getJob();
  if (!job || !job.result || !job.result.blobUrl) throw new Error('The archive is no longer available. Export again.');
  const ping = await pingOffscreen();
  if (!ping || ping.blobUrl !== job.result.blobUrl) throw new Error('The archive is no longer available. Export again.');
  await saveArchive(job.id);
}

/** Popup state request; also detects jobs whose worker has gone silent. */
export async function getState() {
  let job = await store.getJob();
  if (store.isActive(job) && Date.now() - (job.lastActivity || 0) > STALE_MS) {
    await checkStale(job);
    job = await store.getJob();
  }
  return { job, options: await store.getOptions() };
}

async function checkStale(job) {
  if (job.phase === P.PHASE.DISCOVERING || job.phase === P.PHASE.PREPARING) {
    if (job.nav) {
      const tab = await getTab(job.tabId);
      if (tab && tab.status !== 'complete') return;
    }
    const ping = await pingTab(job.tabId);
    if (!ping || ping.jobId !== job.id) await failJob(job.id, 'Lost contact with the Classroom tab (was it reloaded, closed or navigated away?).');
  } else if (job.phase === P.PHASE.DOWNLOADING || job.phase === P.PHASE.ZIPPING) {
    const ping = await pingOffscreen();
    if (!ping || ping.jobId !== job.id) await failJob(job.id, 'The export stopped unexpectedly. Please try again.');
  } else if (job.phase === P.PHASE.SAVING && job.result && job.result.downloadId != null) {
    const [item] = await chrome.downloads.search({ id: job.result.downloadId });
    if (item) await onDownloadChanged({ id: item.id, state: { current: item.state }, error: item.error ? { current: item.error } : undefined });
  }
}

// ---------------------------------------------------------------------------
// Discovery steps
// ---------------------------------------------------------------------------

function stepTarget(job, step) {
  if (step === P.STEP.CLASSWORK) return { page: 'classwork', url: urls.classworkUrl(job.classContext) };
  if (step === P.STEP.STREAM) return { page: 'stream', url: urls.streamUrl(job.classContext) };
  return null;
}

async function beginStep(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || job.phase !== P.PHASE.DISCOVERING) return;
  const step = job.steps[job.stepIndex];
  const target = stepTarget(job, step);
  const tab = await getTab(job.tabId);
  if (!tab) return failJob(jobId, 'The Classroom tab was closed.');
  if (target) {
    const current = urls.parse(tab.url || '');
    const onPage = current.page === target.page && urls.sameId(current.courseId, job.courseId) && tab.status === 'complete';
    if (!onPage) {
      await store.updateJob((j) => {
        if (j.id !== jobId) return false;
        j.nav = { url: target.url, page: target.page, step };
        j.discovery = { ...j.discovery, message: step === P.STEP.CLASSWORK ? 'Opening the Classwork page…' : 'Opening the Stream…' };
        j.lastActivity = Date.now();
      });
      await chrome.tabs.update(job.tabId, { url: target.url });
      return; // continues in onTabUpdated once the page has loaded
    }
  }
  await sendStep(jobId);
}

async function sendStep(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || job.phase !== P.PHASE.DISCOVERING) return;
  const step = job.steps[job.stepIndex];
  await ensureContentScript(job.tabId);
  let payload = { options: job.options };
  if (step === P.STEP.DETAILS) {
    const stepData = await store.getStepData();
    payload = { options: job.options, classwork: stepData.classwork || null, stream: stepData.stream || null, classContext: job.classContext };
  }
  const res = await sendToTab(job.tabId, { type: P.MSG.CS_RUN_STEP, jobId, step, payload });
  if (!res || !res.accepted) throw new Error('The Classroom tab did not accept the request.');
  await store.updateJob((j) => {
    if (j.id !== jobId) return false;
    j.lastActivity = Date.now();
  });
}

export async function onContentProgress(message) {
  await store.updateJob((job) => {
    if (job.id !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return false;
    const { heartbeat, ...progress } = message.progress || {};
    job.discovery = { ...job.discovery, ...progress, step: message.step };
    job.lastActivity = Date.now();
  });
}

export async function onStepResult(message) {
  const job = await store.getJob();
  if (!job || job.id !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return;
  const step = job.steps[job.stepIndex];
  if (step !== message.step) return;

  if (step === P.STEP.DETAILS) {
    const snapshot = message.result.snapshot;
    snapshot.optionsKey = optionsKey(job.options);
    await store.setSnapshot(snapshot);
    await store.setStepData({});
    const updated = await store.updateJob((j) => {
      if (j.id !== job.id) return false;
      j.className = snapshot.classInfo.name;
      j.counts = countSnapshot(snapshot, j.options);
      j.warnings = snapshot.warnings || [];
      j.discovery = { ...j.discovery, message: 'Class scanned.', current: '' };
      j.lastActivity = Date.now();
      // Leave the discovering phase before the tab is navigated back, so the
      // navigation is not mistaken for the user leaving mid-scan.
      j.phase = j.mode === 'scan' ? P.PHASE.SCANNED : P.PHASE.DOWNLOADING;
    });
    await restoreTab(updated);
    if (updated.mode === 'export') await startEngine(updated.id);
    return;
  }

  const stepData = await store.getStepData();
  stepData[step] = message.result;
  await store.setStepData(stepData);
  await store.updateJob((j) => {
    if (j.id !== job.id) return false;
    j.stepIndex++;
    j.lastActivity = Date.now();
    const info = message.result.classInfo;
    if (info && info.name && (!j.className || step === P.STEP.STREAM)) j.className = info.name;
    if (step === P.STEP.CLASSWORK) j.discovery = { ...j.discovery, itemsFound: (message.result.items || []).length };
  });
  await beginStep(job.id);
}

export async function onStepError(message) {
  const job = await store.getJob();
  if (!job || job.id !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return;
  const error = message.error || {};
  // Announcements are optional: a broken Stream page should not sink the export.
  if (message.step === P.STEP.STREAM && error.code !== 'navigated-away' && error.code !== 'cancelled') {
    const stepData = await store.getStepData();
    stepData.stream = { announcements: [], refs: [], warnings: [`Announcements were skipped: ${error.message}`] };
    await store.setStepData(stepData);
    await store.updateJob((j) => {
      if (j.id !== job.id) return false;
      j.stepIndex++;
    });
    await beginStep(job.id);
    return;
  }
  await failJob(job.id, error.message || 'Scanning the class failed.', error.code);
}

// ---------------------------------------------------------------------------
// Tab events
// ---------------------------------------------------------------------------

export async function onTabUpdated(tabId, changeInfo, tab) {
  const job = await store.getJob();
  if (!job || job.tabId !== tabId || job.phase !== P.PHASE.DISCOVERING) return;
  const url = changeInfo.url || tab.url || '';
  const parsed = urls.parse(url);

  if (job.nav) {
    if (changeInfo.url && (!parsed.isClassroom || !urls.sameId(parsed.courseId, job.courseId))) {
      if (/accounts\.google\.com/.test(changeInfo.url)) return failJob(job.id, 'Google asked you to sign in. Sign in to Classroom and try again.');
      return failJob(job.id, 'The tab left the class while the exporter was opening a Classroom page.', 'navigated-away');
    }
    if (changeInfo.status === 'complete' && parsed.page === job.nav.page && urls.sameId(parsed.courseId, job.courseId)) {
      await store.updateJob((j) => {
        if (j.id !== job.id) return false;
        j.nav = null;
        j.lastActivity = Date.now();
      });
      try {
        await sendStep(job.id);
      } catch (err) {
        await failJob(job.id, err.message);
      }
    }
    return;
  }

  // Leaving the class is fatal right away. Moves within the class are judged
  // by the content script at its checkpoints (it may briefly open an item page
  // itself), and full reloads are caught by the ping below.
  if (changeInfo.url && (!parsed.isClassroom || !urls.sameId(parsed.courseId, job.courseId))) {
    sendToTab(tabId, { type: P.MSG.CS_CANCEL, jobId: job.id }).catch(() => {});
    return failJob(job.id, 'Export stopped because the Classroom tab navigated away while the class was being scanned. Stay on the page until scanning finishes.', 'navigated-away');
  }
  if (changeInfo.status === 'complete') {
    // A full page load replaces the content script; make sure ours survived.
    const ping = await pingTab(tabId);
    if (!ping || ping.jobId !== job.id) {
      await failJob(job.id, 'Export stopped because the Classroom tab was reloaded while the class was being scanned.', 'navigated-away');
    }
  }
}

export async function onTabRemoved(tabId) {
  const job = await store.getJob();
  if (!job || job.tabId !== tabId) return;
  if (job.phase === P.PHASE.DISCOVERING || job.phase === P.PHASE.PREPARING) {
    await failJob(job.id, 'The Classroom tab was closed while the class was being scanned.', 'tab-closed');
  }
}

async function restoreTab(job) {
  if (!job || !job.originalUrl) return;
  const tab = await getTab(job.tabId);
  if (!tab || tab.url === job.originalUrl) return;
  const parsed = urls.parse(tab.url || '');
  // Only take the user back if we moved them within the class.
  if (parsed.isClassroom && urls.sameId(parsed.courseId, job.courseId)) {
    chrome.tabs.update(job.tabId, { url: job.originalUrl }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Export engine (offscreen document)
// ---------------------------------------------------------------------------

async function startEngine(jobId) {
  const snapshot = await store.getSnapshot();
  const job = await store.updateJob((j) => {
    if (j.id !== jobId) return false;
    j.phase = P.PHASE.DOWNLOADING;
    j.lastActivity = Date.now();
    j.progress = { phase: 'downloading', filesDone: 0, filesTotal: j.counts ? j.counts.files : 0, itemIndex: 0, itemTotal: j.counts ? j.counts.items : 0 };
  });
  if (!job || job.id !== jobId || !snapshot) return failJob(jobId, 'Nothing to export: the class scan is missing.');
  await ensureOffscreen();
  const res = await sendToOffscreen({ type: P.MSG.OFF_START, jobId, snapshot, options: job.options });
  if (!res || !res.accepted) throw new Error('The archive builder did not start.');
}

export async function onEngineProgress(message) {
  await store.updateJob((job) => {
    if (job.id !== message.jobId) return false;
    if (job.phase !== P.PHASE.DOWNLOADING && job.phase !== P.PHASE.ZIPPING) return false;
    const { heartbeat, ...progress } = message.progress || {};
    if (Object.keys(progress).length) job.progress = { ...job.progress, ...progress };
    job.phase = job.progress && job.progress.phase === 'zipping' ? P.PHASE.ZIPPING : P.PHASE.DOWNLOADING;
    job.lastActivity = Date.now();
  });
}

export async function onEngineDone(message) {
  const job = await store.updateJob((j) => {
    if (j.id !== message.jobId || (j.phase !== P.PHASE.DOWNLOADING && j.phase !== P.PHASE.ZIPPING)) return false;
    const r = message.report;
    j.phase = P.PHASE.SAVING;
    j.lastActivity = Date.now();
    j.result = {
      archiveName: message.archiveName,
      archiveBytes: message.archiveBytes,
      blobUrl: message.blobUrl,
      downloadId: null,
      saveError: null,
      summary: r.summary,
      failures: r.failures,
      links: r.links,
      warnings: r.warnings,
      itemPageStrategy: r.itemPageStrategy,
    };
  });
  if (!job || job.id !== message.jobId || job.phase !== P.PHASE.SAVING) {
    // Cancelled meanwhile: free the archive.
    sendToOffscreen({ type: P.MSG.OFF_RELEASE, jobId: message.jobId }, { attempts: 1 }).catch(() => {});
    return;
  }
  await saveArchive(job.id);
}

async function saveArchive(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || !job.result || !job.result.blobUrl) return;
  const filename = `Classroom Exports/${job.result.archiveName}`;
  let downloadId;
  try {
    downloadId = await chrome.downloads.download({ url: job.result.blobUrl, filename, saveAs: !!job.options.saveAs, conflictAction: 'uniquify' });
  } catch (_) {
    // Some setups reject sub-folders or the name; fall back to a plain name.
    downloadId = await chrome.downloads.download({ url: job.result.blobUrl, filename: 'classroom-export.zip', saveAs: !!job.options.saveAs, conflictAction: 'uniquify' });
  }
  await store.updateJob((j) => {
    if (j.id !== jobId) return false;
    j.phase = P.PHASE.SAVING;
    j.error = null;
    j.result.downloadId = downloadId;
    j.result.saveError = null;
    j.lastActivity = Date.now();
  });
}

export async function onEngineError(message) {
  const error = message.error || {};
  if (error.code === 'cancelled') {
    await store.updateJob((j) => {
      if (j.id !== message.jobId) return false;
      if (store.isActive(j)) j.phase = P.PHASE.CANCELLED;
    });
    return;
  }
  await failJob(message.jobId, error.message || 'Building the archive failed.', error.code);
}

export async function onDownloadChanged(delta) {
  const job = await store.getJob();
  if (!job || !job.result || job.result.downloadId !== delta.id || !delta.state) return;
  if (job.phase === P.PHASE.CANCELLED) return;
  if (delta.state.current === 'complete') {
    await store.updateJob((j) => {
      if (j.id !== job.id) return false;
      j.phase = P.PHASE.COMPLETE;
      j.result.blobUrl = null;
      j.finishedAt = Date.now();
    });
    sendToOffscreen({ type: P.MSG.OFF_RELEASE, jobId: job.id }, { attempts: 1 })
      .catch(() => {})
      .finally(() => closeOffscreen());
  } else if (delta.state.current === 'interrupted') {
    const reason = (delta.error && delta.error.current) || 'unknown error';
    await store.updateJob((j) => {
      if (j.id !== job.id) return false;
      j.phase = P.PHASE.FAILED;
      j.result.saveError = reason;
      j.error = {
        message: reason === 'USER_CANCELED' ? 'Saving the archive was cancelled.' : `Saving the archive failed (${reason}).`,
        code: 'save-failed',
      };
    });
  }
}

// ---------------------------------------------------------------------------

export async function failJob(jobId, message, code = 'error') {
  const job = await store.updateJob((j) => {
    if (j.id !== jobId || !store.isActive(j)) return false;
    j.phase = P.PHASE.FAILED;
    j.error = { message, code };
    j.nav = null;
  });
  if (job && job.id === jobId && job.phase === P.PHASE.FAILED) {
    sendToOffscreen({ type: P.MSG.OFF_CANCEL, jobId }, { attempts: 1 }).catch(() => {});
    if (code !== 'navigated-away' && code !== 'tab-closed') await restoreTab(job);
  }
  return job;
}
