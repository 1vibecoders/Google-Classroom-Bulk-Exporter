// Read an iCalendar (.ics) file, e.g. a Google Calendar export, into the
// schedule file the import preview compares with the current schedule. Like
// mergeBatch (src/lib/sync/mergeBatch.ts), the result is the current schedule
// with only the calendar's events added or changed, so the preview lists real
// changes and every rule of the import (matching by ID, "Previously deleted",
// fields the person changed, undo) applies unchanged.
//
// Each VEVENT becomes a fixed event with a stable ID derived from its UID, so
// importing the same file again matches the same events (SPEC § 32 C). Only
// what the model can hold is imported: one-time events, all-day events and
// weekly repeats (BYDAY, INTERVAL, UNTIL or COUNT, EXDATE). Other repeats keep
// only their first occurrence and are reported in `skipped`, as are changed
// single occurrences (RECURRENCE-ID) and cancelled events.
//
// Times become wall-clock times in the schedule's zone (meta.timezone, else
// the device's): UTC (`…Z`) and TZID times are converted with Intl; a TZID
// Intl does not know is read as wall-clock time with a warning.
import { WEEKDAYS, schemaVersionFor } from '../model/constants';
import type { DateStr, LocalDateTimeStr, Recurrence, ScheduleDocument, ScheduleEvent, Source, Weekday } from '../model/types';
import { addDays, dateFromDayNumber, daysBetween, minutesToLdt, splitLocalDateTime, weekdayOf, MINUTES_PER_DAY } from './time';
import { nextOccurrence } from './recurrence';
import { isKnownTimeZone } from './validate';

export const ICS_FILE_NAME = 'Google Calendar (.ics)';
const ICS_LABEL = 'Calendar file (.ics)';

export interface IcsSkipped {
  /** The event's SUMMARY ("Untitled event" when it has none). */
  title: string;
  reason: string;
}

