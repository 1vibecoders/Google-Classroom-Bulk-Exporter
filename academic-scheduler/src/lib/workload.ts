// Deterministic workload arithmetic for assignments (no estimation: it only
// uses the numbers that are in the data).
import type { Assignment, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../model/types';

export interface AssignmentProgress {
  /** estimatedMinutes, or the sum of task estimates, or null if unknown. */
  estimatedMinutes: number | null;
  /**
   * Work still to do, exactly as SCHEDULE_FORMAT.md § 8.1 "Remaining work"
   * defines it. null if nothing is estimated.
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
  tasksTotal: number;
  tasksDone: number;
  /** Next planned block starting at or after `now`. */
  nextBlock: ScheduleBlock | null;
  /** All blocks of this assignment, sorted by start. */
  blocks: ScheduleBlock[];
  /** due/assessment moment has passed and status is not done/cancelled. */
  overdue: boolean;
}

export function assignmentProgress(doc: ScheduleDocument, assignment: Assignment, now: LocalDateTimeStr): AssignmentProgress {
  void doc;
  void assignment;
  void now;
  throw new Error('assignmentProgress: not implemented');
}

/**
 * The moment that matters for planning an assignment: the earlier of its
 * `due` (date-only → settings.defaultDueTime on that date) and its
 * `assessmentDate` (date-only → 00:00 of that day), or null if neither.
 */
export function deadlineOf(doc: ScheduleDocument, assignment: Assignment): LocalDateTimeStr | null {
  void doc;
  void assignment;
  throw new Error('deadlineOf: not implemented');
}
