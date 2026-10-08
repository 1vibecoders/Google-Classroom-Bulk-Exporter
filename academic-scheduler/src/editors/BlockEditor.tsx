// Create, edit and delete a scheduled work block (SCHEDULE_FORMAT.md § 12):
// the assignment (and subtask) worked on or a free title, a break, the date
// and time (same day; "midnight" ends at the end of the day), status, the
// session description (generator-owned: read-only on imported/planner
// blocks) and the person's notes. Changing the time of an imported or
// planner block pins it (§ 6.2), exactly like dragging it.
import { useCallback, useState } from 'react';
import type { BlockKind, BlockStatus, ScheduleBlock } from '../model/types';
import type { EditorProps } from './EditorHost';
import { WORK_STATUS_LABELS } from '../model/constants';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { DateField, SelectField, TextArea, TextField, TimeField } from '../ui/fields';
import { Icon } from '../ui/Icon';
import { useToday } from '../ui/hooks';
import { newId } from '../lib/ids';
import { addDays, formatDuration, isValidDate, isValidEndTime, isValidTime, minutesToTime, nowLocal, timeToMinutes } from '../lib/time';
import { compact, sameDateOrDateTime, takenIds } from './parts/common';
import {
  MIN_BLOCK_MINUTES,
  blockSaveActions,
  blockToForm,
  blockWarnings,
  descriptionEditable,
  formToBlock,
  formTimes,
  validateBlockForm,
  type BlockForm,
} from './parts/blockForm';
import { EditorFrame, Section, useEditorForm, useSaveFlow } from './parts/EditorFrame';
import { ItemPanel } from './parts/ItemPanel';
import { MissingItem } from './parts/MissingItem';
import { EndTimeInput, Segmented } from './parts/inputs';
import { assignmentOptions } from './parts/options';
import { newValidationErrors } from './parts/commit';

export function BlockEditor(props: EditorProps<ScheduleBlock>) {
  const { state } = useStore();
  const stored = props.id ? state.doc.scheduleBlocks.find((b) => b.id === props.id) : undefined;
  if (props.id && !stored) return <MissingItem itemLabel="scheduled block" onClose={props.onClose} />;
  return <BlockEditorForm {...props} stored={stored} />;
}

const NUDGE = 15;

