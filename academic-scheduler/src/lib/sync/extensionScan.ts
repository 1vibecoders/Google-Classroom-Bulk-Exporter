// Class scans sent by the browser extension (src/background/scheduler-bridge.js
// in the extension), turned into the common import batch (SPEC.md § 12.2,
// § 12.3) so they take the same path as the Google Classroom sync: merge,
// import preview, the person's choices, undo.
//
// Everything here is untrusted input: the message is checked field by field,
// texts are cut to the format's limits, and only https links are kept. The
// extension reads what Classroom's pages show, so dates are display texts
// (read by classroomDates.ts) and an item missing from a scan is never taken
// as removed (a page may not show everything).
import type { DateStr } from '../../model/types';
import {
  IMPORT_BATCH_VERSION,
  type ImportBatch,
  type ImportedAnnouncement,
  type ImportedAssignment,
  type ImportedCourse,
  type ImportedLink,
} from '../../model/importBatch';
import { readExtensionDocuments, type ExtensionDocument } from '../documents/fromExtension';
import { todayLocal } from '../time';
import { parseClassroomDate } from './classroomDates';

export const EXTENSION_PROTOCOL = 'academic-scheduler/extension-import';
export const EXTENSION_PROTOCOL_VERSION = 2;
/** Version 1 (extension 1.0.0) sends classes only; version 2 adds course documents. */
const ACCEPTED_VERSIONS = [1, 2];
export const EXTENSION_FILE_NAME = 'Browser extension scan';
const MAX_CLASSES = 40;
const MAX_ITEMS = 2000;
const ANNOUNCEMENT_LIMIT = 20;
/** Classroom ids as the extension writes them (they become part of schedule IDs). */
const SOURCE_ID = /^[A-Za-z0-9._:-]{1,90}$/;

export interface ScanItem {
  id: string;
  type: 'assignment' | 'material' | 'question' | 'announcement' | 'other';
  title: string;
  topic: string | null;
  description: string;
  classroomUrl: string | null;
  meta: { dueText: string | null; pointsText: string | null; postedText: string | null };
  resources: { kind: string; title: string | null; url: string }[];
}

export interface ClassScan {
  createdAt: string;
  classInfo: { courseId: string; name: string; section: string | null; url: string | null };
  topics: string[];
  items: ScanItem[];
  warnings: string[];
}

export type ExtensionMessage = { id: string; scans: ClassScan[]; documents: ExtensionDocument[] } | { id: string; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? Array.from(v.trim()).slice(0, max).join('') : null);
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const httpsUrl = (v: unknown): string | null => (typeof v === 'string' && /^https:\/\/[^\s]{1,1990}$/.test(v) ? v : null);
const ITEM_TYPES = new Set(['assignment', 'material', 'question', 'announcement', 'other']);

function readItem(v: unknown): ScanItem | null {
  if (!isObj(v) || typeof v.id !== 'string' || !SOURCE_ID.test(v.id)) return null;
  const meta = isObj(v.meta) ? v.meta : {};
  return {
    id: v.id,
    type: (ITEM_TYPES.has(String(v.type)) ? v.type : 'other') as ScanItem['type'],
    title: str(v.title, 200) ?? 'Untitled item',
    topic: str(v.topic, 200),
    description: str(v.description, 5000) ?? '',
    classroomUrl: httpsUrl(v.classroomUrl),
    meta: { dueText: str(meta.dueText, 120), pointsText: str(meta.pointsText, 60), postedText: str(meta.postedText, 120) },
    resources: list(v.resources, 50).flatMap((r) => {
      const url = isObj(r) ? httpsUrl(r.url) : null;
      return url && isObj(r) ? [{ kind: str(r.kind, 40) ?? 'link', title: str(r.title, 300), url }] : [];
    }),
  };
}

function readScan(v: unknown): ClassScan | null {
  if (!isObj(v) || !isObj(v.classInfo)) return null;
  const info = v.classInfo;
  if (typeof info.courseId !== 'string' || !SOURCE_ID.test(info.courseId)) return null;
  return {
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : '',
    classInfo: { courseId: info.courseId, name: str(info.name, 200) ?? 'Untitled class', section: str(info.section, 200), url: httpsUrl(info.url) },
    topics: [...new Set(list(v.topics, 200).flatMap((t) => (isObj(t) && str(t.name, 200) ? [str(t.name, 200)!] : [])))],
    items: list(v.items, MAX_ITEMS).flatMap((i) => readItem(i) ?? []),
    warnings: list(v.warnings, 20).flatMap((w) => str(w, 300) ?? []),
  };
}

/** null: not an extension import message (ignore it). */
export function readExtensionMessage(data: unknown): ExtensionMessage | null {
  if (!isObj(data) || data.protocol !== EXTENSION_PROTOCOL || data.type !== 'import' || typeof data.id !== 'string' || !data.id || data.id.length > 100) return null;
  if (!ACCEPTED_VERSIONS.includes(data.version as number)) {
    return { id: data.id, error: 'This version of the extension does not match the website. Update the extension and reload the website.' };
  }
  if (!Array.isArray(data.snapshots) || data.snapshots.length === 0) return { id: data.id, error: 'The extension sent no classes.' };
  if (data.snapshots.length > MAX_CLASSES) return { id: data.id, error: `Send at most ${MAX_CLASSES} classes at a time.` };
  const scans = data.snapshots.map(readScan);
  if (scans.some((s) => s === null)) return { id: data.id, error: 'The extension sent a class the website could not read.' };
  return { id: data.id, scans: scans as ClassScan[], documents: readExtensionDocuments(data.documents) };
}

