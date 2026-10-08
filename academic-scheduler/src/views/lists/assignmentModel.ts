// Pure logic of the assignment view: rows with their § 8.1 progress,
// filtering, grouping and sorting, and the issues that belong to an
// assignment. Unit-tested in tests/unit/lists.test.ts.
import { ASSIGNMENT_TYPE_LABELS, NO_CLASS_COLOR, resolveSettings } from '../../model/constants';
import type {
  Assignment,
  AssignmentType,
  CollectionName,
  DateStr,
  Id,
  Issue,
  LocalDateTimeStr,
  ScheduleDocument,
  SchoolClass,
  WorkStatus,
} from '../../model/types';
import { classColorMap } from '../../lib/calendar';
import { addDays, isValidLocalDateTime, ldtToMinutes, startOfWeek } from '../../lib/time';
import { deadlineDateOf, deadlineOf, progressByAssignment, type AssignmentProgress } from '../../lib/workload';

export type StatusFilter = 'open' | 'all' | WorkStatus;
export type GroupBy = 'deadline' | 'class';
/** Class filter value for assignments without a class. */
export const NO_CLASS = '__none__';

export interface AssignmentFilter {
  /** '' = all classes, NO_CLASS = no class, else a class id. */
  classId: string;
  status: StatusFilter;
  query: string;
  type: AssignmentType | '';
}

export const DEFAULT_FILTER: AssignmentFilter = { classId: '', status: 'open', query: '', type: '' };

export type DeadlineGroup = 'overdue' | 'thisWeek' | 'later' | 'noDate' | 'past' | 'done';

export const DEADLINE_GROUPS: DeadlineGroup[] = ['overdue', 'thisWeek', 'later', 'noDate', 'past', 'done'];

export const DEADLINE_GROUP_LABELS: Record<DeadlineGroup, string> = {
  overdue: 'Overdue',
  thisWeek: 'This week',
  later: 'Later',
  noDate: 'No date',
  past: 'Past, not counted',
  done: 'Done',
};

export const DEADLINE_GROUP_HINTS: Record<DeadlineGroup, string> = {
  overdue: 'The due date or assessment has passed and the work is not marked done.',
  thisWeek: 'Due or taking place by the end of this week.',
  later: 'Due after this week.',
  noDate: 'Work without a due date or assessment date.',
  past: 'The date has passed, but the work is optional or no longer in its source, so it is not counted as overdue.',
  done: 'Marked done or cancelled.',
};

export interface AssignmentRow {
  assignment: Assignment;
  schoolClass?: SchoolClass;
  color: string;
  progress: AssignmentProgress;
  /** The planning deadline (earlier of due and assessment), or null. */
  deadline: LocalDateTimeStr | null;
  /** The calendar date used for grouping, or null. */
  deadlineDate: DateStr | null;
  group: DeadlineGroup;
  /** Open issues about it (its own, its tasks', root issues about it, its tasks, blocks or sitting events). */
  openIssues: number;
}

export interface RowGroup {
  key: string;
  label: string;
  hint?: string;
  color?: string;
  rows: AssignmentRow[];
  /** Σ remaining minutes of the rows that count (§ 8.1). */
  remainingMinutes: number;
}

export function isClosed(assignment: Assignment): boolean {
  return assignment.status === 'done' || assignment.status === 'cancelled';
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function compareText(a: string, b: string): number {
  return a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });
}

function deadlineKey(row: AssignmentRow): number {
  return row.deadline && isValidLocalDateTime(row.deadline) ? ldtToMinutes(row.deadline) : Number.POSITIVE_INFINITY;
}

/** Soonest deadline first (undated last), then priority, title and id. */
export function compareRows(a: AssignmentRow, b: AssignmentRow): number {
  return (
    deadlineKey(a) - deadlineKey(b) ||
    (PRIORITY_RANK[a.assignment.priority ?? 'medium'] ?? 2) - (PRIORITY_RANK[b.assignment.priority ?? 'medium'] ?? 2) ||
    compareText(a.assignment.title, b.assignment.title) ||
    (a.assignment.id < b.assignment.id ? -1 : a.assignment.id > b.assignment.id ? 1 : 0)
  );
}

/** Most recent deadline first (for finished work). */
function compareRowsRecentFirst(a: AssignmentRow, b: AssignmentRow): number {
  const ka = deadlineKey(a);
  const kb = deadlineKey(b);
  if (ka !== kb) {
    if (ka === Number.POSITIVE_INFINITY) return 1;
    if (kb === Number.POSITIVE_INFINITY) return -1;
    return kb - ka;
  }
  return compareRows(a, b);
}

