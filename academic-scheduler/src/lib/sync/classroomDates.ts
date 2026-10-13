// Dates as Google Classroom displays them ("Oct 10, 11:59 PM", "Tomorrow",
// "9:00 AM"), read the same way as the /academic-schedule skill
// (skills/academic-schedule/scripts/inventory.py, parse_classroom_date).
// Year-less dates get the year that puts them closest to a reference date
// (SCHEDULE_FORMAT.md § 14.2); two about equally close years are reported.
import type { DateOrDateTimeStr, DateStr } from '../../model/types';
import { addDays, daysBetween, isValidDate } from '../time';

export type ClassroomDate =
  | { kind: 'date'; value: DateOrDateTimeStr; ambiguous?: DateStr[] }
  | { kind: 'none' }
  | { kind: 'unreadable' };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAY_WORDS = /(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\.?/gi;
const TIME_IN_TEXT = /(?<![0-9])([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*([ap])\.?\s?m\.?(?![a-z])|(?<![0-9])([0-9]{1,2})[:.]([0-9]{2})(?![0-9])/i;
const YEAR_IN_TEXT = /(?<![0-9])((?:19|20)[0-9]{2})(?![0-9])/;
const MONTH_DAY = /(?<![a-z])([a-z]{3,9})\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?(?![0-9])/i;
const DAY_MONTH = /(?<![0-9])([0-9]{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?![a-z])/i;
const RELATIVE = /(?<![a-z])(today|tomorrow|yesterday)(?![a-z])/i;

const pad = (n: number) => String(n).padStart(2, '0');

function realDate(year: number, month: number, day: number): DateStr | null {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  return isValidDate(date) ? date : null;
}

/** The year that puts month/day closest to `ref`; `past`: the latest such date not after `ref` (+1 day). */
function inferYear(month: number, day: number, ref: DateStr, past: boolean): { date: DateStr; ambiguous?: DateStr[] } | null {
  const year = Number(ref.slice(0, 4));
  const candidates = [year - 1, year, year + 1]
    .map((y) => realDate(y, month, day))
    .filter((d): d is DateStr => d !== null)
    .map((d) => ({ d, distance: Math.abs(daysBetween(ref, d)) }));
  if (!candidates.length) return null;
  if (past) {
    const earlier = candidates.filter((c) => daysBetween(c.d, addDays(ref, 1)) >= 0).map((c) => c.d);
    if (earlier.length) return { date: earlier.sort().at(-1)! };
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const [best, next] = candidates;
  return next && next.distance - best.distance < 31 ? { date: best.d, ambiguous: [next.d] } : { date: best.d };
}

function cutOut(text: string, m: RegExpExecArray): string {
  return `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
}

/**
 * @param ref the date a year-less date is placed near (the item's posted date, or the scan date)
 * @param scanDate the day of the scan, for "Today", "Tomorrow" and time-only dates
 * @param past posted/edited dates: never after the scan
 */
export function parseClassroomDate(text: string | null | undefined, ref: DateStr, scanDate: DateStr, past = false): ClassroomDate | null {
  if (!text) return null;
  let rest = text.trim();
  if (/^no due date$/i.test(rest)) return { kind: 'none' };
  rest = rest.replace(/\(?\s*edited:?[^)]*\)?/gi, ' ').replace(/^\s*(due|posted|created|assigned|edited|scheduled(?: for)?)\s*(on\s+)?:?\s*/i, '');

  let time: string | null = null;
  let m = TIME_IN_TEXT.exec(rest);
  if (m) {
    let hour: number;
    let minute: number;
    if (m[3]) {
      hour = Number(m[1]);
      minute = Number(m[2] ?? 0);
      hour = hour > 12 || minute > 59 ? -1 : (hour % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
    } else {
      hour = Number(m[4]);
      minute = Number(m[5]);
      if (hour > 23 || minute > 59) hour = -1;
    }
    if (hour >= 0) {
      time = `${pad(hour)}:${pad(minute)}`;
      rest = cutOut(rest, m);
    }
  }
  let year: number | null = null;
  m = YEAR_IN_TEXT.exec(rest);
  if (m) {
    year = Number(m[1]);
    rest = cutOut(rest, m);
  }
  let month: number | null = null;
  let day = 0;
  let relative: string | null = null;
  m = RELATIVE.exec(rest);
  if (m) {
    relative = m[1].toLowerCase();
    rest = cutOut(rest, m);
  } else {
    for (const [pattern, monthGroup, dayGroup] of [
      [MONTH_DAY, 1, 2],
      [DAY_MONTH, 2, 1],
    ] as const) {
      const found = pattern.exec(rest);
      if (found && found[monthGroup].toLowerCase() in MONTHS) {
        month = MONTHS[found[monthGroup].toLowerCase()];
        day = Number(found[dayGroup]);
        rest = cutOut(rest, found);
        break;
      }
    }
  }
  const leftover = rest.replace(WEEKDAY_WORDS, ' ').replace(/[\s,]|\bat\b/gi, '');
  if (leftover || (month === null && relative === null && time === null)) return { kind: 'unreadable' };

  let date: DateStr | null;
  let ambiguous: DateStr[] | undefined;
  if (relative) date = addDays(scanDate, { today: 0, tomorrow: 1, yesterday: -1 }[relative as 'today'] ?? 0);
  else if (month !== null && year !== null) date = realDate(year, month, day);
  else if (month !== null) {
    const inferred = inferYear(month, day, ref, past);
    date = inferred?.date ?? null;
    ambiguous = inferred?.ambiguous;
  } else date = scanDate; // time only: Classroom shows only the time for today
  if (!date) return { kind: 'unreadable' };
  return { kind: 'date', value: time ? `${date}T${time}:00` : date, ...(ambiguous ? { ambiguous } : {}) };
}
