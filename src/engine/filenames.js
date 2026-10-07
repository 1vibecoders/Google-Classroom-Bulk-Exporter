// File and folder naming: sanitization that is valid on Windows, macOS and
// Linux, extension handling, Content-Disposition parsing and collision-free,
// deterministic allocation of names inside a folder.

const RESERVED_WINDOWS = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
const MAX_COMPONENT_BYTES = 200; // well under the 255-byte limit of common file systems
const encoder = new TextEncoder();

function byteLength(text) {
  return encoder.encode(text).length;
}

/** Truncate to at most `maxChars` characters and `maxBytes` UTF-8 bytes without splitting a character. */
function truncate(text, maxChars, maxBytes) {
  let chars = Array.from(text);
  if (chars.length > maxChars) chars = chars.slice(0, maxChars);
  while (chars.length && byteLength(chars.join('')) > maxBytes) chars.pop();
  return chars.join('');
}

/** Split "name.ext" into ["name", ".ext"]; only short alphanumeric extensions count. */
export function splitExtension(name) {
  const m = /^(.+?)(\.[A-Za-z0-9]{1,10})$/.exec(name);
  if (!m || /^\.+$/.test(m[1])) return [name, ''];
  return [m[1], m[2]];
}

/**
 * Make one path component safe on every major OS.
 * Characters that are invalid on Windows are replaced with readable
 * look-alikes, trailing dots/spaces are removed, reserved device names are
 * prefixed and the length is limited while keeping the extension.
 */
export function sanitizeComponent(name, { maxLength = 120, fallback = 'untitled' } = {}) {
  let s = String(name ?? '').normalize('NFC');
  s = s.replace(/[\t\n\r\f\v]/g, ' ');
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  s = s.replace(/:/g, ' -').replace(/[/\\|]/g, '-').replace(/"/g, "'").replace(/[<>*?]/g, '_');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED_WINDOWS.test(s)) s = `_${s}`;
  const [base, ext] = splitExtension(s);
  const maxBaseChars = Math.max(1, maxLength - ext.length);
  const maxBaseBytes = Math.max(1, MAX_COMPONENT_BYTES - byteLength(ext));
  let trimmedBase = truncate(base, maxBaseChars, maxBaseBytes).replace(/[.\s]+$/, '');
  if (!trimmedBase) trimmedBase = fallback;
  return `${trimmedBase}${ext}`;
}

/** Parse a filename from a Content-Disposition header (RFC 6266 / RFC 5987). */
export function parseContentDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*([^;]+)/i.exec(header);
  if (star) {
    const value = star[1].trim().replace(/^"(.*)"$/, '$1');
    const m = /^([^']*)'[^']*'(.*)$/.exec(value);
    const encoded = m ? m[2] : value;
    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded) return decoded;
    } catch (_) {
      /* fall through to filename= */
    }
  }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(header);
  const plain = quoted ? null : /filename\s*=\s*([^;]+)/i.exec(header);
  let name = quoted ? quoted[1].replace(/\\(.)/g, '$1') : plain ? plain[1].trim() : null;
  if (!name) return null;
  // Header values reach JavaScript as Latin-1; recover UTF-8 names sent raw.
  if (/[\u0080-\u00ff]/.test(name) && !/[^\u0000-\u00ff]/.test(name)) {
    try {
      const bytes = Uint8Array.from(name, (c) => c.charCodeAt(0));
      name = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (_) {
      /* keep Latin-1 interpretation */
    }
  }
  return name;
}

const TYPE_EXTENSIONS = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'application/rtf': '.rtf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/json': '.json',
  'application/x-ipynb+json': '.ipynb',
  'application/epub+zip': '.epub',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/html': '.html',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/heic': '.heic',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
};

export function extensionForContentType(contentType) {
  if (!contentType) return '';
  const type = String(contentType).split(';')[0].trim().toLowerCase();
  return TYPE_EXTENSIONS[type] || '';
}

/**
 * Pick the saved file name for a download: the server's original name when
 * available, otherwise the name shown in Classroom, with an extension added
 * when it is missing.
 */
export function chooseFileName({ headerName, displayName, fallbackExt = '', contentType, fallback = 'attachment', maxLength = 150 }) {
  let name = (headerName && headerName.trim()) || (displayName && displayName.trim()) || fallback;
  const [, ext] = splitExtension(name);
  if (!ext) {
    const guessed = fallbackExt || extensionForContentType(contentType);
    if (guessed) name += guessed;
  } else if (fallbackExt && ext.toLowerCase() !== fallbackExt.toLowerCase() && !headerName) {
    // e.g. a Google Doc titled "notes.v2" exported as .docx
    name += fallbackExt;
  }
  return sanitizeComponent(name, { maxLength, fallback });
}

/**
 * Allocates unique names per folder. Comparison is case-insensitive because
 * Windows and macOS file systems are; collisions get " (2)", " (3)", ...
 * Allocation is deterministic for a given call order.
 */
export class NameAllocator {
  constructor() {
    this.used = new Map();
  }

  setFor(dir) {
    const key = dir.toLowerCase();
    if (!this.used.has(key)) this.used.set(key, new Set());
    return this.used.get(key);
  }

  reserve(dir, name) {
    this.setFor(dir).add(name.toLowerCase());
  }

  allocate(dir, name) {
    const used = this.setFor(dir);
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const [base, ext] = splitExtension(name);
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`;
      if (!used.has(candidate.toLowerCase())) {
        used.add(candidate.toLowerCase());
        return candidate;
      }
    }
  }
}

/** Local date as YYYY-MM-DD. */
export function isoDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
