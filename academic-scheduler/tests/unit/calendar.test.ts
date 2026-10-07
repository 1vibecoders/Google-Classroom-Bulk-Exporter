import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CLASS_PALETTE, NO_CLASS_COLOR } from '../../src/model/constants';
import type { ScheduleDocument } from '../../src/model/types';
import {
  buildDay,
  buildDays,
  classColor,
  freeTimeOn,
  intersectIntervals,
  layoutColumns,
  mergeIntervals,
  subtractIntervals,
  totalMinutes,
} from '../../src/lib/calendar';

const example = JSON.parse(
  readFileSync(new URL('../../examples/complete-schedule.json', import.meta.url), 'utf8'),
) as ScheduleDocument;

function makeDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return { schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], ...partial };
}

const hm = (h: number, m = 0) => h * 60 + m;

describe('interval arithmetic', () => {
  it('merges overlapping and touching intervals and drops empty ones', () => {
    expect(
      mergeIntervals([
        { start: 30, end: 40 },
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 40, end: 50 },
        { start: 60, end: 60 },
      ]),
    ).toEqual([
      { start: 0, end: 20 },
      { start: 30, end: 50 },
    ]);
  });

  it('subtracts intervals', () => {
    expect(
      subtractIntervals(
        [{ start: 0, end: 100 }],
        [
          { start: 10, end: 20 },
          { start: 50, end: 60 },
          { start: 90, end: 120 },
        ],
      ),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 50 },
      { start: 60, end: 90 },
    ]);
    expect(subtractIntervals([{ start: 0, end: 100 }], [{ start: -10, end: 200 }])).toEqual([]);
    expect(subtractIntervals([{ start: 0, end: 10 }, { start: 20, end: 30 }], [])).toEqual([
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ]);
  });

  it('intersects and totals intervals', () => {
    expect(intersectIntervals([{ start: 0, end: 50 }, { start: 60, end: 100 }], [{ start: 40, end: 70 }])).toEqual([
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ]);
    expect(totalMinutes([{ start: 0, end: 30 }, { start: 20, end: 40 }])).toBe(40);
  });
});

describe('layoutColumns', () => {
  it('puts overlapping items side by side and reuses free columns', () => {
    const items = [
      { id: 'a', start: 0, end: 60 },
      { id: 'b', start: 30, end: 90 },
      { id: 'c', start: 60, end: 120 },
      { id: 'd', start: 200, end: 230 },
    ];
    const laid = layoutColumns(items, (i) => i);
    const byId = Object.fromEntries(laid.map((l) => [l.item.id, l]));
    expect(byId.a).toMatchObject({ column: 0, columns: 2 });
    expect(byId.b).toMatchObject({ column: 1, columns: 2 });
    expect(byId.c).toMatchObject({ column: 0, columns: 2 });
    expect(byId.d).toMatchObject({ column: 0, columns: 1 });
  });

  it('handles three-way overlaps and empty input', () => {
    const laid = layoutColumns(
      [
        { start: 0, end: 100 },
        { start: 10, end: 50 },
        { start: 20, end: 40 },
      ],
      (i) => i,
    );
    expect(laid.map((l) => l.column)).toEqual([0, 1, 2]);
    expect(laid.every((l) => l.columns === 3)).toBe(true);
    expect(layoutColumns([], (i: { start: number; end: number }) => i)).toEqual([]);
  });
});

describe('classColor', () => {
  it('uses the class color, a stable palette color, or the neutral color', () => {
    const doc = makeDoc({
      classes: [
        { id: 'a', name: 'A', color: CLASS_PALETTE[0] },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C', color: 'not-a-color' },
      ],
    });
    expect(classColor(doc, 'a')).toBe(CLASS_PALETTE[0]);
    // Palette colors already used explicitly are skipped.
    expect(classColor(doc, 'b')).toBe(CLASS_PALETTE[1]);
    expect(classColor(doc, 'c')).toBe(CLASS_PALETTE[2]);
    expect(classColor(doc, 'b')).toBe(CLASS_PALETTE[1]); // stable
    expect(classColor(doc, 'missing')).toBe(NO_CLASS_COLOR);
    expect(classColor(doc, undefined)).toBe(NO_CLASS_COLOR);
  });
});

