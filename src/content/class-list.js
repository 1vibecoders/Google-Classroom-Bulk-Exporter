/*
 * The account's class list, read from the Classroom home page (/u/<n>/h).
 *
 * The home page shows a card for every class of its current role view
 * (since July 2026 Classroom splits the home page into views such as
 * Teaching and Enrolled); the navigation drawer lists the classes of every
 * view. Archived classes are only listed on a separate page, so they are
 * left out by construction. As everywhere else, nothing depends on CSS class
 * names or on the UI language:
 *   - a class is a link to its stream (/c/<courseId>): the cards in the page
 *     content first, in page order, then the classes that only the app bar or
 *     navigation drawer links to (another view's classes), in drawer order,
 *   - name and section are the first two text lines of that link (the same
 *     convention class-info.js relies on),
 *   - the card is the link's list item; the first line next to the link
 *     (outside links, controls and regions with links, in the link's
 *     containers below the card itself, so the card's upcoming work is not
 *     reached) is the teacher. A line with a number in any script (a
 *     teacher's "28 students", "학생 32명") is not a name.
 * Classes keep their page order and are de-duplicated by course id.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  const CHROME_SELECTOR = 'nav, [role="navigation"], header, [role="banner"]';
  const CARD_SELECTOR = 'li, [role="listitem"]';
  const TEACHER_DEPTH = 3;

  /** Links to the streams of this account's classes, in document order. */
  function streamLinks(doc, authuser) {
    const links = [];
    const base = dom().getBaseUrl(doc);
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = dom().resolveHref(a, base);
      const p = href && GCX.url.parse(href);
      if (!p || p.page !== 'stream') continue;
      // Links without /u/<n> belong to the account of the page itself.
      if (p.prefix.startsWith('/u/') && p.authuser !== authuser) continue;
      links.push({ el: a, courseId: p.courseId, key: GCX.url.idKey(p.courseId), prefix: p.prefix, inChrome: !!a.closest(CHROME_SELECTOR) });
    }
    return links;
  }

  /** One link per class card in the page content (for waiting and scrolling). */
  function cardLinks(doc, authuser) {
    const seen = new Set();
    const out = [];
    for (const link of streamLinks(doc, authuser)) {
      if (link.inChrome || seen.has(link.key)) continue;
      seen.add(link.key);
      out.push(link.el);
    }
    return out;
  }

  /** The class card: the link's list item, else its largest ancestor that links to no other class. */
  function cardFor(link, links) {
    const item = link.el.closest(CARD_SELECTOR);
    if (item) return item;
    let card = link.el;
    for (let p = link.el.parentElement; p && !p.matches('body, main, [role="main"]'); p = p.parentElement) {
      if (links.some((l) => l.key !== link.key && p.contains(l.el))) break;
      card = p;
    }
    return card;
  }

  /** First line of the card next to the class link (the teacher in a student's view). */
  function teacherFor(link, card, known) {
    // Links (the picture, upcoming work, icons) and the regions holding them are not the teacher.
    const exclude = (n) => n.tagName === 'A' || (!n.contains(link.el) && !!n.querySelector('a[href]'));
    let el = link.el.parentElement;
    for (let depth = 0; el && el !== card && depth < TEACHER_DEPTH && card.contains(el); depth++, el = el.parentElement) {
      const lines = dom().splitLines(dom().textOf(el, { skipControls: true, exclude })).filter((line) => !known.includes(line));
      if (lines.length) return /\p{Nd}/u.test(lines[0]) ? null : lines[0];
    }
    return null;
  }

  function describe(group, links, authuser) {
    const labelled = group.find((l) => dom().textPieces(l.el).length) || group[0];
    const pieces = dom().textPieces(labelled.el);
    const name = pieces[0] || dom().normalizeInline(labelled.el.getAttribute('aria-label')) || null;
    const section = pieces[1] || null;
    const ctx = { courseId: labelled.courseId, prefix: labelled.prefix, authuser };
    return {
      courseId: labelled.courseId,
      prefix: labelled.prefix,
      name,
      section,
      // A drawer entry has no card; the lines around it are menu headings, not a teacher.
      teacher: labelled.inChrome ? null : teacherFor(labelled, cardFor(labelled, links), [name, section]),
      url: GCX.url.streamUrl(ctx),
    };
  }

  /** The classes listed on the page: [{courseId, prefix, name, section, teacher, url}]. */
  function collect(doc, { authuser }) {
    const all = streamLinks(doc, authuser);
    const content = all.filter((l) => !l.inChrome);
    // Cards first (they carry the teacher), then classes only the drawer lists.
    const ordered = [...content, ...all.filter((l) => l.inChrome)];
    const groups = new Map();
    for (const link of ordered) {
      if (!groups.has(link.key)) groups.set(link.key, []);
      groups.get(link.key).push(link);
    }
    return Array.from(groups.values()).map((group) => {
      const cards = group.filter((l) => !l.inChrome);
      return describe(cards.length ? cards : group, content, authuser);
    });
  }

  async function scan(ctx, { signal, report, assertPage }) {
    const doc = document;
    const warnings = [];
    const items = (d) => cardLinks(d, ctx.authuser);
    report({ message: 'Waiting for your classes to load…' });
    const listState = await GCX.pageLoader.waitForList(doc, { signal, items });
    assertPage();
    if (listState.items) {
      report({ message: 'Loading all classes…', itemsFound: listState.items });
      const loaded = await GCX.pageLoader.loadAll(doc, {
        signal,
        items,
        onProgress: (n) => report({ message: 'Loading all classes…', itemsFound: n }),
      });
      assertPage();
      if (!loaded.complete) warnings.push('Stopped loading the class list after many attempts; some classes may be missing.');
    }
    const classes = collect(doc, ctx);
    if (!classes.length) {
      throw new GCX.errors.PageStructureError(
        'No classes were found on the Classroom home page of this account. Archived classes are not exported; if you have active classes, wait for Classroom to finish loading and try again.',
      );
    }
    report({ message: `${classes.length === 1 ? '1 class' : `${classes.length} classes`} found.`, itemsFound: classes.length });
    return { classes, warnings };
  }

  GCX.classList = { scan, collect };
})(globalThis);
