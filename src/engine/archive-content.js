// Generated files inside the archive: per-item description.txt and
// metadata.json, class-level files, the export report and an index page.
// Everything here is pure (no I/O) so it is unit-tested directly.

import { kindLabel } from './download-resolver.js';
import { sanitizeComponent, NameAllocator } from './filenames.js';

export const TYPE_FOLDERS = {
  assignment: 'Assignments',
  material: 'Materials',
  question: 'Questions',
  announcement: 'Announcements',
  other: 'Other Coursework',
};

export const TYPE_LABELS = {
  assignment: 'Assignment',
  material: 'Material',
  question: 'Question',
  announcement: 'Announcement',
  other: 'Coursework',
};

export const ROOT_FILES = ['class-info.json', 'class-description.txt', 'export-report.txt', 'export-report.json', 'index.html'];

export const EXPORTER_NAME = 'Google Classroom Bulk Exporter';

// Short components keep full paths under Windows' 260-character limit when
// the archive is extracted into a typical Downloads folder.
const ROOT_MAX = 50;
const ITEM_MAX = 50;

/** Folder name of a class: "<name> - <section>", shortened and made safe. */
export function classFolderName(info) {
  const { name, section } = info || {};
  return sanitizeComponent(section ? `${name} - ${section}` : name, { maxLength: ROOT_MAX, fallback: 'Classroom export' });
}

/**
 * Decide the archive folders for every item (deterministic for a snapshot).
 * `root` is the class folder's path in the archive: the class folder name for
 * a single-class archive, "<export folder>/<class folder>" in an account archive.
 * @returns {{rootName:string, items:{item:object, typeFolder:string, folder:string, relFolder:string}[]}}
 */
export function planLayout(snapshot, { root = classFolderName(snapshot.classInfo) } = {}) {
  const rootName = root;
  const allocator = new NameAllocator();
  for (const name of [...ROOT_FILES, ...Object.values(TYPE_FOLDERS)]) allocator.reserve(rootName, name);
  const items = (snapshot.items || []).map((item) => {
    const typeFolder = TYPE_FOLDERS[item.type] || TYPE_FOLDERS.other;
    const dir = `${rootName}/${typeFolder}`;
    const name = allocator.allocate(dir, sanitizeComponent(item.title, { maxLength: ITEM_MAX, fallback: 'Untitled' }));
    return { item, typeFolder, folder: `${dir}/${name}`, relFolder: `${typeFolder}/${name}` };
  });
  return { rootName, items };
}

export function underline(text, char = '=') {
  return `${text}\n${char.repeat(Math.min(Math.max(text.length, 3), 80))}`;
}

function metaRows(item) {
  const m = item.meta || {};
  const rows = [['Type', TYPE_LABELS[item.type] || 'Coursework']];
  if (item.topic) rows.push(['Topic', item.topic]);
  if (m.dueText) rows.push(['Due', m.dueText]);
  if (m.pointsText) rows.push(['Points', m.pointsText]);
  if (m.postedText) rows.push(['Posted', m.postedText]);
  if (m.editedText) rows.push(['Edited', m.editedText]);
  if (m.statusText) rows.push(['Status', m.statusText]);
  if (item.classroomUrl) rows.push(['Classroom link', item.classroomUrl]);
  return rows;
}

function describeAttachment(entry) {
  const r = entry.resource;
  const name = r.title || entry.fileName || r.url;
  const type = r.typeLabel || kindLabel(r.kind);
  if (entry.status === 'downloaded') {
    const note = entry.exportLabel ? `, exported as ${entry.exportLabel}` : '';
    return `- ${name} (${type}${note}) -> ${entry.savedAs}`;
  }
  if (entry.status === 'link') {
    return `- ${name} (${type}) -> link saved as ${entry.savedAs}\n    ${r.url}\n    ${entry.note}`;
  }
  return `- ${name} (${type}) -> NOT DOWNLOADED: ${entry.error}\n    ${r.url}`;
}

