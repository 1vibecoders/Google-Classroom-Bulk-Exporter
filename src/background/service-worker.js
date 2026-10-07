// Background service worker: routes messages between the popup, the content
// script in the Classroom tab and the offscreen archive builder, and reacts
// to tab and download events. All listeners are registered synchronously at
// start-up so events wake the worker after it has been suspended.

import '../shared/protocol.js';
import * as jobs from './job-controller.js';

const P = globalThis.GCX_PROTOCOL;

function respond(promise, sendResponse) {
  promise
    .then((value) => sendResponse({ ok: true, value }))
    .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
  return true; // keep the channel open for the async response
}

function swallow(promise) {
  promise.catch((err) => console.error('[Classroom Exporter]', err));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== P.TARGET.BACKGROUND) return false;
  switch (message.type) {
    // Popup commands
    case P.MSG.POPUP_GET_STATE:
      return respond(jobs.getState(), sendResponse);
    case P.MSG.POPUP_INSPECT_TAB:
      return respond(jobs.inspectTab(message.tabId), sendResponse);
    case P.MSG.POPUP_START:
      return respond(jobs.startJob(message), sendResponse);
    case P.MSG.POPUP_CANCEL:
      return respond(jobs.cancelJob(), sendResponse);
    case P.MSG.POPUP_RESET:
      return respond(jobs.resetJob(), sendResponse);
    case P.MSG.POPUP_SHOW_ARCHIVE:
      return respond(jobs.showArchive(), sendResponse);
    case P.MSG.POPUP_RETRY_SAVE:
      return respond(jobs.retrySave(), sendResponse);

    // Content script events
    case P.MSG.CS_PROGRESS:
      swallow(jobs.onContentProgress(message));
      return false;
    case P.MSG.CS_STEP_RESULT:
      swallow(jobs.onStepResult(message));
      return false;
    case P.MSG.CS_STEP_ERROR:
      swallow(jobs.onStepError(message));
      return false;

    // Offscreen engine events
    case P.MSG.ENGINE_READY:
      return false;
    case P.MSG.ENGINE_PROGRESS:
      swallow(jobs.onEngineProgress(message));
      return false;
    case P.MSG.ENGINE_CLASS_DONE:
      swallow(jobs.onEngineClassDone(message).catch((err) => jobs.failJob(message.jobId, err.message)));
      return false;
    case P.MSG.ENGINE_WATCHDOG:
      swallow(jobs.checkActivity());
      return false;
    case P.MSG.ENGINE_DONE:
      swallow(jobs.onEngineDone(message).catch((err) => jobs.failJob(message.jobId, `Saving the archive failed: ${err.message}`)));
      return false;
    case P.MSG.ENGINE_ERROR:
      swallow(jobs.onEngineError(message));
      return false;
    default:
      return false;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.status) return;
  swallow(jobs.onTabUpdated(tabId, changeInfo, tab));
});

chrome.tabs.onRemoved.addListener((tabId) => swallow(jobs.onTabRemoved(tabId)));

chrome.downloads.onChanged.addListener((delta) => swallow(jobs.onDownloadChanged(delta)));
