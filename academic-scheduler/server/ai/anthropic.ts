// Anthropic Messages API with plain fetch. Structured output: one tool whose
// input schema is the task's schema, and the model is required to call it.
// Timeouts, bounded retries for rate limits and overload, usage from the
// response. Errors carry no request or response content.
import { AiError, type AiProvider } from './provider.js';

const URL_MESSAGES = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 60000;
const RETRY_DELAYS_MS = [2000, 8000];
const TOOL = 'record_result';

export function anthropicProvider(options: { apiKey: string; model: string; fetch?: typeof fetch; retryDelaysMs?: number[] }): AiProvider {
  const doFetch = options.fetch ?? fetch;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  return {
    name: 'anthropic',
    model: options.model,
    async structured(request) {
      const body = JSON.stringify({
        model: options.model,
        max_tokens: request.maxOutputTokens,
        system: request.system,
        messages: [{ role: 'user', content: request.input }],
        tools: [{ name: TOOL, description: 'Record the result. Call this exactly once.', input_schema: request.schema }],
        tool_choice: { type: 'tool', name: TOOL },
      });
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await doFetch(URL_MESSAGES, {
            method: 'POST',
            headers: { 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
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
            model?: string;
            content?: Array<{ type: string; name?: string; input?: unknown }>;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          const call = data.content?.find((c) => c.type === 'tool_use' && c.name === TOOL);
          if (!call) throw new AiError('The AI service returned no structured result.', 'invalid_output', false);
          return {
            output: call.input,
            model: data.model ?? options.model,
            usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
          };
        }
        const status = response.status;
        const retryable = status === 429 || status === 529 || status >= 500;
        if (retryable && attempt < delays.length) {
          const after = Number(response.headers.get('retry-after'));
          await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : delays[attempt]);
          continue;
        }
        if (status === 429) throw new AiError('The AI service is rate-limiting requests.', 'rate_limit', true);
        if (retryable) throw new AiError('The AI service is unavailable right now.', 'unavailable', true);
        if (status === 401 || status === 403) throw new AiError('The AI service rejected the server’s API key.', 'config', false);
        throw new AiError(`The AI service refused the request (HTTP ${status}).`, 'refused', false);
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
