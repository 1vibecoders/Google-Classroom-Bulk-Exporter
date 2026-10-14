// What the website does with AI proposals: only sure, stated findings that
// fill a gap are automatic; dates the person or Classroom set are never
// replaced without the person; applying by the person protects the value
// from the next sync; nothing invalid is ever committed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AiProposal } from '../../src/model/aiProposal';
import type { ScheduleDocument } from '../../src/model/types';
import { applyProposal, automatic, reviewItems } from '../../src/lib/ai/proposals';
import { validateDocument } from '../../src/lib/validate';

const ENGLISH = 'gc-class-NjI3ODk0MjE0NTQ5';

function example(): ScheduleDocument {
  return validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: '2026-10-12' }).doc!;
}

function proposal(fields: Partial<AiProposal>): AiProposal {
  return {
    key: 'k'.repeat(32),
    kind: 'due_change',
    classId: ENGLISH,
    source: { kind: 'announcement', id: 'ODAx', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/ODAx', postedAt: '2026-10-11T08:00:00' },
    excerpt: 'Grammar worksheet is now due Friday',
    value: '2026-10-16T23:59:00',
    explicit: true,
    confidence: { identity: 'high', value: 'high' },
    ...fields,
  };
}

describe('AI proposals against the schedule', () => {
  it('never replaces a due date Classroom gives without the person, and protects it once they apply it', () => {
    const doc = example();
    const [item] = reviewItems(doc, [proposal({ assignmentId: 'gc-NzAwMDAwMDAwMDAz' })]);
    expect(item).toMatchObject({ field: 'due', previous: '2026-10-14T23:59:00', className: 'English 10' });
    expect(item.reasons).toEqual(['Classroom gives a different due date; check which one is right.']);
    expect(automatic([item])).toEqual([]);
    const result = applyProposal(doc, item, true);
    if (!('doc' in result)) throw new Error(result.error);
    const grammar = result.doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')!;
    expect(grammar.due).toBe('2026-10-16T23:59:00');
    expect(grammar.overrides).toContain('due');
    expect(grammar.sources).toContainEqual({ kind: 'google_classroom', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/ODAx', label: 'Announcement: “Grammar worksheet is now due Friday”' });
    // Applied: nothing left to review.
    expect(reviewItems(result.doc, [proposal({ assignmentId: 'gc-NzAwMDAwMDAwMDAz' })])).toEqual([]);
  });

  it('explains uncertain, inferred and person-owned findings', () => {
    const doc = example();
    doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAy')!.overrides = ['due'];
    const [item] = reviewItems(doc, [proposal({ assignmentId: 'gc-NzAwMDAwMDAwMDAy', explicit: false, confidence: { identity: 'medium', value: 'low' } })]);
    expect(item.reasons).toEqual([
      'Not sure which assignment this is about.',
      'The date is uncertain.',
      'Worked out from words like “Friday”, not stated as a date.',
      'You set this date yourself; it is never changed without you.',
    ]);
  });

  it('adds a sure, stated new quiz automatically once, with a derived ID and its source', () => {
    const doc = example();
    const quiz = proposal({ kind: 'new_assessment', title: 'Unit 3 quiz', type: 'quiz', value: '2026-10-20', excerpt: 'Unit 3 quiz on Oct 20' });
    const auto = automatic(reviewItems(doc, [quiz]));
    expect(auto).toHaveLength(1);
    const result = applyProposal(doc, auto[0], false);
    if (!('doc' in result)) throw new Error(result.error);
    expect(result.doc.assignments.find((a) => a.id === 'gc-ODAx-unit-3-quiz')).toMatchObject({
      title: 'Unit 3 quiz',
      type: 'quiz',
      classId: ENGLISH,
      origin: 'generated',
      assessmentDate: '2026-10-20',
      source: { kind: 'google_classroom', label: 'Announcement: “Unit 3 quiz on Oct 20”' },
    });
    expect(reviewItems(result.doc, [quiz])).toEqual([]);
    // Deleted by the person: never added again.
    const deleted = example();
    deleted.deleted = [{ id: 'gc-ODAx-unit-3-quiz', collection: 'assignments', deletedAt: '2026-10-12T09:00:00' }];
    expect(reviewItems(deleted, [quiz])).toEqual([]);
  });

  it('flags texts that disagree instead of letting the last one win', () => {
    const doc = example();
    doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')!.due = undefined;
    const items = reviewItems(doc, [proposal({ assignmentId: 'gc-NzAwMDAwMDAwMDAz' }), proposal({ key: 'j'.repeat(32), assignmentId: 'gc-NzAwMDAwMDAwMDAz', value: '2026-10-19' })]);
    expect(items.map((i) => i.reasons)).toEqual([['Other Classroom texts give a different value.'], ['Other Classroom texts give a different value.']]);
    expect(automatic(items)).toEqual([]);
  });

  it('fills a missing estimate automatically but asks before replacing one', () => {
    const doc = example();
    doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')!.estimatedMinutes = undefined;
    const estimate = proposal({ kind: 'estimate', assignmentId: 'gc-NzAwMDAwMDAwMDAz', value: 30, excerpt: 'about 30 minutes' });
    const [item] = automatic(reviewItems(doc, [estimate]));
    const result = applyProposal(doc, item, false);
    if (!('doc' in result)) throw new Error(result.error);
    expect(result.doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAz')).toMatchObject({
      estimatedMinutes: 30,
      estimateBasis: 'Stated in Classroom: “about 30 minutes”',
      estimateConfidence: 'high',
    });
    expect(reviewItems(example(), [estimate])[0].reasons).toEqual(['There is already an estimate.']);
  });

  it('moves planned steps to fit an earlier due date and flags the plan, and waits for work not imported yet', () => {
    const doc = example();
    // The essay has planned steps and sessions after this date.
    const [early] = reviewItems(doc, [proposal({ assignmentId: 'gc-NzAwMDAwMDAwMDAx', value: '2026-10-13T23:59:00' })]);
    const result = applyProposal(doc, early, true);
    if (!('doc' in result)) throw new Error(result.error);
    const essay = result.doc.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDAx')!;
    expect(essay.due).toBe('2026-10-13T23:59:00');
    expect(essay.tasks!.filter((t) => t.status !== 'done').every((t) => !t.due || t.due <= '2026-10-13T23:59:00')).toBe(true);
    expect(essay.issues).toContainEqual(
      expect.objectContaining({ id: 'gc-NzAwMDAwMDAwMDAx-due-earlier', kind: 'conflict', message: expect.stringContaining('from 2026-10-16T23:59:00 to 2026-10-13T23:59:00') }),
    );
    expect(reviewItems(doc, [proposal({ assignmentId: 'gc-unknown' }), proposal({ classId: 'gc-class-other', kind: 'new_assessment', title: 'X' })])).toEqual([]);
  });
});
