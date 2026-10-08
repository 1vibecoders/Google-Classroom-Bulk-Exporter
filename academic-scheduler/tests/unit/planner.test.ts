import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../../src/model/constants';
import type { Assignment, AvailabilityWindow, ScheduleBlock, ScheduleDocument, ScheduleEvent } from '../../src/model/types';
import { freeTimeOn } from '../../src/lib/calendar';
import { describePlannerRules, planUnscheduledWork, type PlanResult } from '../../src/lib/planner';
import { dayNumber, ldtToMinutes } from '../../src/lib/time';
import { assignmentProgress, deadlineOf } from '../../src/lib/workload';

const example = JSON.parse(
  readFileSync(new URL('../../examples/complete-schedule.json', import.meta.url), 'utf8'),
) as ScheduleDocument;

/** Every day 16:00–18:00. */
const AFTERNOONS: AvailabilityWindow = {
  id: 'avl',
  startTime: '16:00',
  endTime: '18:00',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], startDate: '2026-10-01' },
};

function makeDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return { schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [AFTERNOONS], scheduleBlocks: [], ...partial };
}

const MONDAY = '2026-10-12T08:00:00';

/** [assignmentId, taskId|-, start, end] for compact comparisons. */
function rows(result: PlanResult): string[][] {
  return result.blocks.map((b) => [b.assignmentId!, b.taskId ?? '-', b.start, b.end]);
}

function plan(doc: ScheduleDocument, from = MONDAY, extra: { assignmentIds?: string[]; horizonDays?: number } = {}): PlanResult {
  return planUnscheduledWork(doc, { from, ...extra });
}

