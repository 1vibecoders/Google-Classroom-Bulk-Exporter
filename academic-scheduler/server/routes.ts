// The API routes (deployed as Vercel Functions by the files in api/).
//   GET    /api/auth/login     → Google sign-in (PKCE + state in a short-lived cookie)
//   GET    /api/auth/callback  ← Google; creates the session, back to Settings
//   POST   /api/auth/logout
//   GET    /api/me             who is signed in, and the sync allowance
//   POST   /api/sync           run a sync → { batch, allowance }
//   GET    /api/account        download everything stored about the account
//   DELETE /api/account        revoke Google access and delete everything
// Requests that change something must come from this site (Origin check);
// cookies are HttpOnly, Secure, SameSite=Lax.
import { encrypt, decrypt, randomToken, sha256 } from './crypto.js';
import { GoogleError, identityFromIdToken } from './google.js';
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  cookie,
  createSession,
  endSession,
  error,
  isSameOrigin,
  json,
  readCookie,
  redirect,
  sessionUser,
  withContext,
} from './http.js';
import { allowance, isTimeZone, runSync } from './sync.js';

const settingsPage = (result: string) => `/#/settings?google=${result}`;

export function login(request: Request): Promise<Response> {
  return withContext(async ({ google, config }) => {
    const state = randomToken(16);
    const verifier = randomToken(48);
    const url = google.authUrl({
      clientId: config.googleClientId,
      redirectUri: `${new URL(request.url).origin}/api/auth/callback`,
      state,
      codeChallenge: sha256(verifier),
    });
    return redirect(url, [cookie(OAUTH_COOKIE, `${state}.${verifier}`, 600)]);
  });
}

export function callback(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const params = new URL(request.url).searchParams;
    const clear = cookie(OAUTH_COOKIE, '', 0);
    if (params.get('error')) return redirect(settingsPage('denied'), [clear]);
    const [state, verifier] = (readCookie(request, OAUTH_COOKIE) ?? '').split('.');
    const code = params.get('code');
    if (!state || !verifier || !code || params.get('state') !== state) return redirect(settingsPage('failed'), [clear]);
    try {
      const tokens = await context.google.exchangeCode(code, verifier, `${new URL(request.url).origin}/api/auth/callback`);
      const who = identityFromIdToken(tokens.idToken ?? '', context.config.googleClientId);
      const sealed = tokens.refreshToken ? encrypt(tokens.refreshToken, context.config.tokenKey) : null;
      await context.db.query(
        `INSERT INTO users (id, email, refresh_token, scopes) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, scopes = EXCLUDED.scopes,
           refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token)`,
        [who.sub, who.email, sealed, tokens.scope],
      );
      return redirect(settingsPage('connected'), [clear, await createSession(context, who.sub)]);
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err;
      return redirect(settingsPage('failed'), [clear]);
    }
  });
}

export function logout(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => new Response(null, { status: 204, headers: { 'set-cookie': await endSession(context, request) } }));
}

export function me(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return json({ signedIn: false });
    return json({ signedIn: true, email: user.email, allowance: await allowance(context.db, user.id) });
  });
}

export function sync(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    let body: { timezone?: unknown } = {};
    try {
      body = (await request.json()) as { timezone?: unknown };
    } catch {
      /* checked below */
    }
    if (!isTimeZone(body.timezone)) return error(400, 'bad_timezone', 'The request did not include a valid time zone.');
    const outcome = await runSync(context, user, body.timezone);
    switch (outcome.kind) {
      case 'ok':
        return json({ batch: outcome.batch, allowance: outcome.allowance });
      case 'limited':
        return error(429, 'limit', 'You have used all 3 syncs of the last 24 hours.', { allowance: outcome.allowance });
      case 'busy':
        return error(409, 'running', 'A sync is already running.', { allowance: outcome.allowance });
      case 'reauth':
        return error(401, 'reauth', outcome.message, { allowance: outcome.allowance });
      case 'blocked':
        return error(403, 'blocked', outcome.message, { allowance: outcome.allowance });
      case 'failed':
        return error(502, 'google_failed', outcome.message, { allowance: outcome.allowance });
    }
  });
}

export function exportAccount(request: Request): Promise<Response> {
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    const [syncs, records] = await Promise.all([
      context.db.query('SELECT started_at, finished_at, status, counted, summary FROM sync_runs WHERE user_id = $1 ORDER BY started_at', [user.id]),
      context.db.query('SELECT kind, source_id, course_id, state, data, first_seen, last_seen, changed_at FROM source_records WHERE user_id = $1 ORDER BY kind, source_id', [user.id]),
    ]);
    return json({ email: user.email, scopes: user.scopes.split(/\s+/), syncs, classroomRecords: records }, 200, {
      'content-disposition': 'attachment; filename="academic-scheduler-account.json"',
    });
  });
}

export function deleteAccount(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Promise.resolve(error(403, 'cross_origin', 'Request refused.'));
  return withContext(async (context) => {
    const user = await sessionUser(context, request);
    if (!user) return error(401, 'signed_out', 'Sign in with Google first.');
    if (user.refreshToken) {
      try {
        await context.google.revoke(decrypt(user.refreshToken, context.config.tokenKey));
      } catch {
        /* already revoked or unreachable: the data is deleted anyway */
      }
    }
    // Sessions, sync runs and Classroom records go with the user (ON DELETE CASCADE).
    await context.db.query('DELETE FROM users WHERE id = $1', [user.id]);
    return new Response(null, { status: 204, headers: { 'set-cookie': cookie(SESSION_COOKIE, '', 0) } });
  });
}
