// Tests for the import preview and merge (SCHEDULE_FORMAT.md § 16).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyImport,
  checkImport,
  defaultSelection,
  formatCounts,
  planImport,
  summaryLines,
  type ImportChange,
  type ImportOptions,
  type ImportPlan,
} from '../../src/lib/importDiff';
import { exportDocument } from '../../src/lib/exportSchedule';
import { validateDocument } from '../../src/lib/validate';
import { emptyDocument, initialState, reducer, type Action, type AppState } from '../../src/state/reducer';
import type { Assignment, Meta, ScheduleBlock, ScheduleDocument, ScheduleEvent, SchoolClass, Task, AvailabilityWindow } from '../../src/model/types';

const here = dirname(fileURLToPath(import.meta.url));
const TODAY = '2026-10-07';
/** Import time. */
const NOW = '2026-10-11T20:00:00';
/** The file's meta.generatedAt ("now" for past/future decisions). */
const GEN = '2026-10-11T19:30:00';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function docOf(partial: Partial<ScheduleDocument>): ScheduleDocument {
  return { schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], ...clone(partial) };
}

function valid(doc: unknown): ScheduleDocument {
  const result = validateDocument(doc, { today: TODAY });
  if (!result.ok) throw new Error(`invalid test document: ${JSON.stringify(result.errors, null, 1)}`);
  return result.doc!;
}

const GEN_META: Meta = {
  generatedAt: GEN,
  generator: { name: 'academic-schedule-skill', version: '1.0' },
  timezone: 'America/New_York',
  basedOn: 'u-exp-base0001',
};

/** A file written by a generator that was given the current schedule (has meta.basedOn). */
function genFile(partial: Partial<ScheduleDocument>, meta: Partial<Meta> = {}): ScheduleDocument {
  return valid(docOf({ ...partial, meta: { ...GEN_META, ...(partial.meta ?? {}), ...meta } }));
}

/** A file made without the current schedule (no meta.basedOn). */
function freshFile(partial: Partial<ScheduleDocument>, meta: Partial<Meta> = {}): ScheduleDocument {
  const m: Meta = { ...GEN_META, ...(partial.meta ?? {}), ...meta };
  delete m.basedOn;
  return valid(docOf({ ...partial, meta: m }));
}

function row(plan: ImportPlan, key: string): ImportChange {
  const found = plan.changes.find((c) => c.key === key);
  if (!found) throw new Error(`no row ${key}; rows: ${plan.changes.map((c) => `${c.key}(${c.category})`).join(', ')}`);
  return found;
}

function hasRow(plan: ImportPlan, key: string): boolean {
  return plan.changes.some((c) => c.key === key);
}

interface RunOptions {
  select?: string[];
  unselect?: string[];
  options?: ImportOptions;
  now?: string;
}

/** Plan, apply (default selection ± changes), and check that the result is valid. */
function run(current: ScheduleDocument, incoming: ScheduleDocument, opts: RunOptions = {}): { plan: ImportPlan; doc: ScheduleDocument } {
  const now = opts.now ?? NOW;
  const plan = planImport(current, incoming, now, opts.options);
  expect(plan.errors).toEqual([]);
  const selected = defaultSelection(plan);
  for (const key of opts.select ?? []) {
    expect(row(plan, key).selectable, `${key} should be selectable`).toBe(true);
    selected.add(key);
  }
  for (const key of opts.unselect ?? []) selected.delete(key);
  const doc = applyImport(current, incoming, plan, selected, now);
  const check = checkImport(current, incoming, plan, selected, now);
  expect(check.doc).toEqual(doc);
  expect(check.problems).toEqual([]);
  expect(check.ok).toBe(true);
  expect(validateDocument(doc, { today: TODAY }).errors).toEqual([]);
  return { plan, doc };
}

/** Importing the same file again changes nothing (§ 16.1). */
function expectIdempotent(doc: ScheduleDocument, incoming: ScheduleDocument, now = NOW): ImportPlan {
  const again = planImport(doc, incoming, now);
  const effective = again.changes.filter((c) => c.defaultSelected && !['unchanged', 'protected'].includes(c.category));
  expect(effective.map((c) => `${c.key} ${c.category} ${JSON.stringify(c.fields)}`)).toEqual([]);
  expect(again.noChanges).toBe(true);
  const reapplied = applyImport(doc, incoming, again, defaultSelection(again), now);
  expect(reapplied).toEqual(doc);
  return again;
}

const asg = (doc: ScheduleDocument, id: string) => doc.assignments.find((a) => a.id === id);
const blk = (doc: ScheduleDocument, id: string) => doc.scheduleBlocks.find((b) => b.id === id);
const evt = (doc: ScheduleDocument, id: string) => doc.events.find((e) => e.id === id);
const cls = (doc: ScheduleDocument, id: string) => doc.classes.find((c) => c.id === id);

// ---------------------------------------------------------------------------
// A small realistic schedule
// ---------------------------------------------------------------------------

const CLS_ENG: SchoolClass = {
  id: 'gc-class-eng',
  name: 'English 10',
  teacher: 'Ms. Rivera',
  origin: 'generated',
  source: { kind: 'google_classroom', id: 'ENG', retrievedAt: '2026-10-11T18:05:00' },
};
const CLS_BIO: SchoolClass = { id: 'cls-biology', name: 'Biology', origin: 'generated', source: { kind: 'syllabus', label: 'Biology syllabus.pdf' } };
const ESSAY: Assignment = {
  id: 'gc-essay',
  classId: 'gc-class-eng',
  title: 'Othello Essay',
  type: 'writing',
  due: '2026-10-16T23:59:00',
  estimatedMinutes: 240,
  priority: 'high',
  origin: 'generated',
  source: { kind: 'google_classroom', id: 'ESSAY' },
  tasks: [
    { id: 'gc-essay-t1', title: 'Thesis and quotations', estimatedMinutes: 30, status: 'done', completedAt: '2026-10-10T10:30:00' },
    { id: 'gc-essay-t2', title: 'Outline', estimatedMinutes: 30, dependsOn: ['gc-essay-t1'] },
    { id: 'gc-essay-t3', title: 'Draft', estimatedMinutes: 120, dependsOn: ['gc-essay-t2'] },
    { id: 'gc-essay-t4', title: 'Revise', estimatedMinutes: 60, dependsOn: ['gc-essay-t3'] },
  ],
};
const READING: Assignment = {
  id: 'gc-read3',
  classId: 'gc-class-eng',
  title: 'Read Act 3',
  type: 'reading',
  due: '2026-10-13',
  estimatedMinutes: 50,
  origin: 'generated',
  source: { kind: 'google_classroom', id: 'READ3' },
};
const TEST: Assignment = {
  id: 'biology-unit-2-test-2026-10-16',
  classId: 'cls-biology',
  title: 'Unit 2 Test',
  type: 'test',
  assessmentDate: '2026-10-16T09:10:00',
  estimatedMinutes: 150,
  origin: 'generated',
  source: { kind: 'syllabus', label: 'Biology syllabus.pdf' },
};
const LIB: Assignment = { id: 'u-asg-lib00001', title: 'Return library books', type: 'other', due: '2026-10-15', estimatedMinutes: 15, origin: 'user' };
const SCHOOL: ScheduleEvent = {
  id: 'u-evt-school01',
  title: 'School',
  category: 'school',
  startTime: '08:00',
  endTime: '15:00',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' },
  origin: 'user',
};
const FENCING: ScheduleEvent = {
  id: 'evt-fencing',
  title: 'Fencing',
  category: 'activity',
  startTime: '16:00',
  endTime: '18:00',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05' },
  origin: 'generated',
  source: { kind: 'user', label: 'Told /academic-schedule on 2026-10-09' },
};
const AFTER: AvailabilityWindow = {
  id: 'u-avl-after001',
  label: 'After school',
  startTime: '15:30',
  endTime: '21:30',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' },
  origin: 'user',
};
const B_DONE: ScheduleBlock = {
  id: 'blk-essay-1',
  assignmentId: 'gc-essay',
  taskId: 'gc-essay-t1',
  start: '2026-10-10T10:00:00',
  end: '2026-10-10T10:30:00',
  status: 'done',
  completedAt: '2026-10-10T10:30:00',
  origin: 'generated',
};
/** Past (before GEN) and still planned. */
const B_PAST: ScheduleBlock = { id: 'blk-read-1', assignmentId: 'gc-read3', start: '2026-10-11T16:00:00', end: '2026-10-11T16:50:00', origin: 'generated' };
const B_FUT1: ScheduleBlock = {
  id: 'blk-essay-2',
  assignmentId: 'gc-essay',
  taskId: 'gc-essay-t2',
  start: '2026-10-12T19:30:00',
  end: '2026-10-12T20:00:00',
  description: 'Outline: thesis and three claims.',
  origin: 'generated',
};
const B_FUT2: ScheduleBlock = { id: 'blk-essay-3', assignmentId: 'gc-essay', taskId: 'gc-essay-t3', start: '2026-10-13T16:30:00', end: '2026-10-13T17:20:00', origin: 'generated' };
const B_READ2: ScheduleBlock = { id: 'blk-read-2', assignmentId: 'gc-read3', start: '2026-10-12T18:30:00', end: '2026-10-12T19:20:00', origin: 'generated' };
const B_TEST1: ScheduleBlock = { id: 'blk-test-1', assignmentId: 'biology-unit-2-test-2026-10-16', start: '2026-10-14T15:30:00', end: '2026-10-14T16:15:00', origin: 'generated' };
const B_USER: ScheduleBlock = { id: 'u-blk-lib00001', assignmentId: 'u-asg-lib00001', start: '2026-10-14T15:00:00', end: '2026-10-14T15:15:00', origin: 'user' };

const BASE = docOf({
  classes: [CLS_ENG, CLS_BIO],
  assignments: [ESSAY, READING, TEST, LIB],
  events: [SCHOOL, FENCING],
  availability: [AFTER],
  scheduleBlocks: [B_DONE, B_PAST, B_FUT1, B_FUT2, B_READ2, B_TEST1, B_USER],
});

function current(mutate?: (d: ScheduleDocument) => void): ScheduleDocument {
  const d = clone(BASE);
  mutate?.(d);
  return valid(d);
}

/** A generator's copy of the current schedule (basedOn), changed by `mutate`. */
function generated(mutate?: (d: ScheduleDocument) => void, meta: Partial<Meta> = {}): ScheduleDocument {
  const d = clone(BASE);
  mutate?.(d);
  return genFile(d, meta);
}

function fresh(mutate?: (d: ScheduleDocument) => void, meta: Partial<Meta> = {}): ScheduleDocument {
  const d = clone(BASE);
  mutate?.(d);
  return freshFile(d, meta);
}

const essayOf = (d: ScheduleDocument) => d.assignments.find((a) => a.id === 'gc-essay')!;

// ===========================================================================
// Categories (§ 16.2)
// ===========================================================================

