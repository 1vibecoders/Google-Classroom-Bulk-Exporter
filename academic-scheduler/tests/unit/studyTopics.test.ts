// The study planner (SPEC.md § 25): the AI reads the materials that look
// relevant to a test and proposes small topics with verbatim quotes; applying
// adds them without replacing the person's; topic status decides what the
// next preparation sessions cover; imports keep the person's statuses.
import { describe, expect, it } from 'vitest';
import type { AiProposal } from '../../src/model/aiProposal';
import type { ScheduleBlock, ScheduleDocument } from '../../src/model/types';
import { applyProposal, automatic, reviewItems } from '../../src/lib/ai/proposals';
import { prepDescriptions, upcomingAssessments, withPrepDescriptions } from '../../src/lib/studyPlan';
import { assessmentsFrom, checkTopics, pickMaterials, type TopicsInput } from '../../server/ai/topics';

const CLASS = 'gc-class-MTEx';

describe('choosing materials and checking the AI topics (server)', () => {
  const assessment = { id: 'gc-T1', title: 'Unit 3 test: cells' };
  const materials = [
    { kind: 'document' as const, id: 'guide', title: 'Unit 3 study guide', text: 'Know the parts of the cell membrane. Practice osmosis problems.' },
    { kind: 'announcement' as const, id: 'a1', text: 'Field trip forms are due Monday.' },
    { kind: 'coursework' as const, id: 'w1', title: 'Chapter 3 reading', text: 'Read about cells and organelles.' },
  ];

  it('reads study guides and same-unit materials first, and leaves unrelated ones out', () => {
    expect(pickMaterials(assessment, materials).map((m) => m.id)).toEqual(['guide', 'w1']);
  });

  it('keeps only topics whose quote occurs in the material, without duplicates, as one proposal', () => {
    const input: TopicsInput = { classId: CLASS, className: 'Biology', assessment, materials: pickMaterials(assessment, materials) };
    const { proposal, rejected } = checkTopics(
      {
        topics: [
          { title: 'Cell membrane structure', basis: 'listed', material: 0, quote: 'Know the parts of the  cell membrane.' },
          { title: 'cell membrane structure', basis: 'listed', material: 0, quote: 'Know the parts of the cell membrane.' },
          { title: 'Mitochondria', basis: 'listed', material: 0, quote: 'Mitochondria are the powerhouse' },
          { title: 'Organelles', basis: 'materials', material: 1, quote: 'cells and organelles' },
          { title: 'Cell division', basis: 'inferred', material: 0, quote: '' },
        ],
      },
      input,
    );
    expect(rejected).toBe(2);
    expect(proposal).toMatchObject({ kind: 'topics', assignmentId: 'gc-T1', value: 3, explicit: true, confidence: { identity: 'high', value: 'high' } });
    expect(proposal!.topics).toEqual([
      { title: 'Cell membrane structure', basis: 'listed', quote: 'Know the parts of the cell membrane.', source: { kind: 'document', id: 'guide' } },
      { title: 'Organelles', basis: 'materials', quote: 'cells and organelles', source: { kind: 'coursework', id: 'w1' } },
      { title: 'Cell division', basis: 'inferred' },
    ]);
    expect(checkTopics({ topics: [] }, input).proposal).toBeNull();
  });

  it('finds upcoming tests with something to read, and skips past, turned-in and empty ones', () => {
    const records = [
      { kind: 'coursework', source_id: 'T1', course_id: 'MTEx', data: { title: 'Unit 3 test', due: '2026-10-20' } },
      { kind: 'coursework', source_id: 'T2', course_id: 'MTEx', data: { title: 'Old quiz', due: '2026-10-01', description: 'Chapters 1-2' } },
      { kind: 'coursework', source_id: 'T3', course_id: 'MTEx', data: { title: 'Vocab quiz' } },
      { kind: 'document', source_id: 'guide', course_id: 'MTEx', data: { title: 'Study guide', status: 'ok', text: 'Unit 3 review: osmosis.', parents: [] } },
    ];
    const found = assessmentsFrom(records, '2026-10-12', new Map([['MTEx', 'Biology']]));
    expect(found.map((f) => f.input.assessment.id)).toEqual(['gc-T1']);
    expect(found[0].input.materials.map((m) => m.id)).toEqual(['guide']);
  });
});

function doc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [{ id: CLASS, name: 'Biology' }],
    assignments: [{ id: 'gc-T1', title: 'Unit 3 test', classId: CLASS, type: 'test', assessmentDate: '2026-10-20' }],
    events: [],
    availability: [],
    scheduleBlocks: [],
    ...partial,
  };
}

