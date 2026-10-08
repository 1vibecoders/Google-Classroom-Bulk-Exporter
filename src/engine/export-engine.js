// Export engine: downloads every attachment of a discovery snapshot and
// writes the organized archive. Runs in the offscreen document so it is not
// subject to the service worker's idle shutdown.
//
// One failed attachment never fails the export: it is recorded with a reason
// in the item's metadata, description and the export report.
//
// runExport builds the archive of one class. AccountExport builds one archive
// of several classes (an account export): each class is downloaded and
// written into its own folder when it is added, so the archive grows class by
// class and only its parts (Blobs) are kept in between.

import '../shared/protocol.js';
import { planDownload } from './download-resolver.js';
import { DownloadError, downloadWithRetry } from './fetcher.js';
import { chooseFileName, NameAllocator, sanitizeComponent, isoDate } from './filenames.js';
import { ZipWriter } from './zip-writer.js';
import {
  planLayout,
  classFolderName,
  itemDescriptionText,
  itemMetadata,
  classInfoJson,
  classDescriptionText,
  buildReport,
  reportText,
  indexHtml,
  internetShortcut,
  TYPE_LABELS,
} from './archive-content.js';
import {
  AccountLayout,
  MANIFEST_FILE,
  accountArchiveName,
  accountIndexHtml,
  accountReport,
  accountReportText,
  accountRootName,
  classCounts,
  classStatus,
  exportManifest,
  manifestClass,
} from './account-content.js';

const P = globalThis.GCX_PROTOCOL;
const CONCURRENCY = 3;
const FILE_MAX = 90;

function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isCancellation(err, signal) {
  return (err && err.code === 'cancelled') || !!(signal && signal.aborted);
}

async function runPool(tasks, concurrency, worker, signal) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (next < tasks.length) {
      if (signal && signal.aborted) return;
      const task = tasks[next++];
      await worker(task);
    }
  });
  await Promise.all(runners);
}

async function downloadResource(entry, { signal, onBytes }) {
  let lastError = null;
  for (const attempt of entry.plan.attempts) {
    try {
      const result = await downloadWithRetry(attempt.url, { signal, onBytes });
      return { ok: true, ...result, ext: attempt.ext, label: attempt.label };
    } catch (err) {
      if (err instanceof DownloadError && err.code === 'cancelled') throw err;
      if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
      lastError = err;
      // Sign-in and quota problems will not be solved by another endpoint.
      if (err.code === 'auth' || err.code === 'quota') break;
    }
  }
  return {
    ok: false,
    error: (lastError && lastError.message) || 'Download failed',
    errorCode: (lastError && lastError.code) || 'error',
  };
}

/**
 * Download the attachments of one class and write its folder (`root`) into `zip`.
 * @returns {Promise<{report:object, progress:object}>} the class report and the last progress
 */