/** Which deadline group an assignment belongs to. */
export function deadlineGroupOf(
  assignment: Assignment,
  progress: AssignmentProgress,
  deadlineDate: DateStr | null,
  today: DateStr,
  weekEnd: DateStr,
): DeadlineGroup {
  if (isClosed(assignment)) return 'done';
  if (progress.overdue) return 'overdue';
  if (!deadlineDate) return 'noDate';
  if (deadlineDate < today) return 'past';
  if (deadlineDate <= weekEnd) return 'thisWeek';
  return 'later';
}

function isOpenIssue(issue: Issue): boolean {
  return (issue.status ?? 'open') === 'open';
}

/** Where an issue is stored, as needed to change its status. */
export type IssueHolder = { kind: 'item'; collection: CollectionName; id: Id } | { kind: 'task'; assignmentId: Id; taskId: Id } | { kind: 'root' };

export interface IssueEntry {
  issue: Issue;
  holder: IssueHolder;
  /** Index in the holder's `issues` array. */
  index: number;
  /** What the issue is about when it is not the item itself, e.g. "Subtask: Outline". */
  context?: string;
}

/** Ids of everything that belongs to an assignment: itself, its tasks, blocks and sitting events. */
function relatedIds(doc: ScheduleDocument, assignment: Assignment): Map<Id, string | undefined> {
  const ids = new Map<Id, string | undefined>([[assignment.id, undefined]]);
  for (const t of assignment.tasks || []) ids.set(t.id, `Subtask: ${t.title}`);
  for (const b of doc.scheduleBlocks) if (b.assignmentId === assignment.id) ids.set(b.id, 'A scheduled session');
  for (const e of doc.events) if (e.assignmentId === assignment.id) ids.set(e.id, `Event: ${e.title}`);
  return ids;
}

/** Every issue about an assignment: its own, its tasks', and root issues about it or its parts. */
export function assignmentIssues(doc: ScheduleDocument, assignment: Assignment): IssueEntry[] {
  const out: IssueEntry[] = [];
  (assignment.issues || []).forEach((issue, index) => out.push({ issue, index, holder: { kind: 'item', collection: 'assignments', id: assignment.id } }));
  for (const task of assignment.tasks || []) {
    (task.issues || []).forEach((issue, index) =>
      out.push({ issue, index, holder: { kind: 'task', assignmentId: assignment.id, taskId: task.id }, context: `Subtask: ${task.title}` }),
    );
  }
  const related = relatedIds(doc, assignment);
  (doc.issues || []).forEach((issue, index) => {
    if (issue.itemId && related.has(issue.itemId)) out.push({ issue, index, holder: { kind: 'root' }, context: related.get(issue.itemId) });
  });
  // Issues stored on the assignment's blocks and sitting events.
  for (const b of doc.scheduleBlocks) {
    if (b.assignmentId !== assignment.id) continue;
    (b.issues || []).forEach((issue, index) =>
      out.push({ issue, index, holder: { kind: 'item', collection: 'scheduleBlocks', id: b.id }, context: 'A scheduled session' }),
    );
  }
  for (const e of doc.events) {
    if (e.assignmentId !== assignment.id) continue;
    (e.issues || []).forEach((issue, index) =>
      out.push({ issue, index, holder: { kind: 'item', collection: 'events', id: e.id }, context: `Event: ${e.title}` }),
    );
  }
  return out;
}

/** Issues of a top-level item plus root issues whose itemId is that item. */
export function itemIssues(doc: ScheduleDocument, collection: CollectionName, item: { id: Id; issues?: Issue[] }): IssueEntry[] {
  const out: IssueEntry[] = (item.issues || []).map((issue, index) => ({ issue, index, holder: { kind: 'item', collection, id: item.id } }));
  (doc.issues || []).forEach((issue, index) => {
    if (issue.itemId === item.id) out.push({ issue, index, holder: { kind: 'root' } });
  });
  return out;
}

export function countOpen(entries: IssueEntry[]): number {
  return entries.filter((e) => isOpenIssue(e.issue)).length;
}

/** Today's date and the last day of the current week (settings.weekStartsOn). */
export function currentWeek(doc: ScheduleDocument, now: LocalDateTimeStr): { today: DateStr; weekStart: DateStr; weekEnd: DateStr } {
  const today = now.slice(0, 10);
  const weekStart = startOfWeek(today, resolveSettings(doc.settings).weekStartsOn === 'sunday' ? 'sunday' : 'monday');
  return { today, weekStart, weekEnd: addDays(weekStart, 6) };
}

