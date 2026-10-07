// Lifecycle of the offscreen document that runs the export engine.

import '../shared/protocol.js';

const P = globalThis.GCX_PROTOCOL;
const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';

let creating = null;

async function hasDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen() {
  if (await hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'Download class attachments and build the ZIP archive locally until it is saved.',
      })
      .catch((err) => {
        if (!/single offscreen document/i.test(String(err && err.message))) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

export async function closeOffscreen() {
  try {
    if (await hasDocument()) await chrome.offscreen.closeDocument();
  } catch (_) {
    /* already closed */
  }
}

/** Send to the offscreen document, retrying briefly while it starts up. */
export async function sendToOffscreen(message, { attempts = 20 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await chrome.runtime.sendMessage({ target: P.TARGET.OFFSCREEN, ...message });
      if (res !== undefined) return res;
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw lastError || new Error('The archive builder did not respond.');
}

export async function pingOffscreen() {
  if (!(await hasDocument())) return null;
  try {
    return await sendToOffscreen({ type: P.MSG.OFF_PING }, { attempts: 2 });
  } catch (_) {
    return null;
  }
}
