import { describe, expect, it } from 'vitest';
import { changedFields, emptyDocument, initialState, reducer, type AppState } from '../../src/state/reducer';
import type { Assignment, ScheduleDocument } from '../../src/model/types';

const NOW = '2026-10-07T12:00:00';

function stateWith(partial: Partial<ScheduleDocument>): AppState {
  return initialState({ ...emptyDocument(), ...partial });
}

const essay: Assignment = {
  id: 'gc-essay',
  origin: 'generated',
  title: 'Othello essay',
  due: '2026-10-16T23:59:00',
  priority: 'medium',
  source: { kind: 'google_classroom', id: 'essay' },
  tasks: [
    { id: 'gc-essay-t1', title: 'Outline', estimatedMinutes: 30 },
    { id: 'gc-essay-t2', title: 'Draft', estimatedMinutes: 120 },
  ],
};

describe('reducer', () => {
  it('creates new items as user items', () => {
    const next = reducer(initialState(), { type: 'upsertClass', item: { id: 'u-cls-1', name: 'Biology' } });
    expect(next.doc.classes[0].origin).toBe('user');
  });

  it('records overrides when a generated item is edited, without locking it', () => {
    const state = stateWith({ assignments: [essay] });
    const next = reducer(state, { type: 'upsertAssignment', item: { ...essay, priority: 'urgent', due: '2026-10-15' }, now: NOW });
    const a = next.doc.assignments[0];
    expect(a.overrides).toEqual(['due', 'priority']);
    expect(a.locked).toBeUndefined();
    expect(a.origin).toBe('generated');
  });

  it('does not record overrides for status or notes changes', () => {
    const state = stateWith({ assignments: [essay] });
    const next = reducer(state, { type: 'upsertAssignment', item: { ...essay, status: 'in_progress', notes: 'started' }, now: NOW });
    expect(next.doc.assignments[0].overrides).toBeUndefined();
  });

  it('records task-level overrides, marks added tasks as user, and tombstones removed generated tasks', () => {
    const state = stateWith({
      assignments: [essay],
      scheduleBlocks: [{ id: 'blk-1', start: '2026-10-08T16:00:00', end: '2026-10-08T16:30:00', assignmentId: 'gc-essay', taskId: 'gc-essay-t2' }],
    });
    const edited: Assignment = {
      ...essay,
      tasks: [{ ...essay.tasks![0], estimatedMinutes: 45 }, { id: 'u-tsk-1', title: 'Proofread' }],
    };
    const next = reducer(state, { type: 'upsertAssignment', item: edited, now: NOW });
    const tasks = next.doc.assignments[0].tasks!;
    expect(tasks[0].overrides).toEqual(['estimatedMinutes']);
    expect(tasks[1].origin).toBe('user');
    expect(next.doc.assignments[0].overrides).toBeUndefined();
    expect(next.doc.deleted).toEqual([{ id: 'gc-essay-t2', collection: 'tasks', deletedAt: NOW, title: 'Draft' }]);
    expect(next.doc.scheduleBlocks[0].taskId).toBeUndefined();
  });

  it('tombstones deleted generated assignments and removes their blocks and links', () => {
    const other: Assignment = { id: 'u-asg-1', origin: 'user', title: 'Other', dependsOn: ['gc-essay'] };
    const state = stateWith({
      assignments: [essay, other],
      scheduleBlocks: [{ id: 'blk-1', start: '2026-10-08T16:00:00', end: '2026-10-08T16:30:00', assignmentId: 'gc-essay' }],
      issues: [{ kind: 'conflict', message: 'x', itemId: 'gc-essay' }],
    });
    const next = reducer(state, { type: 'deleteAssignment', id: 'gc-essay', now: NOW });
    expect(next.doc.assignments.map((a) => a.id)).toEqual(['u-asg-1']);
    expect(next.doc.assignments[0].dependsOn).toBeUndefined();
    expect(next.doc.scheduleBlocks).toEqual([]);
    expect(next.doc.issues).toBeUndefined();
    expect(next.doc.deleted?.map((d) => d.id)).toEqual(['gc-essay', 'gc-essay-t1', 'gc-essay-t2']);
    expect(next.doc.deleted?.[0].sourceId).toBe('essay');
  });

  it('does not tombstone user items', () => {
    const state = stateWith({ events: [{ id: 'u-evt-1', origin: 'user', title: 'Piano', date: '2026-10-08', startTime: '17:00', endTime: '18:00' }] });
    const next = reducer(state, { type: 'deleteEvent', id: 'u-evt-1', now: NOW });
    expect(next.doc.events).toEqual([]);
    expect(next.doc.deleted).toBeUndefined();
  });

  it('locks generated and planner blocks when moved, but not user blocks', () => {
    const state = stateWith({
      scheduleBlocks: [
        { id: 'blk-g', origin: 'generated', start: '2026-10-08T16:00:00', end: '2026-10-08T17:00:00', title: 'A' },
        { id: 'u-blk-p', origin: 'planner', start: '2026-10-08T17:00:00', end: '2026-10-08T18:00:00', title: 'B' },
        { id: 'u-blk-u', origin: 'user', start: '2026-10-08T18:00:00', end: '2026-10-08T19:00:00', title: 'C' },
      ],
    });
    let next = state;
    for (const id of ['blk-g', 'u-blk-p', 'u-blk-u']) {
      next = reducer(next, { type: 'moveBlock', id, start: '2026-10-09T16:00:00', end: '2026-10-09T17:00:00' });
    }
    expect(next.doc.scheduleBlocks.map((b) => b.locked)).toEqual([true, true, undefined]);
  });

  it('sets and clears completedAt with status', () => {
    const state = stateWith({ assignments: [essay] });
    const done = reducer(state, { type: 'setAssignmentStatus', id: 'gc-essay', status: 'done', now: NOW });
    expect(done.doc.assignments[0].completedAt).toBe(NOW);
    const again = reducer(done, { type: 'setAssignmentStatus', id: 'gc-essay', status: 'done', now: '2026-10-08T09:00:00' });
    expect(again.doc.assignments[0].completedAt).toBe(NOW);
    const reopened = reducer(again, { type: 'setAssignmentStatus', id: 'gc-essay', status: 'in_progress', now: NOW });
    expect(reopened.doc.assignments[0].completedAt).toBeUndefined();
  });

  it('changes issue status on items and at the root', () => {
    const state = stateWith({
      assignments: [{ ...essay, issues: [{ id: 'i1', kind: 'conflict', message: 'm' }] }],
      issues: [{ kind: 'workload', message: 'busy', date: '2026-10-08' }],
    });
    let next = reducer(state, { type: 'setIssueStatus', scope: { collection: 'assignments', id: 'gc-essay' }, index: 0, status: 'resolved' });
    next = reducer(next, { type: 'setIssueStatus', scope: null, index: 0, status: 'dismissed' });
    expect(next.doc.assignments[0].issues?.[0].status).toBe('resolved');
    expect(next.doc.issues?.[0].status).toBe('dismissed');
    next = reducer(next, { type: 'setIssueStatus', scope: null, index: 0, status: 'open' });
    expect(next.doc.issues?.[0].status).toBeUndefined();
  });

  it('keeps up to 5 snapshots and undoes to the latest', () => {
    let state = initialState();
    for (let i = 0; i < 7; i++) {
      state = reducer(state, { type: 'replaceDocument', doc: { ...emptyDocument(), meta: { title: `v${i}` } }, label: `import ${i}`, now: NOW, snapshotId: `s${i}` });
    }
    expect(state.snapshots).toHaveLength(5);
    const undone = reducer(state, { type: 'undo' });
    expect(undone.doc.meta?.title).toBe('v5');
  });

  it('compares fields ignoring empty values and key order', () => {
    expect(changedFields({ a: [], b: { x: 1, y: 2 } }, { b: { y: 2, x: 1 } })).toEqual([]);
    expect(changedFields({ title: 'A' }, { title: 'B', status: 'done' })).toEqual(['title']);
  });
});
