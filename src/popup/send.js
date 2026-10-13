// "Send to Academic Scheduler" card of the popup (src/background/scheduler-bridge.js).
// Lists the classes scanned in this browser session and sends them to the
// website address the person typed, after asking Chrome for access to that
// one website. The background does the sending, so the popup may close when
// the website tab opens.

import '../shared/protocol.js';

const P = globalThis.GCX_PROTOCOL;
const SENDABLE_KEY = 'gcx.sendable';
const SITE_KEY = 'gcx.schedulerSite';
const $ = (id) => document.getElementById(id);

/** Same rule as siteOrigin() in scheduler-bridge.js. */
function siteOrigin(text) {
  try {
    const url = new URL(String(text).trim());
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return url.origin;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  } catch {
    // not a URL
  }
  return null;
}

async function renderSendable() {
  const list = (await chrome.storage.session.get(SENDABLE_KEY))[SENDABLE_KEY] || [];
  $('send').hidden = list.length === 0;
  const names = list.map((s) => s.classInfo.name);
  $('send-classes').textContent = names.length === 1 ? `Scanned: ${names[0]}` : `${names.length} scanned classes: ${names.join(', ')}`;
}

/** `call` sends a message to the background (popup.js). */
export async function initSend(call) {
  const saved = (await chrome.storage.local.get(SITE_KEY))[SITE_KEY];
  if (saved) $('send-site').value = saved;
  await renderSendable();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && SENDABLE_KEY in changes) renderSendable();
  });
  $('send-btn').addEventListener('click', async () => {
    const status = $('send-status');
    const origin = siteOrigin($('send-site').value);
    if (!origin) {
      status.textContent = 'Enter the website address, starting with https://';
      return;
    }
    // Must run in the click: Chrome asks the person to allow this one website.
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    if (!allowed) {
      status.textContent = 'Not sent: the extension needs your permission to open that website.';
      return;
    }
    status.textContent = 'Opening the website…';
    try {
      const { classes } = await call(P.MSG.POPUP_SEND_TO_SCHEDULER, { site: origin });
      status.textContent = `Sent ${classes === 1 ? '1 class' : `${classes} classes`}. Review the changes on the website, then import.`;
    } catch (err) {
      status.textContent = (err && err.message) || String(err);
    }
  });
}
