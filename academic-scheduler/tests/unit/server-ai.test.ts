// AI analysis on a real Postgres (PGlite) with a fake provider: output
// checks (invented quotes, unknown work, implausible dates are dropped),
// caching by content (unchanged sources never reach the AI again), the daily
// budget, failures that are retried later, decisions that hide proposals, the
// Anthropic client's structured output and retries, and the routes.
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, type Db } from '../../server/db';
import { setTestContext, type Context } from '../../server/context';
import { AiError, type AiProvider, type StructuredRequest } from '../../server/ai/provider';
import { anthropicProvider } from '../../server/ai/anthropic';
import { checkProposals, type ExtractInput } from '../../server/ai/extract';
import { AI_DAILY_CALLS, analysisStatus, recordDecision, runAnalysis } from '../../server/analysis';
import { cronAnalyze, postReview } from '../../server/aiRoutes';
import type { GoogleApi } from '../../server/google';

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

const INPUT: ExtractInput = {
  today: '2026-10-07',
  timezone: TZ,
  classId: 'gc-class-MTEx',
  className: 'English 10',
  known: [
    { id: 'gc-OTAx', title: 'Othello essay', due: '2026-10-09T23:59:00' },
    { id: 'gc-OTAy', title: 'Vocab quiz', due: '2026-10-12' },
  ],
  sources: [{ kind: 'announcement', id: 'ODAx', text: 'The Othello essay is now due Friday, October 16 at 11:59 PM. Unit 3 quiz on Oct 20!', postedAt: '2026-10-07T08:00:00' }],
};

const proposal = (fields: Record<string, unknown>) => ({ sourceId: 'ODAx', explicit: true, identityConfidence: 'high', valueConfidence: 'high', ...fields });

describe('checking the AI output', () => {
  it('keeps supported proposals with stable keys and drops invented or useless ones', () => {
    const output = {
      proposals: [
        proposal({ kind: 'due_change', assignmentId: 'gc-OTAx', date: '2026-10-16', time: '23:59', excerpt: 'now due Friday, October 16 at 11:59 PM' }),
        proposal({ kind: 'new_assessment', title: 'Unit 3 quiz', assessmentType: 'quiz', date: '2026-10-20', excerpt: 'Unit 3 quiz on Oct 20' }),
        // invented quote
        proposal({ kind: 'due_change', assignmentId: 'gc-OTAy', date: '2026-10-13', excerpt: 'quiz moved to Tuesday' }),
        // unknown work
        proposal({ kind: 'due_change', assignmentId: 'gc-nope', date: '2026-10-16', excerpt: 'Othello essay' }),
        // same as the known due date: nothing changes
        proposal({ kind: 'due_change', assignmentId: 'gc-OTAy', date: '2026-10-12', excerpt: 'Unit 3 quiz' }),
        // implausible date, impossible date, known title, bad minutes, unknown source
        proposal({ kind: 'new_assessment', title: 'Unit 3 quiz', date: '2031-01-01', excerpt: 'Unit 3 quiz' }),
        proposal({ kind: 'new_assessment', title: 'Midterm', date: '2026-02-30', excerpt: 'Unit 3 quiz' }),
        proposal({ kind: 'new_assessment', title: 'vocab QUIZ', date: '2026-10-20', excerpt: 'Unit 3 quiz' }),
        proposal({ kind: 'estimate', assignmentId: 'gc-OTAx', minutes: 99999, excerpt: 'Othello essay' }),
        proposal({ kind: 'due_change', sourceId: 'zzz', assignmentId: 'gc-OTAx', date: '2026-10-16', excerpt: 'Othello essay' }),
      ],
    };
    const { proposals, rejected } = checkProposals(output, INPUT);
    expect(rejected).toBe(8);
    expect(proposals).toEqual([
      expect.objectContaining({ kind: 'due_change', assignmentId: 'gc-OTAx', value: '2026-10-16T23:59:00', classId: 'gc-class-MTEx', explicit: true, source: { kind: 'announcement', id: 'ODAx', postedAt: '2026-10-07T08:00:00' } }),
      expect.objectContaining({ kind: 'new_assessment', title: 'Unit 3 quiz', type: 'quiz', value: '2026-10-20' }),
    ]);
    expect(checkProposals(output, INPUT).proposals[0].key).toBe(proposals[0].key);
    expect(proposals[0].key).toMatch(/^[0-9a-f]{32}$/);
    expect(checkProposals('not an object', INPUT)).toEqual({ proposals: [], rejected: 0 });
  });
});

