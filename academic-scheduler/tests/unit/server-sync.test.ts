// The sync backend on a real Postgres (PGlite) with a fake Google API:
// the rolling 3-per-24-hours allowance, change detection against the
// knowledge base, disappearance rules, failures that are not counted, and the
// HTTP routes (sign-in, sessions, same-origin checks, account deletion).
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Db } from '../../server/db';
import { encrypt } from '../../server/crypto';
import { setTestContext, type Context } from '../../server/context';
import { GoogleError, SCOPES, type Course, type CourseWork, type GoogleApi } from '../../server/google';
import { allowance, classroomId, localDue, reserveSync, runSync } from '../../server/sync';
import { callback, deleteAccount, login, me, sync } from '../../server/routes';
import type { SessionUser } from '../../server/http';

const KEY = Buffer.alloc(32, 7).toString('base64');
const TZ = 'America/New_York';
const ORIGIN = 'https://scheduler.example';

function pgliteDb(pg: PGlite): Db {
  return {
    query: async (text, params = []) => (await pg.query(text, params)).rows as never[],
    transaction: (statements) =>
      pg.transaction(async (tx) => {
        const out = [];
        for (const s of statements) out.push((await tx.query(s.text, s.params ?? [])).rows as Record<string, unknown>[]);
        return out;
      }),
  };
}

interface FakeClassroom {
  courses: Course[];
  work: Record<string, CourseWork[] | GoogleError>;
  refreshError?: GoogleError;
  coursesError?: GoogleError;
}

function fakeGoogle(classroom: FakeClassroom): GoogleApi {
  return {
    authUrl: ({ state, codeChallenge, redirectUri }) => `https://accounts.example/auth?state=${state}&code_challenge=${codeChallenge}&redirect_uri=${encodeURIComponent(redirectUri)}`,
    exchangeCode: async () => ({ accessToken: 'at', refreshToken: 'rt-new', idToken: idToken({ sub: 'u2', email: 'new@example.com' }), scope: SCOPES.join(' ') }),
    refresh: async () => {
      if (classroom.refreshError) throw classroom.refreshError;
      return 'access';
    },
    listCourses: async () => {
      if (classroom.coursesError) throw classroom.coursesError;
      return classroom.courses;
    },
    listCourseWork: async (_token, courseId) => {
      const work = classroom.work[courseId] ?? [];
      if (work instanceof GoogleError) throw work;
      return work;
    },
    revoke: async () => {},
  };
}

function idToken(claims: Record<string, unknown>): string {
  const payload = { iss: 'https://accounts.google.com', aud: 'client', exp: Date.now() / 1000 + 600, ...claims };
  return ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
}

const work = (id: string, courseId: string, title: string, extra: Partial<CourseWork> = {}): CourseWork => ({
  id,
  courseId,
  title,
  alternateLink: `https://classroom.google.com/c/${courseId}/a/${id}`,
  ...extra,
});

let pg: PGlite;
let db: Db;
let classroom: FakeClassroom;
let context: Context;
let user: SessionUser;

beforeEach(async () => {
  pg = new PGlite();
  db = pgliteDb(pg);
  await migrate(db);
  classroom = {
    courses: [
      { id: '111', name: 'English 10', section: 'Period 3', alternateLink: 'https://classroom.google.com/c/111' },
      { id: '222', name: 'Biology' },
    ],
    work: {
      '111': [
        work('901', '111', 'Othello essay', { dueDate: { year: 2026, month: 10, day: 10 }, dueTime: { hours: 3, minutes: 59 }, maxPoints: 100 }),
        work('902', '111', 'Vocab quiz', { dueDate: { year: 2026, month: 10, day: 12 } }),
      ],
      '222': [work('903', '222', 'Lab report', { materials: [{ link: { title: 'Rubric', url: 'https://example.org/rubric' } }, { link: { url: 'javascript:alert(1)' } }] })],
    },
  };
  context = { config: { googleClientId: 'client', googleClientSecret: 'secret', tokenKey: KEY }, db, google: fakeGoogle(classroom) };
  const sealed = encrypt('refresh-token', KEY);
  await db.query('INSERT INTO users (id, email, refresh_token, scopes) VALUES ($1, $2, $3, $4)', ['u1', 'student@example.com', sealed, SCOPES.join(' ')]);
  user = { id: 'u1', email: 'student@example.com', scopes: SCOPES.join(' '), refreshToken: sealed };
});

