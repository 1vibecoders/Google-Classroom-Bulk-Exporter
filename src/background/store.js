// Persistent state for the background service worker.
//
// The service worker can be suspended at any time, so the export job lives in
// chrome.storage.session (cleared when the browser closes) and every handler
// reads and writes it through a single serialized queue. User preferences
// live in chrome.storage.local.

import '../shared/protocol.js';

const P = globalThis.GCX_PROTOCOL;

export const KEYS = {
  JOB: 'gcx.job',
  STEP_DATA: 'gcx.stepData',
  SNAPSHOT: 'gcx.snapshot',
  OPTIONS: 'gcx.options',
};

let queue = Promise.resolve();

/** Run `fn` with exclusive access to the stored job. */
export function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

export async function getJob() {
  const data = await chrome.storage.session.get(KEYS.JOB);
  return data[KEYS.JOB] || null;
}

export async function setJob(job) {
  if (job) job.updatedAt = Date.now();
  await chrome.storage.session.set({ [KEYS.JOB]: job });
  return job;
}

/** Read-modify-write the job under the lock. `fn` may return false to skip saving. */
export function updateJob(fn) {
  return withLock(async () => {
    const job = await getJob();
    if (!job) return null;
    const result = await fn(job);
    if (result === false) return job;
    await setJob(job);
    return job;
  });
}

export async function getStepData() {
  const data = await chrome.storage.session.get(KEYS.STEP_DATA);
  return data[KEYS.STEP_DATA] || {};
}

export async function setStepData(stepData) {
  await chrome.storage.session.set({ [KEYS.STEP_DATA]: stepData });
}

export async function getSnapshot() {
  const data = await chrome.storage.session.get(KEYS.SNAPSHOT);
  return data[KEYS.SNAPSHOT] || null;
}

export async function setSnapshot(snapshot) {
  await chrome.storage.session.set({ [KEYS.SNAPSHOT]: snapshot });
}

export async function getOptions() {
  const data = await chrome.storage.local.get(KEYS.OPTIONS);
  return { ...P.DEFAULT_OPTIONS, ...(data[KEYS.OPTIONS] || {}) };
}

export async function setOptions(options) {
  const clean = {};
  for (const key of Object.keys(P.DEFAULT_OPTIONS)) {
    if (key in options) clean[key] = options[key];
  }
  const merged = { ...(await getOptions()), ...clean };
  await chrome.storage.local.set({ [KEYS.OPTIONS]: merged });
  return merged;
}

export function isActive(job) {
  return !!job && P.ACTIVE_PHASES.includes(job.phase);
}
