// Pure helpers behind the day and week views: drag/resize arithmetic with
// 5-minute snapping, keyboard nudges, the agenda (list) rendering of a day,
// and the plain-language text used for labels and screen readers.
//
// Times inside a day are minutes since midnight (0–1440), as in
// src/lib/calendar.ts. Nothing here reads the clock or the DOM.
import { BLOCK_STATUS_LABELS, EVENT_CATEGORY_LABELS } from '../../model/constants';
import type { DateStr, Id, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../../model/types';
import { subtractIntervals, type BlockView, type DayModel, type EventOccurrence, type Interval } from '../../lib/calendar';
import {
  MINUTES_PER_DAY,
  addDays,
  dayNumber,
  daysBetween,
  formatDuration,
  isValidDate,
  isValidLocalDateTime,
  ldtToMinutes,
  minutesToTime,
  toLocalDateTime,
} from '../../lib/time';

/** Drag and resize snap to this many minutes. */
export const SNAP_MINUTES = 5;
/** Keyboard "earlier/later/shorter/longer" step. */
export const NUDGE_MINUTES = 15;
/** Shortest block (§ 13.3 rule 19). */
export const MIN_BLOCK_MINUTES = 5;
/** Length of a block created by a single click on empty time. */
export const DEFAULT_NEW_BLOCK_MINUTES = 60;
/** Mouse/pen movement (px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;
/** Touch movement (px) that turns a press into a scroll instead. */
export const TOUCH_SLOP_PX = 8;
/** Touch press duration that starts dragging a block. */
export const LONG_PRESS_MS = 400;

export interface Span {
  start: number;
  end: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Round to the nearest multiple of `step` minutes. */
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/** Move a span so that it starts at (snapped) `newStart`, keeping its length and staying inside the day. */
export function moveSpan(span: Span, newStart: number): Span {
  const length = clamp(span.end - span.start, MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  const start = clamp(snapMinutes(newStart), 0, MINUTES_PER_DAY - length);
  return { start, end: start + length };
}

/** Move a span to start exactly at `start` (no snapping), keeping its length inside the day. */
export function placeSpan(span: Span, start: number): Span {
  const length = clamp(span.end - span.start, MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  const s = clamp(Math.round(start), 0, MINUTES_PER_DAY - length);
  return { start: s, end: s + length };
}

/** Change the end of a span to (snapped) `newEnd`; at least MIN_BLOCK_MINUTES long, at most midnight. */
export function resizeSpan(span: Span, newEnd: number): Span {
  const end = clamp(snapMinutes(newEnd), span.start + MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  return { start: span.start, end };
}

/** The span selected by dragging over empty time from `anchor` to `current` (either direction). */
export function createSpan(anchor: number, current: number): Span {
  const start = clamp(snapMinutes(Math.min(anchor, current)), 0, MINUTES_PER_DAY - MIN_BLOCK_MINUTES);
  const end = clamp(snapMinutes(Math.max(anchor, current)), start + MIN_BLOCK_MINUTES, MINUTES_PER_DAY);
  return { start, end };
}

/** The span of a block created by clicking empty time at `minute`: starts at the quarter hour. */
export function clickSpan(minute: number, length = DEFAULT_NEW_BLOCK_MINUTES): Span {
  const start = clamp(Math.floor(minute / 15) * 15, 0, MINUTES_PER_DAY - 15);
  return { start, end: Math.min(MINUTES_PER_DAY, start + Math.max(MIN_BLOCK_MINUTES, length)) };
}

/** Block start/end for a span on `date`; an end at 1440 is written as 00:00 of the next date (§ 12). */
export function spanToLdt(date: DateStr, span: Span): { start: LocalDateTimeStr; end: LocalDateTimeStr } {
  const start = toLocalDateTime(date, minutesToTime(span.start));
  const end = span.end >= MINUTES_PER_DAY ? toLocalDateTime(addDays(date, 1), '00:00') : toLocalDateTime(date, minutesToTime(span.end));
  return { start, end };
}

/** The date and in-day span of a block, or null when its times cannot be read or it has no length. */
export function blockSpan(block: ScheduleBlock): { date: DateStr; span: Span } | null {
  if (!isValidLocalDateTime(block.start) || !isValidLocalDateTime(block.end)) return null;
  const date = block.start.slice(0, 10);
  const base = dayNumber(date) * MINUTES_PER_DAY;
  const start = ldtToMinutes(block.start) - base;
  const end = Math.min(MINUTES_PER_DAY, ldtToMinutes(block.end) - base);
  if (end <= start) return null;
  return { date, span: { start, end } };
}

export interface BlockChange {
  /** Shift by this many minutes (snapped, kept inside the day). */
  minutes?: number;
  /** Shift by this many days (time unchanged). */
  days?: number;
  /** Change the length by this many minutes (snapped, ≥ 5 minutes, ends by midnight). */
  resize?: number;
  /** Move to this date (time unchanged). */
  date?: DateStr;
  /** Start exactly at this minute of the day (length unchanged). */
  startAt?: number;
}

/**
 * New start/end for a keyboard or dialog move of `block`, or null when the
 * block cannot be read or nothing would change.
 */
export function changeBlock(block: ScheduleBlock, change: BlockChange): { date: DateStr; span: Span; start: LocalDateTimeStr; end: LocalDateTimeStr } | null {
  const current = blockSpan(block);
  if (!current) return null;
  let { date, span } = current;
  if (change.date !== undefined) {
    if (!isValidDate(change.date)) return null;
    date = change.date;
  }
  if (change.days) date = addDays(date, change.days);
  if (change.startAt !== undefined) span = placeSpan(span, change.startAt);
  if (change.minutes) span = moveSpan(span, span.start + change.minutes);
  if (change.resize) span = resizeSpan(span, span.end + change.resize);
  const next = spanToLdt(date, span);
  if (ldtToMinutes(next.start) === ldtToMinutes(block.start) && ldtToMinutes(next.end) === ldtToMinutes(block.end)) return null;
  return { date, span, ...next };
}

// ---------------------------------------------------------------------------
// Time labels
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "4:30 PM"; 1440 (midnight at the end of the day) is "12:00 AM". */
export function formatClock(minutes: number): string {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60) % 24;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(((m % 60) + 60) % 60)} ${suffix}`;
}

/** "4:30 – 5:20 PM", or "11:30 AM – 12:15 PM" when the halves of the day differ. */
export function formatSpan(start: number, end: number): string {
  const a = formatClock(start);
  const b = formatClock(end);
  const sameHalf = start < 720 === end < 720 && end < MINUTES_PER_DAY;
  return sameHalf ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/** "Today", "Tomorrow", "Yesterday", "In 3 days", "3 days ago". */
export function relativeDayLabel(date: DateStr, today: DateStr): string {
  if (!isValidDate(date) || !isValidDate(today)) return '';
  const diff = daysBetween(today, date);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return diff > 1 ? `In ${diff} days` : `${-diff} days ago`;
}

/** Minutes since midnight of `now` on `date`, or null when `now` is on another day. */
export function nowMinutesOn(date: DateStr, now: LocalDateTimeStr): number | null {
  if (!isValidLocalDateTime(now) || now.slice(0, 10) !== date) return null;
  return ldtToMinutes(now) - dayNumber(date) * MINUTES_PER_DAY;
}

// ---------------------------------------------------------------------------
// Blocks and events in words
// ---------------------------------------------------------------------------

export function blockStatus(view: BlockView): 'planned' | 'done' | 'skipped' {
  return view.block.status ?? 'planned';
}

/** Absolute minutes at which the block ends (for past/future checks). */
export function blockEndAbs(date: DateStr, view: BlockView): number {
  return dayNumber(date) * MINUTES_PER_DAY + view.end;
}

/** True when the block ended at or before `now` and is still `planned` (§ 12.1: the person should mark it). */
export function isUnmarkedPast(date: DateStr, view: BlockView, now: LocalDateTimeStr): boolean {
  if (view.isBreak || blockStatus(view) !== 'planned' || !isValidLocalDateTime(now)) return false;
  return blockEndAbs(date, view) <= ldtToMinutes(now);
}

/** Planned work blocks of the day that are already over (§ 12.1). */
export function unmarkedPastBlocks(model: DayModel, now: LocalDateTimeStr): BlockView[] {
  return model.blocks.filter((v) => isUnmarkedPast(model.date, v, now));
}

/** "Overlaps School, Math / Problem set". */
export function conflictText(view: BlockView): string {
  const names = Array.from(new Set(view.conflictsWith.map((c) => c.title)));
  return names.length ? `Overlaps ${names.join(', ')}` : '';
}

/** Who created the block, in words. */
export function originText(block: { origin?: string }): string {
  switch (block.origin ?? 'generated') {
    case 'user':
      return 'Created by you';
    case 'planner':
      return 'Placed by the planner';
    default:
      return 'Imported from /academic-schedule';
  }
}

/** Full description of a block for screen readers and tooltips. */
export function describeBlock(view: BlockView): string {
  const parts = [view.label];
  if (view.taskTitle && view.taskTitle !== view.workTitle) parts.push(`step: ${view.taskTitle}`);
  parts.push(formatSpan(view.start, view.end), formatDuration(view.minutes));
  if (!view.isBreak) parts.push(BLOCK_STATUS_LABELS[blockStatus(view)]);
  if (view.block.locked) parts.push('pinned');
  if (view.conflict) parts.push(conflictText(view));
  if (view.late && view.lateReason) parts.push(`Late: ${view.lateReason}`);
  return parts.join(', ');
}

/** "School" + "busy"/"not busy" + time, for an event occurrence. */
export function describeEvent(occurrence: EventOccurrence): string {
  const e = occurrence.event;
  const parts = [e.title];
  if (e.category) parts.push(EVENT_CATEGORY_LABELS[e.category] ?? e.category);
  if (occurrence.allDay) parts.push('all day');
  else if (occurrence.start !== null && occurrence.end !== null) parts.push(formatSpan(occurrence.start, occurrence.end));
  parts.push(occurrence.busy ? 'busy' : 'not busy');
  if (occurrence.assignment) parts.push(`sitting of ${occurrence.assignment.title}`);
  if (e.location) parts.push(e.location);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Agenda (list) rendering of a day
// ---------------------------------------------------------------------------

/** Shorter free gaps (between back-to-back sessions) are not listed as "Available". */
export const MIN_GAP_MINUTES = 15;

export type AgendaEntry =
  | { kind: 'event'; start: number; end: number; occurrence: EventOccurrence }
  | { kind: 'block'; start: number; end: number; view: BlockView }
  | { kind: 'available'; start: number; end: number };

const ENTRY_ORDER: Record<AgendaEntry['kind'], number> = { event: 0, block: 1, available: 2 };

/**
 * Free study time that no (non-skipped) block uses: the "Available" gaps of
 * the agenda. Empty when availability is not provided (§ 11).
 */
export function availableGaps(model: DayModel): Interval[] {
  if (!model.availabilityDefined) return [];
  const used = model.blocks.filter((v) => blockStatus(v) !== 'skipped').map((v) => ({ start: v.start, end: Math.max(v.end, v.start + 1) }));
  return subtractIntervals(model.free, used).filter((g) => g.end - g.start >= MIN_GAP_MINUTES);
}

/**
 * The day as a chronological list, like the requirements' example:
 * "3:30 Available / 4:00 English / Read Chapter 6 / 4:45 Break / 5:00 Math / …".
 * Timed events, blocks and the free gaps between them, sorted by start.
 */
export function agendaEntries(model: DayModel): AgendaEntry[] {
  const entries: AgendaEntry[] = [
    ...model.events.map((occurrence) => ({ kind: 'event' as const, start: occurrence.start ?? 0, end: occurrence.end ?? 0, occurrence })),
    ...model.blocks.map((view) => ({ kind: 'block' as const, start: view.start, end: view.end, view })),
    ...availableGaps(model).map((gap) => ({ kind: 'available' as const, start: gap.start, end: gap.end })),
  ];
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.start - b.entry.start || ENTRY_ORDER[a.entry.kind] - ENTRY_ORDER[b.entry.kind] || a.entry.end - b.entry.end || a.index - b.index)
    .map((x) => x.entry);
}

/**
 * Free study time of the day that no block uses yet and that is not over:
 * the whole day for a future day, from now on for today, null for a past day
 * (and when availability is not provided).
 */
export function unplannedFreeMinutes(model: DayModel, now: LocalDateTimeStr): number | null {
  if (!model.availabilityDefined) return null;
  const today = isValidLocalDateTime(now) ? now.slice(0, 10) : null;
  if (today && model.date < today) return null;
  const nowMinute = nowMinutesOn(model.date, now);
  const gaps = availableGaps(model);
  const from = nowMinute ?? 0;
  return gaps.reduce((sum, g) => sum + Math.max(0, g.end - Math.max(g.start, from)), 0);
}

/** Plain-text agenda lines ("3:30 PM  Available until 4:00 PM"), used by tests and as a print fallback. */
export function agendaText(model: DayModel): string[] {
  return agendaEntries(model).map((entry) => {
    const time = formatClock(entry.start);
    if (entry.kind === 'available') return `${time} Available until ${formatClock(entry.end)}`;
    if (entry.kind === 'event') return `${time} ${entry.occurrence.event.title}`;
    return `${time} ${entry.view.label}`;
  });
}

// ---------------------------------------------------------------------------
// Day load in words
// ---------------------------------------------------------------------------

export interface DayLoad {
  planned: number;
  free: number;
  done: number;
  /** Minutes planned beyond the free time (0 when not over or availability unknown). */
  overFreeBy: number;
  /** Minutes planned beyond settings.maxDailyStudyMinutes (only when the model reports it). */
  overMaxBy: number;
  overloaded: boolean;
}

export function dayLoad(model: DayModel, maxDaily: number | null): DayLoad {
  const overFreeBy = model.overFreeTime ? model.plannedMinutes - model.freeMinutes : 0;
  const overMaxBy = model.overDailyMax && maxDaily !== null ? model.plannedMinutes - maxDaily : 0;
  return {
    planned: model.plannedMinutes,
    free: model.freeMinutes,
    done: model.doneMinutes,
    overFreeBy,
    overMaxBy,
    overloaded: model.overFreeTime || model.overDailyMax,
  };
}

// ---------------------------------------------------------------------------
// Items referenced by issues
// ---------------------------------------------------------------------------

export type ItemRef =
  | { kind: 'class' | 'assignment' | 'event' | 'availability' | 'block'; id: Id; title: string }
  | { kind: 'task'; id: Id; assignmentId: Id; title: string };

/** Find any item (tasks included) by id, with a display title. */
export function findItem(doc: ScheduleDocument, id: Id | undefined): ItemRef | null {
  if (!id) return null;
  const cls = doc.classes.find((c) => c.id === id);
  if (cls) return { kind: 'class', id, title: cls.name };
  for (const a of doc.assignments) {
    if (a.id === id) return { kind: 'assignment', id, title: a.title };
    const task = (a.tasks || []).find((t) => t.id === id);
    if (task) return { kind: 'task', id, assignmentId: a.id, title: `${a.title}: ${task.title}` };
  }
  const event = doc.events.find((e) => e.id === id);
  if (event) return { kind: 'event', id, title: event.title };
  const win = doc.availability.find((w) => w.id === id);
  if (win) return { kind: 'availability', id, title: win.label || 'Study time' };
  const block = doc.scheduleBlocks.find((b) => b.id === id);
  if (block) {
    const assignment = block.assignmentId ? doc.assignments.find((a) => a.id === block.assignmentId) : undefined;
    return { kind: 'block', id, title: block.title || assignment?.title || (block.kind === 'break' ? 'Break' : 'Work block') };
  }
  return null;
}

/** True when nothing at all has been entered or imported yet. */
export function isEmptyDocument(doc: ScheduleDocument): boolean {
  return (
    doc.classes.length === 0 &&
    doc.assignments.length === 0 &&
    doc.events.length === 0 &&
    doc.availability.length === 0 &&
    doc.scheduleBlocks.length === 0
  );
}

export type SetupStepKind = 'class' | 'event' | 'availability' | 'assignment';

/** The four setup steps of a hand-built schedule, in order, with how many items each has. */
export function setupSteps(doc: ScheduleDocument): Array<{ kind: SetupStepKind; done: boolean; count: number }> {
  const counts: Array<[SetupStepKind, number]> = [
    ['class', doc.classes.length],
    ['event', doc.events.length],
    ['availability', doc.availability.length],
    ['assignment', doc.assignments.length],
  ];
  return counts.map(([kind, count]) => ({ kind, done: count > 0, count }));
}

// ---------------------------------------------------------------------------
// Suggestions and titles
// ---------------------------------------------------------------------------

/**
 * Where "Add work" puts a new block on a day: the first unplanned free gap
 * (from now on, for today) that has at least 15 minutes, else 4:00 PM (or the
 * next quarter hour after now, for today).
 */
export function suggestNewSpan(model: DayModel, now: LocalDateTimeStr, length = DEFAULT_NEW_BLOCK_MINUTES): Span {
  const nowMinute = nowMinutesOn(model.date, now);
  const earliest = nowMinute === null ? 0 : Math.ceil(nowMinute / 15) * 15;
  for (const gap of availableGaps(model)) {
    const start = Math.ceil(Math.max(gap.start, earliest) / 5) * 5;
    if (gap.end - start >= 15) return { start, end: Math.min(gap.end, start + length) };
  }
  const start = clamp(Math.max(16 * 60, earliest), 0, MINUTES_PER_DAY - 15);
  return { start, end: Math.min(MINUTES_PER_DAY, start + length) };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 12 – 18", "Sep 28 – Oct 4", with the year when it is not `currentYear` ("Dec 28 – Jan 3, 2027"). */
export function formatWeekRange(start: DateStr, end: DateStr, currentYear?: number): string {
  if (!isValidDate(start) || !isValidDate(end)) return '';
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const range = sy === ey && sm === em ? `${MONTHS_SHORT[sm - 1]} ${sd} – ${ed}` : `${MONTHS_SHORT[sm - 1]} ${sd} – ${MONTHS_SHORT[em - 1]} ${ed}`;
  return currentYear !== undefined && (sy !== currentYear || ey !== currentYear) ? `${range}, ${ey}` : range;
}