afterEach(async () => {
  setTestContext(null);
  await pg.close();
});

describe('normalizing Classroom data', () => {
  it('uses the exporter’s id form and the person’s local time', () => {
    expect(classroomId('627894214549')).toBe('NjI3ODk0MjE0NTQ5');
    expect(classroomId('NjI3ODk0MjE0NTQ5')).toBe('NjI3ODk0MjE0NTQ5');
    expect(localDue({ year: 2026, month: 10, day: 10 }, { hours: 3, minutes: 59 }, TZ)).toBe('2026-10-09T23:59:00');
    expect(localDue({ year: 2026, month: 10, day: 12 }, undefined, TZ)).toBe('2026-10-12');
    expect(localDue(undefined, undefined, TZ)).toBeUndefined();
  });
});

describe('sync allowance (3 per rolling 24 hours, server-side)', () => {
  it('allows three syncs, refuses the fourth and says when the next one is available', async () => {
    for (let i = 0; i < 3; i++) expect((await runSync(context, user, TZ)).kind).toBe('ok');
    const fourth = await runSync(context, user, TZ);
    expect(fourth.kind).toBe('limited');
    expect(fourth.allowance.remaining).toBe(0);
    const first = (await db.query<{ started_at: Date }>('SELECT started_at FROM sync_runs ORDER BY started_at LIMIT 1'))[0].started_at;
    expect(new Date(fourth.allowance.nextAvailableAt!).getTime()).toBe(new Date(first).getTime() + 24 * 3600 * 1000);
  });

  it('uses a rolling window: syncs older than 24 hours no longer count', async () => {
    for (const hours of [25, 30, 47]) {
      await db.query(`INSERT INTO sync_runs (user_id, status, counted, started_at) VALUES ('u1', 'ok', true, now() - make_interval(hours => $1))`, [hours]);
    }
    await db.query(`INSERT INTO sync_runs (user_id, status, counted, started_at) VALUES ('u1', 'ok', true, now() - interval '23 hours')`);
    expect((await allowance(db, 'u1')).remaining).toBe(2);
  });

  it('starts one sync for many simultaneous clicks, and never more than three a day', async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => reserveSync(db, 'u1')));
    expect(ids.filter((id) => id !== null)).toHaveLength(1);
    await db.query(`UPDATE sync_runs SET status = 'ok'`);
    for (let i = 0; i < 5; i++) {
      const id = await reserveSync(db, 'u1');
      if (id !== null) await db.query(`UPDATE sync_runs SET status = 'ok' WHERE id = $1`, [id]);
    }
    expect((await db.query(`SELECT 1 FROM sync_runs WHERE counted`)).length).toBe(3);
  });

  it('refuses a second sync while one is running, without using an allowance', async () => {
    await db.query(`INSERT INTO sync_runs (user_id, status, counted) VALUES ('u1', 'running', true)`);
    const outcome = await runSync(context, user, TZ);
    expect(outcome.kind).toBe('busy');
    expect(outcome.allowance).toMatchObject({ remaining: 2, running: true });
  });

  it('does not count attempts that fail before Google answered', async () => {
    classroom.refreshError = new GoogleError('expired', 400, 'invalid_grant', false);
    expect((await runSync(context, user, TZ)).kind).toBe('reauth');
    classroom.refreshError = undefined;
    classroom.coursesError = new GoogleError('down', 503, 'http_503', true);
    const failed = await runSync(context, user, TZ);
    expect(failed).toMatchObject({ kind: 'failed', message: expect.stringContaining('not counted') });
    classroom.coursesError = new GoogleError('blocked', 403, 'ClassroomApiDisabled', false);
    expect((await runSync(context, user, TZ)).kind).toBe('blocked');
    expect((await allowance(db, 'u1')).remaining).toBe(3);
  });

  it('asks to sign in again when Classroom permissions were not granted', async () => {
    const outcome = await runSync(context, { ...user, scopes: 'openid email' }, TZ);
    expect(outcome.kind).toBe('reauth');
    expect(outcome.allowance.remaining).toBe(3);
  });
});

