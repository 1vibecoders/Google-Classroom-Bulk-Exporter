// Import preview and merge (SCHEDULE_FORMAT.md § 16). Pure functions: the
// preview never changes anything; applyImport returns a new document.
//
// How it works
// 1. analyze(): every item of the current schedule and of the file gets one
//    entry with its category (§ 16.2, checked in the spec's order) and the two
//    outcomes ("fates") its row switches between — e.g. "take the merged item"
//    / "keep the current one", "remove" / "keep", "add" / "skip". Tasks belong
//    to their assignment's entry (§ 16.2); the few task-level choices (your
//    own tasks, cancelled tasks, deleted tasks) are extra rows keyed
//    `tasks:<taskId>`. Additional rows (§ 16.2: "Removed from source",
//    "Kept (your version)" (b) and (c), "Settings") never move an item out of
//    its category.
// 2. build(): applies a selection. The outcome of every entry is computed, then
//    references are enforced until nothing changes: a file item whose class,
//    assignment or task is not in the result is not added (or keeps its
//    current version; its row then `follows` the row that decides it), and a
//    removal that something remaining still uses is cancelled. Then dependsOn
//    lists, root issues, issue IDs, tombstones,
//    settings and meta are finished. The result is what validateDocument
//    checks before "Import" is enabled (§ 16.1 step 5).
// 3. planImport(): analysis + the default build → rows with field-level
//    changes, summary counts and notes (summaryLines() renders them).
//    checkImport()/applyImport(): the same analysis + the person's selection.
//
// Everything is deterministic data processing; nothing in the file is ever
// evaluated or interpreted as code or markup.
import type {
  CollectionName,
  Issue,
  LocalDateTimeStr,
  RequestedChange,
  ScheduleDocument,
  Settings,
  Task,
  Tombstone,
  TombstoneCollection,
} from '../model/types';
import {
  ASSESSMENT_TYPES,
  ASSIGNMENT_TYPE_LABELS,
  BLOCK_STATUS_LABELS,
  COLLECTION_LABELS,
  DEFAULT_SETTINGS,
  EVENT_CATEGORY_LABELS,
  MAX_TOMBSTONES,
  PRIORITY_LABELS,
  SOURCE_KIND_LABELS,
  SOURCE_STATE_LABELS,
  WEEKDAYS,
  WEEKDAY_SHORT,
  WORK_STATUS_LABELS,
} from '../model/constants';
import {
  dateOf,
  daysBetween,
  formatDateOrDateTime,
  formatDateShort,
  formatDateWithWeekday,
  formatDuration,
  formatTime12,
  isValidDate,
  isValidDateOrDateTime,
  isValidLocalDateTime,
  ldtToMinutes,
  normalizeLocalDateTime,
  splitLocalDateTime,
} from './time';
import { validateDocument } from './validate';

// ===========================================================================
// Public types
// ===========================================================================

export type ChangeCategory =
  /** File item whose id is not in the current schedule (and not one of the next two cases): added. Not selectable. */
  | 'new'
  /**
   * Same id, current item `generated`/`planner` and unlocked, and the merged item (§ 16.3) differs from it:
   * the merged item replaces the current one. Not selectable, except when the merged schedule would be
   * invalid because of this update (§ 16.1 step 5): then `selectable` is true so it can be unticked.
   */
  | 'updated'
  /** Same id and the merged item equals the current item (§ 16.5): nothing happens. */
  | 'unchanged'
  /**
   * "Kept (your version)": (a) a protected current item (user/locked) that the file has in a different version
   * (selectable: ticking takes the file's version), or a done/skipped block the file changes (shown only, not
   * selectable: history); (b) aspect 'status': the current status is cancelled and the file has another status;
   * (c) aspect 'deletedInFile': a current item that the file's `deleted` list names. Default: not ticked.
   */
  | 'kept'
  /** "Changes to your items": a protected item listed in meta.requestedChanges, changed or removed by the file. Pre-ticked when requestedByPerson. */
  | 'yourItems'
  /** File item whose id (or source id) is in the current `deleted` tombstones: not restored unless ticked. */
  | 'previouslyDeleted'
  /** New file item that matches a current item under § 15.3 rule 2 or 3: not added unless ticked. */
  | 'possibleDuplicate'
  /** Assignment whose sourceState changes from present to missing/withdrawn (aspect 'sourceState'): applied by default. */
  | 'removedFromSource'
  /** "Not in this file": current generated/planner, unlocked item absent from the file: kept unless ticked (ticking removes it). */
  | 'missing'
  /** "Outdated planned work" (files with meta.basedOn only): future planned block the file re-planned: removed unless unticked. */
  | 'outdated'
  /** "Always kept": current item absent from the file that an import never removes (user, locked, done, past). */
  | 'protected'
  /** A setting whose value differs: current kept unless the file's value is ticked. */
  | 'setting';

/** Coarse kind of a field change, for summaries like "~ 2 due dates ~ 1 workload estimate". */
export type FieldGroup = 'dueDate' | 'estimate' | 'sessionTime' | 'eventTime' | 'tasks' | 'title' | 'status' | 'details';

export interface FieldChange {
  /** Field name (`start` stands for start+end of a block, `startTime` for startTime+endTime; `tasks.<field>` for a task's field). */
  field: string;
  /** Human-readable before/after, e.g. "Oct 16, 11:59 PM" → "Oct 17, 11:59 PM"; "—" means absent. */
  before: string;
  after: string;
  /** Display name, e.g. "Due date", "Workload estimate", "Task “Draft” · Due date". Always set by planImport. */
  label?: string;
  /** Summary group. Always set by planImport. */
  group?: FieldGroup;
  /** Set when the change concerns one task of the assignment. */
  taskId?: string;
}

/** An item that is added, kept or removed together with a row (shown in the same row, § 16.1). */
export interface IncludedItem {
  key: string;
  collection: CollectionName;
  id: string;
  label: string;
}

/** Which aspect of the item a row is about. */
export type ChangeAspect = 'item' | 'sourceState' | 'status' | 'deletedInFile' | 'setting';

export interface ImportChange {
  /**
   * Stable key for UI choices: `${collection}:${id}` for an item; `${collection}:${id}#sourceState`,
   * `#status` or `#deleted` for its additional rows; `tasks:<taskId>` (+ `#status`, `#deleted`) for task
   * rows; `settings:<name>` for settings. (`#` never occurs in IDs.)
   */
  key: string;
  collection: CollectionName | 'settings';
  /** Item id (the task id for task rows), or the setting name. */
  id: string;
  category: ChangeCategory;
  /** Display label, e.g. assignment title or "Tue, Oct 13, 4:30–5:20 PM · Othello Essay / Draft". */
  label: string;
  /** For updated/kept/yourItems rows: what differs (person-owned values the merge keeps are not listed). */
  fields: FieldChange[];
  /**
   * Whether the change is acted on by default. Selectable rows: whether pre-ticked (kept/yourItems/
   * previouslyDeleted/possibleDuplicate/setting: take the file's version; missing/outdated/kept (c):
   * remove the current item; removedFromSource: apply). Non-selectable rows: true when the change is
   * always applied (new/updated/unchanged/protected), false when it is never applied (blocked removals,
   * done/skipped blocks the file changes).
   */
  defaultSelected: boolean;
  /** Whether the person can toggle this change in the preview. */
  selectable: boolean;
  /** Why it is in this category, in plain language. */
  reason?: string;
  /** Default 'item'. */
  aspect?: ChangeAspect;
  /** Task rows: the assignment the task belongs to (collection is then 'assignments' and id the task id). */
  parentId?: string;
  /** A one-line description of the item, e.g. "English 10 · Due Oct 16, 11:59 PM · 4 h · 4 tasks". */
  detail?: string;
  /** Ticking this row removes the current item (missing, outdated, removals under yourItems, kept (c)). */
  removes?: boolean;
  /** yourItems rows: meta.requestedChanges[].requestedByPerson. */
  requestedByPerson?: boolean;
  /** possibleDuplicate: the current item it looks like. */
  relatedId?: string;
  /**
   * Items that follow this row's choice and are shown in it: file items added (or updated) only when
   * the row's item is added/taken; current items removed together with it; for removedFromSource the
   * "Outdated planned work" rows of the assignment's blocks (unticking it keeps them too).
   */
  includes?: IncludedItem[];
  /** Why this row cannot be ticked (e.g. "3 of your own assignments use this class"). */
  blockedReason?: string;
  /** Problems of the merged schedule (§ 16.1 step 5) caused by this row, with the default selection. */
  problems?: string[];
  /** A block the preview would move or remove that already ended at the import time: "This session has passed — did you do it?" */
  passed?: boolean;
  /** Settings: the current schedule never set this setting (it uses the default). */
  neverSet?: boolean;
  /** The file's `deleted` list names this current item. */
  deletedInFile?: boolean;
  /**
   * The key of the row whose choice decides this one: the item needs an item (class, assignment or task) that
   * the default selection does not import, so it is added (or updated) only when that row is ticked (§ 16.1).
   * Such a row is listed in the other row's `includes`; when it is not selectable its defaultSelected is false
   * and it is not counted in `summary`.
   */
  follows?: string;
}

export interface FieldSummaryEntry {
  group: FieldGroup;
  /** Number of updated items with at least one change in this group. */
  count: number;
  /** e.g. "2 due dates", "1 workload estimate". */
  text: string;
}

export interface ImportProblem {
  /** The row the problem belongs to, when it can be attributed to one. */
  key?: string;
  /** Path in the merged document, e.g. `assignments[3].recommendedCompletionDate`. */
  path: string;
  message: string;
}

export interface ImportPlan {
  changes: ImportChange[];
  /** Counts of rows per category per collection, for the summary (task rows and rows that follow another row excluded). */
  summary: Record<ChangeCategory, Partial<Record<CollectionName | 'settings', number>>>;
  /** Blocking problems found while comparing (e.g. ID used by a different collection). Nothing can be imported. */
  errors: string[];
  /** Non-blocking notes (stale basedOn, fresh file, settings, …). */
  notes: string[];
  /** True when applying the default selection would change nothing (re-import of the same file). */
  noChanges: boolean;
  settingsChanged: boolean;
  /** "Now" for past/future decisions: the file's meta.generatedAt, else the import time (§ 16.1). */
  referenceTime?: LocalDateTimeStr;
  /** The import time passed to planImport. */
  importTime?: LocalDateTimeStr;
  /** The file has no meta.basedOn (made without the current schedule): no "Outdated planned work". */
  fresh?: boolean;
  /** meta.basedOn is not the website's most recent export ID (only known when knownExportIds was given). */
  staleBasedOn?: boolean;
  /** The file's meta.timezone, if any (shown in the preview; not stored, § 16.6). */
  fileTimezone?: string;
  /** Counts of task rows per category. */
  taskSummary?: Partial<Record<ChangeCategory, number>>;
  /** What the updated items change, e.g. [{group:'dueDate', count: 2, text: '2 due dates'}]. */
  fieldSummary?: FieldSummaryEntry[];
  /** Changes outside the item rows: root issues, deleted-item records, schedule title and sources. */
  otherChanges?: string[];
  /** Validation problems of the merged schedule with the default selection (§ 16.1 step 5). */
  problems?: ImportProblem[];
}

export interface ImportOptions {
  /**
   * The website's recent `meta.exportId` values, most recent first (exportSchedule.recentExportIds()).
   * When given, a file whose meta.basedOn is not the first one gets the "older export" note (§ 16.1).
   */
  knownExportIds?: readonly string[];
  /**
   * The device's IANA time zone (Intl.DateTimeFormat().resolvedOptions().timeZone). When given and the file's
   * meta.timezone is a different zone, the plan gets a note: times are wall-clock times and are not converted (§ 4).
   */
  timezone?: string;
}

export interface ImportCheck {
  /** The merged schedule for this selection (the same document applyImport returns). */
  doc: ScheduleDocument;
  /** The merged schedule passes validateDocument: "Import" may be enabled. */
  ok: boolean;
  problems: ImportProblem[];
  /** Choices that could not be carried out as selected (e.g. a removal still used by a kept item). */
  skipped: Array<{ key: string; label: string; reason: string }>;
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Compare the current document with a validated incoming document.
 * "Future" is relative to the incoming file's meta.generatedAt when present,
 * else `now` (SCHEDULE_FORMAT.md § 16): past = end ≤ t, future = start ≥ t,
 * in progress counts as past.
 */
export function planImport(
  current: ScheduleDocument,
  incoming: ScheduleDocument,
  now: LocalDateTimeStr,
  options: ImportOptions = {},
): ImportPlan {
  const an = analyze(current, incoming, now, undefined, options);
  if (an.errors.length) return errorPlan(an);
  const sel = specSel(an);
  const base = build(an, sel);
  finalize(an, base, sel);

  const rows = makeRows(an, base);
  const problems = validateResult(an, base.doc);
  attachProblems(rows, problems);

  const summary = emptySummary();
  const taskSummary: Partial<Record<ChangeCategory, number>> = {};
  for (const row of rows) {
    // Items that follow another row's choice are shown (and counted) in that row (§ 16.1).
    if (row.follows && !row.selectable) continue;
    if (row.parentId) taskSummary[row.category] = (taskSummary[row.category] ?? 0) + 1;
    else summary[row.category][row.collection] = (summary[row.category][row.collection] ?? 0) + 1;
  }

  const otherChanges = describeOtherChanges(an, base.doc);
  const notes = makeNotes(an, base, problems, options);
  return {
    changes: rows,
    summary,
    errors: [],
    notes,
    noChanges: docSignature(current) === docSignature(base.doc),
    settingsChanged: an.settingNames.length > 0,
    referenceTime: an.t,
    importTime: an.now,
    fresh: an.fresh,
    staleBasedOn: an.staleBasedOn,
    fileTimezone: incoming.meta?.timezone,
    taskSummary,
    fieldSummary: fieldSummary(rows),
    otherChanges,
    problems,
  };
}

/**
 * Apply an import. `selected` holds the keys of selectable changes the person
 * wants acted on (see ImportChange.defaultSelected and defaultSelection());
 * non-selectable changes follow their defaultSelected. Person-owned fields
 * (status never regresses, notes, overrides, issue status, cancelled) are
 * preserved per § 16.3; `deleted` tombstones are unioned; settings change
 * only where selected. Use checkImport() first to know whether the result is
 * valid (§ 16.1 step 5). Throws when the plan has errors.
 */
export function applyImport(
  current: ScheduleDocument,
  incoming: ScheduleDocument,
  plan: ImportPlan,
  selected: Set<string>,
  now: LocalDateTimeStr,
): ScheduleDocument {
  const an = analyze(current, incoming, now, plan.referenceTime, {});
  if (an.errors.length) throw new Error(an.errors.join('\n'));
  return build(an, planSel(an, plan, selected)).doc;
}

/**
 * Build the merged schedule for a selection and validate it with every rule of
 * § 13 (§ 16.1 step 5): "Import" is enabled only when `ok`. Problems carry the
 * key of the row they belong to when possible.
 */
export function checkImport(
  current: ScheduleDocument,
  incoming: ScheduleDocument,
  plan: ImportPlan,
  selected: Set<string>,
  now: LocalDateTimeStr,
): ImportCheck {
  const an = analyze(current, incoming, now, plan.referenceTime, {});
  if (an.errors.length) {
    return { doc: current, ok: false, problems: an.errors.map((message) => ({ path: '', message })), skipped: [] };
  }
  const res = build(an, planSel(an, plan, selected));
  const problems = validateResult(an, res.doc);
  const rows = new Map(plan.changes.map((c) => [c.key, c]));
  const skipped = [...res.adjustments]
    // An item that waits for another row's choice (ImportChange.follows), e.g. an assignment of a class the
    // person deleted, is not a choice of its own: its row already says which row decides it. Only report it
    // when the person ticked its own row.
    .filter(([key]) => !res.needs.has(key) || (rows.get(key)?.selectable === true && selected.has(key)))
    .map(([key, reason]) => {
      const e = an.entryByKey.get(key);
      return { key, label: e ? entryLabel(an, e) : key, reason };
    });
  return { doc: res.doc, ok: problems.length === 0, problems, skipped };
}

/** The keys that are ticked by default: selectable rows whose defaultSelected is true. */
export function defaultSelection(plan: ImportPlan): Set<string> {
  return new Set(plan.changes.filter((c) => c.selectable && c.defaultSelected).map((c) => c.key));
}

/** Display names of the categories (SCHEDULE_FORMAT.md § 16.2). */
export const CATEGORY_LABELS: Record<ChangeCategory, string> = {
  new: 'New',
  updated: 'Updated',
  unchanged: 'Unchanged',
  kept: 'Kept (your version)',
  yourItems: 'Changes to your items',
  previouslyDeleted: 'Previously deleted',
  possibleDuplicate: 'Possible duplicate',
  removedFromSource: 'Removed from source',
  missing: 'Not in this file',
  outdated: 'Outdated planned work',
  protected: 'Always kept',
  setting: 'Settings',
};

export interface SummaryLine {
  category: ChangeCategory;
  /** CATEGORY_LABELS[category]. */
  label: string;
  /** e.g. ["+ 3 assignments", "+ 8 scheduled work blocks"], ["~ 2 due dates", "~ 1 workload estimate"], ["24 items"]. */
  parts: string[];
  /** e.g. "New: + 3 assignments  + 8 scheduled work blocks". */
  text: string;
}

/**
 * The preview's summary, one line per category that has rows, in the order of
 * the preview (new and updated first, unchanged last), e.g.
 * "New: + 3 assignments  + 8 scheduled work blocks",
 * "Updated: ~ 2 due dates  ~ 1 workload estimate", "Unchanged: 24 items".
 * Task rows are counted as tasks; rows that follow another row are left out.
 */
export function summaryLines(plan: ImportPlan): SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const category of CATEGORIES) {
    const counts = plan.summary[category] ?? {};
    const tasks = plan.taskSummary?.[category] ?? 0;
    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) + tasks;
    if (!total) continue;
    let parts: string[];
    if (category === 'unchanged' || category === 'protected') parts = [plural(total, 'item', 'items')];
    else if (category === 'updated' && plan.fieldSummary?.length) parts = plan.fieldSummary.map((f) => `~ ${f.text}`);
    else {
      parts = formatCounts(counts);
      if (tasks) parts.push(plural(tasks, 'task', 'tasks'));
      const sign = category === 'new' ? '+ ' : category === 'updated' ? '~ ' : category === 'outdated' ? '− ' : '';
      parts = parts.map((p) => `${sign}${p}`);
    }
    const label = CATEGORY_LABELS[category];
    lines.push({ category, label, parts, text: `${label}: ${parts.join('  ')}` });
  }
  return lines;
}

