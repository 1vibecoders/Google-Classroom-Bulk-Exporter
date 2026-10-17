// Plain text of a course document (SPEC.md § 12.1: referenced Drive documents),
// shared by the server (Drive API) and the website (files the browser extension
// sends). Google Docs and Slides arrive already exported as plain text; PDFs,
// Word and PowerPoint files are parsed here. Images, scans and other formats
// have no text to read and are reported, never guessed.
import { strFromU8, unzipSync } from 'fflate';

export const GOOGLE_DOC = 'application/vnd.google-apps.document';
export const GOOGLE_SLIDES = 'application/vnd.google-apps.presentation';
export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Google formats that Drive exports as text/plain. */
export const EXPORTED_AS_TEXT = new Set([GOOGLE_DOC, GOOGLE_SLIDES]);
export const READABLE = new Set([GOOGLE_DOC, GOOGLE_SLIDES, PDF, DOCX, PPTX]);

/** Largest file read (bytes); Drive's own export limit is 10 MB. */
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
/** Longest text kept per document (characters). */
export const MAX_DOCUMENT_CHARS = 200_000;

export type DocumentStatus = 'ok' | 'unsupported' | 'too_large' | 'no_text' | 'unreadable';

export type DocumentText = { status: 'ok'; text: string } | { status: Exclude<DocumentStatus, 'ok'> };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function xmlText(xml: string, paragraphEnd: RegExp, run: RegExp): string {
  return xml
    .replace(paragraphEnd, '\n')
    .replace(/<w:tab\/>|<a:tab\/>/g, '\t')
    .replace(/<w:br\/>|<a:br\/>/g, '\n')
    .replace(run, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (_, name, dec, hex) =>
      name ? ENTITIES[name] : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16)),
    );
}

function unzip(bytes: Uint8Array, keep: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(bytes, { filter: (f) => keep(f.name) && f.originalSize <= MAX_DOCUMENT_BYTES });
}

function docxText(bytes: Uint8Array): string {
  const files = unzip(bytes, (n) => n === 'word/document.xml');
  const xml = files['word/document.xml'];
  return xml ? xmlText(strFromU8(xml), /<\/w:p>/g, /<w:t[^>]*>([^<]*)<\/w:t>/g) : '';
}

function pptxText(bytes: Uint8Array): string {
  const files = unzip(bytes, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const number = (n: string) => Number(/(\d+)\.xml$/.exec(n)![1]);
  return Object.keys(files)
    .sort((a, b) => number(a) - number(b))
    .map((name) => xmlText(strFromU8(files[name]), /<\/a:p>/g, /<a:t>([^<]*)<\/a:t>/g).trim())
    .filter(Boolean)
    .join('\n\n');
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const { text } = await extractText(await getDocumentProxy(bytes), { mergePages: false });
  return text.join('\n\n');
}

/** Collapses runs of spaces and blank lines; keeps paragraphs. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The text of a document's bytes. Google Docs and Slides must be the text/plain export. */
export async function documentText(bytes: Uint8Array, mime: string): Promise<DocumentText> {
  if (!READABLE.has(mime)) return { status: 'unsupported' };
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) return { status: 'too_large' };
  let text: string;
  try {
    if (EXPORTED_AS_TEXT.has(mime)) text = new TextDecoder().decode(bytes);
    else if (mime === PDF) text = await pdfText(bytes);
    else if (mime === DOCX) text = docxText(bytes);
    else text = pptxText(bytes);
  } catch {
    return { status: 'unreadable' };
  }
  const clean = tidy(text.replace(/^\uFEFF/, ''));
  if (!clean) return { status: 'no_text' };
  return { status: 'ok', text: Array.from(clean).slice(0, MAX_DOCUMENT_CHARS).join('') };
}
