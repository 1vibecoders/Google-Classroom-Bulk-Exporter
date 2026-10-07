/*
 * Read each item's own page (".../details" or ".../p/<id>") for complete
 * instructions and attachments.
 *
 * Strategies, chosen once per run by probing the first items:
 *   fetch  - same-origin fetch (the user's Classroom session) + DOMParser,
 *            requested with hl=en so English metadata patterns apply. Cheap,
 *            works when Classroom server-renders item pages.
 *   frame  - load the page in a hidden same-origin iframe and wait for the app
 *            to render the item. Used when fetched pages are only an app shell.
 *   none   - neither worked; the Classwork-list content is used on its own and
 *            a warning is recorded.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  const KIND_GUESSES = ['a', 'm', 'sa', 'mc'];
  const PROBE_LIMIT = 3;

  class DetailError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  function withLanguage(url, lang) {
    try {
      const u = new URL(url);
      if (lang) u.searchParams.set('hl', lang);
      return u.href;
    } catch (_) {
      return url;
    }
  }

  function candidateUrls(item, ctx) {
    const urls = [];
    const id = item.urlItemId || item.rawId;
    if (item.detailUrl) urls.push(item.detailUrl);
    if (item.kind === 'p') urls.push(GCX.url.itemUrl(ctx, 'p', id));
    else if (item.kind) urls.push(GCX.url.itemUrl(ctx, item.kind, id));
    else for (const k of KIND_GUESSES) urls.push(GCX.url.itemUrl(ctx, k, id));
    return Array.from(new Set(urls));
  }

  // ---------------------------------------------------------------------------
  // fetch + DOMParser
  // ---------------------------------------------------------------------------

  async function fetchDocument(url, signal) {
    let response;
    try {
      response = await fetch(withLanguage(url, 'en'), { credentials: 'include', redirect: 'follow', signal });
    } catch (err) {
      if (signal && signal.aborted) throw new GCX.errors.CancelledError();
      throw new DetailError(`Network error while opening the item page (${err.message})`, 'network');
    }
    const finalUrl = response.url || url;
    if (/accounts\.google\.com/.test(finalUrl)) throw new DetailError('Google asked to sign in again', 'auth');
    if (response.status === 404) throw new DetailError('Item page not found (404)', 'not-found');
    if (!response.ok) throw new DetailError(`Item page returned HTTP ${response.status}`, 'http');
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return { doc, finalUrl };
  }

  // ---------------------------------------------------------------------------
  // hidden same-origin iframe
  // ---------------------------------------------------------------------------

  class FrameLoader {
    constructor() {
      this.frame = null;
    }

    ensureFrame() {
      if (this.frame && this.frame.isConnected) return this.frame;
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.title = 'Classroom Exporter helper frame';
      frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:1600px;border:0;opacity:0;pointer-events:none;';
      document.documentElement.appendChild(frame);
      this.frame = frame;
      return frame;
    }

    async load(url, itemKey, signal) {
      const frame = this.ensureFrame();
      const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
      frame.src = url;
      const ok = await Promise.race([loaded.then(() => true), dom().sleep(30000, signal).then(() => false)]);
      if (!ok) throw new DetailError('Item page did not load in time', 'timeout');
      let doc;
      try {
        doc = frame.contentDocument;
      } catch (_) {
        doc = null;
      }
      if (!doc || !doc.location || !/^https:\/\/classroom\.google\.com\//.test(doc.location.href)) {
        throw new DetailError('Classroom refused to open the item page in a frame', 'blocked');
      }
      const located = await dom().waitFor(() => GCX.extract.locateItemRoot(doc.body || doc, itemKey), { root: doc, timeout: 20000, signal });
      if (!located) throw new DetailError('Item did not render in the frame', 'no-root');
      await dom().waitForQuiet(doc, { quietMs: 500, timeout: 6000, signal });
      await dom().waitFor(() => !dom().isBusy(doc), { root: doc, timeout: 8000, signal });
      const fresh = GCX.extract.locateItemRoot(doc.body || doc, itemKey) || located;
      return { doc, finalUrl: doc.location.href, root: fresh };
    }

    dispose() {
      if (this.frame) this.frame.remove();
      this.frame = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Loading one item
  // ---------------------------------------------------------------------------

  function extractFrom(doc, located, item, ctx, finalUrl, mode) {
    const baseUrl = dom().getBaseUrl(doc, finalUrl);
    const data = GCX.extract.extractItem(located.el, {
      mode: item.kind === 'p' ? 'stream' : 'detail',
      courseId: ctx.courseId,
      itemKey: item.key,
      baseUrl,
    });
    const parsed = GCX.url.parse(finalUrl);
    return { data, url: GCX.url.canonical(finalUrl), exact: located.exact, strategy: mode, urlKind: parsed.itemKind };
  }

  function hasContent(result) {
    const d = result && result.data;
    return !!(d && (d.title || d.description || d.resources.length));
  }

  async function loadViaFetch(item, ctx, signal) {
    let lastError = null;
    for (const url of candidateUrls(item, ctx)) {
      try {
        const { doc, finalUrl } = await fetchDocument(url, signal);
        const parsed = GCX.url.parse(finalUrl);
        if (parsed.page !== 'item' && parsed.page !== 'announcement') {
          lastError = new DetailError('Classroom redirected away from the item page', 'redirected');
          continue;
        }
        const located = GCX.extract.locateItemRoot(doc.body || doc, item.key);
        if (!located) {
          const shell = !doc.querySelector(`[${GCX.extract.ITEM_ATTR}]`);
          lastError = new DetailError(shell ? 'Item page content is rendered by scripts (no server-rendered content)' : 'Item not found on its page', shell ? 'shell' : 'no-root');
          continue;
        }
        return extractFrom(doc, located, item, ctx, finalUrl, 'fetch');
      } catch (err) {
        if (err instanceof GCX.errors.CancelledError) throw err;
        lastError = err;
        if (err.code === 'auth' || err.code === 'network') break;
      }
    }
    throw lastError || new DetailError('Item page could not be read', 'unknown');
  }

  async function loadViaFrame(item, ctx, frameLoader, signal) {
    let lastError = null;
    for (const url of candidateUrls(item, ctx)) {
      try {
        const { doc, finalUrl, root: located } = await frameLoader.load(url, item.key, signal);
        return extractFrom(doc, located, item, ctx, finalUrl, 'frame');
      } catch (err) {
        if (err instanceof GCX.errors.CancelledError) throw err;
        lastError = err;
        if (err.code === 'blocked') break;
      }
    }
    throw lastError || new DetailError('Item page could not be read', 'unknown');
  }

  // ---------------------------------------------------------------------------
  // Run over all items
  // ---------------------------------------------------------------------------

  async function runPool(list, concurrency, worker) {
    let next = 0;
    const runners = Array.from({ length: Math.min(concurrency, list.length) }, async () => {
      while (next < list.length) {
        const index = next++;
        await worker(list[index], index);
      }
    });
    await Promise.all(runners);
  }

  /**
   * @param {object[]} items  snapshot items ({key, rawId, kind, detailUrl, ...})
   * @returns {Promise<{results: Object<string, object>, strategy: string, warnings: string[]}>}
   */
  async function loadAll(items, ctx, { signal, report }) {
    const results = {};
    const warnings = [];
    if (!items.length) return { results, strategy: 'none', warnings };
    const frameLoader = new FrameLoader();
    let strategy = null;
    let done = 0;
    const tick = (item) => {
      done++;
      report({
        message: `Reading item pages ${done}/${items.length}`,
        current: item.title || '',
        itemIndex: done,
        itemTotal: items.length,
      });
    };

    try {
      // Probe: find a strategy that yields content for one of the first items.
      const probeItems = items.slice(0, PROBE_LIMIT);
      const probeErrors = [];
      for (const item of probeItems) {
        try {
          const r = await loadViaFetch(item, ctx, signal);
          if (hasContent(r)) {
            strategy = 'fetch';
            results[item.key] = r;
            break;
          }
        } catch (err) {
          if (err instanceof GCX.errors.CancelledError) throw err;
          probeErrors.push(err);
          if (err.code === 'auth') throw new DetailError('Your Google session expired. Reload Classroom, sign in and try again.', 'auth');
        }
      }
      if (!strategy) {
        for (const item of probeItems) {
          try {
            const r = await loadViaFrame(item, ctx, frameLoader, signal);
            if (hasContent(r)) {
              strategy = 'frame';
              results[item.key] = r;
              break;
            }
          } catch (err) {
            if (err instanceof GCX.errors.CancelledError) throw err;
            probeErrors.push(err);
            if (err.code === 'blocked') break;
          }
        }
      }
      if (!strategy) {
        const reason = probeErrors.length ? probeErrors[probeErrors.length - 1].message : 'no content found';
        warnings.push(`Item pages could not be read (${reason}). Instructions and attachments come from the Classwork/Stream lists only and long instructions may be shortened.`);
        return { results, strategy: 'none', warnings };
      }

      const remaining = items.filter((item) => !results[item.key]);
      items.filter((item) => results[item.key]).forEach(tick);
      await runPool(remaining, strategy === 'fetch' ? 4 : 1, async (item) => {
        GCX.throwIfAborted(signal);
        try {
          results[item.key] = strategy === 'fetch' ? await loadViaFetch(item, ctx, signal) : await loadViaFrame(item, ctx, frameLoader, signal);
        } catch (err) {
          if (err instanceof GCX.errors.CancelledError) throw err;
          results[item.key] = { error: err.message, code: err.code || 'unknown' };
        }
        tick(item);
      });
    } finally {
      frameLoader.dispose();
    }
    return { results, strategy, warnings };
  }

  GCX.details = { loadAll, candidateUrls, withLanguage, DetailError };
})(globalThis);
