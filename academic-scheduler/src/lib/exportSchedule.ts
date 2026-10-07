// Export of the current schedule as a schedule file (SCHEDULE_FORMAT.md § 17).
//
// The output is canonical and deterministic: fields in the order of the
// format's object descriptions (src/lib/validate.ts), collections sorted,
// LocalDateTimes as YYYY-MM-DDTHH:MM:SS, `locked` only when true, empty
// optional arrays omitted, `x-…` properties copied unchanged. Only the fields
// the format defines are written, so the result is always well-formed.
import { APP_NAME, APP_VERSION, MAX_TOMBSTONES } from '../model/constants';
import type { LocalDateTimeStr, ScheduleDocument } from '../model/types';
import { newId } from './ids';
import { isDateOnly, isValidLocalDateTime, normalizeLocalDateTime, nowLocal } from './time';
import { FORMAT_SPECS, cloneJsonValue, validateDocument, type Kind, type ObjSpec, type ValidationIssue } from './validate';

export interface ExportOptions {
  /** The new `meta.exportId` (default: a fresh `u-exp-…` ID). */
  exportId?: string;
  /** IANA time zone for `meta.timezone` (default: the browser's). */
  timezone?: string;
  /** `meta.generator.version` (default: the app version). */
  generatorVersion?: string;
}

export interface ExportResult {
  doc: ScheduleDocument;
  /** Pretty-printed JSON (2 spaces, trailing newline). */
  json: string;
  fileName: string;
  /** The `meta.exportId` written (remember it to recognize `meta.basedOn` later). */
  exportId: string;
  /** Problems found by validating the exported file (empty for a valid schedule). */
  problems: ValidationIssue[];
}

/**
 * A complete, valid 1.0 document: meta.generator/generatedAt/timezone and a
 * fresh exportId set (title and sources kept, basedOn/requestedChanges never
 * written), every item with id + origin, `locked` only when true, empty
 * optional arrays omitted, date-times as YYYY-MM-DDTHH:MM:SS, collections
 * sorted deterministically, x- properties preserved.
 */
export function exportDocument(doc: ScheduleDocument, now: LocalDateTimeStr, options: ExportOptions = {}): ScheduleDocument {
  const source = doc as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { schemaVersion: '1.0' };

  out.meta = exportMeta(get(source, 'meta'), now, options);

  const settings = canonObject(get(source, 'settings'), FORMAT_SPECS.settings);
  if (isPlainObject(settings) && Object.keys(settings).length > 0) out.settings = settings;

  out.classes = sortBy(canonList(get(source, 'classes'), FORMAT_SPECS.class), classKey);
  out.assignments = sortBy(canonList(get(source, 'assignments'), FORMAT_SPECS.assignment), assignmentKey);
  out.events = sortBy(canonList(get(source, 'events'), FORMAT_SPECS.event), timedKey);
  out.availability = sortBy(canonList(get(source, 'availability'), FORMAT_SPECS.availability), timedKey);
  out.scheduleBlocks = sortBy(canonList(get(source, 'scheduleBlocks'), FORMAT_SPECS.block), blockKey);

  const issues = canonList(get(source, 'issues'), FORMAT_SPECS.rootIssue);
  if (issues.length > 0) out.issues = issues;

  const deleted = trimTombstones(canonList(get(source, 'deleted'), FORMAT_SPECS.tombstone));
  if (deleted.length > 0) out.deleted = deleted;

  copyExtensions(source, out);
  return out as unknown as ScheduleDocument;
}

/** Pretty-printed JSON (2 spaces, trailing newline). */
export function exportJson(doc: ScheduleDocument, now: LocalDateTimeStr, options: ExportOptions = {}): string {
  return `${JSON.stringify(exportDocument(doc, now, options), null, 2)}\n`;
}

/** Suggested file name: `schedule-YYYY-MM-DD.json`. */
export function exportFileName(now: LocalDateTimeStr): string {
  return `schedule-${now.slice(0, 10)}.json`;
}

/**
 * Everything the Export button needs: the document, its JSON, a file name,
 * the exportId to remember, and a validation of the result (should be empty;
 * if not, the UI can tell the person instead of silently writing a file the
 * website would reject on import).
 */
export function createExport(doc: ScheduleDocument, now: LocalDateTimeStr, options: ExportOptions = {}): ExportResult {
  const exportId = options.exportId ?? newId('exp');
  const exported = exportDocument(doc, now, { ...options, exportId });
  const json = `${JSON.stringify(exported, null, 2)}\n`;
  const check = validateDocument(exported, { today: now.slice(0, 10) });
  return { doc: exported, json, fileName: exportFileName(now), exportId, problems: check.errors };
}

// ---------------------------------------------------------------------------
// Recent export IDs (D25, § 16.1): the import warns when a file's
// meta.basedOn is not the most recent export. Kept in this browser only.
// ---------------------------------------------------------------------------

export const EXPORT_IDS_KEY = 'academic-scheduler.v1.export-ids';
const MAX_REMEMBERED_EXPORTS = 50;

function exportIdStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The export IDs this browser wrote, most recent first (empty when unknown). */
export function recentExportIds(): string[] {
  const store = exportIdStorage();
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.getItem(EXPORT_IDS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Remember an export ID as the most recent one (call after the file was saved). */
export function rememberExportId(exportId: string): void {
  const store = exportIdStorage();
  if (!store) return;
  try {
    const ids = [exportId, ...recentExportIds().filter((id) => id !== exportId)].slice(0, MAX_REMEMBERED_EXPORTS);
    store.setItem(EXPORT_IDS_KEY, JSON.stringify(ids));
  } catch {
    /* storage full or unavailable: the import then simply cannot tell */
  }
}

// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function get(obj: unknown, key: string): unknown {
  return isPlainObject(obj) && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function copyExtensions(from: Record<string, unknown>, to: Record<string, unknown>): void {
  for (const key of Object.keys(from)) {
    if (!key.startsWith('x-') || from[key] === undefined) continue;
    let value: unknown;
    try {
      value = cloneJsonValue(from[key]);
    } catch {
      value = from[key];
    }
    to[key] = value;
  }
}

function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === 'string' && zone.length > 0 && zone.length <= 100) return zone;
  } catch {
    /* fall through */
  }
  return 'UTC';
}

function exportMeta(meta: unknown, now: LocalDateTimeStr, options: ExportOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const title = get(meta, 'title');
  if (typeof title === 'string' && title.trim() !== '') out.title = title.trim();
  out.generatedAt = isValidLocalDateTime(now) ? normalizeLocalDateTime(now) : nowLocal();
  out.generator = { name: APP_NAME, version: options.generatorVersion ?? APP_VERSION };
  out.timezone = options.timezone ?? browserTimeZone();
  out.exportId = options.exportId ?? newId('exp');
  const sources = canonList(get(meta, 'sources'), FORMAT_SPECS.source);
  if (sources.length > 0) out.sources = sources;
  if (isPlainObject(meta)) copyExtensions(meta, out);
  return out;
}

function canonList(value: unknown, spec: ObjSpec): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const item of value) {
    const canonical = canonObject(item, spec);
    if (isPlainObject(canonical)) out.push(canonical);
  }
  return out;
}

function canonValue(value: unknown, kind: Kind): unknown {
  if (value === undefined || value === null) return undefined;
  switch (kind.k) {
    case 'text':
      return typeof value === 'string' ? value.trim() : value;
    case 'ldt':
      return typeof value === 'string' && isValidLocalDateTime(value) ? normalizeLocalDateTime(value) : value;
    case 'dodt':
      return typeof value === 'string' && !isDateOnly(value) && isValidLocalDateTime(value) ? normalizeLocalDateTime(value) : value;
    case 'array':
      return Array.isArray(value) ? value.map((item) => canonValue(item, kind.of)).filter((item) => item !== undefined) : value;
    case 'overrides':
      return Array.isArray(value) ? value.filter((name) => typeof name === 'string') : value;
    case 'object':
      return canonObject(value, kind.spec);
    default:
      return value;
  }
}

function canonObject(value: unknown, spec: ObjSpec): unknown {
  if (!isPlainObject(value)) return value === undefined || value === null ? undefined : value;
  const out: Record<string, unknown> = {};
  for (const [key, kind] of spec.fields) {
    let v = canonValue(get(value, key), kind);
    if (v === undefined) {
      if (spec.item && key === 'origin') v = 'generated';
      else continue;
    }
    if (key === 'locked' && v !== true) continue;
    if (key === 'completedAt' && get(value, 'status') !== 'done') continue;
    if (Array.isArray(v) && v.length === 0 && !spec.required.includes(key)) continue;
    out[key] = v;
  }
  copyExtensions(value, out);
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic ordering (§ 17): independent of the browser's locale.
// ---------------------------------------------------------------------------

type SortKey = Array<string | number>;

function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? '';
    const y = b[i] ?? '';
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function sortBy<T>(items: T[], key: (item: T) => SortKey): T[] {
  return items
    .map((item, index) => ({ item, key: [...key(item), index] }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((entry) => entry.item);
}

function s(item: Record<string, unknown>, key: string): string {
  const v = item[key];
  return typeof v === 'string' ? v : '';
}

function classKey(c: Record<string, unknown>): SortKey {
  return [s(c, 'name').toLowerCase(), s(c, 'name'), s(c, 'id')];
}

function assignmentKey(a: Record<string, unknown>): SortKey {
  const date = s(a, 'due') || s(a, 'assessmentDate');
  // Undated work sorts after dated work ("~" > every digit).
  return [date || '~', s(a, 'title').toLowerCase(), s(a, 'title'), s(a, 'id')];
}

/** Events and availability: by first day, then start time (all-day first), then id. */
function timedKey(item: Record<string, unknown>): SortKey {
  const recurrence = item.recurrence;
  const day = s(item, 'date') || (isPlainObject(recurrence) && typeof recurrence.startDate === 'string' ? recurrence.startDate : '');
  const time = item.allDay === true ? '' : s(item, 'startTime');
  return [day, time, s(item, 'id')];
}

function blockKey(b: Record<string, unknown>): SortKey {
  return [s(b, 'start'), s(b, 'id')];
}

/** At most MAX_TOMBSTONES entries; the oldest (by deletedAt) are dropped first. */
function trimTombstones(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (entries.length <= MAX_TOMBSTONES) return entries;
  const keep = new Set(
    entries
      .map((entry, index) => ({ index, at: s(entry, 'deletedAt') }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.index - a.index))
      .slice(0, MAX_TOMBSTONES)
      .map((entry) => entry.index),
  );
  return entries.filter((_, index) => keep.has(index));
}