const proposal: AiProposal = {
  key: 't'.repeat(32),
  kind: 'topics',
  classId: CLASS,
  source: { kind: 'document', id: 'guide' },
  excerpt: 'Know the parts of the cell membrane.',
  assignmentId: 'gc-T1',
  value: 2,
  explicit: true,
  confidence: { identity: 'high', value: 'high' },
  topics: [
    { title: 'Cell membrane structure', basis: 'listed', quote: 'Know the parts of the cell membrane.', source: { kind: 'document', id: 'guide', url: 'https://drive.google.com/file/d/guide' } },
    { title: 'Osmosis practice', basis: 'listed' },
  ],
};

describe('study topics on the website', () => {
  it('adds listed topics automatically to a test without topics, and only the new ones later', () => {
    const [item] = reviewItems(doc(), [proposal]);
    expect(item).toMatchObject({ field: 'topics', reasons: [] });
    expect(automatic([item])).toHaveLength(1);
    const result = applyProposal(doc(), item, false);
    if (!('doc' in result)) throw new Error(result.error);
    const topics = result.doc.assignments[0].studyTopics!;
    expect(topics.map((t) => [t.id, t.title, t.basis])).toEqual([
      ['cell-membrane-structure', 'Cell membrane structure', 'listed'],
      ['osmosis-practice', 'Osmosis practice', 'listed'],
    ]);
    expect(topics[0].source).toMatchObject({ kind: 'google_classroom', url: 'https://drive.google.com/file/d/guide' });
    expect(result.doc.schemaVersion).toBe('1.3');
    // Already there: nothing to review.
    expect(reviewItems(result.doc, [proposal])).toEqual([]);
    // A test with the person's own topic: the AI's wait for the person.
    const mine = doc({ assignments: [{ ...doc().assignments[0], studyTopics: [{ id: 'mine-1', title: 'Diffusion', basis: 'user', status: 'comfortable' }] }] });
    const [later] = reviewItems(mine, [proposal]);
    expect(later.reasons).toContain('There are already study topics; the new ones would be added.');
    const added = applyProposal(mine, later, true);
    if (!('doc' in added)) throw new Error(added.error);
    expect(added.doc.assignments[0].studyTopics!.map((t) => t.title)).toEqual(['Diffusion', 'Cell membrane structure', 'Osmosis practice']);
  });

  it('describes preparation sessions by what is most needed, and drops comfortable topics', () => {
    const topics = [
      { id: 'a', title: 'A', status: 'comfortable' as const },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C', status: 'needs_review' as const },
      { id: 'd', title: 'D', status: 'in_progress' as const },
    ];
    expect(prepDescriptions(topics, 2)).toEqual(['Study: C, B', 'Study: D']);
    expect(prepDescriptions(topics, 4)).toEqual(['Study: C', 'Study: B', 'Study: D', 'Recap and practice: C']);
    expect(prepDescriptions([], 3)).toEqual([]);

    const session = (id: string, day: string, extra: Partial<ScheduleBlock> = {}): ScheduleBlock => ({ id, assignmentId: 'gc-T1', start: `${day}T16:00:00`, end: `${day}T16:30:00`, origin: 'planner', ...extra });
    const planned = doc({
      assignments: [{ ...doc().assignments[0], studyTopics: topics }],
      scheduleBlocks: [session('s1', '2026-10-14'), session('s2', '2026-10-15'), session('mine', '2026-10-16', { origin: 'user', description: 'My plan' })],
    });
    const described = withPrepDescriptions(planned, 'gc-T1', '2026-10-12T08:00:00');
    expect(described.scheduleBlocks.map((b) => b.description)).toEqual(['Study: C, B', 'Study: D', 'My plan']);
  });

  it('lists upcoming tests soonest first, and leaves out finished and past ones', () => {
    const d = doc({
      assignments: [
        { id: 'later', title: 'Final exam', type: 'exam', assessmentDate: '2026-12-10' },
        { id: 'soon', title: 'Quiz', type: 'quiz', due: '2026-10-13' },
        { id: 'past', title: 'Old test', type: 'test', assessmentDate: '2026-10-01' },
        { id: 'done', title: 'Done quiz', type: 'quiz', status: 'done' },
        { id: 'hw', title: 'Worksheet', type: 'homework' },
      ],
    });
    expect(upcomingAssessments(d, '2026-10-12').map((a) => a.id)).toEqual(['soon', 'later']);
  });
});
