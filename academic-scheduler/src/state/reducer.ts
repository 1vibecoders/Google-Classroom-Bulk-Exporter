// Application state and every change to it, as a pure reducer (unit-tested in
// tests/unit/reducer.test.ts). The React store (store.tsx) persists the result.
//
// Ownership rules (SCHEDULE_FORMAT.md § 6, § 15, § 16):
// - Items created here get origin "user".
// - Editing a field of a generated (or planner) item adds the field name to
//   the item's `overrides`, so later imports and /academic-schedule runs keep the
//   person's value. Status, completedAt and notes are person-owned anyway.
// - Moving or resizing a generated or planner block sets locked: true.
// - Deleting a generated item leaves a tombstone in `deleted`, so a later
//   /academic-schedule run does not re-create it.
import type {
  Assignment,
  AvailabilityWindow,
  BlockStatus,
  CollectionName,
  IssueStatus,
  LocalDateTimeStr,
  ScheduleBlock,
  ScheduleDocument,
  ScheduleEvent,
  SchoolClass,
  Settings,
  Task,
  Tombstone,
  TombstoneCollection,
  WorkStatus,
} from '../model/types';
import { MAX_TOMBSTONES, NON_OVERRIDABLE_FIELDS, SCHEMA_VERSION } from '../model/constants';

export interface Snapshot {
  id: string;
  label: string;
  createdAt: LocalDateTimeStr;
  doc: ScheduleDocument;
}

export interface AppState {
  doc: ScheduleDocument;
  /** Most recent first; restored by "Undo". At most MAX_SNAPSHOTS. */
  snapshots: Snapshot[];
}

export const MAX_SNAPSHOTS = 5;

export function emptyDocument(): ScheduleDocument {
  return { schemaVersion: SCHEMA_VERSION, classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [] };
}

export function initialState(doc: ScheduleDocument = emptyDocument()): AppState {
  return { doc, snapshots: [] };
}

type Collection = CollectionName;

/** Where an issue lives: an item (by collection + id) or the document root. */
export type IssueScope = { collection: Collection; id: string } | null;

export type Action =
  | { type: 'replaceDocument'; doc: ScheduleDocument; label: string; now: LocalDateTimeStr; snapshotId: string }
  | { type: 'upsertClass'; item: SchoolClass }
  /** deleteContents: also delete the class's assignments and events (else they are kept without the class). */
  | { type: 'deleteClass'; id: string; deleteContents: boolean; now: LocalDateTimeStr }
  | { type: 'upsertAssignment'; item: Assignment; now: LocalDateTimeStr }
  | { type: 'deleteAssignment'; id: string; now: LocalDateTimeStr }
  | { type: 'setAssignmentStatus'; id: string; status: WorkStatus; now: LocalDateTimeStr }
  | { type: 'setTaskStatus'; assignmentId: string; taskId: string; status: WorkStatus; now: LocalDateTimeStr }
  | { type: 'upsertEvent'; item: ScheduleEvent }
  | { type: 'deleteEvent'; id: string; now: LocalDateTimeStr }
  | { type: 'upsertAvailability'; item: AvailabilityWindow }
  | { type: 'deleteAvailability'; id: string; now: LocalDateTimeStr }
  | { type: 'upsertBlock'; item: ScheduleBlock }
  | { type: 'addBlocks'; items: ScheduleBlock[] }
  | { type: 'deleteBlocks'; ids: string[]; now: LocalDateTimeStr }
  | { type: 'moveBlock'; id: string; start: LocalDateTimeStr; end: LocalDateTimeStr }
  | { type: 'setBlockStatus'; id: string; status: BlockStatus; now: LocalDateTimeStr }
  | { type: 'setLocked'; collection: Collection; id: string; locked: boolean }
  | { type: 'clearOverrides'; collection: Collection; id: string }
  /** newIssueId (`u-iss-…`) is given to an issue without an id when it is resolved or dismissed (§ 5 Issue). */
  | { type: 'setIssueStatus'; scope: IssueScope; index: number; status: IssueStatus; newIssueId: string }
  | { type: 'updateSettings'; settings: Settings }
  | { type: 'undo'; snapshotId?: string }
  | { type: 'loadState'; state: AppState };

