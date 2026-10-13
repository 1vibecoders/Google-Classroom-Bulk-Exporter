// AI analysis of the knowledge base (SPEC.md § 16–18), separate from syncing:
// a sync stores what Classroom says; an analysis reads the stored
// announcements, coursework texts and course documents that are new or changed
// since they were last analyzed and asks the AI for scheduling proposals.
// shortcut: only the first DOCUMENT_AI_CHARS of a document reach the AI; split long documents into parts if dates late in long readers are missed.
//
// Cost controls (§ 18.1): a source is analyzed again only when the text sent
// to the AI, the task version or the model changes (ai_extractions); sources
// without text never reach the AI; one call covers up to MAX_SOURCES_PER_CALL
// texts of one class; at most AI_DAILY_CALLS calls per person per rolling 24
// hours, shared by runs the person starts and the daily background job; at
// most MAX_CALLS_PER_RUN per run. Usage is logged as the provider reports it.
// Proposals the person decided (ai_reviews) are not returned again.
import { createHash } from 'node:crypto';
import type { AiProposal, AnalysisStatus } from '../src/model/aiProposal.js';
import { AiError } from './ai/provider.js';
import { EXTRACT_TASK_VERSION, SCHEMA, SYSTEM, checkProposals, promptInput, type ExtractInput, type KnownWork, type SourceText } from './ai/extract.js';
import type { Context } from './context.js';
import type { Db } from './db.js';
import { localNow } from './sync.js';

export const AI_DAILY_CALLS = 20;
export const MAX_CALLS_PER_RUN = 8;
const MAX_SOURCES_PER_CALL = 12;
const MAX_CHARS_PER_CALL = 24000;
const RUNNING_MINUTES = 5;
const DOCUMENT_AI_CHARS = 20000;

type Trigger = 'user' | 'background';

type Record_ = {
  kind: string;
  source_id: string;
  course_id: string;
  data: Record<string, unknown>;
};

type Extraction = {
  kind: string;
  source_id: string;
  content_hash: string;
  task_version: string;
  model: string;
  proposals: AiProposal[];
};

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The text of a source as the AI sees it; null when there is nothing to analyze. */
export function sourceText(record: Record_): SourceText | null {
  const d = record.data;
  if (record.kind === 'announcement') {
    const text = str(d.text);
    return text ? { kind: 'announcement', id: record.source_id, text, url: str(d.url), postedAt: str(d.postedAt) } : null;
  }
  if (record.kind === 'coursework') {
    const description = str(d.description);
    return description ? { kind: 'coursework', id: record.source_id, title: str(d.title), text: description, url: str(d.url) } : null;
  }
  if (record.kind === 'document') {
    const text = str(d.text);
    if (!text || d.status !== 'ok') return null;
    const parents = Array.isArray(d.parents) ? (d.parents as Array<{ kind?: unknown; sourceId?: unknown }>) : [];
    const attachedTo = parents.filter((p) => p.kind === 'coursework' && typeof p.sourceId === 'string').map((p) => `gc-${p.sourceId}`);
    return {
      kind: 'document',
      id: record.source_id,
      title: str(d.title),
      text: Array.from(text).slice(0, DOCUMENT_AI_CHARS).join(''),
      url: str(d.url),
      ...(attachedTo.length ? { attachedTo } : {}),
    };
  }
  return null;
}

const hashOf = (s: SourceText) => createHash('sha256').update(JSON.stringify([s.title ?? '', s.text, s.postedAt ?? '', s.attachedTo ?? []])).digest('hex');

async function load(db: Db, userId: string) {
  const [records, extractions] = await Promise.all([
    db.query<Record_ & { state: string }>(
      `SELECT kind, source_id, course_id, data, state FROM source_records WHERE user_id = $1 AND kind IN ('course', 'coursework', 'announcement', 'document') AND state = 'present'`,
      [userId],
    ),
    db.query<Extraction>('SELECT kind, source_id, content_hash, task_version, model, proposals FROM ai_extractions WHERE user_id = $1', [userId]),
  ]);
  return { records, cache: new Map(extractions.map((e) => [`${e.kind}:${e.source_id}`, e])) };
}

function isCurrent(e: Extraction | undefined, hash: string, model: string): boolean {
  return !!e && e.content_hash === hash && e.task_version === EXTRACT_TASK_VERSION && e.model === model;
}

async function callsUsed(db: Db, userId: string): Promise<number> {
  const rows = await db.query<{ used: number | string }>(`SELECT coalesce(sum(calls), 0) AS used FROM ai_runs WHERE user_id = $1 AND started_at > now() - interval '24 hours'`, [userId]);
  return Number(rows[0]?.used ?? 0);
}

