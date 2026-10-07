// Everything that appears on one calendar day, computed deterministically from
// the document: event occurrences, free study time, scheduled work, due dates
// and assessments. Used by the day and week views (and by the planner, for
// free time).
//
// Times inside a day are minutes since midnight (0–1440); an `endTime` of
// "24:00" and a block ending at 00:00 of the next date both end at 1440.
// Nothing here throws on odd data: items whose dates or times cannot be read
// are left out of the day.
import { ASSIGNMENT_TYPE_LABELS, CLASS_PALETTE, NO_CLASS_COLOR, resolveSettings } from '../model/constants';
import type {
  Assignment,
  AvailabilityWindow,
  CollectionName,
  DateOrDateTimeStr,
  DateStr,
  Id,
  Issue,
  ResolvedSettings,
  ScheduleBlock,
  ScheduleDocument,
  ScheduleEvent,
  SchoolClass,
  Task,
  TimeStr,
} from '../model/types';
import { occursOn } from './recurrence';
import {
  MINUTES_PER_DAY,
  addDays,
  dateOf,
  dayNumber,
  dueMoment,
  formatDateWithWeekday,
  formatTime12,
  isValidDate,
  isValidDateOrDateTime,
  isValidEndTime,
  isValidLocalDateTime,
  isValidTime,
  ldtToMinutes,
  startOfDayMoment,
  timeOf,
  timeToMinutes,
} from './time';

/** A span of minutes since midnight, [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface EventOccurrence {
  event: ScheduleEvent;
  date: DateStr;
  /** null for all-day events. */
  start: number | null;
  end: number | null;
  busy: boolean;
  allDay: boolean;
  /** The event's class (event.classId), when it exists. */
  schoolClass?: SchoolClass;
  /** The assessment this event is the sitting of (event.assignmentId, § 10). */
  assignment?: Assignment;
  /** Multi-day all-day events: the first and last day of the whole span. */
  span?: { first: DateStr; last: DateStr };
}

export interface ConflictRef {
  kind: 'event' | 'block';
  id: Id;
  title: string;
}

export interface BlockView {
  block: ScheduleBlock;
  assignment?: Assignment;
  task?: Task;
  schoolClass?: SchoolClass;
  /**
   * Most specific display title: the block's own `title` (an explicit label),
   * else the task title, else the assignment title; "Break" for an untitled
   * break.
   */
  title: string;
  /** Class name, "Break", or "Personal" (no class). */
  subtitle: string;
  /** The class part of "Class / Title" (class name), or null. */
  className: string | null;
  /** The title part of "Class / Title": block `title`, else assignment title. */
  workTitle: string;
  /** "Class / Title", e.g. "English 10 / Othello Essay"; just the title without a class; "Break". */
  label: string;
  /** Title of the block's task, when it has one. */
  taskTitle: string | null;
  color: string;
  /** Minutes since midnight of the block's start date (end may be 1440). */
  start: number;
  end: number;
  minutes: number;
  isBreak: boolean;
  /** Overlaps a busy event or another (not skipped) block. Skipped blocks never conflict. */
  conflict: boolean;
  conflictsWith: ConflictRef[];
  /**
   * Ends after the assignment's due moment or the task's due (date-only →
   * settings.defaultDueTime), or a preparation block ends after the
   * assessment (date-only → 00:00 of that day) — § 13.4. Never for skipped
   * blocks or breaks.
   */
  late: boolean;
  /** Why it is late, e.g. "Ends after the due time (Fri, Oct 16, 11:59 PM)". */
  lateReason: string | null;
}

export interface DateMarker {
  assignment: Assignment;
  /** Set for a task's checkpoint deadline (kind "due"). */
  task?: Task;
  schoolClass?: SchoolClass;
  kind: 'due' | 'assessment' | 'recommended';
  /** Time of day if known, else null (date-only value). */
  time: TimeStr | null;
  color: string;
  /** Short label: "Due 11:59 PM", "Due", "Checkpoint due", "Test 9:10 AM", "Exam", "Aim to finish". */
  label: string;
  /** The assignment (or task) is done or cancelled. */
  done: boolean;
  /**
   * Assessment markers: the linked sitting event occurring this day (§ 10,
   * event.assignmentId), so a view can avoid showing the assessment twice.
   */
  sitting: EventOccurrence | null;
}