/** Counts as text, e.g. { assignments: 3, scheduleBlocks: 8 } → ["3 assignments", "8 scheduled work blocks"]. */
export function formatCounts(counts: Partial<Record<CollectionName | 'settings', number>>): string[] {
  const out: string[] = [];
  for (const c of [...COLLECTION_ORDER, 'settings'] as Array<CollectionName | 'settings'>) {
    const n = counts[c];
    if (!n) continue;
    const words = c === 'settings' ? { one: 'setting', many: 'settings' } : COLLECTION_LABELS[c];
    out.push(`${n} ${n === 1 ? words.one : words.many}`);
  }
  return out;
}

// ===========================================================================
// Internal model
// ===========================================================================

type Obj = Record<string, unknown>;
type Item = Obj & { id: string };
type Fate = 'add' | 'skip' | 'take' | 'keep' | 'remove';
type TakeMode = 'merge' | 'take' | 'pastBlock';
type Sel = (key: string) => boolean;
type ItemCollection = CollectionName | 'tasks';

const COLLECTION_ORDER: CollectionName[] = ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'];
const CATEGORIES: ChangeCategory[] = [
  'new',
  'updated',
  'removedFromSource',
  'yourItems',
  'previouslyDeleted',
  'possibleDuplicate',
  'outdated',
  'missing',
  'kept',
  'setting',
  'protected',
  'unchanged',
];
const SETTING_NAMES: Array<keyof Settings> = [
  'weekStartsOn',
  'dayStartTime',
  'dayEndTime',
  'defaultDueTime',
  'minSessionMinutes',
  'maxSessionMinutes',
  'breakMinutes',
  'maxDailyStudyMinutes',
];

interface RowSpec {
  selectable: boolean;
  defaultOn: boolean;
  blockedReason?: string;
}

interface RequestedInfo {
  reason: string;
  byPerson: boolean;
}

interface Entry {
  key: string;
  collection: CollectionName;
  id: string;
  cur?: Item;
  file?: Item;
  category: ChangeCategory;
  /** Row switching between onFate (ticked) and offFate; absent: always onFate. */
  rowKey?: string;
  onFate: Fate;
  offFate: Fate;
  takeMode?: TakeMode;
  /** Outdated block: also requires this removedFromSource row. */
  linkedTo?: string;
  sourceStateRow?: string;
  statusRow?: string;
  /** Kept (c) row of a protected item named by the file's `deleted`. */
  deletedRow?: string;
  deletedInFile?: boolean;
  /** Entry keys removed together with this one. */
  removalGroup: string[];
  requested?: RequestedInfo;
  matched?: { item: Item; why: string };
  /** previouslyDeleted: the current tombstones that match. */
  tombstones: Tombstone[];
  /** The version shown in the preview: merged item, or the file's version to take. */
  preview?: Obj;
}

interface TaskRow {
  key: string;
  entryKey: string;
  assignmentId: string;
  taskId: string;
  aspect: 'item' | 'status' | 'deletedInFile';
  category: ChangeCategory;
  cur?: Task;
  file?: Task;
  removes: boolean;
  requested?: RequestedInfo;
  reason: string;
  dropped?: boolean;
}

interface Names {
  cls: Map<string, string>;
  asg: Map<string, string>;
  task: Map<string, string>;
}

interface Located {
  collection: CollectionName;
  item: Item;
}

interface Analysis {
  now: string;
  t: string;
  tMin: number;
  nowMin: number;
  year: number;
  current: ScheduleDocument;
  incoming: ScheduleDocument;
  errors: string[];
  fresh: boolean;
  staleBasedOn: boolean;
  entries: Entry[];
  byCollection: Map<CollectionName, Entry[]>;
  entryByKey: Map<string, Entry>;
  entryById: Map<string, Entry>;
  taskRows: TaskRow[];
  specs: Map<string, RowSpec>;
  requested: Map<string, RequestedChange>;
  curTop: Map<string, Located>;
  curTasks: Map<string, { assignmentId: string; task: Task }>;
  fileTop: Map<string, Located>;
  fileTasks: Map<string, { assignmentId: string; task: Task }>;
  curTombById: Map<string, Tombstone>;
  curTombBySource: Map<string, Tombstone[]>;
  fileTombById: Map<string, Tombstone>;
  decided: Map<string, Issue>;
  fileIssueIds: Set<string>;
  fileHasGeneratedBlock: boolean;
  curRefIndex: Map<string, Array<{ key: string; field: string }>>;
  /** Lazily built lookups for possible duplicates, per collection. */
  dupIndexes: Map<CollectionName, DupIndex>;
  fileRefIndex: Map<string, string[]>;
  names: Names;
  settingNames: Array<keyof Settings>;
  unknownRequests: RequestedChange[];
}

// ===========================================================================
// Small helpers
// ===========================================================================

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep copy of plain JSON data (undefined properties dropped). */
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((x) => clone(x)) as unknown as T;
  if (isObj(value)) {
    const out: Obj = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (v !== undefined) out[key] = clone(v);
    }
    return out as T;
  }
  return value;
}

/** Set a field, or delete it when the value is absent or an empty array. */
function setOrDelete(obj: Obj, key: string, value: unknown): void {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) delete obj[key];
  else obj[key] = value;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function text(value: unknown): string | undefined {
  return nonEmptyText(value) ? value.trim() : undefined;
}

function isLdt(value: unknown): value is string {
  return typeof value === 'string' && isValidLocalDateTime(value);
}

function canonLdt(value: string): string {
  return isValidLocalDateTime(value) ? normalizeLocalDateTime(value) : value;
}

function truncate(value: string, max: number): string {
  const chars = Array.from(value.replace(/\s+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}

function itemsOf(doc: ScheduleDocument, c: CollectionName): Item[] {
  const list = (doc as unknown as Obj)[c];
  return Array.isArray(list) ? (list as Item[]) : [];
}

function tasksOf(item: unknown): Task[] {
  return isObj(item) && Array.isArray(item.tasks) ? (item.tasks as Task[]) : [];
}

function issuesOf(item: unknown): Issue[] {
  return isObj(item) && Array.isArray(item.issues) ? (item.issues as Issue[]) : [];
}

function overridesOf(item: unknown): string[] {
  return isObj(item) && Array.isArray(item.overrides) ? (item.overrides as string[]) : [];
}

function originOf(item: Obj): string {
  return typeof item.origin === 'string' ? item.origin : 'generated';
}

/** § 6: origin "user" or locked. */
function isProtected(item: Obj): boolean {
  return item.origin === 'user' || item.locked === true;
}

function isDoneOrSkipped(block: Obj): boolean {
  return block.status === 'done' || block.status === 'skipped';
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function withArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}

function ctxOf(c: ItemCollection): NCtx {
  switch (c) {
    case 'classes':
      return 'class';
    case 'assignments':
      return 'assignment';
    case 'tasks':
      return 'task';
    case 'events':
      return 'event';
    case 'availability':
      return 'availability';
    default:
      return 'block';
  }
}

// ===========================================================================
// Normalized comparison (§ 16.5, D20)
// ===========================================================================

type NCtx = 'class' | 'assignment' | 'task' | 'event' | 'availability' | 'block' | 'issue' | 'reference' | 'recurrence' | 'other';

/** Defaults filled in before comparing (§ 16.5). */
const NORM_DEFAULTS: Partial<Record<NCtx, Obj>> = {
  class: { origin: 'generated', locked: false, archived: false },
  assignment: {
    origin: 'generated',
    locked: false,
    type: 'homework',
    priority: 'medium',
    status: 'not_started',
    required: true,
    sourceState: 'present',
  },
  task: { origin: 'generated', locked: false, status: 'not_started', required: true },
  event: { origin: 'generated', locked: false, category: 'other', allDay: false, busy: true },
  availability: { origin: 'generated', locked: false },
  block: { origin: 'generated', locked: false, kind: 'work', status: 'planned' },
  issue: { status: 'open' },
  reference: { kind: 'attachment', required: false },
  recurrence: { interval: 1 },
};
const CHILD_CTX: Record<string, NCtx> = { tasks: 'task', issues: 'issue', references: 'reference', recurrence: 'recurrence' };
/** Arrays whose order carries no meaning. */
const SET_LIKE = new Set(['overrides', 'dependsOn', 'exceptDates', 'daysOfWeek']);
const LDT_MINUTE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2})?$/;

function norm(value: unknown, ctx: NCtx): unknown {
  if (typeof value === 'string') {
    const s = value.trim();
    const m = LDT_MINUTE.exec(s);
    return m ? m[1] : s;
  }
  if (Array.isArray(value)) return value.map((x) => norm(x, ctx));
  if (isObj(value)) {
    const out: Obj = {};
    for (const key of Object.keys(value)) {
      const v = value[key];
      if (v === undefined) continue;
      if (key.startsWith('x-')) {
        out[key] = canonJson(v);
        continue;
      }
      const n = normField(key, v);
      if (n !== undefined) out[key] = n;
    }
    const defaults = NORM_DEFAULTS[ctx];
    if (defaults) for (const [k, d] of Object.entries(defaults)) if (!(k in out)) out[k] = d;
    return out;
  }
  return value;
}

function normField(key: string, value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const items = value.map((x) => norm(x, CHILD_CTX[key] ?? 'other'));
    if (SET_LIKE.has(key)) {
      if (key === 'daysOfWeek') items.sort((a, b) => WEEKDAYS.indexOf(a as never) - WEEKDAYS.indexOf(b as never));
      else items.sort((a, b) => (stable(a) < stable(b) ? -1 : stable(a) > stable(b) ? 1 : 0));
    }
    return items;
  }
  if (isObj(value)) return norm(value, CHILD_CTX[key] ?? 'other');
  return norm(value, 'other');
}

