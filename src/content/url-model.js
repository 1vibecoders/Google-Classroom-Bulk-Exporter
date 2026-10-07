/*
 * Google Classroom URL model.
 *
 * URLs are the most stable contract Classroom exposes, so page detection and
 * item identity are derived from them rather than from CSS classes.
 *
 * Known shapes (all optionally prefixed by /u/<n> for multi-account sessions
 * and, for some Workspace accounts, /a/<domain>):
 *   /c/<courseId>                          class stream
 *   /c/<courseId>/<kind>/<itemId>/details  item details (a = assignment,
 *                                          m = material, sa/mc/q = question)
 *   /c/<courseId>/p/<postId>               announcement
 *   /w/<courseId>/t/all                    classwork (all topics)
 *   /w/<courseId>/tc/<topicId>             classwork filtered by topic
 *   /r/<courseId>/...                      people
 * Course and item ids are usually the unpadded base64 of a decimal id
 * (e.g. "NjI3ODk0MjE0NTQ5" == base64("627894214549")).
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});

  const CLASSROOM_ORIGIN = 'https://classroom.google.com';
  const PATH_RE = /^((?:\/u\/\d+)?(?:\/a\/[^/]+)?)\/(c|w|r)\/([A-Za-z0-9_-]+)(\/.*)?$/;
  const ITEM_KIND_TO_TYPE = {
    a: 'assignment',
    m: 'material',
    sa: 'question',
    mc: 'question',
    q: 'question',
    p: 'announcement',
  };

  function safeUrl(href, base) {
    try {
      return new URL(href, base || CLASSROOM_ORIGIN);
    } catch (_) {
      return null;
    }
  }

  /**
   * Parse a Classroom URL into its parts. Never throws.
   * @returns {{isClassroom:boolean, origin:string, prefix:string, authuser:number,
   *   courseId:(string|null), page:string, topicId:(string|null),
   *   itemKind:(string|null), itemId:(string|null), itemType:(string|null)}}
   */
  function parse(href) {
    const url = /^https?:\/\//i.test(String(href || '')) ? safeUrl(href) : null;
    const result = {
      isClassroom: false,
      origin: CLASSROOM_ORIGIN,
      prefix: '',
      authuser: 0,
      courseId: null,
      page: 'other',
      topicId: null,
      itemKind: null,
      itemId: null,
      itemType: null,
    };
    if (!url || url.hostname !== 'classroom.google.com') return result;
    result.isClassroom = true;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const userMatch = /^\/u\/(\d+)(?:\/|$)/.exec(path);
    if (userMatch) result.authuser = Number(userMatch[1]);
    const qp = url.searchParams.get('authuser');
    if (!userMatch && qp && /^\d+$/.test(qp)) result.authuser = Number(qp);

    const m = PATH_RE.exec(path);
    if (!m) {
      result.page = /^(\/u\/\d+)?(\/h)?$/.test(path) || path === '/' ? 'home' : 'other';
      if (userMatch) result.prefix = `/u/${userMatch[1]}`;
      return result;
    }
    const [, prefix, area, courseId, rest = ''] = m;
    result.prefix = prefix;
    result.courseId = courseId;
    const segs = rest.split('/').filter(Boolean);
    if (area === 'c') {
      if (segs.length === 0) {
        result.page = 'stream';
      } else if (segs[0] === 'p' && segs[1]) {
        result.page = 'announcement';
        result.itemKind = 'p';
        result.itemId = segs[1];
        result.itemType = 'announcement';
      } else if (ITEM_KIND_TO_TYPE[segs[0]] && segs[1]) {
        result.page = 'item';
        result.itemKind = segs[0];
        result.itemId = segs[1];
        result.itemType = ITEM_KIND_TO_TYPE[segs[0]];
      } else {
        result.page = 'course-other';
      }
    } else if (area === 'w') {
      if (segs[0] === 'tc' && segs[1]) {
        result.page = 'classwork-topic';
        result.topicId = segs[1];
      } else {
        result.page = 'classwork';
      }
    } else if (area === 'r') {
      result.page = 'people';
    }
    return result;
  }

  function prefixOf(ctx) {
    if (ctx.prefix) return ctx.prefix;
    return ctx.authuser ? `/u/${ctx.authuser}` : '/u/0';
  }

  function classworkUrl(ctx) {
    return `${CLASSROOM_ORIGIN}${prefixOf(ctx)}/w/${ctx.courseId}/t/all`;
  }

  function streamUrl(ctx) {
    return `${CLASSROOM_ORIGIN}${prefixOf(ctx)}/c/${ctx.courseId}`;
  }

  function itemUrl(ctx, kind, itemId) {
    const id = toUrlId(itemId);
    if (kind === 'p') return `${CLASSROOM_ORIGIN}${prefixOf(ctx)}/c/${ctx.courseId}/p/${id}`;
    return `${CLASSROOM_ORIGIN}${prefixOf(ctx)}/c/${ctx.courseId}/${kind}/${id}/details`;
  }

  function base64Encode(text) {
    if (typeof btoa === 'function') return btoa(text);
    return Buffer.from(text, 'binary').toString('base64'); // Node (tests)
  }

  function base64Decode(text) {
    let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof atob === 'function') return atob(s);
    return Buffer.from(s, 'base64').toString('binary'); // Node (tests)
  }

  /** The id form used in Classroom URLs (unpadded base64 of the decimal id). */
  function toUrlId(id) {
    const value = String(id || '');
    if (/^\d+$/.test(value)) return base64Encode(value).replace(/=+$/, '');
    return value;
  }

  /** Canonical comparable key for an id that may be decimal or base64. */
  function idKey(id) {
    const value = String(id || '').trim();
    if (!value) return '';
    if (/^\d+$/.test(value)) return value;
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
      try {
        const decoded = base64Decode(value);
        if (/^\d+$/.test(decoded)) return decoded;
      } catch (_) {
        /* not base64 */
      }
    }
    return value;
  }

  /** True if two course/item ids refer to the same object. */
  function sameId(a, b) {
    const ka = idKey(a);
    return !!ka && ka === idKey(b);
  }

  /** Strip query/hash, for stable URLs in metadata. */
  function canonical(href) {
    const url = safeUrl(href);
    if (!url) return href;
    url.hash = '';
    url.search = '';
    return url.href;
  }

  GCX.url = {
    CLASSROOM_ORIGIN,
    ITEM_KIND_TO_TYPE,
    parse,
    classworkUrl,
    streamUrl,
    itemUrl,
    toUrlId,
    idKey,
    sameId,
    canonical,
  };
})(globalThis);
