// The Gemini client with a fake fetch: request shape (key only in the header,
// JSON output with the schema), parsing and usage, retries, error kinds; and
// which provider the environment selects.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiProvider, geminiSchema } from '../../server/ai/gemini';
import { DEFAULT_MODEL, GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL, providerFromEnv } from '../../server/ai/provider';
import { SCHEMA } from '../../server/ai/extract';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const answer = (text: string, finishReason = 'STOP') => ({
  modelVersion: 'gemini-3.8-flash',
  candidates: [{ finishReason, content: { role: 'model', parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
});
const request = { task: 't', system: 'be careful', input: 'the texts', schema: SCHEMA, maxOutputTokens: 2000 };
const fake = (respond: () => Response) => (async () => respond()) as unknown as typeof fetch;

describe('the Gemini client', () => {
  it('sends the key only in the header, the system instruction and the JSON schema; reads output and usage; retries 429', async () => {
    const sent: Array<{ url: string; init: RequestInit }> = [];
    let n = 0;
    const provider = geminiProvider({
      apiKey: 'AIza-secret',
      model: 'gemini-3.8-flash',
      retryDelaysMs: [0, 0],
      fetch: (async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        if (n++ === 0) return new Response('{}', { status: 429 });
        return ok(answer('{"proposals":[]}'));
      }) as unknown as typeof fetch,
    });
    const result = await provider.structured(request);
    expect(result).toEqual({ output: { proposals: [] }, model: 'gemini-3.8-flash', usage: { inputTokens: 40, outputTokens: 12 } });
    expect(sent).toHaveLength(2);
    const { url, init } = sent[1];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(url).not.toContain('AIza-secret');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-secret');
    const body = JSON.parse(String(init.body));
    expect(JSON.stringify(body)).not.toContain('AIza-secret');
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'be careful' }] });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'the texts' }] }]);
    expect(body.generationConfig.responseFormat.text).toEqual({ mimeType: 'APPLICATION_JSON', schema: geminiSchema(SCHEMA) });
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(2000);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('turns a nullable enum into anyOf, since Gemini enums hold only strings and numbers', () => {
    const converted = geminiSchema({ type: ['string', 'null'], enum: ['quiz', null], description: 'd' });
    expect(converted).toEqual({ description: 'd', anyOf: [{ type: 'string', enum: ['quiz'] }, { type: 'null' }] });
    expect(JSON.stringify(geminiSchema(SCHEMA))).not.toContain('null]');
    expect(SCHEMA.properties.proposals.items.properties.assessmentType.enum).toContain(null);
  });

  it('reports a rejected key as a configuration problem', async () => {
    const statuses = [401, 403];
    for (const status of statuses) {
      const provider = geminiProvider({ apiKey: 'bad', model: 'm', retryDelaysMs: [], fetch: fake(() => new Response('{}', { status })) });
      await expect(provider.structured(request)).rejects.toMatchObject({ kind: 'config', transient: false });
    }
    const invalid = { error: { code: 400, message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } };
    const provider = geminiProvider({ apiKey: 'bad', model: 'm', retryDelaysMs: [], fetch: fake(() => new Response(JSON.stringify(invalid), { status: 400 })) });
    const error = await provider.structured(request).catch((e: Error) => e);
    expect(error).toMatchObject({ kind: 'config', transient: false });
    expect((error as Error).message).not.toContain('bad');
    expect((error as Error).message).toContain('API key not valid.');
    const refusal = { error: { code: 400, message: 'Invalid JSON payload received.', status: 'INVALID_ARGUMENT' } };
    const other = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [], fetch: fake(() => new Response(JSON.stringify(refusal), { status: 400 })) });
    await expect(other.structured(request)).rejects.toMatchObject({ kind: 'refused', message: 'The AI service refused the request (HTTP 400: Invalid JSON payload received.).' });
  });

  it('sends the request once more with the older JSON fields and no thinking level when Google refuses the request shape', async () => {
    const bodies: Array<{ generationConfig: Record<string, unknown> }> = [];
    let n = 0;
    const provider = geminiProvider({
      apiKey: 'k',
      model: 'm',
      retryDelaysMs: [],
      fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        if (n++ === 0) return new Response(JSON.stringify({ error: { message: 'Unknown name "responseFormat"' } }), { status: 400 });
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"proposals":[]}' }] } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });
    expect((await provider.structured(request)).output).toEqual({ proposals: [] });
    expect(Object.keys(bodies[0].generationConfig).sort()).toEqual(['maxOutputTokens', 'responseFormat', 'thinkingConfig']);
    expect(Object.keys(bodies[1].generationConfig).sort()).toEqual(['maxOutputTokens', 'responseJsonSchema', 'responseMimeType']);
    expect(bodies[1].generationConfig.responseMimeType).toBe('application/json');
  });

  it('falls back to the older shape only once', async () => {
    let n = 0;
    const refusal = JSON.stringify({ error: { message: 'Unknown name "thinkingLevel"' } });
    const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [], fetch: fake(() => (n++, new Response(refusal, { status: 400 }))) });
    await expect(provider.structured(request)).rejects.toMatchObject({ kind: 'refused' });
    expect(n).toBe(2);
  });

  it('rejects text that is not a JSON object, a cut-off answer and a blocked prompt as invalid output', async () => {
    const bodies = [
      answer('Sure! Here are the proposals.'),
      answer('[1, 2]'),
      answer('{"proposals":[', 'MAX_TOKENS'),
      answer('{"proposals":[]}', 'SAFETY'),
      { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } },
    ];
    for (const body of bodies) {
      const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [], fetch: fake(() => ok(body)) });
      await expect(provider.structured(request)).rejects.toMatchObject({ kind: 'invalid_output', transient: false });
    }
  });

  it('gives up after the retries with a transient error that says why', async () => {
    let n = 0;
    const overloaded = JSON.stringify({ error: { code: 503, message: 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } });
    const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [0], fetch: fake(() => (n++, new Response(overloaded, { status: 503 }))) });
    await expect(provider.structured(request)).rejects.toMatchObject({
      kind: 'unavailable',
      transient: true,
      message: 'The AI service is overloaded (HTTP 503: The model is overloaded. Please try again later.); try again in a few minutes.',
    });
    expect(n).toBe(2);
  });

  it('succeeds when a 503 clears on a retry', async () => {
    let n = 0;
    const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [0, 0, 0], fetch: fake(() => (n++ < 2 ? new Response('{}', { status: 503 }) : ok(answer('{"proposals":[]}')))) });
    expect((await provider.structured(request)).output).toEqual({ proposals: [] });
    expect(n).toBe(3);
  });

  /** A fetch that answers per model (the name in the URL) and records which models were asked. */
  const byModel = (respond: (model: string) => Response, models: string[]) =>
    (async (url: string) => {
      const model = url.split('/models/')[1].split(':')[0];
      models.push(model);
      return respond(model);
    }) as unknown as typeof fetch;
  const plain = { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"proposals":[]}' }] } }] };

  it('tries the fallback model when the main one stays overloaded, and reports the model used', async () => {
    const models: string[] = [];
    const provider = geminiProvider({
      apiKey: 'k',
      model: 'main',
      fallbackModel: 'lite',
      retryDelaysMs: [0],
      fetch: byModel((m) => (m === 'main' ? new Response('{}', { status: 503 }) : ok(plain)), models),
    });
    expect(provider.model).toBe('main');
    expect(await provider.structured(request)).toMatchObject({ output: { proposals: [] }, model: 'lite' });
    expect(models).toEqual(['main', 'main', 'lite']);
  });

  it('fails as unavailable, naming both failures, when the fallback model fails too; other errors do not fall back', async () => {
    const models: string[] = [];
    const both = geminiProvider({ apiKey: 'k', model: 'main', fallbackModel: 'lite', retryDelaysMs: [], fetch: byModel(() => new Response('{}', { status: 503 }), models) });
    const error = (await both.structured(request).catch((e: Error) => e)) as Error;
    expect(error).toMatchObject({ kind: 'unavailable', transient: true });
    expect(error.message).toBe(
      'The AI service is overloaded (HTTP 503); try again in a few minutes. The fallback model lite failed too: The AI service is overloaded (HTTP 503); try again in a few minutes.',
    );
    expect(models).toEqual(['main', 'lite']);
    const invalid = geminiProvider({ apiKey: 'k', model: 'main', fallbackModel: 'lite', retryDelaysMs: [], fetch: byModel(() => ok(answer('not json')), models) });
    await expect(invalid.structured(request)).rejects.toMatchObject({ kind: 'invalid_output' });
    expect(models).toEqual(['main', 'lite', 'main']);
  });

  it('treats a timeout as unavailable and says it timed out', async () => {
    let n = 0;
    const hang = (async (_url: string, init: RequestInit) => {
      n++;
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    }) as unknown as typeof fetch;
    const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [0], timeoutMs: 20, fetch: hang });
    await expect(provider.structured(request)).rejects.toMatchObject({ kind: 'unavailable', transient: true, message: expect.stringContaining('timed out after 0.02 s') });
    expect(n).toBe(2);
  });
});

