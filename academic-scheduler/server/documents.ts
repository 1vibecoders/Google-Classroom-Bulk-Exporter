// Course documents (SPEC.md § 12.1, § 13.2, § 14): the text of Google Drive
// files attached to coursework, materials and announcements, kept in the
// knowledge base as source_records of kind 'document' (data: title, link, file
// type, status, text, the Classroom items it is attached to), where the AI
// analysis reads them like announcements.
//
// Change detection is Drive's own: every sync reads each attached file's
// metadata, and the file is downloaded again only when its modifiedTime or
// md5Checksum changed; unchanged documents keep their text and their cached
// analysis. Files without readable text (images, videos, forms, scans) are
// recorded with a status and never guessed at.
//
// Limits per sync: MAX_FILES files checked, MAX_DOWNLOADS downloaded, and a
// time budget; the rest is read by the next sync.
// shortcut: a document no longer attached to anything keeps its record (and stays analyzable); mark it missing once course listings report completeness per item kind.
import { documentText, EXPORTED_AS_TEXT, MAX_DOCUMENT_BYTES, READABLE, type DocumentStatus } from '../src/lib/documents/text.js';
import { sha256 } from './crypto.js';
import type { Context } from './context.js';
import { GoogleError, type DriveFile } from './google.js';
import { UPSERT } from './sync.js';

export const MAX_FILES = 60;
export const MAX_DOWNLOADS = 25;
const SECONDS = 25;

export type Parent = { kind: 'coursework' | 'material' | 'announcement'; sourceId: string };

export interface DocumentRef {
  fileId: string;
  title: string;
  url?: string;
  /** Exporter form of the Classroom course id. */
  courseId: string;
  parent: Parent;
}

export type DocumentStatusAll = DocumentStatus | 'inaccessible';

export interface DocumentData {
  title: string;
  url?: string;
  mime: string;
  status: DocumentStatusAll;
  text?: string;
  parents: Parent[];
  via: 'drive' | 'extension';
}

export interface DocumentCounts {
  read: number;
  unchanged: number;
  unreadable: number;
  waiting: number;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/** Reads new and changed documents; returns warnings for the sync summary. */
export async function syncDocuments(
  context: Context,
  userId: string,
  accessToken: string,
  refs: DocumentRef[],
  now = Date.now,
): Promise<{ counts: DocumentCounts; warnings: string[] }> {
  const { db, google } = context;
  const deadline = now() + SECONDS * 1000;
  const files = new Map<string, DocumentRef & { parents: Parent[] }>();
  for (const ref of refs) {
    if (!DRIVE_ID.test(ref.fileId)) continue;
    const entry = files.get(ref.fileId) ?? { ...ref, parents: [] };
    if (!entry.parents.some((p) => p.kind === ref.parent.kind && p.sourceId === ref.parent.sourceId)) entry.parents.push(ref.parent);
    files.set(ref.fileId, entry);
  }
  const previous = await db.query<{ source_id: string; fingerprint: string }>(`SELECT source_id, fingerprint FROM source_records WHERE user_id = $1 AND kind = 'document'`, [
    userId,
  ]);
  const known = new Map(previous.map((p) => [p.source_id, p.fingerprint]));
  const counts: DocumentCounts = { read: 0, unchanged: 0, unreadable: 0, waiting: 0 };
  const warnings: string[] = [];
  let checked = 0;
  let downloads = 0;

  for (const file of files.values()) {
    if (checked >= MAX_FILES || downloads >= MAX_DOWNLOADS || now() > deadline) {
      counts.waiting++;
      continue;
    }
    checked++;
    const base = { title: file.title, url: file.url, parents: file.parents, via: 'drive' as const };
    let meta: DriveFile;
    try {
      meta = await google.getDriveFile(accessToken, file.fileId);
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err;
      if (err.transient) {
        counts.waiting++;
        continue;
      }
      // Shared with the class but not readable by this account, or removed.
      await save(context, userId, file.fileId, file.courseId, 'inaccessible', { ...base, mime: 'unknown', status: 'inaccessible' });
      counts.unreadable++;
      continue;
    }
    const version = `${meta.modifiedTime ?? ''}|${meta.md5Checksum ?? ''}|${meta.mimeType}`;
    if (known.get(file.fileId) === sha256(version)) {
      // Unchanged file: keep its text; refresh where it is attached.
      await db.query(
        `UPDATE source_records SET data = data || $3::jsonb, course_id = $4, state = 'present', last_seen = now() WHERE user_id = $1 AND kind = 'document' AND source_id = $2`,
        [userId, file.fileId, JSON.stringify({ title: meta.name ?? file.title, parents: file.parents }), file.courseId],
      );
      counts.unchanged++;
      continue;
    }
    const data: DocumentData = { ...base, title: meta.name ?? file.title, url: meta.webViewLink ?? file.url, mime: meta.mimeType, status: 'unsupported' };
    if (!READABLE.has(meta.mimeType)) {
      // Nothing to download.
    } else if (Number(meta.size ?? 0) > MAX_DOCUMENT_BYTES) {
      data.status = 'too_large';
    } else {
      downloads++;
      try {
        const result = await documentText(await google.downloadDriveFile(accessToken, meta, EXPORTED_AS_TEXT.has(meta.mimeType)), meta.mimeType);
        data.status = result.status;
        if (result.status === 'ok') data.text = result.text;
      } catch (err) {
        if (!(err instanceof GoogleError)) throw err;
        if (err.transient) {
          counts.waiting++;
          continue;
        }
        data.status = err.status === 403 && /exportSizeLimitExceeded/i.test(err.reason) ? 'too_large' : 'inaccessible';
      }
    }
    await save(context, userId, file.fileId, file.courseId, version, data);
    if (data.status === 'ok') counts.read++;
    else counts.unreadable++;
  }
  if (counts.waiting) warnings.push(`${counts.waiting} course ${counts.waiting === 1 ? 'document was' : 'documents were'} not read yet; the next sync continues.`);
  return { counts, warnings };
}

async function save(context: Context, userId: string, fileId: string, courseId: string, version: string, data: DocumentData): Promise<void> {
  const record = { kind: 'document', source_id: fileId, course_id: courseId, fingerprint: sha256(version), data, state: 'present' };
  await context.db.query(UPSERT, [userId, JSON.stringify([record])]);
}

/** Drive file ids of the materials of one Classroom item. */
export function driveRefs(
  materials: Array<{ driveFile?: { driveFile?: { id?: string; title?: string; alternateLink?: string } } }> | undefined,
  courseId: string,
  parent: Parent,
): DocumentRef[] {
  const out: DocumentRef[] = [];
  for (const m of materials ?? []) {
    const f = m.driveFile?.driveFile;
    if (f?.id) out.push({ fileId: f.id, title: Array.from(f.title ?? 'Document').slice(0, 300).join(''), url: f.alternateLink?.startsWith('https://') ? f.alternateLink : undefined, courseId, parent });
  }
  return out;
}
