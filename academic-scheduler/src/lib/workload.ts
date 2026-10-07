// Deterministic workload arithmetic for assignments (no estimation: it only
// uses the numbers that are in the data). Implements SCHEDULE_FORMAT.md
// § 8.1 "Remaining work" exactly:
//
// - A work block is a block whose kind is "work" (the default); its minutes
//   are end − start. Done minutes = minutes of work blocks with status "done".
//   A past block still "planned" counts as not done; a block in progress
//   counts as planned.
// - Task remaining: 0 if done/cancelled; 0 if required === false and no
//   planned work block has its taskId; else max(0, estimatedMinutes − done
//   minutes of its blocks) (no estimate → 0).
// - Assignment remaining: 0 if done/cancelled; 0 if required === false and no
//   planned work block references it; 0 if sourceState is missing/withdrawn
//   and status is not in_progress; else, with at least one task estimate:
//   Σ task remaining + max(0, (estimatedMinutes ?? 0) − Σ estimates of
//   non-cancelled tasks − done minutes of its blocks without taskId);
//   otherwise max(0, (estimatedMinutes ?? 0) − done minutes of all its blocks).
// - Scheduled = Σ minutes of planned work blocks ending after now;
//   unscheduled = max(0, remaining − scheduled).
import { resolveSettings } from '../model/constants';
import type {
  Assignment,
  DateOrDateTimeStr,
  DateStr,
  Id,
  LocalDateTimeStr,
  ScheduleBlock,
  ScheduleDocument,
  Task,
} from '../model/types';
import {
  addDays,
  dateOf,
  dueMoment,
  endOfDayMoment,
  isValidDate,
  isValidDateOrDateTime,
  isValidLocalDateTime,
  isValidTime,
  ldtToMinutes,
  splitLocalDateTime,
  startOfDayMoment,
  startOfWeek,
} from './time';

