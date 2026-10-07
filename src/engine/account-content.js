// Archive-level files. export-manifest.json is written into every archive so
// that consumers can read both kinds the same way:
//   kind "class"    a single-class archive; the manifest is in the class
//                   folder and its one class has folder ".".
//   kind "account"  every active class of one Google account; the top-level
//                   folder holds the manifest, index.html and a combined
//                   export-report.txt next to one folder per class, each with
//                   exactly the single-class layout of archive-content.js.
// Everything here is pure (no I/O) so it is unit-tested directly.

import '../shared/protocol.js';
import { NameAllocator, isoDate } from './filenames.js';
import {
  EXPORTER_NAME,
  INDEX_STYLE,
  classFolderName,
  encodePath,
  escapeHtml,
  exportOptions,
  formatBytes,
  plural,
  reportLines,
  underline,
} from './archive-content.js';

const STATUS = globalThis.GCX_PROTOCOL.CLASS_STATUS;

export const MANIFEST_FILE = 'export-manifest.json';
const MANIFEST_FORMAT_VERSION = 1;
export const ACCOUNT_ROOT_FILES = [MANIFEST_FILE, 'index.html', 'export-report.txt'];

const TOTAL_KEYS = ['items', 'filesDownloaded', 'filesFailed', 'linksSaved', 'bytesDownloaded'];

/** Top-level folder of an account archive. */
export function accountRootName(now) {
  return `Google Classroom Export - ${isoDate(now)}`;
}

/** File name of an account archive (saved in Downloads/Classroom Exports/). */
export function accountArchiveName(now) {
  return `All classes - ${isoDate(now)}.zip`;
}

/**
 * Class folders of an account archive, allocated in the order the classes are
 * added: the single-class folder name ("<name> - <section>"), and " (2)",
 * " (3)", ... for classes whose name and section are the same.
 */
export class AccountLayout {
  constructor(rootName) {
    this.rootName = rootName;
    this.allocator = new NameAllocator();
    for (const name of ACCOUNT_ROOT_FILES) this.allocator.reserve(rootName, name);
  }

  /** @returns {{name:string, path:string}} the folder name and its path in the archive */
  allocate(classInfo) {
    const name = this.allocator.allocate(this.rootName, classFolderName(classInfo), { folder: true });
    return { name, path: `${this.rootName}/${name}` };
  }
}

/**
 * Outcome of one class: "exported" (complete folder), "partial" (folder
 * written, but some files could not be downloaded or writing it stopped with
 * an error) or "failed" (no folder).
 */
export function classStatus({ wrote, report, error }) {
  if (!wrote) return STATUS.FAILED;
  if (error || (report && report.summary.filesFailed > 0)) return STATUS.PARTIAL;
  return STATUS.EXPORTED;
}

/** Per-class counts recorded in the manifest, from the class's report summary. */
export function classCounts(summary) {
  return {
    items: summary.items,
    ...summary.byType,
    filesDownloaded: summary.filesDownloaded,
    filesFailed: summary.filesFailed,
    linksSaved: summary.linksSaved,
    bytesDownloaded: summary.bytesDownloaded,
    warnings: summary.warnings,
  };
}

/**
 * One entry of the manifest's "classes" list. `ref` is the class as listed
 * on the home page (account exports), `classInfo` as read from the class's
 * own pages (preferred when present).
 */
export function manifestClass({ ref = {}, classInfo = {}, folder = null, status, report = null, error = null }) {
  const entry = {
    courseId: classInfo.courseId || ref.courseId || null,
    name: classInfo.name || ref.name || null,
    section: classInfo.section || ref.section || null,
    teacher: ref.teacher || null,
    url: classInfo.url || ref.url || null,
    folder,
    status,
    counts: report ? classCounts(report.summary) : null,
  };
  if (error) entry.error = error;
  return entry;
}

function manifestTotals(classes) {
  const totals = { classes: classes.length, exported: 0, partial: 0, failed: 0 };
  for (const key of TOTAL_KEYS) totals[key] = 0;
  for (const c of classes) {
    totals[c.status]++;
    if (c.counts) for (const key of TOTAL_KEYS) totals[key] += c.counts[key];
  }
  return totals;
}

/** export-manifest.json */
export function exportManifest({ kind, exportedAt, accountIndex, options, classes, version }) {
  return {
    kind,
    formatVersion: MANIFEST_FORMAT_VERSION,
    exportedAt,
    accountIndex,
    options: exportOptions(options),
    classes,
    totals: manifestTotals(classes),
    extension: { name: EXPORTER_NAME, version },
  };
}

/**
 * The combined report of an account export (also returned to the popup):
 * totals, the class list, and every class's failures, links and warnings,
 * tagged with the class name. `reports[i]` is the report of
 * `manifest.classes[i]` (missing for classes that were not exported).
 */
