// Live AI evaluation (`npm run eval:ai`): sends the evaluation set
// (tests/eval/cases.ts) to the configured AI provider and prints the scores.
// Not part of `npm test`; it costs API calls and needs ANTHROPIC_API_KEY or GEMINI_API_KEY.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 300_000,
  },
});