describe('categories', () => {
  it('adds new items and reports them as New', () => {
    const file = freshFile({ classes: [CLS_ENG], assignments: [READING], scheduleBlocks: [B_READ2] });
    const { plan, doc } = run(emptyDocument(), file);
    expect(row(plan, 'classes:gc-class-eng').category).toBe('new');
    expect(row(plan, 'assignments:gc-read3').category).toBe('new');
    expect(row(plan, 'scheduleBlocks:blk-read-2').category).toBe('new');
    expect(row(plan, 'scheduleBlocks:blk-read-2').selectable).toBe(false);
    expect(row(plan, 'scheduleBlocks:blk-read-2').defaultSelected).toBe(true);
    expect(plan.summary.new).toEqual({ classes: 1, assignments: 1, scheduleBlocks: 1 });
    expect(formatCounts(plan.summary.new)).toEqual(['1 class', '1 assignment', '1 scheduled work block']);
    expect(doc.assignments.map((a) => a.id)).toEqual(['gc-read3']);
    expect(plan.noChanges).toBe(false);
    expectIdempotent(doc, file);
  });

  it('reports re-importing the same file as no changes', () => {
    const cur = current();
    const file = generated();
    const plan = planImport(cur, file, NOW);
    expect(plan.noChanges).toBe(true);
    expect(new Set(plan.changes.map((c) => c.category))).toEqual(new Set(['unchanged']));
    expect(plan.summary.unchanged).toEqual({ classes: 2, assignments: 4, events: 2, availability: 1, scheduleBlocks: 7 });
  });

  it('lists updated fields with human-readable before/after values and summary groups', () => {
    const cur = current();
    const file = generated((d) => {
      d.assignments[0].due = '2026-10-17T23:59:00';
      d.assignments[1].estimatedMinutes = 60;
      d.assignments[2].title = 'Unit 2 Test: Cells';
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-3')!.start = '2026-10-13T16:00:00';
      d.events[1].endTime = '18:30';
    });
    const { plan, doc } = run(cur, file);
    const essay = row(plan, 'assignments:gc-essay');
    expect(essay.category).toBe('updated');
    expect(essay.fields).toEqual([{ field: 'due', label: 'Due date', before: 'Oct 16, 11:59 PM', after: 'Oct 17, 11:59 PM', group: 'dueDate' }]);
    expect(row(plan, 'assignments:gc-read3').fields).toEqual([
      { field: 'estimatedMinutes', label: 'Workload estimate', before: '50 m', after: '1 h', group: 'estimate' },
    ]);
    expect(row(plan, 'scheduleBlocks:blk-essay-3').fields).toEqual([
      { field: 'start', label: 'Time', before: 'Tue, Oct 13, 4:30–5:20 PM', after: 'Tue, Oct 13, 4:00–5:20 PM', group: 'sessionTime' },
    ]);
    expect(row(plan, 'events:evt-fencing').fields).toEqual([{ field: 'startTime', label: 'Time', before: '4:00–6:00 PM', after: '4:00–6:30 PM', group: 'eventTime' }]);
    expect(row(plan, 'assignments:biology-unit-2-test-2026-10-16').label).toBe('Unit 2 Test: Cells');
    expect(plan.fieldSummary).toEqual([
      { group: 'dueDate', count: 1, text: '1 due date' },
      { group: 'estimate', count: 1, text: '1 workload estimate' },
      { group: 'sessionTime', count: 1, text: '1 session time' },
      { group: 'eventTime', count: 1, text: '1 commitment time' },
      { group: 'title', count: 1, text: '1 title' },
    ]);
    expect(plan.summary.updated).toEqual({ assignments: 3, events: 1, scheduleBlocks: 1 });
    expect(summaryLines(plan).map((l) => l.text)).toEqual([
      'Updated: ~ 1 due date  ~ 1 workload estimate  ~ 1 session time  ~ 1 commitment time  ~ 1 title',
      'Unchanged: 11 items',
    ]);
    expect(essayOf(doc).due).toBe('2026-10-17T23:59:00');
    expect(blk(doc, 'blk-essay-3')!.start).toBe('2026-10-13T16:00:00');
    expectIdempotent(doc, file);
  });

  it('compares after normalization: defaults, empty arrays, seconds, trimming and key order (§ 16.5)', () => {
    const cur = current((d) => {
      d.assignments[1].due = '2026-10-13';
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-2')!.start = '2026-10-12T19:30';
    });
    // Not validated on purpose: planImport must normalize on its own.
    const file = clone(cur);
    file.meta = { ...GEN_META };
    const reading = file.assignments[1] as unknown as Record<string, unknown>;
    file.assignments[1] = {
      sourceState: 'present',
      required: true,
      status: 'not_started',
      priority: 'medium',
      overrides: [],
      references: [],
      tasks: [],
      locked: false,
      ...reading,
      title: '  Read Act 3  ',
    } as unknown as Assignment;
    const b = file.scheduleBlocks.find((x) => x.id === 'blk-essay-2')!;
    b.start = '2026-10-12T19:30:00';
    b.kind = 'work';
    b.status = 'planned';
    file.events[1] = { ...file.events[1], busy: true, allDay: false, category: 'activity' };
    file.events[1].recurrence = { ...file.events[1].recurrence!, interval: 1, exceptDates: [] };
    const plan = planImport(cur, file, NOW);
    expect(row(plan, 'assignments:gc-read3').category).toBe('unchanged');
    expect(row(plan, 'scheduleBlocks:blk-essay-2').category).toBe('unchanged');
    expect(row(plan, 'events:evt-fencing').category).toBe('unchanged');
    expect(plan.noChanges).toBe(true);
  });

  it('keeps your own and pinned items unless the file’s version is ticked (Kept (your version) a)', () => {
    const cur = current((d) => {
      d.scheduleBlocks.find((b) => b.id === 'blk-test-1')!.locked = true;
    });
    const file = generated((d) => {
      d.assignments.find((a) => a.id === 'u-asg-lib00001')!.due = '2026-10-16';
      const t = d.scheduleBlocks.find((b) => b.id === 'blk-test-1')!;
      t.locked = true;
      t.start = '2026-10-14T16:00:00';
      t.end = '2026-10-14T16:45:00';
    });
    const kept = run(cur, file);
    const lib = row(kept.plan, 'assignments:u-asg-lib00001');
    expect(lib.category).toBe('kept');
    expect(lib.selectable).toBe(true);
    expect(lib.defaultSelected).toBe(false);
    expect(lib.fields).toEqual([{ field: 'due', label: 'Due date', before: 'Oct 15', after: 'Oct 16', group: 'dueDate' }]);
    expect(lib.reason).toMatch(/You created this assignment/);
    expect(row(kept.plan, 'scheduleBlocks:blk-test-1').category).toBe('kept');
    expect(row(kept.plan, 'scheduleBlocks:blk-test-1').reason).toMatch(/pinned/);
    expect(asg(kept.doc, 'u-asg-lib00001')!.due).toBe('2026-10-15');
    expect(blk(kept.doc, 'blk-test-1')!.start).toBe('2026-10-14T15:30:00');
    expectIdempotent(kept.doc, file);

    const taken = run(cur, file, { select: ['assignments:u-asg-lib00001', 'scheduleBlocks:blk-test-1'] });
    expect(asg(taken.doc, 'u-asg-lib00001')).toMatchObject({ due: '2026-10-16', origin: 'user' });
    expect(blk(taken.doc, 'blk-test-1')).toMatchObject({ start: '2026-10-14T16:00:00', locked: true });
    expectIdempotent(taken.doc, file);
  });

  it('shows done/skipped blocks the file changes as Kept, not selectable (history)', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push({ id: 'blk-test-0', assignmentId: TEST.id, start: '2026-10-09T15:30:00', end: '2026-10-09T16:00:00', status: 'skipped', origin: 'generated' });
    });
    const file = generated((d) => {
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-1')!.status = 'planned';
      delete d.scheduleBlocks.find((b) => b.id === 'blk-essay-1')!.completedAt;
      d.scheduleBlocks.push({ id: 'blk-test-0', assignmentId: TEST.id, start: '2026-10-09T15:30:00', end: '2026-10-09T16:10:00', status: 'done', origin: 'generated' });
    });
    const plan = planImport(cur, file, NOW);
    const r = row(plan, 'scheduleBlocks:blk-essay-1');
    expect(r.category).toBe('kept');
    expect(r.selectable).toBe(false);
    expect(r.defaultSelected).toBe(false);
    expect(r.fields.map((f) => f.field)).toEqual(['status', 'completedAt']);
    expect(row(plan, 'scheduleBlocks:blk-test-0').category).toBe('kept');
    // Even when a UI passes the key, the block stays as it is.
    const doc = applyImport(cur, file, plan, new Set(['scheduleBlocks:blk-essay-1', 'scheduleBlocks:blk-test-0']), NOW);
    expect(blk(doc, 'blk-essay-1')).toEqual(blk(cur, 'blk-essay-1'));
    expect(blk(doc, 'blk-test-0')).toEqual(blk(cur, 'blk-test-0'));
    expect(plan.noChanges).toBe(true);
  });

  it('offers changes to your items listed in meta.requestedChanges, pre-ticked when the person asked', () => {
    const cur = current();
    const make = (byPerson: boolean) =>
      generated(
        (d) => {
          d.events[0].recurrence!.exceptDates = ['2026-10-12'];
        },
        { requestedChanges: [{ id: 'u-evt-school01', reason: 'No school on Oct 12 (holiday).', requestedByPerson: byPerson }] },
      );
    const suggested = run(cur, make(false));
    const r = row(suggested.plan, 'events:u-evt-school01');
    expect(r.category).toBe('yourItems');
    expect(r.defaultSelected).toBe(false);
    expect(r.requestedByPerson).toBe(false);
    expect(r.reason).toBe('The file changes your event: No school on Oct 12 (holiday).');
    expect(r.fields[0]).toMatchObject({ field: 'recurrence', group: 'eventTime' });
    expect(evt(suggested.doc, 'u-evt-school01')!.recurrence!.exceptDates).toBeUndefined();

    const asked = run(cur, make(true));
    expect(row(asked.plan, 'events:u-evt-school01').defaultSelected).toBe(true);
    expect(evt(asked.doc, 'u-evt-school01')).toMatchObject({ origin: 'user', recurrence: { exceptDates: ['2026-10-12'] } });
    expectIdempotent(asked.doc, make(true));
    // Requested changes are used for the preview only and never stored.
    expect(asked.doc.meta?.requestedChanges).toBeUndefined();
  });

  it('removes your items only through a requested change, with their dependents or not at all', () => {
    const cur = current((d) => {
      d.events.push({ id: 'u-evt-dentist1', title: 'Dentist', date: '2026-10-20', startTime: '15:00', endTime: '16:00', origin: 'user' });
      d.events.push({ ...FENCING, id: 'evt-chess', title: 'Chess club', locked: true });
    });
    const file = generated(
      (d) => {
        d.assignments = d.assignments.filter((a) => a.id !== 'u-asg-lib00001');
        d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'u-blk-lib00001');
        d.events = d.events.filter((e) => e.id === 'u-evt-school01' || e.id === 'evt-fencing');
      },
      {
        requestedChanges: [
          { id: 'u-asg-lib00001', reason: 'You returned the books.', requestedByPerson: true },
          { id: 'u-evt-dentist1', reason: 'You cancelled the dentist.', requestedByPerson: true },
          { id: 'evt-chess', reason: 'Chess club ended.', requestedByPerson: true },
        ],
      },
    );
    const { plan, doc } = run(cur, file);
    // The library assignment still has one of your own blocks, which is not listed.
    const lib = row(plan, 'assignments:u-asg-lib00001');
    expect(lib.category).toBe('yourItems');
    expect(lib.removes).toBe(true);
    expect(lib.selectable).toBe(false);
    expect(lib.blockedReason).toBe('1 of your own scheduled work blocks belongs to this assignment.');
    expect(row(plan, 'scheduleBlocks:u-blk-lib00001').category).toBe('protected');
    expect(asg(doc, 'u-asg-lib00001')).toBeDefined();
    expect(row(plan, 'events:u-evt-dentist1')).toMatchObject({ category: 'yourItems', removes: true, defaultSelected: true });
    expect(evt(doc, 'u-evt-dentist1')).toBeUndefined();
    expect(evt(doc, 'evt-chess')).toBeUndefined();
    // A pinned generated item removed on request gets a tombstone; your own items do not.
    expect(doc.deleted).toEqual([{ id: 'evt-chess', collection: 'events', deletedAt: NOW, title: 'Chess club' }]);
    expectIdempotent(doc, file);

    // When the block is listed too, both go together in one row.
    const both = generated(
      (d) => {
        d.assignments = d.assignments.filter((a) => a.id !== 'u-asg-lib00001');
        d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'u-blk-lib00001');
      },
      {
        requestedChanges: [
          { id: 'u-asg-lib00001', reason: 'You returned the books.', requestedByPerson: true },
          { id: 'u-blk-lib00001', reason: 'Not needed any more.', requestedByPerson: true },
        ],
      },
    );
    const r2 = run(current(), both);
    expect(row(r2.plan, 'assignments:u-asg-lib00001').includes?.map((i) => i.key)).toEqual(['scheduleBlocks:u-blk-lib00001']);
    expect(asg(r2.doc, 'u-asg-lib00001')).toBeUndefined();
    expect(blk(r2.doc, 'u-blk-lib00001')).toBeUndefined();
    expect(r2.doc.deleted).toBeUndefined();
  });

  it('does not restore previously deleted items unless ticked (by ID or by source ID)', () => {
    const cur = current((d) => {
      d.deleted = [
        { id: 'gc-ws3', collection: 'assignments', deletedAt: '2026-10-10T16:12:00', sourceId: 'WS3', title: 'Worksheet 3' },
        { id: 'gc-quiz', collection: 'assignments', deletedAt: '2026-10-09T08:00:00', sourceId: 'QUIZ', title: 'Quiz' },
      ];
    });
    const ws3: Assignment = { id: 'gc-ws3', classId: 'gc-class-eng', title: 'Worksheet 3', due: '2026-10-14', origin: 'generated', source: { kind: 'google_classroom', id: 'WS3' } };
    const quizAgain: Assignment = {
      id: 'gc-quiz-b',
      classId: 'gc-class-eng',
      title: 'Vocabulary quiz',
      type: 'quiz',
      due: '2026-10-15',
      origin: 'generated',
      source: { kind: 'google_classroom', id: 'OTHER' },
      sources: [{ kind: 'google_classroom', id: 'QUIZ' }],
    };
    const wsBlock: ScheduleBlock = { id: 'blk-ws3-1', assignmentId: 'gc-ws3', start: '2026-10-13T18:00:00', end: '2026-10-13T18:30:00', origin: 'generated' };
    const file = generated((d) => {
      d.assignments.push(ws3, quizAgain);
      d.scheduleBlocks.push(wsBlock);
      // The generator re-created gc-ws3 (so its tombstone cannot stay in the file) and kept the quiz's.
      d.deleted = cur.deleted!.filter((t) => t.id !== 'gc-ws3');
    });
    const skipped = run(cur, file);
    const r = row(skipped.plan, 'assignments:gc-ws3');
    expect(r).toMatchObject({ category: 'previouslyDeleted', selectable: true, defaultSelected: false });
    expect(r.reason).toBe('You deleted this assignment on Oct 10. Tick to restore it.');
    expect(r.includes?.map((i) => i.key)).toEqual(['scheduleBlocks:blk-ws3-1']);
    expect(row(skipped.plan, 'assignments:gc-quiz-b').category).toBe('previouslyDeleted');
    expect(row(skipped.plan, 'assignments:gc-quiz-b').reason).toMatch(/You deleted “Quiz” on Oct 9, which came from the same source/);
    expect(asg(skipped.doc, 'gc-ws3')).toBeUndefined();
    expect(blk(skipped.doc, 'blk-ws3-1')).toBeUndefined();
    expect(skipped.doc.deleted?.map((t) => t.id)).toEqual(['gc-ws3', 'gc-quiz']);
    expectIdempotent(skipped.doc, file);

    const restored = run(cur, file, { select: ['assignments:gc-ws3', 'assignments:gc-quiz-b'] });
    expect(asg(restored.doc, 'gc-ws3')).toBeDefined();
    expect(blk(restored.doc, 'blk-ws3-1')).toBeDefined();
    expect(asg(restored.doc, 'gc-quiz-b')).toBeDefined();
    expect(restored.doc.deleted).toBeUndefined();
    expectIdempotent(restored.doc, file);
  });

  it('flags possible duplicates under § 15.3 rules 2 and 3, with the exclusions', () => {
    const cur = current((d) => {
      d.assignments.push({ id: 'english-vocab-quiz-2026-10-16', classId: 'gc-class-eng', title: 'Vocab quiz', type: 'quiz', due: '2026-10-16', origin: 'generated' });
      d.events.push({ ...FENCING, id: 'evt-swim', title: 'Swim', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', endDate: '2026-10-08' } });
    });
    const add = (d: ScheduleDocument) => {
      const base = { classId: 'gc-class-eng', origin: 'generated' as const };
      d.assignments.push(
        // rule 2: same Classroom item under another ID
        { ...base, id: 'gc-read3-again', title: 'Reading: Act 3', type: 'reading', due: '2026-10-20', source: { kind: 'google_classroom', id: 'READ3' } },
        // rule 3: same class, family, normalized title; 1 day apart
        { ...base, id: 'english-read-act-3-2026-10-14', title: 'Read act 3!', type: 'homework', due: '2026-10-14' },
        // 7 days apart: different item
        { ...base, id: 'english-read-act-3-2026-10-20', title: 'Read Act 3', type: 'reading', due: '2026-10-20' },
        // other type family
        { ...base, id: 'english-read-act-3-quiz', title: 'Read Act 3', type: 'quiz', due: '2026-10-13' },
        // (a) same source kind with different ids
        { ...base, id: 'gc-read3-repost', title: 'Read Act 3', type: 'reading', due: '2026-10-13', source: { kind: 'google_classroom', id: 'READ3-NEW' } },
        // (c) only one has a date
        { ...base, id: 'english-read-act-3-nodate', title: 'Read Act 3', type: 'reading' },
        // (b) another occurrence of recurring work
        { ...base, id: 'english-vocab-quiz-2026-10-17', title: 'Vocab quiz', type: 'quiz', due: '2026-10-17' },
      );
      d.classes.push({ id: 'cls-english-10', name: 'English 10', origin: 'generated', source: { kind: 'syllabus', label: 'syllabus' } });
      // (d) the second part of a split recurring commitment
      d.events.push({ ...FENCING, id: 'evt-swim-b', title: 'Swim', recurrence: { frequency: 'weekly', daysOfWeek: ['tue'], startDate: '2026-10-09' } });
      d.events.push({ ...FENCING, id: 'evt-swim', title: 'Swim', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', endDate: '2026-10-08' } });
      d.assignments.push({ id: 'english-vocab-quiz-2026-10-16', classId: 'gc-class-eng', title: 'Vocab quiz', type: 'quiz', due: '2026-10-16', origin: 'generated' });
    };
    const file = generated(add);
    const plan = planImport(cur, file, NOW);
    const dup = (key: string) => row(plan, key).category;
    expect(dup('assignments:gc-read3-again')).toBe('possibleDuplicate');
    expect(row(plan, 'assignments:gc-read3-again').reason).toBe(
      'Looks like “Read Act 3”, which is already in your schedule (the same Google Classroom item). Tick to add it anyway.',
    );
    expect(row(plan, 'assignments:gc-read3-again').relatedId).toBe('gc-read3');
    expect(dup('assignments:english-read-act-3-2026-10-14')).toBe('possibleDuplicate');
    expect(row(plan, 'assignments:english-read-act-3-2026-10-14').reason).toMatch(/same class, type and title, dated 1 day apart/);
    expect(dup('classes:cls-english-10')).toBe('possibleDuplicate');
    for (const id of [
      'english-read-act-3-2026-10-20',
      'english-read-act-3-quiz',
      'gc-read3-repost',
      'english-read-act-3-nodate',
      'english-vocab-quiz-2026-10-17',
    ]) {
      expect(dup(`assignments:${id}`), id).toBe('new');
    }
    expect(dup('events:evt-swim-b')).toBe('new');

    const kept = run(cur, file);
    expect(asg(kept.doc, 'gc-read3-again')).toBeUndefined();
    expect(cls(kept.doc, 'cls-english-10')).toBeUndefined();
    expectIdempotent(kept.doc, file);
    const added = run(cur, file, { select: ['assignments:gc-read3-again'] });
    expect(asg(added.doc, 'gc-read3-again')).toBeDefined();
  });

  it('applies Removed from source by default; unticking keeps the state and the linked outdated blocks', () => {
    const cur = current();
    const file = generated((d) => {
      const r = d.assignments.find((a) => a.id === 'gc-read3')!;
      r.sourceState = 'missing';
      r.estimatedMinutes = 55;
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-read-2');
    });
    const applied = run(cur, file);
    const rfs = row(applied.plan, 'assignments:gc-read3#sourceState');
    expect(rfs).toMatchObject({ category: 'removedFromSource', aspect: 'sourceState', selectable: true, defaultSelected: true });
    expect(rfs.fields).toEqual([{ field: 'sourceState', label: 'In source', before: 'In source', after: 'No longer in source', group: 'details' }]);
    expect(rfs.includes?.map((i) => i.key)).toEqual(['scheduleBlocks:blk-read-2']);
    expect(row(applied.plan, 'assignments:gc-read3').category).toBe('updated');
    expect(row(applied.plan, 'scheduleBlocks:blk-read-2').category).toBe('outdated');
    expect(applied.plan.summary.removedFromSource).toEqual({ assignments: 1 });
    expect(asg(applied.doc, 'gc-read3')).toMatchObject({ sourceState: 'missing', estimatedMinutes: 55 });
    expect(blk(applied.doc, 'blk-read-2')).toBeUndefined();
    expectIdempotent(applied.doc, file);

    const declined = run(cur, file, { unselect: ['assignments:gc-read3#sourceState'] });
    expect(asg(declined.doc, 'gc-read3')!.sourceState).toBeUndefined();
    expect(asg(declined.doc, 'gc-read3')!.estimatedMinutes).toBe(55);
    expect(blk(declined.doc, 'blk-read-2')).toBeDefined();
  });

  it('keeps generated items that a fresh file does not contain unless ticked (Not in this file)', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push({ id: 'u-blk-plan0001', assignmentId: 'gc-essay', start: '2026-10-15T17:00:00', end: '2026-10-15T17:45:00', origin: 'planner' });
    });
    const file = fresh((d) => {
      d.events = d.events.filter((e) => e.id !== 'evt-fencing');
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-3');
    });
    const kept = run(cur, file);
    expect(kept.plan.fresh).toBe(true);
    expect(kept.plan.notes.some((n) => n.includes('made without your current schedule'))).toBe(true);
    for (const key of ['events:evt-fencing', 'scheduleBlocks:blk-essay-3', 'scheduleBlocks:u-blk-plan0001']) {
      expect(row(kept.plan, key)).toMatchObject({ category: 'missing', selectable: true, defaultSelected: false, removes: true });
    }
    expect(evt(kept.doc, 'evt-fencing')).toBeDefined();
    expectIdempotent(kept.doc, file);

    const removed = run(cur, file, { select: ['events:evt-fencing', 'scheduleBlocks:blk-essay-3', 'scheduleBlocks:u-blk-plan0001'] });
    expect(evt(removed.doc, 'evt-fencing')).toBeUndefined();
    expect(blk(removed.doc, 'blk-essay-3')).toBeUndefined();
    // The person removed generated items: tombstones (planner blocks get none).
    expect(removed.doc.deleted).toEqual([
      { id: 'evt-fencing', collection: 'events', deletedAt: NOW, title: 'Fencing' },
      { id: 'blk-essay-3', collection: 'scheduleBlocks', deletedAt: NOW },
    ]);
  });

  it('removes outdated planned work by default for files with basedOn (§ 16.2)', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push(
        { id: 'blk-review-1', title: 'Review flashcards', start: '2026-10-15T19:00:00', end: '2026-10-15T19:30:00', origin: 'generated' },
        { id: 'u-blk-plan0002', title: 'Planner review', start: '2026-10-15T20:00:00', end: '2026-10-15T20:30:00', origin: 'planner' },
        { id: 'blk-noted-1', assignmentId: 'gc-essay', start: '2026-10-15T16:00:00', end: '2026-10-15T16:45:00', notes: 'Bring the rubric', origin: 'generated' },
        { id: 'blk-pinned-1', assignmentId: 'gc-essay', start: '2026-10-15T17:00:00', end: '2026-10-15T17:30:00', locked: true, origin: 'generated' },
        { id: 'blk-inprog-1', assignmentId: 'gc-essay', start: '2026-10-11T19:00:00', end: '2026-10-11T20:00:00', origin: 'generated' },
      );
    });
    const replan: ScheduleBlock = { id: 'blk-essay-x1', assignmentId: 'gc-essay', taskId: 'gc-essay-t3', start: '2026-10-13T17:00:00', end: '2026-10-13T17:50:00', origin: 'generated' };
    const file = generated((d) => {
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => !['blk-essay-3', 'blk-test-1'].includes(b.id));
      d.scheduleBlocks.push(replan);
    });
    const { plan, doc } = run(cur, file);
    expect(row(plan, 'scheduleBlocks:blk-essay-3')).toMatchObject({ category: 'outdated', selectable: true, defaultSelected: true, removes: true });
    expect(row(plan, 'scheduleBlocks:blk-test-1').category).toBe('outdated');
    expect(row(plan, 'scheduleBlocks:blk-review-1').category).toBe('outdated');
    expect(row(plan, 'scheduleBlocks:u-blk-plan0002').category).toBe('missing');
    expect(row(plan, 'scheduleBlocks:blk-noted-1').category).toBe('missing');
    expect(row(plan, 'scheduleBlocks:blk-pinned-1').category).toBe('protected');
    expect(row(plan, 'scheduleBlocks:blk-inprog-1').category).toBe('protected');
    expect(row(plan, 'scheduleBlocks:blk-essay-x1').category).toBe('new');
    expect(blk(doc, 'blk-essay-3')).toBeUndefined();
    expect(blk(doc, 'blk-test-1')).toBeUndefined();
    expect(blk(doc, 'blk-essay-x1')).toBeDefined();
    expect(doc.deleted).toBeUndefined(); // outdated blocks get no tombstone
    expectIdempotent(doc, file);

    const keep = run(cur, file, { unselect: ['scheduleBlocks:blk-essay-3'] });
    expect(blk(keep.doc, 'blk-essay-3')).toBeDefined();

    // A file without any generated block does not make title-only blocks outdated.
    const noGenerated = generated((d) => {
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.origin !== 'generated');
    });
    expect(row(planImport(cur, noGenerated, NOW), 'scheduleBlocks:blk-review-1').category).toBe('missing');
    // The same blocks are only "Not in this file" for a fresh file.
    const freshPlan = planImport(cur, freshFile({ ...clone(file), meta: undefined }), NOW);
    expect(row(freshPlan, 'scheduleBlocks:blk-essay-3').category).toBe('missing');
  });

  it('marks sessions the preview would remove or move that already ended at the import time', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push(
        { id: 'blk-evening-1', assignmentId: 'gc-essay', start: '2026-10-11T19:30:00', end: '2026-10-11T20:00:00', origin: 'generated' },
        { id: 'blk-evening-2', assignmentId: 'gc-essay', start: '2026-10-11T19:40:00', end: '2026-10-11T19:55:00', origin: 'generated' },
      );
    });
    const file = generated((d) => {
      d.scheduleBlocks.push({ id: 'blk-evening-2', assignmentId: 'gc-essay', start: '2026-10-11T21:00:00', end: '2026-10-11T21:30:00', origin: 'generated' });
    });
    const plan = planImport(cur, file, '2026-10-11T22:00:00');
    expect(row(plan, 'scheduleBlocks:blk-evening-1')).toMatchObject({ category: 'outdated', passed: true });
    expect(row(plan, 'scheduleBlocks:blk-evening-2')).toMatchObject({ category: 'updated', passed: true });
    expect(row(plan, 'scheduleBlocks:blk-essay-2').passed).toBeUndefined();
  });

  it('never removes protected items the file does not contain (Always kept)', () => {
    const cur = current((d) => {
      d.assignments.push({ id: 'gc-done-hw', classId: 'gc-class-eng', title: 'Finished homework', status: 'done', origin: 'generated' });
      d.events.push({ ...FENCING, id: 'evt-pinned', title: 'Pinned club', locked: true });
    });
    const file = generated((d) => {
      d.assignments = d.assignments.filter((a) => a.id !== 'u-asg-lib00001');
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => !['blk-essay-1', 'blk-read-1', 'u-blk-lib00001'].includes(b.id));
      d.events = [];
      d.availability = [];
    });
    const { plan, doc } = run(cur, file);
    for (const key of [
      'assignments:u-asg-lib00001',
      'assignments:gc-done-hw',
      'scheduleBlocks:blk-essay-1',
      'scheduleBlocks:blk-read-1',
      'scheduleBlocks:u-blk-lib00001',
      'events:u-evt-school01',
      'events:evt-pinned',
      'availability:u-avl-after001',
    ]) {
      expect(row(plan, key), key).toMatchObject({ category: 'protected', selectable: false });
    }
    expect(row(plan, 'events:evt-fencing').category).toBe('missing');
    expect(doc.assignments.map((a) => a.id)).toContain('gc-done-hw');
    expect(doc.events.map((e) => e.id).sort()).toEqual(['evt-fencing', 'evt-pinned', 'u-evt-school01']);
    expectIdempotent(doc, file);
  });

  it('offers each differing setting separately, unticked, and marks settings never set', () => {
    const cur = current((d) => {
      d.settings = { dayStartTime: '06:00', breakMinutes: 15 };
    });
    const file = generated((d) => {
      d.settings = { dayStartTime: '07:00', maxDailyStudyMinutes: 180 };
    });
    const kept = run(cur, file);
    expect(kept.plan.settingsChanged).toBe(true);
    expect(row(kept.plan, 'settings:dayStartTime')).toMatchObject({
      category: 'setting',
      collection: 'settings',
      selectable: true,
      defaultSelected: false,
      neverSet: false,
      fields: [{ field: 'dayStartTime', label: 'Timeline starts at', before: '6:00 AM', after: '7:00 AM', group: 'details' }],
    });
    expect(row(kept.plan, 'settings:maxDailyStudyMinutes')).toMatchObject({ neverSet: true, fields: [{ before: 'No limit', after: '3 h' }] });
    expect(row(kept.plan, 'settings:breakMinutes').fields[0]).toMatchObject({ before: '15 m', after: '10 m' });
    expect(kept.plan.summary.setting).toEqual({ settings: 3 });
    expect(kept.doc.settings).toEqual({ dayStartTime: '06:00', breakMinutes: 15 });
    expectIdempotent(kept.doc, file);

    const taken = run(cur, file, { select: ['settings:dayStartTime', 'settings:maxDailyStudyMinutes', 'settings:breakMinutes'] });
    expect(taken.doc.settings).toEqual({ dayStartTime: '07:00', maxDailyStudyMinutes: 180 });
    expect(planImport(taken.doc, file, NOW).settingsChanged).toBe(false);
  });

  it('reports a settings combination that would be invalid (§ 16.1 step 5)', () => {
    const cur = current();
    const file = generated((d) => {
      d.settings = { dayStartTime: '23:00', dayEndTime: '24:00' };
    });
    const plan = planImport(cur, file, NOW);
    const onlyStart = new Set(['settings:dayStartTime']);
    const bad = checkImport(cur, file, plan, onlyStart, NOW);
    expect(bad.ok).toBe(false);
    expect(bad.problems.some((p) => p.key?.startsWith('settings:'))).toBe(true);
    const good = checkImport(cur, file, plan, new Set(['settings:dayStartTime', 'settings:dayEndTime']), NOW);
    expect(good.ok).toBe(true);
    expect(good.doc.settings).toEqual({ dayStartTime: '23:00', dayEndTime: '24:00' });
  });
});

