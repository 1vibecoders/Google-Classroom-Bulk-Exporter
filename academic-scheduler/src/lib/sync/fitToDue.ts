// When a source (a Classroom sync, the extension, an AI finding) moves an
// assignment's due date earlier than work already planned for it, the change
// is still applied: step dates later than the new due date are moved to it,
// and an issue on the assignment says what moved and which planned sessions
// now end after the due date, so the person re-plans. Without this, the
// schedule's date-order rules (SCHEDULE_FORMAT.md § 15) would refuse the whole
// sync. Sessions are never deleted here; finished work stays as it was.
import type { Assignment, Issue, ScheduleBlock } from '../../model/types';
import { compareDateValues } from '../validate';
import { dateOf, dueMoment, ldtToMinutes } from '../time';

const later = (a: string | undefined, b: string) => a !== undefined && compareDateValues(a, b) > 0;

/** `a` with its steps fitted to its dates, and the issue to show; `previousDue` is the date before the change. */
export function fitToDue(original: Assignment, previousDue: string | undefined, blocks: ScheduleBlock[], defaultDueTime: string): Assignment {
  const a = { ...original };
  let moved = 0;
  // The assignment's own completion target is before its due date (or its assessment when it has no due date).
  const target = a.due ?? a.assessmentDate;
  if (target !== undefined && later(a.recommendedCompletionDate, target)) {
    a.recommendedCompletionDate = target;
    moved++;
  }
  const limits = [a.due, a.assessmentDate].filter((x): x is string => x !== undefined);
  if (!limits.length || !a.tasks?.length) return withNotice(a, previousDue, moved, blocks, defaultDueTime);
  const limit = limits.reduce((x, y) => (compareDateValues(x, y) >= 0 ? x : y));
  const tasks = a.tasks.map((t) => {
    if (t.status === 'done') return t;
    const next = { ...t };
    if (later(next.due, a.due ?? limit)) next.due = a.due ?? limit;
    if (later(next.due, limit)) next.due = limit;
    const end = next.due ?? limit;
    if (later(next.recommendedCompletionDate, end)) next.recommendedCompletionDate = end;
    if (later(next.recommendedStartDate, end)) next.recommendedStartDate = dateOf(end);
    if (next.due !== t.due || next.recommendedCompletionDate !== t.recommendedCompletionDate || next.recommendedStartDate !== t.recommendedStartDate) moved++;
    return next;
  });
  return withNotice({ ...a, tasks }, previousDue, moved, blocks, defaultDueTime);
}

function withNotice(a: Assignment, previousDue: string | undefined, moved: number, blocks: ScheduleBlock[], defaultDueTime: string): Assignment {
  const id = `${a.id}-due-earlier`;
  const others = (a.issues ?? []).filter((i) => i.id !== id);
  const earlier = previousDue !== undefined && a.due !== undefined && compareDateValues(a.due, previousDue) < 0;
  const deadline = a.due !== undefined ? ldtToMinutes(dueMoment(a.due, defaultDueTime)) : Infinity;
  const late = blocks.filter((b) => b.assignmentId === a.id && (b.status ?? 'planned') === 'planned' && ldtToMinutes(b.end) > deadline).length;
  if (!earlier || (moved === 0 && late === 0)) return a;
  const parts = [
    moved ? `${moved} planned ${moved === 1 ? 'date was' : 'dates were'} moved to fit` : '',
    late ? `${late} planned ${late === 1 ? 'session ends' : 'sessions end'} after the new date` : '',
  ].filter(Boolean);
  const message = `The due date moved earlier, from ${previousDue} to ${a.due}: ${parts.join('; ')}. Check the plan and re-plan what no longer fits.`;
  const existing = a.issues?.find((i) => i.id === id);
  // The same notice again keeps the person's resolved/dismissed status.
  const issue: Issue = existing && existing.message === message ? existing : { id, kind: 'conflict', field: 'due', message };
  return { ...a, issues: [...others, issue] };
}