/** Human-readable description.txt for one item. */
export function itemDescriptionText(item, attachments) {
  const lines = [underline(item.title), ''];
  for (const [label, value] of metaRows(item)) lines.push(`${label}: ${value}`);
  lines.push('', underline(item.type === 'announcement' ? 'Text' : 'Instructions', '-'));
  lines.push(item.description ? item.description : item.type === 'announcement' ? '(No text)' : '(No instructions)');
  const own = attachments.filter((a) => a.resource.source === 'attachment');
  const linked = attachments.filter((a) => a.resource.source !== 'attachment');
  if (own.length) {
    lines.push('', underline('Attachments', '-'));
    for (const a of own) lines.push(describeAttachment(a));
  }
  if (linked.length) {
    lines.push('', underline('Linked in the text', '-'));
    for (const a of linked) lines.push(describeAttachment(a));
  }
  if (item.warnings && item.warnings.length) {
    lines.push('', underline('Export notes', '-'));
    for (const w of item.warnings) lines.push(`- ${w}`);
  }
  return `${lines.join('\n')}\n`;
}

function attachmentMetadata(entry) {
  const r = entry.resource;
  const out = {
    title: r.title || null,
    type: r.typeLabel || kindLabel(r.kind),
    kind: r.kind,
    source: r.source,
    originalUrl: r.url,
    status: entry.status,
  };
  if (r.id && r.kind !== 'youtube' && r.kind !== 'link') out.driveFileId = r.id;
  if (r.kind === 'youtube' && r.id) out.youtubeVideoId = r.id;
  if (entry.savedAs) out.file = entry.savedAs;
  if (entry.status === 'downloaded') {
    if (entry.headerName) out.originalFilename = entry.headerName;
    out.size = entry.size;
    out.contentType = entry.contentType || null;
    if (entry.exportLabel) out.exportedAs = entry.exportLabel;
  }
  if (entry.status === 'link') out.note = entry.note;
  if (entry.status === 'failed') {
    out.error = entry.error;
    out.errorCode = entry.errorCode || null;
  }
  return out;
}

/** metadata.json for one item. */
export function itemMetadata(item, attachments, relFolder) {
  const m = item.meta || {};
  return {
    schemaVersion: 1,
    type: item.type,
    title: item.title,
    topic: item.topic || null,
    classroomId: item.id || null,
    classroomUrl: item.classroomUrl || null,
    dueText: m.dueText || null,
    pointsText: m.pointsText || null,
    postedText: m.postedText || null,
    editedText: m.editedText || null,
    statusText: m.statusText || null,
    description: item.description || '',
    folder: relFolder,
    attachments: attachments.map(attachmentMetadata),
    extraction: {
      sources: item.sources || [],
      warnings: item.warnings || [],
    },
  };
}

function countByType(items) {
  const counts = { assignment: 0, material: 0, question: 0, announcement: 0, other: 0 };
  for (const item of items) counts[item.type in counts ? item.type : 'other']++;
  return counts;
}

/** The export options as recorded in class-info.json and export-manifest.json. */
export function exportOptions(options) {
  return {
    includeAnnouncements: !!options.includeAnnouncements,
    readItemPages: !!options.readDetailPages,
    googleFilesExportedAs: options.googleFormat === 'pdf' ? 'pdf' : 'office',
  };
}

/** class-info.json */
export function classInfoJson(snapshot, layout, summary, { exportedAt, version, options }) {
  const info = snapshot.classInfo || {};
  return {
    schemaVersion: 1,
    exporter: { name: EXPORTER_NAME, version },
    exportedAt,
    class: {
      id: info.courseId || null,
      name: info.name || null,
      section: info.section || null,
      url: info.url || null,
      details: info.bannerLines || [],
    },
    counts: { ...countByType(snapshot.items || []), items: (snapshot.items || []).length, ...summary },
    topics: (snapshot.topics || []).map((t) => t.name),
    options: exportOptions(options),
    discovery: {
      itemPageStrategy: (snapshot.stats && snapshot.stats.detailStrategy) || null,
      warnings: snapshot.warnings || [],
    },
    items: layout.items.map(({ item, relFolder }) => ({
      type: item.type,
      title: item.title,
      topic: item.topic || null,
      folder: relFolder,
      classroomUrl: item.classroomUrl || null,
    })),
  };
}