// ===========================================================================
// Person-owned fields (§ 16.3)
// ===========================================================================

describe('person-owned fields during an update', () => {
  const withStatus = (status: Assignment['status'], completedAt?: string) => (d: ScheduleDocument) => {
    const r = d.assignments.find((a) => a.id === 'gc-read3')!;
    r.status = status;
    if (completedAt) r.completedAt = completedAt;
    else delete r.completedAt;
  };

  it('never moves a status backwards', () => {
    const cases: Array<[Assignment['status'], string | undefined, Assignment['status'], string | undefined, Assignment['status'], string | undefined]> = [
      ['done', '2026-10-10T09:00:00', 'not_started', undefined, 'done', '2026-10-10T09:00:00'],
      ['done', '2026-10-10T09:00:00', 'in_progress', undefined, 'done', '2026-10-10T09:00:00'],
      ['in_progress', undefined, 'not_started', undefined, 'in_progress', undefined],
      ['not_started', undefined, 'in_progress', undefined, 'in_progress', undefined],
      ['in_progress', undefined, 'done', '2026-10-11T08:00:00', 'done', '2026-10-11T08:00:00'],
      ['done', undefined, 'done', '2026-10-11T08:00:00', 'done', '2026-10-11T08:00:00'],
      ['done', '2026-10-10T09:00:00', 'done', '2026-10-11T08:00:00', 'done', '2026-10-10T09:00:00'],
    ];
    for (const [cs, cAt, fs, fAt, expected, expectedAt] of cases) {
      const cur = current(withStatus(cs, cAt));
      const file = generated(withStatus(fs, fAt));
      const { doc } = run(cur, file);
      expect(asg(doc, 'gc-read3')!.status, `${cs} + ${fs}`).toBe(expected);
      expect(asg(doc, 'gc-read3')!.completedAt, `${cs} + ${fs}`).toBe(expectedAt);
      expectIdempotent(doc, file);
    }
  });

  it('keeps a current cancelled status unless the file’s status is ticked (Kept (b)); applies the file’s cancelled only over not started/in progress', () => {
    const cur = current(withStatus('cancelled'));
    const file = generated(withStatus('in_progress'));
    const kept = run(cur, file);
    expect(row(kept.plan, 'assignments:gc-read3').category).toBe('unchanged');
    const b = row(kept.plan, 'assignments:gc-read3#status');
    expect(b).toMatchObject({ category: 'kept', aspect: 'status', selectable: true, defaultSelected: false });
    expect(b.fields).toEqual([{ field: 'status', label: 'Status', before: 'Cancelled', after: 'In progress', group: 'status' }]);
    expect(asg(kept.doc, 'gc-read3')!.status).toBe('cancelled');
    expectIdempotent(kept.doc, file);
    const taken = run(cur, file, { select: ['assignments:gc-read3#status'] });
    expect(asg(taken.doc, 'gc-read3')!.status).toBe('in_progress');

    expect(asg(run(current(withStatus('in_progress')), generated(withStatus('cancelled'))).doc, 'gc-read3')!.status).toBe('cancelled');
    expect(asg(run(current(), generated(withStatus('cancelled'))).doc, 'gc-read3')!.status).toBe('cancelled');
    expect(asg(run(current(withStatus('done', '2026-10-10T09:00:00')), generated(withStatus('cancelled'))).doc, 'gc-read3')!.status).toBe('done');
  });

  it('keeps non-empty notes; takes the file’s notes only when the current ones are empty', () => {
    const cur = current((d) => {
      d.assignments[0].notes = 'Ms. Rivera: Act 4 quotes are fine.';
      d.assignments[1].notes = '   ';
    });
    const file = generated((d) => {
      d.assignments[0].notes = 'Old notes';
      d.assignments[1].notes = 'From the file';
    });
    const { doc, plan } = run(cur, file);
    expect(essayOf(doc).notes).toBe('Ms. Rivera: Act 4 quotes are fine.');
    expect(asg(doc, 'gc-read3')!.notes).toBe('From the file');
    expect(row(plan, 'assignments:gc-essay').category).toBe('unchanged');
  });

  it('keeps overridden values (including their absence) and unions the overrides', () => {
    const cur = current((d) => {
      d.assignments[0].priority = 'urgent';
      d.assignments[0].overrides = ['priority', 'topic', 'x-color'];
      (d.assignments[0] as unknown as Record<string, unknown>)['x-color'] = 'red';
    });
    const file = generated((d) => {
      const e = d.assignments[0];
      e.priority = 'low';
      e.topic = 'Unit 2: Othello';
      e.due = '2026-10-17T23:59:00';
      e.overrides = ['x-other'];
      (e as unknown as Record<string, unknown>)['x-color'] = 'blue';
    });
    const { doc, plan } = run(cur, file);
    const e = essayOf(doc) as Assignment & Record<string, unknown>;
    expect(e.priority).toBe('urgent');
    expect(e.topic).toBeUndefined();
    expect(e['x-color']).toBe('red');
    expect(e.due).toBe('2026-10-17T23:59:00');
    expect(e.overrides).toEqual(['priority', 'topic', 'x-color', 'x-other']);
    // Kept person-owned values are not listed as changes.
    expect(row(plan, 'assignments:gc-essay').fields.map((f) => f.field)).toEqual(['due', 'overrides']);
    expectIdempotent(doc, file);
  });

  it('does not offer Removed from source when sourceState is overridden', () => {
    const cur = current((d) => {
      d.assignments[1].overrides = ['sourceState'];
    });
    const file = generated((d) => {
      d.assignments[1].sourceState = 'withdrawn';
    });
    const { plan, doc } = run(cur, file);
    expect(hasRow(plan, 'assignments:gc-read3#sourceState')).toBe(false);
    expect(asg(doc, 'gc-read3')!.sourceState).toBeUndefined();
  });

  it('keeps issue decisions by id, and decided issues the file left out', () => {
    const cur = current((d) => {
      d.assignments[0].issues = [
        { id: 'i-due', kind: 'conflict', field: 'due', message: 'Rubric says Friday.', status: 'resolved' },
        { id: 'i-open', kind: 'ambiguity', message: 'Which edition?' },
        { id: 'i-dismissed', kind: 'other', message: 'Not a problem.', status: 'dismissed' },
      ];
    });
    const file = generated((d) => {
      d.assignments[0].issues = [
        { id: 'i-due', kind: 'conflict', field: 'due', message: 'Rubric says Friday in class.' },
        { id: 'i-new', kind: 'workload', message: 'Tight week.' },
      ];
    });
    const { doc } = run(cur, file);
    expect(essayOf(doc).issues).toEqual([
      { id: 'i-due', kind: 'conflict', field: 'due', message: 'Rubric says Friday in class.', status: 'resolved' },
      { id: 'i-new', kind: 'workload', message: 'Tight week.' },
      { id: 'i-dismissed', kind: 'other', message: 'Not a problem.', status: 'dismissed' },
    ]);
    expectIdempotent(doc, file);
  });

  it('keeps the current origin; a file item matching your own item is treated as yours', () => {
    const cur = current();
    const file = generated((d) => {
      d.assignments[1].origin = 'user';
      d.assignments[1].title = 'Read Act 3 (pages 80–110)';
      d.assignments.find((a) => a.id === 'u-asg-lib00001')!.origin = 'generated';
    });
    const { plan, doc } = run(cur, file);
    expect(asg(doc, 'gc-read3')!.origin).toBe('generated');
    expect(asg(doc, 'gc-read3')!.title).toBe('Read Act 3 (pages 80–110)');
    expect(row(plan, 'assignments:u-asg-lib00001').category).toBe('unchanged');
    expect(asg(doc, 'u-asg-lib00001')!.origin).toBe('user');
  });

  it('takes the file’s locked value for unlocked generated items', () => {
    const file = generated((d) => {
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-2')!.locked = true;
    });
    const { doc, plan } = run(current(), file);
    expect(blk(doc, 'blk-essay-2')!.locked).toBe(true);
    expect(row(plan, 'scheduleBlocks:blk-essay-2').fields).toEqual([{ field: 'locked', label: 'Pinned', before: 'Not pinned', after: 'Pinned', group: 'details' }]);
  });

  it('takes only done/skipped from the file for past or in-progress planned blocks', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push({ id: 'blk-inprog-2', assignmentId: 'gc-essay', start: '2026-10-11T19:00:00', end: '2026-10-11T20:00:00', origin: 'generated' });
    });
    const file = generated((d) => {
      const past = d.scheduleBlocks.find((b) => b.id === 'blk-read-1')!;
      past.status = 'done';
      past.completedAt = '2026-10-11T16:50:00';
      past.description = 'Changed text';
      d.scheduleBlocks.push({ id: 'blk-inprog-2', assignmentId: 'gc-essay', start: '2026-10-11T19:15:00', end: '2026-10-11T20:15:00', origin: 'generated' });
    });
    const { plan, doc } = run(cur, file);
    expect(row(plan, 'scheduleBlocks:blk-read-1').fields.map((f) => f.field)).toEqual(['status', 'completedAt']);
    expect(blk(doc, 'blk-read-1')).toMatchObject({ status: 'done', completedAt: '2026-10-11T16:50:00' });
    expect(blk(doc, 'blk-read-1')!.description).toBeUndefined();
    expect(row(plan, 'scheduleBlocks:blk-inprog-2').category).toBe('unchanged');
    expect(blk(doc, 'blk-inprog-2')!.start).toBe('2026-10-11T19:00:00');
  });

  it('merges x- properties key by key; kept items keep all their x- keys', () => {
    const cur = current((d) => {
      Object.assign(d.assignments[0], { 'x-a': 1, 'x-b': { k: 1 } });
      Object.assign(d.assignments.find((a) => a.id === 'u-asg-lib00001')!, { 'x-mine': [1, null] });
    });
    const file = generated((d) => {
      Object.assign(d.assignments[0], { 'x-b': { k: 2 }, 'x-c': null });
      Object.assign(d.assignments.find((a) => a.id === 'u-asg-lib00001')!, { 'x-theirs': true, estimatedMinutes: 20 });
    });
    const { doc } = run(cur, file);
    expect(essayOf(doc)).toMatchObject({ 'x-a': 1, 'x-b': { k: 2 }, 'x-c': null });
    const lib = asg(doc, 'u-asg-lib00001') as unknown as Record<string, unknown>;
    expect(lib['x-mine']).toEqual([1, null]);
    expect(lib['x-theirs']).toBeUndefined();
  });

  it('merges tasks task by task (D27)', () => {
    const cur = current((d) => {
      d.assignments[0].tasks!.push({ id: 'u-tsk-proof001', title: 'Proofread with Mom', origin: 'user' });
    });
    const file = generated((d) => {
      const e = d.assignments[0];
      const t1 = { ...e.tasks![0], status: 'not_started' as const };
      delete t1.completedAt;
      e.tasks = [{ ...e.tasks![1], title: 'Outline (printed)', due: '2026-10-13' }, { id: 'gc-essay-t5', title: 'Works cited', estimatedMinutes: 20 }, t1];
      // The generator re-planned: the draft session moves to a new block without a task.
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-3');
      d.scheduleBlocks.push({ id: 'blk-essay-x2', assignmentId: 'gc-essay', taskId: 'gc-essay-t5', start: '2026-10-14T18:00:00', end: '2026-10-14T18:20:00', origin: 'generated' });
    });
    const { plan, doc } = run(cur, file);
    const tasks = essayOf(doc).tasks!;
    expect(tasks.map((t) => t.id)).toEqual(['gc-essay-t2', 'gc-essay-t5', 'gc-essay-t1', 'u-tsk-proof001']);
    expect(tasks[0]).toMatchObject({ title: 'Outline (printed)', due: '2026-10-13' });
    expect(tasks[2]).toMatchObject({ status: 'done', completedAt: '2026-10-10T10:30:00' });
    // t2's dependency on t1 stays; t3 and t4 (generated, not done, unreferenced) are removed.
    expect(tasks[0].dependsOn).toEqual(['gc-essay-t1']);
    const fields = row(plan, 'assignments:gc-essay').fields;
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Task “Outline (printed)” · Title', before: 'Outline', after: 'Outline (printed)', group: 'tasks' }),
        expect.objectContaining({ label: 'Task “Outline (printed)” · Due date', before: '—', after: 'Oct 13', group: 'dueDate' }),
        expect.objectContaining({ label: 'New task', after: 'Works cited (20 m)', group: 'tasks' }),
        expect.objectContaining({ label: 'Removed task', before: 'Draft (2 h)', after: '—' }),
        expect.objectContaining({ label: 'Removed task', before: 'Revise (1 h)', after: '—' }),
        expect.objectContaining({ label: 'Task order' }),
      ]),
    );
    expect(doc.deleted).toBeUndefined(); // the generator's removals are not person deletions
    expectIdempotent(doc, file);

    // Keeping the outdated block keeps the task it references.
    const keepBlock = run(cur, file, { unselect: ['scheduleBlocks:blk-essay-3'] });
    expect(essayOf(keepBlock.doc).tasks!.map((t) => t.id)).toEqual(['gc-essay-t2', 'gc-essay-t5', 'gc-essay-t1', 'gc-essay-t3', 'u-tsk-proof001']);
    expect(blk(keepBlock.doc, 'blk-essay-3')!.taskId).toBe('gc-essay-t3');
  });

  it('keeps current tasks as they are when tasks is overridden', () => {
    const cur = current((d) => {
      d.assignments[0].overrides = ['tasks'];
    });
    const file = generated((d) => {
      // The file keeps the done task (its done session refers to it) and replaces the others.
      d.assignments[0].tasks = [d.assignments[0].tasks![0], { id: 'gc-essay-t9', title: 'Something else' }];
      d.assignments[0].due = '2026-10-17T23:59:00';
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => !b.taskId || b.assignmentId !== 'gc-essay' || b.status === 'done');
    });
    const { doc } = run(cur, file, { unselect: ['scheduleBlocks:blk-essay-2', 'scheduleBlocks:blk-essay-3'] });
    expect(essayOf(doc).tasks).toEqual(essayOf(cur).tasks);
    expect(essayOf(doc).due).toBe('2026-10-17T23:59:00');
  });

  it('offers task-level choices: your tasks, requested changes, deleted tasks, cancelled tasks', () => {
    const cur = current((d) => {
      const tasks = d.assignments[0].tasks!;
      tasks[2] = { ...tasks[2], locked: true };
      tasks[3] = { ...tasks[3], status: 'cancelled' };
      tasks.push({ id: 'u-tsk-mine0001', title: 'Ask about Act 4', origin: 'user' });
      tasks.push({ id: 'u-tsk-mine0002', title: 'Make flashcards', origin: 'user' });
      d.deleted = [{ id: 'gc-essay-t6', collection: 'tasks', deletedAt: '2026-10-09T12:00:00', title: 'Peer review' }];
    });
    const file = generated(
      (d) => {
        const tasks = d.assignments[0].tasks!;
        tasks[2] = { ...tasks[2], locked: true, estimatedMinutes: 150 };
        tasks[3] = { ...tasks[3], status: 'in_progress' };
        tasks.push({ id: 'u-tsk-mine0001', title: 'Ask Ms. Rivera about Act 4', origin: 'user' });
        tasks.push({ id: 'gc-essay-t6', title: 'Peer review', estimatedMinutes: 30 });
        d.scheduleBlocks.push({ id: 'blk-peer-1', assignmentId: 'gc-essay', taskId: 'gc-essay-t6', start: '2026-10-15T18:00:00', end: '2026-10-15T18:30:00', origin: 'generated' });
        d.deleted = [{ id: 'gc-essay-t6x', collection: 'tasks', deletedAt: '2026-10-09T12:00:00' }];
      },
      {
        requestedChanges: [
          { id: 'u-tsk-mine0001', reason: 'You asked to reword it.', requestedByPerson: true },
          { id: 'u-tsk-mine0002', reason: 'You made them already.', requestedByPerson: true },
        ],
      },
    );
    const { plan, doc } = run(cur, file);
    const pinned = row(plan, 'tasks:gc-essay-t3');
    expect(pinned).toMatchObject({ category: 'kept', parentId: 'gc-essay', collection: 'assignments', id: 'gc-essay-t3', selectable: true, defaultSelected: false });
    expect(pinned.label).toBe('Othello Essay › Draft');
    expect(pinned.fields).toEqual([{ field: 'estimatedMinutes', label: 'Workload estimate', before: '2 h', after: '2 h 30 m', group: 'estimate', taskId: 'gc-essay-t3' }]);
    expect(row(plan, 'tasks:gc-essay-t4#status')).toMatchObject({ category: 'kept', aspect: 'status', defaultSelected: false });
    expect(row(plan, 'tasks:u-tsk-mine0001')).toMatchObject({ category: 'yourItems', defaultSelected: true });
    expect(row(plan, 'tasks:u-tsk-mine0001').removes).toBeUndefined();
    expect(row(plan, 'tasks:u-tsk-mine0002')).toMatchObject({ category: 'yourItems', defaultSelected: true, removes: true });
    const peer = row(plan, 'tasks:gc-essay-t6');
    expect(peer).toMatchObject({ category: 'previouslyDeleted', defaultSelected: false });
    expect(peer.includes?.map((i) => i.key)).toEqual(['scheduleBlocks:blk-peer-1']);
    expect(plan.taskSummary).toEqual({ yourItems: 2, previouslyDeleted: 1, kept: 2 });
    expect(plan.summary.kept).toEqual({}); // task rows are counted in taskSummary only

    const tasks = essayOf(doc).tasks!;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get('gc-essay-t3')!.estimatedMinutes).toBe(120);
    expect(byId.get('gc-essay-t4')!.status).toBe('cancelled');
    expect(byId.get('u-tsk-mine0001')!.title).toBe('Ask Ms. Rivera about Act 4');
    expect(byId.has('u-tsk-mine0002')).toBe(false);
    expect(byId.has('gc-essay-t6')).toBe(false);
    expect(blk(doc, 'blk-peer-1')).toBeUndefined();
    expectIdempotent(doc, file);

    const all = run(cur, file, { select: ['tasks:gc-essay-t3', 'tasks:gc-essay-t4#status', 'tasks:gc-essay-t6'] });
    const allById = new Map(essayOf(all.doc).tasks!.map((t) => [t.id, t]));
    expect(allById.get('gc-essay-t3')).toMatchObject({ estimatedMinutes: 150, locked: true });
    expect(allById.get('gc-essay-t4')!.status).toBe('in_progress');
    expect(allById.has('gc-essay-t6')).toBe(true);
    expect(blk(all.doc, 'blk-peer-1')).toBeDefined();
    expect(all.doc.deleted?.map((t) => t.id)).toEqual(['gc-essay-t6x']);
  });

  it('cannot remove a task that a remaining session uses', () => {
    const cur = current((d) => {
      d.assignments[0].tasks![1] = { ...d.assignments[0].tasks![1], origin: 'user' };
    });
    const file = generated(
      (d) => {
        d.assignments[0].tasks!.splice(1, 1);
        d.assignments[0].tasks![1].dependsOn = undefined;
        d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-2');
      },
      { requestedChanges: [{ id: 'gc-essay-t2', reason: 'Outline not needed.', requestedByPerson: true }] },
    );
    // The outline session is outdated (removed by default), so the task can go with it.
    const removed = run(current((d) => {
      d.assignments[0].tasks![1] = { ...d.assignments[0].tasks![1], origin: 'user' };
    }), file);
    expect(essayOf(removed.doc).tasks!.some((t) => t.id === 'gc-essay-t2')).toBe(false);
    // Pinning the session keeps it, and with it the task.
    const pinned = valid({ ...clone(cur), scheduleBlocks: cur.scheduleBlocks.map((b) => (b.id === 'blk-essay-2' ? { ...b, locked: true } : b)) });
    const plan = planImport(pinned, file, NOW);
    expect(row(plan, 'tasks:gc-essay-t2')).toMatchObject({ selectable: false, defaultSelected: false, blockedReason: '1 scheduled session uses this task.' });
    const { doc } = run(pinned, file);
    expect(essayOf(doc).tasks!.some((t) => t.id === 'gc-essay-t2')).toBe(true);
    expect(blk(doc, 'blk-essay-2')!.taskId).toBe('gc-essay-t2');
  });
});