describe('change detection and the knowledge base', () => {
  it('reports everything as new the first time, with schedule IDs, local due dates and safe links only', async () => {
    const outcome = await runSync(context, user, TZ);
    if (outcome.kind !== 'ok') throw new Error(outcome.kind);
    const { batch } = outcome;
    expect(batch.counts).toEqual({ new: 3, changed: 0, unchanged: 0, missing: 0 });
    expect(batch.courses.map((c) => c.id)).toEqual([`gc-class-${classroomId('111')}`, `gc-class-${classroomId('222')}`]);
    const essay = batch.assignments.find((a) => a.title === 'Othello essay')!;
    expect(essay).toMatchObject({ id: `gc-${classroomId('901')}`, classId: `gc-class-${classroomId('111')}`, due: '2026-10-09T23:59:00', points: '100 points', state: 'present' });
    expect(batch.assignments.find((a) => a.title === 'Lab report')!.links).toEqual([{ title: 'Rubric', url: 'https://example.org/rubric' }]);
    const stored = await db.query('SELECT kind, count(*)::int AS n FROM source_records GROUP BY kind ORDER BY kind');
    expect(stored).toEqual([
      { kind: 'course', n: 2 },
      { kind: 'coursework', n: 3 },
    ]);
  });

  it('finds unchanged, changed and no-longer-listed items on later syncs', async () => {
    await runSync(context, user, TZ);
    let second = await runSync(context, user, TZ);
    expect(second.kind === 'ok' && second.batch.counts).toEqual({ new: 0, changed: 0, unchanged: 3, missing: 0 });

    classroom.work['111'] = [work('901', '111', 'Othello essay (final draft)', { dueDate: { year: 2026, month: 10, day: 10 }, dueTime: { hours: 3, minutes: 59 }, maxPoints: 100 })];
    second = await runSync(context, user, TZ);
    if (second.kind !== 'ok') throw new Error(second.kind);
    expect(second.batch.counts).toEqual({ new: 0, changed: 1, unchanged: 1, missing: 1 });
    expect(second.batch.assignments.find((a) => a.id === `gc-${classroomId('902')}`)).toEqual({
      id: `gc-${classroomId('902')}`,
      classId: `gc-class-${classroomId('111')}`,
      sourceId: classroomId('902'),
      state: 'missing',
    });
    const states = await db.query<{ source_id: string; state: string }>(`SELECT source_id, state FROM source_records WHERE kind = 'coursework' ORDER BY source_id`);
    expect(states.find((s) => s.source_id === classroomId('902'))!.state).toBe('missing');
  });

  it('leaves the items of a course it cannot read as they were (never "missing")', async () => {
    await runSync(context, user, TZ);
    classroom.work['222'] = new GoogleError('forbidden', 403, 'PERMISSION_DENIED', false);
    const outcome = await runSync(context, user, TZ);
    if (outcome.kind !== 'ok') throw new Error(outcome.kind);
    expect(outcome.batch.courses.find((c) => c.name === 'Biology')!.state).toBe('inaccessible');
    expect(outcome.batch.counts.missing).toBe(0);
    expect(outcome.batch.warnings.join(' ')).toContain('Biology');
    const lab = await db.query<{ state: string }>(`SELECT state FROM source_records WHERE source_id = $1`, [classroomId('903')]);
    expect(lab[0].state).toBe('present');
    const run = await db.query<{ status: string }>(`SELECT status FROM sync_runs ORDER BY id DESC LIMIT 1`);
    expect(run[0].status).toBe('partial');
  });

  it('keeps the items of a course that is no longer listed and says so', async () => {
    await runSync(context, user, TZ);
    classroom.courses = classroom.courses.filter((c) => c.id !== '222');
    const outcome = await runSync(context, user, TZ);
    if (outcome.kind !== 'ok') throw new Error(outcome.kind);
    expect(outcome.batch.counts.missing).toBe(0);
    expect(outcome.batch.warnings.join(' ')).toContain('no longer among your active Google Classroom courses');
  });
});

