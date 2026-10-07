// Popup UI. Stateless: it renders the job persisted by the background worker
// and re-renders whenever that job changes, so it can be closed and reopened
// at any time during an export.

import '../shared/protocol.js';

const P = globalThis.GCX_PROTOCOL;
const JOB_KEY = 'gcx.job';
const $ = (id) => document.getElementById(id);

const state = { tabId: null, inspect: null, job: null, options: { ...P.DEFAULT_OPTIONS }, detailsOpen: false };

async function call(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ target: P.TARGET.BACKGROUND, type, ...payload });
  if (!res) throw new Error('The extension background did not respond.');
  if (!res.ok) throw new Error(res.error || 'Request failed');
  return res.value;
}

async function resolveTabId() {
  const fromQuery = new URLSearchParams(location.search).get('tabId');
  if (fromQuery) return Number(fromQuery);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ? tab.id : null;
}

function setText(id, text) {
  $(id).textContent = text == null ? '' : String(text);
}

function show(id, visible) {
  $(id).hidden = !visible;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function isActive(job) {
  return !!job && P.ACTIVE_PHASES.includes(job.phase);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderClass() {
  const job = state.job;
  const insp = state.inspect;
  const jobVisible = job && (isActive(job) || job.tabId === state.tabId);
  let name = null;
  let hint = '';
  if (jobVisible && job.className) name = job.className;
  else if (insp && insp.supported) name = [insp.className, insp.section].filter(Boolean).join(' · ') || null;

  if (insp && !insp.supported && !jobVisible) {
    if (insp.reason === 'not-classroom') {
      name = 'No Google Classroom class detected';
      hint = 'Open a class on classroom.google.com, then click the extension again.';
    } else if (insp.reason === 'no-class') {
      name = 'No class open';
      hint = 'Open one of your classes (its Stream or Classwork page) to export it.';
    } else {
      name = 'No Google Classroom tab';
    }
  } else if (!name) {
    name = insp && insp.supported ? 'Class detected' : 'Detecting…';
    if (insp && insp.supported && insp.loading) hint = 'The page is still loading…';
    else if (insp && insp.inspectError) hint = insp.inspectError;
  }
  if (jobVisible && insp && insp.supported && job.courseId !== insp.courseId && isActive(job)) {
    hint = 'An export of another class is in progress.';
  }
  setText('class-name', name);
  setText('class-hint', hint);
}

function renderCounts() {
  const c = state.job && state.job.counts;
  show('counts', !!c);
  if (!c) return;
  if (state.job.phase === P.PHASE.SCANNED) {
    const warnings = (state.job.warnings || []).length;
    setText('class-hint', c.items ? `Scan complete${warnings ? ` (${plural(warnings, 'warning')})` : ''}. Click Export Class to download everything.` : 'Scan complete, but nothing was found to export.');
  }
  setText('c-assignment', c.assignment);
  setText('c-material', c.material);
  setText('c-question', c.question);
  setText('c-announcement', c.announcement);
  setText('c-other', c.other);
  setText('c-files', c.files);
  setText('c-links', c.links);
  show('row-question', c.question > 0);
  show('row-announcement', c.announcement > 0 || (state.job.options && state.job.options.includeAnnouncements));
  show('row-other', c.other > 0);
  show('row-links', c.links > 0);
}

function renderProgress() {
  const job = state.job;
  const active = isActive(job);
  show('progress', active);
  if (!active) return;
  const bar = $('progress-bar');
  if (job.phase === P.PHASE.PREPARING || job.phase === P.PHASE.DISCOVERING) {
    const d = job.discovery || {};
    setText('phase-title', job.mode === 'scan' ? 'Scanning class…' : 'Exporting… (scanning class)');
    setText('progress-item', d.message || 'Scanning…');
    setText('progress-file', d.current || '');
    if (d.itemTotal) {
      bar.max = d.itemTotal;
      bar.value = d.itemIndex || 0;
    } else {
      bar.removeAttribute('value');
    }
    setText('progress-count', d.itemsFound ? `${plural(d.itemsFound, 'item')} found` : '');
    setText('progress-tally', '');
    return;
  }
  const p = job.progress || {};
  if (job.phase === P.PHASE.DOWNLOADING) {
    setText('phase-title', 'Exporting…');
    setText('progress-item', p.itemTotal ? `${p.currentItemType || 'Item'} ${p.itemIndex || 0}/${p.itemTotal}${p.currentItemTitle ? `: ${p.currentItemTitle}` : ''}` : '');
    setText('progress-file', p.currentFile ? `Downloading: ${p.currentFile}` : '');
    bar.max = Math.max(1, p.filesTotal || 0);
    bar.value = p.filesTotal ? p.filesDone || 0 : 0;
    setText('progress-count', `${p.filesDone || 0} / ${p.filesTotal || 0} files${p.bytesDone ? ` · ${formatBytes(p.bytesDone)}` : ''}`);
    setText('progress-tally', `${p.filesDownloaded || 0} downloaded · ${p.filesFailed || 0} failed${p.linksSaved ? ` · ${plural(p.linksSaved, 'link')}` : ''}`);
  } else if (job.phase === P.PHASE.ZIPPING) {
    setText('phase-title', 'Building the ZIP archive…');
    setText('progress-item', '');
    setText('progress-file', '');
    bar.removeAttribute('value');
    setText('progress-count', `${p.filesDownloaded || 0} files downloaded`);
    setText('progress-tally', '');
  } else if (job.phase === P.PHASE.SAVING) {
    setText('phase-title', 'Saving the archive…');
    setText('progress-item', job.result ? job.result.archiveName : '');
    setText('progress-file', job.options && job.options.saveAs ? 'Choose where to save the file.' : '');
    bar.removeAttribute('value');
    setText('progress-count', job.result && job.result.archiveBytes ? formatBytes(job.result.archiveBytes) : '');
    setText('progress-tally', '');
  }
}

function li(text, cls) {
  const el = document.createElement('li');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function renderResult() {
  const job = state.job;
  const finished = job && !isActive(job) && job.phase !== P.PHASE.IDLE && job.phase !== P.PHASE.SCANNED;
  show('result', !!finished);
  show('error', !!(job && job.error && job.phase !== P.PHASE.CANCELLED));
  if (job && job.error) setText('error', job.error.message);
  if (!finished) return;

  const r = job.result;
  const s = r && r.summary;
  const lines = $('result-lines');
  lines.replaceChildren();
  if (job.phase === P.PHASE.COMPLETE) setText('result-title', 'Export complete.');
  else if (job.phase === P.PHASE.CANCELLED) setText('result-title', 'Export cancelled.');
  else setText('result-title', s ? 'Export finished, but the archive was not saved.' : 'Export failed.');

  if (s) {
    if (!s.items) lines.append(li('No coursework or announcements were found in this class.', 'warn'));
    lines.append(li(`${plural(s.items, 'item')} processed`));
    lines.append(li(`${plural(s.filesDownloaded, 'file')} downloaded (${formatBytes(s.bytesDownloaded)})`));
    if (s.filesFailed) lines.append(li(`${plural(s.filesFailed, 'file')} could not be downloaded`, 'bad'));
    if (s.linksSaved) lines.append(li(`${plural(s.linksSaved, 'link')} saved (not downloadable files)`));
    if (s.warnings) lines.append(li(`${plural(s.warnings, 'warning')}`, 'warn'));
    if (job.phase === P.PHASE.COMPLETE && r.archiveName) lines.append(li(`Saved: Downloads/Classroom Exports/${r.archiveName}`));
  }
  show('details-btn', !!(r && (r.failures.length || r.links.length || r.warnings.length)));
  show('show-btn', job.phase === P.PHASE.COMPLETE && r && r.downloadId != null);
  show('retry-save-btn', !!(r && r.saveError && r.blobUrl));
  show('report-btn', !!r);
  setText('details-btn', state.detailsOpen ? 'Hide Details' : 'Show Details');
  renderDetails();
}

function renderDetails() {
  const box = $('details');
  const r = state.job && state.job.result;
  show('details', state.detailsOpen && !!r);
  if (!state.detailsOpen || !r) return;
  box.replaceChildren();
  const group = (title, entries, render) => {
    if (!entries.length) return;
    const h = document.createElement('h3');
    h.textContent = title;
    const ul = document.createElement('ul');
    for (const e of entries) ul.append(render(e));
    box.append(h, ul);
  };
  const entry = (main, reason) => {
    const el = document.createElement('li');
    el.textContent = main;
    if (reason) {
      const span = document.createElement('span');
      span.className = 'reason';
      span.textContent = reason;
      el.append(span);
    }
    return el;
  };
  group(`Not downloaded (${r.failures.length})`, r.failures, (f) => entry(`${f.itemType}: ${f.itemTitle} — ${f.file}`, f.reason));
  group(`Saved as links (${r.links.length})`, r.links, (l) => entry(`${l.itemType}: ${l.itemTitle} — ${l.title}`, l.reason));
  group(`Warnings (${r.warnings.length})`, r.warnings, (w) => entry(w.itemTitle ? `${w.itemType || 'Item'}: ${w.itemTitle}` : 'Class', w.message));
}

function renderActions() {
  const job = state.job;
  const active = isActive(job);
  show('actions', !active);
  show('options', !active);
  const supported = !!(state.inspect && state.inspect.supported);
  $('export-btn').disabled = !supported;
  $('scan-btn').disabled = !supported;
  const scannedThisClass = job && job.phase === P.PHASE.SCANNED && state.inspect && job.courseId === state.inspect.courseId;
  setText('scan-btn', scannedThisClass ? 'Scan again' : 'Scan only');
}

function renderOptions() {
  $('opt-announcements').checked = !!state.options.includeAnnouncements;
  $('opt-details').checked = !!state.options.readDetailPages;
  $('opt-format').value = state.options.googleFormat === 'pdf' ? 'pdf' : 'office';
  $('opt-saveas').checked = !!state.options.saveAs;
}

function render() {
  renderClass();
  renderCounts();
  renderActions();
  renderProgress();
  renderResult();
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function currentOptions() {
  return {
    includeAnnouncements: $('opt-announcements').checked,
    readDetailPages: $('opt-details').checked,
    googleFormat: $('opt-format').value,
    saveAs: $('opt-saveas').checked,
  };
}

function showError(err) {
  show('error', true);
  setText('error', err.message || String(err));
}

async function start(mode) {
  show('error', false);
  state.detailsOpen = false;
  try {
    state.options = currentOptions();
    state.job = await call(P.MSG.POPUP_START, { tabId: state.tabId, mode, options: state.options });
    render();
  } catch (err) {
    showError(err);
  }
}

function reportTextFromJob(job) {
  const r = job.result;
  const s = r.summary;
  const lines = ['Export Report', '', `Class: ${job.className || ''}`, `Items processed: ${s.items}`, '', 'Successful:', `  ${s.filesDownloaded} files`, '', 'Failed:', `  ${s.filesFailed} files`];
  for (const f of r.failures) lines.push('', `  - ${f.itemType}: ${f.itemTitle}`, `    File: ${f.file}`, `    Reason: ${f.reason}`, `    URL: ${f.url}`);
  lines.push('', 'Saved as links:', `  ${s.linksSaved}`);
  for (const l of r.links) lines.push('', `  - ${l.itemType}: ${l.itemTitle}`, `    Link: ${l.title}`, `    URL: ${l.url}`, `    Reason: ${l.reason}`);
  if (r.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of r.warnings) lines.push(`  - ${w.itemTitle ? `${w.itemType || 'Item'} "${w.itemTitle}": ` : ''}${w.message}`);
  }
  return `${lines.join('\n')}\n`;
}

function saveReport() {
  const job = state.job;
  if (!job || !job.result) return;
  const blob = new Blob([reportTextFromJob(job)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'classroom-export-report.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function bind() {
  $('export-btn').addEventListener('click', () => start('export'));
  $('scan-btn').addEventListener('click', () => start('scan'));
  $('cancel-btn').addEventListener('click', () => call(P.MSG.POPUP_CANCEL).catch(showError));
  $('done-btn').addEventListener('click', async () => {
    state.detailsOpen = false;
    try {
      state.job = await call(P.MSG.POPUP_RESET);
      render();
    } catch (err) {
      showError(err);
    }
  });
  $('details-btn').addEventListener('click', () => {
    state.detailsOpen = !state.detailsOpen;
    renderResult();
  });
  $('show-btn').addEventListener('click', () => call(P.MSG.POPUP_SHOW_ARCHIVE).catch(showError));
  $('retry-save-btn').addEventListener('click', () => call(P.MSG.POPUP_RETRY_SAVE).catch(showError));
  $('report-btn').addEventListener('click', saveReport);
  for (const id of ['opt-announcements', 'opt-details', 'opt-format', 'opt-saveas']) {
    $(id).addEventListener('change', () => {
      state.options = currentOptions();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !changes[JOB_KEY]) return;
    state.job = changes[JOB_KEY].newValue || null;
    render();
  });
}

async function init() {
  bind();
  state.tabId = await resolveTabId();
  try {
    const { job, options } = await call(P.MSG.POPUP_GET_STATE);
    state.job = job;
    state.options = options;
  } catch (err) {
    showError(err);
  }
  renderOptions();
  render();
  if (state.tabId != null) {
    try {
      state.inspect = await call(P.MSG.POPUP_INSPECT_TAB, { tabId: state.tabId });
    } catch (err) {
      state.inspect = { supported: false, reason: 'error' };
      showError(err);
    }
  } else {
    state.inspect = { supported: false, reason: 'no-tab' };
  }
  render();
}

init();