describe('buildDay on the complete example', () => {
  it('Monday Oct 12: school excepted, fencing busy, free time around it', () => {
    const day = buildDay(example, '2026-10-12');
    expect(day.availabilityDefined).toBe(true);
    expect(day.events.map((e) => e.event.title)).toEqual(['Fencing']);
    expect(day.availability).toEqual([{ start: hm(15, 30), end: hm(21, 30) }]);
    expect(day.free).toEqual([
      { start: hm(15, 30), end: hm(16) },
      { start: hm(18), end: hm(21, 30) },
    ]);
    expect(day.freeMinutes).toBe(240);
    expect(day.blocks.map((b) => [b.label, b.start, b.end])).toEqual([
      ['English 10 / Read Othello Act 3', hm(18, 30), hm(19, 20)],
      ['English 10 / Othello Essay', hm(19, 30), hm(20)],
    ]);
    expect(day.blocks[1].taskTitle).toBe('Outline (printed copy due in class)');
    expect(day.blocks[1].title).toBe('Outline (printed copy due in class)');
    expect(day.blocks[1].subtitle).toBe('English 10');
    expect(day.blocks[1].color).toBe('#2563EB');
    expect(day.blocks.some((b) => b.conflict || b.late)).toBe(false);
    expect(day.plannedMinutes).toBe(80);
    expect(day.overFreeTime).toBe(false);
  });

  it('Tuesday Oct 13: school, due date-only marker and a task checkpoint marker', () => {
    const day = buildDay(example, '2026-10-13');
    expect(day.events.map((e) => [e.event.title, e.start, e.end, e.busy])).toEqual([['School', hm(8), hm(15), true]]);
    expect(day.freeMinutes).toBe(360);
    const labels = day.markers.map((m) => [m.kind, m.label, m.assignment.title, m.task?.title ?? null, m.time]);
    expect(labels).toEqual([
      ['due', 'Due', 'Read Othello Act 3', null, null],
      ['due', 'Checkpoint due', 'Othello Essay', 'Outline (printed copy due in class)', null],
    ]);
  });

  it('Wednesday Oct 14: piano lesson and a user block right after school', () => {
    const day = buildDay(example, '2026-10-14');
    expect(day.events.map((e) => e.event.title)).toEqual(['School', 'Piano']);
    expect(day.freeMinutes).toBe(90 + 210);
    const library = day.blocks.find((b) => b.block.id === 'u-blk-m2c7q9za')!;
    expect(library.label).toBe('Return library books');
    expect(library.subtitle).toBe('Personal');
    expect(library.color).toBe(NO_CLASS_COLOR);
    expect(library.conflict).toBe(false); // 15:00–15:15 touches the end of school but does not overlap
    expect(day.plannedMinutes).toBe(15 + 45 + 70);
    expect(day.markers.map((m) => [m.label, m.assignment.title])).toEqual([['Due 11:59 PM', 'Grammar worksheet 3: Commas']]);
  });

  it('Thursday Oct 15: the root workload issue with a date is shown', () => {
    const day = buildDay(example, '2026-10-15');
    expect(day.issues).toHaveLength(1);
    expect(day.issues[0]).toMatchObject({ scope: null, index: 0, itemId: 'u-evt-d8c3t5r1' });
    expect(day.issues[0].issue.id).toBe('workload:2026-10-15');
    expect(day.markers.map((m) => [m.kind, m.assignment.title])).toEqual([
      ['due', 'Return library books'],
      ['recommended', 'Othello Essay'],
    ]);
    expect(day.freeMinutes).toBe(300);
    expect(day.overDailyMax).toBe(false); // 120 minutes ≤ 180
  });

  it('Friday Oct 16: assessment with a time and a due with a time', () => {
    const day = buildDay(example, '2026-10-16');
    expect(day.markers.map((m) => [m.kind, m.label, m.assignment.title])).toEqual([
      ['assessment', 'Test 9:10 AM', 'Unit 2 Test: Cells'],
      ['due', 'Due 11:59 PM', 'Othello Essay'],
    ]);
    expect(day.markers[0].color).toBe('#16A34A');
  });

  it('Saturday Oct 24: the exam sitting event is linked to its assessment', () => {
    const day = buildDay(example, '2026-10-24');
    expect(day.events).toHaveLength(1);
    expect(day.events[0].assignment?.id).toBe('piano-theory-exam-2026-10-24');
    const marker = day.markers.find((m) => m.kind === 'assessment')!;
    expect(marker.label).toBe('Exam 9:00 AM');
    expect(marker.sitting?.event.id).toBe('evt-piano-theory-exam-2026-10-24');
    // Weekend mornings 10:00–13:00 minus the exam 09:00–11:00.
    expect(day.free).toEqual([{ start: hm(11), end: hm(13) }]);
  });

  it('buildDays returns consecutive days', () => {
    const days = buildDays(example, '2026-10-12', 7);
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(days[5].blocks[0].label).toBe('Piano theory exam');
  });
});