// ===========================================================================
// Tombstones, root issues, meta (§ 16.4, § 16.6)
// ===========================================================================

describe('tombstones, root issues and meta', () => {
  it('unions tombstones; the current entry wins; entries naming kept items are not added', () => {
    const cur = current((d) => {
      d.deleted = [{ id: 'gc-old', collection: 'assignments', deletedAt: '2026-10-01T10:00:00', title: 'Old (mine)' }];
      d.events.push({ ...FENCING, id: 'evt-pinned', title: 'Pinned club', locked: true });
    });
    const file = fresh((d) => {
      d.events = d.events.filter((e) => e.id === 'u-evt-school01');
      d.deleted = [
        { id: 'gc-old', collection: 'assignments', deletedAt: '2026-10-05T10:00:00', title: 'Old (theirs)' },
        { id: 'gc-other', collection: 'assignments', deletedAt: '2026-10-06T10:00:00' },
        { id: 'evt-fencing', collection: 'events', deletedAt: '2026-10-10T10:00:00', title: 'Fencing' },
        { id: 'evt-pinned', collection: 'events', deletedAt: '2026-10-10T10:00:00', title: 'Pinned club' },
      ];
    });
    const kept = run(cur, file);
    expect(row(kept.plan, 'events:evt-fencing')).toMatchObject({ category: 'missing', deletedInFile: true, reason: 'Deleted in the imported file. Kept unless you tick it.' });
    expect(row(kept.plan, 'events:evt-pinned').category).toBe('protected');
    expect(row(kept.plan, 'events:evt-pinned#deleted')).toMatchObject({ category: 'kept', aspect: 'deletedInFile', selectable: true, defaultSelected: false, removes: true });
    expect(kept.doc.deleted).toEqual([
      { id: 'gc-old', collection: 'assignments', deletedAt: '2026-10-01T10:00:00', title: 'Old (mine)' },
      { id: 'gc-other', collection: 'assignments', deletedAt: '2026-10-06T10:00:00' },
    ]);
    expect(kept.plan.otherChanges).toContain('1 record of items deleted elsewhere (so they are not created again)');
    expectIdempotent(kept.doc, file);

    const removed = run(cur, file, { select: ['events:evt-fencing', 'events:evt-pinned#deleted'] });
    expect(evt(removed.doc, 'evt-fencing')).toBeUndefined();
    expect(evt(removed.doc, 'evt-pinned')).toBeUndefined();
    expect(removed.doc.deleted!.map((t) => [t.id, t.deletedAt])).toEqual([
      ['gc-old', '2026-10-01T10:00:00'],
      ['evt-fencing', NOW],
      ['evt-pinned', NOW],
      ['gc-other', '2026-10-06T10:00:00'],
    ]);
  });

  it('keeps at most 5000 tombstones, dropping the oldest', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({
      id: `gc-del-${i}`,
      collection: 'assignments' as const,
      deletedAt: i === 1 ? '2025-12-31T10:00:00' : `2026-0${1 + Math.floor(i / 1000)}-01T10:00:00`,
    }));
    const cur = current((d) => {
      d.deleted = many;
    });
    // The file (at most 5000 entries itself) dropped the first entry and adds a new one: 5001 in the union.
    const file = generated((d) => {
      d.deleted = [...many.slice(1), { id: 'gc-del-new', collection: 'assignments', deletedAt: '2026-10-10T10:00:00' }];
    });
    const { doc } = run(cur, file);
    expect(doc.deleted).toHaveLength(5000);
    expect(doc.deleted!.some((t) => t.id === 'gc-del-new')).toBe(true);
    // The current entry the file dropped is kept (union); the oldest entry goes.
    expect(doc.deleted!.some((t) => t.id === 'gc-del-0')).toBe(true);
    expect(doc.deleted!.some((t) => t.id === 'gc-del-1')).toBe(false);
    expectIdempotent(doc, file);
  });

  it('takes root issues from the file, keeps decisions, and drops issues about items that are gone', () => {
    const cur = current((d) => {
      d.issues = [
        { id: 'workload:2026-10-15', kind: 'workload', date: '2026-10-15', message: 'Busy Thursday.', status: 'dismissed' },
        { id: 'r-open', kind: 'other', message: 'Old open issue.' },
        { id: 'r-solved', kind: 'other', message: 'Solved earlier.', status: 'resolved' },
      ];
    });
    const file = generated((d) => {
      d.issues = [
        { id: 'workload:2026-10-15', kind: 'workload', date: '2026-10-15', message: 'Busy Thursday (updated).' },
        { id: 'r-new', kind: 'conflict', itemId: 'u-asg-lib00001', message: 'Library closes early.' },
      ];
    });
    const { doc, plan } = run(cur, file);
    expect(doc.issues).toEqual([
      { id: 'workload:2026-10-15', kind: 'workload', date: '2026-10-15', message: 'Busy Thursday (updated).', status: 'dismissed' },
      { id: 'r-new', kind: 'conflict', itemId: 'u-asg-lib00001', message: 'Library closes early.' },
      { id: 'r-solved', kind: 'other', message: 'Solved earlier.', status: 'resolved' },
    ]);
    expect(plan.otherChanges).toEqual(['1 new schedule-wide issue to review', '1 schedule-wide issue updated', '1 schedule-wide issue the file no longer lists']);
    expect(plan.noChanges).toBe(false);
    expectIdempotent(doc, file);

    // A fresh file never saw the current issues: open ones are kept too.
    const freshRun = run(cur, fresh((d) => (d.issues = [])));
    expect(freshRun.doc.issues!.map((i) => i.id)).toEqual(['workload:2026-10-15', 'r-open', 'r-solved']);

    // Root issues about a removed item are removed with it.
    const withIssue = current((d) => {
      d.issues = [{ id: 'fencing-issue', kind: 'other', itemId: 'evt-fencing', message: 'x', status: 'resolved' }];
    });
    const gone = run(withIssue, fresh((d) => (d.events = [SCHOOL])), { select: ['events:evt-fencing'] });
    expect(gone.doc.issues).toBeUndefined();
  });

  it('stores the file’s title and sources, never basedOn, requestedChanges or the file’s writer fields', () => {
    const cur = current((d) => {
      d.meta = { title: 'Old title', 'x-app': { v: 1 } } as Meta;
    });
    const file = generated(() => undefined, {
      title: 'Fall 2026',
      sources: [{ kind: 'schedule', label: 'schedule.json' }],
      requestedChanges: [{ id: 'u-evt-school01', reason: 'x', requestedByPerson: false }],
    });
    const { doc, plan } = run(cur, file);
    expect(doc.meta).toEqual({ title: 'Fall 2026', 'x-app': { v: 1 }, sources: [{ kind: 'schedule', label: 'schedule.json' }] });
    expect(plan.otherChanges).toEqual([
      'Schedule title: “Old title” → “Fall 2026”',
      'The list of materials this schedule was made from is updated (1 source)',
    ]);
    expect(plan.noChanges).toBe(false);
    expectIdempotent(doc, file);
    // A file without a title keeps the current one.
    expect(run(cur, generated()).doc.meta?.title).toBe('Old title');
  });

  it('does not store writer fields of the current meta either, and keeps its title and sources when the file has none', () => {
    const cur = current((d) => {
      d.meta = {
        title: 'Fall 2026',
        sources: [{ kind: 'schedule', label: 'old.json' }],
        generator: { name: 'Academic Scheduler', version: '1.0.0' },
        generatedAt: '2026-10-01T10:00:00',
        timezone: 'America/New_York',
        exportId: 'u-exp-old00001',
      };
    });
    const { doc, plan } = run(cur, generated());
    expect(doc.meta).toEqual({ title: 'Fall 2026', sources: [{ kind: 'schedule', label: 'old.json' }] });
    expect(plan.noChanges).toBe(true);
  });

  it('notes a file written for another time zone (times are not converted, § 4)', () => {
    const file = generated(undefined, { timezone: 'Europe/Berlin' });
    const plan = planImport(current(), file, NOW, { timezone: 'America/New_York' });
    expect(plan.fileTimezone).toBe('Europe/Berlin');
    expect(plan.notes).toContain(
      'This file was written for the time zone Europe/Berlin, but this device uses America/New_York. Times are not converted: “4:00 PM” in the file is 4:00 PM on your clock.',
    );
    expect(planImport(current(), generated(), NOW, { timezone: 'America/New_York' }).notes.some((n) => n.includes('time zone'))).toBe(false);
    expect(planImport(current(), file, NOW).notes.some((n) => n.includes('time zone'))).toBe(false);
  });

  it('warns about files made from an older export (stale basedOn)', () => {
    const file = generated();
    const known = (ids: string[] | undefined) => planImport(current(), file, NOW, ids ? { knownExportIds: ids } : undefined);
    const stale = known(['u-exp-newer001', 'u-exp-base0001']);
    expect(stale.staleBasedOn).toBe(true);
    expect(stale.notes[0]).toBe(
      'This file was made from an older export; changes you made since then are kept where they are protected, but review the list carefully.',
    );
    expect(known(['u-exp-base0001']).staleBasedOn).toBe(false);
    expect(known(undefined).staleBasedOn).toBe(false);
    expect(known([]).staleBasedOn).toBe(true);
    expect(planImport(current(), fresh(), NOW, { knownExportIds: ['u-exp-x'] }).staleBasedOn).toBe(false);
  });

  it('uses the file’s generatedAt as now, else the import time', () => {
    const cur = current((d) => {
      d.scheduleBlocks.push({ id: 'blk-late-1', assignmentId: 'gc-essay', start: '2026-10-11T19:45:00', end: '2026-10-11T20:15:00', origin: 'generated' });
    });
    const withGen = generated((d) => (d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-3')));
    expect(planImport(cur, withGen, NOW).referenceTime).toBe('2026-10-11T19:30:00');
    expect(row(planImport(cur, withGen, NOW), 'scheduleBlocks:blk-late-1').category).toBe('outdated');
    const noGen = valid({ ...clone(withGen), meta: { basedOn: 'u-exp-base0001' } });
    const plan = planImport(cur, noGen, NOW);
    expect(plan.referenceTime).toBe(NOW);
    expect(row(plan, 'scheduleBlocks:blk-late-1').category).toBe('protected'); // in progress at the import time
  });
});

