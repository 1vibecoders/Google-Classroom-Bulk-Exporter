// Responses, cookies, sessions and request checks shared by the API routes.
import { randomToken, sha256 } from './crypto.js';
import { getContext, NotConfiguredError, type Context } from './context.js';

export const SESSION_COOKIE = '__Host-session';
export const OAUTH_COOKIE = '__Host-oauth';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  scopes: string;
  refreshToken: string | null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}

export function error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, message, ...extra }, status);
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

/**
 * Requests that change something must come from this website's own pages:
 * the Origin header (sent by browsers on POST/DELETE) must match.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return origin !== null && origin === new URL(request.url).origin;
}

/** Runs a route with the context; turns missing configuration and unexpected errors into JSON errors. */
export async function withContext(run: (context: Context) => Promise<Response>): Promise<Response> {
  let context: Context;
  try {
    context = await getContext();
  } catch (err) {
    if (err instanceof NotConfiguredError) return error(503, 'not_configured', 'Google Classroom sync is not set up on this server.');
    console.error(JSON.stringify({ event: 'context_failed', message: String(err) }));
    return error(503, 'unavailable', 'The sync service is not available right now. Try again later.');
  }
  try {
    return await run(context);
  } catch (err) {
    // Log the error kind only: never request bodies, tokens or Classroom content.
    console.error(JSON.stringify({ event: 'route_failed', name: err instanceof Error ? err.name : 'unknown' }));
    return error(500, 'server_error', 'Something went wrong on the server. Try again later.');
  }
}

export async function createSession(context: Context, userId: string): Promise<string> {
  const token = randomToken();
  await context.db.query(`INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 24 * 3600);
}

export async function sessionUser(context: Context, request: Request): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const rows = await context.db.query<{ id: string; email: string; scopes: string; refresh_token: string | null }>(
    `SELECT u.id, u.email, u.scopes, u.refresh_token FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, scopes: row.scopes, refreshToken: row.refresh_token } : null;
}

export async function endSession(context: Context, request: Request): Promise<string> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await context.db.query('DELETE FROM sessions WHERE id = $1', [sha256(token)]);
  return cookie(SESSION_COOKIE, '', 0);
}