function BlockEditorForm({ id, initial, onClose, stored }: EditorProps<ScheduleBlock> & { stored?: ScheduleBlock }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const confirm = useConfirm();
  const today = useToday();
  const [itemId] = useState(() => id ?? newId('blk', takenIds(doc)));
  const canEditDescription = descriptionEditable(stored, !stored);
  const generatedLike = !!stored && (stored.origin ?? 'generated') !== 'user';

  const validate = useCallback((form: BlockForm) => validateBlockForm(form, doc, { descriptionEditable: canEditDescription }), [doc, canEditDescription]);
  const editor = useEditorForm<BlockForm>(() => blockToForm(stored ?? initial, today), validate);
  const { form, set, setForm, error } = editor;
  const flow = useSaveFlow(editor);

  const assignment = form.assignmentId ? doc.assignments.find((a) => a.id === form.assignmentId) : undefined;
  const tasks = assignment?.tasks || [];

  const chooseAssignment = (assignmentId: string) =>
    setForm((f) => {
      const next = doc.assignments.find((a) => a.id === assignmentId);
      const keepTask = !!next && (next.tasks || []).some((t) => t.id === f.taskId);
      return { ...f, assignmentId, taskId: keepTask ? f.taskId : '' };
    });

  const setKind = (kind: BlockKind) =>
    setForm((f) => ({
      ...f,
      kind,
      title: kind === 'break' && !f.title.trim() ? 'Break' : kind === 'work' && f.title === 'Break' ? '' : f.title,
    }));

  // Keyboard-friendly moves: shift the whole block by 15 minutes or a day.
  const span =
    isValidTime(form.startTime) && isValidEndTime(form.endTime) && timeToMinutes(form.endTime) > timeToMinutes(form.startTime)
      ? { start: timeToMinutes(form.startTime), end: timeToMinutes(form.endTime) }
      : null;
  const shift = (minutes: number) => {
    if (!span) return;
    const start = span.start + minutes;
    const end = span.end + minutes;
    if (start < 0 || end > 1440) return;
    setForm((f) => ({ ...f, startTime: minutesToTime(start), endTime: end === 1440 ? '24:00' : minutesToTime(end) }));
  };
  const shiftDay = (days: number) => {
    if (isValidDate(form.date)) set('date', addDays(form.date, days));
  };

  const times = formTimes(form);
  const moved = !!stored && !!times && (!sameDateOrDateTime(times.start, stored.start) || !sameDateOrDateTime(times.end, stored.end));
  const warnings = blockWarnings(form, doc);

  const save = () => {
    if (editor.problems.length) return flow.fail();
    const base: ScheduleBlock = stored ?? compact<ScheduleBlock>({ ...(initial as ScheduleBlock), id: itemId, origin: 'user', overrides: undefined, locked: undefined });
    const item = formToBlock(form, base, nowLocal(), { descriptionEditable: canEditDescription });
    const actions = blockSaveActions(item, stored);
    const extra = newValidationErrors(state, actions);
    if (extra.length) return flow.fail(extra.map((e) => `${e.message} (${e.path})`));
    actions.forEach(dispatch);
    const pinned = actions.some((a) => a.type === 'moveBlock');
    notify(stored ? (pinned ? 'Block saved and pinned at its new time.' : 'Block saved.') : 'Work block added.', { tone: 'success' });
    onClose();
  };

  const remove = async () => {
    if (!stored) return;
    const generated = (stored.origin ?? 'generated') === 'generated';
    const done = stored.status === 'done';
    const ok = await confirm({
      title: 'Delete this block?',
      message: (
        <>
          Delete this {stored.kind === 'break' ? 'break' : 'work session'}?
          {done ? ' It is marked done: its minutes will no longer count as work you have done.' : ''}
          {generated ? ' /academic-schedule will not add it again.' : ''}
        </>
      ),
      confirmLabel: 'Delete block',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'deleteBlocks', ids: [stored.id], now: nowLocal() });
    notify('Block deleted.', { tone: 'success' });
    onClose();
  };

  const statusOptions: Array<{ value: BlockStatus; label: string; icon?: 'check' | 'x' | 'clock' }> = [
    { value: 'planned', label: 'Planned', icon: 'clock' },
    { value: 'done', label: 'Done', icon: 'check' },
    { value: 'skipped', label: 'Skipped', icon: 'x' },
  ];

  return (
    <EditorFrame
      title={stored ? (stored.kind === 'break' ? 'Edit break' : 'Edit scheduled work') : 'Schedule work'}
      itemLabel="block"
      dirty={editor.dirty}
      onClose={onClose}
      onSave={save}
      onDelete={stored ? () => void remove() : undefined}
      saveLabel={stored ? 'Save' : 'Add to schedule'}
      problems={flow.lines}
      attempt={flow.attempt}
    >
      {stored ? <ItemPanel collection="scheduleBlocks" id={stored.id} itemLabel="block" /> : null}
      <Segmented<BlockKind>
        label="Kind"
        value={form.kind}
        onChange={setKind}
        options={[
          { value: 'work', label: 'Work session', icon: 'book' },
          { value: 'break', label: 'Break', icon: 'clock' },
        ]}
      />
      {form.kind === 'work' ? (
        <div className="form-grid">
          <SelectField
            label="Assignment"
            value={form.assignmentId}
            options={assignmentOptions(doc, form.assignmentId, { noneLabel: 'No assignment (use a title)' })}
            onChange={chooseAssignment}
            error={error('assignmentId')}
          />
          <SelectField
            label="Subtask"
            value={form.taskId}
            options={[
              { value: '', label: assignment ? (tasks.length ? 'Whole assignment' : 'No subtasks') : 'Choose an assignment first' },
              ...tasks.map((t, i) => ({
                value: t.id,
                label: `${i + 1}. ${t.title}${t.status && t.status !== 'not_started' ? ` (${WORK_STATUS_LABELS[t.status].toLowerCase()})` : ''}`,
              })),
            ]}
            onChange={(v) => set('taskId', v)}
            error={error('taskId')}
          />
          <TextField
            className="span-2"
            label={form.assignmentId ? 'Label (optional)' : 'Title'}
            required={!form.assignmentId}
            value={form.title}
            onChange={(v) => set('title', v)}
            error={error('title')}
            placeholder={form.assignmentId ? 'Shown instead of the assignment title' : 'e.g. Review flashcards'}
          />
        </div>
      ) : (
        <TextField label="Title" required value={form.title} onChange={(v) => set('title', v)} error={error('title')} />
      )}

      <Section title="When">
        <div className="form-grid ed-when">
          <DateField label="Date" required value={form.date} onChange={(v) => set('date', v)} error={error('date')} />
          <div className="ed-time-pair">
            <TimeField label="Start" required value={form.startTime} onChange={(v) => set('startTime', v)} error={error('startTime')} />
            <EndTimeInput
              label="End"
              required
              value={form.endTime}
              onChange={(v) => set('endTime', v)}
              error={error('endTime')}
              hint={span && span.end - span.start >= MIN_BLOCK_MINUTES ? formatDuration(span.end - span.start) : `At least ${MIN_BLOCK_MINUTES} minutes.`}
            />
          </div>
        </div>
        <div className="ed-nudge" role="group" aria-label="Move the block">
          <span className="muted small">Move:</span>
          <button type="button" className="btn small" onClick={() => shift(-NUDGE)} disabled={!span || span.start - NUDGE < 0}>
            −15 min
          </button>
          <button type="button" className="btn small" onClick={() => shift(NUDGE)} disabled={!span || span.end + NUDGE > 1440}>
            +15 min
          </button>
          <button type="button" className="btn small" onClick={() => shiftDay(-1)} disabled={!isValidDate(form.date)}>
            <Icon name="chevronLeft" size={14} />
            Day earlier
          </button>
          <button type="button" className="btn small" onClick={() => shiftDay(1)} disabled={!isValidDate(form.date)}>
            Day later
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        {moved && generatedLike && !stored?.locked ? (
          <p className="small muted ed-note">
            <Icon name="lock" size={12} /> Saving a new time pins this block, so /academic-schedule will not move it back.
          </p>
        ) : null}
        {warnings.length ? (
          <div className="banner warning ed-warnings" role="status">
            <Icon name="warning" />
            <div>
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
              <div className="small">You can still save it.</div>
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Progress and notes">
        <Segmented<BlockStatus> label="Status" value={form.status} onChange={(v) => set('status', v)} options={statusOptions} />
        {canEditDescription ? (
          <TextArea label="What to do in this session" rows={2} value={form.description} onChange={(v) => set('description', v)} error={error('description')} />
        ) : stored?.description ? (
          <div className="field">
            <span className="field-label">What to do in this session</span>
            <p className="ed-readonly">{stored.description}</p>
            <span className="hint">Written by /academic-schedule. Use your notes for your own comments.</span>
          </div>
        ) : null}
        <TextArea label="Your notes" rows={3} value={form.notes} onChange={(v) => set('notes', v)} error={error('notes')} />
      </Section>
    </EditorFrame>
  );
}