/** class-description.txt */
export function classDescriptionText(snapshot) {
  const info = snapshot.classInfo || {};
  const lines = [underline(info.name || 'Class'), ''];
  if (info.section) lines.push(`Section: ${info.section}`);
  for (const line of info.bannerLines || []) lines.push(line);
  if (info.url) lines.push(`Classroom link: ${info.url}`);
  const counts = countByType(snapshot.items || []);
  lines.push('', underline('Contents', '-'));
  lines.push(`Assignments: ${counts.assignment}`);
  lines.push(`Materials: ${counts.material}`);
  if (counts.question) lines.push(`Questions: ${counts.question}`);
  if (counts.announcement) lines.push(`Announcements: ${counts.announcement}`);
  if (counts.other) lines.push(`Other coursework: ${counts.other}`);
  if (snapshot.topics && snapshot.topics.length) {
    lines.push('', underline('Topics', '-'));
    for (const t of snapshot.topics) lines.push(`- ${t.name}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The structured export report (also returned to the popup). */
export function buildReport(snapshot, layout, results, { exportedAt, version, options, archiveName }) {
  const failures = [];
  const links = [];
  let downloaded = 0;
  let bytes = 0;
  for (const { item, relFolder, attachments } of results) {
    for (const a of attachments) {
      const base = { itemType: TYPE_LABELS[item.type] || 'Coursework', itemTitle: item.title, itemFolder: relFolder };
      if (a.status === 'downloaded') {
        downloaded++;
        bytes += a.size || 0;
      } else if (a.status === 'failed') {
        failures.push({ ...base, file: a.resource.title || a.resource.url, url: a.resource.url, reason: a.error, code: a.errorCode || null });
      } else {
        links.push({ ...base, title: a.resource.title || a.resource.url, url: a.resource.url, reason: a.note });
      }
    }
  }
  const warnings = [...(snapshot.warnings || []).map((message) => ({ itemTitle: null, message }))];
  for (const { item } of results) {
    for (const message of item.warnings || []) warnings.push({ itemTitle: item.title, itemType: TYPE_LABELS[item.type], message });
  }
  const info = snapshot.classInfo || {};
  return {
    class: { name: info.name || null, section: info.section || null, id: info.courseId || null, url: info.url || null },
    exportedAt,
    exporterVersion: version,
    archiveName,
    options: { ...options },
    summary: {
      items: (snapshot.items || []).length,
      byType: countByType(snapshot.items || []),
      filesDownloaded: downloaded,
      filesFailed: failures.length,
      linksSaved: links.length,
      bytesDownloaded: bytes,
      warnings: warnings.length,
    },
    itemPageStrategy: (snapshot.stats && snapshot.stats.detailStrategy) || null,
    failures,
    links,
    warnings,
  };
}

export function formatBytes(n) {
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

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** export-report.txt */
export function reportText(report) {
  return `${[underline('Export Report'), '', ...reportLines(report)].join('\n')}\n`;
}

/** The body of export-report.txt (also one class's section of an account report). */
export function reportLines(report) {
  const s = report.summary;
  const lines = [];
  lines.push(`Class: ${report.class.name || '(unknown)'}${report.class.section ? ` (${report.class.section})` : ''}`);
  lines.push(`Exported: ${report.exportedAt}`);
  const t = s.byType;
  lines.push(`Items processed: ${s.items} (${plural(t.assignment, 'assignment')}, ${plural(t.material, 'material')}, ${plural(t.question, 'question')}, ${plural(t.announcement, 'announcement')}, ${t.other} other)`);
  lines.push('', 'Successful:', `  ${plural(s.filesDownloaded, 'file')} (${formatBytes(s.bytesDownloaded)})`);
  lines.push('', 'Failed:', `  ${plural(s.filesFailed, 'file')}`);
  for (const f of report.failures) {
    lines.push('', `  - ${f.itemType}: ${f.itemTitle}`, `    File: ${f.file}`, `    Reason: ${f.reason}`, `    URL: ${f.url}`);
  }
  lines.push('', 'Saved as links (not downloadable):', `  ${s.linksSaved}`);
  for (const l of report.links) {
    lines.push('', `  - ${l.itemType}: ${l.itemTitle}`, `    Link: ${l.title}`, `    URL: ${l.url}`, `    Reason: ${l.reason}`);
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w.itemTitle ? `${w.itemType || 'Item'} "${w.itemTitle}": ` : ''}${w.message}`);
  }
  return lines;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Stylesheet of the offline index pages. */
export const INDEX_STYLE = 'body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;color:#202124;background:#fff}h1{margin-bottom:0}h2{border-bottom:1px solid #dadce0;padding-bottom:4px;margin-top:32px}h3{margin:16px 0 0;font-size:16px}.meta{color:#5f6368;margin:2px 0}ul{margin:4px 0}.failed{color:#b3261e}small{color:#5f6368}@media (prefers-color-scheme:dark){body{background:#202124;color:#e8eaed}a{color:#8ab4f8}.meta,small{color:#9aa0a6}.failed{color:#f2b8b5}h2{border-color:#3c4043}}';

/** index.html: an offline table of contents with relative links. */
export function indexHtml(snapshot, results, report) {
  const info = snapshot.classInfo || {};
  const groups = [];
  for (const type of Object.keys(TYPE_FOLDERS)) {
    const rows = results.filter((r) => (TYPE_FOLDERS[r.item.type] ? r.item.type : 'other') === type);
    if (rows.length) groups.push({ type, rows });
  }
  const section = (group) => {
    const rows = group.rows
      .map(({ item, relFolder, attachments }) => {
        const files = attachments
          .filter((a) => a.savedAs)
          .map((a) => `<li><a href="${escapeHtml(encodePath(`${relFolder}/${a.savedAs}`))}">${escapeHtml(a.fileName || a.resource.title || a.savedAs)}</a>${a.status === 'link' ? ' <small>(link)</small>' : ''}</li>`)
          .join('');
        const failed = attachments
          .filter((a) => a.status === 'failed')
          .map((a) => `<li class="failed">${escapeHtml(a.resource.title || a.resource.url)} — not downloaded: ${escapeHtml(a.error)}</li>`)
          .join('');
        const meta = [item.topic && `Topic: ${item.topic}`, item.meta && item.meta.dueText && `Due: ${item.meta.dueText}`].filter(Boolean).join(' · ');
        return `<article><h3><a href="${escapeHtml(encodePath(`${relFolder}/description.txt`))}">${escapeHtml(item.title)}</a></h3>${meta ? `<p class="meta">${escapeHtml(meta)}</p>` : ''}${files || failed ? `<ul>${files}${failed}</ul>` : ''}</article>`;
      })
      .join('\n');
    return `<section><h2>${escapeHtml(TYPE_FOLDERS[group.type])} (${group.rows.length})</h2>\n${rows}</section>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(info.name || 'Classroom export')}</title>
<style>${INDEX_STYLE}</style>
</head><body>
<h1>${escapeHtml(info.name || 'Classroom export')}</h1>
<p class="meta">${escapeHtml([info.section, `Exported ${report.exportedAt}`].filter(Boolean).join(' · '))} · <a href="export-report.txt">Export report</a> · <a href="class-description.txt">Class details</a></p>
<p>${report.summary.filesDownloaded} files downloaded, ${report.summary.filesFailed} could not be downloaded, ${report.summary.linksSaved} saved as links.</p>
${groups.map(section).join('\n')}
</body></html>
`;
}

/** Contents of a Windows/macOS Internet Shortcut (.url) file. */
export function internetShortcut(url) {
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}