// ---------------------------------------------------------------------------
// Field comparison
// ---------------------------------------------------------------------------

const NOT_OVERRIDABLE = new Set([...NON_OVERRIDABLE_FIELDS, 'tasks']);

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((k) => !isEmpty(record[k])).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  return stableStringify(a) === stableStringify(b);
}

/** Overridable fields whose value differs between two versions of an item. */
export function changedFields(before: object, after: object): string[] {
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (NOT_OVERRIDABLE.has(key) || key.startsWith('x-')) continue;
    if (!sameValue(b[key], a[key])) changed.push(key);
  }
  return changed.sort();
}

function isGeneratedLike(item: { origin?: string }): boolean {
  return (item.origin ?? 'generated') !== 'user';
}

/** Record the person's edits of a generated/planner item in `overrides`. */
function recordOverrides<T extends { origin?: string; overrides?: string[] }>(before: T, after: T): T {
  if (!isGeneratedLike(before)) return after;
  const changed = changedFields(before, after);
  const existing = after.overrides ?? before.overrides ?? [];
  if (!changed.length) {
    if (existing.length && !after.overrides) return { ...after, overrides: existing };
    return after;
  }
  const overrides = Array.from(new Set([...existing, ...changed])).sort();
  return { ...after, overrides };
}

function upsert<T extends { id: string; origin?: string; overrides?: string[] }>(list: T[], item: T): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) return [...list, { ...item, origin: item.origin ?? 'user' }];
  const copy = list.slice();
  copy[index] = recordOverrides(list[index], item);
  return copy;
}

// ---------------------------------------------------------------------------
// Tombstones
// ---------------------------------------------------------------------------

function tombstoneFor(
  collection: TombstoneCollection,
  item: { id: string; origin?: string; source?: { id?: string }; sources?: Array<{ id?: string }>; title?: string; name?: string; label?: string },
  now: LocalDateTimeStr,
): Tombstone | null {
  if ((item.origin ?? 'generated') !== 'generated') return null;
  const stone: Tombstone = { id: item.id, collection, deletedAt: now };
  const sourceId = item.source?.id ?? item.sources?.find((src) => src.id)?.id;
  if (sourceId) stone.sourceId = sourceId;
  const title = item.title ?? item.name ?? item.label;
  if (title) stone.title = title.slice(0, 300);
  return stone;
}

function addTombstones(doc: ScheduleDocument, stones: Array<Tombstone | null>): Tombstone[] | undefined {
  const fresh = stones.filter((s): s is Tombstone => !!s);
  if (!fresh.length) return doc.deleted;
  const ids = new Set(fresh.map((s) => s.id));
  const merged = [...(doc.deleted || []).filter((s) => !ids.has(s.id)), ...fresh];
  if (merged.length <= MAX_TOMBSTONES) return merged;
  // Drop the oldest entries (by deletedAt) beyond the limit (§ 16.4).
  const keep = new Set(
    [...merged].sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0)).slice(0, MAX_TOMBSTONES).map((t) => t.id),
  );
  return merged.filter((t) => keep.has(t.id));
}

function assignmentTombstones(a: Assignment, now: LocalDateTimeStr): Array<Tombstone | null> {
  return [tombstoneFor('assignments', a, now), ...(a.tasks || []).map((t) => tombstoneFor('tasks', t, now))];
}

function withDeleted(doc: ScheduleDocument, deleted: Tombstone[] | undefined): ScheduleDocument {
  if (!deleted || !deleted.length) {
    const { deleted: _drop, ...rest } = doc;
    void _drop;
    return rest;
  }
  return { ...doc, deleted };
}

// ---------------------------------------------------------------------------
// Tasks inside an edited assignment
// ---------------------------------------------------------------------------

