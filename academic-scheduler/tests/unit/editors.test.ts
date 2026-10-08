// Editor form logic (src/editors/parts): round trips that change nothing,
// preservation of fields the forms do not show, defaults that stay absent,
// and the validation rules of SCHEDULE_FORMAT.md that the editors enforce
// so that a saved item is always valid.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDocument } from '../../src/lib/validate';
import { emptyDocument, initialState, reducer, stableStringify, type AppState } from '../../src/state/reducer';
import type { Assignment, AvailabilityWindow, ScheduleDocument, ScheduleEvent, SchoolClass } from '../../src/model/types';
import { classToForm, formToClass, validateClassForm } from '../../src/editors/parts/classForm';
import {
  assignmentToForm,
  formToAssignment,
  newTaskRow,
  taskEstimateTotal,
  validateAssignmentForm,
  type AssignmentForm,
} from '../../src/editors/parts/assignmentForm';
import {
  availabilityToForm,
  eventToForm,
  formToAvailability,
  formToEvent,
  recurrenceNeverOccurs,
  validateAvailabilityForm,
  validateEventForm,
  type EventForm,
} from '../../src/editors/parts/eventForm';
import { blockSaveActions, blockToForm, blockWarnings, formToBlock, validateBlockForm } from '../../src/editors/parts/blockForm';
import { newReferenceRow } from '../../src/editors/parts/references';
import { composeDateTime, errorFor, findCycle, keepDefault, partsOf, takenIds, urlProblem, wouldCycle } from '../../src/editors/parts/common';
import { applyActions, newValidationErrors } from '../../src/editors/parts/commit';

const NOW = '2026-10-07T12:00:00';
const TODAY = '2026-10-07';

function loadExample(): ScheduleDocument {
  const text = readFileSync(new URL('../../examples/complete-schedule.json', import.meta.url), 'utf8');
  const result = validateDocument(JSON.parse(text), { today: TODAY });
  if (!result.ok || !result.doc) throw new Error(`example invalid: ${JSON.stringify(result.errors.slice(0, 3))}`);
  return result.doc;
}

const example = loadExample();

function messages(problems: Array<{ key: string; message: string }>): Record<string, string> {
  return Object.fromEntries(problems.map((p) => [p.key, p.message]));
}

function stateOf(doc: ScheduleDocument): AppState {
  return initialState(doc);
}

// ---------------------------------------------------------------------------
// Round trips: opening and saving an item without edits changes nothing
// ---------------------------------------------------------------------------