/** Opaque `x-…` values: only the order of object keys is ignored. */
function canonJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonJson);
  if (isObj(value)) {
    const out: Obj = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canonJson(value[key]);
    return out;
  }
  return value;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (isObj(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

function sameItem(c: ItemCollection, a: unknown, b: unknown): boolean {
  return stable(norm(a, ctxOf(c))) === stable(norm(b, ctxOf(c)));
}

/** A signature of everything an import can change (§ 16.6 meta: title and sources only). */
function docSignature(doc: ScheduleDocument): string {
  const parts: Obj = {};
  for (const c of COLLECTION_ORDER) {
    parts[c] = itemsOf(doc, c)
      .map((item) => [String(item.id), stable(norm(item, ctxOf(c)))])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  }
  parts.settings = stable(norm(doc.settings ?? {}, 'other'));
  parts.issues = (doc.issues ?? []).map((i) => stable(norm(i, 'issue')));
  parts.deleted = (doc.deleted ?? []).map((t) => stable(norm(t, 'other'))).sort();
  const meta = (doc.meta ?? {}) as Obj;
  const metaPart: Obj = { title: text(meta.title), sources: norm(meta.sources ?? [], 'other') };
  for (const k of Object.keys(meta)) if (k.startsWith('x-')) metaPart[k] = canonJson(meta[k]);
  parts.meta = metaPart;
  const root = doc as unknown as Obj;
  for (const k of Object.keys(root)) if (k.startsWith('x-')) parts[k] = canonJson(root[k]);
  return stable(parts);
}

// ===========================================================================
// Analysis
// ===========================================================================

function indexDoc(doc: ScheduleDocument): { top: Map<string, Located>; tasks: Map<string, { assignmentId: string; task: Task }> } {
  const top = new Map<string, Located>();
  const tasks = new Map<string, { assignmentId: string; task: Task }>();
  for (const c of COLLECTION_ORDER) {
    for (const item of itemsOf(doc, c)) {
      if (!top.has(item.id)) top.set(item.id, { collection: c, item });
      if (c === 'assignments') for (const t of tasksOf(item)) if (!tasks.has(t.id)) tasks.set(t.id, { assignmentId: item.id, task: t });
    }
  }
  return { top, tasks };
}

function forEachIssue(doc: ScheduleDocument, fn: (issue: Issue) => void): void {
  for (const i of doc.issues ?? []) fn(i);
  for (const c of COLLECTION_ORDER) {
    for (const item of itemsOf(doc, c)) {
      for (const i of issuesOf(item)) fn(i);
      if (c === 'assignments') for (const t of tasksOf(item)) for (const i of issuesOf(t)) fn(i);
    }
  }
}

function isDecided(issue: Issue): boolean {
  return issue.status === 'resolved' || issue.status === 'dismissed';
}

function sourceIdsOf(item: Obj): string[] {
  const out: string[] = [];
  const sources = [item.source, ...(Array.isArray(item.sources) ? item.sources : [])];
  for (const s of sources) if (isObj(s) && typeof s.id === 'string') out.push(s.id);
  return out;
}

function analyze(
  current: ScheduleDocument,
  incoming: ScheduleDocument,
  now: LocalDateTimeStr,
  referenceTime: LocalDateTimeStr | undefined,
  options: ImportOptions,
): Analysis {
  const nowC = canonLdt(now);
  const generatedAt = incoming.meta?.generatedAt;
  const t =
    referenceTime && isValidLocalDateTime(referenceTime)
      ? canonLdt(referenceTime)
      : generatedAt && isValidLocalDateTime(generatedAt)
        ? canonLdt(generatedAt)
        : nowC;
  const cur = indexDoc(current);
  const file = indexDoc(incoming);
  const basedOn = incoming.meta?.basedOn;
  const known = options.knownExportIds;
  const an: Analysis = {
    now: nowC,
    t,
    tMin: ldtToMinutes(t),
    nowMin: ldtToMinutes(nowC),
    year: Number(nowC.slice(0, 4)),
    current,
    incoming,
    errors: [],
    fresh: !basedOn,
    staleBasedOn: !!basedOn && !!known && known[0] !== basedOn,
    entries: [],
    byCollection: new Map(COLLECTION_ORDER.map((c) => [c, [] as Entry[]])),
    entryByKey: new Map(),
    entryById: new Map(),
    taskRows: [],
    specs: new Map(),
    requested: new Map((incoming.meta?.requestedChanges ?? []).map((r) => [r.id, r])),
    curTop: cur.top,
    curTasks: cur.tasks,
    fileTop: file.top,
    fileTasks: file.tasks,
    curTombById: new Map((current.deleted ?? []).map((tomb) => [tomb.id, tomb])),
    curTombBySource: new Map(),
    fileTombById: new Map((incoming.deleted ?? []).map((tomb) => [tomb.id, tomb])),
    decided: new Map(),
    fileIssueIds: new Set(),
    fileHasGeneratedBlock: incoming.scheduleBlocks.some((b) => originOf(b as unknown as Obj) === 'generated'),
    curRefIndex: new Map(),
    dupIndexes: new Map(),
    fileRefIndex: new Map(),
    names: buildNames(current, incoming),
    settingNames: [],
    unknownRequests: [],
  };

  checkIds(an);
  if (an.errors.length) return an;

  for (const tomb of current.deleted ?? []) {
    if (!tomb.sourceId) continue;
    pushTo(an.curTombBySource, `${tomb.collection}\u0000${tomb.sourceId}`, tomb);
  }
  forEachIssue(current, (i) => {
    if (i.id && isDecided(i)) an.decided.set(i.id, i);
  });
  forEachIssue(incoming, (i) => {
    if (i.id) an.fileIssueIds.add(i.id);
  });
  buildRefIndexes(an);

  for (const c of COLLECTION_ORDER) {
    const list = an.byCollection.get(c)!;
    for (const item of itemsOf(current, c)) {
      const f = an.fileTop.get(item.id);
      list.push(f ? inBothEntry(an, c, item, f.item) : currentOnlyEntry(an, c, item));
    }
    for (const item of itemsOf(incoming, c)) if (!an.curTop.has(item.id)) list.push(fileOnlyEntry(an, c, item));
    for (const e of list) {
      an.entries.push(e);
      an.entryByKey.set(e.key, e);
      an.entryById.set(e.id, e);
    }
  }

  // Outdated blocks of an assignment that is "Removed from source" follow that row (§ 16.2).
  for (const e of an.byCollection.get('scheduleBlocks')!) {
    if (e.category !== 'outdated' || typeof e.cur?.assignmentId !== 'string') continue;
    const asg = an.entryById.get(e.cur.assignmentId);
    if (asg?.sourceStateRow) e.linkedTo = asg.sourceStateRow;
  }

  computeRemovalGroups(an);

  for (const name of SETTING_NAMES) {
    if (settingValue(current.settings, name) !== settingValue(incoming.settings, name)) {
      an.settingNames.push(name);
      an.specs.set(`settings:${name}`, { selectable: true, defaultOn: false });
    }
  }

  for (const r of incoming.meta?.requestedChanges ?? []) {
    if (!an.curTop.has(r.id) && !an.curTasks.has(r.id) && !an.fileTop.has(r.id) && !an.fileTasks.has(r.id)) an.unknownRequests.push(r);
  }
  return an;
}

function buildNames(current: ScheduleDocument, incoming: ScheduleDocument): Names {
  const names: Names = { cls: new Map(), asg: new Map(), task: new Map() };
  for (const doc of [current, incoming]) {
    for (const c of doc.classes) names.cls.set(c.id, c.name);
    for (const a of doc.assignments) {
      names.asg.set(a.id, a.title);
      for (const t of a.tasks ?? []) names.task.set(t.id, t.title);
    }
  }
  return names;
}

function itemTitle(c: ItemCollection, item: Obj): string {
  return text(item.name) ?? text(item.title) ?? text(item.label) ?? (c === 'scheduleBlocks' ? 'scheduled work block' : String(item.id));
}

function checkIds(an: Analysis): void {
  const one = (c: CollectionName) => COLLECTION_LABELS[c].one;
  for (const [id, f] of an.fileTop) {
    const c = an.curTop.get(id);
    if (c && c.collection !== f.collection) {
      an.errors.push(
        `The file's ${one(f.collection)} “${itemTitle(f.collection, f.item)}” uses the ID “${id}”, which is ${withArticle(one(c.collection))} in your schedule (“${itemTitle(c.collection, c.item)}”). An ID always names the same item, so this file can't be imported.`,
      );
    }
    const ct = an.curTasks.get(id);
    if (ct) {
      an.errors.push(
        `The file's ${one(f.collection)} “${itemTitle(f.collection, f.item)}” uses the ID “${id}”, which is a task in your schedule (“${ct.task.title}”). An ID always names the same item, so this file can't be imported.`,
      );
    }
  }
  for (const [id, ft] of an.fileTasks) {
    const c = an.curTop.get(id);
    if (c) {
      an.errors.push(
        `The file's task “${ft.task.title}” uses the ID “${id}”, which is ${withArticle(one(c.collection))} in your schedule (“${itemTitle(c.collection, c.item)}”). An ID always names the same item, so this file can't be imported.`,
      );
    }
    const ct = an.curTasks.get(id);
    if (ct && ct.assignmentId !== ft.assignmentId) {
      const fileAsg = an.fileTop.get(ft.assignmentId);
      const curAsg = an.curTop.get(ct.assignmentId);
      an.errors.push(
        `The file puts the task “${ft.task.title}” (ID “${id}”) under the assignment “${fileAsg ? itemTitle('assignments', fileAsg.item) : ft.assignmentId}”, but in your schedule it belongs to “${curAsg ? itemTitle('assignments', curAsg.item) : ct.assignmentId}”. A task never moves to another assignment (SCHEDULE_FORMAT.md § 16.2), so this file can't be imported. The program that wrote the file should cancel the old task and create a new one instead.`,
      );
    }
  }
}

function buildRefIndexes(an: Analysis): void {
  const addCur = (target: unknown, key: string, field: string) => {
    if (typeof target === 'string') pushTo(an.curRefIndex, target, { key, field });
  };
  for (const a of an.current.assignments) addCur(a.classId, `assignments:${a.id}`, 'classId');
  for (const e of an.current.events) {
    addCur(e.classId, `events:${e.id}`, 'classId');
    addCur(e.assignmentId, `events:${e.id}`, 'assignmentId');
  }
  for (const b of an.current.scheduleBlocks) addCur(b.assignmentId, `scheduleBlocks:${b.id}`, 'assignmentId');

  const addFile = (target: unknown, key: string) => {
    if (typeof target !== 'string') return;
    const list = an.fileRefIndex.get(target) ?? [];
    if (!list.includes(key)) list.push(key);
    an.fileRefIndex.set(target, list);
  };
  for (const a of an.incoming.assignments) addFile(a.classId, `assignments:${a.id}`);
  for (const e of an.incoming.events) {
    addFile(e.classId, `events:${e.id}`);
    addFile(e.assignmentId, `events:${e.id}`);
  }
  for (const b of an.incoming.scheduleBlocks) {
    addFile(b.assignmentId, `scheduleBlocks:${b.id}`);
    addFile(b.taskId, `scheduleBlocks:${b.id}`);
  }
}

function newEntry(c: CollectionName, id: string, cur: Item | undefined, file: Item | undefined): Entry {
  return { key: `${c}:${id}`, collection: c, id, cur, file, category: 'new', onFate: 'keep', offFate: 'keep', removalGroup: [], tombstones: [] };
}

/** The requested changes (§ 15.9) listed for any of these ids, combined. */
function requestedFor(an: Analysis, ids: string[]): RequestedInfo | undefined {
  const found = ids.map((id) => an.requested.get(id)).filter((r): r is RequestedChange => !!r);
  if (!found.length) return undefined;
  return { reason: Array.from(new Set(found.map((r) => r.reason))).join(' '), byPerson: found.every((r) => r.requestedByPerson) };
}

function isFutureBlock(an: Analysis, block: Obj): boolean {
  return isLdt(block.start) && ldtToMinutes(block.start) >= an.tMin;
}

/** Done/skipped, past or in-progress blocks, and done assignments: never removed by an import. */
function isHistory(an: Analysis, c: CollectionName, item: Obj): boolean {
  if (c === 'scheduleBlocks') return isDoneOrSkipped(item) || !isFutureBlock(an, item);
  if (c === 'assignments') return item.status === 'done';
  return false;
}

function statusConflict(cur: Obj, file: Obj): boolean {
  return cur.status === 'cancelled' && (file.status ?? 'not_started') !== 'cancelled';
}

function inBothEntry(an: Analysis, c: CollectionName, cur: Item, file: Item): Entry {
  const e = newEntry(c, cur.id, cur, file);
  if (c === 'scheduleBlocks' && isDoneOrSkipped(cur)) {
    // § 16.3: a done or skipped block is history and is kept as a whole.
    e.category = sameItem(c, cur, file) ? 'unchanged' : 'kept';
    e.preview = file;
    return e;
  }
  e.rowKey = e.key;
  e.onFate = 'take';
  e.offFate = 'keep';
  if (isProtected(cur)) {
    e.takeMode = 'take';
    const ids = [cur.id];
    if (c === 'assignments') for (const t of [...tasksOf(cur), ...tasksOf(file)]) ids.push(t.id);
    e.requested = requestedFor(an, ids);
    e.category = e.requested ? 'yourItems' : 'kept';
    an.specs.set(e.key, { selectable: true, defaultOn: e.requested ? e.requested.byPerson : false });
    if (c === 'assignments') addTaskRows(an, e, cur, file, 'take');
    return e;
  }
  e.takeMode = c === 'scheduleBlocks' && !isFutureBlock(an, cur) ? 'pastBlock' : 'merge';
  e.category = 'updated';
  an.specs.set(e.key, { selectable: false, defaultOn: true });
  if (c === 'assignments') {
    const ov = overridesOf(cur);
    if (statusConflict(cur, file)) {
      e.statusRow = `${e.key}#status`;
      an.specs.set(e.statusRow, { selectable: true, defaultOn: false });
    }
    const curState = cur.sourceState ?? 'present';
    const fileState = file.sourceState ?? 'present';
    if (curState === 'present' && (fileState === 'missing' || fileState === 'withdrawn') && !ov.includes('sourceState')) {
      e.sourceStateRow = `${e.key}#sourceState`;
      an.specs.set(e.sourceStateRow, { selectable: true, defaultOn: true });
    }
    if (!ov.includes('tasks')) addTaskRows(an, e, cur, file, 'merge');
  }
  return e;
}

function addTaskRow(an: Analysis, row: TaskRow, spec: RowSpec): void {
  an.taskRows.push(row);
  an.specs.set(row.key, spec);
}

/** Task-level rows of an assignment that is in both documents (§ 16.2, § 16.3). */
function addTaskRows(an: Analysis, e: Entry, cur: Item, file: Item, mode: 'merge' | 'take'): void {
  const curById = new Map(tasksOf(cur).map((t) => [t.id, t]));
  const fileIds = new Set(tasksOf(file).map((t) => t.id));
  const base = { entryKey: e.key, assignmentId: e.id };
  for (const ft of tasksOf(file)) {
    const ct = curById.get(ft.id);
    if (!ct) {
      const tomb = an.curTombById.get(ft.id);
      if (tomb) {
        addTaskRow(
          an,
          {
            ...base,
            key: `tasks:${ft.id}`,
            taskId: ft.id,
            aspect: 'item',
            category: 'previouslyDeleted',
            file: ft,
            removes: false,
            reason: `You deleted this task on ${formatDateShort(dateOf(tomb.deletedAt), an.year)}. Tick to restore it.`,
          },
          { selectable: true, defaultOn: false },
        );
      }
      continue;
    }
    if (mode === 'take') continue;
    const ctObj = ct as unknown as Obj;
    const ftObj = ft as unknown as Obj;
    if (isProtected(ctObj)) {
      const taken = takeItem(an, 'tasks', ctObj, ftObj, () => false, new Set(), { removedTasks: [] });
      if (sameItem('tasks', taken, ct)) continue;
      const req = requestedFor(an, [ct.id]);
      addTaskRow(
        an,
        {
          ...base,
          key: `tasks:${ct.id}`,
          taskId: ct.id,
          aspect: 'item',
          category: req ? 'yourItems' : 'kept',
          cur: ct,
          file: ft,
          removes: false,
          requested: req,
          reason: req
            ? `The file changes your task: ${req.reason}`
            : `${ct.origin === 'user' ? 'You added this task' : 'You pinned this task'}, so your version is kept. Tick to take the file's version.`,
        },
        { selectable: true, defaultOn: req ? req.byPerson : false },
      );
    } else if (statusConflict(ctObj, ftObj)) {
      addTaskRow(
        an,
        {
          ...base,
          key: `tasks:${ct.id}#status`,
          taskId: ct.id,
          aspect: 'status',
          category: 'kept',
          cur: ct,
          file: ft,
          removes: false,
          reason: `You cancelled this task. The file says “${WORK_STATUS_LABELS[ft.status ?? 'not_started']}”; tick to take the file's status.`,
        },
        { selectable: true, defaultOn: false },
      );
    }
  }
  if (mode === 'take') return;
  for (const ct of tasksOf(cur)) {
    if (fileIds.has(ct.id)) continue;
    const ctObj = ct as unknown as Obj;
    const req = isProtected(ctObj) && ct.status !== 'done' ? requestedFor(an, [ct.id]) : undefined;
    if (req) {
      addTaskRow(
        an,
        {
          ...base,
          key: `tasks:${ct.id}`,
          taskId: ct.id,
          aspect: 'item',
          category: 'yourItems',
          cur: ct,
          removes: true,
          requested: req,
          reason: `The file removes your task: ${req.reason}`,
        },
        { selectable: true, defaultOn: req.byPerson },
      );
    } else if (an.fileTombById.has(ct.id)) {
      addTaskRow(
        an,
        {
          ...base,
          key: `tasks:${ct.id}#deleted`,
          taskId: ct.id,
          aspect: 'deletedInFile',
          category: 'kept',
          cur: ct,
          removes: true,
          reason: 'Deleted in the imported file. Tick to delete it here too.',
        },
        { selectable: true, defaultOn: false },
      );
    }
  }
}

function isOutdatedCandidate(an: Analysis, b: Item): boolean {
  if (originOf(b) === 'user' || b.locked === true) return false;
  if ((b.status ?? 'planned') !== 'planned' || !isFutureBlock(an, b) || nonEmptyText(b.notes)) return false;
  if (typeof b.assignmentId === 'string') return an.fileTop.get(b.assignmentId)?.collection === 'assignments';
  return originOf(b) === 'generated' && an.fileHasGeneratedBlock;
}

function currentOnlyEntry(an: Analysis, c: CollectionName, cur: Item): Entry {
  const e = newEntry(c, cur.id, cur, undefined);
  e.onFate = 'remove';
  e.offFate = 'keep';
  const listed = isProtected(cur) && !(c === 'scheduleBlocks' && isDoneOrSkipped(cur)) ? requestedFor(an, [cur.id]) : undefined;
  if (listed) {
    e.category = 'yourItems';
    e.requested = listed;
    e.rowKey = e.key;
    an.specs.set(e.key, { selectable: true, defaultOn: listed.byPerson });
  } else if (isProtected(cur) || isHistory(an, c, cur)) {
    e.category = 'protected';
    e.onFate = 'keep';
  } else if (c === 'scheduleBlocks' && !an.fresh && isOutdatedCandidate(an, cur)) {
    e.category = 'outdated';
    e.rowKey = e.key;
    an.specs.set(e.key, { selectable: true, defaultOn: true });
  } else {
    e.category = 'missing';
    e.rowKey = e.key;
    an.specs.set(e.key, { selectable: true, defaultOn: false });
  }
  if (an.fileTombById.has(cur.id)) {
    e.deletedInFile = true;
    if (e.category === 'protected') {
      e.deletedRow = `${e.key}#deleted`;
      an.specs.set(e.deletedRow, { selectable: true, defaultOn: false });
    }
  }
  return e;
}

function tombstonesFor(an: Analysis, c: CollectionName, item: Item): Tombstone[] {
  const out: Tombstone[] = [];
  const byId = an.curTombById.get(item.id);
  if (byId) out.push(byId);
  for (const sid of sourceIdsOf(item)) {
    for (const tomb of an.curTombBySource.get(`${c}\u0000${sid}`) ?? []) if (!out.includes(tomb)) out.push(tomb);
  }
  return out;
}

function fileOnlyEntry(an: Analysis, c: CollectionName, file: Item): Entry {
  const e = newEntry(c, file.id, undefined, file);
  e.onFate = 'add';
  e.offFate = 'skip';
  const stones = tombstonesFor(an, c, file);
  if (stones.length) {
    e.category = 'previouslyDeleted';
    e.tombstones = stones;
    e.rowKey = e.key;
    an.specs.set(e.key, { selectable: true, defaultOn: false });
    return e;
  }
  const dup = c === 'scheduleBlocks' ? undefined : findDuplicate(an, c, file);
  if (dup) {
    e.category = 'possibleDuplicate';
    e.matched = dup;
    e.rowKey = e.key;
    an.specs.set(e.key, { selectable: true, defaultOn: false });
    return e;
  }
  e.category = 'new';
  return e;
}

// --- Possible duplicates (§ 15.3 rules 2 and 3) ----------------------------

function slugAll(value: string): string {
  const s = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'item';
}

function sortedDays(days: unknown): string[] {
  return Array.isArray(days) ? [...(days as string[])].sort((a, b) => WEEKDAYS.indexOf(a as never) - WEEKDAYS.indexOf(b as never)) : [];
}

function normTitle(c: CollectionName, x: Obj): string {
  if (c === 'classes') return slugAll(str(x.name) ?? '');
  if (c === 'availability') {
    if (nonEmptyText(x.label)) return slugAll(x.label);
    if (isObj(x.recurrence)) return sortedDays(x.recurrence.daysOfWeek).join('-');
    return str(x.date) ?? '';
  }
  return slugAll(str(x.title) ?? '');
}

function familyOf(c: CollectionName, x: Obj): string {
  if (c !== 'assignments') return c;
  return ASSESSMENT_TYPES.includes((x.type ?? 'homework') as never) ? 'assessment' : 'work';
}

function matchDate(c: CollectionName, x: Obj): string | null {
  const pick = (v: unknown) => (typeof v === 'string' && isValidDateOrDateTime(v) ? dateOf(v) : null);
  if (c === 'assignments') return pick(x.due) ?? pick(x.assessmentDate);
  if (c === 'events' || c === 'availability') return pick(x.date) ?? (isObj(x.recurrence) ? pick(x.recurrence.startDate) : null);
  return null;
}

function sourceKinds(x: Obj): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const s of [x.source, ...(Array.isArray(x.sources) ? x.sources : [])]) {
    if (!isObj(s) || typeof s.id !== 'string' || typeof s.kind !== 'string') continue;
    if (!out.has(s.kind)) out.set(s.kind, new Set());
    out.get(s.kind)!.add(s.id);
  }
  return out;
}