describe('buildDay details', () => {
  const english = { id: 'eng', name: 'English', color: '#2563EB' };

  it('shows multi-day all-day events on every day of the span; busy ones block the day', () => {
    const doc = makeDoc({
      events: [{ id: 'trip', title: 'Field trip', date: '2026-10-20', endDate: '2026-10-22', allDay: true }],
      availability: [{ id: 'w', startTime: '15:00', endTime: '18:00', recurrence: { frequency: 'weekly', daysOfWeek: ['tue', 'wed', 'thu', 'fri'], startDate: '2026-10-01' } }],
      scheduleBlocks: [{ id: 'b', title: 'Flashcards', start: '2026-10-21T15:00:00', end: '2026-10-21T15:30:00' }],
    });
    for (const date of ['2026-10-20', '2026-10-21', '2026-10-22']) {
      const day = buildDay(doc, date);
      expect(day.allDayEvents).toHaveLength(1);
      expect(day.allDayEvents[0].span).toEqual({ first: '2026-10-20', last: '2026-10-22' });
      expect(day.free).toEqual([]);
    }
    expect(buildDay(doc, '2026-10-23').allDayEvents).toHaveLength(0);
    expect(buildDay(doc, '2026-10-23').freeMinutes).toBe(180);
    const block = buildDay(doc, '2026-10-21').blocks[0];
    expect(block.conflict).toBe(true);
    expect(block.conflictsWith).toEqual([{ kind: 'event', id: 'trip', title: 'Field trip' }]);
  });

  it('non-busy events do not reduce free time or cause conflicts', () => {
    const doc = makeDoc({
      events: [{ id: 'e', title: 'Club (optional)', date: '2026-10-20', startTime: '16:00', endTime: '17:00', busy: false }],
      availability: [{ id: 'w', date: '2026-10-20', startTime: '15:00', endTime: '18:00' }],
      scheduleBlocks: [{ id: 'b', title: 'Study', start: '2026-10-20T16:00:00', end: '2026-10-20T16:30:00' }],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.events[0].busy).toBe(false);
    expect(day.freeMinutes).toBe(180);
    expect(day.blocks[0].conflict).toBe(false);
  });

  it('merges overlapping one-time and recurring windows and supports 24:00', () => {
    const doc = makeDoc({
      availability: [
        { id: 'r', startTime: '19:00', endTime: '24:00', recurrence: { frequency: 'weekly', daysOfWeek: ['tue'], startDate: '2026-10-01' } },
        { id: 'o', date: '2026-10-20', startTime: '17:00', endTime: '20:00' },
        { id: 'other', date: '2026-10-21', startTime: '08:00', endTime: '09:00' },
      ],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.windows.map((w) => w.id)).toEqual(['r', 'o']);
    expect(day.availability).toEqual([{ start: hm(17), end: 1440 }]);
    expect(day.freeMinutes).toBe(7 * 60);
    expect(day.timelineRange).toEqual({ start: hm(7), end: 1440 });
  });

  it('shows a block that ends at 00:00 of the next date on its start date only', () => {
    const doc = makeDoc({ scheduleBlocks: [{ id: 'late', title: 'Night reading', start: '2026-10-20T23:00:00', end: '2026-10-21T00:00:00' }] });
    const day = buildDay(doc, '2026-10-20');
    expect(day.blocks).toHaveLength(1);
    expect(day.blocks[0]).toMatchObject({ start: hm(23), end: 1440, minutes: 60 });
    expect(buildDay(doc, '2026-10-21').blocks).toHaveLength(0);
  });

  it('flags overlapping blocks but not skipped ones', () => {
    const doc = makeDoc({
      scheduleBlocks: [
        { id: 'a', title: 'A', start: '2026-10-20T16:00:00', end: '2026-10-20T17:00:00' },
        { id: 'b', title: 'B', start: '2026-10-20T16:30:00', end: '2026-10-20T17:30:00' },
        { id: 'c', title: 'C', start: '2026-10-20T16:45:00', end: '2026-10-20T17:15:00', status: 'skipped' },
        { id: 'd', title: 'D', start: '2026-10-20T17:30:00', end: '2026-10-20T18:00:00' },
      ],
    });
    const byId = Object.fromEntries(buildDay(doc, '2026-10-20').blocks.map((b) => [b.block.id, b]));
    expect(byId.a.conflictsWith.map((c) => c.id)).toEqual(['b']);
    expect(byId.b.conflictsWith.map((c) => c.id)).toEqual(['a']);
    expect(byId.c.conflict).toBe(false);
    expect(byId.d.conflict).toBe(false);
  });

  it('marks late blocks per § 13.4 and D10 (date-only due = defaultDueTime)', () => {
    const base = makeDoc({
      classes: [english],
      assignments: [
        {
          id: 'essay',
          classId: 'eng',
          title: 'Essay',
          due: '2026-10-21',
          tasks: [{ id: 'essay-t1', title: 'Outline', due: '2026-10-20T12:00:00' }],
        },
        { id: 'quiz', title: 'Quiz', type: 'quiz', assessmentDate: '2026-10-22' },
        { id: 'hw', title: 'Worksheet', due: '2026-10-21T08:00:00' },
      ],
      scheduleBlocks: [
        { id: 'e1', assignmentId: 'essay', start: '2026-10-21T16:00:00', end: '2026-10-21T17:00:00' },
        { id: 'e0', assignmentId: 'essay', start: '2026-10-20T16:00:00', end: '2026-10-20T17:00:00' },
        { id: 't1', assignmentId: 'essay', taskId: 'essay-t1', start: '2026-10-20T13:00:00', end: '2026-10-20T13:30:00' },
        { id: 'q0', assignmentId: 'quiz', start: '2026-10-21T18:00:00', end: '2026-10-21T19:00:00' },
        { id: 'q1', assignmentId: 'quiz', start: '2026-10-22T07:00:00', end: '2026-10-22T07:30:00' },
        { id: 'h1', assignmentId: 'hw', start: '2026-10-21T07:00:00', end: '2026-10-21T08:00:00' },
        { id: 'h2', assignmentId: 'hw', start: '2026-10-21T07:30:00', end: '2026-10-21T08:05:00', status: 'skipped' },
      ],
    });
    const blocks = (doc: ScheduleDocument) => Object.fromEntries(buildDays(doc, '2026-10-20', 3).flatMap((d) => d.blocks).map((b) => [b.block.id, b]));
    let b = blocks(base);
    expect(b.e1.late).toBe(true); // date-only due counts at 00:00 by default
    expect(b.e1.lateReason).toContain('no time given');
    expect(b.e0.late).toBe(false);
    expect(b.t1.late).toBe(true); // after the task's checkpoint
    expect(b.t1.lateReason).toContain('Outline');
    expect(b.q0.late).toBe(false);
    expect(b.q1.late).toBe(true); // date-only assessment = 00:00 of that day
    expect(b.q1.lateReason).toBe('Ends after the quiz (Thu, Oct 22)');
    expect(b.h1.late).toBe(false); // ends exactly at the due time
    expect(b.h2.late).toBe(false); // skipped blocks are never late

    b = blocks({ ...base, settings: { defaultDueTime: '23:59' } });
    expect(b.e1.late).toBe(false);
  });

  it('treats an empty availability as "not provided"', () => {
    const doc = makeDoc({
      settings: { maxDailyStudyMinutes: 30 },
      scheduleBlocks: [{ id: 'b', title: 'Study', start: '2026-10-20T16:00:00', end: '2026-10-20T18:00:00', origin: 'planner' }],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.availabilityDefined).toBe(false);
    expect(day.free).toEqual([]);
    expect(day.freeMinutes).toBe(0);
    expect(day.plannedMinutes).toBe(120);
    expect(day.overFreeTime).toBe(false);
    expect(day.overDailyMax).toBe(false);
  });

  it('reports over-capacity days; the daily limit only with unlocked generated/planner work', () => {
    const availability = [{ id: 'w', date: '2026-10-20', startTime: '16:00', endTime: '17:00' }];
    const userOnly = makeDoc({
      settings: { maxDailyStudyMinutes: 60 },
      availability,
      scheduleBlocks: [
        { id: 'a', title: 'A', start: '2026-10-20T16:00:00', end: '2026-10-20T17:00:00', origin: 'user' },
        { id: 'b', title: 'B', start: '2026-10-20T19:00:00', end: '2026-10-20T19:30:00', origin: 'user' },
        { id: 'br', title: 'Break', kind: 'break', start: '2026-10-20T17:00:00', end: '2026-10-20T17:15:00', origin: 'user' },
      ],
    });
    let day = buildDay(userOnly, '2026-10-20');
    expect(day.plannedMinutes).toBe(90); // breaks are not work
    expect(day.overFreeTime).toBe(true);
    expect(day.overDailyMax).toBe(false);
    const withPlanner = { ...userOnly, scheduleBlocks: [...userOnly.scheduleBlocks, { id: 'p', title: 'P', start: '2026-10-20T20:00:00', end: '2026-10-20T20:20:00', origin: 'planner' as const }] };
    day = buildDay(withPlanner, '2026-10-20');
    expect(day.overDailyMax).toBe(true);
    const br = day.blocks.find((x) => x.isBreak)!;
    expect([br.title, br.label, br.subtitle]).toEqual(['Break', 'Break', 'Break']);
  });

  it('collects item issues with a date and sorts open issues first', () => {
    const doc = makeDoc({
      issues: [{ kind: 'other', message: 'Resolved one', date: '2026-10-20', status: 'resolved' }],
      assignments: [{ id: 'a', title: 'A', issues: [{ kind: 'workload', message: 'Busy day', date: '2026-10-20' }, { kind: 'other', message: 'Other day', date: '2026-10-21' }] }],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.issues.map((i) => [i.issue.message, i.scope, i.index])).toEqual([
      ['Busy day', { collection: 'assignments', id: 'a' }, 0],
      ['Resolved one', null, 0],
    ]);
  });

  it('labels blocks with an explicit title and widens the timeline to fit items', () => {
    const doc = makeDoc({
      classes: [english],
      assignments: [{ id: 'a', classId: 'eng', title: 'Othello Essay', tasks: [{ id: 'a-t1', title: 'Draft' }] }],
      events: [{ id: 'swim', title: 'Swim practice', date: '2026-10-20', startTime: '05:30', endTime: '06:45' }],
      scheduleBlocks: [{ id: 'b', assignmentId: 'a', taskId: 'a-t1', title: 'Write the introduction', start: '2026-10-20T22:00:00', end: '2026-10-20T22:40:00' }],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.blocks[0]).toMatchObject({
      title: 'Write the introduction',
      workTitle: 'Write the introduction',
      label: 'English / Write the introduction',
      taskTitle: 'Draft',
      className: 'English',
    });
    expect(day.timelineRange).toEqual({ start: hm(5), end: hm(23) });
  });

  it('skips unreadable items instead of throwing', () => {
    const doc = makeDoc({
      events: [{ id: 'e', title: 'Broken', date: '2026-10-20', startTime: '25:00', endTime: '26:00' }],
      availability: [{ id: 'w', date: '2026-10-20', startTime: '18:00', endTime: '17:00' }],
      scheduleBlocks: [{ id: 'b', title: 'Broken', start: 'yesterday', end: 'today' }],
    });
    const day = buildDay(doc, '2026-10-20');
    expect(day.events).toEqual([]);
    expect(day.freeMinutes).toBe(0);
    expect(day.blocks).toEqual([]);
  });

  it('freeTimeOn exposes busy and free time', () => {
    const t = freeTimeOn(example, '2026-10-15');
    expect(t.busy).toEqual([
      { start: hm(8), end: hm(15) },
      { start: hm(15, 30), end: hm(16, 30) },
    ]);
    expect(t.free).toEqual([{ start: hm(16, 30), end: hm(21, 30) }]);
  });
});
