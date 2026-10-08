// Calendar and clock arithmetic on wall-clock strings.
//
// Schedule times are local wall-clock values without a time zone
// (SCHEDULE_FORMAT.md § 4). To stay independent of the browser's zone and of
// daylight-saving changes, dates are converted to "day numbers" (days since
// 1970-01-01 in the proleptic Gregorian calendar, computed with UTC) and times
// to minutes since midnight. JavaScript Date objects are only used to read
// "today"/"now" from the device clock.
import type { DateOrDateTimeStr, DateStr, LocalDateTimeStr, TimeStr, Weekday } from '../model/types';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const LDT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const MINUTES_PER_DAY = 1440;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidDate(value: unknown): value is DateStr {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  return !!m && isRealDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function isValidTime(value: unknown): value is TimeStr {
  if (typeof value !== 'string') return false;
  const m = TIME_RE.exec(value);
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/** A valid end time: any valid time, or `24:00` (the end of the day). */
export function isValidEndTime(value: unknown): value is TimeStr {
  return value === '24:00' || isValidTime(value);
}

export function isValidLocalDateTime(value: unknown): value is LocalDateTimeStr {
  if (typeof value !== 'string') return false;
  const m = LDT_RE.exec(value);
  if (!m) return false;
  if (!isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) return false;
  if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
  return m[6] === undefined || Number(m[6]) <= 59;
}

export function isValidDateOrDateTime(value: unknown): value is DateOrDateTimeStr {
  return isValidDate(value) || isValidLocalDateTime(value);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Days since 1970-01-01 for a valid DateStr. */
export function dayNumber(date: DateStr): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function dateFromDayNumber(n: number): DateStr {
  const d = new Date(n * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function addDays(date: DateStr, days: number): DateStr {
  return dateFromDayNumber(dayNumber(date) + days);
}

export function daysBetween(from: DateStr, to: DateStr): number {
  return dayNumber(to) - dayNumber(from);
}

export function weekdayOf(date: DateStr): Weekday {
  // 1970-01-01 was a Thursday (index 4).
  const idx = (((dayNumber(date) + 4) % 7) + 7) % 7;
  return WEEKDAY_BY_INDEX[idx];
}

/** Index 0 = Monday … 6 = Sunday. */
export function mondayIndex(date: DateStr): number {
  return (((dayNumber(date) + 3) % 7) + 7) % 7;
}

/** The Monday of the Monday–Sunday week containing `date`. */
export function mondayOf(date: DateStr): DateStr {
  return addDays(date, -mondayIndex(date));
}

/** First day of the week containing `date`, honouring settings.weekStartsOn. */
export function startOfWeek(date: DateStr, weekStartsOn: 'monday' | 'sunday' = 'monday'): DateStr {
  if (weekStartsOn === 'monday') return mondayOf(date);
  const sundayIdx = (((dayNumber(date) + 4) % 7) + 7) % 7; // 0 = Sunday
  return addDays(date, -sundayIdx);
}

/** Dates from `start` to `end`, both inclusive. */
export function dateRange(start: DateStr, end: DateStr): DateStr[] {
  const out: DateStr[] = [];
  for (let n = dayNumber(start); n <= dayNumber(end); n++) out.push(dateFromDayNumber(n));
  return out;
}

export function compareDates(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0; // ISO strings sort chronologically
}

// ---------------------------------------------------------------------------
// Times and date-times
// ---------------------------------------------------------------------------

export function timeToMinutes(time: TimeStr): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes since midnight → `HH:MM` (clamped to 00:00–23:59). */
export function minutesToTime(minutes: number): TimeStr {
  const m = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minutes)));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** Combine to `YYYY-MM-DDTHH:MM:00` (the canonical export form). */
export function toLocalDateTime(date: DateStr, time: TimeStr): LocalDateTimeStr {
  return `${date}T${time}:00`;
}

export function splitLocalDateTime(value: LocalDateTimeStr): { date: DateStr; time: TimeStr } {
  const m = LDT_RE.exec(value);
  if (!m) throw new Error(`Invalid date-time: ${value}`);
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** Drop seconds: `2026-10-13T16:00:59` → `2026-10-13T16:00:00`. */
export function normalizeLocalDateTime(value: LocalDateTimeStr): LocalDateTimeStr {
  const { date, time } = splitLocalDateTime(value);
  return toLocalDateTime(date, time);
}

/** Absolute minutes (day number × 1440 + minutes) for ordering and arithmetic. */
export function ldtToMinutes(value: LocalDateTimeStr): number {
  const { date, time } = splitLocalDateTime(value);
  return dayNumber(date) * MINUTES_PER_DAY + timeToMinutes(time);
}

export function minutesToLdt(total: number): LocalDateTimeStr {
  const day = Math.floor(total / MINUTES_PER_DAY);
  return toLocalDateTime(dateFromDayNumber(day), minutesToTime(total - day * MINUTES_PER_DAY));
}

export function compareLdt(a: LocalDateTimeStr, b: LocalDateTimeStr): number {
  return ldtToMinutes(a) - ldtToMinutes(b);
}

/** Minutes between two date-times (b − a). */
export function minutesBetween(a: LocalDateTimeStr, b: LocalDateTimeStr): number {
  return ldtToMinutes(b) - ldtToMinutes(a);
}

export function isDateOnly(value: DateOrDateTimeStr): boolean {
  return DATE_RE.test(value);
}

/** The calendar date of a Date or LocalDateTime. */
export function dateOf(value: DateOrDateTimeStr): DateStr {
  return isDateOnly(value) ? value : splitLocalDateTime(value).date;
}

/** The time of a LocalDateTime, or null for a date-only value. */
export function timeOf(value: DateOrDateTimeStr): TimeStr | null {
  return isDateOnly(value) ? null : splitLocalDateTime(value).time;
}

/**
 * A due date as a moment: date-only values mean `defaultDueTime` that day
 * (SCHEDULE_FORMAT.md § 8, settings.defaultDueTime).
 */
export function dueMoment(due: DateOrDateTimeStr, defaultDueTime: TimeStr = '00:00'): LocalDateTimeStr {
  return isDateOnly(due) ? toLocalDateTime(due, defaultDueTime) : normalizeLocalDateTime(due);
}

/** A date-only value as "end of day" (23:59), used for date comparisons. */
export function endOfDayMoment(value: DateOrDateTimeStr): LocalDateTimeStr {
  return isDateOnly(value) ? toLocalDateTime(value, '23:59') : normalizeLocalDateTime(value);
}

/** A date-only value as "start of day" (00:00). */
export function startOfDayMoment(value: DateOrDateTimeStr): LocalDateTimeStr {
  return isDateOnly(value) ? toLocalDateTime(value, '00:00') : normalizeLocalDateTime(value);
}

// ---------------------------------------------------------------------------
// Device clock
// ---------------------------------------------------------------------------

export function todayLocal(now: Date = new Date()): DateStr {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function nowLocal(now: Date = new Date()): LocalDateTimeStr {
  return toLocalDateTime(todayLocal(now), `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
}

// ---------------------------------------------------------------------------
// Display (English, deterministic)
// ---------------------------------------------------------------------------

function parts(date: DateStr): { y: number; m: number; d: number; wd: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error(`Invalid date: ${date}`);
  const wd = (((dayNumber(date) + 4) % 7) + 7) % 7;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), wd };
}

/** "Tuesday, October 13" (with the year when it differs from `currentYear`). */
export function formatDateLong(date: DateStr, currentYear?: number): string {
  const p = parts(date);
  const base = `${WEEKDAY_NAMES[p.wd]}, ${MONTHS[p.m - 1]} ${p.d}`;
  return currentYear !== undefined && currentYear !== p.y ? `${base}, ${p.y}` : base;
}

/** "Oct 13" (or "Oct 13, 2027" when the year differs from `currentYear`). */
export function formatDateShort(date: DateStr, currentYear?: number): string {
  const p = parts(date);
  const base = `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}`;
  return currentYear !== undefined && currentYear !== p.y ? `${base}, ${p.y}` : base;
}

/** "Tue, Oct 13" */
export function formatDateWithWeekday(date: DateStr, currentYear?: number): string {
  const p = parts(date);
  return `${WEEKDAY_NAMES[p.wd].slice(0, 3)}, ${formatDateShort(date, currentYear)}`;
}

/** "4:00 PM" */
export function formatTime12(time: TimeStr): string {
  const total = timeToMinutes(time);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h % 24 < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${suffix}`;
}

/** "4 PM" for whole hours, else "4:30 PM" (timeline labels). */
export function formatHourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h % 24 < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${pad2(m)} ${suffix}`;
}

/** "45 m", "2 h", "2 h 30 m", "0 m" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}

/** "Oct 16, 11:59 PM" or "Oct 16" for a date-only value. */
export function formatDateOrDateTime(value: DateOrDateTimeStr, currentYear?: number): string {
  const date = dateOf(value);
  const time = timeOf(value);
  return time ? `${formatDateShort(date, currentYear)}, ${formatTime12(time)}` : formatDateShort(date, currentYear);
}
