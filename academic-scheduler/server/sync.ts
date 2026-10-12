// User-triggered Google Classroom sync (SPEC.md § 12.1, § 13).
//
// Allowance (§ 13.5): at most SYNC_LIMIT counted syncs per rolling 24 hours,
// enforced here in one transaction that locks the user's row, so concurrent
// clicks cannot overrun it; a second sync while one is running is refused.
// What counts: a sync counts once Google has answered the course listing.
// Attempts refused before that (no allowance left, already running, sign-in
// expired, missing permission, Google unreachable) are not counted.
//
// Change detection (§ 13.2): the Classroom API has no "changed since" filter
// for coursework, so every sync lists the active courses and their published
// coursework and compares each item's stable id and content fingerprint with
// the knowledge base (source_records). Unchanged items keep their records.
//
// Disappearance (§ 13.4): an item is marked `missing` only when its course was
// listed completely in this run. A course that refuses access is marked
// `inaccessible` and its items are left as they were; a course that is no
// longer listed is marked `missing` and its items are left as they were.
// Nothing is ever deleted here; the website shows "Removed from source" and
// the person decides.
import { IMPORT_BATCH_VERSION, type ImportBatch, type ImportedAssignment, type ImportedCourse, type ImportedLink, type SyncAllowance, type SyncCounts } from '../src/model/importBatch.js';
import { decrypt, sha256 } from './crypto.js';
import type { Context } from './context.js';
import type { Db } from './db.js';
import { GoogleError, SCOPES, type CourseWork, type GoogleDate, type GoogleTime, type Material } from './google.js';
import type { SessionUser } from './http.js';

export const SYNC_LIMIT = 3;
const RUNNING_MINUTES = 10;

export type SyncOutcome =
  | { kind: 'ok'; batch: ImportBatch; allowance: SyncAllowance }
  | { kind: 'limited' | 'busy'; allowance: SyncAllowance }
  | { kind: 'reauth' | 'blocked' | 'failed'; message: string; allowance: SyncAllowance };

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

export async function allowance(db: Db, userId: string): Promise<SyncAllowance> {
  const rows = await db.query<{ started_at: unknown; status: string; counted: boolean }>(
    `SELECT started_at, status, counted FROM sync_runs
     WHERE user_id = $1 AND ((counted AND started_at > now() - interval '24 hours') OR (status = 'running' AND started_at > now() - interval '${RUNNING_MINUTES} minutes'))
     ORDER BY started_at`,
    [userId],
  );
  const counted = rows.filter((r) => r.counted);
  const remaining = Math.max(0, SYNC_LIMIT - counted.length);
  const oldest = counted[0];
  return {
    limit: SYNC_LIMIT,
    remaining,
    nextAvailableAt: remaining === 0 && oldest ? new Date(asDate(oldest.started_at).getTime() + 24 * 3600 * 1000).toISOString() : null,
    running: rows.some((r) => r.status === 'running'),
  };
}

/** Takes one allowance atomically. Returns the run id, or null when none is left or a sync is running. */
export async function reserveSync(db: Db, userId: string): Promise<number | null> {
  const [, inserted] = await db.transaction([
    { text: 'SELECT id FROM users WHERE id = $1 FOR UPDATE', params: [userId] },
    {
      text: `INSERT INTO sync_runs (user_id, status, counted)
             SELECT $1, 'running', true
             WHERE (SELECT count(*) FROM sync_runs WHERE user_id = $1 AND counted AND started_at > now() - interval '24 hours') < ${SYNC_LIMIT}
               AND NOT EXISTS (SELECT 1 FROM sync_runs WHERE user_id = $1 AND status = 'running' AND started_at > now() - interval '${RUNNING_MINUTES} minutes')
             RETURNING id`,
      params: [userId],
    },
  ]);
  const row = inserted?.[0];
  return row ? Number(row.id) : null;
}

async function finishRun(db: Db, runId: number, status: string, counted: boolean, summary: unknown): Promise<void> {
  await db.query(`UPDATE sync_runs SET status = $2, counted = $3, summary = $4::jsonb, finished_at = now() WHERE id = $1`, [runId, status, counted, JSON.stringify(summary)]);
}

// ---------------------------------------------------------------------------
// Normalizing Classroom data (SCHEDULE_FORMAT.md § 14.1 for IDs)
// ---------------------------------------------------------------------------

/** The exporter's form of a Classroom id: unpadded base64 of the decimal id. */
export function classroomId(id: string): string {
  return /^\d+$/.test(id) ? Buffer.from(id, 'utf8').toString('base64').replace(/=+$/, '') : id;
}

function cut(text: string | undefined, max: number): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const chars = Array.from(trimmed);
  return chars.length > max ? chars.slice(0, max).join('') : trimmed;
}