/** What the website shows: current proposals (not decided, from unchanged sources), pending work, budget, last run. */
export async function analysisStatus(context: Context, userId: string): Promise<AnalysisStatus> {
  const { db, ai } = context;
  if (!ai) return { configured: false, proposals: [], pending: 0, budget: { limit: AI_DAILY_CALLS, used: 0 } };
  const [{ records, cache }, used, decided, runs] = await Promise.all([
    load(db, userId),
    callsUsed(db, userId),
    db.query<{ key: string; decision: string; decided_at: unknown }>('SELECT key, decision, decided_at FROM ai_reviews WHERE user_id = $1', [userId]),
    db.query<{ started_at: unknown; analyzed: number; reused: number; failed: number; trigger: Trigger }>(
      `SELECT started_at, analyzed, reused, failed, trigger FROM ai_runs WHERE user_id = $1 AND status <> 'running' ORDER BY started_at DESC LIMIT 1`,
      [userId],
    ),
  ]);
  // A deferred proposal comes back after a week.
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const hidden = new Set(decided.filter((d) => d.decision !== 'deferred' || new Date(String(d.decided_at)).getTime() > weekAgo).map((d) => d.key));
  const proposals: AiProposal[] = [];
  let pending = 0;
  for (const record of records) {
    const text = sourceText(record);
    if (!text) continue;
    const cached = cache.get(`${record.kind}:${record.source_id}`);
    if (!isCurrent(cached, hashOf(text), ai.model)) {
      pending++;
      continue;
    }
    for (const p of cached!.proposals) if (!hidden.has(p.key)) proposals.push(p);
  }
  const last = runs[0];
  return {
    configured: true,
    model: ai.model,
    proposals,
    pending,
    budget: { limit: AI_DAILY_CALLS, used },
    ...(last ? { lastRun: { at: new Date(String(last.started_at)).toISOString(), analyzed: last.analyzed, reused: last.reused, failed: last.failed, trigger: last.trigger } } : {}),
  };
}

export type AnalysisOutcome = { kind: 'ok' | 'busy' | 'off'; status: AnalysisStatus; message?: string };

