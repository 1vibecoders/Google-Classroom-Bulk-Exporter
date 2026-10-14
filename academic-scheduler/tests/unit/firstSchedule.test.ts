// The first schedule after setup: the free AI run's safe findings fill gaps
// (here a missing time estimate), then the fixed-rule planner places the work.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstSchedule } from '../../src/lib/ai/firstSchedule';
import { validateDocument } from '../../src/lib/validate';
import type { AiProposal } from '../../src/model/aiProposal';
import type { ScheduleDocument } from '../../src/model/types';

function example(): ScheduleDocument {
  return validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: '2026-10-12' }).doc!;
}

const GRAMMAR = 'gc-NzAwMDAwMDAwMDAz';
const ESTIMATE: AiProposal = {
  key: 'w'.repeat(32),
  kind: 'workload',
  classId: 'gc-class-NjI3ODk0MjE0NTQ5',
  source: { kind: 'coursework', id: 'NzAwMDAwMDAwMDAz' },
  excerpt: 'One worksheet of comma exercises',
  assignmentId: GRAMMAR,
  value: 45,
  explicit: false,
  confidence: { identity: 'high', value: 'medium' },
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the first schedule', () => {
  it('asks for the free setup run, applies the estimate and plans the work', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T08:00:00') });
    const doc = example();
    const grammar = doc.assignments.find((a) => a.id === GRAMMAR)!;
    grammar.estimatedMinutes = undefined;
    grammar.sourceState = 'present';
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ configured: true, proposals: [ESTIMATE], pending: 0, budget: { limit: 20, used: 1 }, setupAvailable: false }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const built = await firstSchedule(doc, true, 'America/New_York');
    expect(sent).toEqual([{ timezone: 'America/New_York', setup: true }]);
    expect(built.applied).toEqual([ESTIMATE.key]);
    expect(built.estimated).toBe(1);
    expect(built.doc.assignments.find((a) => a.id === GRAMMAR)).toMatchObject({ estimatedMinutes: 45, estimateBasis: 'AI estimate: One worksheet of comma exercises' });
    expect(built.sessions).toBeGreaterThan(0);
    expect(built.doc.scheduleBlocks.filter((b) => b.assignmentId === GRAMMAR && b.origin === 'planner').length).toBeGreaterThan(0);
    expect(built.status?.proposals).toEqual([]);
    expect(validateDocument(built.doc, { today: '2026-10-12' }).errors).toEqual([]);
  });

  it('plans without AI when it is not set up, and says why when the AI fails', async () => {
    const doc = example();
    expect((await firstSchedule(doc, false, 'America/New_York')).status).toBeNull();
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const built = await firstSchedule(doc, true, 'America/New_York');
    expect(built.problem).toMatch(/could not be reached/);
    expect(built.applied).toEqual([]);
  });
});
