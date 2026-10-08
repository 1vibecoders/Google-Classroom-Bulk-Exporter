// Pure helpers shared by the editor forms: text limits, date/time parts,
// defaults that must stay absent, completion timestamps, dependency cycles
// and the problem list that drives inline validation.
//
// Every rule here mirrors SCHEDULE_FORMAT.md (§ 3 data types, § 7–12 field
// limits, § 13 validation), so an item the editors save is always valid.
import { codePointLength, compareDateValues } from '../../lib/validate';
import {
  isDateOnly,
  isValidDate,
  isValidEndTime,
  isValidLocalDateTime,
  isValidTime,
  ldtToMinutes,
  splitLocalDateTime,
  timeToMinutes,
} from '../../lib/time';
import { collectIds } from '../../lib/ids';
import type { DateOrDateTimeStr, LocalDateTimeStr, ScheduleDocument } from '../../model/types';

// ---------------------------------------------------------------------------
// Problems (validation results)
// ---------------------------------------------------------------------------

export interface Problem {
  /** Form field key, e.g. `title`, `tasks.u-tsk-1.due`, `references.3.url`. */
  key: string;
  /** Shown under the field. */
  message: string;
  /** Prefix for the summary list, e.g. `Subtask 2`. */
  context?: string;
  /**
   * A required value is missing. Shown only after the first save attempt so
   * an empty new form does not start out red.
   */
  required?: boolean;
}

export class ProblemList {
  readonly items: Problem[] = [];
  add(key: string, message: string, extra: { context?: string; required?: boolean } = {}): void {
    // One message per field: the first problem found is the most basic one.
    if (this.items.some((p) => p.key === key)) return;
    this.items.push({ key, message, ...extra });
  }
  has(key: string): boolean {
    return this.items.some((p) => p.key === key);
  }
}

/** The message to show under a field, or null. */
export function errorFor(problems: Problem[], key: string, submitted: boolean): string | null {
  const problem = problems.find((p) => p.key === key);
  if (!problem) return null;
  if (problem.required && !submitted) return null;
  return problem.message;
}

/** Summary line for a problem (with its context). */
export function problemSummary(problem: Problem): string {
  return problem.context ? `${problem.context}: ${problem.message}` : problem.message;
}

// ---------------------------------------------------------------------------
// Text (§ 3: trimmed, lengths in code points, required Text non-blank)
// ---------------------------------------------------------------------------

export function checkText(
  problems: ProblemList,
  key: string,
  value: string,
  options: { label: string; max: number; required?: boolean; context?: string },
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    if (options.required) problems.add(key, `${options.label} is required.`, { context: options.context, required: true });
    return;
  }
  const length = codePointLength(trimmed);
  if (length > options.max) {
    problems.add(key, `${options.label} is too long: ${length} characters (at most ${options.max}).`, { context: options.context });
  }
}

/** Trimmed text, or undefined when blank (optional fields are omitted, never empty). */
export function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export function checkInteger(
  problems: ProblemList,
  key: string,
  value: number | '',
  options: { label: string; min: number; max: number; required?: boolean; context?: string },
): void {
  if (value === '') {
    if (options.required) problems.add(key, `${options.label} is required.`, { context: options.context, required: true });
    return;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    problems.add(key, `${options.label} must be a whole number.`, { context: options.context });
    return;
  }
  if (value < options.min || value > options.max) {
    problems.add(key, `${options.label} must be between ${options.min} and ${options.max}.`, { context: options.context });
  }
}

/** Minutes (§ 3): an integer 0–10000. */
export const MAX_MINUTES = 10000;

// ---------------------------------------------------------------------------
// Date + optional time (DateOrDateTime fields such as `due`)
// ---------------------------------------------------------------------------

export interface DateTimeParts {
  /** YYYY-MM-DD or ''. */
  date: string;
  /** HH:MM or '' (no time: a date-only value). */
  time: string;
}