async function writeClass(zip, { snapshot, options, signal, onProgress, version, now, root, archiveName }) {
  const exportedAt = now.toISOString();
  const authuser = (snapshot.classInfo && snapshot.classInfo.authuser) || 0;
  const layout = planLayout(snapshot, { root });

  const entries = layout.items.map((placed, itemIndex) => ({
    ...placed,
    itemIndex,
    attachments: (placed.item.resources || []).map((resource) => ({
      resource,
      plan: planDownload(resource, { authuser, googleFormat: options.googleFormat }),
    })),
  }));

  const tasks = [];
  let linksSaved = 0;
  for (const entry of entries) {
    for (const a of entry.attachments) {
      if (a.plan.downloadable) tasks.push({ entry, attachment: a });
      else linksSaved++;
    }
  }

  const progress = {
    phase: 'downloading',
    itemIndex: 0,
    itemTotal: entries.length,
    currentItemTitle: '',
    currentItemType: '',
    currentFile: '',
    filesTotal: tasks.length,
    filesDone: 0,
    filesDownloaded: 0,
    filesFailed: 0,
    linksSaved,
    bytesDone: 0,
  };
  const inFlight = new Map();
  let completedBytes = 0;
  const emit = () => {
    let partial = 0;
    for (const n of inFlight.values()) partial += n;
    onProgress({ ...progress, bytesDone: completedBytes + partial });
  };
  emit();

  await runPool(
    tasks,
    CONCURRENCY,
    async (task) => {
      const { entry, attachment } = task;
      progress.itemIndex = entry.itemIndex + 1;
      progress.currentItemTitle = entry.item.title;
      progress.currentItemType = TYPE_LABELS[entry.item.type] || 'Item';
      progress.currentFile = attachment.resource.title || attachment.resource.url;
      emit();
      inFlight.set(task, 0);
      const result = await downloadResource(attachment, {
        signal,
        onBytes: (n) => {
          inFlight.set(task, n);
          emit();
        },
      });
      inFlight.delete(task);
      attachment.result = result;
      progress.filesDone++;
      if (result.ok) {
        progress.filesDownloaded++;
        completedBytes += result.size;
      } else {
        progress.filesFailed++;
      }
      emit();
    },
    signal,
  );
  if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });

  // Assemble the archive in snapshot order so names are deterministic.
  const zipping = { ...progress, phase: 'zipping', currentFile: '', bytesDone: completedBytes };
  onProgress(zipping);
  const allocator = new NameAllocator();
  const results = [];
  for (const entry of entries) {
    const attachmentsDir = `${entry.folder}/Attachments`;
    const described = [];
    for (const a of entry.attachments) {
      const r = a.resource;
      if (a.plan.downloadable && a.result && a.result.ok) {
        const fileName = allocator.allocate(
          attachmentsDir,
          chooseFileName({
            headerName: a.result.headerName,
            displayName: r.title,
            fallbackExt: a.result.ext,
            contentType: a.result.contentType,
            fallback: 'attachment',
            maxLength: FILE_MAX,
          }),
        );
        await zip.add(`${attachmentsDir}/${fileName}`, a.result.blob, { crc: a.result.crc });
        described.push({
          resource: r,
          status: 'downloaded',
          savedAs: `Attachments/${fileName}`,
          fileName,
          headerName: a.result.headerName || null,
          size: a.result.size,
          contentType: (a.result.contentType || '').split(';')[0] || null,
          exportLabel: r.kind === 'drive-file' ? null : a.result.label,
        });
      } else if (a.plan.downloadable) {
        described.push({
          resource: r,
          status: 'failed',
          error: (a.result && a.result.error) || 'Not downloaded',
          errorCode: a.result && a.result.errorCode,
        });
      } else {
        const label = r.title || r.host || 'link';
        const fileName = allocator.allocate(attachmentsDir, sanitizeComponent(`${label}`, { maxLength: FILE_MAX - 4, fallback: 'link' }) + '.url');
        await zip.add(`${attachmentsDir}/${fileName}`, internetShortcut(r.url));
        described.push({ resource: r, status: 'link', savedAs: `Attachments/${fileName}`, fileName, note: a.plan.reason });
      }
    }
    await zip.add(`${entry.folder}/description.txt`, itemDescriptionText(entry.item, described), { compress: true });
    await zip.add(`${entry.folder}/metadata.json`, toJson(itemMetadata(entry.item, described, entry.relFolder)), { compress: true });
    results.push({ item: entry.item, relFolder: entry.relFolder, attachments: described });
    if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
  }

  const report = buildReport(snapshot, layout, results, { exportedAt, version, options, archiveName });
  await zip.add(`${root}/class-info.json`, toJson(classInfoJson(snapshot, layout, report.summary, { exportedAt, version, options })), { compress: true });
  await zip.add(`${root}/class-description.txt`, classDescriptionText(snapshot), { compress: true });
  await zip.add(`${root}/export-report.txt`, reportText(report), { compress: true });
  await zip.add(`${root}/export-report.json`, toJson(report), { compress: true });
  await zip.add(`${root}/index.html`, indexHtml(snapshot, results, report), { compress: true });
  return { report, progress: zipping };
}

/**
 * Export one class into its own archive.
 * @param {{snapshot:object, options:object, signal?:AbortSignal,
 *          onProgress?:(p:object)=>void, version?:string, now?:Date}} args
 * @returns {Promise<{blob:Blob, archiveName:string, report:object}>}
 */
export async function runExport({ snapshot, options, signal, onProgress = () => {}, version = '0.0.0', now = new Date() }) {
  const root = classFolderName(snapshot.classInfo);
  const archiveName = `${sanitizeComponent(`${root} - ${isoDate(now)}`, { maxLength: 100 })}.zip`;
  const zip = new ZipWriter({ date: now });
  const { report, progress } = await writeClass(zip, { snapshot, options, signal, onProgress, version, now, root, archiveName });
  const manifest = exportManifest({
    kind: P.JOB_KIND.CLASS,
    exportedAt: report.exportedAt,
    accountIndex: (snapshot.classInfo && snapshot.classInfo.authuser) || 0,
    options,
    version,
    classes: [manifestClass({ classInfo: snapshot.classInfo, folder: '.', status: classStatus({ wrote: true, report }), report })],
  });
  await zip.add(`${root}/${MANIFEST_FILE}`, toJson(manifest), { compress: true });
  const blob = zip.finish();
  report.archiveBytes = blob.size;
  onProgress({ ...progress, archiveBytes: blob.size });
  return { blob, archiveName, report };
}

