/*
 * Classify a link found in Classroom into a resource descriptor.
 *
 * Classification is purely URL based (no DOM), so it is stable across
 * Classroom UI changes and is unit-tested without a browser.
 *
 * Descriptor:
 *   kind        drive-file | google-doc | google-sheet | google-slides |
 *               google-drawing | google-form | google-site | drive-folder |
 *               youtube | classroom | link
 *   id          Drive/Docs file id, folder id or YouTube video id (if any)
 *   resourceKey Drive "resourcekey" needed for some link-shared files
 *   url         absolute URL (redirect wrappers removed)
 *   key         de-duplication key (same Drive file => same key)
 *   authuser    account index carried by the link itself, if any
 *   published   true for "publish to web" Docs/Forms links (/d/e/...)
 *   hint        extra detail, e.g. "ambiguous" (drive "open?id=" links) or "ipynb"
 */
(function (root) {
  'use strict';
  const GCX = root.GCX || (root.GCX = {});

  const DOCS_TYPES = {
    document: 'google-doc',
    spreadsheets: 'google-sheet',
    presentation: 'google-slides',
    drawings: 'google-drawing',
    forms: 'google-form',
  };

  const TRACKING_PARAMS = /^(usp|utm_[a-z]+|fbclid|gclid|ouid|rtpof|sd)$/i;

  function parseUrl(href, baseUrl) {
    try {
      return new URL(String(href).trim(), baseUrl || 'https://classroom.google.com/');
    } catch (_) {
      return null;
    }
  }

  /** Remove Google redirect wrappers such as https://www.google.com/url?q=<target>. */
  function unwrap(url) {
    let current = url;
    for (let i = 0; i < 3 && current; i++) {
      const host = current.hostname.replace(/^www\./, '');
      if ((host === 'google.com' || /^google\.[a-z.]+$/.test(host)) && current.pathname === '/url') {
        const target = current.searchParams.get('q') || current.searchParams.get('url');
        const next = target ? parseUrl(target) : null;
        if (!next) break;
        current = next;
        continue;
      }
      break;
    }
    return current;
  }

  function authuserOf(url) {
    const q = url.searchParams.get('authuser');
    if (q && /^\d+$/.test(q)) return Number(q);
    const m = /\/u\/(\d+)\//.exec(url.pathname + '/');
    return m ? Number(m[1]) : null;
  }

  function normalizedLinkKey(url) {
    const copy = new URL(url.href);
    copy.hash = '';
    for (const name of Array.from(copy.searchParams.keys())) {
      if (TRACKING_PARAMS.test(name)) copy.searchParams.delete(name);
    }
    const path = copy.pathname.replace(/\/+$/, '');
    const query = copy.searchParams.toString();
    return `url:${copy.hostname.toLowerCase()}${path}${query ? `?${query}` : ''}`;
  }

  function driveDescriptor(url, id, extra = {}) {
    return {
      kind: 'drive-file',
      id,
      resourceKey: url.searchParams.get('resourcekey') || null,
      url: url.href,
      key: `drive:${id}`,
      host: url.hostname,
      authuser: authuserOf(url),
      published: false,
      hint: null,
      ...extra,
    };
  }

  function classifyDrive(url) {
    const path = url.pathname;
    let m = /^\/(?:u\/\d+\/)?file\/d\/([A-Za-z0-9_-]{10,})/.exec(path);
    if (m) return driveDescriptor(url, m[1]);
    m = /^\/(?:drive\/)?(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/.exec(path);
    if (m) {
      return { ...driveDescriptor(url, m[1]), kind: 'drive-folder', key: `folder:${m[1]}` };
    }
    m = /^\/drive\/(?:u\/\d+\/)?(?:shared-drives|mydrive)\/?([A-Za-z0-9_-]*)/.exec(path);
    if (m) {
      const id = m[1] || null;
      return { ...driveDescriptor(url, id || 'root'), kind: 'drive-folder', id, key: id ? `folder:${id}` : normalizedLinkKey(url) };
    }
    const qid = url.searchParams.get('id');
    if (qid && /^[A-Za-z0-9_-]{10,}$/.test(qid)) {
      if (/^\/(?:u\/\d+\/)?(?:uc|download)$/.test(path)) return driveDescriptor(url, qid);
      if (/^\/(?:u\/\d+\/)?open$/.test(path)) return driveDescriptor(url, qid, { hint: 'ambiguous' });
      if (/^\/(?:u\/\d+\/)?folderview$/.test(path)) {
        return { ...driveDescriptor(url, qid), kind: 'drive-folder', key: `folder:${qid}` };
      }
    }
    return null;
  }

  function classifyDocs(url) {
    const path = url.pathname;
    let m = /^\/(document|spreadsheets|presentation|drawings|forms)\/(?:u\/\d+\/)?d\/(e\/)?([A-Za-z0-9_-]{10,})/.exec(path);
    if (m) {
      const kind = DOCS_TYPES[m[1]];
      const published = !!m[2];
      const id = m[3];
      return {
        kind,
        id,
        resourceKey: url.searchParams.get('resourcekey') || null,
        url: url.href,
        key: published ? `published:${id}` : `drive:${id}`,
        host: url.hostname,
        authuser: authuserOf(url),
        published,
        hint: null,
      };
    }
    m = /^\/(?:u\/\d+\/)?file\/d\/([A-Za-z0-9_-]{10,})/.exec(path);
    if (m) return driveDescriptor(url, m[1]);
    const qid = url.searchParams.get('id');
    if (qid && /^\/(?:u\/\d+\/)?(?:open|uc)$/.test(path)) {
      return driveDescriptor(url, qid, { hint: path.endsWith('open') ? 'ambiguous' : null });
    }
    return null;
  }

  function classifyYouTube(url) {
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1] || null;
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/.exec(url.pathname);
      if (m) id = m[1];
    }
    return {
      kind: 'youtube',
      id,
      resourceKey: null,
      url: url.href,
      key: id ? `youtube:${id}` : normalizedLinkKey(url),
      host: url.hostname,
      authuser: null,
      published: false,
      hint: null,
    };
  }

  function genericLink(url, kind = 'link') {
    return {
      kind,
      id: null,
      resourceKey: null,
      url: url.href,
      key: normalizedLinkKey(url),
      host: url.hostname,
      authuser: authuserOf(url),
      published: false,
      hint: null,
    };
  }

  /**
   * Classify an href. Returns null for links that are never resources
   * (javascript:, mailto:, anchors, Drive thumbnails...).
   */
  function classify(href, baseUrl) {
    if (!href) return null;
    const raw = String(href).trim();
    if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|data|blob|about|chrome|chrome-extension):/i.test(raw)) return null;
    const parsed = parseUrl(raw, baseUrl);
    if (!parsed || !/^https?:$/.test(parsed.protocol)) return null;
    const url = unwrap(parsed);
    if (!url || !/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();

    if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') {
      if (/^\/(?:u\/\d+\/)?thumbnail$/.test(url.pathname)) return null; // preview images, not resources
      return classifyDrive(url) || genericLink(url);
    }
    if (host === 'docs.google.com') return classifyDocs(url) || genericLink(url);
    if (host === 'colab.research.google.com') {
      const m = /^\/drive\/([A-Za-z0-9_-]{10,})/.exec(url.pathname);
      if (m) return driveDescriptor(url, m[1], { hint: 'ipynb' });
      return genericLink(url);
    }
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be' || host === 'youtube-nocookie.com') return classifyYouTube(url);
    if (host === 'sites.google.com') return genericLink(url, 'google-site');
    if (host === 'classroom.google.com') return genericLink(url, 'classroom');
    return genericLink(url);
  }

  /** Kinds the exporter can turn into a file. */
  function isDownloadableKind(kind) {
    return kind === 'drive-file' || kind === 'google-doc' || kind === 'google-sheet' || kind === 'google-slides' || kind === 'google-drawing';
  }

  /** Human label used in descriptions and reports. */
  function kindLabel(kind) {
    return {
      'drive-file': 'Drive file',
      'google-doc': 'Google Docs',
      'google-sheet': 'Google Sheets',
      'google-slides': 'Google Slides',
      'google-drawing': 'Google Drawings',
      'google-form': 'Google Forms',
      'google-site': 'Google Sites',
      'drive-folder': 'Drive folder',
      youtube: 'YouTube video',
      classroom: 'Classroom link',
      link: 'Link',
    }[kind] || 'Link';
  }

  /**
   * When the same resource is found twice (e.g. a Drive card and a Docs link
   * to the same file id), keep the most specific kind.
   */
  function preferDescriptor(a, b) {
    const rank = (d) => (d.kind === 'drive-file' ? (d.hint === 'ambiguous' ? 0 : 1) : d.kind.startsWith('google-') ? 2 : 1);
    return rank(b) > rank(a) ? b : a;
  }

  GCX.resources = { classify, unwrap: (href) => { const u = parseUrl(href); return u ? unwrap(u).href : null; }, isDownloadableKind, kindLabel, preferDescriptor };
})(globalThis);
