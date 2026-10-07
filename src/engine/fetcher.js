// Authenticated downloads with the user's existing Google session.
//
// Requests are made from the extension (host permissions for the Google
// file hosts), so the browser attaches the user's own Google cookies; Google
// decides what the user may download exactly as it does in a normal tab.
// HTML responses where a file was expected are inspected so failures can be
// reported precisely (sign-in page, no access, quota, virus-scan warning).

import { crc32Update } from './crc32.js';
import { parseContentDisposition } from './filenames.js';

export class DownloadError extends Error {
  constructor(message, { code = 'error', retryable = false, status = null, retryAfterMs = null, nextUrl = null } = {}) {
    super(message);
    this.name = 'DownloadError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.nextUrl = nextUrl;
  }
}

const BATCH_BYTES = 8 * 1024 * 1024;

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Find Drive's "can't scan for viruses — Download anyway" form and build its URL. */
export function findConfirmUrl(html, pageUrl) {
  const form = /<form[^>]*id=["']download-form["'][^>]*>([\s\S]*?)<\/form>/i.exec(html) ||
    /<form[^>]*action=["'][^"']*\/(?:download|uc)[^"']*["'][^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (form) {
    const action = /action=["']([^"']+)["']/i.exec(form[0]);
    if (action) {
      const url = new URL(decodeEntities(action[1]), pageUrl);
      const inputs = form[1].matchAll(/<input\b[^>]*>/gi);
      for (const input of inputs) {
        const name = /name=["']([^"']+)["']/i.exec(input[0]);
        const value = /value=["']([^"']*)["']/i.exec(input[0]);
        if (name && value) url.searchParams.set(decodeEntities(name[1]), decodeEntities(value[1]));
      }
      if (url.searchParams.get('id')) return url.href;
    }
  }
  const link = /href=["']([^"']*(?:\/uc\?|\/download\?)[^"']*confirm=[^"']+)["']/i.exec(html);
  if (link) return new URL(decodeEntities(link[1]), pageUrl).href;
  return null;
}

/** Classify an HTML page returned instead of a file. */
export function analyzeHtml(html, pageUrl) {
  const text = html.slice(0, 200000);
  const confirmUrl = findConfirmUrl(text, pageUrl);
  if (confirmUrl) {
    return new DownloadError('Google Drive showed a "can\'t scan for viruses" warning', { code: 'interstitial', nextUrl: confirmUrl });
  }
  if (/accounts\.google\.com\/(ServiceLogin|v3\/signin|signin)|<title>\s*Sign in/i.test(text)) {
    return new DownloadError('Google asked to sign in. Make sure you are signed in to the account used for this class.', { code: 'auth' });
  }
  if (/(too many users have viewed or downloaded|download quota|quota (for this file )?(has been|is) exceeded)/i.test(text)) {
    return new DownloadError('Google Drive download quota exceeded for this file; try again later.', { code: 'quota' });
  }
  if (/(you need (access|permission)|request access|access denied|don't have permission|do not have permission)/i.test(text)) {
    return new DownloadError('You do not have access to this file (it may not be shared with you, or downloading is disabled by the owner).', { code: 'forbidden' });
  }
  if (/(file (you have requested )?does not exist|file is in the owner's trash|not found)/i.test(text)) {
    return new DownloadError('The file no longer exists or is not shared with you.', { code: 'not-found' });
  }
  return new DownloadError('Google returned a web page instead of the file (the file may not be downloadable).', { code: 'unexpected-html' });
}

function retryAfter(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * Download one URL into a Blob, computing its CRC-32 while streaming.
 * @returns {Promise<{blob:Blob, size:number, crc:number, contentType:string, headerName:(string|null), finalUrl:string}>}
 */
export async function downloadToBlob(url, { signal, onBytes, inactivityMs = 60000, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
    signal.addEventListener('abort', onAbort, { once: true });
  }
  let idleTimer = null;
  let timedOut = false;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, inactivityMs);
  };
  try {
    armIdle();
    let response;
    try {
      response = await fetchImpl(url, { credentials: 'include', redirect: 'follow', cache: 'no-store', signal: controller.signal });
    } catch (err) {
      if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
      if (timedOut) throw new DownloadError('The server stopped responding (timeout).', { code: 'timeout', retryable: true });
      throw new DownloadError(`Network error (${err.message || 'request failed'}).`, { code: 'network', retryable: true });
    }
    const finalUrl = response.url || url;
    if (/^https:\/\/accounts\.google\.com\//.test(finalUrl)) {
      throw new DownloadError('Google asked to sign in. Make sure you are signed in to the account used for this class.', { code: 'auth' });
    }
    if (response.status === 401 || response.status === 403) {
      throw new DownloadError(`Access denied (HTTP ${response.status}): the file may not be shared with you, or downloading is disabled by the owner.`, { code: 'forbidden', status: response.status });
    }
    if (response.status === 404 || response.status === 410) {
      throw new DownloadError(`File not found (HTTP ${response.status}); it may have been deleted or is not shared with you.`, { code: 'not-found', status: response.status });
    }
    if (response.status === 429) {
      throw new DownloadError('Google is rate-limiting downloads (HTTP 429).', { code: 'rate-limited', retryable: true, status: 429, retryAfterMs: retryAfter(response) });
    }
    if (response.status >= 500) {
      throw new DownloadError(`Google server error (HTTP ${response.status}).`, { code: 'server', retryable: true, status: response.status, retryAfterMs: retryAfter(response) });
    }
    if (!response.ok) {
      throw new DownloadError(`Download request failed (HTTP ${response.status}).`, { code: 'http', status: response.status });
    }

    const contentType = response.headers.get('content-type') || '';
    const disposition = response.headers.get('content-disposition') || '';
    const headerName = parseContentDisposition(disposition);
    const isAttachment = /attachment/i.test(disposition) || !!headerName;
    if (/text\/html/i.test(contentType) && !isAttachment) {
      const html = await response.text();
      throw analyzeHtml(html, finalUrl);
    }

    const total = Number(response.headers.get('content-length')) || null;
    const parts = [];
    let batch = [];
    let batchBytes = 0;
    let size = 0;
    let crc = 0;
    if (!response.body) {
      const buf = new Uint8Array(await response.arrayBuffer());
      crc = crc32Update(crc, buf);
      size = buf.length;
      parts.push(buf);
    } else {
      const reader = response.body.getReader();
      for (;;) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (signal && signal.aborted) throw new DownloadError('Cancelled', { code: 'cancelled' });
          if (timedOut) throw new DownloadError('The download stalled (timeout).', { code: 'timeout', retryable: true });
          throw new DownloadError(`Network error during download (${err.message || 'connection lost'}).`, { code: 'network', retryable: true });
        }
        if (chunk.done) break;
        armIdle();
        const value = chunk.value;
        crc = crc32Update(crc, value);
        size += value.length;
        batch.push(value);
        batchBytes += value.length;
        if (batchBytes >= BATCH_BYTES) {
          // Hand the bytes to the browser's blob storage to keep JS memory low.
          parts.push(new Blob(batch));
          batch = [];
          batchBytes = 0;
        }
        if (onBytes) onBytes(size, total);
      }
    }
    if (batch.length) parts.push(new Blob(batch));
    if (total && size < total) {
      throw new DownloadError(`Download ended early (${size} of ${total} bytes).`, { code: 'truncated', retryable: true });
    }
    const blob = new Blob(parts, { type: contentType.split(';')[0].trim() || 'application/octet-stream' });
    return { blob, size, crc, contentType, headerName, finalUrl };
  } finally {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new DownloadError('Cancelled', { code: 'cancelled' }));
    const t = setTimeout(done, ms);
    function done() {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      reject(new DownloadError('Cancelled', { code: 'cancelled' }));
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wait until the browser reports a network connection (up to `maxMs`). */
async function waitForOnline(signal, maxMs = 120000) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false || typeof addEventListener !== 'function') return;
  await Promise.race([
    new Promise((resolve) => addEventListener('online', resolve, { once: true })),
    sleep(maxMs, signal),
  ]);
}

/**
 * Download with retries for transient failures (network, timeouts, 429, 5xx)
 * and one follow-up for Drive's virus-scan warning page.
 */
export async function downloadWithRetry(url, { signal, onBytes, retries = 3, onRetry, fetchImpl, baseDelayMs = 1000 } = {}) {
  let attempt = 0;
  let current = url;
  let followedConfirm = false;
  for (;;) {
    try {
      return await downloadToBlob(current, { signal, onBytes, fetchImpl });
    } catch (err) {
      if (!(err instanceof DownloadError)) throw err;
      if (err.code === 'cancelled') throw err;
      if (err.code === 'interstitial' && err.nextUrl && !followedConfirm) {
        followedConfirm = true;
        current = err.nextUrl;
        continue;
      }
      if (!err.retryable || attempt >= retries) throw err;
      attempt++;
      if (err.code === 'network') await waitForOnline(signal);
      const backoff = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * baseDelayMs * 0.5);
      const delay = Math.min(30000, Math.max(backoff, err.retryAfterMs || 0));
      if (onRetry) onRetry(attempt, delay, err);
      await sleep(delay, signal);
    }
  }
}