export const NO_DATE: DateTimeParts = { date: '', time: '' };

export function partsOf(value: string | undefined): DateTimeParts {
  if (!value) return { date: '', time: '' };
  if (isDateOnly(value)) return { date: value, time: '' };
  if (isValidLocalDateTime(value)) {
    const { date, time } = splitLocalDateTime(value);
    return { date, time };
  }
  // An unreadable stored value: show what we can; validation reports it.
  return { date: String(value).slice(0, 10), time: '' };
}

/** True if both parts are empty. */
export function isEmptyParts(parts: DateTimeParts): boolean {
  return !parts.date && !parts.time;
}

export function checkDateTimeParts(
  problems: ProblemList,
  key: string,
  parts: DateTimeParts,
  options: { label: string; required?: boolean; context?: string },
): void {
  if (!parts.date) {
    if (parts.time) problems.add(key, `${options.label}: choose a date for this time.`, { context: options.context });
    else if (options.required) problems.add(key, `${options.label} is required.`, { context: options.context, required: true });
    return;
  }
  if (!isValidDate(parts.date)) {
    problems.add(key, `${options.label} is not a valid date.`, { context: options.context });
    return;
  }
  if (parts.time && !isValidTime(parts.time)) {
    problems.add(key, `${options.label} has an invalid time.`, { context: options.context });
  }
}

/** The DateOrDateTime value of valid parts, or undefined when empty/invalid. */
export function valueOfParts(parts: DateTimeParts): DateOrDateTimeStr | undefined {
  if (!parts.date || !isValidDate(parts.date)) return undefined;
  if (!parts.time) return parts.date;
  if (!isValidTime(parts.time)) return undefined;
  return `${parts.date}T${parts.time}:00`;
}

/**
 * The value to store: the composed value, but the original string when it
 * means the same (so `…T23:59` is not rewritten as `…T23:59:00` and recorded
 * as a change).
 */
export function composeDateTime(parts: DateTimeParts, original: string | undefined): DateOrDateTimeStr | undefined {
  const value = valueOfParts(parts);
  if (value === undefined || original === undefined) return value;
  if (sameDateOrDateTime(value, original)) return original;
  return value;
}

export function sameDateOrDateTime(a: string, b: string): boolean {
  if (a === b) return true;
  if (isDateOnly(a) || isDateOnly(b)) return false;
  if (!isValidLocalDateTime(a) || !isValidLocalDateTime(b)) return false;
  return ldtToMinutes(a) === ldtToMinutes(b);
}

/** `a` ≤ `b` with the § 13.3 comparison (date-only on either side → dates only). */
export function notAfter(a: string, b: string): boolean {
  return compareDateValues(a, b) <= 0;
}

// ---------------------------------------------------------------------------
// Times of day (events, availability, blocks)
// ---------------------------------------------------------------------------

export function checkTimeRange(
  problems: ProblemList,
  keys: { start: string; end: string },
  startTime: string,
  endTime: string,
  options: { context?: string; minMinutes?: number } = {},
): void {
  const ctx = { context: options.context };
  if (!startTime) problems.add(keys.start, 'Start time is required.', { ...ctx, required: true });
  else if (!isValidTime(startTime)) problems.add(keys.start, 'Start time is not a valid time.', ctx);
  if (!endTime) problems.add(keys.end, 'End time is required.', { ...ctx, required: true });
  else if (!isValidEndTime(endTime)) problems.add(keys.end, 'End time is not a valid time.', ctx);
  if (isValidTime(startTime) && isValidEndTime(endTime)) {
    const minutes = timeToMinutes(endTime) - timeToMinutes(startTime);
    const min = options.minMinutes ?? 1;
    if (minutes <= 0) problems.add(keys.end, 'End time must be later than the start time.', ctx);
    else if (minutes < min) problems.add(keys.end, `End time must be at least ${min} minutes after the start time.`, ctx);
  }
}

