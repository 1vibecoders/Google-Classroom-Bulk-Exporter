// The AI provider interface (SPEC.md § 15). One narrow call: structured
// output that must match a JSON schema, with usage accounting, so the
// analysis (server/analysis.ts) does not depend on one provider or model.
//
// Configured on the server only (never in the browser or the extension):
//   ANTHROPIC_API_KEY  turns AI analysis on with Anthropic; without a key the
//                      website works as before
//   GEMINI_API_KEY     turns it on with Google Gemini (free tier) when there is
//                      no ANTHROPIC_API_KEY
//   AI_PROVIDER        optional, `anthropic` or `gemini`: which key to use when both are set
//   AI_MODEL           optional; defaults: claude-haiku-4-5-20251001 (the
//                      lowest-cost Claude model, § 15) and gemini-3.8-flash
//                      (a free-tier Flash model)
//   AI_FALLBACK_MODEL  optional, Gemini only: the model tried when the main one
//                      stays overloaded or rate-limited; default
//                      gemini-3.5-flash-lite (free tier, lighter); empty for none
// Output is never trusted because it parses: the caller validates every field.
import { anthropicProvider } from './anthropic.js';
import { geminiProvider } from './gemini.js';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';
export const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

export interface StructuredRequest {
  /** Short name of the task, for logs (never content). */
  task: string;
  system: string;
  input: string;
  /** JSON schema of the output object. */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
}

export interface StructuredResult {
  output: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AiProvider {
  name: string;
  model: string;
  structured(request: StructuredRequest): Promise<StructuredResult>;
}

export type AiErrorKind = 'rate_limit' | 'unavailable' | 'refused' | 'invalid_output' | 'config';

/** A failed AI call. `transient` errors may succeed later. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

/** The configured provider, or null when AI analysis is off. */
export function providerFromEnv(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): AiProvider | null {
  const choice = env.AI_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'gemini');
  if (choice === 'anthropic') {
    return env.ANTHROPIC_API_KEY ? anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || DEFAULT_MODEL, fetch: fetchImpl }) : null;
  }
  if (choice === 'gemini') {
    if (!env.GEMINI_API_KEY) return null;
    // An empty AI_FALLBACK_MODEL turns the fallback off.
    const fallbackModel = (env.AI_FALLBACK_MODEL ?? GEMINI_FALLBACK_MODEL) || undefined;
    return geminiProvider({ apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL || GEMINI_DEFAULT_MODEL, fallbackModel, fetch: fetchImpl });
  }
  console.error('AI_PROVIDER must be "anthropic" or "gemini"; AI analysis is off.');
  return null;
}
