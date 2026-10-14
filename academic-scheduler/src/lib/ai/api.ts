// Calls to this website's AI analysis routes (server/aiRoutes.ts). Without a
// backend, signed out, or with AI not set up, `getAnalysis` returns null and
// the rest of the website works as before.
import type { AnalysisStatus, CommitmentsResult } from '../../model/aiProposal';

export type Decision = 'applied' | 'rejected' | 'deferred';

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
    if (response.status === 204) return { status: 204, body: {} };
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return null;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function getAnalysis(): Promise<AnalysisStatus | null> {
  const result = await call('/api/analysis');
  return result?.status === 200 ? (result.body as unknown as AnalysisStatus) : null;
}

export type RunResult = AnalysisStatus & { message?: string; busy?: boolean; limited?: boolean; commitments?: CommitmentsResult };

/** `setup`: the free first run after onboarding (used once; later it is an ordinary run). `commitments`: the person's description, read into events. */
export async function runAnalysis(timezone: string, setup = false, commitments?: string): Promise<RunResult | { error: string }> {
  const result = await call('/api/analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timezone, ...(setup ? { setup: true } : {}), ...(commitments?.trim() ? { commitments } : {}) }),
  });
  if (!result) return { error: 'The analysis service could not be reached. Check your connection and try again.' };
  if (result.status === 200) return result.body as unknown as RunResult;
  return { error: String(result.body.message ?? 'The analysis failed.') };
}

export async function recordDecision(key: string, decision: Decision): Promise<boolean> {
  const result = await call('/api/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, decision }) });
  return result?.status === 204;
}
