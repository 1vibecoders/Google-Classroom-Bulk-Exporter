/*
 * Waiting for Classroom's dynamic content.
 *
 * Classroom renders lists client-side and appends more items as the user
 * scrolls. Instead of fixed delays we observe the DOM and treat a page as
 * "loaded" when the number of items stops growing after scrolling to the end,
 * no loading indicator ([role=progressbar], [aria-busy=true]) is visible and
 * the DOM has been quiet for a short period.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  const LOAD_MORE_RE = /^(view|show|load|see)\s+(all|more)\b|^(older posts|more posts)$/i;

  function countItems(doc) {
    return GCX.extract.findItemRoots(doc.body || doc).length;
  }

  /** True if the page shows the class shell (tabs/links for this course). */
  function hasClassShell(doc, courseId) {
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = dom().resolveHref(a, doc.baseURI);
      if (!href) continue;
      const p = GCX.url.parse(href);
      if (p.courseId && GCX.url.sameId(p.courseId, courseId)) return true;
    }
    return false;
  }

  /**
   * Wait until the page has rendered its list: either items exist, or the page
   * is idle (quiet DOM, no spinner) for `settleMs`, meaning the list is empty.
   * @returns {Promise<{items:number, settled:boolean}>}
   */
  async function waitForList(doc, { signal, timeout = 30000, settleMs = 2500 } = {}) {
    const started = Date.now();
    const found = await dom().waitFor(() => countItems(doc) > 0, { root: doc, timeout: Math.min(timeout, 15000), signal });
    if (found) {
      await dom().waitForQuiet(doc, { quietMs: 400, timeout: 4000, signal });
      return { items: countItems(doc), settled: true };
    }
    // Nothing yet: wait for the page to go idle, then look again.
    while (Date.now() - started < timeout) {
      GCX.throwIfAborted(signal);
      const quiet = await dom().waitForQuiet(doc, { quietMs: settleMs, timeout: 5000, signal });
      if (countItems(doc) > 0) return { items: countItems(doc), settled: true };
      if (quiet && !dom().isBusy(doc)) return { items: 0, settled: true };
    }
    return { items: countItems(doc), settled: false };
  }

  function findLoadMoreButton(doc) {
    const candidates = doc.querySelectorAll('button, [role="button"], a[role="button"]');
    for (const el of candidates) {
      if (el.closest(`[${GCX.extract.ITEM_ATTR}]`)) continue;
      if (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') continue;
      if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
      const text = dom().normalizeInline(el.textContent) || el.getAttribute('aria-label') || '';
      if (LOAD_MORE_RE.test(text.trim()) && dom().isVisible(el)) return el;
    }
    return null;
  }

  function scrollToEnd(doc) {
    const roots = GCX.extract.findItemRoots(doc.body || doc);
    const last = roots.length ? roots[roots.length - 1].el : null;
    const scroller = dom().findScrollContainer(last || doc.body);
    if (last) dom().scrollIntoViewSafe(last);
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const win = doc.defaultView;
    if (win) win.scrollTo(0, doc.documentElement.scrollHeight);
    return scroller;
  }

  /**
   * Scroll (and press "show more"-style buttons) until no new items appear.
   * @returns {Promise<{items:number, rounds:number, complete:boolean}>}
   */
  async function loadAll(doc, { signal, onProgress, maxRounds = 200, growthTimeout = 4000 } = {}) {
    let stableRounds = 0;
    let rounds = 0;
    let lastCount = countItems(doc);
    let scroller = null;
    while (rounds < maxRounds) {
      GCX.throwIfAborted(signal);
      rounds++;
      scroller = scrollToEnd(doc) || scroller;
      const button = findLoadMoreButton(doc);
      if (button) dom().clickElement(button);
      const grew = await dom().waitFor(() => countItems(doc) > lastCount, { root: doc, timeout: growthTimeout, signal });
      if (!grew && dom().isBusy(doc)) {
        // Still fetching: wait for the spinner to go away before deciding.
        await dom().waitFor(() => !dom().isBusy(doc), { root: doc, timeout: 20000, signal });
      }
      const count = countItems(doc);
      if (onProgress) onProgress(count);
      if (count > lastCount) {
        lastCount = count;
        stableRounds = 0;
        continue;
      }
      stableRounds++;
      if (stableRounds >= 2 && !dom().isBusy(doc)) {
        restoreScroll(doc, scroller);
        return { items: count, rounds, complete: true };
      }
    }
    restoreScroll(doc, scroller);
    return { items: countItems(doc), rounds, complete: false };
  }

  function restoreScroll(doc, scroller) {
    try {
      if (scroller) scroller.scrollTop = 0;
      if (doc.defaultView) doc.defaultView.scrollTo(0, 0);
    } catch (_) {
      /* ignore */
    }
  }

  GCX.pageLoader = { countItems, hasClassShell, waitForList, loadAll, findLoadMoreButton };
})(globalThis);