/** An issue shown on a day (its `date` is that day). */
export interface DayIssue {
  issue: Issue;
  /** Where the issue lives, as the reducer's setIssueStatus expects (null = root). */
  scope: { collection: CollectionName; id: Id } | null;
  /** Index in that holder's `issues` array. */
  index: number;
  /** The item the issue is about: root `itemId`, or the holder item. */
  itemId?: Id;
}

export interface DayModel {
  date: DateStr;
  /** Timed event occurrences, sorted by start. */
  events: EventOccurrence[];
  allDayEvents: EventOccurrence[];
  /**
   * False when the document has no availability at all (§ 11 "Empty
   * availability"): then availability/free are empty, freeMinutes is 0, no
   * overload is reported and the UI should prompt to add study time.
   */
  availabilityDefined: boolean;
  /** Availability windows that apply this day (merged), before subtracting busy time. */
  availability: Interval[];
  /** Availability minus busy events: when study can happen. */
  free: Interval[];
  freeMinutes: number;
  /** Blocks starting on this date, sorted by start. */
  blocks: BlockView[];
  /** Minutes of planned + done work blocks this day. */
  plannedMinutes: number;
  /** Minutes of done work blocks this day. */
  doneMinutes: number;
  /** plannedMinutes > freeMinutes (only when availability is defined). */
  overFreeTime: boolean;
  /**
   * plannedMinutes > settings.maxDailyStudyMinutes and the day has an
   * unlocked generated/planner work block (§ 13.4; never for user or locked
   * blocks alone; only when availability is defined).
   */
  overDailyMax: boolean;
  markers: DateMarker[];
  windows: AvailabilityWindow[];
  /** Root and item issues whose `date` is this day (open ones first). */
  issues: DayIssue[];
  /**
   * Suggested timeline range: settings.dayStartTime–dayEndTime widened to
   * whole hours that fit every timed item of the day.
   */
  timelineRange: Interval;
}

// ---------------------------------------------------------------------------
// Interval arithmetic
// ---------------------------------------------------------------------------

/** Merge overlapping (or touching) intervals; result sorted and non-overlapping. Empty intervals are dropped. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** `from` minus every interval in `remove` (result merged and sorted). */
export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  const base = mergeIntervals(from);
  const cut = mergeIntervals(remove);
  const out: Interval[] = [];
  for (const interval of base) {
    let cursor = interval.start;
    for (const r of cut) {
      if (r.end <= cursor) continue;
      if (r.start >= interval.end) break;
      if (r.start > cursor) out.push({ start: cursor, end: r.start });
      cursor = Math.max(cursor, r.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) out.push({ start: cursor, end: interval.end });
  }
  return out;
}

