// Recurrence rules (SCHEDULE_FORMAT.md § 10 "Recurrence").
//
// A weekly rule occurs on date d when all of these hold:
//   1. startDate ≤ d (and d ≤ endDate when endDate is present);
//   2. the weekday of d is in daysOfWeek;
//   3. d is not in exceptDates;
//   4. ((monday(d) − monday(startDate)) in days / 7) mod interval = 0, where
//      monday(x) is the Monday of the Monday-to-Sunday week containing x
//      (independent of settings.weekStartsOn).
// All arithmetic is on epoch-day numbers (src/lib/time.ts), never on
// timestamps, so daylight-saving changes cannot shift an occurrence.
import { WEEKDAYS, WEEKDAY_LABELS, WEEKDAY_SHORT } from '../model/constants';
import type { DateStr, Recurrence, Weekday } from '../model/types';
import { dateFromDayNumber, dayNumber, formatDateShort, isValidDate, mondayIndex, weekdayOf } from './time';

/** The rule's interval as a whole number ≥ 1 (absent or invalid → 1). */
function intervalOf(rule: Recurrence): number {
  const n = rule.interval;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Conditions 2 and 4 of § 10 for day number `n` (no range or exception check). */
function matchesPattern(rule: Recurrence, n: number, startMonday: number, interval: number): boolean {
  const date = dateFromDayNumber(n);
  if (!rule.daysOfWeek.includes(weekdayOf(date))) return false;
  const monday = n - mondayIndex(date);
  const weeks = (monday - startMonday) / 7;
  return ((weeks % interval) + interval) % interval === 0;
}

function prepared(rule: Recurrence): { start: number; end: number; startMonday: number; interval: number; except: Set<string> } | null {
  if (!rule || !Array.isArray(rule.daysOfWeek) || rule.daysOfWeek.length === 0) return null;
  if (!isValidDate(rule.startDate)) return null;
  if (rule.endDate !== undefined && !isValidDate(rule.endDate)) return null;
  const start = dayNumber(rule.startDate);
  const end = rule.endDate !== undefined ? dayNumber(rule.endDate) : Number.POSITIVE_INFINITY;
  return {
    start,
    end,
    startMonday: start - mondayIndex(rule.startDate),
    interval: intervalOf(rule),
    except: new Set(rule.exceptDates || []),
  };
}

/** True if the rule produces an occurrence on `date` (all four conditions of § 10). */
export function occursOn(rule: Recurrence, date: DateStr): boolean {
  const p = prepared(rule);
  if (!p || !isValidDate(date)) return false;
  const n = dayNumber(date);
  if (n < p.start || n > p.end) return false;
  if (p.except.has(date)) return false;
  return matchesPattern(rule, n, p.startMonday, p.interval);
}

/** All occurrence dates of `rule` between `from` and `to` (inclusive), ascending. */
export function occurrencesInRange(rule: Recurrence, from: DateStr, to: DateStr): DateStr[] {
  const p = prepared(rule);
  if (!p || !isValidDate(from) || !isValidDate(to)) return [];
  const first = Math.max(p.start, dayNumber(from));
  const last = Math.min(p.end, dayNumber(to));
  const out: DateStr[] = [];
  for (let n = first; n <= last; n++) {
    if (!matchesPattern(rule, n, p.startMonday, p.interval)) continue;
    const date = dateFromDayNumber(n);
    if (!p.except.has(date)) out.push(date);
  }
  return out;
}

/**
 * The first occurrence on or after `from`, or null when there is none (the
 * rule ended, or every remaining occurrence is excepted). Bounded search:
 * every `interval` weeks contain at least one matching day, and each
 * exception can remove at most one, so the answer (if any) lies within
 * 7 × interval × (exceptions + 2) days.
 */
export function nextOccurrence(rule: Recurrence, from: DateStr): DateStr | null {
  const p = prepared(rule);
  if (!p || !isValidDate(from)) return null;
  const first = Math.max(p.start, dayNumber(from));
  const bound = first + 7 * p.interval * (p.except.size + 2);
  const last = Math.min(p.end, bound);
  for (let n = first; n <= last; n++) {
    if (!matchesPattern(rule, n, p.startMonday, p.interval)) continue;
    const date = dateFromDayNumber(n);
    if (!p.except.has(date)) return date;
  }
  return null;
}

/** True if the rule never produces any occurrence (used for a warning, § 13.4). */
export function neverOccurs(rule: Recurrence): boolean {
  const p = prepared(rule);
  if (!p) return true;
  if (p.end < p.start) return true;
  return nextOccurrence(rule, rule.startDate) === null;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function sortedDays(days: Weekday[]): Weekday[] {
  return WEEKDAYS.filter((d) => days.includes(d));
}

const WEEKDAYS_MON_FRI: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export interface DescribeOptions {
  /** Show the year of dates that are not in this year (e.g. the current year). */
  currentYear?: number;
}

/**
 * Human description, e.g. "Every Mon, Wed and Fri from Sep 2 to Jun 18
 * (except Nov 26 and Nov 27)", "Every other Monday from Oct 14",
 * "Every weekday from Sep 2 (5 exceptions)". Only exceptions that remove an
 * actual occurrence are mentioned.
 */
export function describeRecurrence(rule: Recurrence, options: DescribeOptions = {}): string {
  const days = sortedDays(Array.isArray(rule?.daysOfWeek) ? rule.daysOfWeek : []);
  if (days.length === 0) return 'Never (no days selected)';
  const interval = intervalOf(rule);
  const isEveryDay = days.length === 7;
  const isWeekdays = days.length === 5 && WEEKDAYS_MON_FRI.every((d) => days.includes(d));

  let pattern: string;
  if (interval === 1) {
    if (isEveryDay) pattern = 'Every day';
    else if (isWeekdays) pattern = 'Every weekday';
    else if (days.length === 1) pattern = `Every ${WEEKDAY_LABELS[days[0]]}`;
    else pattern = `Every ${joinList(days.map((d) => WEEKDAY_SHORT[d]))}`;
  } else {
    const every = interval === 2 ? 'every other week' : `every ${interval} weeks`;
    if (isEveryDay) pattern = `Every day, ${every}`;
    else if (interval === 2 && days.length === 1) pattern = `Every other ${WEEKDAY_LABELS[days[0]]}`;
    else if (isWeekdays) pattern = `Weekdays, ${every}`;
    else if (days.length === 1) pattern = `Every ${interval} weeks on ${WEEKDAY_LABELS[days[0]]}`;
    else pattern = `${every[0].toUpperCase()}${every.slice(1)} on ${joinList(days.map((d) => WEEKDAY_SHORT[d]))}`;
  }

  const year = options.currentYear;
  let range = '';
  if (isValidDate(rule.startDate)) {
    range = ` from ${formatDateShort(rule.startDate, year)}`;
    if (rule.endDate && isValidDate(rule.endDate)) range += ` to ${formatDateShort(rule.endDate, year)}`;
  } else if (rule.endDate && isValidDate(rule.endDate)) {
    range = ` until ${formatDateShort(rule.endDate, year)}`;
  }

  // Exceptions that actually cancel an occurrence (inside the range, on a
  // matching day and week).
  const withoutExceptions: Recurrence = { ...rule, exceptDates: [] };
  const relevant = [...new Set(rule.exceptDates || [])]
    .filter((d) => isValidDate(d) && occursOn(withoutExceptions, d))
    .sort();
  let except = '';
  if (relevant.length > 0 && relevant.length <= 3) {
    except = ` (except ${joinList(relevant.map((d) => formatDateShort(d, year)))})`;
  } else if (relevant.length > 3) {
    except = ` (${relevant.length} exceptions)`;
  }

  return `${pattern}${range}${except}`;
}
