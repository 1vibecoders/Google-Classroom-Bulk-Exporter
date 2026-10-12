// Calls to this website's own sync backend (server/routes.ts). Without a
// backend (the offline single-file build, a plain static host) every call
// reports `unavailable` and the rest of the website works as before.
import type { ImportBatch, SyncAllowance } from '../../model/importBatch';

export type Account = { signedIn: false } | { signedIn: true; email: string; allowance: SyncAllowance };

export type SyncResult =
  | { ok: true; batch: ImportBatch; allowance: SyncAllowance }
  | { ok: false; code: string; message: string; allowance?: SyncAllowance };

export const LOGIN_URL = '/api/auth/login';

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> } | null> {
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } });
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) return response.status === 204 ? { status: 204, body: {} } : null;
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** null: there is no sync backend here (or it cannot be reached). */
export async function fetchAccount(): Promise<Account | { unavailable: true; message: string } | null> {
  const result = await call('/api/me');
  if (!result) return null;
  if (result.status === 503) return { unavailable: true, message: String(result.body.message ?? 'Sync is not available.') };
  if (result.status !== 200) return null;
  return result.body as unknown as Account;
}

export async function runSync(timezone: string): Promise<SyncResult> {
  const result = await call('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timezone }) });
  if (!result) return { ok: false, code: 'unreachable', message: 'The sync service could not be reached. Check your connection and try again.' };
  if (result.status === 200) return { ok: true, batch: result.body.batch as ImportBatch, allowance: result.body.allowance as SyncAllowance };
  return {
    ok: false,
    code: String(result.body.error ?? 'error'),
    message: String(result.body.message ?? 'The sync failed.'),
    allowance: result.body.allowance as SyncAllowance | undefined,
  };
}

export async function signOut(): Promise<boolean> {
  return (await call('/api/auth/logout', { method: 'POST' }))?.status === 204;
}

export async function deleteAccount(): Promise<boolean> {
  return (await call('/api/account', { method: 'DELETE' }))?.status === 204;
}
