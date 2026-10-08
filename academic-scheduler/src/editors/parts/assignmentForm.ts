// Assignment editor form (§ 8) with its subtasks (§ 9) and references
// (§ 8.2): conversion from/to Assignment and validation of every rule the
// format sets for them (§ 13.2 rules 17–18, § 13.3 rules 21–23).
import type { Assignment, AssignmentType, LocalDateTimeStr, Priority, ScheduleDocument, Task, WorkStatus } from '../../model/types';
import { isValidDate } from '../../lib/time';
import {
  MAX_MINUTES,
  ProblemList,
  checkDateTimeParts,
  checkInteger,
  checkText,
  compact,
  completionFields,
  composeDateTime,
  findCycle,
  keepDefault,
  notAfter,
  optionalText,
  partsOf,
  valueOfParts,
  type DateTimeParts,
  type Problem,
} from './common';
import { checkReferences, referenceRows, rowsToReferences, type ReferenceRow } from './references';

export interface TaskRow {
  /** The task id (also the row key). Never changes. */
  id: string;
  /** The stored task (absent for a task added in this form). */
  base?: Task;
  title: string;
  description: string;
  notes: string;
  estimatedMinutes: number | '';
  /** The person removed the (read-only) estimate range. */
  removeRange: boolean;
  status: WorkStatus;
  required: boolean;
  due: DateTimeParts;
  recommendedStartDate: string;
  recommendedCompletionDate: DateTimeParts;
  dependsOn: string[];
}

export interface AssignmentForm {
  title: string;
  classId: string;
  type: AssignmentType;
  topic: string;
  description: string;
  notes: string;
  due: DateTimeParts;
  assessmentDate: DateTimeParts;
  recommendedCompletionDate: DateTimeParts;
  estimatedMinutes: number | '';
  removeRange: boolean;
  priority: Priority;
  status: WorkStatus;
  points: string;
  required: boolean;
  dependsOn: string[];
  tasks: TaskRow[];
  references: ReferenceRow[];
}

export function taskToRow(task: Task): TaskRow {
  return {
    id: task.id,
    base: task,
    title: task.title ?? '',
    description: task.description ?? '',
    notes: task.notes ?? '',
    estimatedMinutes: task.estimatedMinutes ?? '',
    removeRange: false,
    status: task.status ?? 'not_started',
    required: task.required ?? true,
    due: partsOf(task.due),
    recommendedStartDate: task.recommendedStartDate ?? '',
    recommendedCompletionDate: partsOf(task.recommendedCompletionDate),
    dependsOn: task.dependsOn ? [...task.dependsOn] : [],
  };
}

export function newTaskRow(id: string, title = ''): TaskRow {
  return {
    id,
    title,
    description: '',
    notes: '',
    estimatedMinutes: '',
    removeRange: false,
    status: 'not_started',
    required: true,
    due: { date: '', time: '' },
    recommendedStartDate: '',
    recommendedCompletionDate: { date: '', time: '' },
    dependsOn: [],
  };
}

export function assignmentToForm(item: Partial<Assignment> | undefined): AssignmentForm {
  return {
    title: item?.title ?? '',
    classId: item?.classId ?? '',
    type: item?.type ?? 'homework',
    topic: item?.topic ?? '',
    description: item?.description ?? '',
    notes: item?.notes ?? '',
    due: partsOf(item?.due),
    assessmentDate: partsOf(item?.assessmentDate),
    recommendedCompletionDate: partsOf(item?.recommendedCompletionDate),
    estimatedMinutes: item?.estimatedMinutes ?? '',
    removeRange: false,
    priority: item?.priority ?? 'medium',
    status: item?.status ?? 'not_started',
    points: item?.points ?? '',
    required: item?.required ?? true,
    dependsOn: item?.dependsOn ? [...item.dependsOn] : [],
    tasks: (item?.tasks || []).map(taskToRow),
    references: referenceRows(item?.references),
  };
}

/** Sum of the estimates of the non-cancelled task rows (null when none has one). */
export function taskEstimateTotal(rows: TaskRow[]): number | null {
  let total = 0;
  let any = false;
  for (const row of rows) {
    if (row.status === 'cancelled' || row.estimatedMinutes === '' || !Number.isFinite(row.estimatedMinutes)) continue;
    total += row.estimatedMinutes;
    any = true;
  }
  return any ? total : null;
}

/** The dependsOn graph of all assignments, with `id`'s edges taken from the form. */
export function assignmentGraph(doc: ScheduleDocument, id: string, dependsOn: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const a of doc.assignments) graph.set(a.id, a.dependsOn || []);
  graph.set(id, dependsOn);
  return graph;
}

export function taskGraph(rows: TaskRow[]): Map<string, string[]> {
  return new Map(rows.map((row) => [row.id, row.dependsOn]));
}

