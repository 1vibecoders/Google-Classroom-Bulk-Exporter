// Export job state machine.
//
// Class export (the class open in the tab):
//   preparing -> discovering (classwork -> stream -> details) -> scanned
//                                                           \-> downloading -> zipping -> saving -> complete
//
// Account export (every active class of the tab's Google account):
//   preparing -> discovering (classes: the class list of the home page) -> scanned (the popup asks to confirm)
//   then, for each class in turn, in the same tab:
//     discovering (classwork -> stream -> details) -> downloading (the class is added to the archive)
//   and finally zipping (archive-level files) -> saving -> complete.
//   The class list and the current class index are kept in job.account. A
//   class whose scan fails is recorded as failed and the next class starts.
//   A class's outcome and the move to the next class are saved together, and
//   a job that goes silent (the worker was suspended between two saves) is
//   resumed where the tab or the archive builder is (checkStale).
//
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

let staleCheck = null; // the check of a silent job in progress (one at a time)

function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAccountJob(job) {
  return !!job && job.kind === P.JOB_KIND.ACCOUNT;
}

/**
 * The id the content script reports back with. An account export uses one
 * per class, so late messages about a class it has given up on are ignored.
 */
function discoveryId(job) {
  return isAccountJob(job) ? `${job.id}/${job.account.classIndex}` : job.id;
}

function classSteps(options) {
  const steps = [P.STEP.CLASSWORK];
  if (options.includeAnnouncements) steps.push(P.STEP.STREAM);
  steps.push(P.STEP.DETAILS);
  return steps;
}

