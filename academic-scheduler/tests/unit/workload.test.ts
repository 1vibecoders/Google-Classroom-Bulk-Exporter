import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Assignment, ScheduleBlock, ScheduleDocument } from '../../src/model/types';
import {
  assignmentProgress,
  deadlineDateOf,
  deadlineOf,
  progressByAssignment,
  summarizeWorkload,
  taskDeadlineOf,
  taskRemainingMinutes,
  workloadByDay,
  workloadTotals,
} from '../../src/lib/workload';

const example = JSON.parse(
  readFileSync(new URL('../../examples/complete-schedule.json', import.meta.url), 'utf8'),
) as ScheduleDocument;

function makeDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return { schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], ...partial };
}

const NOW = '2026-10-11T19:30:00';

function block(id: string, assignmentId: string, start: string, end: string, extra: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return { id, assignmentId, start, end, ...extra };
}

function progressOf(doc: ScheduleDocument, id: string, now = NOW) {
  return assignmentProgress(doc, doc.assignments.find((a) => a.id === id)!, now);
}

describe('§ 8.1 worked example (complete example, now = meta.generatedAt)', () => {
  it('Othello essay: remaining 210, scheduled 210, unscheduled 0', () => {
    const p = progressOf(example, 'gc-NzAwMDAwMDAwMDAx');
    expect(p.estimatedMinutes).toBe(240);
    expect(p.remainingMinutes).toBe(210);
    expect(p.scheduledMinutes).toBe(210);
    expect(p.unscheduledMinutes).toBe(0);
    expect(p.doneMinutes).toBe(30);
    expect(p.counts).toBe(true);
    expect(p.tasksTotal).toBe(4);
    expect(p.tasksDone).toBe(1);
    expect(p.nextBlock?.id).toBe('blk-gc-NzAwMDAwMDAwMDAx-202610092000-2');
    expect(p.blocks.map((b) => b.id)).toEqual([
      'blk-gc-NzAwMDAwMDAwMDAx-202610092000-1',
      'blk-gc-NzAwMDAwMDAwMDAx-202610092000-2',
      'blk-gc-NzAwMDAwMDAwMDAx-202610092000-3',
      'blk-gc-NzAwMDAwMDAwMDAx-202610092000-4',
      'blk-gc-NzAwMDAwMDAwMDAx-202610092000-5',
    ]);
    expect(p.overdue).toBe(false);
  });

  it('withdrawn work does not count', () => {
    const p = progressOf(example, 'gc-NzAwMDAwMDAwMDAz');
    expect(p.counts).toBe(false);
    expect(p.remainingMinutes).toBe(0);
    expect(p.unscheduledMinutes).toBe(0);
  });

  it('every counting assignment of the example is fully scheduled', () => {
    const all = progressByAssignment(example, NOW);
    for (const a of example.assignments) expect(all.get(a.id)!.unscheduledMinutes, a.id).toBe(0);
    expect(all.get('biology-unit-2-test-cells-2026-10-16')!.remainingMinutes).toBe(150);
  });
});