function mergeTasks(
  before: Assignment | undefined,
  after: Assignment,
  now: LocalDateTimeStr,
): { tasks: Task[] | undefined; stones: Array<Tombstone | null>; removedIds: string[]; reordered: boolean } {
  const previous = new Map((before?.tasks || []).map((t) => [t.id, t]));
  const nextIds = new Set((after.tasks || []).map((t) => t.id));
  const tasks = (after.tasks || []).map((task) => {
    const old = previous.get(task.id);
    if (!old) return { ...task, origin: task.origin ?? 'user' };
    return recordOverrides(old, task);
  });
  const removed = [...previous.values()].filter((t) => !nextIds.has(t.id));
  const stones = removed.map((t) => tombstoneFor('tasks', t, now));
  // Reordering the tasks that remain is the one edit recorded as `tasks` (§ 6.3).
  const keptBefore = (before?.tasks || []).map((t) => t.id).filter((id) => nextIds.has(id));
  const keptAfter = (after.tasks || []).map((t) => t.id).filter((id) => previous.has(id));
  const reordered = keptBefore.join('\u0000') !== keptAfter.join('\u0000');
  return { tasks: tasks.length ? tasks : undefined, stones, removedIds: removed.map((t) => t.id), reordered };
}

function withoutRootIssuesFor(doc: ScheduleDocument, ids: Set<string>): ScheduleDocument {
  if (!doc.issues || !doc.issues.some((i) => i.itemId && ids.has(i.itemId))) return doc;
  const issues = doc.issues.filter((i) => !i.itemId || !ids.has(i.itemId));
  if (issues.length) return { ...doc, issues };
  const { issues: _drop, ...rest } = doc;
  void _drop;
  return rest;
}

// ---------------------------------------------------------------------------

function withDoc(state: AppState, doc: ScheduleDocument): AppState {
  return { ...state, doc };
}

function setStatusFields<T extends { status?: string; completedAt?: string }>(item: T, status: string, now: LocalDateTimeStr): T {
  const next = { ...item, status } as T;
  if (status === 'done') next.completedAt = item.status === 'done' && item.completedAt ? item.completedAt : now;
  else delete next.completedAt;
  return next;
}

function withoutKey<T extends object, K extends keyof T>(item: T, key: K): Omit<T, K> {
  const copy = { ...item };
  delete copy[key];
  return copy;
}

function removeDependsOn<T extends { dependsOn?: string[] }>(item: T, removed: Set<string>): T {
  if (!item.dependsOn || !item.dependsOn.some((d) => removed.has(d))) return item;
  const dependsOn = item.dependsOn.filter((d) => !removed.has(d));
  return dependsOn.length ? { ...item, dependsOn } : (withoutKey(item, 'dependsOn') as T);
}

/**
 * Remove assignments with their dependents (§ 16.4): blocks, sitting events,
 * dependsOn links and root issues about them, their tasks or their blocks.
 * Generated assignments, their generated tasks and generated sitting events
 * get tombstones; blocks removed with their assignment do not.
 */
function removeAssignments(doc: ScheduleDocument, ids: Set<string>, now: LocalDateTimeStr): ScheduleDocument {
  const removed = doc.assignments.filter((a) => ids.has(a.id));
  const sittings = doc.events.filter((e) => e.assignmentId && ids.has(e.assignmentId));
  const blocks = doc.scheduleBlocks.filter((b) => b.assignmentId && ids.has(b.assignmentId));
  const stones = [...removed.flatMap((a) => assignmentTombstones(a, now)), ...sittings.map((e) => tombstoneFor('events', e, now))];
  const gone = new Set<string>([...ids, ...removed.flatMap((a) => (a.tasks || []).map((t) => t.id)), ...sittings.map((e) => e.id), ...blocks.map((b) => b.id)]);
  const next: ScheduleDocument = {
    ...doc,
    assignments: doc.assignments.filter((a) => !ids.has(a.id)).map((a) => removeDependsOn(a, ids)),
    scheduleBlocks: doc.scheduleBlocks.filter((b) => !b.assignmentId || !ids.has(b.assignmentId)),
    events: doc.events.filter((e) => !e.assignmentId || !ids.has(e.assignmentId)),
  };
  return withDeleted(withoutRootIssuesFor(next, gone), addTombstones(doc, stones));
}

function updateItem<T extends { id: string }>(list: T[], id: string, fn: (item: T) => T): T[] {
  return list.map((item) => (item.id === id ? fn(item) : item));
}

