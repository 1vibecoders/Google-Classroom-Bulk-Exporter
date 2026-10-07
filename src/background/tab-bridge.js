// Talking to the Classroom tab: on-demand content-script injection and
// messaging. Nothing is injected into pages until the user opens the popup
// on a Classroom tab.

import '../shared/protocol.js';

const P = globalThis.GCX_PROTOCOL;

export const CONTENT_FILES = [
  'src/shared/protocol.js',
  'src/content/namespace.js',
  'src/content/dom-utils.js',
  'src/content/url-model.js',
  'src/content/resource-classifier.js',
  'src/content/item-extractor.js',
  'src/content/class-info.js',
  'src/content/page-loader.js',
  'src/content/classwork-scanner.js',
  'src/content/stream-scanner.js',
  'src/content/detail-loader.js',
  'src/content/discovery.js',
  'src/content/content-main.js',
];

export async function sendToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, { target: P.TARGET.CONTENT, ...message }, { frameId: 0 });
}

/** Ping the content script; resolves null when it is not (or no longer) there. */
export async function pingTab(tabId) {
  try {
    const res = await sendToTab(tabId, { type: P.MSG.CS_PING });
    return res && res.ok ? res : null;
  } catch (_) {
    return null;
  }
}

/** Make sure the current version of the content scripts runs in the tab. */
export async function ensureContentScript(tabId) {
  const ping = await pingTab(tabId);
  if (ping && ping.version === P.VERSION) return;
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: CONTENT_FILES });
  const after = await pingTab(tabId);
  if (!after) throw new Error('Could not start the exporter in the Classroom tab. Reload the page and try again.');
}

export async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}
