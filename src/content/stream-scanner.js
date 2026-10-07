/*
 * Stream page scanner (/c/<courseId>).
 *
 * The stream mixes announcements with short "new assignment/material" notices
 * that point at classwork. Announcements are exported; notices are returned as
 * references so classwork that is missing from the Classwork list (e.g. still
 * loading) is not silently dropped. The stream loads older posts on scroll.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});

  function isCourseworkNotice(data, key) {
    if (!data.kind || data.kind === 'p') return false;
    if (data.urlItemId && GCX.url.idKey(data.urlItemId) === key) return true;
    const attachments = data.resources.filter((r) => r.source === 'attachment');
    return attachments.length === 0 && (data.description || '').length < 200;
  }

  async function scan(ctx, { signal, report, assertPage }) {
    const doc = document;
    const warnings = [];
    report({ message: 'Waiting for the Stream to load…' });
    const listState = await GCX.pageLoader.waitForList(doc, { signal });
    assertPage();
    const classInfo = GCX.classInfo.detect(doc, location.href);
    if (!listState.items) {
      if (!GCX.pageLoader.hasClassShell(doc, ctx.courseId)) {
        warnings.push('The Stream page could not be recognized; announcements were skipped.');
      }
      return { classInfo, announcements: [], refs: GCX.classwork.harvestItemLinks(doc, ctx), warnings };
    }
    report({ message: 'Loading older posts…', itemsFound: listState.items });
    const loaded = await GCX.pageLoader.loadAll(doc, {
      signal,
      onProgress: (n) => report({ message: 'Loading older posts…', itemsFound: n }),
    });
    assertPage();
    if (!loaded.complete) warnings.push('Stopped loading older Stream posts after many attempts; some announcements may be missing.');

    const roots = GCX.extract.findItemRoots(doc.body);
    const announcements = [];
    const refs = [];
    roots.forEach((r, i) => {
      GCX.throwIfAborted(signal);
      report({ message: `Reading stream post ${i + 1}/${roots.length}`, itemIndex: i + 1, itemTotal: roots.length });
      let data;
      try {
        data = GCX.extract.extractItem(r.el, { mode: 'stream', courseId: ctx.courseId, itemKey: r.key, baseUrl: doc.baseURI });
      } catch (err) {
        warnings.push(`A stream post could not be read (${err.message}).`);
        return;
      }
      if (isCourseworkNotice(data, r.key)) {
        refs.push({ key: GCX.url.idKey(data.urlItemId || r.rawId), rawId: data.urlItemId || r.rawId, kind: data.kind, detailUrl: data.detailUrl, title: null });
        return;
      }
      announcements.push({
        key: r.key,
        rawId: r.rawId,
        urlItemId: null,
        title: null,
        kind: 'p',
        detailUrl: null,
        topic: null,
        description: data.description || '',
        resources: data.resources,
        meta: data.meta,
        order: i,
        sources: ['stream'],
        warnings: data.warnings || [],
      });
    });
    refs.push(...GCX.classwork.harvestItemLinks(doc, ctx));
    return { classInfo, announcements, refs, warnings };
  }

  GCX.stream = { scan, isCourseworkNotice };
})(globalThis);