export interface IcsImportResult {
  /** The current schedule with the calendar's events merged in; validate it, then give it to planImport. */
  doc: ScheduleDocument;
  /** The events read from the file (empty when the file has none). */
  events: ScheduleEvent[];
  /** Events (or parts of them) that were not imported, with why. */
  skipped: IcsSkipped[];
  warnings: string[];
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** A DATE or DATE-TIME as wall-clock minutes since 1970-01-01 (day number × 1440 + minutes). */
interface Moment {
  minutes: number;
  dateOnly: boolean;
}

const BYDAY: Record<string, Weekday> = { MO: 'mon', TU: 'tue', WE: 'wed', TH: 'thu', FR: 'fri', SA: 'sat', SU: 'sun' };
const WEEKLY_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST']);
const MAX_COUNT = 1000;

// ---------------------------------------------------------------------------
// Lines and properties (RFC 5545 § 3.1)
// ---------------------------------------------------------------------------

/** Unfold continuation lines (starting with a space or tab) and split the text into lines. */
function unfold(text: string): string[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return body
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/** `NAME;P=v;Q="a:b":value`; null when the line has no `:` outside quotes. */
function parseLine(line: string): Prop | null {
  let quoted = false;
  const cuts: number[] = [];
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ';') cuts.push(i);
    else if (!quoted && ch === ':') {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = [0, ...cuts.map((c) => c + 1)].map((start, i) => line.slice(start, i < cuts.length ? cuts[i] : colon));
  const params: Record<string, string> = {};
  for (const part of head.slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: head[0].toUpperCase(), params, value: line.slice(colon + 1) };
}

/** TEXT values: `\n` is a line break, `\,` `\;` `\\` are the characters themselves. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** The properties of each VEVENT; properties of nested components (VALARM) are ignored. */
function readEvents(lines: string[]): { events: Prop[][]; calendar: boolean } {
  const events: Prop[][] = [];
  const stack: string[] = [];
  let calendar = false;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      const kind = prop.value.trim().toUpperCase();
      if (kind === 'VCALENDAR') calendar = true;
      if (kind === 'VEVENT') events.push([]);
      stack.push(kind);
    } else if (prop.name === 'END') {
      stack.pop();
    } else if (stack[stack.length - 1] === 'VEVENT' && events.length) {
      events[events.length - 1].push(prop);
    }
  }
  return { events, calendar };
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

function runtimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** Wall-clock minutes of instant `ms` in `zone` (the runtime's zone when undefined). */
function wallMinutes(ms: number, zone: string | undefined): number {
  if (!zone) {
    const d = new Date(ms);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) / 60000;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute')) / 60000;
}

/** The instant (ms) at which `zone` shows wall-clock `minutes` (two passes settle daylight-saving offsets). */
function instantOf(minutes: number, zone: string): number {
  let ms = minutes * 60000;
  for (let i = 0; i < 2; i++) ms -= (wallMinutes(ms, zone) - minutes) * 60000;
  return ms;
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

class Converter {
  readonly warnings = new Set<string>();
  constructor(readonly zone: string | undefined) {}

  /** One DATE / DATE-TIME value as a wall-clock moment in the schedule's zone; null when unreadable. */
  moment(raw: string, tzid: string | undefined): Moment | null {
    const m = DT_RE.exec(raw.trim());
    if (!m) return null;
    const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(day) || dateFromDayNumber(day / 86400000) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
    if (m[4] === undefined) return { minutes: day / 60000, dateOnly: true };
    const minutes = day / 60000 + Number(m[4]) * 60 + Number(m[5]);
    if (Number(m[4]) > 23 || Number(m[5]) > 59) return null;
    if (m[7]) return { minutes: wallMinutes(minutes * 60000, this.zone), dateOnly: false };
    if (!tzid || tzid === this.zone) return { minutes, dateOnly: false };
    if (this.zone && isKnownTimeZone(tzid)) return { minutes: wallMinutes(instantOf(minutes, tzid), this.zone), dateOnly: false };
    this.warnings.add(`Times in time zone “${tzid}” could not be converted; they were read as local times.`);
    return { minutes, dateOnly: false };
  }

  /** The first value of a property (DTSTART, DTEND). */
  prop(prop: Prop | undefined): Moment | null {
    return prop ? this.moment(prop.value.split(',')[0], prop.params.TZID) : null;
  }
}

function split(minutes: number): { date: DateStr; time: string } {
  return splitLocalDateTime(minutesToLdt(minutes));
}

function dateOfMinutes(minutes: number): DateStr {
  return dateFromDayNumber(Math.floor(minutes / MINUTES_PER_DAY));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** 32-bit FNV-1a as 8 hex digits: a short stable suffix for IDs. */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `ics-<UID>` with characters IDs cannot hold replaced; long UIDs are shortened with a hash. */
export function icsEventId(uid: string): string {
  const safe = `ics-${uid.replace(/[^A-Za-z0-9._:-]/g, '-')}`;
  return safe.length <= 100 ? safe : `${safe.slice(0, 91)}-${hash(uid)}`;
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** RRULE parts, e.g. { FREQ: 'WEEKLY', BYDAY: 'MO,WE' }. */
function ruleParts(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  return out;
}

/** Why a rule cannot be a weekly recurrence, or null when it can. */
function unsupportedRule(parts: Record<string, string>): string | null {
  if (parts.FREQ !== 'WEEKLY') return `repeats ${(parts.FREQ ?? 'in an unknown way').toLowerCase()}`;
  const extra = Object.keys(parts).filter((k) => !WEEKLY_PARTS.has(k));
  if (extra.length) return `uses a repeat rule this website cannot show (${extra.join(', ')})`;
  if (parts.BYDAY && parts.BYDAY.split(',').some((d) => !BYDAY[d])) return 'repeats on numbered weekdays (e.g. “first Monday”)';
  const interval = parts.INTERVAL === undefined ? 1 : Number(parts.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) return 'repeats with an interval this website cannot show';
  return null;
}

/** The date of the `count`-th occurrence (COUNT counts occurrences before EXDATE removes any, RFC 5545). */
function countEnd(rule: Recurrence, count: number): DateStr | undefined {
  let date: DateStr | null = rule.startDate;
  let last: DateStr | undefined;
  for (let i = 0; i < count && date; i++) {
    last = nextOccurrence(rule, date) ?? undefined;
    date = last ? addDays(last, 1) : null;
  }
  return last;
}

interface Built {
  event?: ScheduleEvent;
  skipped?: IcsSkipped;
}

function buildEvent(props: Prop[], conv: Converter, warnings: string[]): Built {
  const first = (name: string) => props.find((p) => p.name === name);
  const all = (name: string) => props.filter((p) => p.name === name);
  const title = clip(unescapeText(first('SUMMARY')?.value ?? ''), 200) || 'Untitled event';
  const skip = (reason: string): Built => ({ skipped: { title, reason } });

  if (first('RECURRENCE-ID')) return skip('a changed single occurrence of a repeating event; the repeating event itself is imported unchanged');
  if (first('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return skip('the event is cancelled');
  const start = conv.prop(first('DTSTART'));
  if (!start) return skip('it has no readable start (DTSTART)');
  const uid = first('UID')?.value.trim();
  const startDate = dateOfMinutes(start.minutes);

  // Without a UID the title and start stand in, so the same file still gives the same ID.
  const event: ScheduleEvent = { id: icsEventId(uid || `nouid-${hash(`${title}\u0000${first('DTSTART')!.value}`)}`), origin: 'generated', title };
  if (uid) event.source = { kind: 'calendar', id: clip(uid, 200), label: ICS_LABEL };
  const location = clip(unescapeText(first('LOCATION')?.value ?? ''), 200);
  if (location) event.location = location;
  if (first('TRANSP')?.value.trim().toUpperCase() === 'TRANSPARENT') event.busy = false;

  // DTEND is exclusive; without one an all-day event lasts one day (RFC 5545 § 3.6.1).
  let end = conv.prop(first('DTEND'));
  if (start.dateOnly) {
    if (end && !end.dateOnly) end = null;
    event.allDay = true;
    const lastDay = end && end.minutes > start.minutes ? dateOfMinutes(end.minutes - MINUTES_PER_DAY) : startDate;
    if (lastDay > startDate) event.endDate = lastDay;
  } else {
    if (!end || end.dateOnly) return skip('it has no end time (DTEND)');
    if (end.minutes <= start.minutes) return skip('it ends when it starts (no duration)');
    const s = split(start.minutes);
    const e = split(end.minutes);
    event.startTime = s.time;
    if (e.date === s.date) event.endTime = e.time;
    else {
      event.endTime = '24:00';
      if (!(e.time === '00:00' && daysBetween(s.date, e.date) === 1)) warnings.push(`“${title}” ends after midnight; it was shortened to end at midnight.`);
    }
  }

  const rrule = first('RRULE');
  if (!rrule) {
    event.date = startDate;
    return { event };
  }
  const parts = ruleParts(rrule.value);
  const why = unsupportedRule(parts);
  if (why) {
    event.date = startDate;
    return { event, skipped: { title, reason: `${why}; only the first occurrence (${startDate}) was imported` } };
  }

  // BYDAY names days in DTSTART's own zone; converting can move the start to another day.
  const raw = DT_RE.exec(first('DTSTART')!.value.trim())!;
  const shift = daysBetween(`${raw[1]}-${raw[2]}-${raw[3]}`, startDate);
  const named = parts.BYDAY ? parts.BYDAY.split(',').map((d) => BYDAY[d]) : [weekdayOf(addDays(startDate, -shift))];
  const days = WEEKDAYS.filter((d) => named.some((n) => WEEKDAYS[(((WEEKDAYS.indexOf(n) + shift) % 7) + 7) % 7] === d));
  const recurrence: Recurrence = { frequency: 'weekly', daysOfWeek: days, startDate };
  const interval = Number(parts.INTERVAL ?? 1);
  if (interval > 1) {
    recurrence.interval = interval;
    if ((parts.WKST ?? 'MO') !== 'MO' && days.includes('sun') && days.length > 1) {
      warnings.push(`“${title}” repeats every ${interval} weeks with weeks starting on ${parts.WKST}; this website counts weeks from Monday, so check its Sundays.`);
    }
  }
  if (event.endDate) {
    warnings.push(`“${title}” is a repeating event over several days; only its first day is shown each time.`);
    delete event.endDate;
  }

  const except = new Set<DateStr>();
  for (const prop of all('EXDATE')) {
    for (const value of prop.value.split(',')) {
      const m = conv.moment(value, prop.params.TZID);
      if (m) except.add(dateOfMinutes(m.minutes));
    }
  }
  if (except.size) recurrence.exceptDates = [...except].sort();

  if (parts.UNTIL) {
    const until = conv.moment(parts.UNTIL, first('DTSTART')!.params.TZID);
    if (until) recurrence.endDate = dateOfMinutes(until.minutes);
  } else if (parts.COUNT) {
    const count = Math.min(Number(parts.COUNT), MAX_COUNT);
    const last = Number.isInteger(count) && count >= 1 ? countEnd({ ...recurrence, exceptDates: [] }, count) : undefined;
    if (last) recurrence.endDate = last;
  }
  if (recurrence.endDate !== undefined && recurrence.endDate < startDate) recurrence.endDate = startDate;
  event.recurrence = recurrence;
  return { event };
}

/** Parse the text of an .ics file into events (no schedule needed); used by icsToSchedule. */
export function parseIcs(text: string, zone: string | undefined): { events: ScheduleEvent[]; skipped: IcsSkipped[]; warnings: string[] } {
  const events: ScheduleEvent[] = [];
  const skipped: IcsSkipped[] = [];
  const warnings: string[] = [];
  const { events: raw, calendar } = readEvents(unfold(typeof text === 'string' ? text : ''));
  if (!calendar) return { events, skipped, warnings: ['This is not a calendar file (it has no BEGIN:VCALENDAR).'] };
  const conv = new Converter(zone);
  const seen = new Set<string>();
  for (const props of raw) {
    const built = buildEvent(props, conv, warnings);
    if (built.skipped) skipped.push(built.skipped);
    if (!built.event) continue;
    if (seen.has(built.event.id)) {
      skipped.push({ title: built.event.title, reason: 'another event in the file has the same UID' });
      continue;
    }
    seen.add(built.event.id);
    events.push(built.event);
  }
  if (!raw.length) warnings.push('The calendar file has no events.');
  return { events, skipped, warnings: [...conv.warnings, ...warnings] };
}

/** Event fields the calendar owns; the rest (notes, category, class, overrides) stays as the schedule has it. */
const OWNED: Array<keyof ScheduleEvent> = ['date', 'endDate', 'recurrence', 'allDay', 'startTime', 'endTime', 'busy'];

/**
 * The current schedule with the events of an .ics file added or updated
 * (matched by their UID-derived ID), ready for validateDocument and then
 * planImport, like mergeBatch. Never throws: unreadable input gives no events
 * and a warning.
 */
export function icsToSchedule(current: ScheduleDocument, text: string, importedAt: LocalDateTimeStr): IcsImportResult {
  const zone = current.meta?.timezone && isKnownTimeZone(current.meta.timezone) ? current.meta.timezone : runtimeZone();
  const parsed = parseIcs(text, zone);
  const doc = structuredClone(current);
  const index = new Map(doc.events.map((e, i) => [e.id, i]));
  // Items the person deleted are not brought back (a generator never re-creates them, § 15).
  const deleted = new Set((doc.deleted ?? []).map((t) => t.id));

  for (const event of parsed.events) {
    if (deleted.has(event.id)) continue;
    const i = index.get(event.id);
    const cur = i === undefined ? undefined : doc.events[i];
    if (!cur) {
      if (event.source) event.source.retrievedAt = importedAt;
      index.set(event.id, doc.events.length);
      doc.events.push(event);
      continue;
    }
    const next: ScheduleEvent = { ...cur };
    for (const key of OWNED) delete next[key];
    Object.assign(next, event, { origin: cur.origin ?? event.origin });
    // A value the file does not give never clears one the schedule already has; keep a source that already names this event.
    if (!event.location && cur.location) next.location = cur.location;
    const src: Source | undefined = cur.source;
    next.source = src && src.kind === 'calendar' && src.id === event.source?.id ? src : event.source && { ...event.source, retrievedAt: importedAt };
    if (!next.source) delete next.source;
    doc.events[i!] = next;
  }

  // "Now" for the preview is when the file was read; keep the person's title and sources.
  doc.meta = { ...(doc.meta ?? {}), generatedAt: importedAt, ...(zone ? { timezone: zone } : {}), generator: { name: ICS_FILE_NAME } };
  delete doc.meta.exportId;
  delete doc.meta.basedOn;
  delete doc.meta.requestedChanges;
  doc.schemaVersion = schemaVersionFor(doc);
  return { doc, events: parsed.events, skipped: parsed.skipped, warnings: parsed.warnings };
}