describe('choosing the provider from the environment', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prefers Anthropic, then Gemini, else none; AI_PROVIDER and AI_MODEL override', () => {
    expect(providerFromEnv({})).toBeNull();
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' })).toMatchObject({ name: 'anthropic', model: DEFAULT_MODEL });
    expect(providerFromEnv({ GEMINI_API_KEY: 'g' })).toMatchObject({ name: 'gemini', model: GEMINI_DEFAULT_MODEL });
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_PROVIDER: 'gemini' })).toMatchObject({ name: 'gemini' });
    expect(providerFromEnv({ GEMINI_API_KEY: 'g', AI_PROVIDER: 'anthropic' })).toBeNull();
    expect(providerFromEnv({ GEMINI_API_KEY: 'g', AI_MODEL: 'gemini-3.5-flash-lite' })).toMatchObject({ name: 'gemini', model: 'gemini-3.5-flash-lite' });
    expect(providerFromEnv({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'claude-x' })).toMatchObject({ name: 'anthropic', model: 'claude-x' });
  });

  it('gives Gemini a fallback model: the light free one by default, AI_FALLBACK_MODEL to change it, empty for none', async () => {
    vi.useFakeTimers();
    try {
      const asked = async (env: Record<string, string>) => {
        const models: string[] = [];
        const fetchImpl = (async (url: string) => {
          models.push(url.split('/models/')[1].split(':')[0]);
          return new Response('{}', { status: 503 });
        }) as unknown as typeof fetch;
        const provider = providerFromEnv({ GEMINI_API_KEY: 'g', AI_MODEL: 'busy', ...env }, fetchImpl)!;
        expect(provider.model).toBe('busy');
        const done = provider.structured(request).catch((e: Error) => e);
        await vi.runAllTimersAsync();
        expect(await done).toMatchObject({ kind: 'unavailable' });
        return [...new Set(models)];
      };
      expect(GEMINI_FALLBACK_MODEL).toBe('gemini-3.5-flash-lite');
      expect(await asked({})).toEqual(['busy', 'gemini-3.5-flash-lite']);
      expect(await asked({ AI_FALLBACK_MODEL: 'other' })).toEqual(['busy', 'other']);
      expect(await asked({ AI_FALLBACK_MODEL: '' })).toEqual(['busy']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an unknown AI_PROVIDER as not configured and says so without the key', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(providerFromEnv({ GEMINI_API_KEY: 'g-secret', AI_PROVIDER: 'openai' })).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('g-secret');
  });
});