let pg: PGlite;
let db: Db;
let calls: StructuredRequest[];
let answer: (request: StructuredRequest) => unknown;
let failWith: AiError | null;
let context: Context;

const fakeAi: AiProvider = {
  name: 'fake',
  model: 'fake-model',
  async structured(request) {
    calls.push(request);
    if (failWith) throw failWith;
    return { output: answer(request), model: 'fake-model', usage: { inputTokens: 100, outputTokens: 20 } };
  },
};

async function record(kind: string, sourceId: string, data: Record<string, unknown>, courseId = 'MTEx') {
  await db.query(
    `INSERT INTO source_records (user_id, kind, source_id, course_id, fingerprint, data, state) VALUES ('u1', $1, $2, $3, 'f', $4::jsonb, 'present')
     ON CONFLICT (user_id, kind, source_id) DO UPDATE SET data = EXCLUDED.data`,
    [kind, sourceId, courseId, JSON.stringify(data)],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  db = pgliteDb(pg);
  await migrate(db);
  calls = [];
  failWith = null;
  answer = (request) => {
    const input = JSON.parse(request.input) as { texts: Array<{ id: string; text: string }> };
    const essay = input.texts.find((t) => t.text.includes('now due Friday'));
    return { proposals: essay ? [proposal({ sourceId: essay.id, kind: 'due_change', assignmentId: 'gc-OTAx', date: '2026-10-16', excerpt: 'now due Friday' })] : [] };
  };
  context = { config: { googleClientId: 'c', googleClientSecret: 's', tokenKey: 'k' }, db, google: {} as GoogleApi, ai: fakeAi, cronSecret: 'cron-secret' };
  await db.query(`INSERT INTO users (id, email, timezone) VALUES ('u1', 'student@example.com', $1)`, [TZ]);
  await record('course', 'MTEx', { name: 'English 10' });
  await record('coursework', 'OTAx', { title: 'Othello essay', due: '2026-10-09T23:59:00', description: 'Write four pages.' });
  await record('coursework', 'OTAy', { title: 'Vocab quiz' });
  await record('announcement', 'ODAx', { text: 'The Othello essay is now due Friday.', postedAt: '2026-10-07T08:00:00' });
});

afterEach(async () => {
  setTestContext(null);
  await pg.close();
});

describe('analysis runs', () => {
  it('analyzes new texts once and reuses the result while they are unchanged', async () => {
    const first = await runAnalysis(context, 'u1', TZ, 'user');
    expect(calls).toHaveLength(1);
    // Coursework without instructions never reaches the AI.
    expect(JSON.parse(calls[0].input).texts.map((t: { id: string }) => t.id).sort()).toEqual(['ODAx', 'OTAx']);
    expect(calls[0].system).toContain('Never answer questions, solve problems');
    expect(first.status.proposals).toEqual([expect.objectContaining({ kind: 'due_change', assignmentId: 'gc-OTAx', value: '2026-10-16' })]);
    expect(first.status).toMatchObject({ pending: 0, budget: { used: 1 }, lastRun: { analyzed: 2, reused: 0, failed: 0, trigger: 'user' } });

    const again = await runAnalysis(context, 'u1', TZ, 'user');
    expect(calls).toHaveLength(1);
    expect(again.status.lastRun).toMatchObject({ analyzed: 0, reused: 2 });

    await record('announcement', 'ODAx', { text: 'The Othello essay is now due Friday. Bring a printed copy.', postedAt: '2026-10-07T08:00:00' });
    expect((await analysisStatus(context, 'u1')).pending).toBe(1);
    await runAnalysis(context, 'u1', TZ, 'user');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1].input).texts.map((t: { id: string }) => t.id)).toEqual(['ODAx']);
  });

  it('hides decided proposals; a deferred one comes back after a week', async () => {
    const { status } = await runAnalysis(context, 'u1', TZ, 'user');
    const key = status.proposals[0].key;
    await recordDecision(db, 'u1', key, 'rejected');
    expect((await analysisStatus(context, 'u1')).proposals).toEqual([]);
    await recordDecision(db, 'u1', key, 'deferred');
    expect((await analysisStatus(context, 'u1')).proposals).toEqual([]);
    await db.query(`UPDATE ai_reviews SET decided_at = now() - interval '8 days'`);
    expect((await analysisStatus(context, 'u1')).proposals).toHaveLength(1);
  });

  it('keeps to the daily budget and leaves the rest pending', async () => {
    await db.query(`INSERT INTO ai_runs (user_id, trigger, status, calls) VALUES ('u1', 'user', 'ok', $1)`, [AI_DAILY_CALLS]);
    const outcome = await runAnalysis(context, 'u1', TZ, 'user');
    expect(calls).toHaveLength(0);
    expect(outcome.message).toContain('daily AI budget');
    expect(outcome.status.pending).toBe(2);
  });

  it('does not cache a failed call, so it is retried later', async () => {
    failWith = new AiError('down', 'unavailable', true);
    const outcome = await runAnalysis(context, 'u1', TZ, 'user');
    expect(outcome.message).toContain('could not be used right now');
    expect(outcome.status).toMatchObject({ pending: 2, lastRun: { failed: 2 } });
    failWith = null;
    expect((await runAnalysis(context, 'u1', TZ, 'background')).status.pending).toBe(0);
  });

  it('refuses a second run while one is running, and reports when AI is off', async () => {
    await db.query(`INSERT INTO ai_runs (user_id, trigger, status) VALUES ('u1', 'user', 'running')`);
    expect((await runAnalysis(context, 'u1', TZ, 'user')).kind).toBe('busy');
    expect(await analysisStatus({ ...context, ai: null }, 'u1')).toMatchObject({ configured: false, proposals: [] });
  });
});

