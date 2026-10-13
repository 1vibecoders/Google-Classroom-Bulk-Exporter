// The AI provider interface (SPEC.md § 15). One narrow call: structured
// output that must match a JSON schema, with usage accounting, so the
// analysis (server/analysis.ts) does not depend on one provider or model.
//
// Configured on the server only (never in the browser or the extension):
//   ANTHROPIC_API_KEY  turns AI analysis on; without it the website works as before
//   AI_MODEL           optional; default claude-haiku-4-5-20251001, the
//                      lowest-cost Claude model (§ 15: lowest-cost suitable model)
// Output is never trusted because it parses: the caller validates every field.
import { anthropicProvider } from './anthropic.js';

export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

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
  if (!env.ANTHROPIC_API_KEY) return null;
  return anthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.AI_MODEL || DEFAULT_MODEL, fetch: fetchImpl });
}
