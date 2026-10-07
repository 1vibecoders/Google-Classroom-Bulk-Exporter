/*
 * Detect the current class (id, name, section) from the page.
 *
 * The course id always comes from the URL. The name is voted on from several
 * independent sources so that no single CSS structure is required:
 *   - links back to the class stream (/c/<courseId>) in the app bar and the
 *     navigation drawer (their text is "<name>\n<section>"),
 *   - headings outside of items (the stream banner),
 *   - document.title.
 * Tab links ("Stream", role=tab) and item contents are ignored.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  // "Stream" tab label in common Classroom locales; never a class name.
  const TAB_LABELS = new Set([
    'stream', 'classwork', 'people', 'grades', 'marks', 'flux', 'travaux et devoirs', 'personnes',
    'novedades', 'tablón', 'trabajo de clase', 'personas', 'mural', 'atividades', 'pessoas',
    'stream', 'kursaufgaben', 'personen', 'noten', 'поток', 'задания', 'пользователи',
    'ストリーム', '授業', 'メンバー', '信息流', '课业', '人员', '訊息串', '課堂作業', '成員',
    '스트림', '수업', '사용자', 'البث', 'الواجبات الدراسية', 'الأشخاص', 'bacheca', 'lavori del corso',
  ]);
  // Class codes and Meet links let others join the class; never export them.
  const CODE_LINE_RE = /(class code|meet\.google\.com|^code\b|^(?=[a-z]*\d)[a-z0-9]{6,8}$)/i;

  function cleanTitle(title) {
    return String(title || '')
      .replace(/\s*[-–|]\s*Google Classroom\s*$/i, '')
      .replace(/^Google Classroom\s*[-–|]?\s*/i, '')
      .trim();
  }

  function detect(doc, href) {
    const parsed = GCX.url.parse(href || (doc.location && doc.location.href) || '');
    const info = {
      courseId: parsed.courseId,
      authuser: parsed.authuser,
      prefix: parsed.prefix,
      name: null,
      section: null,
      nameSource: null,
      bannerLines: [],
      url: parsed.courseId ? GCX.url.streamUrl(parsed) : null,
    };
    if (!parsed.courseId) return info;

    const votes = new Map();
    const sections = new Map();
    const vote = (name, weight, source, section) => {
      const clean = dom().normalizeInline(name);
      if (!clean || clean.length > 200 || TAB_LABELS.has(clean.toLowerCase())) return;
      const entry = votes.get(clean) || { weight: 0, sources: new Set() };
      entry.weight += weight;
      entry.sources.add(source);
      votes.set(clean, entry);
      if (section) sections.set(clean, section);
    };

    for (const a of doc.querySelectorAll('a[href]')) {
      if (a.closest(`[${GCX.extract.ITEM_ATTR}]`)) continue;
      if (a.closest('[role="tab"], [role="tablist"]') || a.getAttribute('role') === 'tab') continue;
      const resolved = dom().resolveHref(a, dom().getBaseUrl(doc, href));
      if (!resolved) continue;
      const p = GCX.url.parse(resolved);
      if (p.page !== 'stream' || !GCX.url.sameId(p.courseId, parsed.courseId)) continue;
      const lines = dom().textPieces(a);
      if (lines.length) vote(lines[0], 2, 'class-link', lines[1] || null);
      else if (a.getAttribute('aria-label')) vote(a.getAttribute('aria-label'), 1, 'class-link-label');
    }

    const title = cleanTitle(doc.title);
    if (title) vote(title, 1, 'document-title');

    const headings = Array.from(doc.querySelectorAll('h1, h2, [role="heading"][aria-level="1"], [role="heading"][aria-level="2"]'))
      .filter((h) => !h.closest(`[${GCX.extract.ITEM_ATTR}]`));
    for (const h of headings.slice(0, 5)) {
      const text = dom().normalizeInline(dom().textOf(h));
      if (votes.has(text)) vote(text, 2, 'heading');
    }

    let best = null;
    for (const [name, entry] of votes) {
      if (!best || entry.weight > best.entry.weight || (entry.weight === best.entry.weight && entry.sources.size > best.entry.sources.size)) {
        best = { name, entry };
      }
    }
    if (best) {
      info.name = best.name;
      info.section = sections.get(best.name) || null;
      info.nameSource = Array.from(best.entry.sources).join(',');
      info.bannerLines = bannerLines(doc, headings, best.name, info.section);
    }
    return info;
  }

  /** Extra lines (subject, room, ...) shown next to the class name in the stream banner. */
  function bannerLines(doc, headings, name, section) {
    const heading = headings.find((h) => dom().normalizeInline(dom().textOf(h)) === name);
    if (!heading) return [];
    let container = heading;
    for (let i = 0; i < 3 && container.parentElement; i++) {
      const parent = container.parentElement;
      if (dom().normalizeInline(parent.textContent).length > 600) break;
      // Never grow into the list of posts or coursework.
      if (parent.querySelector(`[${GCX.extract.ITEM_ATTR}]`) || parent.matches('main, [role="main"], body')) break;
      container = parent;
    }
    return dom()
      .splitLines(dom().textOf(container, { skipControls: true }))
      .filter((line) => line !== name && line !== section && !CODE_LINE_RE.test(line) && line.length <= 200)
      .slice(0, 10);
  }

  GCX.classInfo = { detect, cleanTitle };
})(globalThis);