describe('routes', () => {
  beforeEach(() => setTestContext(context));

  async function signedInCookie(): Promise<string> {
    const start = await login(new Request(`${ORIGIN}/api/auth/login`));
    const oauth = start.headers.get('set-cookie')!.split(';')[0];
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const done = await callback(new Request(`${ORIGIN}/api/auth/callback?code=c&state=${state}`, { headers: { cookie: oauth } }));
    expect(done.headers.get('location')).toBe('/#/settings?google=connected');
    const session = done.headers.getSetCookie().find((c) => c.startsWith('__Host-session='))!;
    expect(session).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    return session.split(';')[0];
  }

  it('signs in with PKCE and state, then knows who is signed in', async () => {
    const start = await login(new Request(`${ORIGIN}/api/auth/login`));
    expect(start.status).toBe(302);
    const location = new URL(start.headers.get('location')!);
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    const cookie = await signedInCookie();
    const who = await (await me(new Request(`${ORIGIN}/api/me`, { headers: { cookie } }))).json();
    expect(who).toMatchObject({ signedIn: true, email: 'new@example.com', allowance: { remaining: 3, limit: 3 } });
    const stored = await db.query<{ refresh_token: string }>(`SELECT refresh_token FROM users WHERE id = 'u2'`);
    expect(stored[0].refresh_token).not.toContain('rt-new');
  });

  it('rejects a callback whose state does not match', async () => {
    const response = await callback(new Request(`${ORIGIN}/api/auth/callback?code=c&state=forged`, { headers: { cookie: '__Host-oauth=real.verifier' } }));
    expect(response.headers.get('location')).toBe('/#/settings?google=failed');
    expect(await db.query(`SELECT 1 FROM sessions`)).toEqual([]);
  });

  it('refuses sync requests from other sites, without a session or with a bad time zone', async () => {
    const cookie = await signedInCookie();
    const post = (headers: Record<string, string>, body: unknown) => sync(new Request(`${ORIGIN}/api/sync`, { method: 'POST', headers, body: JSON.stringify(body) }));
    expect((await post({ cookie, origin: 'https://evil.example' }, { timezone: TZ })).status).toBe(403);
    expect((await post({ cookie }, { timezone: TZ })).status).toBe(403);
    expect((await post({ origin: ORIGIN }, { timezone: TZ })).status).toBe(401);
    expect((await post({ cookie, origin: ORIGIN }, { timezone: 'Mars/Olympus' })).status).toBe(400);
    const ok = await post({ cookie, origin: ORIGIN }, { timezone: TZ });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { batch: { counts: { new: number } } }).batch.counts.new).toBe(3);
  });

  it('deletes the account and everything stored with it', async () => {
    const cookie = await signedInCookie();
    await sync(new Request(`${ORIGIN}/api/sync`, { method: 'POST', headers: { cookie, origin: ORIGIN }, body: JSON.stringify({ timezone: TZ }) }));
    const response = await deleteAccount(new Request(`${ORIGIN}/api/account`, { method: 'DELETE', headers: { cookie, origin: ORIGIN } }));
    expect(response.status).toBe(204);
    for (const table of ['sessions', 'sync_runs', 'source_records']) {
      expect(await db.query(`SELECT 1 FROM ${table} WHERE user_id = 'u2'`)).toEqual([]);
    }
    expect(await db.query(`SELECT 1 FROM users WHERE id = 'u2'`)).toEqual([]);
  });

  it('says plainly when the server is not set up', async () => {
    setTestContext(null);
    const saved = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    const response = await me(new Request(`${ORIGIN}/api/me`));
    if (saved !== undefined) process.env.GOOGLE_CLIENT_ID = saved;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'not_configured' });
  });
});
