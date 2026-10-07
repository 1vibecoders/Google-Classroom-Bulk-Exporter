// Export engine: downloads every attachment of a discovery snapshot and
// writes the organized archive. Runs in the offscreen document so it is not
// subject to the service worker's idle shutdown.
//
// One failed attachment never fails the export: it is recorded with a reason
// in the item's metadata, description and the export report.

import { planDownload } from './download-resolver.js';
import { DownloadError, downloadWithRetry } from './fetcher.js';
import { chooseFileName, NameAllocator, sanitizeComponent, isoDate } from './filenames.js';
import { ZipWriter } from './zip-writer.js';
import {
  planLayout,
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

const CONCURRENCY = 3;
const FILE_MAX = 90;

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
 * @param {{snapshot:object, options:object, signal?:AbortSignal,
 *          onProgress?:(p:object)=>void, version?:string, now?:Date}} args
 * @returns {Promise<{blob:Blob, archiveName:string, report:object}>}
 */
export async function runExport({ snapshot, options, signal, onProgress = () => {}, version = '0.0.0', now = new Date() }) {
  const exportedAt = now.toISOString();
  const authuser = (snapshot.classInfo && snapshot.classInfo.authuser) || 0;
  const layout = planLayout(snapshot);

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
  onProgress({ ...progress, phase: 'zipping', currentFile: '', bytesDone: completedBytes });
  const zip = new ZipWriter({ date: now });
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
    await zip.add(`${entry.folder}/metadata.json`, `${JSON.stringify(itemMetadata(entry.item, described, entry.relFolder), null, 2)}\n`, { compress: true });
    results.push({ item: entry.item, relFolder: entry.relFolder, attachments: described });
    if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
  }

  const archiveBase = sanitizeComponent(`${layout.rootName} - ${isoDate(now)}`, { maxLength: 100 });
  const archiveName = `${archiveBase}.zip`;
  const report = buildReport(snapshot, layout, results, { exportedAt, version, options, archiveName });
  const root = layout.rootName;
  await zip.add(`${root}/class-info.json`, `${JSON.stringify(classInfoJson(snapshot, layout, report.summary, { exportedAt, version, options }), null, 2)}\n`, { compress: true });
  await zip.add(`${root}/class-description.txt`, classDescriptionText(snapshot), { compress: true });
  await zip.add(`${root}/export-report.txt`, reportText(report), { compress: true });
  await zip.add(`${root}/export-report.json`, `${JSON.stringify(report, null, 2)}\n`, { compress: true });
  await zip.add(`${root}/index.html`, indexHtml(snapshot, results, report), { compress: true });
  const blob = zip.finish();
  report.archiveBytes = blob.size;
  onProgress({ ...progress, phase: 'zipping', currentFile: '', bytesDone: completedBytes, archiveBytes: blob.size });
  return { blob, archiveName, report };
}