const OCCURRENCE_ID = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

/** The rule-3 exclusions (a), (b) and (d) of § 15.3. */
function excludedFromRule3(a: Obj, b: Obj): boolean {
  const ka = sourceKinds(a);
  const kb = sourceKinds(b);
  for (const [kind, ids] of ka) {
    const other = kb.get(kind);
    if (other && ![...ids].some((id) => other.has(id))) return true;
  }
  const oa = OCCURRENCE_ID.exec(String(a.id));
  const ob = OCCURRENCE_ID.exec(String(b.id));
  if (oa && ob && oa[1] === ob[1] && oa[2] !== ob[2]) return true;
  if (isObj(a.recurrence) && isObj(b.recurrence)) {
    const ra = a.recurrence;
    const rb = b.recurrence;
    if (typeof ra.endDate === 'string' && typeof rb.startDate === 'string' && ra.endDate < rb.startDate) return true;
    if (typeof rb.endDate === 'string' && typeof ra.startDate === 'string' && rb.endDate < ra.startDate) return true;
  }
  return false;
}

interface DupIndex {
  /** `kind\0id` of a source → the first current item (and its position) with that source. */
  bySource: Map<string, { item: Item; index: number }>;
  /** `classId\0family\0normalized title` → current items in their order (§ 15.3 rule 3). */
  byTitle: Map<string, Item[]>;
}

function titleKey(c: CollectionName, x: Obj): string {
  return `${str(x.classId) ?? ''}\u0000${familyOf(c, x)}\u0000${normTitle(c, x)}`;
}

function dupIndex(an: Analysis, c: CollectionName): DupIndex {
  let index = an.dupIndexes.get(c);
  if (index) return index;
  index = { bySource: new Map(), byTitle: new Map() };
  itemsOf(an.current, c).forEach((cur, i) => {
    for (const [kind, ids] of sourceKinds(cur)) {
      for (const id of ids) {
        const k = `${kind}\u0000${id}`;
        if (!index!.bySource.has(k)) index!.bySource.set(k, { item: cur, index: i });
      }
    }
    pushTo(index!.byTitle, titleKey(c, cur), cur);
  });
  an.dupIndexes.set(c, index);
  return index;
}

function findDuplicate(an: Analysis, c: CollectionName, f: Item): { item: Item; why: string } | undefined {
  const index = dupIndex(an, c);
  // Rule 2: the same source kind and id (the first such current item).
  let best: { item: Item; index: number; kind: string } | undefined;
  for (const [kind, ids] of sourceKinds(f)) {
    for (const id of ids) {
      const hit = index.bySource.get(`${kind}\u0000${id}`);
      if (hit && (!best || hit.index < best.index)) best = { ...hit, kind };
    }
  }
  if (best) return { item: best.item, why: `the same ${SOURCE_KIND_LABELS[best.kind as keyof typeof SOURCE_KIND_LABELS] ?? best.kind} item` };
  // Rule 3: same class, type family and normalized title, dates fewer than 7 days apart (with the exclusions).
  for (const cur of index.byTitle.get(titleKey(c, f)) ?? []) {
    const da = matchDate(c, f);
    const db = matchDate(c, cur);
    if ((da === null) !== (db === null)) continue;
    const gap = da && db ? Math.abs(daysBetween(da, db)) : 0;
    if (gap >= 7 || excludedFromRule3(f, cur)) continue;
    const what = c === 'classes' ? 'the same name' : c === 'availability' ? 'the same label' : 'the same class, type and title';
    const when = da && db ? (gap === 0 ? ' and date' : `, dated ${plural(gap, 'day', 'days')} apart`) : '';
    return { item: cur, why: `${what}${when}` };
  }
  return undefined;
}

// --- Removal groups (§ 16.1, § 16.4) ----------------------------------------

/** Whether an item that is in the file keeps the current value of a reference field by default. */
function keepsCurrentRef(an: Analysis, d: Entry, field: string): boolean {
  if (d.takeMode === 'merge') return overridesOf(d.cur).includes(field);
  if (d.takeMode === 'take') return !(an.specs.get(d.key)?.defaultOn ?? false);
  return true; // done/skipped blocks and past blocks keep their current fields
}

function computeRemovalGroups(an: Analysis): void {
  for (const e of an.entries) {
    if (!e.cur || e.file) continue;
    const rowKey = e.deletedRow ?? (e.category === 'missing' || e.category === 'yourItems' ? e.rowKey : undefined);
    if (!rowKey) continue;
    const group: string[] = [];
    const blockers: Blocker[] = [];
    const seen = new Set([e.key]);
    // `via`: the item removed together with e that the blocker uses (undefined: it uses e itself).
    const visit = (id: string, via: Entry | undefined) => {
      for (const ref of an.curRefIndex.get(id) ?? []) {
        if (seen.has(ref.key)) continue;
        seen.add(ref.key);
        const d = an.entryByKey.get(ref.key);
        if (!d) continue;
        if (d.file) {
          if (keepsCurrentRef(an, d, ref.field)) blockers.push({ entry: d, via });
          continue;
        }
        if (d.category === 'missing' || d.category === 'outdated' || d.category === 'yourItems') {
          group.push(d.key);
          visit(d.id, via ?? d);
        } else blockers.push({ entry: d, via });
      }
    };
    visit(e.id, undefined);
    let blocked: string | undefined;
    if (e.collection === 'assignments' && e.cur.status === 'done') {
      blocked = 'This assignment is marked done; completed work is never removed by an import.';
    } else if (e.deletedRow && isHistory(an, e.collection, e.cur)) {
      blocked = 'Completed or past work is never removed by an import.';
    } else if (blockers.length) {
      blocked = blockerText(e, blockers);
    }
    if (blocked) an.specs.set(rowKey, { selectable: false, defaultOn: false, blockedReason: blocked });
    else e.removalGroup = group;
  }
}

interface Blocker {
  entry: Entry;
  /** The item removed together with the row's item that the blocker uses; absent when it uses that item itself. */
  via?: Entry;
}

/** Why a removal cannot be ticked, e.g. "3 of your own assignments use this class." (§ 16.1). */
function blockerText(e: Entry, blockers: Blocker[]): string {
  const nounOf = (c: CollectionName) => (c === 'classes' ? 'class' : c === 'assignments' ? 'assignment' : COLLECTION_LABELS[c].one);
  const noun = nounOf(e.collection);
  const counts = new Map<string, { n: number; c: CollectionName; via?: CollectionName }>();
  for (const { entry: b, via } of blockers) {
    const cur = b.cur!;
    let kind: string;
    if (b.file) kind = 'file';
    else if (cur.origin === 'user') kind = 'own';
    else if (cur.locked === true) kind = 'pinned';
    else if (b.collection === 'scheduleBlocks' && isDoneOrSkipped(cur)) kind = 'doneBlock';
    else if (b.collection === 'scheduleBlocks') kind = 'pastBlock';
    else if (b.collection === 'assignments' && cur.status === 'done') kind = 'doneAssignment';
    else kind = 'other';
    const k = `${kind}|${b.collection}|${via?.collection ?? ''}`;
    const prev = counts.get(k);
    counts.set(k, { n: (prev?.n ?? 0) + 1, c: b.collection, via: via?.collection });
  }
  const parts: string[] = [];
  for (const [k, { n, c, via }] of counts) {
    const kind = k.split('|')[0];
    const one = COLLECTION_LABELS[c].one;
    const many = COLLECTION_LABELS[c].many;
    const what = n === 1 ? one : many;
    const verb = c === 'scheduleBlocks' ? (n === 1 ? 'belongs to' : 'belong to') : n === 1 ? 'uses' : 'use';
    // A blocker of an item removed together with this one, e.g. a past session of an assignment in this class.
    const target = via ? `${withArticle(nounOf(via))} ${e.collection === 'classes' ? 'in' : 'of'} this ${noun}` : `this ${noun}`;
    const sessions = n === 1 ? 'session' : 'sessions';
    switch (kind) {
      case 'file':
        parts.push(`${n} ${what} that you keep from before still ${verb} ${target}`);
        break;
      case 'own':
        parts.push(`${n} of your own ${many} ${verb} ${target}`);
        break;
      case 'pinned':
        parts.push(`${n} pinned ${what} ${verb} ${target}`);
        break;
      case 'doneBlock':
        parts.push(`${n} completed ${sessions} ${verb} ${target}`);
        break;
      case 'pastBlock':
        parts.push(`${n} past ${sessions} ${verb} ${target}`);
        break;
      case 'doneAssignment':
        parts.push(`${n} completed ${what} ${verb} ${target}`);
        break;
      default:
        parts.push(`${n} ${what} ${verb} ${target}`);
    }
  }
  return `${parts.join('; ')}.`.replace(/^./, (ch) => ch.toUpperCase());
}

function settingValue(settings: Settings | undefined, name: keyof Settings): unknown {
  const v = settings?.[name];
  if (v !== undefined) return v;
  return name === 'maxDailyStudyMinutes' ? null : DEFAULT_SETTINGS[name];
}

// ===========================================================================
// Merging (§ 16.3)
// ===========================================================================

interface TaskOut {
  removedTasks: Task[];
}

function withDecidedStatus(an: Analysis, issue: Issue): Issue {
  const copy = clone(issue);
  const decided = issue.id ? an.decided.get(issue.id) : undefined;
  if (decided?.status) copy.status = decided.status;
  return copy;
}

/** Item issues come from the file; resolved/dismissed decisions are kept (§ 16.3). */
function mergeIssues(an: Analysis, fileIssues: unknown, curIssues: unknown): Issue[] {
  const out = issuesOf({ issues: fileIssues }).map((i) => withDecidedStatus(an, i));
  for (const ci of issuesOf({ issues: curIssues })) {
    if (ci.id && isDecided(ci) && !an.fileIssueIds.has(ci.id)) out.push(clone(ci));
  }
  return out;
}

function mergeExtensions(out: Obj, cur: Obj): void {
  for (const k of Object.keys(cur)) if (k.startsWith('x-') && !(k in out) && cur[k] !== undefined) out[k] = clone(cur[k]);
}

/** § 16.3 for an unlocked generated/planner item: the file's values except the person-owned ones. */
function mergeCommon(an: Analysis, cur: Obj, file: Obj): Obj {
  const out = clone(file);
  setOrDelete(out, 'origin', cur.origin);
  if (nonEmptyText(cur.notes)) out.notes = cur.notes;
  const curOverrides = overridesOf(cur);
  for (const field of curOverrides) setOrDelete(out, field, clone(cur[field]));
  setOrDelete(out, 'overrides', [...curOverrides, ...overridesOf(file).filter((f) => !curOverrides.includes(f))]);
  setOrDelete(out, 'issues', mergeIssues(an, file.issues, cur.issues));
  mergeExtensions(out, cur);
  return out;
}

const WORK_RANK: Record<string, number> = { not_started: 0, in_progress: 1, done: 2 };