function checkRange(
  problems: ProblemList,
  key: string,
  range: { min: number; max: number } | undefined,
  removed: boolean,
  estimate: number | '',
  context?: string,
): void {
  if (!range || removed) return;
  if (estimate === '') {
    problems.add(key, `The estimate range ${range.min}–${range.max} min needs an estimate. Enter one or remove the range.`, { context });
  } else if (Number.isFinite(estimate) && (estimate < range.min || estimate > range.max)) {
    problems.add(key, `The estimate must be within its range of ${range.min}–${range.max} min. Change it or remove the range.`, { context });
  }
}

/** Rule 22 (task dates) and the latest date any task may have. */
function latestAllowed(form: AssignmentForm): string | undefined {
  const due = valueOfParts(form.due);
  const assessment = valueOfParts(form.assessmentDate);
  if (due && assessment) return notAfter(due, assessment) ? assessment : due;
  return due ?? assessment;
}

export function validateAssignmentForm(form: AssignmentForm, doc: ScheduleDocument, id: string): Problem[] {
  const problems = new ProblemList();
  checkText(problems, 'title', form.title, { label: 'Title', max: 200, required: true });
  if (form.classId && !doc.classes.some((c) => c.id === form.classId)) problems.add('classId', 'This class no longer exists. Choose another class.');
  checkText(problems, 'topic', form.topic, { label: 'Topic', max: 200 });
  checkText(problems, 'description', form.description, { label: 'Description', max: 20000 });
  checkText(problems, 'notes', form.notes, { label: 'Notes', max: 10000 });
  checkText(problems, 'points', form.points, { label: 'Points', max: 100 });
  checkDateTimeParts(problems, 'due', form.due, { label: 'Due date' });
  checkDateTimeParts(problems, 'assessmentDate', form.assessmentDate, { label: 'Assessment date' });
  checkDateTimeParts(problems, 'recommendedCompletionDate', form.recommendedCompletionDate, { label: 'Target date' });
  checkInteger(problems, 'estimatedMinutes', form.estimatedMinutes, { label: 'Estimate', min: 0, max: MAX_MINUTES });

  const base = doc.assignments.find((a) => a.id === id);
  checkRange(problems, 'estimatedMinutes', base?.estimateRange, form.removeRange, form.estimatedMinutes);

  // Rule 21: the target date is not later than the due date (or, without a
  // due date, the assessment date).
  const due = valueOfParts(form.due);
  const assessment = valueOfParts(form.assessmentDate);
  const target = valueOfParts(form.recommendedCompletionDate);
  if (target && due && !notAfter(target, due)) {
    problems.add('recommendedCompletionDate', 'The target date cannot be later than the due date.');
  } else if (target && !due && assessment && !notAfter(target, assessment)) {
    problems.add('recommendedCompletionDate', 'The target date cannot be later than the assessment date.');
  }

  // Rules 17–18: prerequisites exist, are not this assignment, no cycles.
  const known = new Set(doc.assignments.map((a) => a.id));
  for (const dep of form.dependsOn) {
    if (dep === id) problems.add('dependsOn', 'An assignment cannot depend on itself.');
    else if (!known.has(dep)) problems.add('dependsOn', 'A prerequisite assignment no longer exists. Remove it.');
  }
  if (new Set(form.dependsOn).size !== form.dependsOn.length) problems.add('dependsOn', 'A prerequisite is listed twice.');
  if (!problems.has('dependsOn') && findCycle(assignmentGraph(doc, id, form.dependsOn), id)) {
    problems.add('dependsOn', 'These prerequisites form a loop (an assignment would have to be finished before itself).');
  }

  checkTasks(problems, form);
  checkReferences(problems, form.references);
  return problems.items;
}