/** Whether the job still uses the Classroom tab (an account export: until its last class is scanned). */
function drivesTab(job) {
  if (!store.isActive(job)) return false;
  if (job.phase === P.PHASE.PREPARING || job.phase === P.PHASE.DISCOVERING) return true;
  return isAccountJob(job) && job.account.classIndex < job.account.classes.length - 1;
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
  // Any Classroom page can start an export of all the account's classes.
  const account = { authuser: parsed.authuser };
  if (!parsed.courseId) return { supported: false, reason: 'no-class', page: parsed.page, account };
  const base = { supported: true, tabId, courseId: parsed.courseId, page: parsed.page, className: null, section: null, account };
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

export async function startJob({ tabId, mode, kind, options: requested }) {
  const options = await store.setOptions(requested || {});
  const forAccount = kind === P.JOB_KIND.ACCOUNT;
  return store.withLock(async () => {
    const existing = await store.getJob();
    if (store.isActive(existing)) throw new Error('An export is already running.');
    const tab = await getTab(tabId);
    const parsed = urls.parse((tab && tab.url) || '');
    if (forAccount && (!tab || !parsed.isClassroom)) {
      throw new Error('Open Google Classroom (classroom.google.com) first.');
    }
    if (!forAccount && (!tab || !parsed.isClassroom || !parsed.courseId)) {
      throw new Error('Open a class in Google Classroom (classroom.google.com) first.');
    }
    if (existing && existing.result && existing.result.blobUrl) {
      sendToOffscreen({ type: P.MSG.OFF_RELEASE, jobId: existing.id }, { attempts: 1 }).catch(() => {});
    }
    const job = {
      id: newId(),
      kind: forAccount ? P.JOB_KIND.ACCOUNT : P.JOB_KIND.CLASS,
      mode: mode === 'scan' ? 'scan' : 'export',
      tabId,
      courseId: forAccount ? null : parsed.courseId,
      classContext: forAccount ? null : { courseId: parsed.courseId, authuser: parsed.authuser, prefix: parsed.prefix },
      account: forAccount ? { authuser: parsed.authuser, classes: [], classIndex: 0, listedAt: null, warnings: [], restarted: null } : null,
      className: null,
      originalUrl: tab.url,
      options,
      phase: P.PHASE.PREPARING,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      steps: forAccount ? [P.STEP.CLASSES] : classSteps(options),
      stepIndex: 0,
      nav: null,
      discovery: { message: 'Preparing…', itemsFound: 0 },
      counts: null,
      progress: null,
      result: null,
      error: null,
      warnings: [],
    };
    if (forAccount) return startAccountJob(job, existing);

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

/**
 * Account export: export the class list the user has just confirmed, else
 * list the classes for confirmation. A confirmation of a list that is out of
 * date, or of another account than the tab's (the tab has moved since), lists
 * the classes again instead of exporting a list the user has not seen.
 */
async function startAccountJob(job, existing) {
  if (
    job.mode === 'export' &&
    isAccountJob(existing) &&
    existing.phase === P.PHASE.SCANNED &&
    existing.account.authuser === job.account.authuser &&
    Date.now() - existing.account.listedAt < SNAPSHOT_REUSE_MS
  ) {
    job.account = { ...existing.account, classIndex: 0 };
    job.reusedScan = true;
    await store.setJob(job);
    queueMicrotask(() => beginAccountExport(job.id).catch((err) => failJob(job.id, err.message)));
    return job;
  }
  job.mode = 'scan';
  job.phase = P.PHASE.DISCOVERING;
  await store.setJob(job);
  queueMicrotask(() => beginStep(job.id).catch((err) => failJob(job.id, err.message)));
  return job;
}

export async function cancelJob() {
  let restore = false;
  const job = await store.updateJob((j) => {
    if (!store.isActive(j)) return false;
    // An account export only takes the tab back while it is still using it.
    restore = !isAccountJob(j) || drivesTab(j);
    j.phase = P.PHASE.CANCELLED;
    j.error = { message: 'Export cancelled.', code: 'cancelled' };
  });
  if (!job || job.phase !== P.PHASE.CANCELLED) return job;
  sendToTab(job.tabId, { type: P.MSG.CS_CANCEL, jobId: discoveryId(job) }).catch(() => {});
  sendToOffscreen({ type: P.MSG.OFF_CANCEL, jobId: job.id }, { attempts: 1 }).catch(() => {});
  if (job.result && job.result.downloadId != null) chrome.downloads.cancel(job.result.downloadId).catch(() => {});
  if (restore) await restoreTab(job);
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
  return { job: await checkActivity(), options: await store.getOptions() };
}

/**
 * Detect a job that has gone silent (and resume an account export where
 * possible). Run for the popup and, during an account export, periodically
 * on the archive builder's watchdog message.
 * @returns the current job
 */
export async function checkActivity() {
  const job = await store.getJob();
  if (!store.isActive(job) || Date.now() - (job.lastActivity || 0) <= STALE_MS) return job;
  if (!staleCheck) {
    staleCheck = checkStale(job).finally(() => {
      staleCheck = null;
    });
  }
  await staleCheck;
  return store.getJob();
}

async function checkStale(job) {
  if (job.phase === P.PHASE.DISCOVERING || job.phase === P.PHASE.PREPARING) {
    if (job.nav) {
      const tab = await getTab(job.tabId);
      if (tab && tab.status !== 'complete') return;
    }
    const ping = await pingTab(job.tabId);
    if (ping && ping.jobId === discoveryId(job)) return;
    if (!(await restartClass(job))) await discoveryFailed(job, 'Lost contact with the Classroom tab (was it reloaded, closed or navigated away?).');
  } else if (job.phase === P.PHASE.DOWNLOADING || job.phase === P.PHASE.ZIPPING) {
    const ping = await pingOffscreen();
    // An account export also needs its archive, which the builder drops when it finishes or stops.
    if (!ping || ping.jobId !== job.id || (isAccountJob(job) && !ping.account)) await failJob(job.id, 'The export stopped unexpectedly. Please try again.');
    else if (isAccountJob(job)) await resumeAccount(job, ping.account);
  } else if (job.phase === P.PHASE.SAVING && job.result && job.result.downloadId != null) {
    const [item] = await chrome.downloads.search({ id: job.result.downloadId });
    if (item) await onDownloadChanged({ id: item.id, state: { current: item.state }, error: item.error ? { current: item.error } : undefined });
  }
}

// ---------------------------------------------------------------------------
// Discovery steps
// ---------------------------------------------------------------------------

function stepTarget(job, step) {
  if (step === P.STEP.CLASSES) return { page: 'home', url: urls.homeUrl(job.account), message: 'Opening the Classroom home page…' };
  if (step === P.STEP.CLASSWORK) return { page: 'classwork', url: urls.classworkUrl(job.classContext), message: 'Opening the Classwork page…' };
  if (step === P.STEP.STREAM) return { page: 'stream', url: urls.streamUrl(job.classContext), message: 'Opening the Stream…' };
  return null;
}

/**
 * True while a tab URL is where the current step needs the tab: the class
 * being scanned, or the account's home page while its classes are listed.
 */
function inScope(job, parsed) {
  if (!parsed.isClassroom) return false;
  if (job.steps[job.stepIndex] === P.STEP.CLASSES) return parsed.page === 'home' && parsed.authuser === job.account.authuser;
  return urls.sameId(parsed.courseId, job.courseId);
}

/** True while a tab URL is a Classroom page of the account an account export exports. */
function onAccount(job, parsed) {
  return parsed.isClassroom && parsed.authuser === job.account.authuser;
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
    // An account export opens the next class only from a page of the account's Classroom.
    if (isAccountJob(job) && !onAccount(job, current)) return leftClassroom(job);
    const onPage = current.page === target.page && inScope(job, current) && tab.status === 'complete';
    if (!onPage) {
      await store.updateJob((j) => {
        if (j.id !== jobId) return false;
        j.nav = { url: target.url, page: target.page, step };
        j.discovery = { ...j.discovery, message: target.message };
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
  if (step === P.STEP.CLASSES) payload = { options: job.options, account: { authuser: job.account.authuser } };
  if (step === P.STEP.DETAILS) {
    const stepData = await store.getStepData();
    payload = { options: job.options, classwork: stepData.classwork || null, stream: stepData.stream || null, classContext: job.classContext };
  }
  const res = await sendToTab(job.tabId, { type: P.MSG.CS_RUN_STEP, jobId: discoveryId(job), step, payload });
  if (!res || !res.accepted) throw new Error('The Classroom tab did not accept the request.');
  await store.updateJob((j) => {
    if (j.id !== jobId) return false;
    j.lastActivity = Date.now();
  });
}

export async function onContentProgress(message) {
  await store.updateJob((job) => {
    if (discoveryId(job) !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return false;
    // Progress flushed after its step's result belongs to a finished step.
    if (job.steps[job.stepIndex] !== message.step) return false;
    const { heartbeat, ...progress } = message.progress || {};
    job.discovery = { ...job.discovery, ...progress, step: message.step };
    job.lastActivity = Date.now();
  });
}

export async function onStepResult(message) {
  const job = await store.getJob();
  if (!job || discoveryId(job) !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return;
  const step = job.steps[job.stepIndex];
  if (step !== message.step) return;
  try {
    if (step === P.STEP.CLASSES) await onClassList(job, message.result);
    else if (step === P.STEP.DETAILS) await onSnapshot(job, message.result.snapshot);
    else await nextStep(job, step, message.result);
  } catch (err) {
    await discoveryFailed(job, err.message);
  }
}

async function nextStep(job, step, result) {
  const stepData = await store.getStepData();
  stepData[step] = result;
  await store.setStepData(stepData);
  await store.updateJob((j) => {
    if (j.id !== job.id) return false;
    j.stepIndex++;
    j.lastActivity = Date.now();
    const info = result.classInfo;
    if (info && info.name && (!j.className || step === P.STEP.STREAM)) j.className = info.name;
    if (step === P.STEP.CLASSWORK) j.discovery = { ...j.discovery, itemsFound: (result.items || []).length };
  });
  await beginStep(job.id);
}

async function onSnapshot(job, snapshot) {
  snapshot.optionsKey = optionsKey(job.options);
  await store.setSnapshot(snapshot);
  await store.setStepData({});
  const updated = await store.updateJob((j) => {
    if (j.id !== job.id || j.phase !== P.PHASE.DISCOVERING) return false;
    j.className = snapshot.classInfo.name;
    j.counts = countSnapshot(snapshot, j.options);
    j.warnings = snapshot.warnings || [];
    j.discovery = { ...j.discovery, message: 'Class scanned.', current: '' };
    j.lastActivity = Date.now();
    // Leave the discovering phase before the tab is navigated back, so the
    // navigation is not mistaken for the user leaving mid-scan.
    j.phase = j.mode === 'scan' ? P.PHASE.SCANNED : P.PHASE.DOWNLOADING;
  });
  if (!updated || (updated.phase !== P.PHASE.SCANNED && updated.phase !== P.PHASE.DOWNLOADING)) return;
  // An account export keeps the tab until its last class has been scanned.
  if (!drivesTab(updated)) await restoreTab(updated);
  if (updated.mode === 'export') await startEngine(updated.id);
}

export async function onStepError(message) {
  const job = await store.getJob();
  if (!job || discoveryId(job) !== message.jobId || job.phase !== P.PHASE.DISCOVERING) return;
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
    try {
      await beginStep(job.id);
    } catch (err) {
      await discoveryFailed(job, err.message);
    }
    return;
  }
  await discoveryFailed(job, error.message || 'Scanning the class failed.', error.code);
}

/**
 * A discovery step could not finish. Fatal for a class export; an account
 * export records the class as failed and goes on with the next one (a
 * failure to list the classes is fatal there too).
 * `seen` is the job as it was when the problem was noticed.
 */
async function discoveryFailed(seen, message, code = 'error') {
  if (!isAccountJob(seen) || seen.steps[seen.stepIndex] === P.STEP.CLASSES) return failJob(seen.id, message, code);
  let outcome = null;
  const job = await store.updateJob((j) => {
    // Already moved on (e.g. the same problem was reported twice), or stopped.
    if (j.id !== seen.id || !store.isActive(j) || j.account.classIndex !== seen.account.classIndex) return false;
    if (j.phase !== P.PHASE.DISCOVERING) {
      outcome = 'fatal'; // the class was already scanned: the archive itself is in trouble
      return false;
    }
    Object.assign(j.account.classes[j.account.classIndex], { status: P.CLASS_STATUS.FAILED, error: message });
    enterClass(j, j.account.classIndex + 1);
    outcome = 'skipped';
  });
  if (outcome === 'fatal') return failJob(seen.id, message, code);
  if (outcome !== 'skipped') return;
  // Stop whatever the content script may still be doing for that class.
  sendToTab(job.tabId, { type: P.MSG.CS_CANCEL, jobId: discoveryId(seen) }).catch(() => {});
  if (!drivesTab(job)) await restoreTab(job);
  await continueAccount(job.id);
}

// ---------------------------------------------------------------------------
// Account export: one class after the other
// ---------------------------------------------------------------------------

/** The class list is shown in the popup; "Export N classes" starts the export (startAccountJob). */
async function onClassList(job, result) {
  const classes = result.classes.map((c) => ({ ...c, status: P.CLASS_STATUS.PENDING, error: null, folder: null, counts: null }));
  const updated = await store.updateJob((j) => {
    if (j.id !== job.id || j.phase !== P.PHASE.DISCOVERING) return false;
    j.account = { ...j.account, classes, listedAt: Date.now(), warnings: result.warnings || [] };
    j.discovery = { ...j.discovery, message: `${classes.length === 1 ? '1 class' : `${classes.length} classes`} found.`, current: '', itemsFound: classes.length };
    j.lastActivity = Date.now();
    j.phase = P.PHASE.SCANNED;
  });
  if (updated && updated.id === job.id && updated.phase === P.PHASE.SCANNED) await restoreTab(updated);
}

/**
 * Point the job at class `index` of the list, to be scanned from its first
 * step, or, after the last class, at writing the archive's own files. Called
 * in the same update that records the previous class's outcome, so the saved
 * job always says what comes next.
 */
function enterClass(j, index) {
  j.account.classIndex = index;
  j.nav = null;
  j.lastActivity = Date.now();
  if (index >= j.account.classes.length) {
    j.phase = P.PHASE.ZIPPING;
    return;
  }
  const c = j.account.classes[index];
  j.phase = P.PHASE.DISCOVERING;
  j.courseId = c.courseId;
  j.classContext = { courseId: c.courseId, authuser: j.account.authuser, prefix: c.prefix };
  j.className = c.name;
  j.steps = classSteps(j.options);
  j.stepIndex = 0;
  j.counts = null;
  j.progress = null;
  j.warnings = [];
  j.discovery = { message: 'Preparing…', itemsFound: 0 };
}

/** Open the account's archive in the offscreen document, then scan the first class. */
async function beginAccountExport(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || !store.isActive(job)) return;
  await ensureOffscreen();
  const res = await sendToOffscreen({ type: P.MSG.OFF_ACCOUNT_START, jobId, accountIndex: job.account.authuser, options: job.options });
  if (!res || !res.accepted) throw new Error('The archive builder did not start.');
  await store.updateJob((j) => {
    if (j.id !== jobId || !store.isActive(j)) return false;
    enterClass(j, 0);
  });
  await continueAccount(jobId);
}

/** Go on with what the job points at: scan its class with the steps of a class export, or finish the archive. */
async function continueAccount(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || !store.isActive(job)) return;
  if (job.account.classIndex >= job.account.classes.length) {
    await finishAccount(jobId);
    return;
  }
  if (job.phase !== P.PHASE.DISCOVERING) return;
  await store.setStepData({});
  await store.setSnapshot(null);
  try {
    await beginStep(jobId);
  } catch (err) {
    await discoveryFailed(job, err.message);
  }
}

/**
 * The scan of an account export's class went silent with no step running in
 * the tab (the worker was suspended before the step reached it, or the tab
 * lost it): scan the class again from its first step, once per class.
 * @returns {Promise<boolean>} false when this does not apply (the caller gives up on the scan)
 */
async function restartClass(seen) {
  if (!isAccountJob(seen) || seen.phase !== P.PHASE.DISCOVERING || seen.steps[seen.stepIndex] === P.STEP.CLASSES) return false;
  if (seen.account.restarted === seen.account.classIndex) return false;
  let restarted = false;
  await store.updateJob((j) => {
    // Anything saved meanwhile means the job is not silent any more.
    if (j.id !== seen.id || j.updatedAt !== seen.updatedAt) return false;
    j.account.restarted = j.account.classIndex;
    enterClass(j, j.account.classIndex);
    restarted = true;
  });
  if (restarted) await continueAccount(seen.id);
  return true;
}

/**
 * An account export went silent while the archive builder had (or should
 * have had) a class or the archive's own files: a message between the two
 * was lost while the worker was suspended. `engine` is the builder's state
 * ({adding, finishing, outcomes}); go on from there.
 */
async function resumeAccount(job, engine) {
  const index = job.account.classIndex;
  if (engine.adding != null || engine.finishing) return; // still at work
  if (engine.outcomes[index]) {
    await onEngineClassDone({ jobId: job.id, classIndex: index, outcome: engine.outcomes[index] });
    return;
  }
  if (index >= job.account.classes.length) {
    await finishAccount(job.id);
    return;
  }
  // Scanned, but never handed to the builder.
  const snapshot = await store.getSnapshot();
  if (!snapshot || !urls.sameId(snapshot.classInfo && snapshot.classInfo.courseId, job.courseId)) {
    await failJob(job.id, 'The export stopped unexpectedly. Please try again.');
    return;
  }
  await startEngine(job.id).catch((err) => failJob(job.id, err.message));
}

export async function onEngineClassDone(message) {
  let done = false;
  const job = await store.updateJob((j) => {
    if (j.id !== message.jobId || !isAccountJob(j) || j.account.classIndex !== message.classIndex) return false;
    if (j.phase !== P.PHASE.DOWNLOADING && j.phase !== P.PHASE.ZIPPING) return false;
    Object.assign(j.account.classes[message.classIndex], message.outcome);
    enterClass(j, message.classIndex + 1);
    done = true;
  });
  if (done) await continueAccount(job.id);
}

/** Every class is done: write the archive-level files, then save the archive. */
async function finishAccount(jobId) {
  const job = await store.getJob();
  if (!job || job.id !== jobId || job.phase !== P.PHASE.ZIPPING) return;
  const { classes, warnings } = job.account;
  if (classes.every((c) => c.status === P.CLASS_STATUS.FAILED)) {
    const first = classes[0];
    const message = classes.length === 1 ? `The class could not be exported: ${first.error}` : `None of the ${classes.length} classes could be exported. ${first.name}: ${first.error}`;
    await failJob(jobId, message);
    return;
  }
  await ensureOffscreen();
  const res = await sendToOffscreen({ type: P.MSG.OFF_ACCOUNT_FINISH, jobId, classes, warnings });
  if (!res || !res.accepted) await failJob(jobId, (res && res.error) || 'The archive builder did not respond.');
}

// ---------------------------------------------------------------------------
// Tab events
// ---------------------------------------------------------------------------

export async function onTabUpdated(tabId, changeInfo, tab) {
  const job = await store.getJob();
  if (!job || job.tabId !== tabId || !store.isActive(job)) return;
  if (job.phase !== P.PHASE.DISCOVERING) {
    // While an earlier class downloads, an account export still needs the tab
    // for the next class: leaving the account's Classroom stops the export
    // (the tab is not taken back from wherever the user went). The URL of a
    // page outside the extension's hosts is not visible at all.
    if (isAccountJob(job) && drivesTab(job) && !onAccount(job, urls.parse(changeInfo.url || tab.url || ''))) await leftClassroom(job);
    return;
  }
  const url = changeInfo.url || tab.url || '';
  const parsed = urls.parse(url);

  const listing = job.steps[job.stepIndex] === P.STEP.CLASSES;
  const scanning = listing ? 'your classes were being listed' : 'the class was being scanned';
  // In an account export, losing one class's page within Classroom fails that
  // class only; leaving Classroom (or a sign-in page) stops the whole export.
  const classOnly = isAccountJob(job) && !listing && parsed.isClassroom;
  if (job.nav) {
    if (changeInfo.url && !inScope(job, parsed)) {
      if (/accounts\.google\.com/.test(changeInfo.url)) return failJob(job.id, 'Google asked you to sign in. Sign in to Classroom and try again.');
      if (classOnly) return discoveryFailed(job, `Classroom did not open this class (the tab went to ${urls.canonical(url)}).`, 'navigated-away');
      return failJob(job.id, `The tab left ${listing ? 'the home page' : 'the class'} while the exporter was opening a Classroom page.`, 'navigated-away');
    }
    if (changeInfo.status === 'complete' && parsed.page === job.nav.page && inScope(job, parsed)) {
      await store.updateJob((j) => {
        if (j.id !== job.id) return false;
        j.nav = null;
        j.lastActivity = Date.now();
      });
      try {
        await sendStep(job.id);
      } catch (err) {
        await discoveryFailed(job, err.message);
      }
    }
    return;
  }

  // Leaving the class is fatal right away. Moves within the class are judged
  // by the content script at its checkpoints (it may briefly open an item page
  // itself), and full reloads are caught by the ping below.
  if (changeInfo.url && !inScope(job, parsed)) {
    sendToTab(tabId, { type: P.MSG.CS_CANCEL, jobId: discoveryId(job) }).catch(() => {});
    if (classOnly) return discoveryFailed(job, 'The Classroom tab left the class while it was being scanned.', 'navigated-away');
    return failJob(job.id, `Export stopped because the Classroom tab navigated away while ${scanning}. Stay on the page until scanning finishes.`, 'navigated-away');
  }
  if (changeInfo.status === 'complete') {
    // A full page load replaces the content script; make sure ours survived.
    const ping = await pingTab(tabId);
    if (!ping || ping.jobId !== discoveryId(job)) {
      const message = `${isAccountJob(job) && !listing ? 'The' : 'Export stopped because the'} Classroom tab was reloaded while ${scanning}.`;
      await discoveryFailed(job, message, 'navigated-away');
    }
  }
}

/** The user took the tab out of the account's Classroom while an account export still needed it. */
function leftClassroom(job) {
  return failJob(job.id, 'Export stopped because the Classroom tab left Classroom while your classes were being exported. Leave it on Classroom until the last class has been scanned.', 'navigated-away');
}

export async function onTabRemoved(tabId) {
  const job = await store.getJob();
  if (!job || job.tabId !== tabId || !drivesTab(job)) return;
  const what = isAccountJob(job) ? 'the classes were' : 'the class was';
  await failJob(job.id, `The Classroom tab was closed while ${what} being scanned.`, 'tab-closed');
}

async function restoreTab(job) {
  if (!job || !job.originalUrl) return;
  const tab = await getTab(job.tabId);
  if (!tab || tab.url === job.originalUrl) return;
  const parsed = urls.parse(tab.url || '');
  // Only take the user back if we moved them within the class (within the
  // account's Classroom for an account export).
  const ours = isAccountJob(job) ? parsed.authuser === job.account.authuser : urls.sameId(parsed.courseId, job.courseId);
  if (parsed.isClassroom && ours) {
    chrome.tabs.update(job.tabId, { url: job.originalUrl }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Export engine (offscreen document)
// ---------------------------------------------------------------------------

async function startEngine(jobId) {
  const snapshot = await store.getSnapshot();
  const job = await store.updateJob((j) => {
    if (j.id !== jobId || !store.isActive(j)) return false;
    j.phase = P.PHASE.DOWNLOADING;
    j.lastActivity = Date.now();
    j.progress = { phase: 'downloading', filesDone: 0, filesTotal: j.counts ? j.counts.files : 0, itemIndex: 0, itemTotal: j.counts ? j.counts.items : 0 };
  });
  if (!job || job.id !== jobId || job.phase !== P.PHASE.DOWNLOADING) return;
  if (!snapshot) return failJob(jobId, 'Nothing to export: the class scan is missing.');
  await ensureOffscreen();
  const message = isAccountJob(job)
    ? { type: P.MSG.OFF_ACCOUNT_CLASS, jobId, classIndex: job.account.classIndex, snapshot, ref: job.account.classes[job.account.classIndex] }
    : { type: P.MSG.OFF_START, jobId, snapshot, options: job.options };
  const res = await sendToOffscreen(message);
  if (!res || !res.accepted) throw new Error((res && res.error) || 'The archive builder did not start.');
}

export async function onEngineProgress(message) {
  await store.updateJob((job) => {
    if (job.id !== message.jobId) return false;
    if (job.phase !== P.PHASE.DOWNLOADING && job.phase !== P.PHASE.ZIPPING) return false;
    // Late progress about a class an account export has already finished.
    if (message.classIndex != null && (!isAccountJob(job) || job.account.classIndex !== message.classIndex)) return false;
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
  let restore = false;
  const job = await store.updateJob((j) => {
    if (j.id !== jobId || !store.isActive(j)) return false;
    // An account export only takes the tab back while it is still using it.
    restore = !isAccountJob(j) || drivesTab(j);
    j.phase = P.PHASE.FAILED;
    j.error = { message, code };
    j.nav = null;
  });
  if (job && job.id === jobId && job.phase === P.PHASE.FAILED) {
    sendToOffscreen({ type: P.MSG.OFF_CANCEL, jobId }, { attempts: 1 }).catch(() => {});
    if (restore && code !== 'navigated-away' && code !== 'tab-closed') await restoreTab(job);
  }
  return job;
}
