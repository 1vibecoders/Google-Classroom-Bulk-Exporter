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
    expect(sent).toEqual([{ timezone: 'America/New_York', setup: true, commitments: doc.settings!.commitmentsDescription, sources: expect.any(Object) }]);
    // The imported classes and open work go along, so the AI reads them without a Google sync.
    const sources = (sent[0] as { sources: { classes: Array<{ id: string }>; work: Array<{ id: string }> } }).sources;
    expect(sources.classes.map((c) => c.id)).toContain('gc-class-NjI3ODk0MjE0NTQ5');
    expect(sources.work.map((w) => w.id)).toContain(GRAMMAR);
    expect(built.applied).toEqual([ESTIMATE.key]);
    expect(built.estimated).toBe(1);
    expect(built.doc.assignments.find((a) => a.id === GRAMMAR)).toMatchObject({ estimatedMinutes: 45, estimateBasis: 'AI estimate: One worksheet of comma exercises' });
    expect(built.sessions).toBeGreaterThan(0);
    expect(built.doc.scheduleBlocks.filter((b) => b.assignmentId === GRAMMAR && b.origin === 'planner').length).toBeGreaterThan(0);
    expect(built.status?.proposals).toEqual([]);
    expect(validateDocument(built.doc, { today: '2026-10-12' }).errors).toEqual([]);
  });

  it('adds the commitments read from the description, turns steps into tasks and plans around both', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T08:00:00') });
    const doc = example();
    const grammar = doc.assignments.find((a) => a.id === GRAMMAR)!;
    grammar.estimatedMinutes = undefined;
    grammar.estimateRange = undefined;
    grammar.tasks = undefined;
    grammar.sourceState = 'present';
    const withSteps: AiProposal = { ...ESTIMATE, value: 90, steps: [{ title: 'Review comma rules', minutes: 30 }, { title: 'Do the exercises', minutes: 60 }] };
    const commitments = {
      key: 'c'.repeat(32),
      events: [
        { title: 'Robotics club', category: 'activity', daysOfWeek: ['tue', 'thu'], startTime: '15:30', endTime: '17:00' },
        // Already in the schedule: not added twice.
        { title: 'Fencing', category: 'activity', daysOfWeek: ['mon'], startTime: '16:00', endTime: '18:00' },
      ],
      questions: ['Which days and hours do you work at the café?'],
    };
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ configured: true, proposals: [withSteps], pending: 0, budget: { limit: 20, used: 2 }, commitments }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const built = await firstSchedule(doc, true, 'America/New_York');
    expect(built.events).toBe(1);
    expect(built.questions).toBe(1);
    expect(built.doc.events.find((e) => e.id === 'cm-robotics-club')).toMatchObject({
      origin: 'generated',
      busy: true,
      recurrence: { frequency: 'weekly', daysOfWeek: ['tue', 'thu'], startDate: '2026-10-12' },
      source: { kind: 'user' },
    });
    expect(built.doc.events.filter((e) => e.title === 'Fencing')).toHaveLength(1);
    expect(built.doc.issues?.some((i) => i.kind === 'missing_information' && i.message.includes('café'))).toBe(true);
    expect(built.doc.assignments.find((a) => a.id === GRAMMAR)!.tasks).toEqual([
      { id: `${GRAMMAR}-s1`, title: 'Review comma rules', estimatedMinutes: 30, origin: 'generated' },
      { id: `${GRAMMAR}-s2`, title: 'Do the exercises', estimatedMinutes: 60, origin: 'generated', dependsOn: [`${GRAMMAR}-s1`] },
    ]);
    const sessions = built.doc.scheduleBlocks.filter((b) => b.assignmentId === GRAMMAR && b.origin === 'planner');
    expect(sessions.some((b) => b.taskId === `${GRAMMAR}-s1`)).toBe(true);
    // Nothing planned over robotics club (Tue/Thu 15:30–17:00).
    for (const b of built.doc.scheduleBlocks.filter((x) => x.origin === 'planner')) {
      const day = new Date(`${b.start.slice(0, 10)}T12:00:00`).getDay();
      if (day === 2 || day === 4) expect(b.end.slice(11, 16) <= '15:30' || b.start.slice(11, 16) >= '17:00').toBe(true);
    }
    expect(validateDocument(built.doc, { today: '2026-10-14' }).errors).toEqual([]);
  });

  it('leaves an announced reschedule of work Classroom already dates in Review, and counts it', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-14T08:00:00') });
    const doc = example();
    const moved: AiProposal = {
      ...ESTIMATE,
      key: 'd'.repeat(32),
      kind: 'due_change',
      source: { kind: 'announcement', id: 'ODAx' },
      excerpt: 'The Othello essay is now due Monday',
      assignmentId: 'gc-NzAwMDAwMDAwMDAx',
      value: '2026-10-19T23:59:00',
      confidence: { identity: 'high', value: 'high' },
    };
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ configured: true, proposals: [moved], pending: 0, budget: { limit: 20, used: 1 } }), { headers: { 'content-type': 'application/json' } }),
    );
    const built = await firstSchedule(doc, true, 'America/New_York');
    expect(built.applied).toEqual([]);
    expect(built.doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAx')!.due).toBe('2026-10-16T23:59:00');
    expect(built).toMatchObject({ review: 1, dueChanges: 1 });
  });

  it('reads on while the server says there is more, and plans once everything was read', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T08:00:00') });
    const doc = example();
    const grammar = doc.assignments.find((a) => a.id === GRAMMAR)!;
    grammar.estimatedMinutes = undefined;
    grammar.sourceState = 'present';
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      const done = bodies.length === 3;
      return new Response(JSON.stringify({ configured: true, proposals: done ? [ESTIMATE] : [], pending: done ? 0 : 5, budget: { limit: 60, used: bodies.length }, ...(done ? {} : { more: true }) }), {
        headers: { 'content-type': 'application/json' },
      });
    });
    const built = await firstSchedule(doc, true, 'America/New_York');
    expect(bodies.map((b) => b.continue === true)).toEqual([false, true, true]);
    expect(built.applied).toEqual([ESTIMATE.key]);
    expect(built.problem).toBeUndefined();
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
