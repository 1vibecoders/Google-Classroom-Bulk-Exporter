// A class scan sent by the browser extension (as its injected script does:
// window.postMessage until a receipt) opens the usual import preview, and a
// message the website cannot use is refused with a reason.
import { expect, loadExample, test } from './fixtures';

const SCAN = {
  createdAt: '2026-10-07T14:00:00.000Z',
  classInfo: { courseId: 'NjI3ODk0MjE0NTQ5', name: 'English 10', section: 'Period 3', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5' },
  topics: [{ id: 't1', name: 'Unit 3: Othello' }],
  items: [
    {
      id: 'NzAwMDAwMDAwMDA5',
      type: 'assignment',
      title: 'Poetry analysis',
      topic: 'Unit 3: Othello',
      description: 'One sonnet.',
      classroomUrl: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDA5/details',
      meta: { dueText: 'Oct 20, 11:59 PM', pointsText: '20 points', postedText: 'Oct 5' },
      resources: [],
    },
  ],
  warnings: [],
};

async function send(page: import('@playwright/test').Page, data: Record<string, unknown>) {
  return page.evaluate(
    (message) =>
      new Promise<Record<string, unknown>>((resolve) => {
        window.addEventListener('message', (event) => {
          if (event.data?.type === 'received' && event.data.id === message.id) resolve(event.data);
        });
        window.postMessage(message, window.location.origin);
      }),
    { protocol: 'academic-scheduler/extension-import', version: 1, type: 'import', id: 'e2e-1', ...data },
  );
}

test('a scan from the browser extension opens the import preview', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/import');
  expect(await send(page, { snapshots: [SCAN] })).toMatchObject({ ok: true, id: 'e2e-1' });
  await expect(page.getByRole('heading', { name: 'Review the changes from “Browser extension scan: English 10”' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Schedule Import' })).toContainText('+ 1 assignment');
  await expect(page.getByText('Poetry analysis').first()).toBeVisible();
});

test('a message the website cannot use is refused with a reason and changes nothing', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/import');
  expect(await send(page, { version: 99, snapshots: [SCAN] })).toMatchObject({ ok: false, message: expect.stringContaining('Update the extension') });
  await expect(page.getByRole('heading', { level: 1, name: 'Import schedule' })).toBeVisible();
});

/** A one-page PDF showing `line`. */
function pdfBase64(line: string): string {
  const content = `BT /F1 12 Tf 72 712 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1').toString('base64');
}

test('course documents sent with a scan are read in the browser and listed with their class', async ({ page }) => {
  await loadExample(page);
  await page.goto('/#/import');
  const doc = (fileId: string, title: string, mime: string, data: string) => ({
    fileId,
    courseId: 'NjI3ODk0MjE0NTQ5',
    itemId: 'NzAwMDAwMDAwMDA5',
    itemType: 'assignment',
    title,
    url: `https://drive.google.com/file/d/${fileId}/view`,
    status: 'file',
    mime,
    data,
  });
  const documents = [
    doc('pdf_1234567890', 'Sonnet handout.pdf', 'application/pdf', pdfBase64('Sonnet quiz on Thursday')),
    { ...doc('img_1234567890', 'Map.png', '', ''), status: 'unsupported' },
  ];
  expect(await send(page, { version: 2, snapshots: [SCAN], documents })).toMatchObject({ ok: true });
  await expect(page.getByText('Read 1 of 2 course documents from the extension (kept in this browser). They are listed on the Classes page.')).toBeVisible();

  await page.goto('/#/classes');
  const english = page.getByRole('article', { name: 'English 10' });
  await english.getByText('Course documents (2)').click();
  await expect(english).toContainText('No text to read (not a document, PDF or slides)');
  await english.getByRole('button', { name: 'Show text' }).click();
  await expect(english).toContainText('Sonnet quiz on Thursday');
});
