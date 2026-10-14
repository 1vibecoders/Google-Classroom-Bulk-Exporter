// Google Gemini API (generateContent) with plain fetch. Structured output:
// JSON text constrained by the task's schema (generationConfig.responseFormat).
// Same error kinds as anthropic.ts, with longer retries and a fallback model for the
// often overloaded free tier. The API key travels only in the x-goog-api-key
// header; errors carry no request or response content beyond Google's own
// error message.
import { AiError, type AiProvider } from './provider.js';

const URL_MODELS = 'https://generativelanguage.googleapis.com/v1beta/models/';
// A ≤2000-token JSON answer at a low thinking level comes well within this; Google's 504 means its own deadline.
const TIMEOUT_MS = 60000;
// Google advises exponential backoff for 429 and 503 (ai.google.dev/gemini-api/docs/troubleshooting).
const RETRY_DELAYS_MS = [2000, 8000, 20000];
const MAX_WAIT_MS = 30000;
// Thinking tokens count toward maxOutputTokens. At thinkingLevel 'low' (lowest level gemini-3.8-flash supports)
// a few thousand suffice; without thinkingConfig the model thinks at its default level, so keep the old margin.
const THINKING_TOKENS = 4000;
const DEFAULT_THINKING_TOKENS = 8000;

export function geminiProvider(options: {
  apiKey: string;
  model: string;
  /** Tried once more, with the same request, when the model stays overloaded or rate-limited. */
  fallbackModel?: string;
  fetch?: typeof fetch;
  retryDelaysMs?: number[];
  timeoutMs?: number;
}): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  return {
    name: 'gemini',
    model: options.model,
    async structured(request) {
      const schema = geminiSchema(request.schema);
      // responseFormat and thinkingConfig are the current fields; responseMimeType + responseJsonSchema is the older
      // shape, still accepted. If Google refuses the request shape (400), it is sent once more the older way without
      // thinkingConfig, and the fallback model starts with that shape too: one shape fallback in total.
      const bodyFor = (legacy: boolean) =>
        JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: 'user', parts: [{ text: request.input }] }],
          generationConfig: {
            maxOutputTokens: request.maxOutputTokens + (legacy ? DEFAULT_THINKING_TOKENS : THINKING_TOKENS),
            ...(legacy
              ? { responseMimeType: 'application/json', responseJsonSchema: schema }
              : { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } }, thinkingConfig: { thinkingLevel: 'low' } }),
          },
        });
      let legacy = false;
      const call = async (model: string) => {
        const url = `${URL_MODELS}${encodeURIComponent(model)}:generateContent`;
        for (let attempt = 0; ; attempt++) {
          const retry = attempt < delays.length;
          // ±25 % jitter so parallel requests do not retry in step.
          const backoff = () => delays[attempt] * (0.75 + Math.random() / 2);
          let response: Response;
          try {
            response = await doFetch(url, {
              method: 'POST',
              headers: { 'x-goog-api-key': options.apiKey, 'content-type': 'application/json' },
              body: bodyFor(legacy),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (err) {
            if (retry) {
              await sleep(backoff());
              continue;
            }
            if ((err as Error)?.name === 'TimeoutError') {
              throw new AiError(`The AI service did not answer in time (timed out after ${timeoutMs / 1000} s).`, 'unavailable', true);
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
              model: data.modelVersion ?? model,
              // Thinking tokens are billed as output.
              usage: { inputTokens: usage?.promptTokenCount ?? 0, outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0) },
            };
          }
          const status = response.status;
          const retryable = status === 429 || status >= 500;
          if (retryable && retry) {
            const after = Number(response.headers.get('retry-after'));
            await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(), MAX_WAIT_MS));
            continue;
          }
          const problem = await errorOf(response);
          const detail = problem.message ? `: ${problem.message}` : '';
          if (status === 429) throw new AiError(`The AI service is rate-limiting requests (HTTP 429, free-tier limit${detail}); try again in a minute.`, 'rate_limit', true);
          if (status === 503) throw new AiError(`The AI service is overloaded (HTTP 503${detail}); try again in a few minutes.`, 'unavailable', true);
          if (retryable) throw new AiError(`The AI service is unavailable right now (HTTP ${status}${detail}).`, 'unavailable', true);
          if (status === 401 || status === 403 || problem.badKey) {
            throw new AiError(`The AI service rejected the server’s API key${problem.message ? ` (${problem.message})` : ''}.`, 'config', false);
          }
          if (status === 400 && !legacy) {
            legacy = true;
            attempt--;
            continue;
          }
          throw new AiError(`The AI service refused the request (HTTP ${status}${detail}).`, 'refused', false);
        }
      };
      try {
        return await call(options.model);
      } catch (err) {
        const fallback = options.fallbackModel;
        if (!fallback || !(err instanceof AiError) || (err.kind !== 'unavailable' && err.kind !== 'rate_limit')) throw err;
        try {
          return await call(fallback);
        } catch (second) {
          if (!(second instanceof AiError)) throw second;
          throw new AiError(`${err.message} The fallback model ${fallback} failed too: ${second.message}`, err.kind, err.transient);
        }
      }
    },
  };
}

/** Gemini answers an invalid key with 400 and reason API_KEY_INVALID. */
/** Google's own error text (never contains the key) and whether it is an invalid key (400 API_KEY_INVALID). */
async function errorOf(response: Response): Promise<{ badKey: boolean; message?: string }> {
  try {
    const data = (await response.json()) as { error?: { message?: string; details?: Array<{ reason?: string }> } };
    const message = typeof data.error?.message === 'string' ? Array.from(data.error.message.replace(/\s+/g, ' ').trim()).slice(0, 200).join('') : undefined;
    return { badKey: data.error?.details?.some((d) => d.reason === 'API_KEY_INVALID') ?? false, ...(message ? { message } : {}) };
  } catch {
    return { badKey: false };
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
