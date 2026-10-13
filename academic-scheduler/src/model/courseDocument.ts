// A course document as the website shows it (server/documents.ts reads them
// from Google Drive; the browser extension can send them too). The text itself
// is fetched only when the person opens it.
import type { Id } from './types';

export type CourseDocumentStatus = 'ok' | 'unsupported' | 'too_large' | 'no_text' | 'unreadable' | 'inaccessible';

export interface CourseDocument {
  /** Google Drive file id. */
  id: string;
  /** Schedule ID of the class (`gc-class-…`). */
  classId: Id;
  title: string;
  url?: string;
  mime: string;
  status: CourseDocumentStatus;
  /** Characters of text read (0 when there is none). */
  chars: number;
  via: 'drive' | 'extension';
}

export const DOCUMENT_STATUS_TEXT: Record<CourseDocumentStatus, string> = {
  ok: 'Text read',
  unsupported: 'No text to read (not a document, PDF or slides)',
  too_large: 'Too large to read',
  no_text: 'No text found (for example a scan or images only)',
  unreadable: 'Could not be read (damaged or protected file)',
  inaccessible: 'Your account cannot open this file',
};
