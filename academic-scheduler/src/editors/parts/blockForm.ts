// Schedule block form (§ 12): conversion from/to ScheduleBlock, validation
// (§ 13.1 rule 6, § 13.2 rule 17, § 13.3 rule 19) and the store actions that
// save it (moving a generated/planner block pins it, § 6.2).
import type { BlockKind, BlockStatus, DateStr, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../../model/types';
import type { Action } from '../../state/reducer';
import { resolveSettings } from '../../model/constants';
import {
  addDays,
  compareLdt,
  dueMoment,
  formatDateWithWeekday,
  formatTime12,
  isValidDate,
  isValidDateOrDateTime,
  isValidEndTime,
  isValidLocalDateTime,
  isValidTime,
  splitLocalDateTime,
  startOfDayMoment,
} from '../../lib/time';
import { ProblemList, checkText, checkTimeRange, compact, completionFields, keepDefault, optionalText, sameDateOrDateTime, type Problem } from './common';

/** Shortest block (§ 12: end at least 5 minutes after start). */
export const MIN_BLOCK_MINUTES = 5;

export interface BlockForm {
  kind: BlockKind;
  assignmentId: string;
  taskId: string;
  /** Free title (blocks without an assignment, breaks) or an optional label. */
  title: string;
  date: string;
  startTime: string;
  /** HH:MM, or '24:00' = midnight at the end of `date`. */
  endTime: string;
  status: BlockStatus;
  description: string;
  notes: string;
}

/** Whether the person may edit `description` (generator-owned on generated/planner blocks). */
export function descriptionEditable(block: Partial<ScheduleBlock> | undefined, isNew: boolean): boolean {
  return isNew || (block?.origin ?? 'generated') === 'user';
}

export function blockToForm(item: Partial<ScheduleBlock> | undefined, today: DateStr): BlockForm {
  let date = today;
  let startTime = '';
  let endTime = '';
  if (item?.start && isValidLocalDateTime(item.start)) {
    const s = splitLocalDateTime(item.start);
    date = s.date;
    startTime = s.time;
    if (item.end && isValidLocalDateTime(item.end)) {
      const e = splitLocalDateTime(item.end);
      endTime = e.date !== s.date && e.time === '00:00' && e.date === addDays(s.date, 1) ? '24:00' : e.time;
    }
  }
  const kind = item?.kind ?? 'work';
  return {
    kind,
    assignmentId: item?.assignmentId ?? '',
    taskId: item?.taskId ?? '',
    title: item?.title ?? (kind === 'break' ? 'Break' : ''),
    date,
    startTime,
    endTime,
    status: item?.status ?? 'planned',
    description: item?.description ?? '',
    notes: item?.notes ?? '',
  };
}

/** Start and end date-times of a valid form (end '24:00' → 00:00 of the next day). */
export function formTimes(form: BlockForm): { start: LocalDateTimeStr; end: LocalDateTimeStr } | null {
  if (!isValidDate(form.date) || !isValidTime(form.startTime) || !isValidEndTime(form.endTime)) return null;
  const start = `${form.date}T${form.startTime}:00`;
  const end = form.endTime === '24:00' ? `${addDays(form.date, 1)}T00:00:00` : `${form.date}T${form.endTime}:00`;
  return { start, end };
}

export function validateBlockForm(form: BlockForm, doc: ScheduleDocument, options: { descriptionEditable: boolean }): Problem[] {
  const problems = new ProblemList();
  if (!form.date) problems.add('date', 'Date is required.', { required: true });
  else if (!isValidDate(form.date)) problems.add('date', 'Date is not a valid date.');
  checkTimeRange(problems, { start: 'startTime', end: 'endTime' }, form.startTime, form.endTime, { minMinutes: MIN_BLOCK_MINUTES });

  if (form.kind === 'break') {
    checkText(problems, 'title', form.title, { label: 'Title', max: 200, required: true });
  } else {
    if (!form.assignmentId && !form.title.trim()) {
      problems.add('title', 'Choose an assignment or enter a title.', { required: true });
    }
    checkText(problems, 'title', form.title, { label: 'Title', max: 200 });
    if (form.assignmentId) {
      const assignment = doc.assignments.find((a) => a.id === form.assignmentId);
      if (!assignment) problems.add('assignmentId', 'This assignment no longer exists. Choose another one.');
      else if (form.taskId && !(assignment.tasks || []).some((t) => t.id === form.taskId)) {
        problems.add('taskId', 'This subtask is not part of the chosen assignment.');
      }
    }
  }
  if (options.descriptionEditable) checkText(problems, 'description', form.description, { label: 'Description', max: 5000 });
  checkText(problems, 'notes', form.notes, { label: 'Notes', max: 10000 });
  return problems.items;
}

/** The block to store: `base` with the form's fields applied (unknown fields kept). */
export function formToBlock(form: BlockForm, base: ScheduleBlock, now: LocalDateTimeStr, options: { descriptionEditable: boolean }): ScheduleBlock {
  const times = formTimes(form);
  const isBreak = form.kind === 'break';
  const assignmentId = isBreak ? undefined : form.assignmentId || undefined;
  const start = times ? (base.start && sameDateOrDateTime(times.start, base.start) ? base.start : times.start) : base.start;
  const end = times ? (base.end && sameDateOrDateTime(times.end, base.end) ? base.end : times.end) : base.end;
  return compact<ScheduleBlock>({
    ...base,
    start,
    end,
    kind: keepDefault(base.kind, form.kind, 'work'),
    assignmentId,
    taskId: assignmentId ? form.taskId || undefined : undefined,
    title: optionalText(form.title),
    status: keepDefault(base.status, form.status, 'planned'),
    completedAt: completionFields(form.status, base, now),
    description: options.descriptionEditable ? optionalText(form.description) : base.description,
    notes: optionalText(form.notes),
  });
}

/**
 * Store actions that save `item`. A new block is added with origin `user`.
 * Changing the time of a generated or planner block is a move: it goes
 * through `moveBlock` (which pins the block, § 6.2) so `start`/`end` are not
 * recorded in `overrides`.
 */
export function blockSaveActions(item: ScheduleBlock, stored: ScheduleBlock | undefined): Action[] {
  if (!stored) return [{ type: 'upsertBlock', item: { ...item, origin: item.origin ?? 'user' } }];
  const generatedLike = (stored.origin ?? 'generated') !== 'user';
  const moved = item.start !== stored.start || item.end !== stored.end;
  if (generatedLike && moved) {
    return [
      { type: 'moveBlock', id: stored.id, start: item.start, end: item.end },
      { type: 'upsertBlock', item: { ...item, locked: true } },
    ];
  }
  return [{ type: 'upsertBlock', item }];
}

/** Non-blocking notes about a block's timing (§ 13.4 warnings). */
export function blockWarnings(form: BlockForm, doc: ScheduleDocument): string[] {
  const times = formTimes(form);
  if (!times || form.kind === 'break' || !form.assignmentId) return [];
  const assignment = doc.assignments.find((a) => a.id === form.assignmentId);
  if (!assignment) return [];
  const out: string[] = [];
  const { defaultDueTime } = resolveSettings(doc.settings);
  if (assignment.due && isValidDateOrDateTime(assignment.due)) {
    const moment = dueMoment(assignment.due, defaultDueTime);
    if (compareLdt(times.end, moment) > 0) out.push(`This session ends after the assignment is due (${formatMoment(moment)}).`);
  }
  if (assignment.assessmentDate && isValidDateOrDateTime(assignment.assessmentDate)) {
    const moment = startOfDayMoment(assignment.assessmentDate);
    if (compareLdt(times.end, moment) > 0) out.push(`This session ends after the assessment starts (${formatMoment(moment)}).`);
  }
  const task = form.taskId ? (assignment.tasks || []).find((t) => t.id === form.taskId) : undefined;
  if (task?.due && isValidDateOrDateTime(task.due)) {
    const moment = dueMoment(task.due, defaultDueTime);
    if (compareLdt(times.end, moment) > 0) out.push(`This session ends after the subtask “${task.title}” is due (${formatMoment(moment)}).`);
  }
  return out;
}

function formatMoment(moment: LocalDateTimeStr): string {
  const { date, time } = splitLocalDateTime(moment);
  return `${formatDateWithWeekday(date)}, ${formatTime12(time)}`;
}