describe('round trips keep every item exactly as it was', () => {
  it('classes', () => {
    for (const item of example.classes) {
      const form = classToForm(item);
      expect(validateClassForm(form)).toEqual([]);
      expect(stableStringify(formToClass(form, item, form))).toBe(stableStringify(item));
    }
  });

  it('assignments (with tasks and references)', () => {
    for (const item of example.assignments) {
      const form = assignmentToForm(item);
      expect(validateAssignmentForm(form, example, item.id)).toEqual([]);
      expect(stableStringify(formToAssignment(form, item, NOW))).toBe(stableStringify(item));
    }
  });

  it('events and availability', () => {
    for (const item of example.events) {
      const form = eventToForm(item, TODAY);
      expect(validateEventForm(form, example)).toEqual([]);
      expect(stableStringify(formToEvent(form, item))).toBe(stableStringify(item));
    }
    for (const item of example.availability) {
      const form = availabilityToForm(item, TODAY);
      expect(validateAvailabilityForm(form)).toEqual([]);
      expect(stableStringify(formToAvailability(form, item))).toBe(stableStringify(item));
    }
  });

  it('schedule blocks', () => {
    for (const item of example.scheduleBlocks) {
      const form = blockToForm(item, TODAY);
      const editable = (item.origin ?? 'generated') === 'user';
      expect(validateBlockForm(form, example, { descriptionEditable: editable })).toEqual([]);
      expect(stableStringify(formToBlock(form, item, NOW, { descriptionEditable: editable }))).toBe(stableStringify(item));
    }
  });

  it('saving an unedited generated item records no overrides', () => {
    const generated = example.assignments.find((a) => (a.origin ?? 'generated') === 'generated')!;
    const item = formToAssignment(assignmentToForm(generated), generated, NOW);
    const next = reducer(stateOf(example), { type: 'upsertAssignment', item, now: NOW });
    const saved = next.doc.assignments.find((a) => a.id === generated.id)!;
    expect(saved.overrides ?? []).toEqual(generated.overrides ?? []);
    expect(newValidationErrors(stateOf(example), [{ type: 'upsertAssignment', item, now: NOW }])).toEqual([]);
  });

  it('keeps x- properties, sources, issues and fields the form does not show', () => {
    const item: Assignment = {
      id: 'gc-1',
      origin: 'generated',
      title: 'Lab report',
      due: '2026-10-16T23:59',
      estimatedMinutes: 90,
      estimateRange: { min: 60, max: 120, 'x-note': 1 } as Assignment['estimateRange'],
      estimateConfidence: 'low',
      estimateBasis: 'Two pages',
      sourceState: 'missing',
      source: { kind: 'google_classroom', id: 'abc' },
      issues: [{ kind: 'ambiguity', message: 'Unclear length' }],
      references: [{ title: 'Rubric', path: 'Bio/rubric.pdf', 'x-size': 12 } as Assignment['references'] extends Array<infer R> | undefined ? R : never],
      tasks: [{ id: 'gc-1-t1', title: 'Collect data', 'x-k': true } as never],
      ['x-tool' as const]: { a: 1 },
    } as Assignment;
    const form = assignmentToForm(item);
    form.title = 'Lab report (final)';
    const out = formToAssignment(form, item, NOW) as Assignment & Record<string, unknown>;
    expect(out.title).toBe('Lab report (final)');
    expect(out['x-tool']).toEqual({ a: 1 });
    expect(out.source).toEqual(item.source);
    expect(out.issues).toEqual(item.issues);
    expect(out.sourceState).toBe('missing');
    expect(out.estimateBasis).toBe('Two pages');
    expect(out.estimateRange).toEqual(item.estimateRange);
    expect(out.due).toBe('2026-10-16T23:59'); // same moment: original string kept
    expect((out.references![0] as unknown as Record<string, unknown>)['x-size']).toBe(12);
    expect(out.references![0].path).toBe('Bio/rubric.pdf');
    expect((out.tasks![0] as unknown as Record<string, unknown>)['x-k']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defaults, dates, completion
// ---------------------------------------------------------------------------

describe('defaults and values', () => {
  it('keeps defaults absent unless the item had them', () => {
    expect(keepDefault(undefined, 'homework', 'homework')).toBeUndefined();
    expect(keepDefault('homework', 'homework', 'homework')).toBe('homework');
    expect(keepDefault(undefined, 'reading', 'homework')).toBe('reading');
    const out = formToAssignment(assignmentToForm({ title: 'X' }), { id: 'u-asg-1', title: 'X', origin: 'user' }, NOW);
    expect(out).toEqual({ id: 'u-asg-1', title: 'X', origin: 'user' });
  });

  it('composes a date with an optional time', () => {
    expect(composeDateTime({ date: '2026-10-16', time: '' }, undefined)).toBe('2026-10-16');
    expect(composeDateTime({ date: '2026-10-16', time: '23:59' }, undefined)).toBe('2026-10-16T23:59:00');
    expect(composeDateTime({ date: '', time: '' }, '2026-10-16')).toBeUndefined();
    expect(partsOf('2026-10-16T09:30:00')).toEqual({ date: '2026-10-16', time: '09:30' });
  });

  it('sets completedAt when work becomes done and removes it otherwise', () => {
    const base: Assignment = { id: 'a', title: 'A', origin: 'user', tasks: [{ id: 't', title: 'T' }] };
    const form = assignmentToForm(base);
    form.status = 'done';
    form.tasks[0].status = 'done';
    const done = formToAssignment(form, base, NOW);
    expect(done).toMatchObject({ status: 'done', completedAt: NOW });
    expect(done.tasks![0]).toMatchObject({ status: 'done', completedAt: NOW });
    // Already done: keep the original timestamp.
    const again = formToAssignment(assignmentToForm(done), done, '2026-10-09T08:00:00');
    expect(again.completedAt).toBe(NOW);
    const reopened = assignmentToForm(done);
    reopened.status = 'in_progress';
    expect(formToAssignment(reopened, done, NOW).completedAt).toBeUndefined();
  });

  it('adds up subtask estimates without cancelled ones', () => {
    const rows = [newTaskRow('a'), newTaskRow('b'), newTaskRow('c')];
    rows[0].estimatedMinutes = 30;
    rows[1].estimatedMinutes = 45;
    rows[2].estimatedMinutes = 60;
    rows[2].status = 'cancelled';
    expect(taskEstimateTotal(rows)).toBe(75);
    expect(taskEstimateTotal([newTaskRow('x')])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('class validation', () => {
  it('requires a name and enforces lengths, colors and links', () => {
    const form = classToForm(undefined);
    form.name = '   ';
    form.room = 'x'.repeat(101);
    form.color = 'blue';
    form.topicsText = Array.from({ length: 201 }, (_, i) => `T${i}`).join('\n');
    const ref = newReferenceRow();
    ref.url = 'javascript:alert(1)';
    form.references = [ref];
    const m = messages(validateClassForm(form));
    expect(m.name).toBe('Name is required.');
    expect(m.room).toMatch(/at most 100/);
    expect(m.color).toMatch(/#2563EB/);
    expect(m.topics).toMatch(/200 topics/);
    expect(m[`references.${ref.key}.title`]).toBe('Title is required.');
    expect(m[`references.${ref.key}.url`]).toMatch(/http/);
  });

  it('counts lengths in code points', () => {
    const form = classToForm(undefined);
    form.name = '😀'.repeat(200);
    expect(validateClassForm(form)).toEqual([]);
    form.name = '😀'.repeat(201);
    expect(messages(validateClassForm(form)).name).toMatch(/201 characters/);
  });

  it('shows required errors only after a save attempt', () => {
    const problems = validateClassForm(classToForm(undefined));
    expect(errorFor(problems, 'name', false)).toBeNull();
    expect(errorFor(problems, 'name', true)).toBe('Name is required.');
  });

  it('writes an automatic color as absent and trims text', () => {
    const base: SchoolClass = { id: 'u-cls-1', name: 'Old', origin: 'user', color: '#2563EB' };
    const form = classToForm(base);
    form.name = '  Biology  ';
    form.color = '';
    form.topicsText = 'Cells\n\n  Genetics \n';
    const out = formToClass(form, base, classToForm(base));
    expect(out).toEqual({ id: 'u-cls-1', name: 'Biology', origin: 'user', topics: ['Cells', 'Genetics'] });
  });
});

describe('reference links', () => {
  it('accepts only absolute http(s) URLs, as the format does', () => {
    expect(urlProblem('')).toBeNull();
    expect(urlProblem('https://classroom.google.com/c/abc')).toBeNull();
    expect(urlProblem('HTTP://example.com/x')).toBeNull();
    expect(urlProblem('mailto:teacher@example.com')).toMatch(/mailto/);
    expect(urlProblem('javascript:alert(1)')).not.toBeNull();
    expect(urlProblem('data:text/html,hi')).not.toBeNull();
    expect(urlProblem('/relative/path')).not.toBeNull();
    expect(urlProblem('https://exa mple.com')).not.toBeNull();
    expect(urlProblem(`https://example.com/${'a'.repeat(2000)}`)).toMatch(/too long/);
  });
});

describe('assignment validation', () => {
  const doc: ScheduleDocument = {
    ...emptyDocument(),
    classes: [{ id: 'c1', name: 'English' }],
    assignments: [
      { id: 'a1', title: 'Read', dependsOn: ['a2'] },
      { id: 'a2', title: 'Quiz' },
      { id: 'a3', title: 'Essay', estimatedMinutes: 100, estimateRange: { min: 90, max: 120 } },
    ],
  };

  function form(partial: Partial<AssignmentForm> = {}): AssignmentForm {
    return { ...assignmentToForm({ title: 'Essay' }), ...partial };
  }

  it('orders the target date before the due date (or the assessment date)', () => {
    let m = messages(validateAssignmentForm(form({ due: { date: '2026-10-16', time: '' }, recommendedCompletionDate: { date: '2026-10-17', time: '' } }), doc, 'new'));
    expect(m.recommendedCompletionDate).toMatch(/due date/);
    // Date-only vs date-time on the same day count as equal (§ 13.3).
    m = messages(validateAssignmentForm(form({ due: { date: '2026-10-16', time: '' }, recommendedCompletionDate: { date: '2026-10-16', time: '20:00' } }), doc, 'new'));
    expect(m.recommendedCompletionDate).toBeUndefined();
    m = messages(validateAssignmentForm(form({ assessmentDate: { date: '2026-10-20', time: '' }, recommendedCompletionDate: { date: '2026-10-21', time: '' } }), doc, 'new'));
    expect(m.recommendedCompletionDate).toMatch(/assessment date/);
  });

  it('checks dates, times and estimates', () => {
    const m = messages(
      validateAssignmentForm(form({ due: { date: '', time: '10:00' }, assessmentDate: { date: '2026-02-30', time: '' }, estimatedMinutes: 10001 }), doc, 'new'),
    );
    expect(m.due).toMatch(/choose a date/);
    expect(m.assessmentDate).toMatch(/not a valid date/);
    expect(m.estimatedMinutes).toMatch(/between 0 and 10000/);
    expect(messages(validateAssignmentForm(form({ estimatedMinutes: 12.5 }), doc, 'new')).estimatedMinutes).toMatch(/whole number/);
  });

  it('keeps the estimate inside its range unless the range is removed', () => {
    const base = assignmentToForm(doc.assignments[2]);
    expect(validateAssignmentForm(base, doc, 'a3')).toEqual([]);
    expect(messages(validateAssignmentForm({ ...base, estimatedMinutes: 150 }, doc, 'a3')).estimatedMinutes).toMatch(/90–120/);
    expect(messages(validateAssignmentForm({ ...base, estimatedMinutes: '' }, doc, 'a3')).estimatedMinutes).toMatch(/needs an estimate/);
    expect(validateAssignmentForm({ ...base, estimatedMinutes: 150, removeRange: true }, doc, 'a3')).toEqual([]);
    const out = formToAssignment({ ...base, estimatedMinutes: 150, removeRange: true }, doc.assignments[2], NOW);
    expect(out.estimateRange).toBeUndefined();
    expect(out.estimatedMinutes).toBe(150);
  });

  it('rejects self-dependencies and cycles between assignments', () => {
    expect(messages(validateAssignmentForm(form({ dependsOn: ['a2'] }), doc, 'a2')).dependsOn).toMatch(/itself/);
    // a1 depends on a2; a2 depending on a1 would be a loop.
    expect(messages(validateAssignmentForm(form({ dependsOn: ['a1'] }), doc, 'a2')).dependsOn).toMatch(/loop/);
    expect(validateAssignmentForm(form({ dependsOn: ['a2'] }), doc, 'a4')).toEqual([]);
    expect(messages(validateAssignmentForm(form({ dependsOn: ['gone'] }), doc, 'a4')).dependsOn).toMatch(/no longer exists/);
  });

  it('checks subtasks: title, date order, due ≤ assignment due, dependencies', () => {
    const t1 = newTaskRow('t1', 'Outline');
    const t2 = newTaskRow('t2', '');
    t1.due = { date: '2026-10-17', time: '' };
    t1.recommendedCompletionDate = { date: '2026-10-18', time: '' };
    t1.recommendedStartDate = '2026-10-19';
    t1.dependsOn = ['t2'];
    t2.dependsOn = ['t1'];
    const m = messages(validateAssignmentForm(form({ due: { date: '2026-10-16', time: '23:59' }, tasks: [t1, t2] }), doc, 'new'));
    expect(m['tasks.t1.due']).toMatch(/after the assignment’s due date/);
    expect(m['tasks.t1.recommendedCompletionDate']).toMatch(/subtask’s due date/);
    expect(m['tasks.t1.recommendedStartDate']).toMatch(/target date/);
    expect(m['tasks.t1.dependsOn']).toMatch(/loop/);
    expect(m['tasks.t2.title']).toBe('Title is required.');
  });

  it('lets subtask dates run up to the later of due and assessment date', () => {
    const t1 = newTaskRow('t1', 'Study');
    t1.recommendedCompletionDate = { date: '2026-10-19', time: '' };
    const ok = validateAssignmentForm(form({ due: { date: '2026-10-16', time: '' }, assessmentDate: { date: '2026-10-20', time: '' }, tasks: [t1] }), doc, 'new');
    expect(ok).toEqual([]);
    t1.recommendedCompletionDate = { date: '2026-10-21', time: '' };
    const bad = messages(validateAssignmentForm(form({ due: { date: '2026-10-16', time: '' }, assessmentDate: { date: '2026-10-20', time: '' }, tasks: [t1] }), doc, 'new'));
    expect(bad['tasks.t1.recommendedCompletionDate']).toMatch(/due and assessment dates/);
  });
});

describe('dependency graph helpers', () => {
  const graph = new Map([
    ['a', ['b']],
    ['b', ['c']],
    ['c', []],
  ]);
  it('detects cycles', () => {
    expect(wouldCycle(graph, 'c', 'a')).toBe(true);
    expect(wouldCycle(graph, 'a', 'c')).toBe(false);
    expect(wouldCycle(graph, 'a', 'a')).toBe(true);
    expect(findCycle(new Map([['x', ['y']], ['y', ['x']]]), 'x')).not.toBeNull();
    expect(findCycle(graph, 'a')).toBeNull();
  });
});

describe('events and availability', () => {
  const doc = { ...emptyDocument(), assignments: [{ id: 'exam', title: 'Exam', type: 'exam' as const }] };

  function eventForm(partial: Partial<EventForm>): EventForm {
    return { ...eventToForm({ title: 'Fencing' }, TODAY), ...partial };
  }

  it('requires a date or a weekly rule, and end after start (24:00 allowed)', () => {
    let m = messages(validateEventForm(eventForm({ date: '', startTime: '16:00', endTime: '16:00' }), doc));
    expect(m.date).toBe('Date is required.');
    expect(m.endTime).toMatch(/later than the start/);
    m = messages(validateEventForm(eventForm({ startTime: '23:00', endTime: '24:00' }), doc));
    expect(m.endTime).toBeUndefined();
    m = messages(
      validateEventForm(
        eventForm({ repeat: 'weekly', startTime: '16:00', endTime: '18:00', recurrence: { daysOfWeek: [], interval: 53, startDate: '2026-10-05', endDate: '2026-10-01', exceptDates: [] } }),
        doc,
      ),
    );
    expect(m['recurrence.daysOfWeek']).toMatch(/at least one day/);
    expect(m['recurrence.interval']).toMatch(/between 1 and 52/);
    expect(m['recurrence.endDate']).toMatch(/before the start date/);
  });

  it('all-day events drop their times; multi-day only for one-time all-day events', () => {
    const base: ScheduleEvent = { id: 'u-evt-1', title: 'Trip', date: '2026-10-12', startTime: '08:00', endTime: '15:00', origin: 'user' };
    const form = eventToForm(base, TODAY);
    form.allDay = true;
    form.endDate = '2026-10-14';
    expect(validateEventForm(form, doc)).toEqual([]);
    expect(formToEvent(form, base)).toEqual({ id: 'u-evt-1', title: 'Trip', date: '2026-10-12', endDate: '2026-10-14', allDay: true, origin: 'user' });
    form.endDate = '2026-10-11';
    expect(messages(validateEventForm(form, doc)).endDate).toMatch(/before the first day/);
  });

  it('switching to weekly drops date/endDate; the rule keeps its x- properties', () => {
    const base = {
      id: 'evt-1',
      title: 'Piano',
      origin: 'generated',
      startTime: '17:00',
      endTime: '18:00',
      recurrence: { frequency: 'weekly', daysOfWeek: ['wed'], startDate: '2026-09-02', 'x-src': 'cal' },
    } as unknown as ScheduleEvent;
    const form = eventToForm(base, TODAY);
    form.recurrence.exceptDates = ['2026-11-25', '2026-11-25', '2026-10-28'];
    form.recurrence.interval = 2;
    const out = formToEvent(form, base);
    expect(out.recurrence).toEqual({ frequency: 'weekly', daysOfWeek: ['wed'], interval: 2, startDate: '2026-09-02', exceptDates: ['2026-10-28', '2026-11-25'], 'x-src': 'cal' });
    expect(out.date).toBeUndefined();
    const once = { ...eventToForm(base, TODAY), repeat: 'once' as const, date: '2026-10-14' };
    const single = formToEvent(once, base);
    expect(single.recurrence).toBeUndefined();
    expect(single.date).toBe('2026-10-14');
  });

  it('links the sitting of an assessment and checks it exists', () => {
    const form = eventForm({ assignmentId: 'exam', startTime: '09:00', endTime: '11:00' });
    expect(validateEventForm(form, doc)).toEqual([]);
    expect(formToEvent(form, { id: 'u-evt-2', title: '', origin: 'user' }).assignmentId).toBe('exam');
    expect(messages(validateEventForm({ ...form, assignmentId: 'gone' }, doc)).assignmentId).toMatch(/no longer exists/);
  });

  it('warns about a rule that never occurs', () => {
    expect(recurrenceNeverOccurs({ daysOfWeek: ['mon'], interval: 1, startDate: '2026-10-13', endDate: '2026-10-18', exceptDates: [] })).toBe(true);
    expect(recurrenceNeverOccurs({ daysOfWeek: ['mon'], interval: 1, startDate: '2026-10-12', endDate: '2026-10-18', exceptDates: [] })).toBe(false);
    expect(recurrenceNeverOccurs({ daysOfWeek: ['mon'], interval: 1, startDate: '2026-10-12', endDate: '2026-10-18', exceptDates: ['2026-10-12'] })).toBe(true);
  });

  it('availability: one date or weekly, end after start', () => {
    const base: AvailabilityWindow = { id: 'u-avl-1', startTime: '15:30', endTime: '21:30', date: '2026-10-17', origin: 'user' };
    const form = availabilityToForm(base, TODAY);
    expect(form.repeat).toBe('once');
    form.repeat = 'weekly';
    form.recurrence = { daysOfWeek: ['mon', 'fri'], interval: 1, startDate: '2026-10-05', endDate: '', exceptDates: [] };
    form.label = ' After school ';
    expect(formToAvailability(form, base)).toEqual({
      id: 'u-avl-1',
      label: 'After school',
      startTime: '15:30',
      endTime: '21:30',
      recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'fri'], startDate: '2026-10-05' },
      origin: 'user',
    });
    expect(messages(validateAvailabilityForm({ ...form, startTime: '21:30', endTime: '15:30' })).endTime).toMatch(/later/);
  });
});

describe('schedule blocks', () => {
  const doc: ScheduleDocument = {
    ...emptyDocument(),
    assignments: [
      { id: 'a1', title: 'Essay', due: '2026-10-13', tasks: [{ id: 't1', title: 'Outline', due: '2026-10-12T18:00:00' }] },
      { id: 'a2', title: 'Other' },
    ],
    scheduleBlocks: [
      { id: 'b-gen', assignmentId: 'a1', start: '2026-10-12T16:00:00', end: '2026-10-12T16:45:00', origin: 'generated', description: 'Outline' },
      { id: 'b-user', title: 'Flashcards', start: '2026-10-12T17:00:00', end: '2026-10-12T17:30:00', origin: 'user' },
    ],
  };

  it('needs at least 5 minutes, an assignment or a title, a matching subtask', () => {
    const form = blockToForm({ start: '2026-10-12T16:00:00', end: '2026-10-12T16:03:00' }, TODAY);
    let m = messages(validateBlockForm(form, doc, { descriptionEditable: true }));
    expect(m.endTime).toMatch(/at least 5 minutes/);
    expect(m.title).toMatch(/assignment or enter a title/);
    m = messages(validateBlockForm({ ...form, endTime: '17:00', assignmentId: 'a2', taskId: 't1' }, doc, { descriptionEditable: true }));
    expect(m.taskId).toMatch(/not part of/);
  });

  it('a break needs a title and never keeps an assignment', () => {
    const base = doc.scheduleBlocks[1];
    const form = { ...blockToForm(base, TODAY), kind: 'break' as const, assignmentId: 'a1', title: '' };
    expect(messages(validateBlockForm(form, doc, { descriptionEditable: true })).title).toBe('Title is required.');
    const out = formToBlock({ ...form, title: 'Break' }, base, NOW, { descriptionEditable: true });
    expect(out.kind).toBe('break');
    expect(out.assignmentId).toBeUndefined();
  });

  it('a block ending at midnight ends at 00:00 of the next day', () => {
    const form = { ...blockToForm(undefined, '2026-10-12'), startTime: '23:00', endTime: '24:00', title: 'Late review' };
    const out = formToBlock(form, { id: 'u-blk-1', start: '', end: '', origin: 'user' }, NOW, { descriptionEditable: true });
    expect(out.start).toBe('2026-10-12T23:00:00');
    expect(out.end).toBe('2026-10-13T00:00:00');
    expect(blockToForm(out, TODAY).endTime).toBe('24:00');
  });

  it('marks done with completedAt; keeps generator-owned description read-only', () => {
    const base = doc.scheduleBlocks[0];
    const form = { ...blockToForm(base, TODAY), status: 'done' as const, description: 'changed', notes: 'went well' };
    const out = formToBlock(form, base, NOW, { descriptionEditable: false });
    expect(out).toMatchObject({ status: 'done', completedAt: NOW, description: 'Outline', notes: 'went well' });
  });

  it('moving a generated block pins it and records no start/end overrides', () => {
    const base = doc.scheduleBlocks[0];
    const form = { ...blockToForm(base, TODAY), startTime: '16:30', endTime: '17:15', notes: 'moved' };
    const item = formToBlock(form, base, NOW, { descriptionEditable: false });
    const actions = blockSaveActions(item, base);
    expect(actions.map((a) => a.type)).toEqual(['moveBlock', 'upsertBlock']);
    const next = applyActions(stateOf(doc), actions);
    const saved = next.doc.scheduleBlocks.find((b) => b.id === 'b-gen')!;
    expect(saved).toMatchObject({ start: '2026-10-12T16:30:00', end: '2026-10-12T17:15:00', locked: true, notes: 'moved' });
    expect(saved.overrides).toBeUndefined();
  });

  it('a user block is saved with one upsert; a new block is a user block', () => {
    const base = doc.scheduleBlocks[1];
    const item = formToBlock({ ...blockToForm(base, TODAY), startTime: '18:00', endTime: '18:30' }, base, NOW, { descriptionEditable: true });
    expect(blockSaveActions(item, base).map((a) => a.type)).toEqual(['upsertBlock']);
    const created = blockSaveActions({ id: 'u-blk-2', title: 'X', start: '2026-10-12T10:00:00', end: '2026-10-12T11:00:00' }, undefined);
    expect(created).toEqual([{ type: 'upsertBlock', item: { id: 'u-blk-2', title: 'X', start: '2026-10-12T10:00:00', end: '2026-10-12T11:00:00', origin: 'user' } }]);
  });

  it('warns when a session ends after its due date or its subtask’s due date', () => {
    const form = { ...blockToForm(undefined, '2026-10-12'), assignmentId: 'a1', taskId: 't1', startTime: '17:30', endTime: '18:30' };
    const warnings = blockWarnings(form, doc);
    // Date-only due Oct 13 with the default due time 00:00 → due at the start of Oct 13: fine.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/subtask “Outline” is due/);
    expect(blockWarnings({ ...form, date: '2026-10-13', taskId: '' }, doc)[0]).toMatch(/after the assignment is due/);
  });
});

describe('saving on top of the latest stored item', () => {
  it('a subtask is saved on top of its current stored version (cleared overrides stay cleared)', () => {
    const task = { id: 'gc-a-t1', title: 'Outline', overrides: ['title'], origin: 'generated' as const, 'x-k': 1 };
    const opened: Assignment = { id: 'gc-a', title: 'Essay', origin: 'generated', overrides: ['title'], tasks: [task] };
    const form = assignmentToForm(opened);
    // Meanwhile "Allow /academic-schedule to update this again" cleared the overrides.
    const now: Assignment = { id: 'gc-a', title: 'Essay', origin: 'generated', tasks: [{ id: 'gc-a-t1', title: 'Outline', origin: 'generated', 'x-k': 1 } as never] };
    const saved = formToAssignment({ ...form, priority: 'high' }, now, NOW);
    expect(saved.overrides).toBeUndefined();
    expect(saved.tasks).toEqual([{ id: 'gc-a-t1', title: 'Outline', origin: 'generated', 'x-k': 1 }]);
    // A task added in the form (no stored version) is saved as a new task.
    const added = formToAssignment({ ...form, tasks: [...form.tasks, newTaskRow('u-tsk-new', 'Draft')] }, now, NOW);
    expect(added.tasks![1]).toEqual({ id: 'u-tsk-new', title: 'Draft' });
  });

  it('new IDs avoid every item, task and deleted ID', () => {
    const doc: ScheduleDocument = {
      ...emptyDocument(),
      assignments: [{ id: 'a1', title: 'A', tasks: [{ id: 't1', title: 'T' }] }],
      deleted: [{ id: 'gone-1', collection: 'events', deletedAt: NOW }],
    };
    expect([...takenIds(doc)].sort()).toEqual(['a1', 'gone-1', 't1']);
  });
});

describe('final document check', () => {
  it('reports only the errors an edit would add', () => {
    const doc: ScheduleDocument = { ...emptyDocument(), classes: [{ id: 'c1', name: 'English', origin: 'user' }] };
    expect(newValidationErrors(stateOf(doc), [{ type: 'upsertClass', item: { id: 'c1', name: 'English 10', origin: 'user' } }])).toEqual([]);
    const bad = newValidationErrors(stateOf(doc), [{ type: 'upsertClass', item: { id: 'c1', name: '', origin: 'user', color: 'red' } }]);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.every((e) => e.path.startsWith('classes[0]'))).toBe(true);
  });
});
