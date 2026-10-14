// AI analysis routes (deployed by the files in api/).
//   GET  /api/analysis          proposals, pending work, budget, last run (no AI call)
//   POST /api/analysis          analyze what is pending → the same status
//                               { timezone, setup?: true, commitments?: string, sources?: {...} } (setup: the free first run
//                               after onboarding; commitments: the person's description, read into events;
//                               sources: imported classes, work and announcements, see uploadedSources.ts)
//   POST /api/review            record a decision on a proposal { key, decision }
//   GET  /api/cron/analyze      the daily background job (Vercel Cron, bearer CRON_SECRET)
import { timingSafeEqual } from 'node:crypto';
import { DECISIONS, analysisStatus, backgroundAnalysis, recordDecision, runAnalysis, type Decision } from './analysis.js';
import { error, isSameOrigin, json, sessionUser, withContext } from './http.js';
import { MAX_COMMITMENTS_TEXT } from './ai/commitments.js';
import { isTimeZone } from './sync.js';
import { storeUploadedSources, uploadedSources } from './uploadedSources.js';

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = (await request.json()) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function getAnalysis(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    return json(await analysisStatus(context, user.id));
  });
}

export function postAnalysis(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    const { timezone, setup, commitments, sources } = await body(request);
    if (!isTimeZone(timezone)) return error(400, 'bad_timezone', 'The request did not include a valid time zone.');
    if (commitments !== undefined && (typeof commitments !== 'string' || commitments.length > MAX_COMMITMENTS_TEXT)) {
      return error(400, 'bad_commitments', 'The description of your commitments could not be read.');
    }
    const uploaded = sources === undefined ? [] : uploadedSources(sources);
    if (!uploaded) return error(400, 'bad_sources', 'The imported classes could not be read.');
    if (!context.ai) return error(503, 'ai_off', 'AI analysis is not set up on this server.');
    await context.db.query('UPDATE users SET timezone = $2 WHERE id = $1', [user.id, timezone]);
    await storeUploadedSources(context.db, user.id, uploaded);
    const outcome = await runAnalysis(context, user.id, timezone, setup === true ? 'setup' : 'user', commitments as string | undefined);
    return json({
      ...outcome.status,
      ...(outcome.message ? { message: outcome.message } : {}),
      ...(outcome.kind === 'busy' ? { busy: true } : {}),
      ...(outcome.kind === 'limited' ? { limited: true } : {}),
      ...(outcome.commitments ? { commitments: outcome.commitments } : {}),
    });
  });
}

export function postReview(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    const { key, decision } = await body(request);
    if (typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(key) || !DECISIONS.includes(decision as Decision)) {
      return error(400, 'bad_review', 'The decision could not be read.');
    }
    await recordDecision(context.db, user.id, key, decision as Decision);
    return new Response(null, { status: 204 });
  });
}

export function cronAnalyze(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const given = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${context.cronSecret ?? ''}`);
    if (!context.cronSecret || given.length !== expected.length || !timingSafeEqual(given, expected)) return error(401, 'unauthorized', 'Refused.');
    return json(await backgroundAnalysis(context));
  });
}