/** One row per assignment (unfiltered, unsorted). */
export function buildRows(doc: ScheduleDocument, now: LocalDateTimeStr): AssignmentRow[] {
  const progress = progressByAssignment(doc, now);
  const classes = new Map(doc.classes.map((c) => [c.id, c] as const));
  const colors = classColorMap(doc);
  const { today, weekEnd } = currentWeek(doc, now);
  return doc.assignments.map((assignment) => {
    const p = progress.get(assignment.id)!;
    const deadlineDate = deadlineDateOf(assignment);
    const schoolClass = assignment.classId ? classes.get(assignment.classId) : undefined;
    return {
      assignment,
      schoolClass,
      color: schoolClass ? (colors.get(schoolClass.id) ?? NO_CLASS_COLOR) : NO_CLASS_COLOR,
      progress: p,
      deadline: deadlineOf(doc, assignment),
      deadlineDate,
      group: deadlineGroupOf(assignment, p, deadlineDate, today, weekEnd),
      openIssues: countOpen(assignmentIssues(doc, assignment)),
    };
  });
}

function haystack(row: AssignmentRow): string {
  const a = row.assignment;
  return [
    a.title,
    a.description,
    a.topic,
    a.notes,
    a.points,
    row.schoolClass?.name,
    ASSIGNMENT_TYPE_LABELS[a.type ?? 'homework'],
    ...(a.tasks || []).map((t) => t.title),
    ...(a.references || []).map((r) => r.title),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function matchesFilter(row: AssignmentRow, filter: AssignmentFilter): boolean {
  const a = row.assignment;
  if (filter.classId === NO_CLASS) {
    if (row.schoolClass) return false;
  } else if (filter.classId && a.classId !== filter.classId) return false;
  if (filter.status === 'open' && isClosed(a)) return false;
  if (filter.status !== 'open' && filter.status !== 'all' && (a.status ?? 'not_started') !== filter.status) return false;
  if (filter.type && (a.type ?? 'homework') !== filter.type) return false;
  const tokens = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const text = haystack(row);
    if (!tokens.every((t) => text.includes(t))) return false;
  }
  return true;
}

function remainingOf(rows: AssignmentRow[]): number {
  return rows.reduce((sum, r) => sum + (r.progress.counts ? (r.progress.remainingMinutes ?? 0) : 0), 0);
}

/** Group (and sort) rows by deadline group or by class. Empty groups are left out. */
export function groupRows(rows: AssignmentRow[], groupBy: GroupBy, classes: SchoolClass[] = []): RowGroup[] {
  if (groupBy === 'class') {
    const order = [...classes].sort((a, b) => compareText(a.name, b.name));
    const groups: RowGroup[] = [];
    const byClass = new Map<string, AssignmentRow[]>();
    for (const row of rows) {
      const key = row.schoolClass ? row.schoolClass.id : NO_CLASS;
      const list = byClass.get(key);
      if (list) list.push(row);
      else byClass.set(key, [row]);
    }
    const sortClassRows = (list: AssignmentRow[]) => {
      const open = list.filter((r) => !isClosed(r.assignment)).sort(compareRows);
      const closed = list.filter((r) => isClosed(r.assignment)).sort(compareRowsRecentFirst);
      return [...open, ...closed];
    };
    for (const c of order) {
      const list = byClass.get(c.id);
      if (!list) continue;
      groups.push({ key: c.id, label: c.name, color: list[0].color, rows: sortClassRows(list), remainingMinutes: remainingOf(list) });
    }
    const none = byClass.get(NO_CLASS);
    if (none) groups.push({ key: NO_CLASS, label: 'No class', rows: sortClassRows(none), remainingMinutes: remainingOf(none) });
    return groups;
  }
  return DEADLINE_GROUPS.map((key) => {
    const list = rows.filter((r) => r.group === key);
    list.sort(key === 'done' || key === 'past' ? compareRowsRecentFirst : compareRows);
    return { key, label: DEADLINE_GROUP_LABELS[key], hint: DEADLINE_GROUP_HINTS[key], rows: list, remainingMinutes: remainingOf(list) };
  }).filter((g) => g.rows.length > 0);
}

/** Every issue id in the document (to give a resolved issue a new unique id). */
export function issueIds(doc: ScheduleDocument): Set<string> {
  const ids = new Set<string>();
  const add = (issues: Issue[] | undefined) => issues?.forEach((i) => i.id && ids.add(i.id));
  add(doc.issues);
  for (const c of doc.classes) add(c.issues);
  for (const a of doc.assignments) {
    add(a.issues);
    for (const t of a.tasks || []) add(t.issues);
  }
  for (const e of doc.events) add(e.issues);
  for (const w of doc.availability) add(w.issues);
  for (const b of doc.scheduleBlocks) add(b.issues);
  return ids;
}
