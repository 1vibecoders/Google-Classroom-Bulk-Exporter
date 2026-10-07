/*
 * Message protocol shared by every extension context.
 *
 * This file is deliberately a plain script (no import/export) so the same
 * source can be:
 *   - injected as a classic content script (chrome.scripting.executeScript), and
 *   - imported for its side effect by the ES-module contexts
 *     (service worker, offscreen document, popup):  import '../shared/protocol.js';
 * Either way it publishes `globalThis.GCX_PROTOCOL`.
 *
 * Every runtime message carries a `target` so that contexts which receive
 * broadcast messages (chrome.runtime.sendMessage reaches the service worker,
 * the popup and the offscreen document at the same time) can ignore messages
 * that are not meant for them.
 */
(function (root) {
  'use strict';

  const TARGET = Object.freeze({
    BACKGROUND: 'background',
    CONTENT: 'content',
    OFFSCREEN: 'offscreen',
  });

  const MSG = Object.freeze({
    // popup -> background
    POPUP_GET_STATE: 'popup/get-state',
    POPUP_INSPECT_TAB: 'popup/inspect-tab',
    POPUP_START: 'popup/start',
    POPUP_CANCEL: 'popup/cancel',
    POPUP_RESET: 'popup/reset',
    POPUP_SHOW_ARCHIVE: 'popup/show-archive',
    POPUP_RETRY_SAVE: 'popup/retry-save',

    // background -> content script
    CS_PING: 'cs/ping',
    CS_INSPECT: 'cs/inspect',
    CS_RUN_STEP: 'cs/run-step',
    CS_CANCEL: 'cs/cancel',

    // content script -> background
    CS_PROGRESS: 'cs/progress',
    CS_STEP_RESULT: 'cs/step-result',
    CS_STEP_ERROR: 'cs/step-error',

    // background -> offscreen document
    OFF_START: 'offscreen/start',
    OFF_CANCEL: 'offscreen/cancel',
    OFF_RELEASE: 'offscreen/release',
    OFF_PING: 'offscreen/ping',

    // offscreen document -> background
    ENGINE_READY: 'engine/ready',
    ENGINE_PROGRESS: 'engine/progress',
    ENGINE_DONE: 'engine/done',
    ENGINE_ERROR: 'engine/error',
  });

  /** Discovery steps executed by the content script, in order. */
  const STEP = Object.freeze({
    CLASSWORK: 'classwork',
    STREAM: 'stream',
    DETAILS: 'details',
  });

  /** Job phases persisted by the background service worker. */
  const PHASE = Object.freeze({
    IDLE: 'idle',
    PREPARING: 'preparing',
    DISCOVERING: 'discovering',
    SCANNED: 'scanned',
    DOWNLOADING: 'downloading',
    ZIPPING: 'zipping',
    SAVING: 'saving',
    COMPLETE: 'complete',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  });

  const ACTIVE_PHASES = Object.freeze([
    PHASE.PREPARING,
    PHASE.DISCOVERING,
    PHASE.DOWNLOADING,
    PHASE.ZIPPING,
    PHASE.SAVING,
  ]);

  /** Item types used throughout the snapshot, archive and report. */
  const ITEM_TYPE = Object.freeze({
    ASSIGNMENT: 'assignment',
    MATERIAL: 'material',
    QUESTION: 'question',
    ANNOUNCEMENT: 'announcement',
    OTHER: 'other',
  });

  const DEFAULT_OPTIONS = Object.freeze({
    includeAnnouncements: true,
    readDetailPages: true,
    googleFormat: 'office', // 'office' (docx/xlsx/pptx) or 'pdf'
    saveAs: false,
  });

  root.GCX_PROTOCOL = Object.freeze({
    VERSION: '1.0.0',
    TARGET,
    MSG,
    STEP,
    PHASE,
    ACTIVE_PHASES,
    ITEM_TYPE,
    DEFAULT_OPTIONS,
  });
})(globalThis);
