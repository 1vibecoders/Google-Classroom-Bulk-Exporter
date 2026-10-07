/*
 * Discovery steps run by the content script on behalf of the background
 * service worker, and the merge that turns their results into one snapshot.
 *
 * Steps run on different pages (the tab is navigated between them), so the
 * background passes earlier step results into the final "details" step,
 * which reads item pages and builds the snapshot.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const P = root.GCX_PROTOCOL;

  const TYPE_BY_KIND = { a: 'assignment', m: 'material', sa: 'question', mc: 'question', q: 'question', p: 'announcement' };

  function contextFromLocation() {
    const parsed = GCX.url.parse(location.href);
    return { courseId: parsed.courseId, authuser: parsed.authuser, prefix: parsed.prefix, page: parsed.page };
  }

  function makePageAssert(expectedPage, courseId) {
    return () => {
      const p = GCX.url.parse(location.href);
      if (!p.isClassroom || !GCX.url.sameId(p.courseId, courseId) || p.page !== expectedPage) {
        throw new GCX.errors.NavigatedAwayError();
      }
    };
  }

  /** Popup preview: which class is open, without scanning anything. */
  function inspect() {
    const parsed = GCX.url.parse(location.href);
    const info = parsed.courseId ? GCX.classInfo.detect(document, location.href) : null;
    return {
      isClassroom: parsed.isClassroom,
      courseId: parsed.courseId,
      page: parsed.page,
      authuser: parsed.authuser,
      className: info ? info.name : null,
      section: info ? info.section : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Merging
  // ---------------------------------------------------------------------------

  function normalizeForCompare(text) {
    return String(text || '').replace(/[…]+$|\.{3}$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /**
   * The item page shows the full, untruncated text (and is read in English,
   * so UI lines are filtered reliably), so it wins unless it is empty or was
   * itself cut short while the list shows more.
   */
  function chooseDescription(listText, detailText) {
    const a = normalizeForCompare(listText);
    const b = normalizeForCompare(detailText);
    if (!b) return listText || '';
    const truncated = /(…|\.\.\.)\s*$/.test(String(detailText).trim());
    if (truncated && a.length > b.length && a.startsWith(b)) return listText;
    return detailText;
  }

  function mergeResources(primary, secondary) {
    const map = new Map();
    for (const r of [...(primary || []), ...(secondary || [])]) {
      const existing = map.get(r.key);
      if (!existing) {
        map.set(r.key, { ...r });
        continue;
      }
      const preferred = GCX.resources.preferDescriptor(existing, r);
      map.set(r.key, {
        ...existing,
        ...preferred,
        title: existing.source === 'attachment' ? existing.title || r.title : r.source === 'attachment' ? r.title || existing.title : existing.title || r.title,
        typeLabel: existing.typeLabel || r.typeLabel || null,
        source: existing.source === 'attachment' || r.source === 'attachment' ? 'attachment' : existing.source,
      });
    }
    return Array.from(map.values());
  }

  function mergeDetail(item, detail) {
    if (!detail) return item;
    if (detail.error) {
      return { ...item, warnings: [...item.warnings, `Item page could not be read: ${detail.error}`] };
    }
    const d = detail.data;
    const merged = { ...item };
    merged.title = item.title || d.title || null;
    merged.kind = item.kind || d.kind || (detail.exact ? detail.urlKind : null) || null;
    merged.description = chooseDescription(item.description, d.description);
    merged.resources = mergeResources(item.resources, d.resources);
    merged.meta = GCX.classwork.mergeMeta(item.meta, d.meta);
    merged.classroomUrl = detail.url || item.classroomUrl;
    merged.sources = [...item.sources, detail.strategy === 'frame' ? 'item-page-frame' : 'item-page'];
    merged.warnings = [...item.warnings, ...(d.warnings || []).filter((w) => !/Title not found/.test(w) || !merged.title)];
    if (!detail.exact) merged.warnings.push('Item page matched by position (id format differed); please spot-check this item.');
    return merged;
  }

  function finalizeItem(item, ctx) {
    const type = TYPE_BY_KIND[item.kind] || 'other';
    let title = item.title;
    if (!title && type === 'announcement') {
      const first = GCX.dom.splitLines(item.description)[0] || '';
      title = first ? (first.length > 80 ? `${first.slice(0, 77)}…` : first) : 'Announcement';
    }
    if (!title) title = 'Untitled item';
    const id = item.urlItemId || item.rawId;
    const classroomUrl =
      item.classroomUrl ||
      item.detailUrl ||
      (item.kind ? GCX.url.itemUrl(ctx, item.kind, id) : null);
    return {
      key: item.key,
      id: GCX.url.toUrlId(id),
      type,
      kind: item.kind || null,
      title,
      topic: item.topic || null,
      description: item.description || '',
      classroomUrl,
      meta: item.meta || {},
      resources: (item.resources || []).map((r) => ({
        kind: r.kind,
        id: r.id || null,
        resourceKey: r.resourceKey || null,
        url: r.url,
        key: r.key,
        title: r.title || null,
        typeLabel: r.typeLabel || null,
        source: r.source,
        authuser: r.authuser,
        published: !!r.published,
        hint: r.hint || null,
      })),
      order: item.order,
      sources: Array.from(new Set(item.sources || [])),
      warnings: Array.from(new Set(item.warnings || [])),
    };
  }

  function emptyItem(ref, source, order) {
    return {
      key: ref.key,
      rawId: ref.rawId,
      urlItemId: ref.rawId,
      title: ref.title || null,
      kind: ref.kind || null,
      detailUrl: ref.detailUrl || null,
      topic: null,
      description: '',
      resources: [],
      meta: {},
      order,
      sources: [source],
      warnings: [],
    };
  }

  /** Combine step results into the list of items to read and export. */
  function collectItems(classwork, stream, options) {
    const items = [];
    const seen = new Set();
    for (const item of (classwork && classwork.items) || []) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      items.push(item);
    }
    const extraWarnings = [];
    const refs = [...((classwork && classwork.refs) || []), ...((stream && stream.refs) || [])];
    let order = items.length;
    for (const ref of refs) {
      if (ref.kind === 'p' || seen.has(ref.key)) continue;
      seen.add(ref.key);
      const item = emptyItem(ref, 'link-reference', order++);
      item.warnings.push('Not listed on the Classwork page; found through a link on the Stream or Classwork page and included.');
      items.push(item);
    }
    if (options.includeAnnouncements && stream) {
      for (const post of stream.announcements || []) {
        if (seen.has(post.key)) continue;
        seen.add(post.key);
        items.push({ ...post, order: order++ });
      }
      for (const ref of refs) {
        if (ref.kind !== 'p' || seen.has(ref.key)) continue;
        seen.add(ref.key);
        items.push(emptyItem(ref, 'link-reference', order++));
      }
    }
    return { items, extraWarnings };
  }

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  async function runClasswork(payload, env) {
    const ctx = contextFromLocation();
    if (!ctx.courseId) throw new GCX.errors.PageStructureError('No Google Classroom class is open in this tab.');
    const assertPage = makePageAssert('classwork', ctx.courseId);
    assertPage();
    const result = await GCX.classwork.scan(ctx, { signal: env.signal, report: env.report, assertPage });
    result.classInfo = GCX.classInfo.detect(document, location.href);
    return result;
  }

  async function runStream(payload, env) {
    const ctx = contextFromLocation();
    const assertPage = makePageAssert('stream', ctx.courseId);
    assertPage();
    return GCX.stream.scan(ctx, { signal: env.signal, report: env.report, assertPage });
  }

  async function runDetails(payload, env) {
    const { classwork, stream, options, classContext } = payload;
    const ctx = { ...contextFromLocation(), ...classContext };
    const { items, extraWarnings } = collectItems(classwork, stream, options);
    const warnings = [...((classwork && classwork.warnings) || []), ...((stream && stream.warnings) || []), ...extraWarnings];
    let strategy = 'skipped';
    let merged = items;
    if (options.readDetailPages && items.length) {
      env.report({ message: 'Reading item pages…', itemIndex: 0, itemTotal: items.length });
      const loaded = await GCX.details.loadAll(items, ctx, { signal: env.signal, report: env.report });
      strategy = loaded.strategy;
      warnings.push(...loaded.warnings);
      merged = items.map((item) => mergeDetail(item, loaded.results[item.key]));
    }
    const classInfo = mergeClassInfo(classwork && classwork.classInfo, stream && stream.classInfo, ctx);
    const finalItems = merged.map((item) => finalizeItem(item, ctx));
    return {
      snapshot: {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        classInfo,
        topics: (classwork && classwork.topics) || [],
        items: finalItems,
        warnings: Array.from(new Set(warnings)),
        stats: {
          detailStrategy: strategy,
          listed: classwork && classwork.stats ? classwork.stats.listed : 0,
        },
      },
    };
  }

  function mergeClassInfo(a, b, ctx) {
    const pick = (field) => (b && b[field]) || (a && a[field]) || null;
    return {
      courseId: ctx.courseId,
      authuser: ctx.authuser || 0,
      prefix: ctx.prefix || '',
      name: pick('name') || `Class ${ctx.courseId}`,
      section: pick('section'),
      bannerLines: (b && b.bannerLines && b.bannerLines.length ? b.bannerLines : a && a.bannerLines) || [],
      url: GCX.url.streamUrl(ctx),
      nameSource: pick('nameSource'),
    };
  }

  const STEPS = {
    [P.STEP.CLASSWORK]: runClasswork,
    [P.STEP.STREAM]: runStream,
    [P.STEP.DETAILS]: runDetails,
  };

  async function runStep(step, payload, env) {
    const fn = STEPS[step];
    if (!fn) throw new Error(`Unknown discovery step: ${step}`);
    return fn(payload || {}, env);
  }

  GCX.discovery = { inspect, runStep, collectItems, mergeDetail, finalizeItem, chooseDescription, mergeResources };
})(globalThis);