function checkTasks(problems: ProblemList, form: AssignmentForm): void {
  const latest = latestAllowed(form);
  const assignmentDue = valueOfParts(form.due);
  const ids = new Set(form.tasks.map((t) => t.id));
  const graph = taskGraph(form.tasks);
  form.tasks.forEach((row, index) => {
    const context = `Subtask ${index + 1}${row.title.trim() ? ` (${row.title.trim()})` : ''}`;
    const k = (field: string) => `tasks.${row.id}.${field}`;
    checkText(problems, k('title'), row.title, { label: 'Title', max: 200, required: true, context });
    checkText(problems, k('description'), row.description, { label: 'Description', max: 5000, context });
    checkText(problems, k('notes'), row.notes, { label: 'Notes', max: 10000, context });
    checkInteger(problems, k('estimatedMinutes'), row.estimatedMinutes, { label: 'Estimate', min: 0, max: MAX_MINUTES, context });
    checkRange(problems, k('estimatedMinutes'), row.base?.estimateRange, row.removeRange, row.estimatedMinutes, context);
    checkDateTimeParts(problems, k('due'), row.due, { label: 'Due date', context });
    checkDateTimeParts(problems, k('recommendedCompletionDate'), row.recommendedCompletionDate, { label: 'Target date', context });
    if (row.recommendedStartDate && !isValidDate(row.recommendedStartDate)) {
      problems.add(k('recommendedStartDate'), 'Start date is not a valid date.', { context });
    }

    // Rule 22: start ≤ target ≤ due ≤ assignment due; every date ≤ the later
    // of the assignment's due and assessment date.
    const start = row.recommendedStartDate && isValidDate(row.recommendedStartDate) ? row.recommendedStartDate : undefined;
    const target = valueOfParts(row.recommendedCompletionDate);
    const due = valueOfParts(row.due);
    if (start && target && !notAfter(start, target)) problems.add(k('recommendedStartDate'), 'The start date cannot be later than the target date.', { context });
    if (target && due && !notAfter(target, due)) problems.add(k('recommendedCompletionDate'), 'The target date cannot be later than the subtask’s due date.', { context });
    if (due && assignmentDue && !notAfter(due, assignmentDue)) problems.add(k('due'), 'A subtask cannot be due after the assignment’s due date.', { context });
    if (latest) {
      const what = valueOfParts(form.due) && valueOfParts(form.assessmentDate) ? 'the assignment’s due and assessment dates' : valueOfParts(form.due) ? 'the assignment’s due date' : 'the assignment’s assessment date';
      if (due && !notAfter(due, latest)) problems.add(k('due'), `The due date cannot be later than ${what}.`, { context });
      if (target && !notAfter(target, latest)) problems.add(k('recommendedCompletionDate'), `The target date cannot be later than ${what}.`, { context });
      if (start && !notAfter(start, latest)) problems.add(k('recommendedStartDate'), `The start date cannot be later than ${what}.`, { context });
    }

    for (const dep of row.dependsOn) {
      if (dep === row.id) problems.add(k('dependsOn'), 'A subtask cannot depend on itself.', { context });
      else if (!ids.has(dep)) problems.add(k('dependsOn'), 'A subtask it depends on was removed. Remove the dependency.', { context });
    }
    if (!problems.has(k('dependsOn')) && findCycle(graph, row.id)) {
      problems.add(k('dependsOn'), 'These dependencies form a loop.', { context });
    }
  });
}

/**
 * The task to store. `current` is the task as stored now (it may have changed
 * since the form opened, e.g. "Allow /academic-schedule to update this again"
 * cleared its `overrides`); fields the form does not show come from it.
 */
function rowToTask(row: TaskRow, now: LocalDateTimeStr, current: Task | undefined): Task {
  const base = current ?? row.base;
  const task: Task = compact<Task>({
    ...(base || {}),
    id: row.id,
    title: row.title.trim(),
    description: optionalText(row.description),
    notes: optionalText(row.notes),
    estimatedMinutes: row.estimatedMinutes === '' ? undefined : row.estimatedMinutes,
    estimateRange: row.removeRange ? undefined : base?.estimateRange,
    status: keepDefault(base?.status, row.status, 'not_started'),
    completedAt: completionFields(row.status, base, now),
    required: keepDefault(base?.required, row.required, true),
    due: composeDateTime(row.due, base?.due),
    recommendedStartDate: row.recommendedStartDate || undefined,
    recommendedCompletionDate: composeDateTime(row.recommendedCompletionDate, base?.recommendedCompletionDate),
    dependsOn: row.dependsOn.length ? [...row.dependsOn] : undefined,
  });
  // The estimate range needs an estimate (rule 8); validation keeps both consistent.
  if (task.estimateRange && task.estimatedMinutes === undefined) delete task.estimateRange;
  return task;
}

/**
 * The assignment to store: `base` (the stored assignment, or `{ id }` for a
 * new one) with the form's fields applied. Fields the form does not show
 * (source, issues, sourceState, estimate details, `x-…`, …) are kept.
 */
export function formToAssignment(form: AssignmentForm, base: Assignment, now: LocalDateTimeStr): Assignment {
  const storedTasks = new Map((base.tasks || []).map((t) => [t.id, t]));
  const assignment = compact<Assignment>({
    ...base,
    title: form.title.trim(),
    classId: form.classId || undefined,
    type: keepDefault(base.type, form.type, 'homework'),
    topic: optionalText(form.topic),
    description: optionalText(form.description),
    notes: optionalText(form.notes),
    due: composeDateTime(form.due, base.due),
    assessmentDate: composeDateTime(form.assessmentDate, base.assessmentDate),
    recommendedCompletionDate: composeDateTime(form.recommendedCompletionDate, base.recommendedCompletionDate),
    estimatedMinutes: form.estimatedMinutes === '' ? undefined : form.estimatedMinutes,
    estimateRange: form.removeRange ? undefined : base.estimateRange,
    priority: keepDefault(base.priority, form.priority, 'medium'),
    status: keepDefault(base.status, form.status, 'not_started'),
    completedAt: completionFields(form.status, base, now),
    points: optionalText(form.points),
    required: keepDefault(base.required, form.required, true),
    dependsOn: form.dependsOn.length ? [...form.dependsOn] : undefined,
    tasks: form.tasks.length ? form.tasks.map((row) => rowToTask(row, now, storedTasks.get(row.id))) : undefined,
    references: rowsToReferences(form.references),
  });
  if (assignment.estimateRange && assignment.estimatedMinutes === undefined) delete assignment.estimateRange;
  return assignment;
}
