import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadToBlob, downloadWithRetry, analyzeHtml, findConfirmUrl } from '../../src/engine/fetcher.js';
import { planDownload } from '../../src/engine/download-resolver.js';
import { crc32 } from '../../src/engine/crc32.js';

function response(body, { status = 200, headers = {}, url = 'https://drive.usercontent.google.com/download?id=x' } = {}) {
  const res = new Response(body, { status, headers });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

test('download plan for Drive files uses the class account and resource key', () => {
  const plan = planDownload({ kind: 'drive-file', id: 'FILEID1234567', resourceKey: '0-abc', authuser: 0 }, { authuser: 2 });
  assert.equal(plan.downloadable, true);
  const first = new URL(plan.attempts[0].url);
  assert.equal(first.host, 'drive.usercontent.google.com');
  assert.equal(first.searchParams.get('id'), 'FILEID1234567');
  assert.equal(first.searchParams.get('authuser'), '2');
  assert.equal(first.searchParams.get('resourcekey'), '0-abc');
  assert.equal(new URL(plan.attempts[1].url).host, 'drive.google.com');
  const ambiguous = planDownload({ kind: 'drive-file', id: 'FILEID1234567', hint: 'ambiguous' }, { authuser: 0 });
  assert.equal(ambiguous.attempts.length, 5, 'open?id= links also try Docs/Sheets/Slides exports');
});

test('download plan for Google Docs editors exports in the chosen format', () => {
  const office = planDownload({ kind: 'google-doc', id: 'DOCID12345678' }, { authuser: 1, googleFormat: 'office' });
  assert.match(office.attempts[0].url, /^https:\/\/docs\.google\.com\/document\/d\/DOCID12345678\/export\?format=docx&authuser=1$/);
  assert.equal(office.attempts[0].ext, '.docx');
  assert.equal(office.attempts[1].ext, '.pdf');
  const pdf = planDownload({ kind: 'google-slides', id: 'SLIDES1234567' }, { googleFormat: 'pdf' });
  assert.match(pdf.attempts[0].url, /\/presentation\/d\/SLIDES1234567\/export\/pdf/);
  assert.equal(planDownload({ kind: 'google-sheet', id: 'SHEET12345678' }).attempts[0].ext, '.xlsx');
  assert.equal(planDownload({ kind: 'google-drawing', id: 'DRAW123456789' }).attempts[0].ext, '.png');
});

test('non-file resources are kept as links with a reason', () => {
  for (const kind of ['google-form', 'drive-folder', 'youtube', 'link', 'google-site', 'classroom']) {
    const plan = planDownload({ kind, id: 'X', url: 'https://example.com' });
    assert.equal(plan.downloadable, false, kind);
    assert.ok(plan.reason.length > 10, kind);
  }
  assert.equal(planDownload({ kind: 'google-doc', id: 'PUB', published: true }).downloadable, false);
});

test('downloads a file with its original name and checksum', async () => {
  const bytes = new Uint8Array(20000).map((_, i) => i & 0xff);
  const result = await downloadToBlob('https://x/', {
    fetchImpl: async () =>
      response(bytes, {
        headers: { 'content-type': 'application/pdf', 'content-length': '20000', 'content-disposition': "attachment; filename*=UTF-8''Macbeth%20Act%201.pdf" },
      }),
  });
  assert.equal(result.size, 20000);
  assert.equal(result.crc, crc32(bytes));
  assert.equal(result.headerName, 'Macbeth Act 1.pdf');
  assert.equal(result.blob.size, 20000);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
});

test('maps HTTP failures to clear reasons', async () => {
  const cases = [
    [403, 'forbidden', /Access denied/],
    [404, 'not-found', /not found/i],
    [429, 'rate-limited', /rate-limiting/],
    [500, 'server', /server error/i],
    [418, 'http', /HTTP 418/],
  ];
  for (const [status, code, message] of cases) {
    await assert.rejects(
      () => downloadToBlob('https://x/', { fetchImpl: async () => response('nope', { status }) }),
      (err) => err.code === code && message.test(err.message),
      `status ${status}`,
    );
  }
  await assert.rejects(
    () => downloadToBlob('https://x/', { fetchImpl: async () => response('', { url: 'https://accounts.google.com/ServiceLogin?continue=x' }) }),
    (err) => err.code === 'auth',
  );
  await assert.rejects(
    () => downloadToBlob('https://x/', { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
    (err) => err.code === 'network' && err.retryable,
  );
});

test('recognizes HTML pages returned instead of files', () => {
  assert.equal(analyzeHtml('<title>Sign in - Google Accounts</title> accounts.google.com/ServiceLogin', 'https://x/').code, 'auth');
  assert.equal(analyzeHtml('Sorry, too many users have viewed or downloaded this file recently', 'https://x/').code, 'quota');
  assert.equal(analyzeHtml('<h1>You need access</h1><button>Request access</button>', 'https://x/').code, 'forbidden');
  assert.equal(analyzeHtml('<html>Something else</html>', 'https://x/').code, 'unexpected-html');
  const page = '<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="ABC"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form>';
  const err = analyzeHtml(page, 'https://drive.usercontent.google.com/download?id=ABC');
  assert.equal(err.code, 'interstitial');
  const next = new URL(err.nextUrl);
  assert.equal(next.searchParams.get('uuid'), 'u-1');
  assert.equal(next.searchParams.get('id'), 'ABC');
  assert.equal(findConfirmUrl('<a href="/uc?export=download&amp;confirm=AbC&amp;id=Z">x</a>', 'https://drive.google.com/uc?id=Z'), 'https://drive.google.com/uc?export=download&confirm=AbC&id=Z');
});

test('an HTML file sent as an attachment is a file, not an error page', async () => {
  const result = await downloadToBlob('https://x/', {
    fetchImpl: async () => response('<html>page</html>', { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment; filename="page.html"' } }),
  });
  assert.equal(result.headerName, 'page.html');
});

test('retries transient failures and follows the virus-scan confirmation', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) return response('busy', { status: 503 });
    if (!url.includes('uuid')) {
      return response('<form id="download-form" action="https://drive.usercontent.google.com/download"><input type="hidden" name="id" value="V"><input type="hidden" name="uuid" value="9"></form>', { headers: { 'content-type': 'text/html' } });
    }
    return response('file', { headers: { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="v.mp4"' } });
  };
  const retries = [];
  const result = await downloadWithRetry('https://drive.usercontent.google.com/download?id=V', { fetchImpl, baseDelayMs: 5, onRetry: (n) => retries.push(n) });
  assert.equal(result.headerName, 'v.mp4');
  assert.equal(calls.length, 3);
  assert.deepEqual(retries, [1]);
});

test('gives up after the retry budget and does not retry permanent errors', async () => {
  let n = 0;
  await assert.rejects(() => downloadWithRetry('https://x/', { fetchImpl: async () => { n++; return response('', { status: 500 }); }, retries: 2, baseDelayMs: 1 }), (e) => e.code === 'server');
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(() => downloadWithRetry('https://x/', { fetchImpl: async () => { n++; return response('', { status: 403 }); }, baseDelayMs: 1 }), (e) => e.code === 'forbidden');
  assert.equal(n, 1);
});

test('detects truncated downloads', async () => {
  await assert.rejects(
    () => downloadToBlob('https://x/', { fetchImpl: async () => response('short', { headers: { 'content-type': 'application/pdf', 'content-length': '100', 'content-disposition': 'attachment' } }) }),
    (e) => e.code === 'truncated' && e.retryable,
  );
});

test('cancellation aborts a download', async () => {
  const controller = new AbortController();
  const fetchImpl = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const p = downloadToBlob('https://x/', { fetchImpl, signal: controller.signal });
  controller.abort();
  await assert.rejects(p, (e) => e.code === 'cancelled');
});