// ---------------------------------------------------------------------------
// Defaults and absent fields
// ---------------------------------------------------------------------------

/**
 * A field with a default (type, priority, busy, required, …): when the value
 * equals the default and the item never had the field, keep it absent. This
 * avoids writing defaults into imported items (which would also be recorded
 * as the person's edit in `overrides`).
 */
export function keepDefault<T>(original: T | undefined, value: T, fallback: T): T | undefined {
  if (original === undefined && value === fallback) return undefined;
  return value;
}

/** Remove keys whose value is undefined (the format has no null/undefined values). */
export function compact<T extends object>(item: T): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const key of Object.keys(copy)) if (copy[key] === undefined) delete copy[key];
  return copy as T;
}

/** A list field: undefined when empty, unless it was an empty list before. */
export function listOrAbsent<T>(list: T[]): T[] | undefined {
  return list.length ? list : undefined;
}

/**
 * Status + completedAt (§ 13.1 rule 7): completedAt is kept when the item was
 * already done, set to `now` when it becomes done, and removed otherwise.
 */
export function completionFields(
  status: string | undefined,
  before: { status?: string; completedAt?: LocalDateTimeStr } | undefined,
  now: LocalDateTimeStr,
): LocalDateTimeStr | undefined {
  if (status !== 'done') return undefined;
  if (before?.status === 'done' && before.completedAt) return before.completedAt;
  return now;
}

// ---------------------------------------------------------------------------
// Dependencies (no self-reference, no cycles; § 13.2 rule 18)
// ---------------------------------------------------------------------------

/** True if `to` can be reached from `from` by following dependsOn edges. */
export function reaches(graph: Map<string, string[]>, from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of graph.get(id) || []) stack.push(next);
  }
  return false;
}

/**
 * Would `id` depending on `candidate` create a cycle? (`candidate` already
 * depends on `id`, directly or indirectly, or is `id` itself.)
 */
export function wouldCycle(graph: Map<string, string[]>, id: string, candidate: string): boolean {
  return candidate === id || reaches(graph, candidate, id);
}

/** The ids on a dependency cycle through `id`, or null when there is none. */
export function findCycle(graph: Map<string, string[]>, id: string): string[] | null {
  for (const dep of graph.get(id) || []) {
    if (dep === id) return [id];
    if (reaches(graph, dep, id)) return [id, dep];
  }
  return null;
}

// ---------------------------------------------------------------------------
// URLs (§ 3 URL: absolute http:/https:, ≤ 2000 characters, no spaces)
// ---------------------------------------------------------------------------

const URL_RE = /^https?:\/\/[^\s]+$/i;

/** Problem text for a URL, or null when it may be saved. */
export function urlProblem(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (codePointLength(url) > 2000) return 'This link is too long (at most 2000 characters).';
  if (/^mailto:/i.test(url)) return 'Email (mailto:) links cannot be saved in a schedule file. Use an http:// or https:// link, or put the address in the title.';
  if (!URL_RE.test(url)) return 'Use a full web address that starts with http:// or https:// (no spaces).';
  try {
    const parsed = new URL(url);
    if (!parsed.hostname) return 'This link has no host name.';
  } catch {
    return 'This is not a valid web address.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

/**
 * Every ID a new item must not take: all item and task IDs, and the IDs of
 * deleted items (§ 13.2 rule 14: no item may have an ID listed in `deleted`).
 */
export function takenIds(doc: ScheduleDocument): Set<string> {
  const ids = collectIds(doc);
  for (const stone of doc.deleted || []) ids.add(stone.id);
  return ids;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Stable form comparison for the unsaved-changes guard. */
export function sameForm(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let rowCounter = 0;
/** Local key for list rows that have no id (references, except dates). */
export function rowKey(prefix = 'row'): string {
  rowCounter += 1;
  return `${prefix}-${rowCounter}`;
}