export function accountReport(manifest, reports, { archiveName, warnings = [] }) {
  const tagged = (key) =>
    manifest.classes.flatMap((c, i) => (reports[i] ? reports[i][key].map((entry) => ({ ...entry, className: c.name })) : []));
  const byType = { assignment: 0, material: 0, question: 0, announcement: 0, other: 0 };
  for (const r of reports) {
    if (r) for (const type of Object.keys(byType)) byType[type] += r.summary.byType[type];
  }
  const allWarnings = [...warnings.map((message) => ({ itemTitle: null, message })), ...tagged('warnings')];
  const t = manifest.totals;
  return {
    kind: manifest.kind,
    accountIndex: manifest.accountIndex,
    exportedAt: manifest.exportedAt,
    exporterVersion: manifest.extension.version,
    archiveName,
    classes: manifest.classes,
    summary: {
      classes: t.classes,
      classesExported: t.exported,
      classesPartial: t.partial,
      classesFailed: t.failed,
      items: t.items,
      byType,
      filesDownloaded: t.filesDownloaded,
      filesFailed: t.filesFailed,
      linksSaved: t.linksSaved,
      bytesDownloaded: t.bytesDownloaded,
      warnings: allWarnings.length,
    },
    itemPageStrategy: null,
    failures: tagged('failures'),
    links: tagged('links'),
    warnings: allWarnings,
  };
}

function classTitle(c) {
  return `${c.name || '(unknown)'}${c.section ? ` (${c.section})` : ''}`;
}

/** The account archive's export-report.txt: overall summary, then one section per class. */
export function accountReportText(report, reports) {
  const s = report.summary;
  const t = s.byType;
  const lines = [underline('Export Report: All classes'), ''];
  lines.push(`Google account: /u/${report.accountIndex}/`);
  lines.push(`Exported: ${report.exportedAt}`);
  lines.push(`Classes: ${s.classes} (${s.classesExported} exported, ${s.classesPartial} partially exported, ${s.classesFailed} not exported)`);
  lines.push(`Items processed: ${s.items} (${plural(t.assignment, 'assignment')}, ${plural(t.material, 'material')}, ${plural(t.question, 'question')}, ${plural(t.announcement, 'announcement')}, ${t.other} other)`);
  lines.push(`Files downloaded: ${s.filesDownloaded} (${formatBytes(s.bytesDownloaded)})`);
  lines.push(`Files not downloaded: ${s.filesFailed}`);
  lines.push(`Saved as links (not downloadable): ${s.linksSaved}`);
  lines.push('', underline('Classes', '-'));
  report.classes.forEach((c, i) => {
    const where = c.folder ? `${c.folder}/` : 'not exported';
    lines.push(`${i + 1}. ${classTitle(c)}: ${c.status} -> ${where}`);
    if (c.error) lines.push(`   Reason: ${c.error}`);
  });
  const general = report.warnings.filter((w) => !w.className);
  if (general.length) {
    lines.push('', 'Warnings:');
    for (const w of general) lines.push(`  - ${w.message}`);
  }
  report.classes.forEach((c, i) => {
    lines.push('', '', underline(`Class ${i + 1} of ${report.classes.length}: ${classTitle(c)}`, '-'));
    if (c.folder) lines.push(`Folder: ${c.folder}/`);
    lines.push(`Status: ${c.status}`);
    if (c.error) lines.push(`Error: ${c.error}`);
    if (reports[i]) lines.push('', ...reportLines(reports[i]));
  });
  return `${lines.join('\n')}\n`;
}

/** The account archive's index.html: links to every class folder's own index. */
export function accountIndexHtml(manifest) {
  const t = manifest.totals;
  const rows = manifest.classes
    .map((c) => {
      const title = c.folder ? `<a href="${escapeHtml(encodePath(`${c.folder}/index.html`))}">${escapeHtml(c.name)}</a>` : escapeHtml(c.name);
      const counts = c.counts && `${plural(c.counts.items, 'item')}, ${plural(c.counts.filesDownloaded, 'file')}`;
      const meta = [c.section, c.teacher, counts].filter(Boolean).join(' · ');
      const note = c.status === STATUS.FAILED ? `Not exported: ${c.error || 'unknown error'}` : c.status === STATUS.PARTIAL ? `Partially exported${c.error ? `: ${c.error}` : ` (${plural(c.counts.filesFailed, 'file')} not downloaded)`}` : '';
      return `<article><h3>${title}</h3>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}${note ? `<p class="failed">${escapeHtml(note)}</p>` : ''}</article>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Google Classroom export</title>
<style>${INDEX_STYLE}</style>
</head><body>
<h1>Google Classroom export</h1>
<p class="meta">${escapeHtml(`Google account /u/${manifest.accountIndex}/ · Exported ${manifest.exportedAt}`)} · <a href="export-report.txt">Export report</a> · <a href="${MANIFEST_FILE}">Manifest</a></p>
<p>${plural(t.classes, 'class', 'classes')}: ${t.exported} exported, ${t.partial} partially exported, ${t.failed} not exported. ${t.filesDownloaded} files downloaded, ${t.filesFailed} could not be downloaded, ${t.linksSaved} saved as links.</p>
<section><h2>Classes (${t.classes})</h2>
${rows}</section>
</body></html>
`;
}