/** Status never goes backwards; a current `cancelled` is kept unless `takeFile` (§ 16.3). */
function mergeWorkStatus(out: Obj, cur: Obj, file: Obj, takeFile: boolean): void {
  const cs = str(cur.status) ?? 'not_started';
  const fs = str(file.status) ?? 'not_started';
  const keepCurrent = () => {
    setOrDelete(out, 'status', cur.status);
    setOrDelete(out, 'completedAt', cur.completedAt);
  };
  if (cs === 'cancelled') {
    if (!(takeFile && fs !== 'cancelled')) keepCurrent();
    return;
  }
  if (fs === 'cancelled') {
    if (cs === 'done') keepCurrent();
    return;
  }
  if ((WORK_RANK[cs] ?? 0) > (WORK_RANK[fs] ?? 0)) {
    keepCurrent();
    return;
  }
  if (cs === 'done' && fs === 'done') setOrDelete(out, 'completedAt', cur.completedAt ?? file.completedAt);
}

/** The file's version of a protected item, taken on the person's request (kept/yourItems rows). */
function takeItem(an: Analysis, c: ItemCollection, cur: Obj, file: Obj, sel: Sel, taskRefs: Set<string>, out: TaskOut): Obj {
  const taken = clone(file);
  setOrDelete(taken, 'origin', cur.origin);
  if (nonEmptyText(cur.notes)) taken.notes = cur.notes;
  if (cur.origin === 'user') setOrDelete(taken, 'overrides', cur.overrides);
  else {
    const curOverrides = overridesOf(cur);
    setOrDelete(taken, 'overrides', [...curOverrides, ...overridesOf(file).filter((f) => !curOverrides.includes(f))]);
  }
  setOrDelete(taken, 'issues', mergeIssues(an, file.issues, cur.issues));
  mergeExtensions(taken, cur);
  if ((c === 'assignments' || c === 'tasks') && cur.status === 'done' && file.status !== 'done') {
    taken.status = 'done';
    setOrDelete(taken, 'completedAt', cur.completedAt);
  }
  if (c === 'assignments') setOrDelete(taken, 'tasks', mergeTaskList(an, cur, file, 'take', sel, taskRefs, out));
  return taken;
}

/** A past or in-progress planned block: only the file's done/skipped is taken (§ 16.3). */
function mergePastBlock(cur: Obj, file: Obj): Obj {
  const fs = file.status;
  if (fs !== 'done' && fs !== 'skipped') return cur;
  const out = clone(cur);
  out.status = fs;
  setOrDelete(out, 'completedAt', fs === 'done' ? file.completedAt : undefined);
  return out;
}

/**
 * Tasks are merged task by task (§ 16.3, D27): the file's tasks in file order,
 * then the current tasks the file does not contain that are kept (user, locked,
 * done, or referenced by a remaining block) in their current order.
 */
function mergeTaskList(an: Analysis, curA: Obj, fileA: Obj, mode: 'merge' | 'take', sel: Sel, taskRefs: Set<string>, out: TaskOut): Task[] {
  const curTasks = tasksOf(curA);
  const curById = new Map(curTasks.map((t) => [t.id, t]));
  const fileIds = new Set(tasksOf(fileA).map((t) => t.id));
  const result: Task[] = [];
  for (const ft of tasksOf(fileA)) {
    const ct = curById.get(ft.id);
    const ftObj = ft as unknown as Obj;
    if (ct) {
      const ctObj = ct as unknown as Obj;
      if (mode === 'take') result.push(takeItem(an, 'tasks', ctObj, ftObj, sel, taskRefs, out) as unknown as Task);
      else if (isProtected(ctObj)) result.push(sel(`tasks:${ft.id}`) ? (takeItem(an, 'tasks', ctObj, ftObj, sel, taskRefs, out) as unknown as Task) : ct);
      else {
        const merged = mergeCommon(an, ctObj, ftObj);
        mergeWorkStatus(merged, ctObj, ftObj, sel(`tasks:${ft.id}#status`));
        result.push(merged as unknown as Task);
      }
    } else if (!an.curTombById.has(ft.id) || sel(`tasks:${ft.id}`)) {
      result.push(ft);
    }
  }
  for (const ct of curTasks) {
    if (fileIds.has(ct.id)) continue;
    const referenced = taskRefs.has(ct.id);
    const done = ct.status === 'done';
    const keep = referenced || done || (mode === 'merge' && isProtected(ct as unknown as Obj));
    if (!keep) continue;
    if (!referenced && !done && mode === 'merge' && (sel(`tasks:${ct.id}`) || sel(`tasks:${ct.id}#deleted`))) {
      out.removedTasks.push(ct);
      continue;
    }
    result.push(ct);
  }
  return result;
}

function takeVersion(an: Analysis, e: Entry, sel: Sel, taskRefs: Set<string>, out: TaskOut): Obj {
  const cur = e.cur!;
  const file = e.file!;
  if (e.takeMode === 'pastBlock') return mergePastBlock(cur, file);
  if (e.takeMode === 'take') return takeItem(an, e.collection, cur, file, sel, taskRefs, out);
  const merged = mergeCommon(an, cur, file);
  if (e.collection === 'assignments') {
    mergeWorkStatus(merged, cur, file, e.statusRow ? sel(e.statusRow) : false);
    if (e.sourceStateRow && !sel(e.sourceStateRow)) setOrDelete(merged, 'sourceState', cur.sourceState);
    if (!overridesOf(cur).includes('tasks')) setOrDelete(merged, 'tasks', mergeTaskList(an, cur, file, 'merge', sel, taskRefs, out));
  }
  return merged;
}

// ===========================================================================
// Building the merged document
// ===========================================================================

interface Versions {
  items: Map<string, Obj>;
  taskRefs: Set<string>;
  removedTasks: Task[];
}

interface BuildResult {
  doc: ScheduleDocument;
  fate: Map<string, Fate>;
  vs: Versions;
  /** Entry key → why its outcome differs from the selection. */
  adjustments: Map<string, string>;
  /** Entry key → the row whose item it needs and that this selection does not import (see ImportChange.follows). */
  needs: Map<string, string>;
}

function specSel(an: Analysis): Sel {
  return (key) => an.specs.get(key)?.defaultOn ?? false;
}

function planSel(an: Analysis, plan: ImportPlan, selected: Set<string>): Sel {
  const rows = new Map(plan.changes.map((c) => [c.key, c]));
  return (key) => {
    const row = rows.get(key);
    // A row made selectable by the preview (an update that makes the result invalid) follows the selection.
    if (row?.selectable) return selected.has(key);
    // Otherwise the analysis decides, so that an item that follows another row (ImportChange.follows) is
    // imported as soon as that row is ticked.
    const spec = an.specs.get(key);
    if (spec) return spec.selectable ? selected.has(key) : spec.defaultOn;
    return row ? row.defaultSelected : false;
  };
}

function computeVersions(an: Analysis, fate: Map<string, Fate>, sel: Sel): Versions {
  const items = new Map<string, Obj>();
  const taskRefs = new Set<string>();
  const out: TaskOut = { removedTasks: [] };
  // Blocks first: which tasks remain referenced decides which tasks are kept.
  for (const c of ['scheduleBlocks', 'classes', 'events', 'availability', 'assignments'] as CollectionName[]) {
    for (const e of an.byCollection.get(c)!) {
      const f = fate.get(e.key)!;
      let v: Obj | undefined;
      if (f === 'keep') v = e.cur;
      else if (f === 'add') v = e.file;
      else if (f === 'take') v = takeVersion(an, e, sel, taskRefs, out);
      if (!v) continue;
      items.set(e.key, v);
      if (c === 'scheduleBlocks' && typeof v.taskId === 'string') taskRefs.add(v.taskId);
    }
  }
  return { items, taskRefs, removedTasks: out.removedTasks };
}

function hardRefs(c: CollectionName, v: Obj): Array<{ kind: 'class' | 'assignment' | 'task'; id: string; assignmentId?: string }> {
  const refs: Array<{ kind: 'class' | 'assignment' | 'task'; id: string; assignmentId?: string }> = [];
  if ((c === 'assignments' || c === 'events') && typeof v.classId === 'string') refs.push({ kind: 'class', id: v.classId });
  if ((c === 'events' || c === 'scheduleBlocks') && typeof v.assignmentId === 'string') refs.push({ kind: 'assignment', id: v.assignmentId });
  if (c === 'scheduleBlocks' && typeof v.taskId === 'string' && typeof v.assignmentId === 'string') {
    refs.push({ kind: 'task', id: v.taskId, assignmentId: v.assignmentId });
  }
  return refs;
}

function refName(an: Analysis, ref: { kind: 'class' | 'assignment' | 'task'; id: string }): string {
  const name = ref.kind === 'class' ? an.names.cls.get(ref.id) : ref.kind === 'assignment' ? an.names.asg.get(ref.id) : an.names.task.get(ref.id);
  return `the ${ref.kind} “${name ?? ref.id}”`;
}

/** Make every class/assignment/task reference resolve; returns true when an outcome changed. */
/** The row that decides whether a referenced item is imported: a task row of its own, or the item's row. */
function neededRow(an: Analysis, ref: { kind: 'class' | 'assignment' | 'task'; id: string; assignmentId?: string }): string | undefined {
  if (ref.kind === 'task' && an.specs.has(`tasks:${ref.id}`)) return `tasks:${ref.id}`;
  const target = an.entryById.get(ref.kind === 'task' ? ref.assignmentId! : ref.id);
  return target ? (target.rowKey ?? target.key) : undefined;
}

function enforceReferences(
  an: Analysis,
  fate: Map<string, Fate>,
  vs: Versions,
  adjustments: Map<string, string>,
  needs: Map<string, string>,
): boolean {
  const classIds = new Set<string>();
  const asgTasks = new Map<string, Set<string>>();
  for (const e of an.entries) {
    const v = vs.items.get(e.key);
    if (!v) continue;
    if (e.collection === 'classes') classIds.add(e.id);
    else if (e.collection === 'assignments') asgTasks.set(e.id, new Set(tasksOf(v).map((t) => t.id)));
  }
  let changed = false;
  for (const e of an.entries) {
    const v = vs.items.get(e.key);
    if (!v) continue;
    for (const ref of hardRefs(e.collection, v)) {
      const ok =
        ref.kind === 'class' ? classIds.has(ref.id) : ref.kind === 'assignment' ? asgTasks.has(ref.id) : !!asgTasks.get(ref.assignmentId!)?.has(ref.id);
      if (ok) continue;
      const f = fate.get(e.key);
      if (f === 'add') {
        fate.set(e.key, 'skip');
        adjustments.set(e.key, `Not added: it needs ${refName(an, ref)}, which is not imported.`);
        const needed = neededRow(an, ref);
        if (needed) needs.set(e.key, needed);
        changed = true;
        break;
      }
      if (f === 'take') {
        fate.set(e.key, 'keep');
        adjustments.set(e.key, `Not updated: the file's version needs ${refName(an, ref)}, which is not imported.`);
        const needed = neededRow(an, ref);
        if (needed) needs.set(e.key, needed);
        changed = true;
        break;
      }
      const target = an.entryById.get(ref.kind === 'task' ? ref.assignmentId! : ref.id);
      if (target && fate.get(target.key) === 'remove') {
        fate.set(target.key, 'keep');
        adjustments.set(target.key, `Not removed: “${entryLabel(an, e)}” still uses it.`);
        changed = true;
      }
    }
  }
  return changed;
}

function build(an: Analysis, sel: Sel): BuildResult {
  const fate = new Map<string, Fate>();
  for (const e of an.entries) {
    let f = e.rowKey ? (sel(e.rowKey) ? e.onFate : e.offFate) : e.onFate;
    if (f === 'remove' && e.linkedTo && !sel(e.linkedTo)) f = 'keep';
    if (f === 'keep' && e.deletedRow && sel(e.deletedRow)) f = 'remove';
    fate.set(e.key, f);
  }
  // A removal takes its dependents with it (§ 16.1): they were checked to be removable.
  for (const e of an.entries) {
    if (fate.get(e.key) !== 'remove' || !e.removalGroup.length) continue;
    for (const m of e.removalGroup) fate.set(m, 'remove');
  }
  const adjustments = new Map<string, string>();
  const needs = new Map<string, string>();
  let vs = computeVersions(an, fate, sel);
  for (let guard = 0; guard <= an.entries.length + 1; guard++) {
    if (!enforceReferences(an, fate, vs, adjustments, needs)) break;
    vs = computeVersions(an, fate, sel);
  }
  return { doc: assemble(an, fate, vs, sel), fate, vs, adjustments, needs };
}

function stripDependsOn(item: Obj, keep: (id: string) => boolean): void {
  if (!Array.isArray(item.dependsOn)) return;
  setOrDelete(item, 'dependsOn', (item.dependsOn as string[]).filter(keep));
}

function assemble(an: Analysis, fate: Map<string, Fate>, vs: Versions, sel: Sel): ScheduleDocument {
  const out: Obj = { schemaVersion: '1.0' };
  const meta = mergeMeta(an);
  if (meta) out.meta = meta;
  const settings = mergeSettings(an, sel);
  if (settings) out.settings = settings;

  const lists = {} as Record<CollectionName, Obj[]>;
  for (const c of COLLECTION_ORDER) {
    lists[c] = an.byCollection
      .get(c)!
      .filter((e) => vs.items.has(e.key))
      .map((e) => clone(vs.items.get(e.key)!));
  }
  const asgTasks = new Map<string, Set<string>>();
  for (const a of lists.assignments) asgTasks.set(String(a.id), new Set(tasksOf(a).map((t) => t.id)));
  const finalIds = new Set<string>();
  const finalSources = new Set<string>();
  for (const c of COLLECTION_ORDER) {
    for (const item of lists[c]) {
      finalIds.add(String(item.id));
      for (const t of tasksOf(item)) finalIds.add(t.id);
      for (const sid of sourceIdsOf(item)) finalSources.add(`${c}\u0000${sid}`);
    }
  }
  // A removal also removes the item's ID from dependsOn lists (§ 16.1, § 16.4).
  for (const a of lists.assignments) {
    stripDependsOn(a, (id) => id !== a.id && asgTasks.has(id));
    const ids = asgTasks.get(String(a.id))!;
    for (const t of tasksOf(a)) stripDependsOn(t as unknown as Obj, (id) => id !== t.id && ids.has(id));
  }
  // Safety net (§ 16.4): a block keeps its assignment but not a task that is gone.
  for (const b of lists.scheduleBlocks) {
    if (typeof b.taskId === 'string' && !(typeof b.assignmentId === 'string' && asgTasks.get(b.assignmentId)?.has(b.taskId))) delete b.taskId;
  }
  for (const c of COLLECTION_ORDER) out[c] = lists[c];

  const issues = mergeRootIssues(an, finalIds);
  dedupeIssueIds(issues, lists);
  if (issues.length) out.issues = issues;

  const deleted = mergeTombstones(an, fate, vs, finalIds, finalSources);
  if (deleted.length) out.deleted = deleted;

  for (const src of [an.current as unknown as Obj, an.incoming as unknown as Obj]) {
    for (const k of Object.keys(src)) if (k.startsWith('x-') && src[k] !== undefined) out[k] = clone(src[k]);
  }
  return out as unknown as ScheduleDocument;
}

/** Meta fields the website stores (§ 16.6, § 15.10): the writer fields, exportId, basedOn and requestedChanges are not. */
const STORED_META = new Set(['title', 'sources']);

/**
 * § 16.6: the website stores the file's `meta.title` and `meta.sources` (and keeps the current ones when the
 * file has none) and its `x-…` keys. `generator`, `generatedAt` and `timezone` are rewritten by every writer,
 * `exportId` by every export; `basedOn` and `requestedChanges` are used for the preview only.
 */
