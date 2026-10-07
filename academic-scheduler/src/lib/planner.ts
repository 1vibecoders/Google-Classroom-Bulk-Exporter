// Deterministic work planner ("Plan unscheduled work"). Not AI: a fixed
// earliest-deadline-first algorithm over the free study time the person
// entered. It only proposes blocks; the person reviews them before they are
// added.
import type { Id, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../model/types';

export interface PlanOptions {
  /** Plan only from this moment on (usually now, rounded up to 5 minutes). */
  from: LocalDateTimeStr;
  /** Only these assignments (default: all not done/cancelled with unscheduled work). */
  assignmentIds?: Id[];
  /** Do not plan beyond this many days after `from` (default 28). */
  horizonDays?: number;
}

export interface UnplacedWork {
  assignmentId: Id;
  minutes: number;
  reason: string;
}

export interface PlanResult {
  /** New blocks (origin "planner", status "planned", ids `u-blk-…`), sorted by start. */
  blocks: ScheduleBlock[];
  unplaced: UnplacedWork[];
}

/**
 * Algorithm (documented in the README):
 * 1. Work items = assignments that count (§ 8.1: required, sourceState
 *    present, not done/cancelled) with unscheduled minutes > 0 — split into
 *    their remaining tasks in dependency order (a task's own `due` caps it) —
 *    and a deadline after `from` or no deadline; sorted by deadline (none
 *    last), then priority, then title. Empty availability → nothing planned.
 * 2. Free time per day = availability − busy events − existing blocks (+ break
 *    margins), from `from` until the deadline (assessments: before the start of
 *    the assessment day; due: before the due moment).
 * 3. Fill earliest-first in sessions between settings.minSessionMinutes and
 *    maxSessionMinutes, leaving breakMinutes between sessions and respecting
 *    maxDailyStudyMinutes; spread assessment preparation over the available
 *    days before the assessment rather than packing it into the last day.
 * 4. Whatever does not fit is reported in `unplaced` with a reason.
 * The same input always gives the same output (except for generated ids).
 */
export function planUnscheduledWork(doc: ScheduleDocument, options: PlanOptions): PlanResult {
  void doc;
  void options;
  throw new Error('planUnscheduledWork: not implemented');
}