function httpsUrl(url: string | undefined): string | undefined {
  return url && /^https:\/\/[^\s]{1,1990}$/.test(url) ? url : undefined;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "Now" as a local date-time in `timezone`. */
export function localNow(timezone: string, now = new Date()): string {
  return localDateTime(now, timezone);
}

function localDateTime(moment: Date, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(moment)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Classroom due dates and times are in UTC; the schedule uses the person's local time. */
export function localDue(date: GoogleDate | undefined, time: GoogleTime | undefined, timezone: string): string | undefined {
  if (!date?.year || !date.month || !date.day) return undefined;
  if (!time) return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  const moment = new Date(Date.UTC(date.year, date.month - 1, date.day, time.hours ?? 0, time.minutes ?? 0));
  return localDateTime(moment, timezone);
}

export function isTimeZone(name: unknown): name is string {
  if (typeof name !== 'string' || name.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function links(materials: Material[] | undefined): ImportedLink[] | undefined {
  const out: ImportedLink[] = [];
  for (const m of materials ?? []) {
    const candidates = [
      [m.driveFile?.driveFile?.title, m.driveFile?.driveFile?.alternateLink],
      [m.youtubeVideo?.title, m.youtubeVideo?.alternateLink],
      [m.link?.title ?? m.link?.url, m.link?.url],
      [m.form?.title, m.form?.formUrl],
    ];
    for (const [title, url] of candidates) {
      const safe = httpsUrl(url);
      if (safe) out.push({ title: cut(title, 300) ?? 'Link', url: safe });
    }
  }
  return out.length ? out.slice(0, 50) : undefined;
}

type WorkData = Omit<ImportedAssignment, 'id' | 'classId' | 'sourceId' | 'state'>;

export function workData(work: CourseWork, timezone: string): WorkData {
  const data: WorkData = { title: cut(work.title, 200) ?? 'Untitled' };
  const description = cut(work.description, 5000);
  if (description) data.description = description;
  const due = localDue(work.dueDate, work.dueTime, timezone);
  if (due) data.due = due;
  if (typeof work.maxPoints === 'number' && work.maxPoints > 0) data.points = `${work.maxPoints} points`;
  const url = httpsUrl(work.alternateLink);
  if (url) data.url = url;
  const found = links(work.materials);
  if (found) data.links = found;
  return data;
}

// ---------------------------------------------------------------------------
// The sync run
// ---------------------------------------------------------------------------

type Previous = {
  kind: string;
  source_id: string;
  course_id: string;
  fingerprint: string;
  state: string;
};

const UPSERT = `INSERT INTO source_records (user_id, kind, source_id, course_id, fingerprint, data, state)
  SELECT $1, r.kind, r.source_id, r.course_id, r.fingerprint, r.data, r.state
  FROM jsonb_to_recordset($2::jsonb) AS r(kind text, source_id text, course_id text, fingerprint text, data jsonb, state text)
  ON CONFLICT (user_id, kind, source_id) DO UPDATE SET
    course_id = EXCLUDED.course_id,
    data = EXCLUDED.data,
    state = EXCLUDED.state,
    last_seen = now(),
    changed_at = CASE WHEN source_records.fingerprint <> EXCLUDED.fingerprint THEN now() ELSE source_records.changed_at END,
    fingerprint = EXCLUDED.fingerprint`;

function hasScopes(granted: string): boolean {
  const have = new Set(granted.split(/\s+/));
  return SCOPES.filter((s) => s.startsWith('https://')).every((s) => have.has(s));
}

function problemMessage(err: GoogleError): { kind: 'reauth' | 'blocked' | 'failed'; message: string } {
  if (err.reason === 'invalid_grant' || err.status === 401) return { kind: 'reauth', message: 'Your Google sign-in has expired or was removed. Sign in with Google again.' };
  if (err.status === 403) {
    return {
      kind: 'blocked',
      message:
        'Google Classroom refused access for this account. Your school may not allow apps to read Classroom; you can still use the browser extension and the /academic-schedule skill.',
    };
  }
  return { kind: 'failed', message: 'Google Classroom could not be reached. This attempt was not counted; try again later.' };
}

export async function runSync(context: Context, user: SessionUser, timezone: string): Promise<SyncOutcome> {
  const { db, google, config } = context;
  const runId = await reserveSync(db, user.id);
  if (runId === null) {
    const current = await allowance(db, user.id);
    return { kind: current.running ? 'busy' : 'limited', allowance: current };
  }

  let begun = false;
  try {
    if (!user.refreshToken || !hasScopes(user.scopes)) {
      await finishRun(db, runId, 'refused', false, { reason: 'reauth' });
      return {
        kind: 'reauth',
        message: 'Sign in with Google again and allow access to your Classroom courses and coursework.',
        allowance: await allowance(db, user.id),
      };
    }
    const accessToken = await google.refresh(decrypt(user.refreshToken, config.tokenKey));
    const courses = await google.listCourses(accessToken);
    begun = true;

    const importedAt = localNow(timezone);
    const previous = await db.query<Previous>('SELECT kind, source_id, course_id, fingerprint, state FROM source_records WHERE user_id = $1', [user.id]);
    const before = new Map(previous.map((p) => [`${p.kind}:${p.source_id}`, p]));
    const counts: SyncCounts = { new: 0, changed: 0, unchanged: 0, missing: 0 };
    const batchCourses: ImportedCourse[] = [];
    const batchItems: ImportedAssignment[] = [];
    const warnings: string[] = [];
    let partial = false;

    for (const course of courses) {
      const courseSource = classroomId(course.id);
      const courseData = { name: cut(course.name, 200) ?? 'Untitled class', section: cut(course.section, 100), room: cut(course.room, 100), url: httpsUrl(course.alternateLink) };
      const imported: ImportedCourse = { id: `gc-class-${courseSource}`, sourceId: courseSource, ...stripUndefined(courseData), state: 'present' };
      let works: CourseWork[] | null = null;
      try {
        works = await google.listCourseWork(accessToken, course.id);
      } catch (err) {
        if (!(err instanceof GoogleError)) throw err;
        partial = true;
        if (!err.transient && (err.status === 403 || err.status === 404)) {
          imported.state = 'inaccessible';
          warnings.push(`The coursework of “${courseData.name}” could not be read (Google refused access). Its items were left as they were.`);
        } else {
          warnings.push(`The coursework of “${courseData.name}” could not be read right now. Its items were left as they were; the next sync tries again.`);
        }
      }
      await db.query(UPSERT, [
        user.id,
        JSON.stringify([{ kind: 'course', source_id: courseSource, course_id: courseSource, fingerprint: sha256(JSON.stringify(courseData)), data: courseData, state: imported.state }]),
      ]);
      batchCourses.push(imported);
      if (!works) continue;

      // The course was listed completely: compare every item with the knowledge base.
      const records = works.map((work) => {
        const sourceId = classroomId(work.id);
        const data = workData(work, timezone);
        const fingerprint = sha256(JSON.stringify(data));
        const old = before.get(`coursework:${sourceId}`);
        if (!old) counts.new++;
        else if (old.fingerprint !== fingerprint || old.state !== 'present') counts.changed++;
        else counts.unchanged++;
        batchItems.push({ id: `gc-${sourceId}`, classId: imported.id, sourceId, ...data, state: 'present' });
        return { kind: 'coursework', source_id: sourceId, course_id: courseSource, fingerprint, data, state: 'present' };
      });
      if (records.length) await db.query(UPSERT, [user.id, JSON.stringify(records)]);
      const seen = new Set(records.map((r) => r.source_id));
      for (const old of previous) {
        if (old.kind !== 'coursework' || old.course_id !== courseSource || seen.has(old.source_id)) continue;
        if (old.state === 'present') counts.missing++;
        batchItems.push({ id: `gc-${old.source_id}`, classId: imported.id, sourceId: old.source_id, state: 'missing' });
      }
      await db.query(
        `UPDATE source_records SET state = 'missing' WHERE user_id = $1 AND kind = 'coursework' AND course_id = $2 AND state = 'present'
         AND source_id NOT IN (SELECT jsonb_array_elements_text($3::jsonb))`,
        [user.id, courseSource, JSON.stringify([...seen])],
      );
    }

    const listed = new Set(courses.map((c) => classroomId(c.id)));
    const gone = previous.filter((p) => p.kind === 'course' && p.state === 'present' && !listed.has(p.source_id));
    if (gone.length) {
      await db.query(`UPDATE source_records SET state = 'missing' WHERE user_id = $1 AND kind = 'course' AND source_id IN (SELECT jsonb_array_elements_text($2::jsonb))`, [
        user.id,
        JSON.stringify(gone.map((g) => g.source_id)),
      ]);
      warnings.push(
        `${gone.length} ${gone.length === 1 ? 'class is' : 'classes are'} no longer among your active Google Classroom courses (archived, or you left). Their items were left as they were.`,
      );
    }

    await finishRun(db, runId, partial ? 'partial' : 'ok', true, { courses: courses.length, ...counts, warnings: warnings.length });
    console.log(JSON.stringify({ event: 'sync_finished', run: runId, courses: courses.length, ...counts, partial }));
    const batch: ImportBatch = {
      batchVersion: IMPORT_BATCH_VERSION,
      sourceType: 'classroom_api',
      importedAt,
      timezone,
      courses: batchCourses,
      assignments: batchItems,
      counts,
      warnings,
    };
    return { kind: 'ok', batch, allowance: await allowance(db, user.id) };
  } catch (err) {
    await finishRun(db, runId, 'failed', begun, { reason: err instanceof GoogleError ? err.reason : 'error' });
    if (!(err instanceof GoogleError)) throw err;
    const problem = problemMessage(err);
    const message = begun && problem.kind === 'failed' ? 'The sync stopped part way because Google Classroom could not be reached. Try again later.' : problem.message;
    return { ...problem, message, allowance: await allowance(db, user.id) };
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
