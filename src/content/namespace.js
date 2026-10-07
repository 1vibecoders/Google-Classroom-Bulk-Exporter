/*
 * Content-script namespace. Injected first, before every other content file.
 *
 * Content scripts are injected on demand (chrome.scripting.executeScript) as
 * classic scripts that share one isolated world, so each file wraps itself in
 * an IIFE and publishes its API on `globalThis.GCX` instead of using top-level
 * declarations (which would throw on re-injection).
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || {};
  GCX.errors = GCX.errors || {};

  /** Error raised when an export step is cancelled by the user. */
  class CancelledError extends Error {
    constructor(message = 'Export cancelled') {
      super(message);
      this.name = 'CancelledError';
      this.code = 'cancelled';
    }
  }

  /** Error raised when the user navigates away from the page being scanned. */
  class NavigatedAwayError extends Error {
    constructor(message = 'The Classroom tab navigated away while the class was being scanned.') {
      super(message);
      this.name = 'NavigatedAwayError';
      this.code = 'navigated-away';
    }
  }

  /** Error raised when the page does not look like the expected Classroom page. */
  class PageStructureError extends Error {
    constructor(message) {
      super(message);
      this.name = 'PageStructureError';
      this.code = 'page-structure';
    }
  }

  GCX.errors.CancelledError = CancelledError;
  GCX.errors.NavigatedAwayError = NavigatedAwayError;
  GCX.errors.PageStructureError = PageStructureError;

  /** Throw a CancelledError if the signal has been aborted. */
  GCX.throwIfAborted = function throwIfAborted(signal) {
    if (signal && signal.aborted) throw new CancelledError();
  };

  root.GCX = GCX;
})(globalThis);