function scanDay(createdAt: string, fallback: DateStr): DateStr {
  const moment = new Date(createdAt);
  return Number.isNaN(moment.getTime()) ? fallback : todayLocal(moment);
}

function links(item: ScanItem, prefix?: string): ImportedLink[] {
  return item.resources.map((r) => ({ title: Array.from(prefix ? `${prefix}: ${r.title ?? 'Link'}` : (r.title ?? 'Link')).slice(0, 300).join(''), url: r.url }));
}

/** The scans as one import batch, in the browser's time zone. */
export function scansToBatch(scans: ClassScan[], timezone: string, importedAt: string): ImportBatch {
  const today = importedAt.slice(0, 10);
  const courses: ImportedCourse[] = [];
  const assignments: ImportedAssignment[] = [];
  const warnings: string[] = [];
  for (const scan of scans) {
    const { classInfo } = scan;
    const classId = `gc-class-${classInfo.courseId}`;
    const day = scanDay(scan.createdAt, today);
    const course: ImportedCourse = { id: classId, sourceId: classInfo.courseId, name: classInfo.name, state: 'present' };
    if (classInfo.section) course.section = classInfo.section;
    if (classInfo.url) course.url = classInfo.url;
    if (scan.topics.length) course.topics = scan.topics;
    const materials: ImportedLink[] = [];
    const announcements: ImportedAnnouncement[] = [];
    for (const item of scan.items) {
      const posted = parseClassroomDate(item.meta.postedText, day, day, true);
      const postedAt = posted?.kind === 'date' ? posted.value : undefined;
      if (item.type === 'material') {
        if (item.classroomUrl) materials.push({ title: item.title, url: item.classroomUrl });
        materials.push(...links(item, item.title));
        continue;
      }
      if (item.type === 'announcement') {
        const text = item.description || item.title;
        const found = links(item);
        announcements.push({ text, ...(postedAt ? { postedAt } : {}), ...(item.classroomUrl ? { url: item.classroomUrl } : {}), ...(found.length ? { links: found } : {}) });
        continue;
      }
      const asg: ImportedAssignment = { id: `gc-${item.id}`, classId, sourceId: item.id, title: item.title, state: 'present' };
      if (item.description) asg.description = item.description;
      if (item.topic) asg.topic = item.topic;
      if (item.classroomUrl) asg.url = item.classroomUrl;
      const points = /^(\d+(?:\.\d+)?) points?$/.exec(item.meta.pointsText ?? '');
      if (points && Number(points[1]) > 0) asg.points = `${points[1]} points`;
      const found = links(item);
      if (found.length) asg.links = found;
      // Year-less due dates are placed near the posting date (SCHEDULE_FORMAT.md § 14.2).
      const due = parseClassroomDate(item.meta.dueText, postedAt?.slice(0, 10) ?? day, day);
      if (due?.kind === 'date') {
        asg.due = due.value;
        if (due.ambiguous) {
          const message = `Classroom shows the due date as “${item.meta.dueText}” without a year; it was read as ${due.value.slice(0, 10)} but could also be ${due.ambiguous.join(' or ')}.`;
          asg.dueNote = { kind: 'ambiguity', message };
          warnings.push(`“${item.title}” (${classInfo.name}): ${message}`);
        }
      } else if (due?.kind === 'unreadable') {
        const message = `Classroom shows the due date as “${item.meta.dueText}”, which could not be read, so it was left out.`;
        asg.dueNote = { kind: 'missing_information', message };
        warnings.push(`“${item.title}” (${classInfo.name}): ${message}`);
      }
      assignments.push(asg);
    }
    if (materials.length) course.materials = materials.slice(0, 200);
    // A scan without announcements may have skipped the Stream (an export option), so it never clears them.
    // The Stream lists the newest first; keep that order when no posting time says otherwise.
    if (announcements.length) course.announcements = announcements
      .map((a, i) => ({ a, i }))
      .sort((x, y) => (y.a.postedAt ?? '').localeCompare(x.a.postedAt ?? '') || x.i - y.i)
      .slice(0, ANNOUNCEMENT_LIMIT)
      .map(({ a }) => a);
    courses.push(course);
    for (const w of scan.warnings) warnings.push(`${classInfo.name}: ${w}`);
  }
  return {
    batchVersion: IMPORT_BATCH_VERSION,
    sourceType: 'browser_extension',
    importedAt,
    timezone,
    courses,
    assignments,
    // Without a knowledge base of earlier scans the extension cannot tell new from changed; the preview does.
    counts: { new: 0, changed: 0, unchanged: 0, missing: 0 },
    warnings,
  };
}