/**
 * One archive with every class of an account export. Classes are added one
 * at a time, in the order of the home page; a class that cannot be written
 * is recorded instead of failing the archive.
 */
export class AccountExport {
  constructor({ accountIndex, options, version = '0.0.0', now = new Date() }) {
    this.accountIndex = accountIndex;
    this.options = options;
    this.version = version;
    this.now = now;
    this.archiveName = accountArchiveName(now);
    this.layout = new AccountLayout(accountRootName(now));
    this.zip = new ZipWriter({ date: now });
    this.added = new Map(); // class index -> { classInfo, folder, status, report, error }
  }

  /**
   * Download one class and write its folder. Only cancellation is thrown;
   * any other error is recorded for this class.
   * @param {number} index  the class's position in the class list
   * @param {{snapshot:object, ref?:object}} cls  discovery snapshot and the class as listed on the home page
   * @returns {Promise<{status:string, folder:(string|null), counts:(object|null), error:(string|null)}>}
   */
  async addClass(index, { snapshot, ref = {} }, { signal, onProgress = () => {} } = {}) {
    const classInfo = { ...snapshot.classInfo };
    // Use the home page's name when the class's own pages did not show one.
    if (!classInfo.nameSource && ref.name) {
      classInfo.name = ref.name;
      classInfo.section = classInfo.section || ref.section || null;
    }
    const folder = this.layout.allocate(classInfo);
    const sizeBefore = this.zip.size;
    let report = null;
    let error = null;
    try {
      ({ report } = await writeClass(this.zip, {
        snapshot: { ...snapshot, classInfo },
        options: this.options,
        signal,
        onProgress,
        version: this.version,
        now: this.now,
        root: folder.path,
        archiveName: this.archiveName,
      }));
    } catch (err) {
      if (isCancellation(err, signal)) throw err;
      error = (err && err.message) || String(err);
    }
    const wrote = this.zip.size > sizeBefore;
    this.added.set(index, { classInfo, folder: wrote ? folder.name : null, status: classStatus({ wrote, report, error }), report, error });
    return this.outcome(index);
  }

  /**
   * The outcome of a class that has been added (what the background records in its class list).
   * @returns {{status:string, folder:(string|null), counts:(object|null), error:(string|null)}}
   */
  outcome(index) {
    const { status, folder, report, error } = this.added.get(index);
    return { status, folder, counts: report ? classCounts(report.summary) : null, error };
  }

  /**
   * Write export-manifest.json, index.html and export-report.txt and finish the archive.
   * @param {object[]} classes  the class list in home-page order ({courseId, name, section,
   *   teacher, url}); `error` says why a class that was never added could not be scanned
   * @param {{warnings?:string[]}} [extra]  account-level warnings (e.g. from the class list)
   * @returns {Promise<{blob:Blob, archiveName:string, report:object}>}
   */
  async finish(classes, { warnings = [] } = {}) {
    const reports = [];
    const entries = classes.map((ref, i) => {
      const added = this.added.get(i);
      if (!added) return manifestClass({ ref, status: P.CLASS_STATUS.FAILED, error: ref.error || 'Not exported.' });
      reports[i] = added.report;
      return manifestClass({ ref, classInfo: added.classInfo, folder: added.folder, status: added.status, report: added.report, error: added.error });
    });
    const manifest = exportManifest({
      kind: P.JOB_KIND.ACCOUNT,
      exportedAt: this.now.toISOString(),
      accountIndex: this.accountIndex,
      options: this.options,
      version: this.version,
      classes: entries,
    });
    const report = accountReport(manifest, reports, { archiveName: this.archiveName, warnings });
    const root = this.layout.rootName;
    await this.zip.add(`${root}/${MANIFEST_FILE}`, toJson(manifest), { compress: true });
    await this.zip.add(`${root}/index.html`, accountIndexHtml(manifest), { compress: true });
    await this.zip.add(`${root}/export-report.txt`, accountReportText(report, reports), { compress: true });
    const blob = this.zip.finish();
    report.archiveBytes = blob.size;
    return { blob, archiveName: this.archiveName, report };
  }
}
