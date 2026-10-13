// Course documents the browser extension sends with its class scans
// (protocol version 2): the files it downloaded with the person's own Google
// session, read here into text. Untrusted input: every field is checked, sizes
// are capped, and only the document types the website reads are decoded.
import type { CourseDocument, CourseDocumentStatus } from '../../model/courseDocument';

export const MAX_EXTENSION_DOCUMENTS = 40;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,90}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const PARENT_KINDS: Record<string, 'coursework' | 'material' | 'announcement'> = {
  assignment: 'coursework',
  question: 'coursework',
  material: 'material',
  announcement: 'announcement',
};

export type Parent = { kind: 'coursework' | 'material' | 'announcement'; sourceId: string };

export interface ExtensionDocument {
  fileId: string;
  /** Exporter form of the Classroom course id. */
  courseId: string;
  parent: Parent | null;
  title: string;
  url?: string;
  /** 'file': `mime` and base64 `data` are set; otherwise why there is no file. */
  status: 'file' | 'unsupported' | 'too_large' | 'inaccessible';
  mime?: string;
  data?: string;
}

/** A document ready to store: what the website shows, its text, and where it is attached. */
export interface ReadDocument {
  doc: CourseDocument;
  text?: string;
  parents: Parent[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function readExtensionDocuments(value: unknown): ExtensionDocument[] {
  if (!Array.isArray(value)) return [];
  const out: ExtensionDocument[] = [];
  let total = 0;
  for (const v of value.slice(0, MAX_EXTENSION_DOCUMENTS)) {
    if (!isObj(v) || typeof v.fileId !== 'string' || !DRIVE_ID.test(v.fileId) || typeof v.courseId !== 'string' || !SOURCE_ID.test(v.courseId)) continue;
    if (!['file', 'unsupported', 'too_large', 'inaccessible'].includes(String(v.status))) continue;
    const kind = typeof v.itemType === 'string' ? PARENT_KINDS[v.itemType] : undefined;
    const doc: ExtensionDocument = {
      fileId: v.fileId,
      courseId: v.courseId,
      parent: kind && typeof v.itemId === 'string' && SOURCE_ID.test(v.itemId) ? { kind, sourceId: v.itemId } : null,
      title: typeof v.title === 'string' && v.title.trim() ? Array.from(v.title.trim()).slice(0, 300).join('') : 'Document',
      ...(typeof v.url === 'string' && /^https:\/\/[^\s]{1,1990}$/.test(v.url) ? { url: v.url } : {}),
      status: v.status as ExtensionDocument['status'],
    };
    if (doc.status === 'file') {
      const data = typeof v.data === 'string' ? v.data : '';
      const bytes = Math.floor((data.length * 3) / 4);
      if (typeof v.mime !== 'string' || !TYPES.has(v.mime) || !data || !BASE64.test(data)) continue;
      if (bytes > MAX_FILE_BYTES || total + bytes > MAX_TOTAL_BYTES) {
        out.push({ ...doc, status: 'too_large' });
        continue;
      }
      total += bytes;
      doc.mime = v.mime;
      doc.data = data;
    }
    out.push(doc);
  }
  return out;
}

function decode(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Reads the files into text (the parsers load only when needed). */
export async function readDocuments(docs: ExtensionDocument[]): Promise<ReadDocument[]> {
  const out: ReadDocument[] = [];
  for (const d of docs) {
    let status: CourseDocumentStatus = d.status === 'file' ? 'unreadable' : d.status;
    let text: string | undefined;
    if (d.status === 'file') {
      const { documentText } = await import('./text');
      const result = await documentText(decode(d.data!), d.mime!);
      status = result.status;
      if (result.status === 'ok') text = result.text;
    }
    out.push({
      doc: {
        id: d.fileId,
        classId: `gc-class-${d.courseId}`,
        title: d.title,
        ...(d.url ? { url: d.url } : {}),
        mime: d.mime ?? 'unknown',
        status,
        chars: text?.length ?? 0,
        via: 'extension',
      },
      ...(text ? { text } : {}),
      parents: d.parent ? [d.parent] : [],
    });
  }
  return out;
}
