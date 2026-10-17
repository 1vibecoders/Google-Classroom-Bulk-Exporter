// Plan repair (SPEC.md § 26.2–26.3): only flexible sessions that break a hard
// constraint move; locked, the person's own and finished sessions stay; work
// that no longer fits is reported, never placed after its deadline.
import { describe, expect, it } from 'vitest';
import type { AvailabilityWindow, ScheduleBlock, ScheduleDocument } from '../../src/model/types';
import { brokenSessions, repairPlan } from '../../src/lib/repair';
import { ldtToMinutes } from '../../src/lib/time';

const AFTERNOONS: AvailabilityWindow = {
  id: 'avl',
  startTime: '16:00',
  endTime: '18:00',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], startDate: '2026-10-01' },
};
const NOW = '2026-10-12T08:00:00';

function session(id: string, start: string, end: string, extra: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return { id, assignmentId: 'a', start, end, origin: 'planner', status: 'planned', ...extra };
}

function makeDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [],
    assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-16T23:59:00' }],
    events: [],
    availability: [AFTERNOONS],
    scheduleBlocks: [],
    ...partial,
  };
}

describe('repairPlan', () => {
  it('moves a session that now overlaps a commitment, and nothing else', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-16T23:59:00' },
        { id: 'b', title: 'Reading', estimatedMinutes: 30, due: '2026-10-16T23:59:00' },
      ],
      events: [{ id: 'e', title: 'Practice', date: '2026-10-12', startTime: '16:00', endTime: '17:00' }],
      scheduleBlocks: [session('s1', '2026-10-12T16:00:00', '2026-10-12T17:00:00'), session('s2', '2026-10-13T16:00:00', '2026-10-13T16:30:00', { assignmentId: 'b' })],
    });
    expect(brokenSessions(doc, NOW).map((b) => b.block.id)).toEqual(['s1']);
    const result = repairPlan(doc, NOW);
    expect(result).toMatchObject({ moved: 1, sessions: 1, unplaced: [] });
    const blocks = result.doc.scheduleBlocks;
    expect(blocks.find((b) => b.id === 's1')).toBeUndefined();
    expect(blocks.find((b) => b.id === 's2')).toEqual(doc.scheduleBlocks[1]);
    const moved = blocks.find((b) => b.assignmentId === 'a')!;
    expect(ldtToMinutes(moved.start)).toBeGreaterThanOrEqual(ldtToMinutes('2026-10-12T17:00:00'));
    expect(brokenSessions(result.doc, NOW)).toEqual([]);
    // What moved and why, for the undo history.
    expect(result.changes[0]).toBe('Essay, Mon, Oct 12, 4:00 PM–5:00 PM: removed (overlaps Practice)');
    expect(result.changes[1]).toMatch(/^Essay, Mon, Oct 12, .*: new session$/);
  });

  it('moves sessions that end after a due date that moved earlier, before the new date', () => {
    const doc = makeDoc({
      assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-13T23:59:00' }],
      scheduleBlocks: [session('late', '2026-10-15T16:00:00', '2026-10-15T17:00:00')],
    });
    const result = repairPlan(doc, NOW);
    expect(result.moved).toBe(1);
    expect(result.doc.scheduleBlocks.every((b) => ldtToMinutes(b.end) <= ldtToMinutes('2026-10-13T23:59:00'))).toBe(true);
  });

  it('keeps locked, own, done and past sessions; of two overlapping sessions the later one moves', () => {
    const doc = makeDoc({
      events: [{ id: 'e', title: 'Practice', date: '2026-10-13', startTime: '16:00', endTime: '18:00' }],
      scheduleBlocks: [
        session('locked', '2026-10-13T16:00:00', '2026-10-13T16:30:00', { locked: true }),
        session('own', '2026-10-13T16:30:00', '2026-10-13T17:00:00', { origin: 'user' }),
        session('done', '2026-10-13T17:00:00', '2026-10-13T17:30:00', { status: 'done' }),
        session('past', '2026-10-11T16:00:00', '2026-10-11T19:00:00', { assignmentId: 'a' }),
        session('first', '2026-10-14T16:00:00', '2026-10-14T16:30:00'),
        session('second', '2026-10-14T16:15:00', '2026-10-14T16:45:00'),
      ],
    });
    expect(brokenSessions(doc, NOW).map((b) => b.block.id)).toEqual(['second']);
  });

  it('reports work that cannot fit before its deadline instead of placing it late', () => {
    const doc = makeDoc({
      assignments: [{ id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-12T23:59:00' }],
      events: [{ id: 'e', title: 'Practice', date: '2026-10-12', startTime: '16:00', endTime: '18:00' }],
      scheduleBlocks: [session('s1', '2026-10-12T16:00:00', '2026-10-12T17:00:00')],
    });
    const result = repairPlan(doc, NOW);
    expect(result).toMatchObject({ moved: 1, sessions: 0 });
    expect(result.unplaced).toEqual([expect.objectContaining({ assignmentId: 'a', minutes: 60 })]);
  });

  it('moves planner sessions outside changed study time, but not sessions from a schedule file', () => {
    const doc = makeDoc({
      scheduleBlocks: [session('planner', '2026-10-13T19:00:00', '2026-10-13T19:30:00'), session('file', '2026-10-13T20:00:00', '2026-10-13T20:30:00', { origin: 'generated' })],
    });
    expect(brokenSessions(doc, NOW).map((b) => b.block.id)).toEqual(['planner']);
    // Without any study time entered, nothing counts as outside it.
    expect(brokenSessions({ ...doc, availability: [] }, NOW)).toEqual([]);
  });

  it('moves the latest planner sessions of a day that is over the daily limit', () => {
    const doc = makeDoc({
      settings: { maxDailyStudyMinutes: 60 },
      scheduleBlocks: [
        session('own', '2026-10-13T16:00:00', '2026-10-13T16:40:00', { origin: 'user' }),
        session('p1', '2026-10-13T16:45:00', '2026-10-13T17:05:00'),
        session('p2', '2026-10-13T17:10:00', '2026-10-13T17:30:00'),
      ],
    });
    expect(brokenSessions(doc, NOW).map((b) => b.block.id)).toEqual(['p2']);
  });

  it('with assignmentIds, repairs only that work', () => {
    const doc = makeDoc({
      assignments: [
        { id: 'a', title: 'Essay', estimatedMinutes: 60, due: '2026-10-16T23:59:00' },
        { id: 'b', title: 'Reading', estimatedMinutes: 60, due: '2026-10-16T23:59:00' },
      ],
      events: [{ id: 'e', title: 'Practice', date: '2026-10-12', startTime: '16:00', endTime: '18:00' }],
      scheduleBlocks: [session('sa', '2026-10-12T16:00:00', '2026-10-12T17:00:00'), session('sb', '2026-10-12T17:00:00', '2026-10-12T18:00:00', { assignmentId: 'b' })],
    });
    expect(brokenSessions(doc, NOW, ['b']).map((b) => b.block.id)).toEqual(['sb']);
    expect(repairPlan(doc, NOW, ['b']).doc.scheduleBlocks.some((b) => b.id === 'sa')).toBe(true);
  });
});
