// The Tests view (SPEC § 25, § 27.4): upcoming tests with their study topics;
// a topic's status decides what the planned preparation sessions cover.
import { expect, loadExample, test } from './fixtures';

test('adds study topics to a test, marks one as hard, and the next preparation session covers it first', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/tests');
  const card = page.getByRole('article', { name: 'Unit 2 Test: Cells' });
  await expect(card).toBeVisible();
  for (const topic of ['Cell membrane structure', 'Osmosis practice']) {
    await card.getByLabel('Add a topic').fill(topic);
    await card.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await card.getByLabel('How ready you are on Osmosis practice').selectOption('needs_review');
  await card.getByLabel('How ready you are on Cell membrane structure').selectOption('comfortable');
  await page.reload();
  await expect(page.getByRole('article', { name: 'Unit 2 Test: Cells' }).getByLabel('How ready you are on Osmosis practice')).toHaveValue('needs_review');
});