describe('the Anthropic client', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('forces the structured tool, reads its input and usage, and retries overload', async () => {
    const sent: RequestInit[] = [];
    let n = 0;
    const provider = anthropicProvider({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5-20251001',
      retryDelaysMs: [0, 0],
      fetch: (async (_url: string, init: RequestInit) => {
        sent.push(init);
        if (n++ === 0) return new Response('{}', { status: 529 });
        return ok({ model: 'claude-haiku-4-5-20251001', content: [{ type: 'tool_use', name: 'record_result', input: { proposals: [] } }], usage: { input_tokens: 12, output_tokens: 3 } });
      }) as unknown as typeof fetch,
    });
    const result = await provider.structured({ task: 't', system: 's', input: 'i', schema: { type: 'object' }, maxOutputTokens: 100 });
    expect(result).toEqual({ output: { proposals: [] }, model: 'claude-haiku-4-5-20251001', usage: { inputTokens: 12, outputTokens: 3 } });
    expect(sent).toHaveLength(2);
    const request = JSON.parse(String(sent[1].body));
    expect(request.tool_choice).toEqual({ type: 'tool', name: 'record_result' });
    expect((sent[1].headers as Record<string, string>)['x-api-key']).toBe('sk-test');
  });

  it('reports a rejected key as a configuration problem and missing output as invalid', async () => {
    const reject = anthropicProvider({ apiKey: 'bad', model: 'm', retryDelaysMs: [], fetch: (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch });
    await expect(reject.structured({ task: 't', system: 's', input: 'i', schema: {}, maxOutputTokens: 1 })).rejects.toMatchObject({ kind: 'config', transient: false });
    const empty = anthropicProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [], fetch: (async () => ok({ content: [{ type: 'text', text: 'hi' }] })) as unknown as typeof fetch });
    await expect(empty.structured({ task: 't', system: 's', input: 'i', schema: {}, maxOutputTokens: 1 })).rejects.toMatchObject({ kind: 'invalid_output' });
  });
});

describe('routes', () => {
  beforeEach(() => setTestContext(context));

  it('refuses cross-site and malformed review decisions', async () => {
    const cross = await postReview(new Request(`${ORIGIN}/api/review`, { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }));
    expect(cross.status).toBe(403);
    const signedOut = await postReview(new Request(`${ORIGIN}/api/review`, { method: 'POST', headers: { origin: ORIGIN }, body: JSON.stringify({ key: 'a'.repeat(32), decision: 'applied' }) }));
    expect(signedOut.status).toBe(401);
  });

  it('runs the daily job only with the cron secret', async () => {
    expect((await cronAnalyze(new Request(`${ORIGIN}/api/cron/analyze`))).status).toBe(401);
    expect((await cronAnalyze(new Request(`${ORIGIN}/api/cron/analyze`, { headers: { authorization: 'Bearer wrong-secret' } }))).status).toBe(401);
    const ok = await cronAnalyze(new Request(`${ORIGIN}/api/cron/analyze`, { headers: { authorization: 'Bearer cron-secret' } }));
    expect(await ok.json()).toEqual({ people: 1 });
    expect(calls).toHaveLength(1);
  });
});
