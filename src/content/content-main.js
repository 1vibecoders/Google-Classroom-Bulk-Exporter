/*
 * Content-script entry point: message handling between the background
 * service worker and the discovery steps. Injected last.
 *
 * Long-running steps acknowledge immediately and report their result with a
 * separate message, so a step never depends on one long-lived message
 * channel (which the service worker could drop when it is suspended).
 */
(function (root) {
  'use strict';
  const GCX = root.GCX;
  const P = root.GCX_PROTOCOL;

  const state = { jobId: null, step: null, controller: null };

  function send(message) {
    try {
      return chrome.runtime.sendMessage({ target: P.TARGET.BACKGROUND, ...message }).catch(() => {});
    } catch (_) {
      // Extension was reloaded or updated: this copy of the script is orphaned.
      if (state.controller) state.controller.abort();
      return Promise.resolve();
    }
  }

  function makeReporter(jobId, step) {
    let last = 0;
    let pending = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      const progress = pending;
      pending = null;
      last = Date.now();
      send({ type: P.MSG.CS_PROGRESS, jobId, step, progress });
    };
    return (progress) => {
      pending = { ...(pending || {}), ...progress };
      const wait = 250 - (Date.now() - last);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    };
  }

  function serializeError(err) {
    return {
      message: (err && err.message) || String(err),
      code: (err && err.code) || (err && err.name) || 'error',
    };
  }

  async function runStep(message) {
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    state.jobId = message.jobId;
    state.step = message.step;
    const report = makeReporter(message.jobId, message.step);
    const heartbeat = setInterval(() => report({ heartbeat: Date.now() }), 5000);
    try {
      const result = await GCX.discovery.runStep(message.step, message.payload, { signal: controller.signal, report });
      if (controller.signal.aborted) return;
      await send({ type: P.MSG.CS_STEP_RESULT, jobId: message.jobId, step: message.step, result });
    } catch (err) {
      if (controller.signal.aborted && !(err instanceof GCX.errors.NavigatedAwayError)) return;
      await send({ type: P.MSG.CS_STEP_ERROR, jobId: message.jobId, step: message.step, error: serializeError(err) });
    } finally {
      clearInterval(heartbeat);
      if (state.controller === controller) {
        state.controller = null;
        state.jobId = null;
        state.step = null;
      }
    }
  }

  function onMessage(message, sender, sendResponse) {
    if (!message || message.target !== P.TARGET.CONTENT) return false;
    switch (message.type) {
      case P.MSG.CS_PING:
        sendResponse({ ok: true, version: P.VERSION, jobId: state.jobId, step: state.step, url: location.href });
        return false;
      case P.MSG.CS_INSPECT:
        try {
          sendResponse({ ok: true, info: GCX.discovery.inspect() });
        } catch (err) {
          sendResponse({ ok: false, error: serializeError(err) });
        }
        return false;
      case P.MSG.CS_RUN_STEP:
        runStep(message);
        sendResponse({ accepted: true });
        return false;
      case P.MSG.CS_CANCEL:
        if (state.controller && (!message.jobId || message.jobId === state.jobId)) state.controller.abort();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  }

  // Replace the listener of a previous injection (e.g. after the extension
  // was reloaded) instead of stacking duplicates.
  if (root.__gcxMessageListener) {
    try {
      chrome.runtime.onMessage.removeListener(root.__gcxMessageListener);
    } catch (_) {
      /* old runtime is gone */
    }
  }
  root.__gcxMessageListener = onMessage;
  chrome.runtime.onMessage.addListener(onMessage);
})(globalThis);