export interface AssignmentProgress {
  /** estimatedMinutes, or the sum of task estimates (non-cancelled tasks), or null if unknown. */
  estimatedMinutes: number | null;
  /**
   * Work still to do, exactly as SCHEDULE_FORMAT.md § 8.1 "Remaining work"
   * defines it. 0 when the assignment does not count (done, cancelled,
   * optional without planned blocks, no longer in its source); otherwise
   * null if nothing is estimated.
   */
  remainingMinutes: number | null;
  /** Counted in workload totals and automatic planning (§ 8.1: required, sourceState present, not done/cancelled). */
  counts: boolean;
  /** Minutes of planned work blocks that end after `now`. */
  scheduledMinutes: number;
  /** Minutes of blocks marked done. */
  doneMinutes: number;
  /** max(0, remaining − scheduled), null if remaining is unknown. */
  unscheduledMinutes: number | null;
  /** Tasks that are not cancelled. */
  tasksTotal: number;
  tasksDone: number;
  /** Next planned block starting at or after `now`. */
  nextBlock: ScheduleBlock | null;
  /** All blocks of this assignment, sorted by start. */
  blocks: ScheduleBlock[];
  /**
   * It counts (see `counts`), is not done/cancelled, and its due or
   * assessment has passed: a date-time value once `now` is later than it, a
   * date-only value once that whole day is over.
   */
  overdue: boolean;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** Minutes of a block (end − start); 0 when its times cannot be read. */
export function blockMinutes(block: ScheduleBlock): number {
  if (!isValidLocalDateTime(block.start) || !isValidLocalDateTime(block.end)) return 0;
  return Math.max(0, ldtToMinutes(block.end) - ldtToMinutes(block.start));
}

function isWork(block: ScheduleBlock): boolean {
  return (block.kind ?? 'work') === 'work';
}

function statusOf(block: ScheduleBlock): 'planned' | 'done' | 'skipped' {
  return block.status ?? 'planned';
}

function endMinutes(block: ScheduleBlock): number {
  return isValidLocalDateTime(block.end) ? ldtToMinutes(block.end) : Number.NEGATIVE_INFINITY;
}

function startMinutes(block: ScheduleBlock): number {
  return isValidLocalDateTime(block.start) ? ldtToMinutes(block.start) : Number.NEGATIVE_INFINITY;
}

function byStart(a: ScheduleBlock, b: ScheduleBlock): number {
  return startMinutes(a) - startMinutes(b) || endMinutes(a) - endMinutes(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function nowMinutes(now: LocalDateTimeStr): number {
  return isValidLocalDateTime(now) ? ldtToMinutes(now) : Number.POSITIVE_INFINITY;
}

/** Blocks grouped by assignmentId, each list sorted by start. */
export function blocksByAssignment(doc: ScheduleDocument): Map<Id, ScheduleBlock[]> {
  const map = new Map<Id, ScheduleBlock[]>();
  for (const b of doc.scheduleBlocks) {
    if (!b.assignmentId) continue;
    const list = map.get(b.assignmentId);
    if (list) list.push(b);
    else map.set(b.assignmentId, [b]);
  }
  for (const list of map.values()) list.sort(byStart);
  return map;
}

// ---------------------------------------------------------------------------
// Remaining work (§ 8.1)
// ---------------------------------------------------------------------------

function sumMinutes(blocks: ScheduleBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockMinutes(b), 0);
}

function isFinished(status: string | undefined): boolean {
  return status === 'done' || status === 'cancelled';
}

function hasEstimate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Remaining minutes of task `task` given the work blocks of its assignment (§ 8.1). */
function taskRemaining(task: Task, workBlocks: ScheduleBlock[]): number {
  if (isFinished(task.status)) return 0;
  const own = workBlocks.filter((b) => b.taskId === task.id);
  if (task.required === false && !own.some((b) => statusOf(b) === 'planned')) return 0;
  if (!hasEstimate(task.estimatedMinutes)) return 0;
  const done = sumMinutes(own.filter((b) => statusOf(b) === 'done'));
  return Math.max(0, task.estimatedMinutes - done);
}

/** Why an assignment does not count (§ 8.1 rules 1–3), or null when it counts. */
export function exclusionReason(assignment: Assignment, blocks: ScheduleBlock[]): 'finished' | 'optional' | 'notInSource' | null {
  if (isFinished(assignment.status)) return 'finished';
  const planned = blocks.some((b) => isWork(b) && statusOf(b) === 'planned');
  if (assignment.required === false && !planned) return 'optional';
  if ((assignment.sourceState === 'missing' || assignment.sourceState === 'withdrawn') && assignment.status !== 'in_progress') {
    return 'notInSource';
  }
  return null;
}

/** Remaining minutes of one task of an assignment (§ 8.1), 0 when the assignment does not count. */
export function taskRemainingMinutes(doc: ScheduleDocument, assignment: Assignment, task: Task): number {
  const blocks = doc.scheduleBlocks.filter((b) => b.assignmentId === assignment.id);
  if (exclusionReason(assignment, blocks) !== null) return 0;
  return taskRemaining(task, blocks.filter(isWork));
}

/** Progress of `assignment` from its own blocks (`blocks` = all blocks with its id, sorted by start). */
function computeProgress(assignment: Assignment, blocks: ScheduleBlock[], now: number): AssignmentProgress {
  const work = blocks.filter(isWork);
  const tasks = assignment.tasks || [];
  const liveTasks = tasks.filter((t) => t.status !== 'cancelled');
  const done = work.filter((b) => statusOf(b) === 'done');
  const doneMinutes = sumMinutes(done);
  const scheduledMinutes = sumMinutes(work.filter((b) => statusOf(b) === 'planned' && endMinutes(b) > now));

  const counts = exclusionReason(assignment, blocks) === null;
  const anyTaskEstimate = tasks.some((t) => hasEstimate(t.estimatedMinutes));
  const liveTaskEstimates = liveTasks.filter((t) => hasEstimate(t.estimatedMinutes));
  const taskEstimateSum = liveTaskEstimates.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  const ownEstimate = hasEstimate(assignment.estimatedMinutes) ? assignment.estimatedMinutes : null;

  let remainingMinutes: number | null;
  if (!counts) remainingMinutes = 0;
  else if (ownEstimate === null && !anyTaskEstimate) remainingMinutes = null;
  else if (anyTaskEstimate) {
    const tasksRemaining = tasks.reduce((sum, t) => sum + taskRemaining(t, work), 0);
    const doneWithoutTask = sumMinutes(done.filter((b) => !b.taskId));
    remainingMinutes = tasksRemaining + Math.max(0, (ownEstimate ?? 0) - taskEstimateSum - doneWithoutTask);
  } else {
    remainingMinutes = Math.max(0, (ownEstimate ?? 0) - doneMinutes);
  }

  const nextBlock = work.find((b) => statusOf(b) === 'planned' && startMinutes(b) >= now) ?? null;
  return {
    estimatedMinutes: ownEstimate ?? (liveTaskEstimates.length > 0 ? taskEstimateSum : null),
    remainingMinutes,
    counts,
    scheduledMinutes,
    doneMinutes,
    unscheduledMinutes: remainingMinutes === null ? null : Math.max(0, remainingMinutes - scheduledMinutes),
    tasksTotal: liveTasks.length,
    tasksDone: tasks.filter((t) => t.status === 'done').length,
    nextBlock,
    blocks,
    overdue: counts && (hasPassed(assignment.due, now) || hasPassed(assignment.assessmentDate, now)),
  };
}

/** A date-time has passed once now is later than it; a date-only value once its whole day is over. */
function hasPassed(value: DateOrDateTimeStr | undefined, now: number): boolean {
  if (!value || !isValidDateOrDateTime(value)) return false;
  return now > ldtToMinutes(endOfDayMoment(value));
}

export function assignmentProgress(doc: ScheduleDocument, assignment: Assignment, now: LocalDateTimeStr): AssignmentProgress {
  const blocks = doc.scheduleBlocks.filter((b) => b.assignmentId === assignment.id).sort(byStart);
  return computeProgress(assignment, blocks, nowMinutes(now));
}

/** assignmentProgress for every assignment, computed in one pass over the blocks. */
export function progressByAssignment(doc: ScheduleDocument, now: LocalDateTimeStr): Map<Id, AssignmentProgress> {
  const byAssignment = blocksByAssignment(doc);
  const n = nowMinutes(now);
  const out = new Map<Id, AssignmentProgress>();
  for (const a of doc.assignments) out.set(a.id, computeProgress(a, byAssignment.get(a.id) || [], n));
  return out;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

function defaultDueTime(doc: ScheduleDocument): string {
  const t = resolveSettings(doc.settings).defaultDueTime;
  return isValidTime(t) ? t : '00:00';
}

/**
 * The moment that matters for planning an assignment: the earlier of its
 * `due` (date-only → settings.defaultDueTime on that date) and its
 * `assessmentDate` (date-only → 00:00 of that day), or null if neither.
 */
export function deadlineOf(doc: ScheduleDocument, assignment: Assignment): LocalDateTimeStr | null {
  const candidates: LocalDateTimeStr[] = [];
  if (assignment.due && isValidDateOrDateTime(assignment.due)) candidates.push(dueMoment(assignment.due, defaultDueTime(doc)));
  if (assignment.assessmentDate && isValidDateOrDateTime(assignment.assessmentDate)) {
    candidates.push(startOfDayMoment(assignment.assessmentDate));
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((min, c) => (ldtToMinutes(c) < ldtToMinutes(min) ? c : min));
}

/** A task's own deadline: its `due` (date-only → settings.defaultDueTime), or null. */
export function taskDeadlineOf(doc: ScheduleDocument, task: Task): LocalDateTimeStr | null {
  return task.due && isValidDateOrDateTime(task.due) ? dueMoment(task.due, defaultDueTime(doc)) : null;
}

/**
 * The calendar date used to group an assignment by deadline (assignment
 * lists, "this week"): the earlier of the dates of `due` and
 * `assessmentDate`, or null when it has neither.
 */
export function deadlineDateOf(assignment: Assignment): DateStr | null {
  const dates = [assignment.due, assignment.assessmentDate]
    .filter((v): v is string => !!v && isValidDateOrDateTime(v))
    .map((v) => dateOf(v));
  if (dates.length === 0) return null;
  return dates.sort()[0];
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export interface WorkloadSummary {
  /** Assignments included (they count, § 8.1). */
  assignments: number;
  remainingMinutes: number;
  scheduledMinutes: number;
  unscheduledMinutes: number;
  /** Included assignments without any estimate (their remaining work is unknown, counted as 0). */
  unestimated: number;
  /** Included assignments that are overdue. */
  overdue: number;
}

function emptySummary(): WorkloadSummary {
  return { assignments: 0, remainingMinutes: 0, scheduledMinutes: 0, unscheduledMinutes: 0, unestimated: 0, overdue: 0 };
}

function addTo(summary: WorkloadSummary, p: AssignmentProgress): void {
  summary.assignments += 1;
  summary.remainingMinutes += p.remainingMinutes ?? 0;
  // Scheduled minutes beyond the remaining work do not reduce other work.
  summary.scheduledMinutes += p.remainingMinutes === null ? p.scheduledMinutes : Math.min(p.scheduledMinutes, p.remainingMinutes);
  summary.unscheduledMinutes += p.unscheduledMinutes ?? 0;
  if (p.remainingMinutes === null) summary.unestimated += 1;
  if (p.overdue) summary.overdue += 1;
}

/**
 * Totals over the assignments that count (§ 8.1) and match `filter`.
 * `scheduledMinutes` counts, per assignment, at most its remaining work, so
 * remaining = scheduled + unscheduled for estimated work.
 */
export function summarizeWorkload(
  doc: ScheduleDocument,
  now: LocalDateTimeStr,
  filter: (assignment: Assignment, progress: AssignmentProgress) => boolean = () => true,
): WorkloadSummary {
  const progress = progressByAssignment(doc, now);
  const summary = emptySummary();
  for (const a of doc.assignments) {
    const p = progress.get(a.id)!;
    if (p.counts && filter(a, p)) addTo(summary, p);
  }
  return summary;
}

export interface WorkloadTotals {
  /** Every assignment that counts. */
  overall: WorkloadSummary;
  /** Deadline date (deadlineDateOf) on or before the last day of the current week; overdue work included. */
  thisWeek: WorkloadSummary;
  /** Overdue work only. */
  overdue: WorkloadSummary;
  /** Work without a due or assessment date. */
  noDate: WorkloadSummary;
  /** First and last day of the current week (settings.weekStartsOn). */
  weekStart: DateStr;
  weekEnd: DateStr;
}

/** Whole-document totals for the assignment view (remaining, scheduled, unscheduled; overdue). */
export function workloadTotals(doc: ScheduleDocument, now: LocalDateTimeStr): WorkloadTotals {
  const today = isValidLocalDateTime(now) ? splitLocalDateTime(now).date : '1970-01-01';
  const weekStart = startOfWeek(today, resolveSettings(doc.settings).weekStartsOn === 'sunday' ? 'sunday' : 'monday');
  const weekEnd = addDays(weekStart, 6);
  const progress = progressByAssignment(doc, now);
  const totals: WorkloadTotals = {
    overall: emptySummary(),
    thisWeek: emptySummary(),
    overdue: emptySummary(),
    noDate: emptySummary(),
    weekStart,
    weekEnd,
  };
  for (const a of doc.assignments) {
    const p = progress.get(a.id)!;
    if (!p.counts) continue;
    addTo(totals.overall, p);
    const date = deadlineDateOf(a);
    if (date === null) addTo(totals.noDate, p);
    else if (date <= weekEnd || p.overdue) addTo(totals.thisWeek, p);
    if (p.overdue) addTo(totals.overdue, p);
  }
  return totals;
}

export interface DayWorkload {
  date: DateStr;
  /** Planned work blocks starting this day (minutes). */
  plannedMinutes: number;
  /** Done work blocks starting this day (minutes). */
  doneMinutes: number;
  /** Assignments that count whose deadline date (deadlineDateOf) is this day. */
  due: Assignment[];
  /** Remaining minutes of those assignments. */
  dueRemainingMinutes: number;
}

/** Per-day workload from `from` to `to` (inclusive): blocks on the day and work due that day. */
export function workloadByDay(doc: ScheduleDocument, now: LocalDateTimeStr, from: DateStr, to: DateStr): DayWorkload[] {
  if (!isValidDate(from) || !isValidDate(to) || to < from) return [];
  const days = new Map<DateStr, DayWorkload>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { date: d, plannedMinutes: 0, doneMinutes: 0, due: [], dueRemainingMinutes: 0 });
  }
  for (const b of doc.scheduleBlocks) {
    if (!isWork(b) || !isValidLocalDateTime(b.start)) continue;
    const day = days.get(b.start.slice(0, 10));
    if (!day) continue;
    if (statusOf(b) === 'planned') day.plannedMinutes += blockMinutes(b);
    else if (statusOf(b) === 'done') day.doneMinutes += blockMinutes(b);
  }
  const progress = progressByAssignment(doc, now);
  for (const a of doc.assignments) {
    const p = progress.get(a.id)!;
    const date = deadlineDateOf(a);
    const day = date ? days.get(date) : undefined;
    if (!day || !p.counts) continue;
    day.due.push(a);
    day.dueRemainingMinutes += p.remainingMinutes ?? 0;
  }
  return [...days.values()];
}