export function reducer(state: AppState, action: Action): AppState {
  const doc = state.doc;
  switch (action.type) {
    case 'loadState':
      return action.state;

    case 'replaceDocument': {
      const snapshot: Snapshot = { id: action.snapshotId, label: action.label, createdAt: action.now, doc };
      return { doc: action.doc, snapshots: [snapshot, ...state.snapshots].slice(0, MAX_SNAPSHOTS) };
    }

    case 'undo': {
      const index = action.snapshotId ? state.snapshots.findIndex((s) => s.id === action.snapshotId) : 0;
      const snapshot = state.snapshots[index];
      if (!snapshot) return state;
      return { doc: snapshot.doc, snapshots: state.snapshots.slice(index + 1) };
    }

    case 'upsertClass':
      return withDoc(state, { ...doc, classes: upsert(doc.classes, action.item) });

    case 'deleteClass': {
      const cls = doc.classes.find((c) => c.id === action.id);
      if (!cls) return state;
      let next: ScheduleDocument = { ...doc, classes: doc.classes.filter((c) => c.id !== action.id) };
      const stones: Array<Tombstone | null> = [tombstoneFor('classes', cls, action.now)];
      if (action.deleteContents) {
        const ids = new Set(doc.assignments.filter((a) => a.classId === action.id).map((a) => a.id));
        next = removeAssignments(next, ids, action.now);
        const events = next.events.filter((e) => e.classId === action.id);
        stones.push(...events.map((e) => tombstoneFor('events', e, action.now)));
        next = withoutRootIssuesFor({ ...next, events: next.events.filter((e) => e.classId !== action.id) }, new Set(events.map((e) => e.id)));
      } else {
        next.assignments = next.assignments.map((a) => (a.classId === action.id ? withoutKey(a, 'classId') : a));
        next.events = next.events.map((e) => (e.classId === action.id ? withoutKey(e, 'classId') : e));
      }
      next = withoutRootIssuesFor(next, new Set([action.id]));
      return withDoc(state, withDeleted(next, addTombstones(next, stones)));
    }

    case 'upsertAssignment': {
      const before = doc.assignments.find((a) => a.id === action.item.id);
      const { tasks, stones, removedIds, reordered } = mergeTasks(before, action.item, action.now);
      let item: Assignment = tasks ? { ...action.item, tasks } : withoutKey(action.item, 'tasks');
      let assignments = upsert(doc.assignments, item);
      if (before && reordered && isGeneratedLike(before)) {
        const overrides = Array.from(new Set([...(item.overrides ?? before.overrides ?? []), 'tasks'])).sort();
        item = { ...assignments.find((a) => a.id === item.id)!, overrides };
        assignments = assignments.map((a) => (a.id === item.id ? item : a));
      }
      // Blocks pointing at tasks that no longer exist lose their taskId.
      const taskIds = new Set((tasks || []).map((t) => t.id));
      const scheduleBlocks = doc.scheduleBlocks.map((b) =>
        b.assignmentId === item.id && b.taskId && !taskIds.has(b.taskId) ? withoutKey(b, 'taskId') : b,
      );
      const next = withoutRootIssuesFor({ ...doc, assignments, scheduleBlocks }, new Set(removedIds));
      return withDoc(state, withDeleted(next, addTombstones(doc, stones)));
    }

    case 'deleteAssignment':
      return withDoc(state, removeAssignments(doc, new Set([action.id]), action.now));

    case 'setAssignmentStatus':
      return withDoc(state, { ...doc, assignments: updateItem(doc.assignments, action.id, (a) => setStatusFields(a, action.status, action.now)) });

    case 'setTaskStatus':
      return withDoc(state, {
        ...doc,
        assignments: updateItem(doc.assignments, action.assignmentId, (a) => ({
          ...a,
          tasks: (a.tasks || []).map((t) => (t.id === action.taskId ? setStatusFields(t, action.status, action.now) : t)),
        })),
      });

    case 'upsertEvent':
      return withDoc(state, { ...doc, events: upsert(doc.events, action.item) });

    case 'deleteEvent': {
      const event = doc.events.find((e) => e.id === action.id);
      if (!event) return state;
      const next = withoutRootIssuesFor({ ...doc, events: doc.events.filter((e) => e.id !== action.id) }, new Set([action.id]));
      return withDoc(state, withDeleted(next, addTombstones(doc, [tombstoneFor('events', event, action.now)])));
    }

    case 'upsertAvailability':
      return withDoc(state, { ...doc, availability: upsert(doc.availability, action.item) });

    case 'deleteAvailability': {
      const win = doc.availability.find((w) => w.id === action.id);
      if (!win) return state;
      const next = withoutRootIssuesFor({ ...doc, availability: doc.availability.filter((w) => w.id !== action.id) }, new Set([action.id]));
      return withDoc(state, withDeleted(next, addTombstones(doc, [tombstoneFor('availability', win, action.now)])));
    }

    case 'upsertBlock':
      return withDoc(state, { ...doc, scheduleBlocks: upsert(doc.scheduleBlocks, action.item) });

    case 'addBlocks':
      return withDoc(state, {
        ...doc,
        scheduleBlocks: [...doc.scheduleBlocks, ...action.items.map((b) => ({ ...b, origin: b.origin ?? 'user' }))],
      });

    case 'deleteBlocks': {
      const ids = new Set(action.ids);
      const removed = doc.scheduleBlocks.filter((b) => ids.has(b.id));
      if (!removed.length) return state;
      const next = withoutRootIssuesFor({ ...doc, scheduleBlocks: doc.scheduleBlocks.filter((b) => !ids.has(b.id)) }, ids);
      return withDoc(state, withDeleted(next, addTombstones(doc, removed.map((b) => tombstoneFor('scheduleBlocks', b, action.now)))));
    }

    case 'moveBlock':
      return withDoc(state, {
        ...doc,
        scheduleBlocks: updateItem(doc.scheduleBlocks, action.id, (b) => {
          const moved: ScheduleBlock = { ...b, start: action.start, end: action.end };
          if (isGeneratedLike(b)) moved.locked = true;
          return moved;
        }),
      });

    case 'setBlockStatus':
      return withDoc(state, { ...doc, scheduleBlocks: updateItem(doc.scheduleBlocks, action.id, (b) => setStatusFields(b, action.status, action.now)) });

    case 'setLocked': {
      const list = doc[action.collection] as Array<{ id: string; locked?: boolean }>;
      const updated = updateItem(list, action.id, (item) => (action.locked ? { ...item, locked: true } : withoutKey(item, 'locked')));
      return withDoc(state, { ...doc, [action.collection]: updated } as ScheduleDocument);
    }

    case 'clearOverrides': {
      const list = doc[action.collection] as Array<{ id: string; overrides?: string[]; tasks?: Task[] }>;
      const updated = updateItem(list, action.id, (item) => {
        const next = withoutKey(item, 'overrides') as typeof item;
        if (next.tasks) next.tasks = next.tasks.map((t) => withoutKey(t, 'overrides'));
        return next;
      });
      return withDoc(state, { ...doc, [action.collection]: updated } as ScheduleDocument);
    }

    case 'setIssueStatus': {
      const apply = <T extends { issues?: ScheduleDocument['issues'] }>(holder: T): T => {
        const issues = (holder.issues || []).map((issue, i) => {
          if (i !== action.index) return issue;
          if (action.status === 'open') return withoutKey(issue, 'status');
          return { ...issue, id: issue.id ?? action.newIssueId, status: action.status };
        });
        return { ...holder, issues };
      };
      if (!action.scope) return withDoc(state, apply(doc));
      const { collection, id } = action.scope;
      const list = doc[collection] as Array<{ id: string; issues?: ScheduleDocument['issues'] }>;
      return withDoc(state, { ...doc, [collection]: updateItem(list, id, apply) } as ScheduleDocument);
    }

    case 'updateSettings': {
      const settings = { ...(doc.settings || {}), ...action.settings };
      for (const key of Object.keys(settings) as Array<keyof Settings>) {
        if (settings[key] === undefined) delete settings[key];
      }
      return withDoc(state, { ...doc, settings });
    }

    default:
      return state;
  }
}