// ===========================================================================
// Errors
// ===========================================================================

describe('errors', () => {
  it('rejects an ID that names a different kind of item', () => {
    const file = freshFile({ classes: [{ id: 'gc-read3', name: 'Reading club', origin: 'generated' }] });
    const plan = planImport(current(), file, NOW);
    expect(plan.errors).toEqual([
      'The file\'s class “Reading club” uses the ID “gc-read3”, which is an assignment in your schedule (“Read Act 3”). An ID always names the same item, so this file can\'t be imported.',
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.noChanges).toBe(false);
    expect(() => applyImport(current(), file, plan, new Set(), NOW)).toThrow(/ID always names the same item/);
    expect(checkImport(current(), file, plan, new Set(), NOW).ok).toBe(false);
  });

  it('rejects a task ID that is an item, or an item ID that is a task', () => {
    const asTask = freshFile({ assignments: [{ ...READING, id: 'gc-other', tasks: [{ id: 'gc-essay', title: 'x' }] }], classes: [CLS_ENG] });
    expect(planImport(current(), asTask, NOW).errors[0]).toMatch(/The file's task “x” uses the ID “gc-essay”, which is an assignment/);
    const asItem = freshFile({ events: [{ ...FENCING, id: 'gc-essay-t2' }] });
    expect(planImport(current(), asItem, NOW).errors[0]).toMatch(/The file's event “Fencing” uses the ID “gc-essay-t2”, which is a task in your schedule \(“Outline”\)/);
  });

  it('rejects a task that moved to another assignment (D27)', () => {
    const file = generated((d) => {
      const outline = d.assignments[0].tasks!.splice(1, 1)[0];
      d.assignments[0].tasks![1].dependsOn = undefined;
      d.assignments[1].tasks = [{ ...outline, dependsOn: undefined }];
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-2');
    });
    const plan = planImport(current(), file, NOW);
    expect(plan.errors).toEqual([
      'The file puts the task “Outline” (ID “gc-essay-t2”) under the assignment “Read Act 3”, but in your schedule it belongs to “Othello Essay”. A task never moves to another assignment (SCHEDULE_FORMAT.md § 16.2), so this file can\'t be imported. The program that wrote the file should cancel the old task and create a new one instead.',
    ]);
  });
});

// ===========================================================================
// Dependents and validity of the result (§ 16.1, § 16.4, D24)
// ===========================================================================

describe('dependents and a valid result', () => {
  it('does not add file items that reference an item that is not added', () => {
    const cur = current((d) => {
      d.deleted = [{ id: 'cls-chem', collection: 'classes', deletedAt: '2026-10-08T10:00:00', title: 'Chemistry' }];
    });
    const file = generated((d) => {
      d.classes.push({ id: 'cls-chem', name: 'Chemistry', origin: 'generated' });
      d.assignments.push(
        { id: 'chem-lab-2026-10-15', classId: 'cls-chem', title: 'Lab report', due: '2026-10-15', origin: 'generated' },
        { id: 'chem-quiz-2026-10-16', classId: 'cls-chem', title: 'Quiz', type: 'quiz', assessmentDate: '2026-10-16', dependsOn: ['chem-lab-2026-10-15'], origin: 'generated' },
        // A new item that only softly depends on it: added, without the dependency.
        { id: 'english-review-2026-10-17', classId: 'gc-class-eng', title: 'Review', due: '2026-10-17', dependsOn: ['chem-lab-2026-10-15'], origin: 'generated' },
      );
      d.events.push({ id: 'evt-chem-quiz-2026-10-16', title: 'Chem quiz sitting', classId: 'cls-chem', assignmentId: 'chem-quiz-2026-10-16', date: '2026-10-16', startTime: '07:00', endTime: '07:30', origin: 'generated' });
      d.scheduleBlocks.push({ id: 'blk-chem-1', assignmentId: 'chem-lab-2026-10-15', start: '2026-10-13T19:00:00', end: '2026-10-13T19:45:00', origin: 'generated' });
      d.issues = [{ id: 'chem-issue', kind: 'other', itemId: 'chem-lab-2026-10-15', message: 'Check the lab date.' }];
    });
    const skipped = run(cur, file);
    const r = row(skipped.plan, 'classes:cls-chem');
    expect(r.category).toBe('previouslyDeleted');
    expect(r.includes?.map((i) => i.key).sort()).toEqual(
      ['assignments:chem-lab-2026-10-15', 'assignments:chem-quiz-2026-10-16', 'events:evt-chem-quiz-2026-10-16', 'scheduleBlocks:blk-chem-1'].sort(),
    );
    expect(row(skipped.plan, 'assignments:chem-lab-2026-10-15').reason).toBe('Not added: it needs the class “Chemistry”, which is not imported.');
    // Items that wait for another row name it (resolved to the row the person can tick), are not applied by
    // default and are counted in that row only.
    for (const key of ['assignments:chem-lab-2026-10-15', 'assignments:chem-quiz-2026-10-16', 'events:evt-chem-quiz-2026-10-16', 'scheduleBlocks:blk-chem-1']) {
      expect(row(skipped.plan, key), key).toMatchObject({ category: 'new', follows: 'classes:cls-chem', selectable: false, defaultSelected: false });
    }
    expect(row(skipped.plan, 'assignments:english-review-2026-10-17').follows).toBeUndefined();
    expect(skipped.plan.summary.new).toEqual({ assignments: 1 });
    expect(summaryLines(skipped.plan)[0].text).toBe('New: + 1 assignment');
    expect(skipped.plan.notes.some((n) => n.includes('depend on items that are not added by default'))).toBe(true);
    expect(skipped.doc.assignments.map((a) => a.id)).not.toContain('chem-lab-2026-10-15');
    expect(asg(skipped.doc, 'english-review-2026-10-17')!.dependsOn).toBeUndefined();
    expect(skipped.doc.issues).toBeUndefined();
    // Waiting for the class row is not a choice that "can't be carried out as ticked".
    expect(checkImport(cur, file, skipped.plan, defaultSelection(skipped.plan), NOW).skipped).toEqual([]);
    expectIdempotent(skipped.doc, file);

    const restored = run(cur, file, { select: ['classes:cls-chem'] });
    expect(restored.doc.assignments.map((a) => a.id)).toEqual(expect.arrayContaining(['chem-lab-2026-10-15', 'chem-quiz-2026-10-16']));
    expect(evt(restored.doc, 'evt-chem-quiz-2026-10-16')).toBeDefined();
    expect(asg(restored.doc, 'english-review-2026-10-17')!.dependsOn).toEqual(['chem-lab-2026-10-15']);
    expect(restored.doc.issues).toHaveLength(1);
    expect(restored.doc.deleted).toBeUndefined();
  });

  it('removes a class together with its removable dependents, or explains why it cannot', () => {
    const cur = current((d) => {
      d.events.push({ id: 'evt-bio-lab-2026-10-20', title: 'Lab sitting', classId: 'cls-biology', assignmentId: TEST.id, date: '2026-10-20', startTime: '16:00', endTime: '17:00', origin: 'generated' });
    });
    const file = fresh((d) => {
      d.classes = d.classes.filter((c) => c.id !== 'cls-biology');
      d.assignments = d.assignments.filter((a) => a.id !== TEST.id);
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-test-1');
    });
    const plan = planImport(cur, file, NOW);
    const bio = row(plan, 'classes:cls-biology');
    expect(bio).toMatchObject({ category: 'missing', selectable: true, removes: true });
    expect(bio.includes?.map((i) => i.key).sort()).toEqual(
      ['assignments:biology-unit-2-test-2026-10-16', 'events:evt-bio-lab-2026-10-20', 'scheduleBlocks:blk-test-1'].sort(),
    );
    const { doc } = run(cur, file, { select: ['classes:cls-biology'] });
    expect(cls(doc, 'cls-biology')).toBeUndefined();
    expect(asg(doc, TEST.id)).toBeUndefined();
    expect(blk(doc, 'blk-test-1')).toBeUndefined();
    // Tombstones for the generated class, assignment and sitting event; not for the block removed with its assignment.
    expect(doc.deleted!.map((t) => t.id).sort()).toEqual(['biology-unit-2-test-2026-10-16', 'cls-biology', 'evt-bio-lab-2026-10-20']);

    // Your own assignment in the class blocks the removal.
    const mine = current((d) => {
      d.assignments.push({ id: 'u-asg-bio00001', classId: 'cls-biology', title: 'My flashcards', origin: 'user' });
      d.scheduleBlocks.push({ id: 'blk-test-0', assignmentId: TEST.id, start: '2026-10-09T15:30:00', end: '2026-10-09T16:00:00', origin: 'generated' });
    });
    const blockedPlan = planImport(mine, fresh((d) => (d.classes = d.classes.filter((c) => c.id !== 'cls-biology'), d.assignments = d.assignments.filter((a) => a.id !== TEST.id), d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-test-1'))), NOW);
    expect(row(blockedPlan, 'classes:cls-biology')).toMatchObject({
      selectable: false,
      defaultSelected: false,
      // The past session belongs to the class's assignment, which would be removed with the class.
      blockedReason: '1 past session belongs to an assignment in this class; 1 of your own assignments uses this class.',
    });
    // A past session blocks removing its assignment (§ 16.4).
    expect(row(blockedPlan, `assignments:${TEST.id}`).blockedReason).toBe('1 past session belongs to this assignment.');
  });

  it('lets the person untick an update that would make the schedule invalid', () => {
    const cur = current((d) => {
      d.assignments[0].recommendedCompletionDate = '2026-10-15';
      d.assignments[0].overrides = ['recommendedCompletionDate'];
    });
    const file = generated((d) => {
      d.assignments[0].due = '2026-10-14T23:59:00';
      d.assignments[0].recommendedCompletionDate = '2026-10-13';
    });
    const plan = planImport(cur, file, NOW);
    const r = row(plan, 'assignments:gc-essay');
    expect(r.category).toBe('updated');
    expect(r.selectable).toBe(true);
    expect(r.defaultSelected).toBe(true);
    expect(r.problems?.length).toBeGreaterThan(0);
    expect(plan.problems!.some((p) => p.key === 'assignments:gc-essay' && p.path.startsWith('assignments['))).toBe(true);
    expect(plan.notes.some((n) => n.startsWith('Some changes cannot be combined'))).toBe(true);
    const bad = checkImport(cur, file, plan, defaultSelection(plan), NOW);
    expect(bad.ok).toBe(false);
    const sel = defaultSelection(plan);
    sel.delete('assignments:gc-essay');
    const ok = checkImport(cur, file, plan, sel, NOW);
    expect(ok.ok).toBe(true);
    expect(essayOf(ok.doc)).toEqual(essayOf(cur));
    expect(applyImport(cur, file, plan, sel, NOW)).toEqual(ok.doc);
  });

  it('shows a problem caused by your own task on the task row and lets the assignment update be unticked', () => {
    const cur = current((d) => {
      d.assignments[0].tasks!.push({ id: 'u-tsk-print001', title: 'Print it', due: '2026-10-16', origin: 'user' });
    });
    const file = generated((d) => {
      d.assignments[0].due = '2026-10-15T23:59:00';
      d.assignments[0].tasks!.push({ id: 'u-tsk-print001', title: 'Print it at school', due: '2026-10-15', origin: 'user' });
    });
    const plan = planImport(cur, file, NOW);
    const task = row(plan, 'tasks:u-tsk-print001');
    expect(task).toMatchObject({ category: 'kept', selectable: true, defaultSelected: false });
    expect(task.problems?.length).toBeGreaterThan(0);
    const essay = row(plan, 'assignments:gc-essay');
    expect(essay).toMatchObject({ category: 'updated', selectable: true, defaultSelected: true });
    expect(essay.problems).toEqual(task.problems);
    // Either take the file's version of the task, or keep the current deadline.
    expect(checkImport(cur, file, plan, new Set([...defaultSelection(plan), 'tasks:u-tsk-print001']), NOW).ok).toBe(true);
    const sel = defaultSelection(plan);
    sel.delete('assignments:gc-essay');
    expect(checkImport(cur, file, plan, sel, NOW).ok).toBe(true);
  });

  it('keeps the current version of an update whose new references are not imported', () => {
    const cur = current((d) => {
      d.deleted = [{ id: 'cls-lit', collection: 'classes', deletedAt: '2026-10-08T10:00:00', title: 'Literature' }];
    });
    const file = generated((d) => {
      d.classes.push({ id: 'cls-lit', name: 'Literature', origin: 'generated' });
      d.assignments[1].classId = 'cls-lit';
      d.assignments[1].estimatedMinutes = 70;
    });
    const plan = planImport(cur, file, NOW);
    expect(row(plan, 'classes:cls-lit').includes?.map((i) => i.key)).toEqual(['assignments:gc-read3']);
    const skipped = run(cur, file);
    expect(asg(skipped.doc, 'gc-read3')).toEqual(asg(cur, 'gc-read3'));
    expect(row(skipped.plan, 'assignments:gc-read3').reason).toMatch(/Not updated: the file's version needs the class “Literature”/);
    expect(row(skipped.plan, 'assignments:gc-read3')).toMatchObject({ category: 'updated', follows: 'classes:cls-lit', defaultSelected: false });
    expect(skipped.plan.summary.updated).toEqual({});
    expect(skipped.plan.fieldSummary).toEqual([]);
    expectIdempotent(skipped.doc, file);
    // The row says which row decides it (follows); it is not a ticked choice that "can't be carried out".
    const check = checkImport(cur, file, plan, defaultSelection(plan), NOW);
    expect(check.skipped).toEqual([]);
    const taken = run(cur, file, { select: ['classes:cls-lit'] });
    expect(asg(taken.doc, 'gc-read3')).toMatchObject({ classId: 'cls-lit', estimatedMinutes: 70 });
  });

  it('cancels a removal that a kept item still uses', () => {
    const cur = current((d) => {
      d.assignments[1].classId = 'cls-biology';
      d.assignments[1].overrides = ['classId'];
    });
    const file = fresh((d) => {
      d.classes = d.classes.filter((c) => c.id !== 'cls-biology');
      d.assignments = d.assignments.filter((a) => a.id !== TEST.id);
      d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-test-1');
    });
    const plan = planImport(cur, file, NOW);
    expect(row(plan, 'classes:cls-biology')).toMatchObject({
      selectable: false,
      blockedReason: '1 assignment that you keep from before still uses this class.',
    });
    // Even if a UI ignores `selectable`, the result stays valid and the class stays.
    const doc = applyImport(cur, file, plan, new Set(['classes:cls-biology']), NOW);
    expect(cls(doc, 'cls-biology')).toBeDefined();
    expect(validateDocument(doc, { today: TODAY }).errors).toEqual([]);
  });

  it('produces a valid result for any selection (randomized)', () => {
    const { cur, file } = largeScenario();
    const plan = planImport(cur, file, NOW, { knownExportIds: ['u-exp-base0001'] });
    expect(plan.errors).toEqual([]);
    const selectable = plan.changes.filter((c) => c.selectable).map((c) => c.key);
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 40; round++) {
      const selected = new Set(selectable.filter(() => random() < 0.5));
      const check = checkImport(cur, file, plan, selected, NOW);
      const refProblems = check.problems.filter((p) => /unknown|reference|duplicate|exist/i.test(p.message) || p.path.startsWith('deleted'));
      expect(refProblems, `round ${round}`).toEqual([]);
      expect(applyImport(cur, file, plan, selected, NOW)).toEqual(check.doc);
    }
    // All selectable rows ticked, and none.
    expect(checkImport(cur, file, plan, new Set(selectable), NOW).problems).toEqual([]);
    expect(checkImport(cur, file, plan, new Set(), NOW).problems).toEqual([]);
  });
});

// ===========================================================================
// Round trip and a large realistic scenario
// ===========================================================================

function loadExample(): ScheduleDocument {
  return valid(JSON.parse(readFileSync(resolve(here, '../../examples/complete-schedule.json'), 'utf8')));
}

function dispatchAll(doc: ScheduleDocument, actions: Action[]): ScheduleDocument {
  let state: AppState = initialState(doc);
  for (const a of actions) state = reducer(state, a);
  return state.doc;
}

/** The example imported into an empty schedule, then edited by the person in the website. */
function personSchedule(): ScheduleDocument {
  const example = loadExample();
  const first = planImport(emptyDocument(), example, '2026-10-11T19:45:00');
  const imported = applyImport(emptyDocument(), example, first, defaultSelection(first), '2026-10-11T19:45:00');
  const at = '2026-10-11T21:00:00';
  const read = imported.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAy')!;
  return dispatchAll(imported, [
    // Marked the past reading session done.
    { type: 'setBlockStatus', id: 'blk-gc-NzAwMDAwMDAwMDAy-202610092000-1', status: 'done', now: at },
    // Moved a generated session (locks it).
    { type: 'moveBlock', id: 'blk-piano-theory-exam-2026-10-24-202610111930-1', start: '2026-10-17T11:00:00', end: '2026-10-17T12:00:00' },
    // Edited a generated assignment's estimate (override) and added notes.
    { type: 'upsertAssignment', item: { ...read, estimatedMinutes: 60, notes: 'Use the audiobook.' }, now: at },
    // Deleted the withdrawn worksheet (tombstone).
    { type: 'deleteAssignment', id: 'gc-NzAwMDAwMDAwMDAz', now: at },
    // Added an own assignment and an own block.
    { type: 'upsertAssignment', item: { id: 'u-asg-chem0001', title: 'Chemistry flashcards', due: '2026-10-19', estimatedMinutes: 40 }, now: at },
    { type: 'upsertBlock', item: { id: 'u-blk-chem0001', assignmentId: 'u-asg-chem0001', start: '2026-10-16T19:00:00', end: '2026-10-16T19:40:00' } },
    // Resolved a root issue.
    { type: 'setIssueStatus', scope: null, index: 0, status: 'resolved', newIssueId: 'u-iss-aaaaaaaa' },
  ]);
}

function largeScenario(): { cur: ScheduleDocument; file: ScheduleDocument; exported: ScheduleDocument } {
  const cur = valid(personSchedule());
  const exported = valid(exportDocument(cur, '2026-10-11T21:05:00', { exportId: 'u-exp-base0001', timezone: 'America/New_York' }));
  // The /academic-schedule skill updates the exported file (generator-like modification).
  const g = clone(exported) as ScheduleDocument;
  g.meta = {
    title: g.meta?.title,
    generatedAt: '2026-10-12T07:00:00',
    generator: { name: 'academic-schedule-skill', version: '1.0' },
    timezone: 'America/New_York',
    basedOn: 'u-exp-base0001',
    sources: [
      { kind: 'schedule', label: 'schedule.json (exported Oct 11)' },
      { kind: 'google_classroom', id: 'NjI3ODk0MjE0NTQ5', label: 'English 10 - 2026-10-12.zip', retrievedAt: '2026-10-12T06:30:00' },
    ],
    requestedChanges: [{ id: 'u-evt-p4n0l7s2', reason: 'You said piano moved to 5:30 PM.', requestedByPerson: true }],
  };
  const essay = g.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAx')!;
  essay.due = '2026-10-17T23:59:00'; // Classroom moved the essay
  essay.estimatedMinutes = 270;
  essay.estimateRange = { min: 240, max: 300 };
  essay.tasks!.find((t) => t.id === 'gc-NzAwMDAwMDAwMDAx-t4')!.estimatedMinutes = 90;
  const read = g.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAy')!;
  read.estimatedMinutes = 45; // overridden by the person: must stay 60
  const test = g.assignments.find((a) => a.id === 'biology-unit-2-test-cells-2026-10-16')!;
  test.issues = [...(test.issues ?? []), { id: 'biology-unit-2-test-cells-2026-10-16:ambiguity:topic', kind: 'ambiguity', message: 'Does the test include chapter 5?' }];
  // A new assignment with two sessions.
  g.assignments.push({
    id: 'gc-NzAwMDAwMDAwMDA3',
    classId: 'gc-class-NjI3ODk0MjE0NTQ5',
    title: 'Act 4 reading questions',
    type: 'homework',
    due: '2026-10-19T23:59:00',
    estimatedMinutes: 60,
    origin: 'generated',
    source: { kind: 'google_classroom', id: 'NzAwMDAwMDAwMDA3' },
  });
  g.scheduleBlocks.push(
    { id: 'blk-gc-NzAwMDAwMDAwMDA3-202610120700-1', assignmentId: 'gc-NzAwMDAwMDAwMDA3', start: '2026-10-16T16:00:00', end: '2026-10-16T16:30:00', origin: 'generated' },
    { id: 'blk-gc-NzAwMDAwMDAwMDA3-202610120700-2', assignmentId: 'gc-NzAwMDAwMDAwMDA3', start: '2026-10-18T11:00:00', end: '2026-10-18T11:30:00', origin: 'generated' },
  );
  // Re-plan the essay revision: drop the old session, add a longer one later.
  g.scheduleBlocks = g.scheduleBlocks.filter((b) => b.id !== 'blk-gc-NzAwMDAwMDAwMDAx-202610092000-5');
  g.scheduleBlocks.push({
    id: 'blk-gc-NzAwMDAwMDAwMDAx-202610120700-1',
    assignmentId: 'gc-NzAwMDAwMDAwMDAx',
    taskId: 'gc-NzAwMDAwMDAwMDAx-t4',
    start: '2026-10-16T17:00:00',
    end: '2026-10-16T18:00:00',
    origin: 'generated',
  });
  // The generator re-created the assignment the person deleted (it should not have).
  g.assignments.push({
    id: 'gc-NzAwMDAwMDAwMDAz',
    classId: 'gc-class-NjI3ODk0MjE0NTQ5',
    title: 'Grammar worksheet 3: Commas',
    due: '2026-10-14T23:59:00',
    origin: 'generated',
    source: { kind: 'google_classroom', id: 'NzAwMDAwMDAwMDAz' },
  });
  g.deleted = (g.deleted ?? []).filter((t) => t.id !== 'gc-NzAwMDAwMDAwMDAz');
  // Piano moved (requested by the person).
  const piano = g.events.find((e) => e.id === 'u-evt-p4n0l7s2')!;
  piano.startTime = '17:30';
  piano.endTime = '18:30';
  // The generator also changed the person's own library assignment without listing it.
  g.assignments.find((a) => a.id === 'u-asg-k3j9x2p1')!.estimatedMinutes = 25;
  // Settings suggestion.
  g.settings = { ...(g.settings ?? {}), breakMinutes: 15 };
  // The overloaded-day issue: the generator re-raises it open.
  g.issues = (g.issues ?? []).map((i) => ({ ...i, status: undefined }));
  return { cur, file: genFile(g), exported };
}

describe('round trip and a large realistic scenario', () => {
  it('imports the complete example into an empty schedule and re-imports it as no changes', () => {
    const example = loadExample();
    const { plan, doc } = run(emptyDocument(), example);
    expect(plan.summary.new).toEqual({ classes: 2, assignments: 6, events: 5, availability: 2, scheduleBlocks: 12 });
    expect(plan.summary.setting).toEqual({ settings: 1 });
    expect(doc.meta).toEqual({ title: example.meta!.title, sources: example.meta!.sources });
    expect(doc.deleted).toEqual(example.deleted);
    expect(doc.issues).toEqual(example.issues);
    expectIdempotent(doc, example);
  });

  it('re-importing your own export changes nothing', () => {
    const cur = valid(personSchedule());
    const exported = valid(exportDocument(cur, '2026-10-11T21:05:00', { exportId: 'u-exp-own00001', timezone: 'America/New_York' }));
    const plan = planImport(cur, exported, '2026-10-11T21:10:00', { knownExportIds: ['u-exp-own00001'] });
    expect(plan.errors).toEqual([]);
    expect(plan.noChanges).toBe(true);
    expect(plan.changes.filter((c) => c.category !== 'unchanged').map((c) => c.key)).toEqual([]);
    const doc = applyImport(cur, exported, plan, defaultSelection(plan), '2026-10-11T21:10:00');
    expect(doc).toEqual(cur);
  });

  it('merges a generator’s update of an export as the spec says', () => {
    const { cur, file } = largeScenario();
    const { plan, doc } = run(cur, file, { options: { knownExportIds: ['u-exp-base0001'] } });
    expect(plan.staleBasedOn).toBe(false);
    expect(plan.fresh).toBe(false);
    const cat = (key: string) => row(plan, key).category;

    // New work and its sessions.
    expect(cat('assignments:gc-NzAwMDAwMDAwMDA3')).toBe('new');
    expect(cat('scheduleBlocks:blk-gc-NzAwMDAwMDAwMDA3-202610120700-1')).toBe('new');
    expect(cat('scheduleBlocks:blk-gc-NzAwMDAwMDAwMDAx-202610120700-1')).toBe('new');
    expect(plan.summary.new).toEqual({ assignments: 1, scheduleBlocks: 3 });

    // Updated: the essay's due date, estimates and its revision task.
    const essay = row(plan, 'assignments:gc-NzAwMDAwMDAwMDAx');
    expect(essay.category).toBe('updated');
    expect(essay.fields.map((f) => f.label)).toEqual([
      'Due date',
      'Workload estimate',
      'Estimate range',
      'Task “Revise, cite and format (MLA)” · Workload estimate',
    ]);
    expect(essay.fields[0]).toMatchObject({ before: 'Oct 16, 11:59 PM', after: 'Oct 17, 11:59 PM' });
    expect(plan.fieldSummary).toEqual([
      { group: 'dueDate', count: 1, text: '1 due date' },
      { group: 'estimate', count: 1, text: '1 workload estimate' },
      { group: 'details', count: 1, text: '1 other detail' },
    ]);
    expect(cat('assignments:biology-unit-2-test-cells-2026-10-16')).toBe('updated');

    // The person's override of the reading estimate is kept, so it is unchanged.
    expect(cat('assignments:gc-NzAwMDAwMDAwMDAy')).toBe('unchanged');
    // (The example already had the person's priority override; the edit added the estimate.)
    expect(asg(doc, 'gc-NzAwMDAwMDAwMDAy')).toMatchObject({ estimatedMinutes: 60, notes: 'Use the audiobook.' });
    expect([...asg(doc, 'gc-NzAwMDAwMDAwMDAy')!.overrides!].sort()).toEqual(['estimatedMinutes', 'priority']);

    // The deleted worksheet is not brought back.
    expect(cat('assignments:gc-NzAwMDAwMDAwMDAz')).toBe('previouslyDeleted');
    expect(asg(doc, 'gc-NzAwMDAwMDAwMDAz')).toBeUndefined();
    expect(doc.deleted!.map((t) => t.id)).toContain('gc-NzAwMDAwMDAwMDAz');

    // The re-planned revision session is outdated; the moved (locked) piano session and done sessions stay.
    expect(cat('scheduleBlocks:blk-gc-NzAwMDAwMDAwMDAx-202610092000-5')).toBe('outdated');
    expect(blk(doc, 'blk-gc-NzAwMDAwMDAwMDAx-202610092000-5')).toBeUndefined();
    expect(blk(doc, 'blk-piano-theory-exam-2026-10-24-202610111930-1')).toMatchObject({ start: '2026-10-17T11:00:00', locked: true });
    expect(cat('scheduleBlocks:blk-gc-NzAwMDAwMDAwMDAy-202610092000-1')).toBe('unchanged');
    expect(blk(doc, 'blk-gc-NzAwMDAwMDAwMDAy-202610092000-1')!.status).toBe('done');

    // Requested change to the piano event (pre-ticked), unlisted change to the person's assignment (kept).
    expect(row(plan, 'events:u-evt-p4n0l7s2')).toMatchObject({ category: 'yourItems', defaultSelected: true });
    expect(evt(doc, 'u-evt-p4n0l7s2')).toMatchObject({ startTime: '17:30', endTime: '18:30', origin: 'user' });
    expect(row(plan, 'assignments:u-asg-k3j9x2p1')).toMatchObject({ category: 'kept', defaultSelected: false });
    expect(asg(doc, 'u-asg-k3j9x2p1')!.estimatedMinutes).toBe(15);

    // The person's own new items are not in the file... they are, because the export contained them.
    expect(cat('assignments:u-asg-chem0001')).toBe('unchanged');
    expect(cat('scheduleBlocks:u-blk-chem0001')).toBe('unchanged');

    // Settings are offered, not taken.
    // (The person never took the example's settings, so the defaults apply.)
    expect(row(plan, 'settings:breakMinutes')).toMatchObject({ defaultSelected: false, neverSet: true, fields: [{ before: '10 m', after: '15 m' }] });
    expect(doc.settings?.breakMinutes).toBeUndefined();

    // The resolved root issue keeps its decision.
    expect(doc.issues!.find((i) => i.id === 'workload:2026-10-15')!.status).toBe('resolved');

    // Meta: the file's title and sources are stored.
    expect(doc.meta).toEqual({ title: 'Fall 2026 — Week of Oct 12', sources: file.meta!.sources });

    expectIdempotent(doc, file);

    // Exporting the result and importing that export again changes nothing either.
    const again = valid(exportDocument(doc, '2026-10-12T08:00:00', { exportId: 'u-exp-next0001', timezone: 'America/New_York' }));
    expect(planImport(doc, again, '2026-10-12T08:00:00').noChanges).toBe(true);
  });

  it('gives a readable preview summary for the large scenario', () => {
    const { cur, file } = largeScenario();
    const plan = planImport(cur, file, NOW);
    const lines = (['new', 'updated', 'unchanged'] as const).map((c) => `${c}: ${formatCounts(plan.summary[c]).join(', ')}`);
    expect(lines[0]).toBe('new: 1 assignment, 3 scheduled work blocks');
    expect(lines[1]).toBe('updated: 2 assignments');
    expect(plan.notes).toContain(
      'Sessions are compared with the time the file was made (Oct 12, 7:00 AM): sessions that had started by then are kept as they are.',
    );
    const block = row(plan, 'scheduleBlocks:blk-gc-NzAwMDAwMDAwMDAx-202610120700-1');
    expect(block.label).toBe('Fri, Oct 16, 5:00–6:00 PM · Othello Essay / Revise, cite and format (MLA)');
    expect(row(plan, 'assignments:gc-NzAwMDAwMDAwMDA3').detail).toBe('English 10 · Due Oct 19, 11:59 PM · 1 h');
  });
});

describe('more merge rules', () => {
  it('applies a task’s cancelled from the file over not started, never over done', () => {
    const file = generated((d) => {
      const tasks = d.assignments[0].tasks!;
      tasks[0] = { ...tasks[0], status: 'cancelled' };
      delete tasks[0].completedAt;
      tasks[3] = { ...tasks[3], status: 'cancelled' };
    });
    const { doc, plan } = run(current(), file);
    const byId = new Map(essayOf(doc).tasks!.map((t) => [t.id, t]));
    expect(byId.get('gc-essay-t1')).toMatchObject({ status: 'done', completedAt: '2026-10-10T10:30:00' });
    expect(byId.get('gc-essay-t4')!.status).toBe('cancelled');
    expect(row(plan, 'assignments:gc-essay').fields).toEqual([
      { field: 'tasks.status', label: 'Task “Revise” · Status', before: 'Not started', after: 'Cancelled', group: 'tasks', taskId: 'gc-essay-t4' },
    ]);
    expectIdempotent(doc, file);
  });

  it('moves a future generated session but keeps its notes; a planner block stays a planner block', () => {
    const cur = current((d) => {
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-3')!.notes = 'Library computer';
      d.scheduleBlocks.push({ id: 'u-blk-plan0003', assignmentId: 'gc-essay', start: '2026-10-15T17:00:00', end: '2026-10-15T17:45:00', origin: 'planner' });
    });
    const file = generated((d) => {
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-3')!.start = '2026-10-13T17:00:00';
      d.scheduleBlocks.find((b) => b.id === 'blk-essay-3')!.end = '2026-10-13T17:50:00';
      // A generator treats an unlocked future planner block like its own (§ 15.7) — and must not change origin.
      d.scheduleBlocks.push({ id: 'u-blk-plan0003', assignmentId: 'gc-essay', start: '2026-10-15T18:00:00', end: '2026-10-15T18:45:00', origin: 'generated' });
    });
    const { doc, plan } = run(cur, file);
    expect(blk(doc, 'blk-essay-3')).toMatchObject({ start: '2026-10-13T17:00:00', notes: 'Library computer' });
    expect(row(plan, 'scheduleBlocks:blk-essay-3').fields.map((f) => f.field)).toEqual(['start']);
    expect(blk(doc, 'u-blk-plan0003')).toMatchObject({ start: '2026-10-15T18:00:00', origin: 'planner' });
    expectIdempotent(doc, file);
  });

  it('offers to delete a pinned task that the file’s deleted list names (Kept (c) for tasks)', () => {
    const cur = current((d) => {
      d.assignments[0].tasks![3] = { ...d.assignments[0].tasks![3], locked: true };
    });
    const file = generated((d) => {
      d.assignments[0].tasks!.splice(3, 1);
      d.deleted = [{ id: 'gc-essay-t4', collection: 'tasks', deletedAt: '2026-10-11T09:00:00', title: 'Revise' }];
    });
    const kept = run(cur, file);
    expect(row(kept.plan, 'tasks:gc-essay-t4#deleted')).toMatchObject({
      category: 'kept',
      aspect: 'deletedInFile',
      parentId: 'gc-essay',
      selectable: true,
      defaultSelected: false,
      removes: true,
    });
    expect(essayOf(kept.doc).tasks!.map((t) => t.id)).toContain('gc-essay-t4');
    // The entry names a task that stays, so it is not added.
    expect(kept.doc.deleted).toBeUndefined();
    expectIdempotent(kept.doc, file);

    const removed = run(cur, file, { select: ['tasks:gc-essay-t4#deleted'] });
    expect(essayOf(removed.doc).tasks!.map((t) => t.id)).not.toContain('gc-essay-t4');
    expect(removed.doc.deleted).toEqual([{ id: 'gc-essay-t4', collection: 'tasks', deletedAt: NOW, title: 'Revise' }]);
  });

  it('keeps issue decisions on tasks and on items of every collection', () => {
    const cur = current((d) => {
      d.assignments[0].tasks![2].issues = [{ id: 't-issue', kind: 'workload', message: 'Long draft.', status: 'dismissed' }];
      d.events[1].issues = [{ id: 'e-issue', kind: 'ambiguity', message: 'Which gym?', status: 'resolved' }];
    });
    const file = generated((d) => {
      d.assignments[0].tasks![2].issues = [{ id: 't-issue', kind: 'workload', message: 'Long draft (3 h).' }];
      d.events[1].issues = [{ id: 'e-issue', kind: 'ambiguity', message: 'Which gym?' }];
    });
    const { doc, plan } = run(cur, file);
    expect(essayOf(doc).tasks![2].issues).toEqual([{ id: 't-issue', kind: 'workload', message: 'Long draft (3 h).', status: 'dismissed' }]);
    expect(evt(doc, 'evt-fencing')!.issues).toEqual([{ id: 'e-issue', kind: 'ambiguity', message: 'Which gym?', status: 'resolved' }]);
    expect(row(plan, 'events:evt-fencing').category).toBe('unchanged');
    expectIdempotent(doc, file);
  });

  it('ignores requested changes for items that exist nowhere, with a note', () => {
    const file = generated(undefined, { requestedChanges: [{ id: 'u-evt-gone0001', reason: 'Removed.', requestedByPerson: true }] });
    const plan = planImport(current(), file, NOW);
    expect(plan.notes).toContain('The file lists a change to “u-evt-gone0001”, which is not in your schedule or in the file; it is ignored.');
    expect(plan.noChanges).toBe(true);
  });

  it('treats an unlisted change to an item inside your own assignment as part of that assignment (Kept)', () => {
    const cur = current((d) => {
      d.assignments.find((a) => a.id === 'u-asg-lib00001')!.tasks = [{ id: 'u-tsk-lib00001', title: 'Find the books', origin: 'user' }];
    });
    const file = generated((d) => {
      const lib = d.assignments.find((a) => a.id === 'u-asg-lib00001')!;
      lib.tasks = [{ id: 'u-tsk-lib00001', title: 'Find all the books', origin: 'user' }, { id: 'u-asg-lib00001-t2', title: 'Pay the fine' }];
      d.scheduleBlocks.push({ id: 'blk-lib-fine', assignmentId: 'u-asg-lib00001', taskId: 'u-asg-lib00001-t2', start: '2026-10-14T16:30:00', end: '2026-10-14T16:45:00', origin: 'generated' });
    });
    const kept = run(cur, file);
    expect(row(kept.plan, 'assignments:u-asg-lib00001').category).toBe('kept');
    expect(asg(kept.doc, 'u-asg-lib00001')!.tasks).toEqual([{ id: 'u-tsk-lib00001', title: 'Find the books', origin: 'user' }]);
    // The new session needs the file's new task, which comes only with the file's version of the assignment.
    expect(row(kept.plan, 'scheduleBlocks:blk-lib-fine')).toMatchObject({ category: 'new', follows: 'assignments:u-asg-lib00001', defaultSelected: false });
    expect(blk(kept.doc, 'blk-lib-fine')).toBeUndefined();
    expectIdempotent(kept.doc, file);

    const taken = run(cur, file, { select: ['assignments:u-asg-lib00001'] });
    expect(asg(taken.doc, 'u-asg-lib00001')!.tasks!.map((t) => t.title)).toEqual(['Find all the books', 'Pay the fine']);
    expect(blk(taken.doc, 'blk-lib-fine')).toBeDefined();
    expect(asg(taken.doc, 'u-asg-lib00001')!.origin).toBe('user');
  });
});

describe('helpers', () => {
  it('defaultSelection returns the pre-ticked selectable rows', () => {
    const plan = planImport(
      current(),
      generated((d) => {
        d.scheduleBlocks = d.scheduleBlocks.filter((b) => b.id !== 'blk-essay-3');
        d.settings = { breakMinutes: 5 };
      }),
      NOW,
    );
    expect([...defaultSelection(plan)]).toEqual(['scheduleBlocks:blk-essay-3']);
  });

  it('formatCounts names collections in the singular and plural', () => {
    expect(formatCounts({ scheduleBlocks: 8, assignments: 3, settings: 1 })).toEqual(['3 assignments', '8 scheduled work blocks', '1 setting']);
    expect(formatCounts({})).toEqual([]);
  });

  it('does not change its inputs', () => {
    const cur = current();
    const file = generated((d) => (d.assignments[0].due = '2026-10-17T23:59:00'));
    const curCopy = clone(cur);
    const fileCopy = clone(file);
    const plan = planImport(cur, file, NOW);
    const doc = applyImport(cur, file, plan, defaultSelection(plan), NOW);
    expect(cur).toEqual(curCopy);
    expect(file).toEqual(fileCopy);
    essayOf(doc).tasks![0].title = 'mutated';
    expect(essayOf(cur).tasks![0].title).toBe('Thesis and quotations');
    expect(essayOf(file).tasks![0].title).toBe('Thesis and quotations');
  });
});

// Keep the Task type import used (documentation of the shape in fixtures above).
export type _TaskShape = Task;