describe('planUnscheduledWork basics', () => {
  it('creates planner blocks with fresh u-blk ids', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 120, due: '2026-10-15T23:59:00' }] });
    const result = plan(doc);
    for (const b of result.blocks) {
      expect(b.id).toMatch(/^u-blk-[a-z0-9]{8}$/);
      expect(b).toMatchObject({ origin: 'planner', status: 'planned' });
      expect(b.kind).toBeUndefined();
    }
    expect(new Set(result.blocks.map((b) => b.id)).size).toBe(result.blocks.length);
    expect(result.unplaced).toEqual([]);
  });

  it('spreads larger work over several days, one session per day while there is room', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 120, due: '2026-10-15T23:59:00' }] });
    expect(rows(plan(doc))).toEqual([
      ['a', '-', '2026-10-12T16:00:00', '2026-10-12T17:00:00'],
      ['a', '-', '2026-10-13T16:00:00', '2026-10-13T17:00:00'],
    ]);
  });

  it('spreads assessment preparation over the days before the assessment day (not the last day)', () => {
    const doc = makeDoc({ assignments: [{ id: 't', title: 'Biology test', type: 'test', estimatedMinutes: 150, assessmentDate: '2026-10-16T09:00:00' }] });
    const result = plan(doc);
    expect(rows(result)).toEqual([
      ['t', '-', '2026-10-12T16:00:00', '2026-10-12T16:50:00'],
      ['t', '-', '2026-10-13T16:00:00', '2026-10-13T16:50:00'],
      ['t', '-', '2026-10-14T16:00:00', '2026-10-14T16:50:00'],
    ]);
    // Even with a time, preparation ends before the start of the assessment day.
    const tight = makeDoc({ assignments: [{ id: 't', title: 'Quiz', type: 'quiz', estimatedMinutes: 60, assessmentDate: '2026-10-13T17:00:00' }] });
    expect(rows(plan(tight))).toEqual([['t', '-', '2026-10-12T16:00:00', '2026-10-12T17:00:00']]);
  });

  it('avoids busy events and keeps a break after existing blocks', () => {
    const events: ScheduleEvent[] = [{ id: 'e', title: 'Dentist', date: '2026-10-12', startTime: '16:00', endTime: '16:30' }];
    const blocks: ScheduleBlock[] = [{ id: 'x', title: 'Flashcards', start: '2026-10-12T16:30:00', end: '2026-10-12T16:45:00', origin: 'user' }];
    const doc = makeDoc({ events, scheduleBlocks: blocks, assignments: [{ id: 'a', title: 'Reading', estimatedMinutes: 60, due: '2026-10-13T00:00:00' }] });
    // 16:45 + 10-minute break → 16:55; 65 minutes left in the window → one 60-minute session.
    expect(rows(plan(doc))).toEqual([['a', '-', '2026-10-12T16:55:00', '2026-10-12T17:55:00']]);
  });

  it('ignores time taken by skipped blocks and does not plan inside break blocks', () => {
    const doc = makeDoc({
      scheduleBlocks: [
        { id: 's', title: 'Old', start: '2026-10-12T16:00:00', end: '2026-10-12T17:00:00', status: 'skipped' },
        { id: 'br', title: 'Break', kind: 'break', start: '2026-10-12T17:00:00', end: '2026-10-12T17:30:00' },
      ],
      assignments: [{ id: 'a', title: 'Reading', estimatedMinutes: 90, due: '2026-10-13T00:00:00' }],
    });
    expect(rows(plan(doc))).toEqual([
      ['a', '-', '2026-10-12T16:00:00', '2026-10-12T17:00:00'],
      ['a', '-', '2026-10-12T17:30:00', '2026-10-12T18:00:00'],
    ]);
  });

  it('rounds `from` up to 5 minutes and never plans in the past', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Reading', estimatedMinutes: 30, due: '2026-10-20T00:00:00' }] });
    expect(rows(plan(doc, '2026-10-12T16:02:00'))).toEqual([['a', '-', '2026-10-12T16:05:00', '2026-10-12T16:35:00']]);
    expect(rows(plan(doc, '2026-10-12T17:45:00'))).toEqual([['a', '-', '2026-10-13T16:00:00', '2026-10-13T16:30:00']]);
  });

  it('plans at least minSessionMinutes, even for small work', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Return books', estimatedMinutes: 15, due: '2026-10-20' }] });
    expect(rows(plan(doc))).toEqual([['a', '-', '2026-10-12T16:00:00', '2026-10-12T16:20:00']]);
  });

  it('plans only the unscheduled part', () => {
    const doc = makeDoc({
      assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 120, due: '2026-10-20T00:00:00' }],
      scheduleBlocks: [{ id: 'x', assignmentId: 'a', start: '2026-10-12T16:00:00', end: '2026-10-12T17:00:00' }],
    });
    expect(rows(plan(doc))).toEqual([['a', '-', '2026-10-13T16:00:00', '2026-10-13T17:00:00']]);
  });

  it('places nothing for the complete example (everything is already scheduled)', () => {
    expect(plan(example, '2026-10-11T19:30:00')).toEqual({ blocks: [], unplaced: [] });
  });
});

