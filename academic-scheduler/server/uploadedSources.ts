// Classes, coursework and announcements the website sends with an AI run
// (POST /api/analysis `sources`), so the AI also reads what was imported from
// the browser extension or a schedule file, not only what a Google sync stored.
// They are stored like synced records, marked via "extension"; they never
// replace what a sync stored (a synced class is the sync's), and analysis.ts
// leaves out uploaded announcements of synced classes, which the sync lists.
//
// Untrusted input: every field is checked; anything off rejects the upload.
import { sha256 } from './crypto.js';
import type { Db } from './db.js';

export const MAX_CLASSES = 40;
export const MAX_WORK = 1500;
export const MAX_ANNOUNCEMENTS_PER_CLASS = 20;
export const MAX_TEXT = 5000;
const CLASS_ID = /^gc-class-([A-Za-z0-9._:-]{1,90})$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,90}$/;
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const URL_ = /^https:\/\/[^\s]{1,1990}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Absent, or a string of at most `max` characters; `false` when it is something else. */
const optional = (v: unknown, max: number, pattern?: RegExp): string | undefined | false =>
  v === undefined || v === null ? undefined : typeof v === 'string' && v.length <= max && (!pattern || pattern.test(v)) ? v : false;

export type UploadedRecord = { kind: string; source_id: string; course_id: string; fingerprint: string; data: Obj; state: 'present' };

function record(kind: string, sourceId: string, courseId: string, data: Obj): UploadedRecord {
  const clean = Object.fromEntries(Object.entries({ ...data, via: 'extension' }).filter(([, v]) => v !== undefined && v !== ''));
  return { kind, source_id: sourceId, course_id: courseId, fingerprint: sha256(JSON.stringify(clean)), data: clean, state: 'present' };
}

/** The records in `sources`, or null when anything is off. */
export function uploadedSources(sources: unknown): UploadedRecord[] | null {
  if (!isObj(sources) || !Array.isArray(sources.classes) || !Array.isArray(sources.work)) return null;
  if (sources.classes.length > MAX_CLASSES || sources.work.length > MAX_WORK) return null;
  const out: UploadedRecord[] = [];
  const courses = new Set<string>();
  for (const c of sources.classes) {
    if (!isObj(c) || typeof c.id !== 'string') return null;
    const course = CLASS_ID.exec(c.id)?.[1];
    const name = optional(c.name, 200);
    const description = optional(c.description, MAX_TEXT);
    if (!course || !name || description === false || !Array.isArray(c.announcements ?? [])) return null;
    const announcements = (c.announcements ?? []) as unknown[];
    if (announcements.length > MAX_ANNOUNCEMENTS_PER_CLASS) return null;
    courses.add(course);
    out.push(record('course', course, course, { name, description }));
    for (const a of announcements) {
      if (!isObj(a)) return null;
      const text = optional(a.text, MAX_TEXT);
      const postedAt = optional(a.postedAt, 19, DATE);
      const url = optional(a.url, 2000, URL_);
      if (!text || !text.trim() || postedAt === false || url === false) return null;
      // Imported announcements carry no Classroom id: the same text posted at the same time is the same announcement.
      out.push(record('announcement', `ext-${sha256(`${text}\n${postedAt ?? ''}`).slice(0, 32)}`, course, { text, postedAt, url }));
    }
  }
  for (const w of sources.work) {
    if (!isObj(w) || typeof w.id !== 'string' || typeof w.classId !== 'string') return null;
    const source = /^gc-(.+)$/.exec(w.id)?.[1];
    const course = CLASS_ID.exec(w.classId)?.[1];
    const title = optional(w.title, 200);
    const description = optional(w.description, MAX_TEXT);
    const due = optional(w.due, 19, DATE);
    const points = optional(w.points, 100);
    const url = optional(w.url, 2000, URL_);
    if (!source || !SOURCE_ID.test(source) || !course || !courses.has(course) || !title) return null;
    if (description === false || due === false || points === false || url === false || (w.turnedIn !== undefined && typeof w.turnedIn !== 'boolean')) return null;
    out.push(record('coursework', source, course, { title, description, due, points, url, turnedIn: w.turnedIn === true ? true : undefined }));
  }
  return out;
}

/** Stores the records; a record a sync stored (not via "extension") is left as it is. */
export async function storeUploadedSources(db: Db, userId: string, records: UploadedRecord[]): Promise<void> {
  if (!records.length) return;
  await db.query(
    `INSERT INTO source_records (user_id, kind, source_id, course_id, fingerprint, data, state)
     SELECT $1, r.kind, r.source_id, r.course_id, r.fingerprint, r.data, r.state
     FROM jsonb_to_recordset($2::jsonb) AS r(kind text, source_id text, course_id text, fingerprint text, data jsonb, state text)
     ON CONFLICT (user_id, kind, source_id) DO UPDATE SET
       course_id = EXCLUDED.course_id, data = EXCLUDED.data, state = EXCLUDED.state, last_seen = now(),
       changed_at = CASE WHEN source_records.fingerprint <> EXCLUDED.fingerprint THEN now() ELSE source_records.changed_at END,
       fingerprint = EXCLUDED.fingerprint
     WHERE source_records.data->>'via' = 'extension'`,
    [userId, JSON.stringify(records)],
  );
}