describe('remaining work rules', () => {
  const base: Assignment = { id: 'a', title: 'A', estimatedMinutes: 100 };

  it('rule 5: estimate minus done minutes; past planned blocks are not done and not scheduled', () => {
    const doc = makeDoc({
      assignments: [base],
      scheduleBlocks: [
        block('done', 'a', '2026-10-10T16:00:00', '2026-10-10T16:30:00', { status: 'done' }),
        block('past', 'a', '2026-10-11T16:00:00', '2026-10-11T16:20:00'),
        block('skip', 'a', '2026-10-11T17:00:00', '2026-10-11T17:20:00', { status: 'skipped' }),
        block('now', 'a', '2026-10-11T19:00:00', '2026-10-11T20:00:00'), // in progress → planned
        block('later', 'a', '2026-10-12T16:00:00', '2026-10-12T16:15:00'),
      ],
    });
    const p = progressOf(doc, 'a');
    expect(p.remainingMinutes).toBe(70);
    expect(p.doneMinutes).toBe(30);
    expect(p.scheduledMinutes).toBe(75);
    expect(p.unscheduledMinutes).toBe(0);
    expect(p.nextBlock?.id).toBe('later'); // starts at or after now
  });

  it('rule 1: done or cancelled assignments have nothing remaining', () => {
    for (const status of ['done', 'cancelled'] as const) {
      const p = progressOf(makeDoc({ assignments: [{ ...base, status }] }), 'a');
      expect(p.counts).toBe(false);
      expect(p.remainingMinutes).toBe(0);
    }
  });

  it('rule 2: optional work counts only once it has a planned block', () => {
    const optional = { ...base, required: false };
    expect(progressOf(makeDoc({ assignments: [optional] }), 'a')).toMatchObject({ counts: false, remainingMinutes: 0 });
    const planned = makeDoc({ assignments: [optional], scheduleBlocks: [block('p', 'a', '2026-10-12T16:00:00', '2026-10-12T16:30:00')] });
    expect(progressOf(planned, 'a')).toMatchObject({ counts: true, remainingMinutes: 100, unscheduledMinutes: 70 });
  });

  it('rule 3: missing/withdrawn work counts only while in progress', () => {
    expect(progressOf(makeDoc({ assignments: [{ ...base, sourceState: 'missing' }] }), 'a').counts).toBe(false);
    expect(progressOf(makeDoc({ assignments: [{ ...base, sourceState: 'withdrawn', status: 'in_progress' }] }), 'a')).toMatchObject({
      counts: true,
      remainingMinutes: 100,
    });
  });

  it('rule 4: tasks with estimates plus the untasked remainder', () => {
    const a: Assignment = {
      id: 'a',
      title: 'Project',
      estimatedMinutes: 200,
      tasks: [
        { id: 't1', title: 'Research', estimatedMinutes: 60, status: 'done' },
        { id: 't2', title: 'Draft', estimatedMinutes: 60 },
        { id: 't3', title: 'Dropped', estimatedMinutes: 30, status: 'cancelled' },
        { id: 't4', title: 'Bonus', estimatedMinutes: 20, required: false },
        { id: 't5', title: 'Unestimated' },
      ],
    };
    const doc = makeDoc({
      assignments: [a],
      scheduleBlocks: [
        block('d2', 'a', '2026-10-10T16:00:00', '2026-10-10T16:25:00', { status: 'done', taskId: 't2' }),
        block('dn', 'a', '2026-10-10T17:00:00', '2026-10-10T17:10:00', { status: 'done' }),
      ],
    });
    // t2: 60 − 25 = 35; t4 optional without planned block: 0; untasked: 200 − (60 + 60 + 20) − 10 = 50.
    const p = progressOf(doc, 'a');
    expect(p.remainingMinutes).toBe(85);
    expect(p.tasksTotal).toBe(4);
    expect(taskRemainingMinutes(doc, a, a.tasks![1])).toBe(35);
    expect(taskRemainingMinutes(doc, a, a.tasks![3])).toBe(0);

    // A planned block makes the optional task count.
    const withBonus = { ...doc, scheduleBlocks: [...doc.scheduleBlocks, block('b4', 'a', '2026-10-13T16:00:00', '2026-10-13T16:20:00', { taskId: 't4' })] };
    expect(progressOf(withBonus, 'a').remainingMinutes).toBe(105);
    expect(progressOf(withBonus, 'a').unscheduledMinutes).toBe(85);
  });

  it('uses the sum of task estimates when the assignment has none; null when nothing is estimated', () => {
    const tasksOnly = makeDoc({ assignments: [{ id: 'a', title: 'A', tasks: [{ id: 't1', title: 'x', estimatedMinutes: 40 }, { id: 't2', title: 'y', estimatedMinutes: 20 }] }] });
    expect(progressOf(tasksOnly, 'a')).toMatchObject({ estimatedMinutes: 60, remainingMinutes: 60, unscheduledMinutes: 60 });
    const none = makeDoc({ assignments: [{ id: 'a', title: 'A' }] });
    expect(progressOf(none, 'a')).toMatchObject({ estimatedMinutes: null, remainingMinutes: null, unscheduledMinutes: null, counts: true });
  });

  it('break blocks never count as work', () => {
    const doc = makeDoc({
      assignments: [base],
      scheduleBlocks: [{ id: 'br', title: 'Break', kind: 'break', start: '2026-10-12T16:00:00', end: '2026-10-12T16:30:00' }],
    });
    expect(progressOf(doc, 'a').scheduledMinutes).toBe(0);
  });
});