describe('ordering and dependencies', () => {
  it('gives the earliest deadline the earliest time', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'late', title: 'Later', estimatedMinutes: 60, due: '2026-10-20T00:00:00', priority: 'urgent' },
        { id: 'soon', title: 'Sooner', estimatedMinutes: 60, due: '2026-10-14T00:00:00', priority: 'low' },
      ],
    });
    // The rest of Monday (17:10–18:00) is too short for the whole 60-minute
    // session, so it goes to Tuesday instead of being cut into 50 + 20.
    expect(rows(plan(doc))).toEqual([
      ['soon', '-', '2026-10-12T16:00:00', '2026-10-12T17:00:00'],
      ['late', '-', '2026-10-13T16:00:00', '2026-10-13T17:00:00'],
    ]);
  });

  it('breaks deadline ties by priority, then title', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'b', title: 'B', estimatedMinutes: 30, due: '2026-10-14T00:00:00' },
        { id: 'a', title: 'A', estimatedMinutes: 30, due: '2026-10-14T00:00:00' },
        { id: 'c', title: 'C', estimatedMinutes: 30, due: '2026-10-14T00:00:00', priority: 'high' },
      ],
    });
    expect(rows(plan(doc))).toEqual([
      ['c', '-', '2026-10-12T16:00:00', '2026-10-12T16:30:00'],
      ['a', '-', '2026-10-12T16:40:00', '2026-10-12T17:10:00'],
      ['b', '-', '2026-10-12T17:20:00', '2026-10-12T17:50:00'],
    ]);
  });

  it('respects task order, task deadlines and assignment deadlines', () => {
    const essay: Assignment = {
      id: 'essay',
      title: 'Essay',
      estimatedMinutes: 150,
      due: '2026-10-16T23:59:00',
      tasks: [
        { id: 'essay-t3', title: 'Revise', estimatedMinutes: 60, dependsOn: ['essay-t2'] },
        { id: 'essay-t1', title: 'Outline', estimatedMinutes: 30, due: '2026-10-13' },
        { id: 'essay-t2', title: 'Draft', estimatedMinutes: 60, dependsOn: ['essay-t1'] },
      ],
    };
    const other: Assignment = { id: 'hw', title: 'Worksheet', estimatedMinutes: 60, due: '2026-10-14T23:59:00' };
    const result = plan(makeDoc({ assignments: [essay, other] }));
    expect(rows(result)).toEqual([
      ['essay', 'essay-t1', '2026-10-12T16:00:00', '2026-10-12T16:30:00'],
      ['hw', '-', '2026-10-12T16:40:00', '2026-10-12T17:40:00'],
      ['essay', 'essay-t2', '2026-10-13T16:00:00', '2026-10-13T17:00:00'],
      ['essay', 'essay-t3', '2026-10-14T16:00:00', '2026-10-14T17:00:00'],
    ]);
  });

  it('places a part after the existing planned sessions of the task it depends on', () => {
    const doc = makeDoc({
      assignments: [
        {
          id: 'p',
          title: 'Project',
          estimatedMinutes: 90,
          due: '2026-10-20T00:00:00',
          tasks: [
            { id: 'p-t1', title: 'Research', estimatedMinutes: 30 },
            { id: 'p-t2', title: 'Write', estimatedMinutes: 60, dependsOn: ['p-t1'] },
          ],
        },
      ],
      scheduleBlocks: [{ id: 'r', assignmentId: 'p', taskId: 'p-t1', start: '2026-10-14T16:00:00', end: '2026-10-14T16:30:00' }],
    });
    expect(rows(plan(doc))).toEqual([['p', 'p-t2', '2026-10-15T16:00:00', '2026-10-15T17:00:00']]);
  });

  it('places an assignment after the planned work of the assignments it depends on', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'quiz', title: 'Quiz', type: 'quiz', estimatedMinutes: 40, assessmentDate: '2026-10-16', dependsOn: ['read'] },
        { id: 'read', title: 'Reading', estimatedMinutes: 60, due: '2026-10-17T00:00:00' },
      ],
    });
    const result = plan(doc);
    const readEnd = Math.max(...result.blocks.filter((b) => b.assignmentId === 'read').map((b) => ldtToMinutes(b.end)));
    const quizStart = Math.min(...result.blocks.filter((b) => b.assignmentId === 'quiz').map((b) => ldtToMinutes(b.start)));
    expect(quizStart).toBeGreaterThanOrEqual(readEnd);
    expect(result.unplaced).toEqual([]);
  });

  it('honours a task recommendedStartDate when there is room', () => {
    const doc = makeDoc({
      assignments: [
        {
          id: 'p',
          title: 'Project',
          due: '2026-10-20T00:00:00',
          tasks: [{ id: 'p-t1', title: 'Rehearse', estimatedMinutes: 30, recommendedStartDate: '2026-10-14' }],
        },
      ],
    });
    expect(rows(plan(doc))).toEqual([['p', 'p-t1', '2026-10-14T16:00:00', '2026-10-14T16:30:00']]);
  });
});

