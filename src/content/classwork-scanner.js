/*
 * Classwork page scanner (/w/<courseId>/t/all).
 *
 * 1. Wait for the list and scroll until every item is loaded.
 * 2. Map items to topics (topic headers link to /w/<course>/tc/<topicId>).
 * 3. Expand each collapsed row (its [aria-expanded] toggle), wait for the
 *    expanded content to settle, extract it, and collapse it again.
 * Rows are re-located by id after every interaction because Classroom may
 * re-render them.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  function cssEscape(value) {
    if (root.CSS && root.CSS.escape) return root.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function findRootByKey(doc, key, rawId) {
    const direct = dom().outermost(Array.from(doc.querySelectorAll(`[${GCX.extract.ITEM_ATTR}="${cssEscape(rawId)}"]`)));
    if (direct.length) return direct[0];
    const match = GCX.extract.findItemRoots(doc.body || doc).find((r) => r.key === key);
    return match ? match.el : null;
  }

  // ---------------------------------------------------------------------------
  // Topics
  // ---------------------------------------------------------------------------

  /**
   * Assign each item to a topic. A topic header is a link to the topic view
   * (strong signal) or, if there are none, a heading outside of items. The
   * header's section is the largest ancestor that contains items but no other
   * topic header; headers in the navigation drawer never qualify because their
   * ancestors contain every other topic link too.
   */
  function mapTopics(doc, roots, ctx) {
    const headers = [];
    for (const a of doc.querySelectorAll('a[href]')) {
      if (a.closest(`[${GCX.extract.ITEM_ATTR}], nav, [role="navigation"]`)) continue;
      const href = dom().resolveHref(a, doc.baseURI);
      const p = href && GCX.url.parse(href);
      if (!p || p.page !== 'classwork-topic' || !GCX.url.sameId(p.courseId, ctx.courseId)) continue;
      const name = dom().splitLines(dom().textOf(a))[0] || a.getAttribute('aria-label') || null;
      headers.push({ el: a, topicId: p.topicId, name });
    }
    if (!headers.length) {
      for (const h of doc.querySelectorAll('h2, h3, [role="heading"]')) {
        if (h.closest(`[${GCX.extract.ITEM_ATTR}]`)) continue;
        const name = dom().normalizeInline(dom().textOf(h));
        if (name) headers.push({ el: h, topicId: null, name, weak: true });
      }
    }
    const topicKey = (h) => h.topicId || h.name;
    const rootEls = roots.map((r) => r.el);
    const found = [];
    for (const header of headers) {
      let section = null;
      for (let p = header.el.parentElement; p; p = p.parentElement) {
        // Another topic's header inside this ancestor => we left the section.
        const otherHeader = headers.some((h) => h !== header && topicKey(h) !== topicKey(header) && p.contains(h.el));
        if (otherHeader) break;
        if (rootEls.some((r) => p.contains(r))) section = p;
      }
      if (section) found.push({ ...header, section });
    }
    // A second copy of a topic link (e.g. in a menu) can produce an outer
    // section that wraps the real one; keep the innermost per topic.
    let sections = found.filter(
      (s, i) =>
        !found.some((o, j) => j !== i && topicKey(o) === topicKey(s) && o.section !== s.section && s.section.contains(o.section)) &&
        found.findIndex((o) => o.section === s.section && topicKey(o) === topicKey(s)) === i,
    );
    // A lone plain heading wrapping every item is a page title, not a topic.
    if (sections.length === 1 && sections[0].weak && rootEls.every((r) => sections[0].section.contains(r))) sections = [];
    const topics = new Map();
    const assignment = new Map();
    for (const r of roots) {
      let best = null;
      for (const s of sections) {
        if (s.section.contains(r.el) && (!best || best.section.contains(s.section))) best = s;
      }
      if (best && best.name) {
        assignment.set(r.key, best.name);
        const id = best.topicId || best.name;
        if (!topics.has(id)) topics.set(id, { id: best.topicId, name: best.name });
      }
    }
    // Topics without items still belong to the class structure.
    for (const s of sections) {
      const id = s.topicId || s.name;
      if (s.name && !topics.has(id)) topics.set(id, { id: s.topicId, name: s.name });
    }
    const orderedTopics = dom()
      .sortInDocumentOrder(sections.map((s) => s.el))
      .map((el) => sections.find((s) => s.el === el))
      .filter((s, i, arr) => s.name && arr.findIndex((x) => (x.topicId || x.name) === (s.topicId || s.name)) === i)
      .map((s) => ({ id: s.topicId, name: s.name }));
    return { byItem: assignment, topics: orderedTopics.length ? orderedTopics : Array.from(topics.values()) };
  }

  // ---------------------------------------------------------------------------
  // Expansion
  // ---------------------------------------------------------------------------

  function isExpanded(doc, key, rawId) {
    const el = findRootByKey(doc, key, rawId);
    const toggle = el && GCX.extract.findToggle(el);
    return !toggle || toggle.getAttribute('aria-expanded') === 'true';
  }

  async function setExpanded(doc, key, rawId, want, signal) {
    const el = findRootByKey(doc, key, rawId);
    const toggle = el && GCX.extract.findToggle(el);
    if (!toggle) return false;
    if ((toggle.getAttribute('aria-expanded') === 'true') === want) return false;
    dom().scrollIntoViewSafe(toggle);
    const attempts = [
      (t) => t.click(),
      (t) => dom().clickElement(t),
      (t) => {
        const view = t.ownerDocument.defaultView;
        t.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        t.dispatchEvent(new view.KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      },
    ];
    const before = location.href;
    for (const attempt of attempts) {
      const current = GCX.extract.findToggle(findRootByKey(doc, key, rawId) || el) || toggle;
      attempt(current);
      const ok = await dom().waitFor(() => location.href !== before || isExpanded(doc, key, rawId) === want, { root: doc, timeout: 2500, signal });
      if (location.href !== before) {
        // The row opened the item page instead of expanding: go back.
        history.back();
        await dom().waitFor(() => location.href === before && findRootByKey(doc, key, rawId), { root: doc, timeout: 15000, signal });
        await GCX.pageLoader.waitForList(doc, { signal, timeout: 15000 });
        return 'navigated';
      }
      if (ok) return true;
    }
    return false;
  }

  async function waitForExpandedContent(doc, key, rawId, signal) {
    await dom().waitForQuiet(doc, { quietMs: 350, timeout: 5000, signal });
    await dom().waitFor(() => {
      const el = findRootByKey(doc, key, rawId);
      return el && !dom().isBusy(el);
    }, { root: doc, timeout: 8000, signal });
  }

  // ---------------------------------------------------------------------------
  // Item links anywhere on the page (cross-check against the list)
  // ---------------------------------------------------------------------------

  /** Links to coursework/announcements of this course outside of item rows. */
  function harvestItemLinks(doc, ctx) {
    const refs = new Map();
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = dom().resolveHref(a, doc.baseURI);
      const p = href && GCX.url.parse(href);
      if (!p || !p.itemId || !GCX.url.sameId(p.courseId, ctx.courseId)) continue;
      const key = GCX.url.idKey(p.itemId);
      if (!refs.has(key)) {
        refs.set(key, {
          key,
          rawId: p.itemId,
          kind: p.itemKind,
          detailUrl: GCX.url.canonical(href),
          title: dom().splitLines(dom().textOf(a))[0] || null,
        });
      }
    }
    return Array.from(refs.values());
  }

  // ---------------------------------------------------------------------------
  // Scan
  // ---------------------------------------------------------------------------

  async function scan(ctx, { signal, report, assertPage }) {
    const doc = document;
    const warnings = [];
    report({ message: 'Waiting for the Classwork page to load…' });
    const listState = await GCX.pageLoader.waitForList(doc, { signal });
    assertPage();
    if (!listState.items) {
      if (!GCX.pageLoader.hasClassShell(doc, ctx.courseId)) {
        throw new GCX.errors.PageStructureError(
          'The Classwork page did not load or could not be recognized (Google may have changed Classroom).',
        );
      }
      if (!listState.settled) warnings.push('The Classwork page kept changing while loading; it may be incomplete.');
      warnings.push('No classwork was found on the Classwork page. If this class does have assignments or materials, Google may have changed Classroom and the exporter needs an update.');
      return { items: [], topics: [], refs: harvestItemLinks(doc, ctx), warnings, stats: { listed: 0 } };
    }

    report({ message: 'Loading all classwork…', itemsFound: listState.items });
    const loaded = await GCX.pageLoader.loadAll(doc, {
      signal,
      onProgress: (n) => report({ message: 'Loading all classwork…', itemsFound: n }),
    });
    assertPage();
    if (!loaded.complete) warnings.push('Stopped loading the Classwork list after many attempts; it may be incomplete.');

    const roots = GCX.extract.findItemRoots(doc.body);
    const topicMap = mapTopics(doc, roots, ctx);
    const items = [];
    let canExpand = true;
    for (let i = 0; i < roots.length; i++) {
      GCX.throwIfAborted(signal);
      assertPage();
      const { key, rawId } = roots[i];
      const el = findRootByKey(doc, key, rawId);
      if (!el) {
        warnings.push(`A classwork item disappeared from the page while scanning (id ${rawId}).`);
        continue;
      }
      const baseCtx = { mode: 'row', courseId: ctx.courseId, itemKey: key, baseUrl: doc.baseURI };
      const summary = GCX.extract.extractRowSummary(el, baseCtx);
      report({
        message: `Reading classwork ${i + 1}/${roots.length}`,
        current: summary.title || '',
        itemIndex: i + 1,
        itemTotal: roots.length,
        itemsFound: roots.length,
      });

      let expandedByUs = false;
      const itemWarnings = [];
      if (canExpand && summary.hasToggle && !summary.expanded) {
        const outcome = await setExpanded(doc, key, rawId, true, signal);
        if (outcome === 'navigated') {
          canExpand = false;
          warnings.push('Classwork rows open the item page instead of expanding; details are read from item pages.');
        } else if (outcome) {
          expandedByUs = true;
          await waitForExpandedContent(doc, key, rawId, signal);
        } else {
          itemWarnings.push('Could not expand this item on the Classwork page.');
        }
      }
      const current = findRootByKey(doc, key, rawId) || el;
      let data;
      try {
        data = GCX.extract.extractItem(current, baseCtx);
      } catch (err) {
        itemWarnings.push(`Classwork row could not be read: ${err.message}`);
        data = { title: summary.title, kind: summary.kind.kind, detailUrl: summary.kind.detailUrl, description: '', resources: [], meta: summary.meta, warnings: [] };
      }
      if (expandedByUs) await setExpanded(doc, key, rawId, false, signal).catch(() => {});

      items.push({
        key,
        rawId,
        urlItemId: data.urlItemId || null,
        title: data.title || summary.title || null,
        kind: data.kind || summary.kind.kind || null,
        detailUrl: data.detailUrl || summary.kind.detailUrl || null,
        topic: topicMap.byItem.get(key) || null,
        description: data.description || '',
        resources: data.resources || [],
        meta: mergeMeta(summary.meta, data.meta),
        order: i,
        sources: ['classwork-list'],
        warnings: [...itemWarnings, ...(data.warnings || [])],
      });
    }
    return {
      items,
      topics: topicMap.topics,
      refs: harvestItemLinks(doc, ctx),
      warnings,
      stats: { listed: roots.length, loadRounds: loaded.rounds },
    };
  }

  function mergeMeta(a = {}, b = {}) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) out[k] = b[k] || a[k] || null;
    return out;
  }

  GCX.classwork = { scan, mapTopics, harvestItemLinks, mergeMeta, findRootByKey };
})(globalThis);