function mergeMeta(an: Analysis): Obj | undefined {
  const cm = (an.current.meta ?? {}) as Obj;
  const fm = (an.incoming.meta ?? {}) as Obj;
  const out: Obj = {};
  for (const k of Object.keys(cm)) {
    if (cm[k] === undefined || !(STORED_META.has(k) || k.startsWith('x-'))) continue;
    out[k] = clone(cm[k]);
  }
  if (nonEmptyText(fm.title)) out.title = fm.title;
  if (Array.isArray(fm.sources) && fm.sources.length) out.sources = clone(fm.sources);
  for (const k of Object.keys(fm)) if (k.startsWith('x-') && fm[k] !== undefined) out[k] = clone(fm[k]);
  return Object.keys(out).length ? out : undefined;
}

/** § 16.6: settings are person-owned; each differing setting changes only when ticked. */
function mergeSettings(an: Analysis, sel: Sel): Obj | undefined {
  const out = clone((an.current.settings ?? {}) as Obj);
  const fs = (an.incoming.settings ?? {}) as Obj;
  for (const name of an.settingNames) if (sel(`settings:${name}`)) setOrDelete(out, name, clone(fs[name]));
  for (const k of Object.keys(fs)) if (k.startsWith('x-') && !(k in out) && fs[k] !== undefined) out[k] = clone(fs[k]);
  return Object.keys(out).length ? out : undefined;
}

function issueContentKey(issue: Issue): string {
  const { status: _status, ...rest } = issue;
  void _status;
  return stable(norm(rest, 'other'));
}

/**
 * § 16.6: root issues are taken from the file (resolved/dismissed decisions
 * kept). Current root issues the file does not have are kept when the person
 * decided them, or when the file is fresh (it never saw them). Issues about an
 * item that no longer exists are removed (§ 15.8).
 */
function mergeRootIssues(an: Analysis, finalIds: Set<string>): Issue[] {
  const out = (an.incoming.issues ?? []).map((i) => withDecidedStatus(an, i));
  const fileContent = new Set(out.map(issueContentKey));
  for (const ci of an.current.issues ?? []) {
    if (ci.id) {
      if (an.fileIssueIds.has(ci.id) || out.some((o) => o.id === ci.id)) continue;
      if (!isDecided(ci) && !an.fresh) continue;
    } else if (!an.fresh || fileContent.has(issueContentKey(ci))) continue;
    out.push(clone(ci));
  }
  return out.filter((i) => !i.itemId || finalIds.has(i.itemId));
}

/** Issue IDs must stay unique in the whole document (§ 13.2 rule 15): later duplicates are dropped. */
function dedupeIssueIds(root: Issue[], lists: Record<CollectionName, Obj[]>): void {
  const seen = new Set<string>();
  const keep = (issue: Issue) => {
    if (!issue.id) return true;
    if (seen.has(issue.id)) return false;
    seen.add(issue.id);
    return true;
  };
  const filtered = root.filter(keep);
  root.splice(0, root.length, ...filtered);
  for (const c of COLLECTION_ORDER) {
    for (const item of lists[c]) {
      if (Array.isArray(item.issues)) setOrDelete(item, 'issues', (item.issues as Issue[]).filter(keep));
      for (const t of tasksOf(item)) {
        const tObj = t as unknown as Obj;
        if (Array.isArray(tObj.issues)) setOrDelete(tObj, 'issues', (tObj.issues as Issue[]).filter(keep));
      }
    }
  }
}

function tombstoneFor(an: Analysis, collection: TombstoneCollection, item: Obj): Tombstone | null {
  if (originOf(item) !== 'generated') return null;
  const stone: Tombstone = { id: String(item.id), collection, deletedAt: an.now };
  if (collection !== 'tasks') {
    const sourceId = sourceIdsOf(item)[0];
    if (sourceId) stone.sourceId = sourceId;
  }
  const title = text(item.title) ?? text(item.name) ?? text(item.label);
  if (title) stone.title = Array.from(title).slice(0, 300).join('');
  return stone;
}

/**
 * § 16.4/§ 16.6: current tombstones (minus restored items), new entries for
 * generated items the person removed here (not for outdated blocks or blocks
 * removed with their assignment), then the file's entries; never an entry for
 * an item that is in the result; at most MAX_TOMBSTONES (oldest dropped).
 * A file entry whose sourceId is the source of an item in the result (one the
 * person restored or kept) is not added either: it names that item.
 */
function mergeTombstones(an: Analysis, fate: Map<string, Fate>, vs: Versions, finalIds: Set<string>, finalSources: Set<string>): Tombstone[] {
  const restored = new Set<string>();
  for (const e of an.entries) if (e.category === 'previouslyDeleted' && fate.get(e.key) === 'add') for (const t of e.tombstones) restored.add(t.id);
  const out: Tombstone[] = [];
  const ids = new Set<string>();
  const push = (stone: Tombstone | null) => {
    if (!stone || ids.has(stone.id) || finalIds.has(stone.id)) return;
    ids.add(stone.id);
    out.push(stone);
  };
  for (const t of an.current.deleted ?? []) if (!restored.has(t.id)) push(clone(t));
  const removedAssignments = new Set(
    an.byCollection
      .get('assignments')!
      .filter((e) => e.cur && fate.get(e.key) === 'remove')
      .map((e) => e.id),
  );
  for (const e of an.entries) {
    if (!e.cur || fate.get(e.key) !== 'remove' || e.category === 'outdated') continue;
    if (e.collection === 'scheduleBlocks' && typeof e.cur.assignmentId === 'string' && removedAssignments.has(e.cur.assignmentId)) continue;
    push(tombstoneFor(an, e.collection, e.cur));
    if (e.collection === 'assignments') for (const t of tasksOf(e.cur)) push(tombstoneFor(an, 'tasks', t as unknown as Obj));
  }
  for (const t of vs.removedTasks) push(tombstoneFor(an, 'tasks', t as unknown as Obj));
  // A restored item's tombstone is removed, also when the file lists it too.
  for (const t of an.incoming.deleted ?? []) {
    if (restored.has(t.id) || (t.sourceId && finalSources.has(`${t.collection}\u0000${t.sourceId}`))) continue;
    push(clone(t));
  }
  if (out.length <= MAX_TOMBSTONES) return out;
  const keep = new Set(
    out
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.deletedAt < b.t.deletedAt ? 1 : a.t.deletedAt > b.t.deletedAt ? -1 : a.i - b.i))
      .slice(0, MAX_TOMBSTONES)
      .map((x) => x.t.id),
  );
  return out.filter((t) => keep.has(t.id));
}

// ===========================================================================
// Preview: categories, rows, field changes
// ===========================================================================

/** Settle "Updated" vs "Unchanged" (§ 16.5) and task rows once the default result is known. */
function finalize(an: Analysis, base: BuildResult, sel: Sel): void {
  const assembled = new Map<string, Obj>();
  for (const c of COLLECTION_ORDER) for (const item of itemsOf(base.doc, c)) assembled.set(`${c}:${item.id}`, item);
  for (const e of an.entries) {
    if (!e.cur || !e.file || !e.takeMode) continue;
    // The item as it ends up in the result (dependsOn and taskId already fitted to what is imported), so
    // that importing the same file again shows it as Unchanged (§ 16.1).
    const built = base.fate.get(e.key) === 'take' ? assembled.get(e.key) : undefined;
    const version = built ?? takeVersion(an, e, sel, base.vs.taskRefs, { removedTasks: [] });
    e.preview = version;
    if (sameItem(e.collection, version, e.cur)) {
      e.category = 'unchanged';
      an.specs.set(e.key, { selectable: false, defaultOn: true });
    }
  }
  const sessions = new Map<string, number>();
  for (const b of base.doc.scheduleBlocks) if (b.taskId) sessions.set(b.taskId, (sessions.get(b.taskId) ?? 0) + 1);
  for (const row of an.taskRows) {
    if (!row.removes || !row.cur) continue;
    const parent = an.entryByKey.get(row.entryKey)!;
    if (row.aspect === 'deletedInFile') {
      const version = base.vs.items.get(row.entryKey) ?? parent.preview;
      if (!version || !tasksOf(version).some((t) => t.id === row.taskId)) {
        row.dropped = true;
        an.specs.delete(row.key);
        continue;
      }
    }
    let blocked: string | undefined;
    if (row.cur.status === 'done') blocked = 'Completed tasks are never removed by an import.';
    else if (base.vs.taskRefs.has(row.taskId)) {
      const n = sessions.get(row.taskId) ?? 1;
      blocked = `${plural(n, 'scheduled session uses', 'scheduled sessions use')} this task.`;
    }
    if (blocked) an.specs.set(row.key, { selectable: false, defaultOn: false, blockedReason: blocked });
  }
}

function entryLabel(an: Analysis, e: Entry): string {
  return itemLabel(an, e.collection, (e.preview ?? e.file ?? e.cur)!);
}

function included(an: Analysis, e: Entry): IncludedItem {
  return { key: e.key, collection: e.collection, id: e.id, label: entryLabel(an, e) };
}

/** File items that are added (or updated) only when these ids are added (§ 16.1: shown in the same row). */
function addDependents(an: Analysis, provided: string[], selfKey: string): IncludedItem[] {
  const queue = [...provided];
  const seenIds = new Set(queue);
  const seenKeys = new Set([selfKey]);
  const out: IncludedItem[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    for (const key of an.fileRefIndex.get(id) ?? []) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const d = an.entryByKey.get(key);
      if (!d) continue;
      out.push(included(an, d));
      if (!d.cur) {
        for (const x of [d.id, ...tasksOf(d.file).map((t) => t.id)]) {
          if (!seenIds.has(x)) {
            seenIds.add(x);
            queue.push(x);
          }
        }
      }
    }
  }
  return out;
}

function newTaskIds(e: Entry): string[] {
  if (e.collection !== 'assignments' || !e.preview) return [];
  const before = new Set(tasksOf(e.cur).map((t) => t.id));
  return tasksOf(e.preview)
    .map((t) => t.id)
    .filter((id) => !before.has(id));
}

function blockEnded(an: Analysis, block: Obj): boolean {
  return isLdt(block.end) && ldtToMinutes(block.end) <= an.nowMin;
}

function entryReason(an: Analysis, e: Entry): string | undefined {
  const noun = COLLECTION_LABELS[e.collection].one;
  const cur = e.cur;
  switch (e.category) {
    case 'new':
      return undefined;
    case 'updated':
      return e.takeMode === 'pastBlock' ? 'This session had already started when the file was made; only its status is taken from the file.' : undefined;
    case 'previouslyDeleted': {
      const t = e.tombstones[0];
      const when = t && isLdt(t.deletedAt) ? ` on ${formatDateShort(dateOf(t.deletedAt), an.year)}` : '';
      return t && t.id === e.id
        ? `You deleted this ${noun}${when}. Tick to restore it.`
        : `You deleted “${t?.title ?? 'an item'}”${when}, which came from the same source. Tick to add this ${noun} anyway.`;
    }
    case 'possibleDuplicate':
      return `Looks like “${itemTitle(e.collection, e.matched!.item)}”, which is already in your schedule (${e.matched!.why}). Tick to add it anyway.`;
    case 'yourItems':
      return e.file ? `The file changes your ${noun}: ${e.requested!.reason}` : `The file removes your ${noun}: ${e.requested!.reason}`;
    case 'kept':
      if (e.collection === 'scheduleBlocks' && cur && isDoneOrSkipped(cur)) {
        return `This session is marked ${cur.status === 'done' ? 'done' : 'skipped'}; completed and skipped sessions are kept exactly as they are.`;
      }
      return `${cur?.origin === 'user' ? `You created this ${noun}` : `You pinned this ${noun}`}, so your version is kept. Tick to take the file's version.`;
    case 'outdated':
      return 'The file re-planned this work; this planned session is replaced. Untick to keep it.';
    case 'missing':
      return e.deletedInFile ? 'Deleted in the imported file. Kept unless you tick it.' : 'Not in this file. Kept unless you tick it.';
    case 'protected': {
      if (!cur) return undefined;
      let why: string;
      if (cur.origin === 'user') why = `You created this ${noun}`;
      else if (cur.locked === true) why = `You pinned this ${noun}`;
      else if (e.collection === 'scheduleBlocks' && isDoneOrSkipped(cur)) why = `This session is marked ${cur.status === 'done' ? 'done' : 'skipped'}`;
      else if (e.collection === 'scheduleBlocks') why = 'This session had already started when the file was made';
      else why = 'This assignment is marked done';
      return `${why}; it is always kept.`;
    }
    default:
      return undefined;
  }
}

function fieldsFor(an: Analysis, e: Entry): FieldChange[] {
  if (!e.cur || !e.file) return [];
  if (e.category === 'unchanged') return [];
  if (!e.takeMode) return diffItem(an, e.collection, e.cur, e.file);
  return e.preview ? diffItem(an, e.collection, e.cur, e.preview) : [];
}

function entryRow(an: Analysis, base: BuildResult, e: Entry): ImportChange {
  const spec = e.rowKey ? an.specs.get(e.rowKey) : undefined;
  // Your own items are named as you know them; updated items by their new version.
  const shown = (e.category === 'kept' || e.category === 'yourItems' ? (e.cur ?? e.file) : (e.preview ?? e.file ?? e.cur))!;
  const row: ImportChange = {
    key: e.key,
    collection: e.collection,
    id: e.id,
    category: e.category,
    label: itemLabel(an, e.collection, shown),
    fields: fieldsFor(an, e),
    defaultSelected: spec ? spec.defaultOn : e.category !== 'kept',
    selectable: spec ? spec.selectable : false,
    aspect: 'item',
  };
  const detail = itemDetail(an, e.collection, shown);
  if (detail) row.detail = detail;
  const adjusted = base.adjustments.get(e.key);
  const reason = [entryReason(an, e), adjusted].filter(Boolean).join(' ');
  if (reason) row.reason = reason;
  // The row whose choice decides this item: the first row in the chain of needed items that is not itself
  // waiting for another one (e.g. a session → its assignment → the previously deleted class).
  let follows = base.needs.get(e.key);
  const seen = new Set<string>([e.key]);
  while (follows && base.needs.has(follows) && !seen.has(follows)) {
    seen.add(follows);
    follows = base.needs.get(follows);
  }
  if (follows) {
    row.follows = follows;
    if (!row.selectable) row.defaultSelected = false;
  }
  if (spec?.blockedReason) row.blockedReason = spec.blockedReason;
  if (e.onFate === 'remove' && e.rowKey) row.removes = true;
  if (e.requested) row.requestedByPerson = e.requested.byPerson;
  if (e.matched) row.relatedId = e.matched.item.id;
  if (e.deletedInFile) row.deletedInFile = true;
  let includes: IncludedItem[] = [];
  if (row.removes) includes = e.removalGroup.map((k) => included(an, an.entryByKey.get(k)!));
  else if (!e.cur && e.rowKey) includes = addDependents(an, [e.id, ...tasksOf(e.file).map((t) => t.id)], e.key);
  else if (e.cur && e.file && e.takeMode && e.category !== 'unchanged') includes = addDependents(an, newTaskIds(e), e.key);
  if (includes.length) row.includes = includes;
  if (e.collection === 'scheduleBlocks' && e.cur && blockEnded(an, e.cur)) {
    const moves =
      e.category === 'updated' &&
      !!e.preview &&
      (stable(norm(e.preview.start, 'other')) !== stable(norm(e.cur.start, 'other')) || stable(norm(e.preview.end, 'other')) !== stable(norm(e.cur.end, 'other')));
    if (moves || row.removes) row.passed = true;
  }
  return row;
}

