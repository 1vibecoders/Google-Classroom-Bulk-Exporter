// Gamification is computed from the schedule (SPEC § 28): finished work earns
// XP, overwork and late nights do not, and trivial steps are capped.
import { describe, expect, it } from 'vitest';
import type { ScheduleBlock, ScheduleDocument } from '../../src/model/types';
import { computeProgress } from '../../src/lib/progress';

const NOW = '2026-10-20T12:00:00';
const done = (id: string, start: string, end: string, assignmentId = 'a'): ScheduleBlock => ({ id, assignmentId, start, end, status: 'done' });
const doc = (partial: Partial<ScheduleDocument>): ScheduleDocument => ({ schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], ...partial });

describe('computeProgress', () => {
  it('rewards finished sessions, capped at 3 hours a day and nothing that ends late at night', () => {
    const p = computeProgress(
      doc({
        assignments: [{ id: 'a', title: 'Essay' }],
        scheduleBlocks: [
          done('long', '2026-10-12T14:00:00', '2026-10-12T18:00:00'), // 240 min, 180 count
          done('late', '2026-10-13T22:30:00', '2026-10-13T23:30:00'), // ends after 11 PM: 0
          { id: 'planned', assignmentId: 'a', start: '2026-10-14T16:00:00', end: '2026-10-14T17:00:00' },
        ],
      }),
      NOW,
    );
    expect(p.xp).toBe(36);
    expect(p.achievements.find((a) => a.id === 'first-session')?.earned).toBe(true);
  });

  it('rewards finished and large work, caps steps, and rewards early test preparation', () => {
    const p = computeProgress(
      doc({
        assignments: [
          { id: 'big', title: 'Project', estimatedMinutes: 240, status: 'done', tasks: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, title: `Step ${i}`, status: 'done' as const })) },
          { id: 'test', title: 'Biology test', type: 'test', assessmentDate: '2026-10-16' },
        ],
        scheduleBlocks: [done('p1', '2026-10-13T16:00:00', '2026-10-13T16:30:00', 'test'), done('p2', '2026-10-15T16:00:00', '2026-10-15T16:30:00', 'test')],
      }),
      NOW,
    );
    // 40 (finished, large) + 25 (5 of 8 steps) + 12 (60 min) + 5 (one session 2+ days before the test)
    expect(p.xp).toBe(82);
    expect(p.achievements.find((a) => a.id === 'big-work')?.earned).toBe(true);
    expect(p).toMatchObject({ level: 1, intoLevel: 82, levelSize: 100 });
  });
});
