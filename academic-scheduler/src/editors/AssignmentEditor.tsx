// Create, edit and delete an assignment (SCHEDULE_FORMAT.md § 8): title,
// class, type, topic, the three different dates (due, assessment, target),
// estimate, priority, status, points, required, description and notes,
// subtasks (§ 9), references (§ 8.2) and prerequisites (dependsOn, without
// cycles). Estimate details from /academic-schedule (range, confidence,
// basis) are shown read-only.
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Assignment, AssignmentType, Priority, WorkStatus } from '../model/types';
import type { EditorProps } from './EditorHost';
import type { Action } from '../state/reducer';
import {
  ASSESSMENT_TYPES,
  ASSIGNMENT_TYPES,
  ASSIGNMENT_TYPE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  SOURCE_STATE_LABELS,
  WORK_STATUSES,
  WORK_STATUS_LABELS,
  resolveSettings,
} from '../model/constants';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { Checkbox, SelectField, TextArea, TextField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import { newId } from '../lib/ids';
import { formatDuration, formatTime12, nowLocal } from '../lib/time';
import { compact, takenIds, wouldCycle } from './parts/common';
import { assignmentGraph, assignmentToForm, formToAssignment, taskEstimateTotal, validateAssignmentForm, type AssignmentForm } from './parts/assignmentForm';
import { EditorFrame, Section, useEditorForm, useSaveFlow } from './parts/EditorFrame';
import { ItemPanel } from './parts/ItemPanel';
import { MissingItem } from './parts/MissingItem';
import { ReferencesEditor } from './parts/ReferencesEditor';
import { TasksEditor } from './parts/TasksEditor';
import { ChipPicker, DateTimeInput, MinutesInput, SuggestInput, classOptions } from './parts/inputs';
import { assignmentLabel } from './parts/options';
import { newValidationErrors } from './parts/commit';
import { plural } from './parts/labels';

export function AssignmentEditor(props: EditorProps<Assignment>) {
  const { state } = useStore();
  const stored = props.id ? state.doc.assignments.find((a) => a.id === props.id) : undefined;
  if (props.id && !stored) return <MissingItem itemLabel="assignment" onClose={props.onClose} />;
  return <AssignmentEditorForm {...props} stored={stored} />;
}

const CONFIDENCE_LABELS = { low: 'low confidence', medium: 'medium confidence', high: 'high confidence' } as const;

function AssignmentEditorForm({ id, initial, onClose, stored }: EditorProps<Assignment> & { stored?: Assignment }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const confirm = useConfirm();
  const [itemId] = useState(() => id ?? newId('asg', takenIds(doc)));
  const usedIds = useRef<Set<string> | null>(null);
  const newTaskId = useCallback(() => {
    if (!usedIds.current) usedIds.current = new Set([...takenIds(doc), itemId]);
    return newId('tsk', usedIds.current);
  }, [doc, itemId]);

  const validate = useCallback((form: AssignmentForm) => validateAssignmentForm(form, doc, itemId), [doc, itemId]);
  const editor = useEditorForm<AssignmentForm>(() => assignmentToForm(stored ?? initial), validate);
  const { form, set, error } = editor;
  const flow = useSaveFlow(editor);

  const settings = resolveSettings(doc.settings);
  const cls = form.classId ? doc.classes.find((c) => c.id === form.classId) : undefined;
  const taskTotal = taskEstimateTotal(form.tasks);
  const isAssessment = ASSESSMENT_TYPES.includes(form.type);

  const blockCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of doc.scheduleBlocks) {
      if (b.assignmentId === itemId && b.taskId) map.set(b.taskId, (map.get(b.taskId) ?? 0) + 1);
    }
    return map;
  }, [doc.scheduleBlocks, itemId]);

  const storedTasks = useMemo(() => new Map((stored?.tasks || []).map((t) => [t.id, t])), [stored]);

  const graph = assignmentGraph(doc, itemId, form.dependsOn);
  const prerequisiteOptions = doc.assignments
    .filter((a) => a.id !== itemId)
    .map((a) => ({
      id: a.id,
      label: assignmentLabel(doc, a, { withDate: true }),
      disabledReason: wouldCycle(graph, itemId, a.id) ? 'depends on this one' : undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const save = () => {
    if (editor.problems.length) return flow.fail();
    const base: Assignment = stored ?? compact<Assignment>({ ...(initial as Assignment), id: itemId, origin: 'user', overrides: undefined, locked: undefined });
    const now = nowLocal();
    const item = formToAssignment(form, base, now);
    const actions: Action[] = [{ type: 'upsertAssignment', item, now }];
    const extra = newValidationErrors(state, actions);
    if (extra.length) return flow.fail(extra.map((e) => `${e.message} (${e.path})`));
    actions.forEach(dispatch);
    notify(stored ? `Saved “${item.title}”.` : `Added “${item.title}”.`, { tone: 'success' });
    onClose();
  };

  const remove = async () => {
    if (!stored) return;
    const blocks = doc.scheduleBlocks.filter((b) => b.assignmentId === stored.id);
    const done = blocks.filter((b) => b.status === 'done').length;
    const sittings = doc.events.filter((e) => e.assignmentId === stored.id);
    const generated = (stored.origin ?? 'generated') === 'generated';
    const consequences: string[] = [];
    if (stored.tasks?.length) consequences.push(plural(stored.tasks.length, 'subtask'));
    if (blocks.length) consequences.push(`${plural(blocks.length, 'scheduled session')}${done ? ` (${done} marked done)` : ''}`);
    if (sittings.length) consequences.push(sittings.length === 1 ? `the linked event “${sittings[0].title}”` : `${sittings.length} linked events`);
    const ok = await confirm({
      title: 'Delete assignment?',
      message: (
        <>
          <p style={{ marginTop: 0 }}>
            Delete “{stored.title}”{consequences.length ? `, with its ${consequences.join(', ')}` : ''}?
          </p>
          {done ? <p className="small">Sessions marked done are deleted too, so they no longer count as work you have done.</p> : null}
          <p className="muted small" style={{ marginBottom: 0 }}>
            This cannot be undone.{generated ? ' /academic-schedule will not add it again.' : ''}
            {!generated || stored.status === 'done' ? '' : ' To keep it but stop planning it, set its status to Cancelled instead.'}
          </p>
        </>
      ),
      confirmLabel: 'Delete assignment',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'deleteAssignment', id: stored.id, now: nowLocal() });
    notify(`Deleted “${stored.title}”.`, { tone: 'success' });
    onClose();
  };

  const dueHint =
    form.due.date && !form.due.time
      ? settings.defaultDueTime === '00:00'
        ? 'No time: planned to be finished by the end of the day before.'
        : `No time: planned as due at ${formatTime12(settings.defaultDueTime)}.`
      : 'When it must be handed in. Add a time if one is stated.';

  const range = stored?.estimateRange;

  return (
    <EditorFrame
      title={stored ? 'Edit assignment' : 'New assignment'}
      itemLabel="assignment"
      dirty={editor.dirty}
      onClose={onClose}
      onSave={save}
      onDelete={stored ? () => void remove() : undefined}
      saveLabel={stored ? 'Save' : 'Add assignment'}
      problems={flow.lines}
      attempt={flow.attempt}
      size="wide"
    >
      {stored ? <ItemPanel collection="assignments" id={stored.id} itemLabel="assignment" /> : null}
      {stored?.sourceState && stored.sourceState !== 'present' ? (
        <div className="banner warning" role="note">
          <Icon name="info" />
          <span>
            <strong>{SOURCE_STATE_LABELS[stored.sourceState]}.</strong>{' '}
            {stored.sourceState === 'withdrawn'
              ? 'The source removed, cancelled or excused this work.'
              : 'It was not found in a newer export of its source.'}{' '}
            It is not planned or counted in remaining work unless you set its status to In progress.
          </span>
        </div>
      ) : null}

      <div className="form-grid">
        <TextField className="span-2" label="Title" required autoFocus={!stored} value={form.title} onChange={(v) => set('title', v)} error={error('title')} placeholder="e.g. Othello essay" />
        <SelectField label="Class" value={form.classId} options={classOptions(doc.classes, form.classId)} onChange={(v) => set('classId', v)} error={error('classId')} />
        <SelectField<AssignmentType>
          label="Type"
          value={form.type}
          options={ASSIGNMENT_TYPES.map((t) => ({ value: t, label: ASSIGNMENT_TYPE_LABELS[t] }))}
          onChange={(v) => set('type', (v || 'homework') as AssignmentType)}
        />
        <SuggestInput label="Topic or unit" value={form.topic} onChange={(v) => set('topic', v)} suggestions={cls?.topics || []} error={error('topic')} />
        <SelectField<Priority>
          label="Priority"
          value={form.priority}
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          onChange={(v) => set('priority', (v || 'medium') as Priority)}
        />
      </div>

      <Section title="Dates" description="These are different dates: the due date is when it is handed in, the assessment date is when a quiz, test, exam or presentation takes place, and the target date is when you want to be done.">
        <div className="ed-grid-3">
          <DateTimeInput label="Due" value={form.due} onChange={(v) => set('due', v)} hint={dueHint} error={error('due')} />
          <DateTimeInput
            label="Assessment date"
            value={form.assessmentDate}
            onChange={(v) => set('assessmentDate', v)}
            hint={isAssessment ? 'When it takes place. Preparation is planned to end the day before when no time is given.' : 'Only for quizzes, tests, exams and presentations.'}
            error={error('assessmentDate')}
          />
          <DateTimeInput
            label="Target date"
            value={form.recommendedCompletionDate}
            onChange={(v) => set('recommendedCompletionDate', v)}
            hint="When you want to be finished (a goal, not a deadline)."
            error={error('recommendedCompletionDate')}
          />
        </div>
      </Section>

      <Section title="Workload and progress">
        <div className="form-grid">
          <div className="field">
            <MinutesInput
              label="Estimated total time"
              value={form.estimatedMinutes}
              onChange={(v) => set('estimatedMinutes', v)}
              error={error('estimatedMinutes')}
              hint={
                taskTotal !== null && taskTotal !== form.estimatedMinutes
                  ? `Subtasks add up to ${formatDuration(taskTotal)}${form.estimatedMinutes !== '' && form.estimatedMinutes < taskTotal ? ' (more than this estimate)' : ''}.`
                  : 'All the work, including what is already done.'
              }
            />
            {taskTotal !== null && taskTotal !== form.estimatedMinutes ? (
              <button type="button" className="btn ghost small ed-inline-btn" onClick={() => set('estimatedMinutes', taskTotal)}>
                Use subtask total ({formatDuration(taskTotal)})
              </button>
            ) : null}
          </div>
          <SelectField<WorkStatus>
            label="Status"
            value={form.status}
            options={WORK_STATUSES.map((s) => ({ value: s, label: WORK_STATUS_LABELS[s] }))}
            onChange={(v) => set('status', (v || 'not_started') as WorkStatus)}
            hint={form.status === 'cancelled' ? 'You will not do it (excused, dropped). It is no longer planned.' : undefined}
          />
          {range || stored?.estimateConfidence || stored?.estimateBasis ? (
            <div className="span-2 ed-estimate-info small">
              <div>
                <strong>Estimate from /academic-schedule:</strong>{' '}
                {range ? (form.removeRange ? <span className="strike">{`${formatDuration(range.min)} – ${formatDuration(range.max)}`}</span> : `${formatDuration(range.min)} – ${formatDuration(range.max)}`) : null}
                {range && stored?.estimateConfidence ? ' · ' : null}
                {stored?.estimateConfidence ? CONFIDENCE_LABELS[stored.estimateConfidence] : null}
              </div>
              {stored?.estimateBasis ? <div className="muted">{stored.estimateBasis}</div> : null}
              {range ? (
                <button type="button" className="btn ghost small" onClick={() => set('removeRange', !form.removeRange)}>
                  {form.removeRange ? 'Keep the range' : 'Remove the range'}
                </button>
              ) : null}
            </div>
          ) : null}
          <TextField label="Points or weight" value={form.points} onChange={(v) => set('points', v)} error={error('points')} placeholder="e.g. 100 points, 15% of grade" />
          <Checkbox
            label="Required"
            checked={form.required}
            onChange={(v) => set('required', v)}
            hint="Uncheck for optional or extra-credit work: it is not planned automatically or counted in remaining work."
          />
        </div>
      </Section>

      <Section title="Description and notes">
        <div className="form-grid">
          <TextArea className="span-2" label="Description" rows={4} value={form.description} onChange={(v) => set('description', v)} error={error('description')} placeholder="Instructions and requirements" />
          <TextArea className="span-2" label="Your notes" rows={3} value={form.notes} onChange={(v) => set('notes', v)} error={error('notes')} />
        </div>
      </Section>

      <Section title={form.tasks.length ? `Subtasks (${form.tasks.length})` : 'Subtasks'}>
        <TasksEditor rows={form.tasks} onChange={(rows) => set('tasks', rows)} error={error} newTaskId={newTaskId} blockCounts={blockCounts} stored={storedTasks} />
      </Section>

      <Section title="References" description="Attachments, links, readings, rubrics and templates.">
        <ReferencesEditor rows={form.references} onChange={(rows) => set('references', rows)} error={error} emptyText="No references." />
      </Section>

      <Section title="Prerequisites">
        <ChipPicker
          label="Finish these assignments first"
          selected={form.dependsOn}
          options={prerequisiteOptions}
          onChange={(ids) => set('dependsOn', ids)}
          emptyText="None."
          addLabel="Add a prerequisite…"
          error={error('dependsOn')}
        />
      </Section>
    </EditorFrame>
  );
}
