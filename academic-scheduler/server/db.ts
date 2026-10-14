// Postgres access for the sync backend. Production uses Neon over HTTP (Vercel
// Postgres); tests run the same SQL on PGlite (tests/unit/server-helpers.ts).
// Every row belongs to one Google account (users.id = Google "sub") and is
// deleted with it (ON DELETE CASCADE), so "delete my data" is one statement.
import { neon } from '@neondatabase/serverless';

export type Row = Record<string, unknown>;

export interface Statement {
  text: string;
  params?: unknown[];
}

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs the statements in one transaction; returns each statement's rows. */
  transaction(statements: Statement[]): Promise<Row[][]>;
}

export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    email text NOT NULL,
    refresh_token text,
    scopes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL,
    counted boolean NOT NULL,
    summary jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS sync_runs_user_started ON sync_runs (user_id, started_at)`,
  // The per-user course knowledge base (SPEC.md § 14), first part: every
  // Classroom course and coursework item seen, its normalized source data, a
  // content fingerprint and whether the source still lists it.
  `CREATE TABLE IF NOT EXISTS source_records (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    source_id text NOT NULL,
    course_id text NOT NULL,
    fingerprint text NOT NULL,
    data jsonb NOT NULL,
    state text NOT NULL,
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    changed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, source_id)
  )`,
  // The person's time zone, for background analysis (relative dates in announcements).
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text`,
  // AI analysis (SPEC.md § 16, § 18): the cached result per source, keyed by a
  // hash of the text that was analyzed, the task version and the model, so a
  // source is analyzed again only when one of them changes.
  `CREATE TABLE IF NOT EXISTS ai_extractions (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL,
    source_id text NOT NULL,
    course_id text NOT NULL,
    content_hash text NOT NULL,
    task_version text NOT NULL,
    model text NOT NULL,
    proposals jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, kind, source_id)
  )`,
  // Each analysis run: what it cost (calls, tokens as reported by the provider) and did.
  `CREATE TABLE IF NOT EXISTS ai_runs (
    id bigserial PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at timestamptz NOT NULL DEFAULT now(),
    trigger text NOT NULL,
    status text NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    input_tokens integer NOT NULL DEFAULT 0,
    output_tokens integer NOT NULL DEFAULT 0,
    analyzed integer NOT NULL DEFAULT 0,
    reused integer NOT NULL DEFAULT 0,
    failed integer NOT NULL DEFAULT 0,
    rejected integer NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS ai_runs_user_started ON ai_runs (user_id, started_at)`,
  // Runs the person started that used the AI count toward RUN_LIMIT (server/analysis.ts).
  `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS counted boolean NOT NULL DEFAULT false`,
  // Why the run's AI requests failed (fixed messages plus the provider's error text; never a key).
  `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS error text`,
  // The model(s) that answered, as the provider reported them (a fallback model shows up here).
  `ALTER TABLE ai_runs ADD COLUMN IF NOT EXISTS models text`,
  // The person's decisions on proposals (§ 16.4), so a decided proposal does not come back.
  `CREATE TABLE IF NOT EXISTS ai_reviews (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key text NOT NULL,
    decision text NOT NULL,
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
  )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const statement of SCHEMA) await db.query(statement);
}

export function neonDb(url: string): Db {
  const sql = neon(url);
  return {
    query: async <T extends Row>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
    transaction: async (statements) => (await sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? [])))) as Row[][],
  };
}
