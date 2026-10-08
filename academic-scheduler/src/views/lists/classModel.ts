// Per-class counts for the classes view (pure; unit-tested).
import type { Assignment, DateOrDateTimeStr, Id, LocalDateTimeStr, ScheduleDocument } from '../../model/types';
import { isValidDateOrDateTime, isValidLocalDateTime, ldtToMinutes, startOfDayMoment } from '../../lib/time';
import { deadlineDateOf, deadlineOf, progressByAssignment } from '../../lib/workload';

export interface ClassStats {
  /** All assignments of the class. */
  assignments: number;
  /** Not done or cancelled. */
  open: number;
  /** Done or cancelled. */
  closed: number;
  /** Σ remaining minutes of the assignments that count (§ 8.1). */
  remainingMinutes: number;
  unscheduledMinutes: number;
  /** Counted assignments without an estimate. */
  unestimated: number;
  overdue: number;
  /** The open assignment with the soonest deadline still ahead (or overdue), if any. */
  next: { assignment: Assignment; deadline: LocalDateTimeStr; kind: 'due' | 'assessment'; value: DateOrDateTimeStr } | null;
  /** Events with this classId. */
  events: number;
  /** Schedule blocks of its assignments, and how many of them are done. */
  blocks: number;
  doneBlocks: number;
}

function empty(): ClassStats {
  return {
    assignments: 0,
    open: 0,
    closed: 0,
    remainingMinutes: 0,
    unscheduledMinutes: 0,
    unestimated: 0,
    overdue: 0,
    next: null,
    events: 0,
    blocks: 0,
    doneBlocks: 0,
  };
}

/**
 * Stats per class id. Assignments without a class (or whose class does not
 * exist) are collected under the key `''`.
 */
export function classStats(doc: ScheduleDocument, now: LocalDateTimeStr): Map<Id, ClassStats> {
  const known = new Set(doc.classes.map((c) => c.id));
  const keyOf = (classId: string | undefined) => (classId && known.has(classId) ? classId : '');
  const out = new Map<Id, ClassStats>();
  const get = (key: string) => {
    let s = out.get(key);
    if (!s) {
      s = empty();
      out.set(key, s);
    }
    return s;
  };
  for (const c of doc.classes) get(c.id);
  const progress = progressByAssignment(doc, now);
  const today = isValidLocalDateTime(now) ? now.slice(0, 10) : '';
  for (const a of doc.assignments) {
    const s = get(keyOf(a.classId));
    const p = progress.get(a.id)!;
    s.assignments += 1;
    const closed = a.status === 'done' || a.status === 'cancelled';
    if (closed) s.closed += 1;
    else s.open += 1;
    if (p.counts) {
      s.remainingMinutes += p.remainingMinutes ?? 0;
      s.unscheduledMinutes += p.unscheduledMinutes ?? 0;
      if (p.remainingMinutes === null) s.unestimated += 1;
      if (p.overdue) s.overdue += 1;
    }
    s.blocks += p.blocks.length;
    s.doneBlocks += p.blocks.filter((b) => b.status === 'done').length;
    if (!closed) {
      const deadline = deadlineOf(doc, a);
      const date = deadlineDateOf(a);
      if (deadline && date && p.counts && (p.overdue || date >= today)) {
        if (!s.next || ldtToMinutes(deadline) < ldtToMinutes(s.next.deadline)) {
          const fromAssessment = !!a.assessmentDate && isValidDateOrDateTime(a.assessmentDate) && startOfDayMoment(a.assessmentDate) === deadline;
          s.next = fromAssessment
            ? { assignment: a, deadline, kind: 'assessment', value: a.assessmentDate! }
            : { assignment: a, deadline, kind: 'due', value: a.due ?? deadline };
        }
      }
    }
  }
  for (const e of doc.events) {
    if (e.classId && known.has(e.classId)) get(e.classId).events += 1;
  }
  return out;
}
