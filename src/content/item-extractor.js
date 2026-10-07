/*
 * Extract one Classroom item (assignment, material, question, announcement)
 * from a DOM subtree.
 *
 * The same extractor runs on three kinds of subtree:
 *   - a row of the Classwork list after it has been expanded ("row"),
 *   - the item root of a details page, live or fetched ("detail"),
 *   - a post on the Stream page ("stream").
 *
 * Selector strategy (most to least trusted):
 *   1. URLs and ids: item identity comes from [data-stream-item-id] and from
 *      links to /c/<course>/<kind>/<id>; attachments are recognised by their
 *      href (Drive, Docs, YouTube, ...), never by CSS class.
 *   2. Semantic/ARIA structure: [aria-expanded] toggles, headings,
 *      [data-drive-id] attachment containers, form controls (comment boxes).
 *   3. Layout-free structure: an attachment "card" is a resource link with an
 *      icon/thumbnail or an aria-label; the description is the largest text
 *      block that is not the title, not a card, has no controls or images and
 *      precedes the comments.
 *   4. English UI strings (detail pages are fetched with hl=en) for metadata
 *      such as "Due ...", "100 points" and for comment / "Your work" panels.
 * Obfuscated CSS class names are never used.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});
  const dom = () => GCX.dom;

  const ITEM_ATTR = 'data-stream-item-id';

  // Material icon ligatures Classroom has used for item-type icons.
  const ICON_KIND = {
    assignment: 'a',
    assignment_ind: 'a',
    assignment_turned_in: 'a',
    book: 'm',
    class: 'm',
    library_books: 'm',
    menu_book: 'm',
    help: 'q',
    help_outline: 'q',
    live_help: 'q',
    quiz: 'q',
    contact_support: 'q',
  };

  const TYPE_WORDS = [
    [/^(assignment|quiz assignment)$/i, 'a', /^(assignment|quiz assignment)\s*:/i],
    [/^material$/i, 'm', /^material\s*:/i],
    [/^question$/i, 'q', /^question\s*:/i],
  ];

  // Type labels shown on attachment cards ("PDF", "Google Docs", ...).
  const TYPE_LABEL_RE = new RegExp(
    '^(' + [
      'pdf', 'image', 'video', 'audio', 'text', 'zip', 'archive', 'folder', 'link', 'form', 'document',
      'spreadsheet', 'presentation', 'drawing', 'unknown file', 'binary file', 'file',
      'word', 'excel', 'powerpoint', 'microsoft word', 'microsoft excel', 'microsoft powerpoint',
      'google docs', 'google sheets', 'google slides', 'google forms', 'google drawings',
      'google sites', 'google jamboard', 'google vids', 'google drive', 'drive folder', 'youtube',
      'youtube video', 'csv', 'jpeg image', 'png image', 'gif image', 'mp4 video', 'mp3 audio',
      '[a-z0-9]{2,5} file',
    ].join('|') + ')$',
    'i',
  );

  // Full-line English UI strings that are never part of a description.
  const UI_LINE_RE = /^(view (instructions|assignment|material|question|details)|open|class comments?|private comments?|no class comments|\d+ class comments?|add (a )?(class|private) comment.*|your work|assigned|missing|turned in|turned in late|handed in|done|done late|returned|graded|not turned in|mark as done|turn in|hand in|unsubmit|\+ ?add or create|add or create|see all|show more|show less|read more)$/i;
  const MARKER_TEXT_RE = /^(class comments?|private comments?|no class comments|\d+ class comments?|add (a )?(class|private) comment.*|your work|turn in|hand in|mark as done|unsubmit|\+ ?add or create|add or create)$/i;
  const MARKER_ATTR_RE = /(comment|your work|turn in|hand in|mark as done|unsubmit|add or create|comentario|comentário|commento|kommentar|commentaire|opmerking|komentarz|komentář|коммент|تعليق|コメント|评论|評論|댓글|टिप्पणी)/i;

  const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATEISH = new RegExp(`(today|tomorrow|yesterday|${MONTH}\\s+\\d{1,2}|\\d{1,2}\\s+${MONTH}|\\d{1,2}[:.]\\d{2}|\\d{1,2}/\\d{1,2})`, 'i');

  const META_PATTERNS = {
    due: /^(?:due(?: date)?:?)\s+(.+)$/i,
    noDue: /^no due date$/i,
    points: /^(\d+(?:[.,]\d+)?)\s*(?:points?|pts?\.?)$/i,
    ungraded: /^ungraded$/i,
    posted: /^(?:posted|created|assigned)(?: on)?:?\s+(.+)$/i,
    edited: /\(?\s*edited:?\s+([^)]+)\)?/i,
    scheduled: /^scheduled(?: for)?:?\s+(.+)$/i,
    draft: /^(draft|saved as draft)$/i,
    bullet: /^(.{1,80}?)\s+[•·]\s+(.{2,80})$/,
  };

  function textOfEl(el, opts) {
    return dom().textOf(el, opts);
  }

  // ---------------------------------------------------------------------------
  // Item roots
  // ---------------------------------------------------------------------------

  /**
   * Find item containers under `scope`. Classroom marks every stream post and
   * classwork row with data-stream-item-id; nested copies of the attribute
   * (e.g. comment widgets) and duplicate renderings are collapsed per id.
   * @returns {{rawId:string, key:string, el:Element, elements:Element[]}[]}
   */
  function findItemRoots(scope) {
    const all = Array.from(scope.querySelectorAll(`[${ITEM_ATTR}]`));
    const outer = dom().outermost(all);
    const byKey = new Map();
    for (const el of outer) {
      const rawId = (el.getAttribute(ITEM_ATTR) || '').trim();
      if (!rawId) continue;
      const key = GCX.url.idKey(rawId);
      if (!byKey.has(key)) byKey.set(key, { rawId, key, el, elements: [el] });
      else byKey.get(key).elements.push(el);
    }
    return Array.from(byKey.values());
  }

  /** Locate the root of a specific item in a (detail) document. */
  function locateItemRoot(scope, itemKey) {
    const roots = findItemRoots(scope);
    const match = roots.find((r) => r.key === itemKey);
    if (match) return { el: match.el, exact: true };
    if (roots.length === 1) return { el: roots[0].el, exact: false };
    return null;
  }

  // ---------------------------------------------------------------------------
  // Toggles, scopes and excluded regions
  // ---------------------------------------------------------------------------

  /** The accordion toggle of a Classwork row (not a menu button). */
  function findToggle(itemEl) {
    const candidates = [];
    if (itemEl.hasAttribute('aria-expanded')) candidates.push(itemEl);
    candidates.push(...itemEl.querySelectorAll('[aria-expanded]'));
    for (const el of candidates) {
      if (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') continue;
      const label = `${el.getAttribute('aria-label') || ''}`;
      if (/comment/i.test(label)) continue;
      if (el.closest('a[href]')) continue;
      return el;
    }
    return null;
  }

  /** The item root plus any region its toggle controls via aria-controls. */
  function scopesFor(itemEl) {
    const scopes = [itemEl];
    const toggle = findToggle(itemEl);
    const controls = toggle && toggle.getAttribute('aria-controls');
    if (controls) {
      for (const id of controls.split(/\s+/)) {
        const region = id && itemEl.ownerDocument.getElementById(id);
        if (region && !scopes.some((s) => s.contains(region))) scopes.push(region);
      }
    }
    return scopes;
  }

  function isMarker(el) {
    if (el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role="textbox"], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')) return true;
    for (const attr of ['aria-label', 'placeholder', 'data-placeholder']) {
      const v = el.getAttribute(attr);
      if (v && v.length <= 80 && MARKER_ATTR_RE.test(v) && !el.matches('a[href]')) return true;
    }
    const own = dom().ownText(el);
    return !!own && own.length <= 60 && MARKER_TEXT_RE.test(own);
  }

  /**
   * Regions to ignore inside an item: comment threads, the student's own
   * "Your work" panel, comment boxes and nested items. Each marker is grown
   * to the largest ancestor that still contains neither the title nor any
   * content that precedes the marker, so that the description and the
   * attachments above a comment thread are never swallowed.
   */
  function findExcludedRegions(scopes, itemKey, titleEl) {
    const regions = [];
    for (const scope of scopes) {
      for (const nested of scope.querySelectorAll(`[${ITEM_ATTR}]`)) {
        const key = GCX.url.idKey(nested.getAttribute(ITEM_ATTR));
        if (key && itemKey && key !== itemKey) regions.push(nested);
      }
      const markers = Array.from(scope.querySelectorAll('*')).filter((el) => isMarker(el) && !(titleEl && (el.contains(titleEl) || titleEl.contains(el))));
      for (const marker of markers) {
        let region = marker;
        for (let p = marker.parentElement; p && p !== scope && scope.contains(p); p = p.parentElement) {
          if (titleEl && p.contains(titleEl)) break;
          if (hasContentBefore(p, marker)) break;
          region = p;
        }
        regions.push(region);
      }
    }
    return dom().outermost(Array.from(new Set(regions)));
  }

  /** True if `container` holds text or a resource link that precedes `marker`. */
  function hasContentBefore(container, marker) {
    const doc = container.ownerDocument;
    const walker = doc.createTreeWalker(container, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n === marker || marker.contains(n)) return false;
      if (!dom().precedes(n, marker)) return false;
      if (n.nodeType === 3) {
        if (n.nodeValue.trim() && !isInsideHidden(n.parentElement, container)) return true;
      } else if (n.matches('a[href]') && GCX.resources.classify(n.getAttribute('href'))) {
        return true;
      }
    }
    return false;
  }

  function isInsideHidden(el, stop) {
    for (let p = el; p && p !== stop; p = p.parentElement) {
      if (p.getAttribute('aria-hidden') === 'true' || p.hidden) return true;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return true;
    }
    return false;
  }

  function makeExcluder(regions) {
    return (el) => regions.some((r) => r === el || r.contains(el));
  }

  // ---------------------------------------------------------------------------
  // Title and kind
  // ---------------------------------------------------------------------------

  function textLeaves(container, isExcluded) {
    const leaves = [];
    const walk = (el) => {
      if (el.nodeType !== 1) return;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|IMG)$/i.test(el.tagName)) return;
      if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return;
      if (isExcluded && isExcluded(el)) return;
      if (el !== container && el.matches('[aria-haspopup]:not([aria-haspopup="false"]), [role="menu"]')) return;
      const own = dom().ownText(el);
      if (own) leaves.push({ el, text: own });
      for (const child of el.children) walk(child);
    };
    walk(container);
    return leaves;
  }

  function isMetaText(text) {
    return (
      META_PATTERNS.due.test(text) || META_PATTERNS.noDue.test(text) || META_PATTERNS.points.test(text) ||
      META_PATTERNS.ungraded.test(text) || META_PATTERNS.posted.test(text) || META_PATTERNS.scheduled.test(text) ||
      META_PATTERNS.draft.test(text) || /^\(?edited/i.test(text) || UI_LINE_RE.test(text)
    );
  }

  function isTypeWord(text) {
    return TYPE_WORDS.some(([re]) => re.test(text));
  }

  /**
   * Find the title element. Headings win; Classwork rows fall back to the
   * first meaningful text inside the accordion toggle.
   */
  function findTitle(scopes, mode, isExcluded, cardEls) {
    if (mode === 'stream') return null;
    const inCard = (el) => cardEls.some((c) => c.contains(el));
    for (const scope of scopes) {
      const headings = scope.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const h of headings) {
        if (isExcluded(h) || inCard(h) || h.getAttribute('aria-hidden') === 'true') continue;
        const text = dom().normalizeInline(textOfEl(h));
        if (text && text.length <= 500 && !isMetaText(text) && !isTypeWord(text)) return { el: h, text, source: 'heading' };
      }
    }
    const toggle = findToggle(scopes[0]);
    if (toggle) {
      for (const leaf of textLeaves(toggle, isExcluded)) {
        if (inCard(leaf.el)) continue;
        if (isMetaText(leaf.text) || isTypeWord(leaf.text) || ICON_KIND[leaf.text]) continue;
        if (leaf.text.length > 500) continue;
        return { el: leaf.el, text: leaf.text, source: 'toggle' };
      }
    }
    for (const el of [scopes[0], toggle].filter(Boolean)) {
      const label = el.getAttribute('aria-label');
      if (label && label.length <= 300) {
        const text = label.replace(/^(assignment|material|question|announcement)\s*:\s*/i, '').trim();
        if (text) return { el: null, text, source: 'aria-label' };
      }
    }
    return null;
  }

  /** Derive the item kind (a, m, sa, mc, q, p) from links, icons and labels. */
  function detectKind(scopes, ctx, isExcluded) {
    const result = { kind: null, detailUrl: null, urlItemId: null, source: null };
    const itemLinks = [];
    for (const scope of scopes) {
      for (const a of scope.querySelectorAll('a[href]')) {
        if (isExcluded(a)) continue;
        const href = dom().resolveHref(a, ctx.baseUrl);
        if (!href) continue;
        const parsed = GCX.url.parse(href);
        if (!parsed.isClassroom || !parsed.itemId) continue;
        if (ctx.courseId && !GCX.url.sameId(parsed.courseId, ctx.courseId)) continue;
        itemLinks.push({ parsed, href });
      }
    }
    const exact = itemLinks.find((l) => ctx.itemKey && GCX.url.idKey(l.parsed.itemId) === ctx.itemKey);
    const distinct = new Set(itemLinks.map((l) => GCX.url.idKey(l.parsed.itemId)));
    const chosen = exact || (distinct.size === 1 ? itemLinks[0] : null);
    if (chosen) {
      result.kind = chosen.parsed.itemKind;
      result.detailUrl = GCX.url.canonical(chosen.href);
      result.urlItemId = chosen.parsed.itemId;
      result.source = exact ? 'link' : 'link-single';
      return result;
    }
    // Icon ligatures and type words (aria-hidden icons are allowed here).
    for (const scope of scopes) {
      for (const el of scope.querySelectorAll('i, span, div')) {
        if (el.children.length) continue;
        const text = (el.textContent || '').trim();
        if (ICON_KIND[text]) {
          result.kind = ICON_KIND[text];
          result.source = 'icon';
          return result;
        }
      }
      const labelled = [scope, ...scope.querySelectorAll('[aria-label], [data-tooltip], [title]')];
      for (const el of labelled) {
        for (const attr of ['aria-label', 'data-tooltip', 'title']) {
          const v = (el.getAttribute(attr) || '').trim();
          for (const [re, kind, prefixRe] of TYPE_WORDS) {
            if (re.test(v) || prefixRe.test(v)) {
              result.kind = kind;
              result.source = 'label';
              return result;
            }
          }
        }
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Attachments
  // ---------------------------------------------------------------------------

  function hasCardSignals(anchor, scope) {
    const driveBox = anchor.closest('[data-drive-id]');
    if (driveBox && scope.contains(driveBox)) return true;
    if (anchor.querySelector('img, svg, picture, [style*="background-image"]')) return true;
    const label = anchor.getAttribute('aria-label');
    if (label) {
      if (/^attachment\b/i.test(label)) return true;
      const text = dom().normalizeInline(anchor.textContent);
      if (!text || label.trim() !== text) return true;
    }
    return false;
  }

  /** Smallest ancestor that represents the card around one resource link. */
  function cardContainer(anchor, scope, key) {
    let card = anchor;
    for (let p = anchor.parentElement; p && p !== scope && scope.contains(p); p = p.parentElement) {
      const otherResource = Array.from(p.querySelectorAll('a[href]')).some((a) => {
        if (a === anchor) return false;
        const d = GCX.resources.classify(a.getAttribute('href'));
        return d && d.key !== key;
      });
      if (otherResource) break;
      const text = dom().normalizeInline(p.textContent);
      if (text.length > 400) break;
      card = p;
      if (p.hasAttribute('data-drive-id')) break;
    }
    return card;
  }

  function parseAttachmentLabel(label) {
    if (!label) return { name: null, typeLabel: null };
    let rest = label.trim().replace(/^attachment\s*:\s*/i, '');
    let typeLabel = null;
    const m = /^([^:]{1,30}):\s*(.+)$/.exec(rest);
    if (m && TYPE_LABEL_RE.test(m[1].trim())) {
      typeLabel = m[1].trim();
      rest = m[2].trim();
    }
    return { name: rest || null, typeLabel };
  }

  const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;

  /**
   * Name and type label of an attachment card. Cards show the name and a type
   * label as separate pieces of text; their aria-label usually reads
   * "<Attachment>: <type>: <name>" in the UI language, which identifies the
   * type label without knowing the language.
   */
  function nameForCard(anchor, card, descriptor) {
    const label = (anchor.getAttribute('aria-label') || '').trim();
    for (const source of [anchor, card]) {
      const pieces = dom().textPieces(source, { skipControls: source !== anchor }).filter((p) => !DURATION_RE.test(p));
      if (!pieces.length) continue;
      if (label) {
        for (const piece of pieces) {
          if (label === piece || !label.endsWith(`: ${piece}`)) continue;
          const prefix = label.slice(0, -(piece.length + 2)).split(/:\s*/).filter(Boolean);
          const typeLabel = prefix.length >= 2 ? prefix[prefix.length - 1] : pieces.find((p) => p !== piece && TYPE_LABEL_RE.test(p)) || null;
          return { name: piece, typeLabel };
        }
      }
      const names = pieces.filter((p) => !TYPE_LABEL_RE.test(p));
      const types = pieces.filter((p) => TYPE_LABEL_RE.test(p));
      if (names.length) {
        let typeLabel = types[0] || parseAttachmentLabel(label).typeLabel || null;
        if (!typeLabel && names.length === 2 && names[1].length <= 40) typeLabel = names[1];
        return { name: names[0], typeLabel };
      }
    }
    const fromLabel = parseAttachmentLabel(label);
    if (fromLabel.name) return fromLabel;
    const title = anchor.getAttribute('title');
    if (title) return { name: title.trim(), typeLabel: null };
    return { name: null, typeLabel: GCX.resources.kindLabel(descriptor.kind) };
  }

  function collectCards(scopes, ctx, isExcluded) {
    const cards = [];
    for (const scope of scopes) {
      for (const a of scope.querySelectorAll('a[href]')) {
        if (isExcluded(a)) continue;
        const href = dom().resolveHref(a, ctx.baseUrl);
        const desc = href && GCX.resources.classify(href, ctx.baseUrl);
        if (!desc) continue;
        if (!hasCardSignals(a, scope)) continue;
        if (desc.kind === 'classroom') {
          // Links to other Classroom pages (details, profiles) are navigation, not attachments.
          const parsed = GCX.url.parse(desc.url);
          if (parsed.courseId || parsed.page === 'home' || parsed.page === 'other') {
            if (!/\/(addon|addons|attachment)s?\b/i.test(desc.url)) continue;
          }
        }
        const card = cardContainer(a, scope, desc.key);
        const { name, typeLabel } = nameForCard(a, card, desc);
        cards.push({ anchor: a, card, descriptor: desc, name, typeLabel });
      }
    }
    return cards;
  }

  // ---------------------------------------------------------------------------
  // Description
  // ---------------------------------------------------------------------------

  const DESCRIPTION_TAGS = /^(DIV|SPAN|P|SECTION|ARTICLE|PRE|BLOCKQUOTE|UL|OL|MAIN)$/;

  /** Drop Classroom UI/meta lines that wrap a description block. */
  function cleanDescription(text) {
    const lines = String(text || '').split('\n');
    const isEdgeNoise = (line) => {
      const t = line.trim().replace(/\s*\(https?:\/\/[^)\s]*\)$/, '');
      if (!t) return true;
      if (UI_LINE_RE.test(t)) return true;
      if (META_PATTERNS.posted.test(t) || META_PATTERNS.noDue.test(t) || META_PATTERNS.points.test(t) || META_PATTERNS.ungraded.test(t)) return true;
      if (META_PATTERNS.scheduled.test(t) || META_PATTERNS.draft.test(t)) return true;
      if (/^\(?\s*edited\b/i.test(t) && t.length < 60) return true;
      const due = META_PATTERNS.due.exec(t);
      if (due && DATEISH.test(due[1]) && t.length < 60) return true;
      const bullet = META_PATTERNS.bullet.exec(t);
      if (bullet && DATEISH.test(bullet[2])) return true;
      return false;
    };
    while (lines.length && isEdgeNoise(lines[0])) lines.shift();
    while (lines.length && isEdgeNoise(lines[lines.length - 1])) lines.pop();
    return dom().cleanText(lines.join('\n'));
  }

  /** True if `el` links to this item's own page ("View instructions" etc.), i.e. it is UI, not text. */
  function containsSelfLink(el, ctx) {
    for (const a of el.querySelectorAll('a[href]')) {
      const href = dom().resolveHref(a, ctx.baseUrl);
      const parsed = href && GCX.url.parse(href);
      if (parsed && parsed.itemId && (!ctx.itemKey || GCX.url.idKey(parsed.itemId) === ctx.itemKey)) return true;
    }
    return false;
  }

  function findDescription(scopes, ctx, { titleEl, cardEls, isExcluded, boundaryEl }) {
    let best = null;
    let bestText = '';
    for (const scope of scopes) {
      const candidates = [scope, ...scope.querySelectorAll('*')];
      for (const el of candidates) {
        if (!DESCRIPTION_TAGS.test(el.tagName)) continue;
        if (isExcluded(el)) continue;
        if (el.getAttribute('aria-hidden') === 'true' || el.hidden) continue;
        if (titleEl && (el === titleEl || el.contains(titleEl) || titleEl.contains(el))) continue;
        if (cardEls.some((c) => c === el || el.contains(c) || c.contains(el))) continue;
        if (dom().isControl(el) || dom().containsControl(el) || el.closest('[role="button"], button')) continue;
        if (el.querySelector('img, svg, video, iframe, canvas, picture')) continue;
        if (el.querySelector(`[${ITEM_ATTR}]`)) continue;
        if (containsSelfLink(el, ctx)) continue;
        if (boundaryEl && !dom().precedes(el, boundaryEl)) continue;
        const text = cleanDescription(textOfEl(el, { linkUrls: true, baseUrl: ctx.baseUrl }));
        if (!text) continue;
        if (titleEl && text === dom().normalizeInline(textOfEl(titleEl))) continue;
        if (text.length > bestText.length) {
          best = el;
          bestText = text;
        }
      }
    }
    return best ? { el: best, text: bestText } : null;
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  const DATE_ONLY = new RegExp(
    `^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(?:${MONTH}\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${MONTH}(?:\\s+\\d{4})?|today|yesterday|\\d{1,2}:\\d{2}\\s*(?:[ap]\\.?m\\.?)?)$`,
    'i',
  );

  function parseMeta(lines) {
    const meta = { dueText: null, pointsText: null, postedText: null, editedText: null, statusText: null };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.length > 120) continue;
      let m;
      if (!meta.dueText && (m = META_PATTERNS.due.exec(line))) meta.dueText = m[1].trim();
      else if (!meta.dueText && META_PATTERNS.noDue.test(line)) meta.dueText = 'No due date';
      else if (!meta.pointsText && (m = META_PATTERNS.points.exec(line))) meta.pointsText = `${m[1]} points`;
      else if (!meta.pointsText && META_PATTERNS.ungraded.test(line)) meta.pointsText = 'Ungraded';
      else if (!meta.postedText && (m = META_PATTERNS.posted.exec(line))) meta.postedText = m[1].replace(META_PATTERNS.edited, '').trim();
      else if (!meta.statusText && (m = META_PATTERNS.scheduled.exec(line))) meta.statusText = `Scheduled ${m[1].trim()}`;
      else if (!meta.statusText && META_PATTERNS.draft.test(line)) meta.statusText = 'Draft';
      else if (!meta.postedText && (m = META_PATTERNS.bullet.exec(line)) && DATEISH.test(m[2])) {
        meta.postedText = m[2].replace(META_PATTERNS.edited, '').trim();
      }
      if (!meta.editedText && (m = META_PATTERNS.edited.exec(line)) && DATEISH.test(m[1])) meta.editedText = m[1].trim();
    }
    // Stream posts show the date on its own; use a bare date as the posting
    // date unless it belongs to the due date.
    if (!meta.postedText) {
      for (const raw of lines) {
        const line = raw.trim();
        if (DATE_ONLY.test(line) && !(meta.dueText && meta.dueText.includes(line))) {
          meta.postedText = line;
          break;
        }
      }
    }
    return meta;
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------

  /**
   * Extract an item from `itemEl`.
   * @param {Element} itemEl
   * @param {{mode:'row'|'detail'|'stream', courseId:string, itemKey:string, baseUrl:string}} ctx
   */
  function extractItem(itemEl, ctx) {
    const scopes = scopesFor(itemEl);
    const warnings = [];

    // Pass 1: provisional exclusions (no title yet) to find cards and title.
    let regions = findExcludedRegions(scopes, ctx.itemKey, null);
    let isExcluded = makeExcluder(regions);
    let cards = collectCards(scopes, ctx, isExcluded);
    const title = findTitle(scopes, ctx.mode, isExcluded, cards.map((c) => c.card));

    // Pass 2: with the title known, markers can be grown safely.
    regions = findExcludedRegions(scopes, ctx.itemKey, title && title.el);
    isExcluded = makeExcluder(regions);
    cards = collectCards(scopes, ctx, isExcluded);
    const cardEls = cards.map((c) => c.card);

    // Comments always follow the content; the first comment/"your work"
    // marker after the title bounds where the description may be.
    let boundaryEl = null;
    for (const region of regions) {
      if (title && title.el && !dom().precedes(title.el, region)) continue;
      if (region.matches(`[${ITEM_ATTR}]`)) continue;
      if (!boundaryEl || dom().precedes(region, boundaryEl)) boundaryEl = region;
    }

    const description = findDescription(scopes, ctx, { titleEl: title && title.el, cardEls, isExcluded, boundaryEl });

    // Links typed into the description (or anywhere outside cards/comments).
    const resources = new Map();
    const addResource = (descriptor, extra) => {
      const existing = resources.get(descriptor.key);
      if (!existing) {
        resources.set(descriptor.key, { ...descriptor, ...extra });
        return;
      }
      const preferred = GCX.resources.preferDescriptor(existing, descriptor);
      const merged = { ...existing, ...preferred };
      merged.title = existing.source === 'attachment' ? existing.title : extra.title || existing.title;
      merged.typeLabel = existing.typeLabel || extra.typeLabel || null;
      merged.source = existing.source === 'attachment' || extra.source === 'attachment' ? 'attachment' : existing.source;
      resources.set(descriptor.key, merged);
    };
    for (const c of cards) {
      addResource(c.descriptor, { title: c.name, typeLabel: c.typeLabel, source: 'attachment' });
    }
    for (const scope of scopes) {
      for (const a of scope.querySelectorAll('a[href]')) {
        if (isExcluded(a) || cards.some((c) => c.anchor === a)) continue;
        if (cardEls.some((c) => c.contains(a))) continue;
        if (boundaryEl && !dom().precedes(a, boundaryEl)) continue;
        const href = dom().resolveHref(a, ctx.baseUrl);
        const desc = href && GCX.resources.classify(href, ctx.baseUrl);
        if (!desc || desc.kind === 'classroom') continue;
        const inDescription = description && description.el.contains(a);
        const text = dom().normalizeInline(a.textContent);
        addResource(desc, { title: text || null, typeLabel: null, source: inDescription ? 'description-link' : 'link-in-item' });
      }
    }

    // Metadata from the remaining short lines (title, cards, description and
    // excluded regions removed).
    const metaLines = [];
    const metaExclude = (el) =>
      isExcluded(el) || cardEls.some((c) => c === el) || (description && description.el === el) || (title && title.el === el);
    for (const scope of scopes) metaLines.push(...dom().splitLines(textOfEl(scope, { exclude: metaExclude })));
    // Also individual text pieces, for labels split across inline elements.
    // Nothing inside the description, cards, title or excluded regions counts:
    // a teacher writing "Due Friday" in the instructions is not metadata.
    const insideContent = (el) =>
      isExcluded(el) ||
      cardEls.some((c) => c.contains(el)) ||
      (description && description.el.contains(el)) ||
      (title && title.el && title.el.contains(el)) ||
      !!el.closest('[aria-hidden="true"]');
    for (const scope of scopes) {
      const walker = scope.ownerDocument.createTreeWalker(scope, 1 /* SHOW_ELEMENT */);
      for (let el = walker.currentNode; el; el = walker.nextNode()) {
        if (insideContent(el)) continue;
        const own = dom().ownText(el);
        if (own && own.length <= 80) metaLines.push(own);
      }
    }
    const toggle = findToggle(scopes[0]);
    if (toggle) metaLines.push(...textLeaves(toggle, isExcluded).map((l) => l.text));
    if (description) {
      // A wrapper chosen as the description may start with UI lines such as
      // "Posted Oct 3" that cleanDescription() removed; those are metadata.
      const firstKept = dom().splitLines(description.text)[0];
      for (const line of dom().splitLines(textOfEl(description.el))) {
        if (line === firstKept) break;
        metaLines.push(line);
      }
    }
    const meta = parseMeta(metaLines);

    const kind = detectKind(scopes, ctx, isExcluded);
    if (!title && ctx.mode !== 'stream') warnings.push('Title not found on page');

    return {
      title: title ? title.text : null,
      titleSource: title ? title.source : null,
      kind: kind.kind,
      kindSource: kind.source,
      detailUrl: kind.detailUrl,
      urlItemId: kind.urlItemId,
      description: description ? description.text : '',
      resources: Array.from(resources.values()),
      meta,
      warnings,
    };
  }

  /** Lightweight summary of a Classwork row without expanding it. */
  function extractRowSummary(itemEl, ctx) {
    const scopes = scopesFor(itemEl);
    const isExcluded = makeExcluder(findExcludedRegions(scopes, ctx.itemKey, null));
    const title = findTitle(scopes, 'row', isExcluded, []);
    const toggle = findToggle(itemEl);
    const leaves = toggle ? textLeaves(toggle, isExcluded).map((l) => l.text) : [];
    return {
      title: title ? title.text : null,
      meta: parseMeta(leaves),
      kind: detectKind(scopes, ctx, isExcluded),
      expanded: toggle ? toggle.getAttribute('aria-expanded') === 'true' : true,
      hasToggle: !!toggle,
    };
  }

  GCX.extract = {
    ITEM_ATTR,
    findItemRoots,
    locateItemRoot,
    findToggle,
    scopesFor,
    extractItem,
    extractRowSummary,
    parseMeta,
    cleanDescription,
    parseAttachmentLabel,
  };
})(globalThis);
