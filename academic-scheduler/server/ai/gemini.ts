// Google Gemini API (generateContent) with plain fetch. Structured output:
// JSON text constrained by the task's schema (generationConfig.responseFormat).
// Same timeouts, bounded retries and error kinds as anthropic.ts. The API key
// travels only in the x-goog-api-key header; errors carry no request or
// response content.
import { AiError, type AiProvider } from './provider.js';

const URL_MODELS = 'https://generativelanguage.googleapis.com/v1beta/models/';
const TIMEOUT_MS = 60000;
const RETRY_DELAYS_MS = [2000, 8000];
// Thinking tokens count toward maxOutputTokens on Gemini models; this keeps them from truncating the answer.
const THINKING_TOKENS = 8000;

export function geminiProvider(options: { apiKey: string; model: string; fetch?: typeof fetch; retryDelaysMs?: number[] }): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const url = `${URL_MODELS}${encodeURIComponent(options.model)}:generateContent`;
  return {
    name: 'gemini',
    model: options.model,
    async structured(request) {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts: [{ text: request.input }] }],
        generationConfig: {
          maxOutputTokens: request.maxOutputTokens + THINKING_TOKENS,
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: geminiSchema(request.schema) } },
        },
      });
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await doFetch(url, {
            method: 'POST',
            headers: { 'x-goog-api-key': options.apiKey, 'content-type': 'application/json' },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {
          if (attempt < delays.length) {
            await sleep(delays[attempt]);
            continue;
          }
          throw new AiError('The AI service could not be reached.', 'unavailable', true);
        }
        if (response.ok) {
          const data = (await response.json()) as {
            modelVersion?: string;
            promptFeedback?: { blockReason?: string };
            candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
          };
          const candidate = data.candidates?.[0];
          // MAX_TOKENS, SAFETY, RECITATION, PROHIBITED_CONTENT, …: cut short or blocked, so not a usable result.
          if (data.promptFeedback?.blockReason || !candidate || (candidate.finishReason && candidate.finishReason !== 'STOP')) {
            throw new AiError('The AI service returned no complete result.', 'invalid_output', false);
          }
          const text = (candidate.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
          let output: unknown;
          try {
            output = JSON.parse(text);
          } catch {
            output = null;
          }
          if (typeof output !== 'object' || output === null || Array.isArray(output)) {
            throw new AiError('The AI service returned no structured result.', 'invalid_output', false);
          }
          const usage = data.usageMetadata;
          return {
            output,
            model: data.modelVersion ?? options.model,
            // Thinking tokens are billed as output.
            usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0) },
          };
        }
        const status = response.status;
        const retryable = status === 429 || status >= 500;
        if (retryable && attempt < delays.length) {
          const after = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : delays[attempt]);
          continue;
        }
        if (status === 429) throw new AiError('The AI service is rate-limiting requests.', 'rate_limit', true);
        if (retryable) throw new AiError('The AI service is unavailable right now.', 'unavailable', true);
        if (status === 401 || status === 403 || (status === 400 && (await badKey(response)))) {
          throw new AiError('The AI service rejected the server’s API key.', 'config', false);
        }
        throw new AiError(`The AI service refused the request (HTTP ${status}).`, 'refused', false);
      }
    },
  };
}

/** Gemini answers an invalid key with 400 and reason API_KEY_INVALID. */
async function badKey(response: Response): Promise<boolean> {
  try {
    const data = (await response.json()) as { error?: { details?: Array<{ reason?: string }> } };
    return data.error?.details?.some((d) => d.reason === 'API_KEY_INVALID') ?? false;
  } catch {
    return false;
  }
}

/** Gemini supports enum only for strings and numbers: a nullable enum becomes anyOf [enum, null]. */
export function geminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSchema);
  if (typeof schema !== 'object' || schema === null) return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) out[key] = geminiSchema(value);
  if (Array.isArray(out.enum) && out.enum.includes(null)) {
    const { enum: values, type, description, ...rest } = out as { enum: unknown[]; type?: unknown; description?: unknown };
    const types = (Array.isArray(type) ? type : [type]).filter((t) => t !== 'null' && t !== undefined);
    return {
      ...(description === undefined ? {} : { description }),
      anyOf: [{ ...rest, ...(types.length ? { type: types.length === 1 ? types[0] : types } : {}), enum: values.filter((v) => v !== null) }, { type: 'null' }],
    };
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
