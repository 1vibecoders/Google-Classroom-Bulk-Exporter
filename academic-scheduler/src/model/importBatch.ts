// The common import batch (SPEC.md § 12.3): what an ingestion workflow (the
// Google Classroom API sync today, the browser extension later) hands to the
// website. It only carries what the source says; the website merges it onto
// the current schedule (src/lib/sync/mergeBatch.ts) and shows the usual import
// preview, so matching, protection of the person's edits and undo are shared.
// IDs follow SCHEDULE_FORMAT.md § 14.1, so the same Classroom item gets the same
// ID whichever workflow brought it in.
import type { DateOrDateTimeStr, Id, LocalDateTimeStr } from './types';

export const IMPORT_BATCH_VERSION = 1;

export type BatchSourceType = 'classroom_api' | 'browser_extension';

/** present: listed by the source; missing: no longer listed after a complete listing; inaccessible: the source refused access. */
export type BatchItemState = 'present' | 'missing' | 'inaccessible';

export interface ImportedCourse {
  /** Schedule ID, `gc-class-<courseId>`. */
  id: Id;
  /** Classroom course id in the exporter's form (unpadded base64 of the decimal id). */
  sourceId: string;
  name: string;
  section?: string;
  room?: string;
  url?: string;
  description?: string;
  /** Topic names in source order. Absent when the topics could not be read. */
  topics?: string[];
  /** Class materials (each material's page and its attachments). Absent when they could not be read. */
  materials?: ImportedLink[];
  /** Newest first. Absent when the announcements could not be read. */
  announcements?: ImportedAnnouncement[];
  state: BatchItemState;
}

export interface ImportedLink {
  title: string;
  url: string;
}

export interface ImportedAnnouncement {
  text: string;
  postedAt?: DateOrDateTimeStr;
  url?: string;
  links?: ImportedLink[];
}

export interface ImportedAssignment {
  /** Schedule ID, `gc-<itemId>`. */
  id: Id;
  classId: Id;
  sourceId: string;
  /** Absent for a `missing` item (only its state is reported). */
  title?: string;
  description?: string;
  /** Local date or date-time in the batch's time zone. */
  due?: DateOrDateTimeStr;
  points?: string;
  url?: string;
  links?: ImportedLink[];
  topic?: string;
  /** The person turned it in (or it was returned). */
  turnedIn?: boolean;
  /** The source's due date needs the person's review (e.g. a year-less date that fits two years). */
  dueNote?: { kind: 'ambiguity' | 'missing_information'; message: string };
  state: Exclude<BatchItemState, 'inaccessible'>;
}

export interface SyncCounts {
  new: number;
  changed: number;
  unchanged: number;
  missing: number;
}

export interface ImportBatch {
  batchVersion: typeof IMPORT_BATCH_VERSION;
  sourceType: BatchSourceType;
  /** When the source was read, local wall-clock time in `timezone`. */
  importedAt: LocalDateTimeStr;
  timezone: string;
  courses: ImportedCourse[];
  assignments: ImportedAssignment[];
  counts: SyncCounts;
  /** Plain-language problems: inaccessible courses, partial listings, … */
  warnings: string[];
}

/** User-triggered sync allowance (SPEC.md § 13.5): at most 3 per rolling 24 hours. */
export interface SyncAllowance {
  limit: number;
  remaining: number;
  /** ISO time when another sync becomes available, when none is left. */
  nextAvailableAt: string | null;
  running: boolean;
}
