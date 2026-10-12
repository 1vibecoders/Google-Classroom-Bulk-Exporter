// A Google Classroom sync batch merged onto a schedule made by the skill and
// the extension: the same Classroom items match by ID, only Classroom-owned
// fields change, estimates and tasks stay, and the usual import preview shows
// exactly the real changes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyImport, defaultSelection, planImport } from '../../src/lib/importDiff';
import { mergeBatch } from '../../src/lib/sync/mergeBatch';
import { validateDocument } from '../../src/lib/validate';
import type { ImportBatch, ImportedAssignment } from '../../src/model/importBatch';
import type { ScheduleDocument } from '../../src/model/types';

const NOW = '2026-10-12T16:00:00';
const ENGLISH = 'gc-class-NjI3ODk0MjE0NTQ5';

function example(): ScheduleDocument {
  const result = validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: '2026-10-12' });
  if (!result.doc) throw new Error('example invalid');
  return result.doc;
}

function item(sourceId: string, fields: Partial<ImportedAssignment>): ImportedAssignment {
  return { id: `gc-${sourceId}`, classId: ENGLISH, sourceId, state: 'present', ...fields };
}

function batch(assignments: ImportedAssignment[]): ImportBatch {
  return {
    batchVersion: 1,
    sourceType: 'classroom_api',
    importedAt: NOW,
    timezone: 'America/New_York',
    courses: [{ id: ENGLISH, sourceId: 'NjI3ODk0MjE0NTQ5', name: 'English 10', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5', state: 'present' }],
    assignments,
    counts: { new: 0, changed: 0, unchanged: 0, missing: 0 },
    warnings: [],
  };
}

const UNCHANGED = [
  item('NzAwMDAwMDAwMDAx', { title: 'Othello Essay', due: '2026-10-16T23:59:00' }),
  item('NzAwMDAwMDAwMDAy', { title: 'Read Othello Act 3', due: '2026-10-13' }),
  item('NzAwMDAwMDAwMDAz', { title: 'Grammar worksheet 3: Commas', due: '2026-10-14T23:59:00' }),
];

function plan(current: ScheduleDocument, b: ImportBatch) {
  const checked = validateDocument(mergeBatch(current, b), { today: '2026-10-12' });
  expect(checked.errors).toEqual([]);
  const p = planImport(current, checked.doc!, NOW);
  expect(p.errors).toEqual([]);
  return { incoming: checked.doc!, plan: p };
}

describe('merging a Classroom sync batch', () => {
  it('shows no changes when Classroom has nothing new', () => {
    const current = example();
    const { plan: p } = plan(current, batch(UNCHANGED));
    expect(p.changes.filter((c) => c.category !== 'unchanged')).toEqual([]);
  });

  it('updates Classroom-owned fields, keeps estimates and tasks, adds new work and marks work Classroom no longer lists', () => {
    const current = example();
    const { incoming, plan: p } = plan(
      current,
      batch([
        UNCHANGED[0],
        item('NzAwMDAwMDAwMDAy', { state: 'missing', title: undefined }),
        item('NzAwMDAwMDAwMDAz', { title: 'Grammar worksheet 3: Commas and clauses', due: '2026-10-14T23:59:00', links: [{ title: 'Worksheet', url: 'https://docs.google.com/document/d/abc' }] }),
        item('NzAwMDAwMDAwMDA5', { title: 'Poetry analysis', due: '2026-10-20T23:59:00', description: 'Analyze one sonnet.' }),
      ]),
    );
    expect(p.summary.new).toEqual({ assignments: 1 });
    const after = applyImport(current, incoming, p, defaultSelection(p), NOW);
    const byId = new Map(after.assignments.map((a) => [a.id, a]));

    const grammar = byId.get('gc-NzAwMDAwMDAwMDAz')!;
    expect(grammar.title).toBe('Grammar worksheet 3: Commas and clauses');
    expect(grammar.estimatedMinutes).toBe(25);
    expect(grammar.references).toContainEqual({ title: 'Worksheet', url: 'https://docs.google.com/document/d/abc', kind: 'link' });

    expect(byId.get('gc-NzAwMDAwMDAwMDAy')!.sourceState).toBe('missing');
    expect(byId.get('gc-NzAwMDAwMDAwMDAx')!.tasks).toHaveLength(4);
    expect(byId.get('gc-NzAwMDAwMDAwMDA5')).toMatchObject({ origin: 'generated', classId: ENGLISH, source: { kind: 'google_classroom', id: 'NzAwMDAwMDAwMDA5', retrievedAt: NOW } });
    // Items Classroom does not own are untouched.
    expect(byId.get('biology-unit-2-test-cells-2026-10-16')).toEqual(current.assignments.find((a) => a.id === 'biology-unit-2-test-cells-2026-10-16'));
    expect(after.settings).toEqual(current.settings);
    expect(after.events).toEqual(current.events);
  });

  it('never clears a due date Classroom does not give, and brings back work that returns', () => {
    const current = example();
    const gone = applyImport(current, ...(() => {
      const r = plan(current, batch([item('NzAwMDAwMDAwMDAy', { state: 'missing' })]));
      return [r.incoming, r.plan, defaultSelection(r.plan), NOW] as const;
    })());
    expect(gone.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAy')!.sourceState).toBe('missing');
    const { incoming } = plan(gone, batch([item('NzAwMDAwMDAwMDAy', { title: 'Read Othello Act 3' })]));
    const back = incoming.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAy')!;
    expect(back.sourceState).toBe('present');
    expect(back.due).toBe('2026-10-13');
  });

  it('does not bring back an item the person deleted', () => {
    const current = example();
    current.assignments = current.assignments.filter((a) => a.id !== 'gc-NzAwMDAwMDAwMDAz');
    current.scheduleBlocks = current.scheduleBlocks.filter((b) => b.assignmentId !== 'gc-NzAwMDAwMDAwMDAz');
    current.deleted = [...(current.deleted ?? []), { id: 'gc-NzAwMDAwMDAwMDAz', collection: 'assignments', deletedAt: '2026-10-12T09:00:00', sourceId: 'NzAwMDAwMDAwMDAz' }];
    const { incoming, plan: p } = plan(current, batch(UNCHANGED));
    expect(incoming.assignments.some((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')).toBe(false);
    expect(p.changes.filter((c) => c.category !== 'unchanged')).toEqual([]);
  });

  it('keeps a withdrawn item withdrawn while Classroom still lists it', () => {
    const current = example();
    expect(current.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')!.sourceState).toBe('withdrawn');
    const { incoming } = plan(current, batch(UNCHANGED));
    expect(incoming.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')!.sourceState).toBe('withdrawn');
  });
});