describe('limits and unplaced work', () => {
  it('respects maxDailyStudyMinutes, counting existing user blocks', () => {
    const doc = makeDoc({
      settings: { maxDailyStudyMinutes: 60 },
      scheduleBlocks: [{ id: 'u', title: 'Review', start: '2026-10-12T16:00:00', end: '2026-10-12T16:45:00', origin: 'user' }],
      assignments: [
        { id: 'a', title: 'Reading', estimatedMinutes: 60, due: '2026-10-20T00:00:00' },
        { id: 'b', title: 'Tomorrow', estimatedMinutes: 30, due: '2026-10-13' },
      ],
    });
    const result = plan(doc);
    expect(rows(result)).toEqual([['a', '-', '2026-10-13T16:00:00', '2026-10-13T17:00:00']]);
    expect(result.unplaced).toEqual([
      { assignmentId: 'b', minutes: 30, reason: 'Your daily limit of 1 h of work is reached on the free days before the due date (Tue, Oct 13).' },
    ]);
  });

  it('reports work that does not fit before its deadline', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Big', estimatedMinutes: 300, due: '2026-10-13' }] });
    const result = plan(doc);
    expect(rows(result)).toEqual([
      ['a', '-', '2026-10-12T16:00:00', '2026-10-12T17:00:00'],
      ['a', '-', '2026-10-12T17:10:00', '2026-10-12T18:00:00'],
    ]);
    expect(result.unplaced).toEqual([
      { assignmentId: 'a', minutes: 190, reason: 'Not enough free study time before the due date (Tue, Oct 13).' },
    ]);
  });

  it('reports a missed task deadline with the task id', () => {
    const doc = makeDoc({
      availability: [{ ...AFTERNOONS, recurrence: { ...AFTERNOONS.recurrence!, daysOfWeek: ['wed'] } }],
      assignments: [
        { id: 'a', title: 'Essay', estimatedMinutes: 30, due: '2026-10-20T00:00:00', tasks: [{ id: 'a-t1', title: 'Outline', estimatedMinutes: 30, due: '2026-10-13T08:00:00' }] },
      ],
    });
    expect(plan(doc).unplaced).toEqual([
      { assignmentId: 'a', taskId: 'a-t1', minutes: 30, reason: 'There is no free study time before the deadline of “Outline” (Tue, Oct 13, 8:00 AM).' },
    ]);
  });

  it('reports passed deadlines and missing estimates', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'old', title: 'Old', estimatedMinutes: 30, due: '2026-10-10T23:59:00' },
        { id: 'quiz', title: 'Quiz', type: 'quiz', estimatedMinutes: 30, assessmentDate: '2026-10-12T10:00:00' },
        { id: 'unknown', title: 'Unknown', due: '2026-10-20' },
        { id: 'exam', title: 'Exam', type: 'exam', estimatedMinutes: 30, assessmentDate: '2026-10-09' },
        { id: 'pres', title: 'Talk', type: 'presentation', estimatedMinutes: 30, assessmentDate: '2026-10-12' },
      ],
    });
    expect(plan(doc)).toEqual({
      blocks: [],
      unplaced: [
        { assignmentId: 'old', minutes: 30, reason: 'The due time (Sat, Oct 10, 11:59 PM) has passed.' },
        { assignmentId: 'quiz', minutes: 30, reason: 'The quiz is today (Mon, Oct 12, 10:00 AM); preparation is only planned on earlier days.' },
        { assignmentId: 'unknown', minutes: 0, reason: 'It has no time estimate. Add an estimated duration to plan it.' },
        { assignmentId: 'exam', minutes: 30, reason: 'The exam (Fri, Oct 9) has passed.' },
        { assignmentId: 'pres', minutes: 30, reason: 'The presentation is today (Mon, Oct 12); preparation is only planned on earlier days.' },
      ],
    });
  });

  it('stops at the planning horizon', () => {
    const doc = makeDoc({ assignments: [{ id: 'a', title: 'Undated', estimatedMinutes: 300 }] });
    const result = plan(doc, MONDAY, { horizonDays: 2 });
    expect(result.blocks.every((b) => b.start < '2026-10-14')).toBe(true);
    expect(result.blocks.reduce((s, b) => s + ldtToMinutes(b.end) - ldtToMinutes(b.start), 0)).toBe(220);
    expect(result.unplaced).toEqual([{ assignmentId: 'a', minutes: 80, reason: 'Not enough free study time in the next 2 days.' }]);
  });

  it('plans nothing when availability is empty (§ 11)', () => {
    const doc = makeDoc({ availability: [], assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-20' }] });
    const result = plan(doc);
    expect(result.blocks).toEqual([]);
    expect(result.unplaced).toHaveLength(1);
    expect(result.unplaced[0]).toMatchObject({ assignmentId: 'a', minutes: 60 });
    expect(result.unplaced[0].reason).toContain('study time');
  });

  it('skips work that does not count, and explains it when asked for explicitly', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'done', title: 'Done', estimatedMinutes: 30, status: 'done' },
        { id: 'gone', title: 'Withdrawn', estimatedMinutes: 30, sourceState: 'withdrawn' },
        { id: 'opt', title: 'Extra credit', estimatedMinutes: 30, required: false },
        { id: 'ok', title: 'Real', estimatedMinutes: 30 },
      ],
    });
    expect(rows(plan(doc))).toEqual([['ok', '-', '2026-10-12T16:00:00', '2026-10-12T16:30:00']]);
    expect(plan(doc).unplaced).toEqual([]);
    const picked = plan(doc, MONDAY, { assignmentIds: ['done', 'gone', 'opt'] });
    expect(picked.blocks).toEqual([]);
    expect(picked.unplaced.map((u) => u.assignmentId)).toEqual(['done', 'gone', 'opt']);
    expect(picked.unplaced[2].reason).toContain('optional');
  });
});

