// Options for assignment pickers (event "linked assessment", block
// "assignment"): sorted by class then deadline, open work first.
import { ASSESSMENT_TYPES, ASSIGNMENT_TYPE_LABELS } from '../../model/constants';
import type { Assignment, ScheduleDocument } from '../../model/types';
import { dateOf, formatDateShort, isValidDateOrDateTime } from '../../lib/time';

function keyDate(a: Assignment): string {
  const value = a.assessmentDate ?? a.due;
  return value && isValidDateOrDateTime(value) ? dateOf(value) : '9999-12-31';
}

export function assignmentLabel(doc: ScheduleDocument, a: Assignment, options: { withDate?: boolean; withType?: boolean } = {}): string {
  const cls = a.classId ? doc.classes.find((c) => c.id === a.classId) : undefined;
  const parts = [cls ? `${cls.name} · ${a.title}` : a.title];
  const extra: string[] = [];
  if (options.withType && a.type) extra.push(ASSIGNMENT_TYPE_LABELS[a.type]);
  const value = a.assessmentDate ?? a.due;
  if (options.withDate && value && isValidDateOrDateTime(value)) extra.push(formatDateShort(dateOf(value)));
  if (a.status === 'done') extra.push('done');
  if (a.status === 'cancelled') extra.push('cancelled');
  return extra.length ? `${parts[0]} (${extra.join(', ')})` : parts[0];
}

/**
 * Assignments to offer in a picker: open work (and the current selection),
 * hiding work of archived classes, sorted by class name then key date.
 * `preferAssessments` lists quizzes/tests/exams/presentations first.
 */
export function assignmentOptions(
  doc: ScheduleDocument,
  selected: string,
  options: { preferAssessments?: boolean; noneLabel: string; withType?: boolean },
): Array<{ value: string; label: string }> {
  const archived = new Set(doc.classes.filter((c) => c.archived).map((c) => c.id));
  const className = new Map(doc.classes.map((c) => [c.id, c.name]));
  const list = doc.assignments
    .filter((a) => a.id === selected || ((a.status ?? 'not_started') !== 'done' && a.status !== 'cancelled' && !(a.classId && archived.has(a.classId))))
    .slice()
    .sort((a, b) => {
      if (options.preferAssessments) {
        const pa = a.type && ASSESSMENT_TYPES.includes(a.type) ? 0 : 1;
        const pb = b.type && ASSESSMENT_TYPES.includes(b.type) ? 0 : 1;
        if (pa !== pb) return pa - pb;
      }
      const ca = (a.classId && className.get(a.classId)) || '￿';
      const cb = (b.classId && className.get(b.classId)) || '￿';
      return ca.localeCompare(cb) || keyDate(a).localeCompare(keyDate(b)) || a.title.localeCompare(b.title);
    })
    .map((a) => ({ value: a.id, label: assignmentLabel(doc, a, { withDate: true, withType: options.withType }) }));
  if (selected && !doc.assignments.some((a) => a.id === selected)) list.unshift({ value: selected, label: 'Deleted assignment' });
  return [{ value: '', label: options.noneLabel }, ...list];
}