function sourceStateRow(an: Analysis, e: Entry): ImportChange {
  const spec = an.specs.get(e.sourceStateRow!)!;
  const state = (e.file!.sourceState as 'missing' | 'withdrawn') ?? 'missing';
  const row: ImportChange = {
    key: e.sourceStateRow!,
    collection: 'assignments',
    id: e.id,
    category: 'removedFromSource',
    aspect: 'sourceState',
    label: itemLabel(an, 'assignments', e.preview ?? e.file!),
    fields: [{ field: 'sourceState', label: 'In source', before: SOURCE_STATE_LABELS.present, after: SOURCE_STATE_LABELS[state], group: 'details' }],
    defaultSelected: spec.defaultOn,
    selectable: spec.selectable,
    reason:
      state === 'withdrawn'
        ? 'The source withdrew, cancelled or excused this work. It is no longer planned or counted; untick to keep it as it is.'
        : 'Not found in a newer, complete export of its source. It is no longer planned or counted; untick to keep it as it is.',
  };
  const linked = an.entries.filter((b) => b.linkedTo === e.sourceStateRow).map((b) => included(an, b));
  if (linked.length) row.includes = linked;
  return row;
}

function statusRow(an: Analysis, e: Entry): ImportChange {
  const spec = an.specs.get(e.statusRow!)!;
  const fileStatus = (str(e.file!.status) ?? 'not_started') as keyof typeof WORK_STATUS_LABELS;
  return {
    key: e.statusRow!,
    collection: e.collection,
    id: e.id,
    category: 'kept',
    aspect: 'status',
    label: itemLabel(an, e.collection, e.preview ?? e.file!),
    fields: [{ field: 'status', label: 'Status', before: WORK_STATUS_LABELS.cancelled, after: WORK_STATUS_LABELS[fileStatus], group: 'status' }],
    defaultSelected: spec.defaultOn,
    selectable: spec.selectable,
    reason: `You cancelled this. The file says “${WORK_STATUS_LABELS[fileStatus]}”; tick to take the file's status.`,
  };
}

function deletedRow(an: Analysis, e: Entry): ImportChange {
  const spec = an.specs.get(e.deletedRow!)!;
  const row: ImportChange = {
    key: e.deletedRow!,
    collection: e.collection,
    id: e.id,
    category: 'kept',
    aspect: 'deletedInFile',
    label: itemLabel(an, e.collection, e.cur!),
    fields: [],
    defaultSelected: spec.defaultOn,
    selectable: spec.selectable,
    removes: true,
    deletedInFile: true,
    reason: 'Deleted in the imported file. Kept unless you tick it.',
  };
  if (spec.blockedReason) row.blockedReason = spec.blockedReason;
  if (e.removalGroup.length) row.includes = e.removalGroup.map((k) => included(an, an.entryByKey.get(k)!));
  if (e.collection === 'scheduleBlocks' && blockEnded(an, e.cur!)) row.passed = true;
  return row;
}

function taskRowChange(an: Analysis, r: TaskRow): ImportChange {
  const spec = an.specs.get(r.key)!;
  const task = (r.file ?? r.cur)!;
  let fields: FieldChange[] = [];
  if (r.aspect === 'status' && r.file) {
    const fs = (r.file.status ?? 'not_started') as keyof typeof WORK_STATUS_LABELS;
    fields = [{ field: 'status', label: 'Status', before: WORK_STATUS_LABELS.cancelled, after: WORK_STATUS_LABELS[fs], group: 'status', taskId: r.taskId }];
  } else if (r.cur && r.file) {
    const taken = takeItem(an, 'tasks', r.cur as unknown as Obj, r.file as unknown as Obj, () => false, new Set(), { removedTasks: [] });
    fields = diffItem(an, 'tasks', r.cur as unknown as Obj, taken).map((f) => ({ ...f, taskId: r.taskId }));
  }
  const row: ImportChange = {
    key: r.key,
    collection: 'assignments',
    id: r.taskId,
    parentId: r.assignmentId,
    category: r.category,
    aspect: r.aspect,
    label: `${an.names.asg.get(r.assignmentId) ?? r.assignmentId} › ${task.title}`,
    fields,
    defaultSelected: spec.defaultOn,
    selectable: spec.selectable,
    reason: r.reason,
  };
  if (spec.blockedReason) row.blockedReason = spec.blockedReason;
  if (r.removes) row.removes = true;
  if (r.requested) row.requestedByPerson = r.requested.byPerson;
  if (r.aspect === 'deletedInFile') row.deletedInFile = true;
  if (r.category === 'previouslyDeleted') {
    const includes = addDependents(an, [r.taskId], `tasks:${r.taskId}`);
    if (includes.length) row.includes = includes;
  }
  return row;
}

const SETTING_LABELS: Record<keyof Settings, string> = {
  weekStartsOn: 'Week starts on',
  dayStartTime: 'Timeline starts at',
  dayEndTime: 'Timeline ends at',
  defaultDueTime: 'Time for due dates without a time',
  minSessionMinutes: 'Shortest work session',
  maxSessionMinutes: 'Longest work session',
  breakMinutes: 'Break between sessions',
  maxDailyStudyMinutes: 'Daily study limit',
};

function formatSetting(name: keyof Settings, value: unknown): string {
  if (value === null || value === undefined) return 'No limit';
  if (name === 'weekStartsOn') return value === 'sunday' ? 'Sunday' : 'Monday';
  if (typeof value === 'string') return value === '24:00' ? 'Midnight' : /^\d{2}:\d{2}$/.test(value) ? formatTime12(value) : value;
  if (typeof value === 'number') return formatDuration(value);
  return String(value);
}

function settingRow(an: Analysis, name: keyof Settings): ImportChange {
  const spec = an.specs.get(`settings:${name}`)!;
  const neverSet = an.current.settings?.[name] === undefined;
  return {
    key: `settings:${name}`,
    collection: 'settings',
    id: name,
    category: 'setting',
    aspect: 'setting',
    label: SETTING_LABELS[name],
    fields: [
      {
        field: name,
        label: SETTING_LABELS[name],
        before: formatSetting(name, settingValue(an.current.settings, name)),
        after: formatSetting(name, settingValue(an.incoming.settings, name)),
        group: 'details',
      },
    ],
    defaultSelected: spec.defaultOn,
    selectable: spec.selectable,
    neverSet,
    reason: neverSet ? 'Your schedule uses the default for this setting. Tick to take the file’s value.' : 'Your setting is kept unless you tick this.',
  };
}

function makeRows(an: Analysis, base: BuildResult): ImportChange[] {
  const rows: ImportChange[] = [];
  for (const e of an.entries) {
    rows.push(entryRow(an, base, e));
    if (e.sourceStateRow) rows.push(sourceStateRow(an, e));
    if (e.statusRow) rows.push(statusRow(an, e));
    if (e.deletedRow) rows.push(deletedRow(an, e));
  }
  for (const r of an.taskRows) if (!r.dropped) rows.push(taskRowChange(an, r));
  for (const name of an.settingNames) rows.push(settingRow(an, name));
  const order = new Map(CATEGORIES.map((c, i) => [c, i]));
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => order.get(a.row.category)! - order.get(b.row.category)! || a.i - b.i)
    .map((x) => x.row);
}

// --- Labels -------------------------------------------------------------------