/** Analyze what is pending, within the budget. */
export async function runAnalysis(context: Context, userId: string, timezone: string, trigger: Trigger): Promise<AnalysisOutcome> {
  const { db, ai } = context;
  if (!ai) return { kind: 'off', status: await analysisStatus(context, userId) };
  const reserved = await db.query<{ id: number | string }>(
    `INSERT INTO ai_runs (user_id, trigger, status)
     SELECT $1, $2, 'running'
     WHERE NOT EXISTS (SELECT 1 FROM ai_runs WHERE user_id = $1 AND status = 'running' AND started_at > now() - interval '${RUNNING_MINUTES} minutes')
     RETURNING id`,
    [userId, trigger],
  );
  if (!reserved[0]) return { kind: 'busy', status: await analysisStatus(context, userId), message: 'An analysis is already running.' };
  const runId = Number(reserved[0].id);
  const tally = { calls: 0, inputTokens: 0, outputTokens: 0, analyzed: 0, reused: 0, failed: 0, rejected: 0 };
  let message: string | undefined;
  let status = 'ok';
  try {
    const { records, cache } = await load(db, userId);
    const today = localNow(timezone).slice(0, 10);
    const classNames = new Map(records.filter((r) => r.kind === 'course').map((r) => [r.source_id, str(r.data.name) ?? 'Class']));
    const known = new Map<string, KnownWork[]>();
    for (const r of records) {
      if (r.kind !== 'coursework') continue;
      const list = known.get(r.course_id) ?? [];
      list.push({ id: `gc-${r.source_id}`, title: str(r.data.title) ?? 'Untitled', ...(str(r.data.due) ? { due: str(r.data.due) } : {}) });
      known.set(r.course_id, list);
    }
    // Pending sources grouped by class, newest first, in calls of bounded size.
    const byCourse = new Map<string, Array<{ record: Record_; text: SourceText; hash: string }>>();
    for (const record of records) {
      const text = sourceText(record);
      if (!text) continue;
      const hash = hashOf(text);
      if (isCurrent(cache.get(`${record.kind}:${record.source_id}`), hash, ai.model)) {
        tally.reused++;
        continue;
      }
      const list = byCourse.get(record.course_id) ?? [];
      list.push({ record, text, hash });
      byCourse.set(record.course_id, list);
    }
    let used = await callsUsed(db, userId);
    outer: for (const [courseId, items] of byCourse) {
      items.sort((a, b) => (b.text.postedAt ?? '').localeCompare(a.text.postedAt ?? ''));
      for (let i = 0; i < items.length; ) {
        if (used >= AI_DAILY_CALLS || tally.calls >= MAX_CALLS_PER_RUN) {
          message = used >= AI_DAILY_CALLS ? 'The daily AI budget is used up; the rest is analyzed later.' : undefined;
          break outer;
        }
        const chunk: typeof items = [];
        let chars = 0;
        while (i < items.length && chunk.length < MAX_SOURCES_PER_CALL && (chunk.length === 0 || chars + items[i].text.text.length <= MAX_CHARS_PER_CALL)) {
          chars += items[i].text.text.length;
          chunk.push(items[i++]);
        }
        const input: ExtractInput = {
          today,
          timezone,
          classId: `gc-class-${courseId}`,
          className: classNames.get(courseId) ?? 'Class',
          known: known.get(courseId) ?? [],
          sources: chunk.map((c) => ({ ...c.text, text: Array.from(c.text.text).slice(0, MAX_CHARS_PER_CALL).join('') })),
        };
        tally.calls++;
        used++;
        try {
          const result = await ai.structured({ task: 'extract', system: SYSTEM, input: promptInput(input), schema: SCHEMA, maxOutputTokens: 2000 });
          tally.inputTokens += result.usage.inputTokens;
          tally.outputTokens += result.usage.outputTokens;
          const { proposals, rejected } = checkProposals(result.output, input);
          tally.rejected += rejected;
          const rows = chunk.map((c) => ({
            kind: c.record.kind,
            source_id: c.record.source_id,
            course_id: courseId,
            content_hash: c.hash,
            proposals: proposals.filter((p) => p.source.id === c.record.source_id),
          }));
          await db.query(
            `INSERT INTO ai_extractions (user_id, kind, source_id, course_id, content_hash, task_version, model, proposals)
             SELECT $1, r.kind, r.source_id, r.course_id, r.content_hash, $2, $3, r.proposals
             FROM jsonb_to_recordset($4::jsonb) AS r(kind text, source_id text, course_id text, content_hash text, proposals jsonb)
             ON CONFLICT (user_id, kind, source_id) DO UPDATE SET course_id = EXCLUDED.course_id, content_hash = EXCLUDED.content_hash,
               task_version = EXCLUDED.task_version, model = EXCLUDED.model, proposals = EXCLUDED.proposals, created_at = now()`,
            [userId, EXTRACT_TASK_VERSION, ai.model, JSON.stringify(rows)],
          );
          tally.analyzed += chunk.length;
        } catch (err) {
          if (!(err instanceof AiError)) throw err;
          tally.failed += chunk.length;
          status = 'partial';
          message = err.kind === 'config' ? 'AI analysis is not set up correctly on the server.' : 'The AI service could not be used right now; the rest is analyzed later.';
          console.error(JSON.stringify({ event: 'ai_failed', run: runId, kind: err.kind }));
          break outer;
        }
      }
    }
  } catch (err) {
    status = 'failed';
    throw err;
  } finally {
    await db.query(
      `UPDATE ai_runs SET status = $2, calls = $3, input_tokens = $4, output_tokens = $5, analyzed = $6, reused = $7, failed = $8, rejected = $9 WHERE id = $1`,
      [runId, status, tally.calls, tally.inputTokens, tally.outputTokens, tally.analyzed, tally.reused, tally.failed, tally.rejected],
    );
    console.log(JSON.stringify({ event: 'ai_run', run: runId, trigger, status, ...tally }));
  }
  return { kind: 'ok', status: await analysisStatus(context, userId), ...(message ? { message } : {}) };
}

export const DECISIONS = ['applied', 'rejected', 'deferred'] as const;
export type Decision = (typeof DECISIONS)[number];

export async function recordDecision(db: Db, userId: string, key: string, decision: Decision): Promise<void> {
  await db.query(
    `INSERT INTO ai_reviews (user_id, key, decision) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO UPDATE SET decision = EXCLUDED.decision, decided_at = now()`,
    [userId, key, decision],
  );
}

/** The daily background job: people with sources that were never analyzed, within their budget. */
export async function backgroundAnalysis(context: Context, maxPeople = 20): Promise<{ people: number }> {
  if (!context.ai) return { people: 0 };
  const people = await context.db.query<{ user_id: string; timezone: string | null }>(
    `SELECT DISTINCT r.user_id, u.timezone FROM source_records r JOIN users u ON u.id = r.user_id
     WHERE r.kind IN ('announcement', 'coursework', 'document') AND r.state = 'present' AND u.timezone IS NOT NULL
       AND (r.kind = 'announcement' OR coalesce(r.data->>'description', '') <> '')
       AND NOT EXISTS (SELECT 1 FROM ai_extractions e WHERE e.user_id = r.user_id AND e.kind = r.kind AND e.source_id = r.source_id AND e.task_version = $1 AND e.model = $2)
     LIMIT $3`,
    [EXTRACT_TASK_VERSION, context.ai.model, maxPeople],
  );
  for (const p of people) await runAnalysis(context, p.user_id, p.timezone!, 'background');
  return { people: people.length };
}
