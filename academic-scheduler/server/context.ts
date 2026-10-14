// What every API route needs: configuration from the environment, the
// database and the Google client. Created once per server instance; tests
// replace it with setTestContext().
import { migrate, neonDb, type Db } from './db.js';
import { googleApi, type GoogleApi } from './google.js';
import { providerFromEnv, type AiProvider } from './ai/provider.js';

export interface Config {
  googleClientId: string;
  googleClientSecret: string;
  /** 32 random bytes, base64 (`openssl rand -base64 32`). */
  tokenKey: string;
}

export interface Context {
  config: Config;
  db: Db;
  google: GoogleApi;
  /** Null when AI analysis is not set up (no ANTHROPIC_API_KEY or GEMINI_API_KEY). */
  ai: AiProvider | null;
  /** Vercel sends it as a bearer token to the daily job (CRON_SECRET); unset means no background job. */
  cronSecret?: string;
}

/** Thrown when the deployment lacks a required environment variable. */
export class NotConfiguredError extends Error {}

let current: Promise<Context> | null = null;

export function setTestContext(context: Context | null): void {
  current = context ? Promise.resolve(context) : null;
}

export function getContext(): Promise<Context> {
  if (!current) {
    const env = process.env;
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'DATABASE_URL'].filter((name) => !env[name]);
    if (missing.length) return Promise.reject(new NotConfiguredError(`Missing environment variables: ${missing.join(', ')}`));
    const config: Config = { googleClientId: env.GOOGLE_CLIENT_ID!, googleClientSecret: env.GOOGLE_CLIENT_SECRET!, tokenKey: env.TOKEN_ENCRYPTION_KEY! };
    const db = neonDb(env.DATABASE_URL!);
    current = migrate(db).then(() => ({
      config,
      db,
      google: googleApi({ clientId: config.googleClientId, clientSecret: config.googleClientSecret }),
      ai: providerFromEnv(env),
      cronSecret: env.CRON_SECRET || undefined,
    }));
    // A failed start (e.g. the database is down) is retried on the next request.
    current.catch(() => {
      current = null;
    });
  }
  return current;
}