/** Parts covered by both `a` and `b`. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const x = mergeIntervals(a);
  const y = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const start = Math.max(x[i].start, y[j].start);
    const end = Math.min(x[i].end, y[j].end);
    if (end > start) out.push({ start, end });
    if (x[i].end < y[j].end) i++;
    else j++;
  }
  return out;
}

/** Total minutes covered by the intervals (overlaps counted once). */
export function totalMinutes(intervals: Interval[]): number {
  return mergeIntervals(intervals).reduce((sum, i) => sum + (i.end - i.start), 0);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface LaidOut<T> {
  item: T;
  /** 0-based column within its overlap group. */
  column: number;
  /** Number of columns in its overlap group. */
  columns: number;
}

/**
 * Side-by-side layout for overlapping timed items (classic calendar columns).
 * Items are grouped into clusters of (transitively) overlapping items; each
 * item takes the leftmost column that is free at its start. Returned in
 * display order: by start, longer first, then input order. Items with
 * end ≤ start are treated as 1 minute long.
 */
export function layoutColumns<T>(items: T[], range: (item: T) => Interval): LaidOut<T>[] {
  const entries = items
    .map((item, index) => {
      const r = range(item);
      return { item, index, start: r.start, end: Math.max(r.end, r.start + 1) };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);
  const out: LaidOut<T>[] = [];
  let group: Array<{ item: T; column: number }> = [];
  let columnEnds: number[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    for (const g of group) out.push({ item: g.item, column: g.column, columns: columnEnds.length });
    group = [];
    columnEnds = [];
  };
  for (const e of entries) {
    if (group.length > 0 && e.start >= groupEnd) flush();
    let column = columnEnds.findIndex((end) => end <= e.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(e.end);
    } else {
      columnEnds[column] = e.end;
    }
    group.push({ item: e.item, column });
    groupEnd = group.length === 1 ? e.end : Math.max(groupEnd, e.end);
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
// Cached per classes array (the store never mutates arrays in place).
const colorCache = new WeakMap<SchoolClass[], Map<Id, string>>();

/**
 * Color of every class: its own `color`, or a palette color assigned in class
 * order (skipping palette colors that other classes already use explicitly).
 * Stable as long as the classes do not change.
 */
export function classColorMap(doc: ScheduleDocument): Map<Id, string> {
  const cached = colorCache.get(doc.classes);
  if (cached) return cached;
  const used = new Set(doc.classes.filter((c) => c.color && HEX_COLOR.test(c.color)).map((c) => c.color!.toUpperCase()));
  let pool = CLASS_PALETTE.filter((c) => !used.has(c.toUpperCase()));
  if (pool.length === 0) pool = CLASS_PALETTE;
  const map = new Map<Id, string>();
  let k = 0;
  for (const c of doc.classes) {
    if (c.color && HEX_COLOR.test(c.color)) map.set(c.id, c.color);
    else map.set(c.id, pool[k++ % pool.length]);
  }
  colorCache.set(doc.classes, map);
  return map;
}

/** Color for a class id (its color, or a stable palette color, or neutral when absent). */
export function classColor(doc: ScheduleDocument, classId: string | undefined): string {
  if (!classId) return NO_CLASS_COLOR;
  return classColorMap(doc).get(classId) ?? NO_CLASS_COLOR;
}

// ---------------------------------------------------------------------------
// Events and availability on a date
// ---------------------------------------------------------------------------

/** True if the event (one-time, multi-day all-day, or recurring) occurs on `date`. */
export function eventOccursOn(event: ScheduleEvent, date: DateStr): boolean {
  if (event.recurrence) return occursOn(event.recurrence, date);
  if (!event.date || !isValidDate(event.date)) return false;
  if (event.allDay && event.endDate && isValidDate(event.endDate)) return event.date <= date && date <= event.endDate;
  return event.date === date;
}

/** True if the availability window applies on `date`. */
export function windowAppliesOn(window: AvailabilityWindow, date: DateStr): boolean {
  if (window.recurrence) return occursOn(window.recurrence, date);
  return window.date === date;
}

/** [start, end] minutes of a start/end time pair, or null when unreadable or empty. */
function timeSpan(startTime: string | undefined, endTime: string | undefined): Interval | null {
  if (!isValidTime(startTime) || !isValidEndTime(endTime)) return null;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end > start ? { start, end } : null;
}

function occurrenceOf(event: ScheduleEvent, date: DateStr, index: Index): EventOccurrence | null {
  if (!eventOccursOn(event, date)) return null;
  const busy = event.busy !== false;
  const schoolClass = event.classId ? index.classes.get(event.classId) : undefined;
  const assignment = event.assignmentId ? index.assignments.get(event.assignmentId) : undefined;
  if (event.allDay) {
    const occ: EventOccurrence = { event, date, start: null, end: null, busy, allDay: true, schoolClass, assignment };
    if (!event.recurrence && event.date && event.endDate && isValidDate(event.endDate) && event.endDate > event.date) {
      occ.span = { first: event.date, last: event.endDate };
    }
    return occ;
  }
  const span = timeSpan(event.startTime, event.endTime);
  if (!span) return null;
  return { event, date, start: span.start, end: span.end, busy, allDay: false, schoolClass, assignment };
}

export interface FreeTime {
  /** Windows that apply this day. */
  windows: AvailabilityWindow[];
  /** Merged availability before subtracting busy events. */
  availability: Interval[];
  /** Busy time: busy timed events, or the whole day for a busy all-day event. */
  busy: Interval[];
  /** availability − busy. */
  free: Interval[];
}

/**
 * Free study time on `date` (§ 11): union of the day's availability windows
 * minus all busy events of the day. With an empty `availability` array
 * everything is empty (availability not provided).
 */
export function freeTimeOn(doc: ScheduleDocument, date: DateStr): FreeTime {
  return computeFreeTime(doc, date, eventsOn(doc, date, buildIndex(doc, false)));
}

/** freeTimeOn for every date from `from` to `to` (inclusive), computed in one pass over the lookups. */
export function freeTimeByDate(doc: ScheduleDocument, from: DateStr, to: DateStr): Map<DateStr, FreeTime> {
  const out = new Map<DateStr, FreeTime>();
  if (!isValidDate(from) || !isValidDate(to)) return out;
  const index = buildIndex(doc, false);
  for (let date = from; date <= to; date = addDays(date, 1)) out.set(date, computeFreeTime(doc, date, eventsOn(doc, date, index)));
  return out;
}

function eventsOn(doc: ScheduleDocument, date: DateStr, index: Index): EventOccurrence[] {
  const out: EventOccurrence[] = [];
  for (const event of doc.events) {
    const occ = occurrenceOf(event, date, index);
    if (occ) out.push(occ);
  }
  return out;
}

function busyIntervals(occurrences: EventOccurrence[]): Interval[] {
  const busy: Interval[] = [];
  for (const o of occurrences) {
    if (!o.busy) continue;
    if (o.allDay) busy.push({ start: 0, end: MINUTES_PER_DAY });
    else if (o.start !== null && o.end !== null) busy.push({ start: o.start, end: o.end });
  }
  return mergeIntervals(busy);
}

function computeFreeTime(doc: ScheduleDocument, date: DateStr, occurrences: EventOccurrence[]): FreeTime {
  const busy = busyIntervals(occurrences);
  const windows: AvailabilityWindow[] = [];
  const spans: Interval[] = [];
  for (const w of doc.availability) {
    if (!windowAppliesOn(w, date)) continue;
    const span = timeSpan(w.startTime, w.endTime);
    if (!span) continue;
    windows.push(w);
    spans.push(span);
  }
  const availability = mergeIntervals(spans);
  return { windows, availability, busy, free: subtractIntervals(availability, busy) };
}

// ---------------------------------------------------------------------------
// Day model
// ---------------------------------------------------------------------------

interface Index {
  settings: ResolvedSettings;
  assignments: Map<Id, Assignment>;
  classes: Map<Id, SchoolClass>;
  blocksByDate: Map<DateStr, ScheduleBlock[]>;
}

function buildIndex(doc: ScheduleDocument, withBlocks = true): Index {
  const assignments = new Map(doc.assignments.map((a) => [a.id, a] as const));
  const classes = new Map(doc.classes.map((c) => [c.id, c] as const));
  const blocksByDate = new Map<DateStr, ScheduleBlock[]>();
  for (const b of withBlocks ? doc.scheduleBlocks : []) {
    if (!isValidLocalDateTime(b.start) || !isValidLocalDateTime(b.end)) continue;
    const date = b.start.slice(0, 10);
    const list = blocksByDate.get(date);
    if (list) list.push(b);
    else blocksByDate.set(date, [b]);
  }
  return { settings: resolveSettings(doc.settings), assignments, classes, blocksByDate };
}

/** "Fri, Oct 16, 11:59 PM" or "Fri, Oct 16". */
function describeMoment(value: DateOrDateTimeStr): string {
  const time = timeOf(value);
  const day = formatDateWithWeekday(dateOf(value));
  return time ? `${day}, ${formatTime12(time)}` : day;
}

function assessmentWord(a: Assignment): string {
  const type = a.type;
  if (type === 'quiz' || type === 'test' || type === 'exam' || type === 'presentation') return ASSIGNMENT_TYPE_LABELS[type].toLowerCase();
  return 'assessment';
}

function lateReasonFor(endAbs: number, a: Assignment, task: Task | undefined, settings: ResolvedSettings): string | null {
  const dueTime = settings.defaultDueTime;
  const checks: Array<{ value: DateOrDateTimeStr | undefined; what: string }> = [
    { value: a.due, what: 'due' },
    { value: task?.due, what: 'task' },
  ];
  for (const { value, what } of checks) {
    if (!value || !isValidDateOrDateTime(value)) continue;
    let moment: number;
    try {
      moment = ldtToMinutes(dueMoment(value, isValidTime(dueTime) ? dueTime : '00:00'));
    } catch {
      continue;
    }
    if (endAbs <= moment) continue;
    const dateOnly = timeOf(value) === null;
    const note = dateOnly ? ` — no time given, so it counts as due at ${formatTime12(isValidTime(dueTime) ? dueTime : '00:00')}` : '';
    if (what === 'due') return `Ends after the due ${dateOnly ? 'date' : 'time'} (${describeMoment(value)}${note})`;
    return `Ends after the deadline of “${task!.title}” (${describeMoment(value)}${note})`;
  }
  if (a.assessmentDate && isValidDateOrDateTime(a.assessmentDate)) {
    const moment = ldtToMinutes(startOfDayMoment(a.assessmentDate));
    if (endAbs > moment) return `Ends after the ${assessmentWord(a)} (${describeMoment(a.assessmentDate)})`;
  }
  return null;
}

function blockViews(doc: ScheduleDocument, date: DateStr, index: Index, occurrences: EventOccurrence[]): BlockView[] {
  const base = dayNumber(date) * MINUTES_PER_DAY;
  const colors = classColorMap(doc);
  const views: BlockView[] = [];
  for (const block of index.blocksByDate.get(date) || []) {
    const startAbs = ldtToMinutes(block.start);
    const endAbs = ldtToMinutes(block.end);
    const start = startAbs - base;
    const end = Math.min(MINUTES_PER_DAY, Math.max(endAbs - base, start));
    const isBreak = block.kind === 'break';
    const assignment = !isBreak && block.assignmentId ? index.assignments.get(block.assignmentId) : undefined;
    const task = assignment && block.taskId ? (assignment.tasks || []).find((t) => t.id === block.taskId) : undefined;
    const schoolClass = assignment?.classId ? index.classes.get(assignment.classId) : undefined;
    const ownTitle = block.title?.trim() || '';
    const title = isBreak ? ownTitle || 'Break' : ownTitle || task?.title || assignment?.title || 'Untitled block';
    const workTitle = isBreak ? ownTitle || 'Break' : ownTitle || assignment?.title || task?.title || 'Untitled block';
    const className = schoolClass ? schoolClass.name : null;
    const status = block.status ?? 'planned';
    const lateReason =
      !isBreak && assignment && status !== 'skipped' ? lateReasonFor(endAbs, assignment, task, index.settings) : null;
    views.push({
      block,
      assignment,
      task,
      schoolClass,
      title,
      subtitle: isBreak ? 'Break' : className ?? 'Personal',
      className,
      workTitle,
      label: className && !isBreak ? `${className} / ${workTitle}` : workTitle,
      taskTitle: task ? task.title : null,
      color: isBreak ? NO_CLASS_COLOR : schoolClass ? colors.get(schoolClass.id) ?? NO_CLASS_COLOR : NO_CLASS_COLOR,
      start,
      end,
      minutes: Math.max(0, endAbs - startAbs),
      isBreak,
      conflict: false,
      conflictsWith: [],
      late: lateReason !== null,
      lateReason,
    });
  }
  views.sort((a, b) => a.start - b.start || a.end - b.end || compareText(a.block.id, b.block.id));

  // Conflicts: overlap with busy events (an all-day busy event covers the
  // whole day) or with another block. Skipped blocks did not happen.
  const busyEvents = occurrences.filter((o) => o.busy);
  for (const v of views) {
    if ((v.block.status ?? 'planned') === 'skipped') continue;
    const span = { start: v.start, end: Math.max(v.end, v.start + 1) };
    for (const o of busyEvents) {
      const eventSpan = o.allDay ? { start: 0, end: MINUTES_PER_DAY } : { start: o.start ?? 0, end: o.end ?? 0 };
      if (overlaps(span, eventSpan)) v.conflictsWith.push({ kind: 'event', id: o.event.id, title: o.event.title });
    }
    for (const other of views) {
      if (other === v || (other.block.status ?? 'planned') === 'skipped') continue;
      if (overlaps(span, { start: other.start, end: Math.max(other.end, other.start + 1) })) {
        v.conflictsWith.push({ kind: 'block', id: other.block.id, title: other.label });
      }
    }
    v.conflict = v.conflictsWith.length > 0;
  }
  return views;
}

const MARKER_ORDER: Record<DateMarker['kind'], number> = { assessment: 0, due: 1, recommended: 2 };

function markersOn(doc: ScheduleDocument, date: DateStr, index: Index, occurrences: EventOccurrence[]): DateMarker[] {
  const colors = classColorMap(doc);
  const markers: DateMarker[] = [];
  const onDate = (value: DateOrDateTimeStr | undefined): value is DateOrDateTimeStr =>
    !!value && isValidDateOrDateTime(value) && dateOf(value) === date;
  for (const a of doc.assignments) {
    const schoolClass = a.classId ? index.classes.get(a.classId) : undefined;
    const color = schoolClass ? colors.get(schoolClass.id) ?? NO_CLASS_COLOR : NO_CLASS_COLOR;
    const done = a.status === 'done' || a.status === 'cancelled';
    if (onDate(a.due)) {
      const time = timeOf(a.due);
      markers.push({ assignment: a, schoolClass, kind: 'due', time, color, label: time ? `Due ${formatTime12(time)}` : 'Due', done, sitting: null });
    }
    if (onDate(a.assessmentDate)) {
      const time = timeOf(a.assessmentDate);
      const word = a.type && ['quiz', 'test', 'exam', 'presentation'].includes(a.type) ? ASSIGNMENT_TYPE_LABELS[a.type] : 'Assessment';
      const sitting = occurrences.find((o) => o.event.assignmentId === a.id) ?? null;
      markers.push({
        assignment: a,
        schoolClass,
        kind: 'assessment',
        time,
        color,
        label: time ? `${word} ${formatTime12(time)}` : word,
        done,
        sitting,
      });
    }
    if (onDate(a.recommendedCompletionDate)) {
      const time = timeOf(a.recommendedCompletionDate);
      markers.push({
        assignment: a,
        schoolClass,
        kind: 'recommended',
        time,
        color,
        label: time ? `Aim to finish by ${formatTime12(time)}` : 'Aim to finish',
        done,
        sitting: null,
      });
    }
    for (const task of a.tasks || []) {
      if (task.status === 'cancelled' || !onDate(task.due)) continue;
      const time = timeOf(task.due);
      markers.push({
        assignment: a,
        task,
        schoolClass,
        kind: 'due',
        time,
        color,
        label: time ? `Checkpoint due ${formatTime12(time)}` : 'Checkpoint due',
        done: done || task.status === 'done',
        sitting: null,
      });
    }
  }
  const timeKey = (m: DateMarker) => (m.time === null ? -1 : timeToMinutes(m.time));
  return markers.sort(
    (x, y) =>
      MARKER_ORDER[x.kind] - MARKER_ORDER[y.kind] ||
      timeKey(x) - timeKey(y) ||
      Number(!!x.task) - Number(!!y.task) ||
      compareText(x.assignment.title, y.assignment.title) ||
      compareText(x.assignment.id, y.assignment.id) ||
      compareText(x.task?.id ?? '', y.task?.id ?? ''),
  );
}

const ISSUE_COLLECTIONS: CollectionName[] = ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'];

function issuesOn(doc: ScheduleDocument, date: DateStr): DayIssue[] {
  const out: DayIssue[] = [];
  (doc.issues || []).forEach((issue, i) => {
    if (issue.date === date) out.push({ issue, scope: null, index: i, itemId: issue.itemId });
  });
  for (const collection of ISSUE_COLLECTIONS) {
    for (const item of doc[collection] as Array<{ id: Id; issues?: Issue[] }>) {
      (item.issues || []).forEach((issue, i) => {
        if (issue.date === date) out.push({ issue, scope: { collection, id: item.id }, index: i, itemId: item.id });
      });
    }
  }
  const isOpen = (d: DayIssue) => (d.issue.status ?? 'open') === 'open';
  // Stable: open issues first, otherwise document order.
  return out.map((d, i) => ({ d, i })).sort((x, y) => Number(isOpen(y.d)) - Number(isOpen(x.d)) || x.i - y.i).map((x) => x.d);
}

function timelineRangeOf(settings: ResolvedSettings, timed: Interval[]): Interval {
  let lo = isValidTime(settings.dayStartTime) ? timeToMinutes(settings.dayStartTime) : 7 * 60;
  let hi = isValidEndTime(settings.dayEndTime) ? timeToMinutes(settings.dayEndTime) : 22 * 60;
  if (hi <= lo) {
    lo = 7 * 60;
    hi = 22 * 60;
  }
  for (const t of timed) {
    lo = Math.min(lo, t.start);
    hi = Math.max(hi, t.end);
  }
  return { start: Math.max(0, Math.floor(lo / 60) * 60), end: Math.min(MINUTES_PER_DAY, Math.ceil(hi / 60) * 60) };
}

function dayModel(doc: ScheduleDocument, date: DateStr, index: Index): DayModel {
  const occurrences = eventsOn(doc, date, index);
  const events = occurrences
    .filter((o) => !o.allDay)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0) || (a.end ?? 0) - (b.end ?? 0) || compareText(a.event.title, b.event.title) || compareText(a.event.id, b.event.id));
  const allDayEvents = occurrences.filter((o) => o.allDay);
  const availabilityDefined = doc.availability.length > 0;
  const time = computeFreeTime(doc, date, occurrences);
  const availability = availabilityDefined ? time.availability : [];
  const free = availabilityDefined ? time.free : [];
  const freeMinutes = totalMinutes(free);
  const blocks = blockViews(doc, date, index, occurrences);
  const work = blocks.filter((b) => !b.isBreak && (b.block.status ?? 'planned') !== 'skipped');
  const plannedMinutes = work.reduce((sum, b) => sum + b.minutes, 0);
  const doneMinutes = work.filter((b) => b.block.status === 'done').reduce((sum, b) => sum + b.minutes, 0);
  const maxDaily = index.settings.maxDailyStudyMinutes;
  const hasPlannerWork = work.some((b) => (b.block.origin ?? 'generated') !== 'user' && !b.block.locked);
  const timed: Interval[] = [
    ...events.map((e) => ({ start: e.start ?? 0, end: e.end ?? 0 })),
    ...blocks.map((b) => ({ start: b.start, end: b.end })),
    ...availability,
  ];
  return {
    date,
    events,
    allDayEvents,
    availabilityDefined,
    availability,
    free,
    freeMinutes,
    blocks,
    plannedMinutes,
    doneMinutes,
    overFreeTime: availabilityDefined && plannedMinutes > freeMinutes,
    overDailyMax: availabilityDefined && maxDaily !== null && plannedMinutes > maxDaily && hasPlannerWork,
    markers: markersOn(doc, date, index, occurrences),
    windows: availabilityDefined ? time.windows : [],
    issues: issuesOn(doc, date),
    timelineRange: timelineRangeOf(index.settings, timed),
  };
}

/** Model of one day. */
export function buildDay(doc: ScheduleDocument, date: DateStr): DayModel {
  return dayModel(doc, date, buildIndex(doc));
}

/** Models of consecutive days starting at `start`. */
export function buildDays(doc: ScheduleDocument, start: DateStr, count: number): DayModel[] {
  if (!isValidDate(start)) return [];
  const index = buildIndex(doc);
  const out: DayModel[] = [];
  for (let i = 0; i < count; i++) out.push(dayModel(doc, addDays(start, i), index));
  return out;
}
