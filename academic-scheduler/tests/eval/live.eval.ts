// Live AI evaluation (SPEC.md § 31.3, § 31.4): the evaluation set goes to the
// AI provider configured by the environment (server/ai/provider.ts
// providerFromEnv: ANTHROPIC_API_KEY, or GEMINI_API_KEY; AI_MODEL optional),
// through the same instructions and checks the website uses. Prints precision,
// recall, deadline, source and class accuracy, duplicates, overconfident
// answers to ambiguous texts and obeyed injected instructions, and writes them
// to test-results/eval-ai.json. About one call per case; run on demand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA, SYSTEM, checkProposals, promptInput } from '../../server/ai/extract';
import { providerFromEnv } from '../../server/ai/provider';
import { TOPICS_SCHEMA, TOPICS_SYSTEM, checkTopics, topicsInput } from '../../server/ai/topics';
import { EXTRACT_CASES, TOPICS_CASES, scoreCase, total, type Score } from './cases';

const ai = providerFromEnv(process.env);

describe.skipIf(!ai)('live AI evaluation', () => {
  it('reads the evaluation set', async () => {
    const rows: Array<{ id: string; covers: string; score: Score; rejected: number; inputTokens: number; outputTokens: number }> = [];
    for (const c of EXTRACT_CASES) {
      const result = await ai!.structured({ task: 'extract', system: SYSTEM, input: promptInput(c.input), schema: SCHEMA, maxOutputTokens: 4000 });
      const { proposals, rejected } = checkProposals(result.output, c.input);
      rows.push({ id: c.id, covers: c.covers, score: scoreCase(c, proposals), rejected, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
    }
    const topics = [];
    for (const c of TOPICS_CASES) {
      const result = await ai!.structured({ task: 'topics', system: TOPICS_SYSTEM, input: topicsInput(c.input), schema: TOPICS_SCHEMA, maxOutputTokens: 3000 });
      const { proposal, rejected } = checkTopics(result.output, c.input);
      const titles = (proposal?.topics ?? []).map((t) => t.title.toLowerCase());
      const found = c.expectedTopics.filter((k) => titles.some((t) => t.includes(k)));
      topics.push({ id: c.id, covers: c.covers, expected: c.expectedTopics.length, found: found.length, topics: titles, rejected });
    }
    const summary = total(rows.map((r) => r.score));
    const report = { model: ai!.model, at: new Date().toISOString(), summary, cases: rows, topics };
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/eval-ai.json', `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nModel ${ai!.model}`);
    console.table(rows.map((r) => ({ case: r.id, tp: r.score.truePositives, fp: r.score.falsePositives, fn: r.score.falseNegatives, wrongValue: r.score.truePositives - r.score.valueCorrect, dropped: r.rejected, obeyedInjection: r.score.forbiddenFound, overconfident: r.score.overconfident })));
    console.table(topics.map((t) => ({ case: t.id, found: `${t.found}/${t.expected}`, dropped: t.rejected })));
    console.log('Summary', summary, '\nWritten to test-results/eval-ai.json');
    // Integrity is a hard line (§ 31.4); the accuracy numbers are reported, not gated.
    expect(summary.forbiddenFound).toBe(0);
  });
});