function timeRange(start: string, end: string): string {
  const a = formatTime12(start);
  const b = formatTime12(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

function blockWhen(an: Analysis, start: unknown, end: unknown): string {
  if (!isLdt(start) || !isLdt(end)) return '';
  const s = splitLocalDateTime(start);
  const e = splitLocalDateTime(end);
  const endTime = e.date !== s.date && e.time === '00:00' ? '24:00' : e.time;
  return `${formatDateWithWeekday(s.date, an.year)}, ${timeRange(s.time, endTime)}`;
}

function blockLabel(an: Analysis, b: Obj): string {
  let what: string;
  if (b.kind === 'break') what = text(b.title) ?? 'Break';
  else if (typeof b.assignmentId === 'string') {
    what = an.names.asg.get(b.assignmentId) ?? text(b.title) ?? 'Work';
    if (typeof b.taskId === 'string' && an.names.task.has(b.taskId)) what += ` / ${an.names.task.get(b.taskId)}`;
  } else what = text(b.title) ?? 'Work';
  const when = blockWhen(an, b.start, b.end);
  return when ? `${when} · ${what}` : what;
}

function itemLabel(an: Analysis, c: ItemCollection, x: Obj): string {
  if (c === 'scheduleBlocks') return blockLabel(an, x);
  if (c === 'availability') return text(x.label) ?? 'Study time';
  return itemTitle(c, x);
}

function describeDays(days: unknown): string {
  const list = sortedDays(days);
  if (list.length === 7) return 'Every day';
  if (list.join(',') === 'mon,tue,wed,thu,fri') return 'Mon–Fri';
  if (list.join(',') === 'sat,sun') return 'Sat, Sun';
  return list.map((d) => WEEKDAY_SHORT[d as keyof typeof WEEKDAY_SHORT] ?? d).join(', ');
}

function describeRecurrence(an: Analysis, rec: unknown): string {
  if (!isObj(rec)) return '—';
  const interval = typeof rec.interval === 'number' && rec.interval > 1 ? `every ${rec.interval} weeks` : 'weekly';
  const from = typeof rec.startDate === 'string' && isValidDate(rec.startDate) ? ` from ${formatDateShort(rec.startDate, an.year)}` : '';
  const until = typeof rec.endDate === 'string' && isValidDate(rec.endDate) ? ` until ${formatDateShort(rec.endDate, an.year)}` : '';
  const except = Array.isArray(rec.exceptDates) && rec.exceptDates.length ? ` (except ${plural(rec.exceptDates.length, 'date', 'dates')})` : '';
  return `${describeDays(rec.daysOfWeek)}, ${interval}${from}${until}${except}`;
}

function timeOfDay(x: Obj): string {
  if (x.allDay === true) return 'all day';
  return typeof x.startTime === 'string' && typeof x.endTime === 'string' ? timeRange(x.startTime, x.endTime) : '';
}

function whenText(an: Analysis, x: Obj): string {
  const time = timeOfDay(x);
  if (isObj(x.recurrence)) return `${describeRecurrence(an, x.recurrence)}${time ? `, ${time}` : ''}`;
  if (typeof x.date === 'string' && isValidDate(x.date)) {
    let day = formatDateWithWeekday(x.date, an.year);
    if (typeof x.endDate === 'string' && isValidDate(x.endDate) && x.endDate !== x.date) day += ` – ${formatDateWithWeekday(x.endDate, an.year)}`;
    return `${day}${time ? `, ${time}` : ''}`;
  }
  return time;
}

function fmtDate(an: Analysis, value: unknown): string {
  return typeof value === 'string' && isValidDateOrDateTime(value) ? formatDateOrDateTime(value, an.year) : String(value);
}

function itemDetail(an: Analysis, c: CollectionName, x: Obj): string | undefined {
  const parts: string[] = [];
  if (c === 'classes') {
    if (text(x.teacher)) parts.push(text(x.teacher)!);
    if (text(x.section)) parts.push(text(x.section)!);
  } else if (c === 'assignments') {
    if (typeof x.classId === 'string') parts.push(an.names.cls.get(x.classId) ?? x.classId);
    if (typeof x.due === 'string') parts.push(`Due ${fmtDate(an, x.due)}`);
    if (typeof x.assessmentDate === 'string') {
      const type = (x.type ?? 'homework') as keyof typeof ASSIGNMENT_TYPE_LABELS;
      parts.push(`${ASSESSMENT_TYPES.includes(type) ? ASSIGNMENT_TYPE_LABELS[type] : 'Assessment'} ${fmtDate(an, x.assessmentDate)}`);
    }
    if (typeof x.estimatedMinutes === 'number') parts.push(formatDuration(x.estimatedMinutes));
    const n = tasksOf(x).length;
    if (n) parts.push(plural(n, 'task', 'tasks'));
  } else if (c === 'events' || c === 'availability') {
    const when = whenText(an, x);
    if (when) parts.push(when);
  } else if (c === 'scheduleBlocks') {
    if (x.status === 'done' || x.status === 'skipped') parts.push(BLOCK_STATUS_LABELS[x.status]);
    if (text(x.description)) parts.push(truncate(text(x.description)!, 100));
  }
  return parts.length ? parts.join(' · ') : undefined;
}

// --- Field changes ---------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  name: 'Name',
  label: 'Label',
  teacher: 'Teacher',
  section: 'Section',
  room: 'Room',
  color: 'Color',
  description: 'Description',
  archived: 'Archived',
  topics: 'Topics',
  references: 'References',
  classId: 'Class',
  type: 'Type',
  topic: 'Topic',
  notes: 'Notes',
  due: 'Due date',
  assessmentDate: 'Assessment date',
  recommendedCompletionDate: 'Recommended completion',
  recommendedStartDate: 'Recommended start',
  estimatedMinutes: 'Workload estimate',
  estimateRange: 'Estimate range',
  estimateConfidence: 'Estimate confidence',
  estimateBasis: 'Estimate basis',
  priority: 'Priority',
  status: 'Status',
  completedAt: 'Completed',
  points: 'Points',
  required: 'Required',
  dependsOn: 'Depends on',
  sourceState: 'In source',
  category: 'Category',
  assignmentId: 'Assignment',
  date: 'Date',
  endDate: 'End date',
  recurrence: 'Repeats',
  allDay: 'All day',
  startTime: 'Time',
  busy: 'Busy',
  location: 'Location',
  start: 'Time',
  taskId: 'Task',
  kind: 'Kind',
  locked: 'Pinned',
  overrides: 'Fields you changed',
  source: 'Source',
  sources: 'Other sources',
  issues: 'Issues',
  origin: 'Created by',
};

const FIELD_ORDER = [
  'title',
  'name',
  'label',
  'classId',
  'assignmentId',
  'taskId',
  'type',
  'category',
  'kind',
  'topic',
  'teacher',
  'section',
  'room',
  'color',
  'date',
  'endDate',
  'recurrence',
  'allDay',
  'start',
  'end',
  'startTime',
  'endTime',
  'busy',
  'location',
  'due',
  'assessmentDate',
  'recommendedStartDate',
  'recommendedCompletionDate',
  'estimatedMinutes',
  'estimateRange',
  'estimateConfidence',
  'estimateBasis',
  'priority',
  'status',
  'completedAt',
  'points',
  'required',
  'sourceState',
  'dependsOn',
  'description',
  'notes',
  'topics',
  'references',
  'archived',
  'locked',
  'overrides',
  'source',
  'sources',
  'issues',
  'origin',
];

function groupOf(c: ItemCollection, field: string): FieldGroup {
  if (field === 'due' || field === 'assessmentDate') return 'dueDate';
  if (field === 'estimatedMinutes' || field === 'estimateRange') return 'estimate';
  if (c === 'tasks') return 'tasks';
  if (field === 'title' || field === 'name' || field === 'label') return 'title';
  if (field === 'status' || field === 'completedAt') return 'status';
  if (c === 'scheduleBlocks' && (field === 'start' || field === 'end')) return 'sessionTime';
  if ((c === 'events' || c === 'availability') && ['date', 'endDate', 'recurrence', 'allDay', 'startTime', 'endTime'].includes(field)) return 'eventTime';
  return 'details';
}

function sourceText(s: unknown): string {
  if (!isObj(s)) return '—';
  const kind = SOURCE_KIND_LABELS[s.kind as keyof typeof SOURCE_KIND_LABELS] ?? String(s.kind);
  return text(s.label) ?? (typeof s.id === 'string' ? `${kind} (${s.id})` : kind);
}

function fmtValue(an: Analysis, c: ItemCollection, field: string, value: unknown): string {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
  switch (field) {
    case 'due':
    case 'assessmentDate':
    case 'recommendedCompletionDate':
    case 'recommendedStartDate':
    case 'completedAt':
      return fmtDate(an, value);
    case 'date':
    case 'endDate':
      return typeof value === 'string' && isValidDate(value) ? formatDateWithWeekday(value, an.year) : String(value);
    case 'estimatedMinutes':
      return typeof value === 'number' ? formatDuration(value) : String(value);
    case 'estimateRange':
      return isObj(value) && typeof value.min === 'number' && typeof value.max === 'number'
        ? `${formatDuration(value.min)}–${formatDuration(value.max)}`
        : '—';
    case 'status':
      return c === 'scheduleBlocks'
        ? (BLOCK_STATUS_LABELS[value as keyof typeof BLOCK_STATUS_LABELS] ?? String(value))
        : (WORK_STATUS_LABELS[value as keyof typeof WORK_STATUS_LABELS] ?? String(value));
    case 'priority':
      return PRIORITY_LABELS[value as keyof typeof PRIORITY_LABELS] ?? String(value);
    case 'type':
      return ASSIGNMENT_TYPE_LABELS[value as keyof typeof ASSIGNMENT_TYPE_LABELS] ?? String(value);
    case 'category':
      return EVENT_CATEGORY_LABELS[value as keyof typeof EVENT_CATEGORY_LABELS] ?? String(value);
    case 'sourceState':
      return SOURCE_STATE_LABELS[value as keyof typeof SOURCE_STATE_LABELS] ?? String(value);
    case 'estimateConfidence':
      return typeof value === 'string' ? value.charAt(0).toUpperCase() + value.slice(1) : String(value);
    case 'kind':
      return value === 'break' ? 'Break' : 'Work';
    case 'origin':
      return value === 'user' ? 'You' : value === 'planner' ? 'Website planner' : 'Generated';
    case 'classId':
      return an.names.cls.get(String(value)) ?? String(value);
    case 'assignmentId':
      return an.names.asg.get(String(value)) ?? String(value);
    case 'taskId':
      return an.names.task.get(String(value)) ?? String(value);
    case 'required':
      return value ? 'Required' : 'Optional';
    case 'busy':
      return value ? 'Busy' : 'Free (not busy)';
    case 'allDay':
      return value ? 'All day' : 'At set times';
    case 'archived':
      return value ? 'Archived' : 'Active';
    case 'locked':
      return value ? 'Pinned' : 'Not pinned';
    case 'recurrence':
      return describeRecurrence(an, value);
    case 'references':
      return Array.isArray(value)
        ? truncate(value.map((r) => (isObj(r) ? (text(r.title) ?? '') : '')).join(', '), 120)
        : '—';
    case 'topics':
      return Array.isArray(value) ? truncate(value.join(', '), 120) : String(value);
    case 'dependsOn':
      return Array.isArray(value)
        ? truncate(value.map((id) => an.names.asg.get(String(id)) ?? an.names.task.get(String(id)) ?? String(id)).join(', '), 120)
        : String(value);
    case 'source':
      return sourceText(value);
    case 'sources':
      return Array.isArray(value) ? truncate(value.map(sourceText).join(', '), 120) : '—';
    case 'issues': {
      if (!Array.isArray(value)) return '—';
      const open = value.filter((i) => isObj(i) && (i.status ?? 'open') === 'open').length;
      return `${plural(value.length, 'issue', 'issues')}${open && open !== value.length ? ` (${open} open)` : ''}`;
    }
    case 'overrides':
      return Array.isArray(value) ? value.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join(', ') : String(value);
    default:
      if (typeof value === 'string') return truncate(value, 120);
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      return truncate(JSON.stringify(value), 120);
  }
}

function orderedKeys(keys: Iterable<string>): string[] {
  const all = Array.from(new Set(keys));
  const known = FIELD_ORDER.filter((k) => all.includes(k));
  const rest = all.filter((k) => !FIELD_ORDER.includes(k)).sort();
  return [...known, ...rest];
}

/** Field-level differences between two versions of an item, compared after normalization (§ 16.5). */
function diffItem(an: Analysis, c: ItemCollection, before: Obj, after: Obj): FieldChange[] {
  const ctx = ctxOf(c);
  const nb = norm(before, ctx) as Obj;
  const na = norm(after, ctx) as Obj;
  const changes: FieldChange[] = [];
  const same = (k: string) => stable(nb[k]) === stable(na[k]);
  for (const k of orderedKeys([...Object.keys(nb), ...Object.keys(na)])) {
    if (k === 'id' || k === 'tasks' || k === 'end' || k === 'endTime') continue;
    if (c === 'scheduleBlocks' && k === 'start') {
      if (same('start') && same('end')) continue;
      changes.push({ field: 'start', label: 'Time', before: blockWhen(an, nb.start, nb.end) || '—', after: blockWhen(an, na.start, na.end) || '—', group: 'sessionTime' });
      continue;
    }
    if (k === 'startTime') {
      if (same('startTime') && same('endTime')) continue;
      changes.push({ field: 'startTime', label: 'Time', before: timeOfDay(nb) || '—', after: timeOfDay(na) || '—', group: groupOf(c, k) });
      continue;
    }
    if (same(k)) continue;
    changes.push({ field: k, label: FIELD_LABELS[k] ?? k, before: fmtValue(an, c, k, nb[k]), after: fmtValue(an, c, k, na[k]), group: groupOf(c, k) });
  }
  if (c === 'assignments') changes.push(...diffTasks(an, before.tasks, after.tasks));
  return changes;
}

function taskShort(t: Task): string {
  return `${truncate(t.title, 60)}${typeof t.estimatedMinutes === 'number' ? ` (${formatDuration(t.estimatedMinutes)})` : ''}`;
}

function diffTasks(an: Analysis, before: unknown, after: unknown): FieldChange[] {
  const bt = tasksOf({ tasks: before });
  const at = tasksOf({ tasks: after });
  const bById = new Map(bt.map((t) => [t.id, t]));
  const aById = new Map(at.map((t) => [t.id, t]));
  const out: FieldChange[] = [];
  for (const t of at) {
    const b = bById.get(t.id);
    if (!b) {
      out.push({ field: 'tasks', label: 'New task', before: '—', after: taskShort(t), group: 'tasks', taskId: t.id });
      continue;
    }
    for (const ch of diffItem(an, 'tasks', b as unknown as Obj, t as unknown as Obj)) {
      out.push({ ...ch, field: `tasks.${ch.field}`, label: `Task “${truncate(t.title, 60)}” · ${ch.label}`, taskId: t.id });
    }
  }
  for (const b of bt) if (!aById.has(b.id)) out.push({ field: 'tasks', label: 'Removed task', before: taskShort(b), after: '—', group: 'tasks', taskId: b.id });
  const commonBefore = bt.filter((t) => aById.has(t.id)).map((t) => t.id);
  const commonAfter = at.filter((t) => bById.has(t.id)).map((t) => t.id);
  if (commonBefore.join('\u0000') !== commonAfter.join('\u0000')) {
    const titles = (ids: string[]) => truncate(ids.map((id) => (aById.get(id) ?? bById.get(id))!.title).join(', '), 120);
    out.push({ field: 'tasks', label: 'Task order', before: titles(commonBefore), after: titles(commonAfter), group: 'tasks' });
  }
  return out;
}

const GROUP_WORDS: Record<FieldGroup, [string, string]> = {
  dueDate: ['due date', 'due dates'],
  estimate: ['workload estimate', 'workload estimates'],
  sessionTime: ['session time', 'session times'],
  eventTime: ['commitment time', 'commitment times'],
  tasks: ['task list', 'task lists'],
  title: ['title', 'titles'],
  status: ['status', 'statuses'],
  details: ['other detail', 'other details'],
};

function fieldSummary(rows: ImportChange[]): FieldSummaryEntry[] {
  const counts = new Map<FieldGroup, number>();
  for (const row of rows) {
    if (row.category !== 'updated' || row.parentId || (row.follows && !row.selectable)) continue;
    const groups = new Set(row.fields.map((f) => f.group ?? 'details'));
    for (const g of groups) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const order: FieldGroup[] = ['dueDate', 'estimate', 'sessionTime', 'eventTime', 'tasks', 'title', 'status', 'details'];
  return order
    .filter((g) => counts.has(g))
    .map((g) => {
      const n = counts.get(g)!;
      return { group: g, count: n, text: plural(n, GROUP_WORDS[g][0], GROUP_WORDS[g][1]) };
    });
}

// --- Validation of the merged result (§ 16.1 step 5) --------------------------

const ITEM_PATH = /^(classes|assignments|events|availability|scheduleBlocks)\[(\d+)\](?:\.tasks\[(\d+)\])?/;

function problemKey(an: Analysis, doc: ScheduleDocument, path: string): string | undefined {
  const m = ITEM_PATH.exec(path);
  if (m) {
    const item = itemsOf(doc, m[1] as CollectionName)[Number(m[2])];
    if (!item) return undefined;
    if (m[3] !== undefined) {
      const task = tasksOf(item)[Number(m[3])];
      if (task && an.specs.has(`tasks:${task.id}`)) return `tasks:${task.id}`;
    }
    return `${m[1]}:${item.id}`;
  }
  const s = /^settings(?:\.(\w+))?/.exec(path);
  if (s) {
    if (s[1] && an.specs.has(`settings:${s[1]}`)) return `settings:${s[1]}`;
    const ticked = an.settingNames.find((n) => an.specs.has(`settings:${n}`));
    return ticked ? `settings:${ticked}` : undefined;
  }
  return undefined;
}

function validateResult(an: Analysis, doc: ScheduleDocument): ImportProblem[] {
  let errors: Array<{ path: string; message: string }>;
  try {
    errors = validateDocument(doc, { today: an.now.slice(0, 10) }).errors;
  } catch (err) {
    return [{ path: '', message: `The merged schedule could not be checked: ${err instanceof Error ? err.message : String(err)}` }];
  }
  return errors.map((err) => {
    const key = problemKey(an, doc, err.path);
    return key ? { key, path: err.path, message: err.message } : { path: err.path, message: err.message };
  });
}

function attachProblems(rows: ImportChange[], problems: ImportProblem[]): void {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const p of problems) {
    if (!p.key) continue;
    const row = byKey.get(p.key);
    if (!row) continue;
    // A problem of a task row is also one of its assignment's row: the update of the assignment may cause it.
    const parent = row.parentId ? byKey.get(`assignments:${row.parentId}`) : undefined;
    for (const r of parent ? [row, parent] : [row]) {
      r.problems = [...(r.problems ?? []), p.message];
      // § 16.1 step 5: the person can untick an update that makes the schedule invalid.
      if (r.category === 'updated' && !r.selectable) r.selectable = true;
    }
  }
}

// --- Notes and other changes ------------------------------------------------------

function describeOtherChanges(an: Analysis, result: ScheduleDocument): string[] {
  const out: string[] = [];
  const sig = (i: Issue) => (i.id ? `id:${i.id}` : `c:${issueContentKey(i)}`);
  const before = new Map((an.current.issues ?? []).map((i) => [sig(i), stable(norm(i, 'issue'))]));
  const after = new Map((result.issues ?? []).map((i) => [sig(i), stable(norm(i, 'issue'))]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [k, v] of after) {
    if (!before.has(k)) added++;
    else if (before.get(k) !== v) changed++;
  }
  for (const k of before.keys()) if (!after.has(k)) removed++;
  if (added) out.push(`${plural(added, 'new schedule-wide issue', 'new schedule-wide issues')} to review`);
  if (changed) out.push(`${plural(changed, 'schedule-wide issue', 'schedule-wide issues')} updated`);
  if (removed) out.push(`${plural(removed, 'schedule-wide issue', 'schedule-wide issues')} the file no longer lists`);
  const oldStones = new Set((an.current.deleted ?? []).map((t) => t.id));
  const fileStones = (result.deleted ?? []).filter((t) => !oldStones.has(t.id) && an.fileTombById.has(t.id)).length;
  if (fileStones) out.push(`${plural(fileStones, 'record', 'records')} of items deleted elsewhere (so they are not created again)`);
  const oldTitle = text(an.current.meta?.title);
  const newTitle = text(result.meta?.title);
  if (oldTitle !== newTitle && newTitle) out.push(oldTitle ? `Schedule title: “${oldTitle}” → “${newTitle}”` : `Schedule title: “${newTitle}”`);
  if (stable(norm(an.current.meta?.sources ?? [], 'other')) !== stable(norm(result.meta?.sources ?? [], 'other'))) {
    out.push(`The list of materials this schedule was made from is updated (${plural(result.meta?.sources?.length ?? 0, 'source', 'sources')})`);
  }
  return out;
}

function makeNotes(an: Analysis, base: BuildResult, problems: ImportProblem[], options: ImportOptions): string[] {
  const notes: string[] = [];
  if (an.staleBasedOn) {
    notes.push('This file was made from an older export; changes you made since then are kept where they are protected, but review the list carefully.');
  }
  const zone = text(an.incoming.meta?.timezone);
  if (zone && options.timezone && zone !== options.timezone) {
    notes.push(
      `This file was written for the time zone ${zone}, but this device uses ${options.timezone}. Times are not converted: “4:00 PM” in the file is 4:00 PM on your clock.`,
    );
  }
  if (an.fresh) {
    notes.push('This file was made without your current schedule (it has no meta.basedOn), so scheduled work that it does not contain is kept unless you remove it.');
  }
  const generatedAt = an.incoming.meta?.generatedAt;
  if (generatedAt && isLdt(generatedAt) && an.current.scheduleBlocks.length) {
    const d = splitLocalDateTime(canonLdt(generatedAt));
    notes.push(
      `Sessions are compared with the time the file was made (${formatDateShort(d.date, an.year)}, ${formatTime12(d.time)}): sessions that had started by then are kept as they are.`,
    );
  }
  for (const r of an.unknownRequests) notes.push(`The file lists a change to “${r.id}”, which is not in your schedule or in the file; it is ignored.`);
  if (an.settingNames.length) {
    notes.push(
      `The file's settings differ from yours in ${plural(an.settingNames.length, 'place', 'places')}. Your settings are kept unless you tick them.`,
    );
  }
  const skipped = [...base.adjustments.keys()].filter((k) => base.fate.get(k) === 'skip').length;
  if (skipped) {
    notes.push(
      `${plural(skipped, 'item', 'items')} from the file ${skipped === 1 ? 'depends' : 'depend'} on items that are not added by default; ${skipped === 1 ? 'it follows' : 'they follow'} the choice for ${skipped === 1 ? 'that item' : 'those items'}.`,
    );
  }
  if (problems.length) {
    notes.push('Some changes cannot be combined with your schedule as they are. Untick the highlighted rows, or change the items first, before importing.');
  }
  return notes;
}

function emptySummary(): ImportPlan['summary'] {
  const summary = {} as ImportPlan['summary'];
  for (const c of CATEGORIES) summary[c] = {};
  summary.possibleDuplicate = {};
  return summary;
}

function errorPlan(an: Analysis): ImportPlan {
  return {
    changes: [],
    summary: emptySummary(),
    errors: an.errors,
    notes: [],
    noChanges: false,
    settingsChanged: false,
    referenceTime: an.t,
    importTime: an.now,
    fresh: an.fresh,
    staleBasedOn: an.staleBasedOn,
    taskSummary: {},
    fieldSummary: [],
    otherChanges: [],
    problems: [],
  };
}
