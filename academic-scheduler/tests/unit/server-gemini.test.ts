// The Gemini client with a fake fetch: request shape (key only in the header,
// JSON output with the schema), parsing and usage, retries, error kinds; and
// which provider the environment selects.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geminiProvider, geminiSchema } from '../../server/ai/gemini';
import { DEFAULT_MODEL, GEMINI_DEFAULT_MODEL, providerFromEnv } from '../../server/ai/provider';
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
    const other = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [], fetch: fake(() => new Response('{}', { status: 400 })) });
    await expect(other.structured(request)).rejects.toMatchObject({ kind: 'refused' });
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

  it('gives up after the retries with a transient error', async () => {
    const provider = geminiProvider({ apiKey: 'k', model: 'm', retryDelaysMs: [0], fetch: fake(() => new Response('{}', { status: 503 })) });
    await expect(provider.structured(request)).rejects.toMatchObject({ kind: 'unavailable', transient: true });
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

  it('treats an unknown AI_PROVIDER as not configured and says so without the key', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(providerFromEnv({ GEMINI_API_KEY: 'g-secret', AI_PROVIDER: 'openai' })).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).not.toContain('g-secret');
  });
});
