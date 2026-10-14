// AI findings in the browser, against a mocked analysis backend: a sure,
// stated new quiz is added on its own (with Undo); a due date that differs
// from Classroom's waits in Review with the quote and the reason, and Apply
// records the decision.
import { expect, loadExample, navTo, test } from './fixtures';

const BASE = { key: '', classId: 'gc-class-NjI3ODk0MjE0NTQ5', source: { kind: 'announcement', id: 'ODAx', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/ODAx', postedAt: '2026-10-06T08:00:00' }, explicit: true, confidence: { identity: 'high', value: 'high' } };
const QUIZ = { ...BASE, key: 'a'.repeat(32), kind: 'new_assessment', title: 'Unit 3 quiz', type: 'quiz', value: '2026-10-20', excerpt: 'Unit 3 quiz on Tuesday, Oct 20' };
const MOVE = { ...BASE, key: 'b'.repeat(32), kind: 'due_change', assignmentId: 'gc-NzAwMDAwMDAwMDAz', value: '2026-10-16T23:59:00', excerpt: 'The grammar worksheet is now due Friday at 11:59 PM' };

test('sure findings are applied with Undo; others wait in Review until decided', async ({ page }) => {
  const decisions: unknown[] = [];
  await page.route('**/api/analysis', (route) =>
    route.fulfill({
      json: {
        configured: true,
        model: 'claude-haiku-4-5-20251001',
        proposals: [QUIZ, MOVE],
        pending: 0,
        budget: { limit: 20, used: 1 },
        usage: {
          day: { calls: 2, inputTokens: 12000, outputTokens: 900 },
          runs: [{ at: '2026-10-07T13:00:00.000Z', trigger: 'setup', status: 'ok', calls: 2, inputTokens: 12000, outputTokens: 900, models: 'claude-haiku-4-5-20251001' }],
        },
      },
    }),
  );
  await page.route('**/api/review', (route) => {
    decisions.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await loadExample(page);

  await expect(page.getByText('Applied 1 change read from Classroom.')).toBeVisible();
  await navTo(page, 'Assignments');
  await expect(page.getByText('Unit 3 quiz').first()).toBeVisible();

  const reviewLink = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Review/ });
  await expect(reviewLink).toContainText('1');
  await reviewLink.click();
  const card = page.getByRole('article', { name: 'Due date of “Grammar worksheet 3: Commas”' });
  await expect(card).toContainText('“The grammar worksheet is now due Friday at 11:59 PM”');
  await expect(card).toContainText('Classroom gives a different due date; check which one is right.');
  await card.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Applied: Due date of “Grammar worksheet 3: Commas”.')).toBeVisible();
  await expect(card).toBeHidden();
  await expect(page.getByText('Everything the AI found is applied or decided.')).toBeVisible();

  // Settings shows the tokens the provider reported.
  await page.goto('/#/settings');
  await page.getByText('Token usage: 12,900 tokens in the last 24 hours (12,000 in, 900 out, 2 requests)').click();
  await expect(page.getByRole('table', { name: 'The last 1 AI runs' })).toContainText('Setup (free)');
  expect(decisions).toEqual([
    { key: QUIZ.key, decision: 'applied' },
    { key: MOVE.key, decision: 'applied' },
  ]);
});