describe('determinism and invariants', () => {
  function bigDoc(): ScheduleDocument {
    const assignments: Assignment[] = [];
    for (let i = 0; i < 12; i++) {
      const day = 13 + (i % 9);
      assignments.push({
        id: `a${i}`,
        title: `Assignment ${String(i).padStart(2, '0')}`,
        estimatedMinutes: 25 + ((i * 37) % 160),
        priority: (['low', 'medium', 'high', 'urgent'] as const)[i % 4],
        ...(i % 3 === 0 ? { type: 'test' as const, assessmentDate: `2026-10-${day}T09:00:00` } : { due: `2026-10-${day}${i % 2 ? 'T23:59:00' : ''}` }),
        ...(i % 4 === 1
          ? {
              tasks: [
                { id: `a${i}-t1`, title: 'Step 1', estimatedMinutes: 30 },
                { id: `a${i}-t2`, title: 'Step 2', estimatedMinutes: 45, dependsOn: [`a${i}-t1`] },
              ],
              estimatedMinutes: 75,
            }
          : {}),
      });
    }
    return makeDoc({
      settings: { maxDailyStudyMinutes: 150, breakMinutes: 15, minSessionMinutes: 25, maxSessionMinutes: 50 },
      availability: [
        { id: 'w1', startTime: '15:30', endTime: '21:00', recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' } },
        { id: 'w2', startTime: '10:00', endTime: '13:00', recurrence: { frequency: 'weekly', daysOfWeek: ['sat', 'sun'], startDate: '2026-09-01' } },
      ],
      events: [
        { id: 'fence', title: 'Fencing', startTime: '16:00', endTime: '18:00', recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'thu'], startDate: '2026-09-01' } },
        { id: 'trip', title: 'Trip', date: '2026-10-17', endDate: '2026-10-18', allDay: true },
      ],
      scheduleBlocks: [
        { id: 'u1', title: 'Flashcards', start: '2026-10-13T15:30:00', end: '2026-10-13T16:30:00', origin: 'user' },
        { id: 'u2', assignmentId: 'a2', start: '2026-10-14T19:00:00', end: '2026-10-14T19:40:00', locked: true },
      ],
      assignments,
    });
  }

  it('gives the same plan for the same input (ids aside)', () => {
    const strip = (r: PlanResult) => ({ blocks: r.blocks.map(({ id, ...rest }) => (void id, rest)), unplaced: r.unplaced });
    expect(strip(plan(bigDoc(), '2026-10-12T15:47:00'))).toEqual(strip(plan(bigDoc(), '2026-10-12T15:47:00')));
  });

  it('never overlaps, keeps breaks, stays in free time, within limits and deadlines', () => {
    const doc = bigDoc();
    const from = '2026-10-12T15:47:00';
    const result = plan(doc, from);
    expect(result.blocks.length).toBeGreaterThan(10);
    const settings = resolveSettings(doc.settings);
    const all = [...doc.scheduleBlocks, ...result.blocks].map((b) => ({ b, s: ldtToMinutes(b.start), e: ldtToMinutes(b.end) }));
    const perDay = new Map<string, number>();
    for (const x of all) perDay.set(x.b.start.slice(0, 10), (perDay.get(x.b.start.slice(0, 10)) ?? 0) + x.e - x.s);
    for (const nb of result.blocks) {
      const s = ldtToMinutes(nb.start);
      const e = ldtToMinutes(nb.end);
      const date = nb.start.slice(0, 10);
      expect(s).toBeGreaterThanOrEqual(ldtToMinutes(from));
      expect(s % 5).toBe(0);
      expect(e - s).toBeGreaterThanOrEqual(settings.minSessionMinutes);
      expect(e - s).toBeLessThanOrEqual(settings.maxSessionMinutes);
      // Inside free time (availability − busy events).
      const base = dayNumber(date) * 1440;
      const free = freeTimeOn(doc, date).free;
      expect(free.some((f) => base + f.start <= s && e <= base + f.end)).toBe(true);
      // No overlap and a break with every other work block.
      for (const other of all) {
        if (other.b === nb) continue;
        expect(e + settings.breakMinutes <= other.s || other.e + settings.breakMinutes <= s).toBe(true);
      }
      // Deadlines (assessments: before the start of the assessment day).
      const a = doc.assignments.find((x) => x.id === nb.assignmentId)!;
      const deadline = deadlineOf(doc, a);
      if (deadline) expect(e).toBeLessThanOrEqual(ldtToMinutes(deadline));
      if (a.assessmentDate) expect(e).toBeLessThanOrEqual(dayNumber(a.assessmentDate.slice(0, 10)) * 1440);
    }
    for (const [, minutes] of perDay) expect(minutes).toBeLessThanOrEqual(settings.maxDailyStudyMinutes!);
    // Task order: step 2 starts after step 1 ends.
    for (const a of doc.assignments.filter((x) => x.tasks)) {
      const t1 = result.blocks.filter((b) => b.taskId === `${a.id}-t1`).map((b) => ldtToMinutes(b.end));
      const t2 = result.blocks.filter((b) => b.taskId === `${a.id}-t2`).map((b) => ldtToMinutes(b.start));
      if (t1.length && t2.length) expect(Math.min(...t2)).toBeGreaterThanOrEqual(Math.max(...t1));
    }
    // Never more than the unscheduled minutes (+ rounding up to a minimum session).
    for (const a of doc.assignments) {
      const unscheduled = assignmentProgress(doc, a, from).unscheduledMinutes ?? 0;
      const planned = result.blocks.filter((b) => b.assignmentId === a.id).reduce((s, b) => s + ldtToMinutes(b.end) - ldtToMinutes(b.start), 0);
      const unplaced = result.unplaced.filter((u) => u.assignmentId === a.id).reduce((s, u) => s + u.minutes, 0);
      expect(planned).toBeLessThanOrEqual(unscheduled + settings.minSessionMinutes);
      if (unscheduled > 0 && planned + unplaced < unscheduled) expect(result.unplaced.some((u) => u.assignmentId === a.id)).toBe(true);
    }
  });

  it('describes its rule in plain words', () => {
    const lines = describePlannerRules(resolveSettings({ maxDailyStudyMinutes: 180 }));
    expect(lines[0]).toContain('Earliest deadline first');
    expect(lines.join(' ')).toContain('3 h');
    expect(lines.join(' ')).not.toMatch(/\bAI\b/);
  });
});
