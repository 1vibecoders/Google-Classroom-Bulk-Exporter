/*
 * DOM helpers shared by the Classroom extractors.
 *
 * Everything here works on both the live Classroom document and on documents
 * produced by DOMParser (fetched detail pages), which have no layout and no
 * computed styles. Helpers that need layout degrade gracefully in that case.
 */
(function (root) {
  'use strict';
  const GCX = root.GCX;

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE',
    'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);
  const NEVER_TEXT_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED',
    'IMG', 'VIDEO', 'AUDIO', 'PICTURE', 'SOURCE', 'LINK', 'META',
  ]);
  const CONTROL_SELECTOR = [
    'button', '[role="button"]', '[role="menu"]', '[role="menuitem"]', '[role="menubar"]',
    '[role="tab"]', '[role="tablist"]', '[role="checkbox"]', '[role="switch"]', '[role="listbox"]',
    '[role="option"]', '[role="combobox"]', '[role="textbox"]', 'input', 'textarea', 'select',
    '[contenteditable=""]', '[contenteditable="true"]',
  ].join(',');
  const FORM_CONTROL_SELECTOR = 'textarea, input:not([type="hidden"]), select, [contenteditable=""], [contenteditable="true"], [role="textbox"]';

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(new GCX.errors.CancelledError());
      const t = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(t);
        reject(new GCX.errors.CancelledError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function observeTarget(rootNode) {
    if (!rootNode) return null;
    if (rootNode.nodeType === 9) return rootNode.documentElement || rootNode; // Document
    return rootNode;
  }

  /**
   * Resolve with the first truthy value returned by `predicate`, re-checking on
   * every DOM mutation under `root` (plus a slow poll as a safety net).
   * Resolves `null` on timeout instead of rejecting, so callers can decide how
   * to degrade. Rejects with CancelledError when `signal` aborts.
   */
  function waitFor(predicate, { root: rootNode = document, timeout = 10000, signal, pollMs = 300 } = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      let observer = null;
      let poll = null;
      let timer = null;
      const finish = (value, error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (observer) observer.disconnect();
        if (signal) signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const check = () => {
        if (done) return;
        let value;
        try {
          value = predicate();
        } catch (err) {
          finish(null, err);
          return;
        }
        if (value) finish(value);
      };
      function onAbort() {
        finish(null, new GCX.errors.CancelledError());
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      check();
      if (done) return;
      const target = observeTarget(rootNode);
      if (target && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(check);
        observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
      }
      poll = setInterval(check, pollMs);
      timer = setTimeout(() => finish(null), timeout);
    });
  }

  /**
   * Resolve `true` once no mutation has happened under `root` for `quietMs`,
   * or `false` if the DOM keeps changing until `timeout`.
   */
  function waitForQuiet(rootNode = document, { quietMs = 400, timeout = 6000, signal } = {}) {
    return new Promise((resolve, reject) => {
      const target = observeTarget(rootNode);
      let quietTimer = null;
      let hardTimer = null;
      let observer = null;
      let done = false;
      const finish = (value, error) => {
        if (done) return;
        done = true;
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        if (observer) observer.disconnect();
        if (signal) signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      function onAbort() {
        finish(false, new GCX.errors.CancelledError());
      }
      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      const arm = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(() => finish(true), quietMs);
      };
      if (target && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(arm);
        observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
      }
      arm();
      hardTimer = setTimeout(() => finish(false), timeout);
    });
  }

  function hasLayout(el) {
    const doc = el && el.ownerDocument;
    return !!(doc && doc.defaultView);
  }

  function computedStyle(el) {
    if (!hasLayout(el)) return null;
    try {
      return el.ownerDocument.defaultView.getComputedStyle(el);
    } catch (_) {
      return null;
    }
  }

  /** True when the element is rendered. Detached/parsed documents count as visible. */
  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    if (!hasLayout(el)) return true;
    const style = computedStyle(el);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return el.getClientRects().length > 0;
  }

  /** True if a loading indicator is visible inside `rootNode`. */
  function isBusy(rootNode = document) {
    const scope = observeTarget(rootNode);
    if (!scope || !scope.querySelectorAll) return false;
    const indicators = scope.querySelectorAll('[role="progressbar"], [aria-busy="true"]');
    for (const el of indicators) {
      if (isVisible(el)) return true;
    }
    return false;
  }

  function isControl(el) {
    return !!(el && el.nodeType === 1 && el.matches(CONTROL_SELECTOR));
  }

  function containsControl(el) {
    return !!(el && el.querySelector && el.querySelector(CONTROL_SELECTOR));
  }

  function containsFormControl(el) {
    return !!(el && el.querySelector && el.querySelector(FORM_CONTROL_SELECTOR));
  }

  /** Direct (non-descendant) text of an element, whitespace-normalized. */
  function ownText(el) {
    if (!el || !el.childNodes) return '';
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.nodeValue;
    }
    return normalizeInline(text);
  }

  /**
   * Visible text of an element as separate pieces (one per text node), so
   * adjacent inline elements such as <span>Name</span><span>Section</span>
   * are not glued together.
   */
  function textPieces(el, { skipControls = false } = {}) {
    const pieces = [];
    const walk = (node) => {
      if (node.nodeType === 3) {
        const text = normalizeInline(node.nodeValue);
        if (text) pieces.push(text);
        return;
      }
      if (node.nodeType !== 1) return;
      if (NEVER_TEXT_TAGS.has(node.tagName.toUpperCase())) return;
      if (node.getAttribute('aria-hidden') === 'true' || node.hidden) return;
      if (skipControls && node !== el && isControl(node)) return;
      for (const child of node.childNodes) walk(child);
    };
    walk(el);
    return pieces;
  }

  function normalizeInline(text) {
    return String(text || '').replace(/[\s ]+/g, ' ').trim();
  }

  function preservesNewlines(textNode) {
    const parent = textNode.parentElement;
    if (!parent) return false;
    if (parent.closest('pre')) return true;
    const style = computedStyle(parent);
    if (style && style.whiteSpace) return /^(pre|pre-wrap|pre-line|break-spaces)$/.test(style.whiteSpace);
    // No layout (DOMParser document): newlines immediately followed by
    // indentation are HTML source formatting; bare newlines are user text.
    return !/\n[ \t]{2,}/.test(textNode.nodeValue);
  }

  /**
   * Serialize the readable text of a subtree, turning block elements and <br>
   * into line breaks and list items into "- " bullets.
   *
   * Options:
   *   exclude(el) -> boolean   skip an element and its subtree
   *   skipControls             skip buttons, menus and form controls
   *   linkUrls                 append "(url)" after link text when they differ
   *   baseUrl                  base for resolving relative hrefs
   */
  function textOf(node, { exclude, skipControls = false, linkUrls = false, baseUrl } = {}) {
    if (!node) return '';
    const out = [];
    const pushBreak = () => {
      if (out.length && out[out.length - 1] !== '\n') out.push('\n');
    };
    const walk = (n) => {
      if (n.nodeType === 3) {
        let value = n.nodeValue;
        if (!value) return;
        if (preservesNewlines(n)) {
          value = value.replace(/[ \t\f\r ]+/g, ' ');
        } else {
          value = value.replace(/[\s ]+/g, ' ');
        }
        if (value.trim() === '' && !value.includes('\n')) {
          if (out.length && !/[\s]$/.test(out[out.length - 1])) out.push(' ');
          return;
        }
        out.push(value);
        return;
      }
      if (n.nodeType !== 1 && n.nodeType !== 9 && n.nodeType !== 11) return;
      if (n.nodeType === 1) {
        const tag = n.tagName.toUpperCase();
        if (NEVER_TEXT_TAGS.has(tag)) return;
        if (n.getAttribute('aria-hidden') === 'true' || n.hidden) return;
        if (exclude && exclude(n)) return;
        if (skipControls && isControl(n)) return;
        if (hasLayout(n)) {
          const style = computedStyle(n);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return;
        }
        if (tag === 'BR') {
          out.push('\n');
          return;
        }
        const block = BLOCK_TAGS.has(tag);
        if (block) pushBreak();
        if (tag === 'LI') out.push('- ');
        for (const child of n.childNodes) walk(child);
        if (tag === 'A' && linkUrls) {
          const href = resolveHref(n, baseUrl);
          const label = normalizeInline(n.textContent);
          if (href && /^https?:/i.test(href) && label && normalizeUrlForCompare(label) !== normalizeUrlForCompare(href)) {
            out.push(` (${href})`);
          }
        }
        if (block) pushBreak();
        return;
      }
      for (const child of n.childNodes) walk(child);
    };
    walk(node);
    return cleanText(out.join(''));
  }

  function normalizeUrlForCompare(value) {
    return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  }

  /** Normalize multi-line text: trim lines, collapse blank runs. */
  function cleanText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^- *$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function splitLines(text) {
    return cleanText(text).split('\n').map((l) => l.trim()).filter(Boolean);
  }

  /** Keep only the elements that are not nested inside another element of the list. */
  function outermost(elements) {
    const set = new Set(elements);
    return elements.filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (set.has(p)) return false;
      }
      return true;
    });
  }

  /** True if `a` comes before `b` in document order. */
  function precedes(a, b) {
    if (!a || !b || a === b) return false;
    return !!(a.compareDocumentPosition(b) & 4); // DOCUMENT_POSITION_FOLLOWING
  }

  function sortInDocumentOrder(elements) {
    return elements.slice().sort((a, b) => (a === b ? 0 : precedes(a, b) ? -1 : 1));
  }

  /** Find the element that scrolls `el` (falls back to the document scroller). */
  function findScrollContainer(el) {
    const doc = (el && el.ownerDocument) || document;
    for (let p = el ? el.parentElement : null; p; p = p.parentElement) {
      const style = computedStyle(p);
      if (!style) break;
      if (/(auto|scroll|overlay)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 10) return p;
    }
    return doc.scrollingElement || doc.documentElement;
  }

  /** Base URL for resolving relative links in a (possibly parsed) document. */
  function getBaseUrl(doc, fallback) {
    const base = doc && doc.querySelector && doc.querySelector('base[href]');
    if (base) {
      try {
        return new URL(base.getAttribute('href'), fallback || (doc.location && doc.location.href) || undefined).href;
      } catch (_) {
        /* ignore */
      }
    }
    if (fallback) return fallback;
    if (doc && doc.location && /^https?:/.test(doc.location.href)) return doc.location.href;
    return (doc && doc.baseURI) || '';
  }

  /** Absolute URL of an anchor's href, resolved against `baseUrl` when given. */
  function resolveHref(anchor, baseUrl) {
    const raw = anchor && anchor.getAttribute && anchor.getAttribute('href');
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#') || /^javascript:/i.test(trimmed)) return null;
    try {
      const base = baseUrl || (anchor.ownerDocument && anchor.ownerDocument.baseURI);
      return new URL(trimmed, base).href;
    } catch (_) {
      return null;
    }
  }

  function scrollIntoViewSafe(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {
      /* ignore */
    }
  }

  /** Dispatch a realistic click (pointer + mouse events) on an element. */
  function clickElement(el) {
    if (!el) return;
    const view = el.ownerDocument.defaultView;
    const opts = { bubbles: true, cancelable: true, composed: true, view };
    try {
      if (view && view.PointerEvent) el.dispatchEvent(new view.PointerEvent('pointerdown', opts));
      el.dispatchEvent(new view.MouseEvent('mousedown', opts));
      if (view && view.PointerEvent) el.dispatchEvent(new view.PointerEvent('pointerup', opts));
      el.dispatchEvent(new view.MouseEvent('mouseup', opts));
    } catch (_) {
      /* fall through to click() */
    }
    el.click();
  }

  GCX.dom = {
    BLOCK_TAGS,
    CONTROL_SELECTOR,
    FORM_CONTROL_SELECTOR,
    sleep,
    waitFor,
    waitForQuiet,
    isVisible,
    isBusy,
    isControl,
    containsControl,
    containsFormControl,
    ownText,
    textPieces,
    normalizeInline,
    textOf,
    cleanText,
    splitLines,
    outermost,
    precedes,
    sortInDocumentOrder,
    findScrollContainer,
    getBaseUrl,
    resolveHref,
    scrollIntoViewSafe,
    clickElement,
  };
})(globalThis);