describe('deadlines and overdue', () => {
  it('deadlineOf: date-only due at defaultDueTime, date-only assessment at 00:00, the earlier of both', () => {
    const doc = makeDoc();
    expect(deadlineOf(doc, { id: 'a', title: 'A', due: '2026-10-13' })).toBe('2026-10-13T00:00:00');
    expect(deadlineOf({ ...doc, settings: { defaultDueTime: '23:59' } }, { id: 'a', title: 'A', due: '2026-10-13' })).toBe('2026-10-13T23:59:00');
    expect(deadlineOf(doc, { id: 'a', title: 'A', due: '2026-10-16T23:59' })).toBe('2026-10-16T23:59:00');
    expect(deadlineOf(doc, { id: 'a', title: 'A', assessmentDate: '2026-10-16' })).toBe('2026-10-16T00:00:00');
    expect(deadlineOf(doc, { id: 'a', title: 'A', assessmentDate: '2026-10-16T09:10:00', due: '2026-10-17T08:00:00' })).toBe('2026-10-16T09:10:00');
    expect(deadlineOf(doc, { id: 'a', title: 'A', assessmentDate: '2026-10-16T09:10:00', due: '2026-10-15' })).toBe('2026-10-15T00:00:00');
    expect(deadlineOf(doc, { id: 'a', title: 'A' })).toBeNull();
    expect(taskDeadlineOf(doc, { id: 't', title: 'T', due: '2026-10-13' })).toBe('2026-10-13T00:00:00');
    expect(deadlineDateOf({ id: 'a', title: 'A', assessmentDate: '2026-10-16T09:10:00', due: '2026-10-17' })).toBe('2026-10-16');
  });

  it('overdue once a date-time has passed, or once a date-only day is over', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'd', title: 'Date only', due: '2026-10-11', estimatedMinutes: 10 },
        { id: 't', title: 'With time', due: '2026-10-11T19:00:00', estimatedMinutes: 10 },
        { id: 'x', title: 'Done', due: '2026-10-01', status: 'done' },
        { id: 'w', title: 'Withdrawn', due: '2026-10-01', sourceState: 'withdrawn' },
      ],
    });
    expect(progressOf(doc, 'd').overdue).toBe(false);
    expect(progressOf(doc, 't').overdue).toBe(true);
    expect(progressOf(doc, 'd', '2026-10-12T00:00:00').overdue).toBe(true);
    expect(progressOf(doc, 'x').overdue).toBe(false);
    expect(progressOf(doc, 'w').overdue).toBe(false);
  });
});

describe('totals', () => {
  it('workloadTotals over the example (week of Oct 5–11 at the time of generation)', () => {
    const totals = workloadTotals(example, NOW);
    expect(totals.weekStart).toBe('2026-10-05');
    expect(totals.weekEnd).toBe('2026-10-11');
    // Othello 210 + Act 3 50 + Biology 150 + Piano 120 + library 15 (grammar is withdrawn).
    expect(totals.overall).toMatchObject({ assignments: 5, remainingMinutes: 545, scheduledMinutes: 545, unscheduledMinutes: 0, overdue: 0 });
    expect(totals.thisWeek.assignments).toBe(0);

    const later = workloadTotals(example, '2026-10-13T12:00:00');
    expect(later.weekStart).toBe('2026-10-12');
    // Due by Sunday Oct 18: essay, Act 3, biology test, library books.
    expect(later.thisWeek.assignments).toBe(4);
    expect(later.overdue.assignments).toBe(0);
  });

  it('counts unestimated and overdue work, and caps scheduled at remaining per assignment', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'a', title: 'A', estimatedMinutes: 30, due: '2026-10-09' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C', estimatedMinutes: 20 },
      ],
      scheduleBlocks: [block('c1', 'c', '2026-10-12T16:00:00', '2026-10-12T17:00:00')],
    });
    const totals = workloadTotals(doc, NOW);
    expect(totals.overall).toMatchObject({ assignments: 3, remainingMinutes: 50, scheduledMinutes: 20, unscheduledMinutes: 30, unestimated: 1, overdue: 1 });
    expect(totals.overdue).toMatchObject({ assignments: 1, remainingMinutes: 30 });
    expect(totals.thisWeek.assignments).toBe(1);
    expect(totals.noDate.assignments).toBe(2);
    expect(summarizeWorkload(doc, NOW, (a) => a.id === 'c')).toMatchObject({ assignments: 1, remainingMinutes: 20, scheduledMinutes: 20 });
  });

  it('honours weekStartsOn: sunday', () => {
    const totals = workloadTotals({ ...makeDoc(), settings: { weekStartsOn: 'sunday' } }, '2026-10-13T12:00:00');
    expect([totals.weekStart, totals.weekEnd]).toEqual(['2026-10-11', '2026-10-17']);
  });

  it('workloadByDay sums blocks per day and work due per day', () => {
    const days = workloadByDay(example, NOW, '2026-10-12', '2026-10-16');
    expect(days.map((d) => [d.date, d.plannedMinutes, d.due.map((a) => a.title), d.dueRemainingMinutes])).toEqual([
      ['2026-10-12', 80, [], 0],
      ['2026-10-13', 95, ['Read Othello Act 3'], 50],
      ['2026-10-14', 130, [], 0],
      ['2026-10-15', 120, ['Return library books'], 15],
      ['2026-10-16', 0, ['Othello Essay', 'Unit 2 Test: Cells'], 360],
    ]);
  });
});
