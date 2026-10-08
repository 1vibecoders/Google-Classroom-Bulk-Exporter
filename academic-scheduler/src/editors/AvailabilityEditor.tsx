// Create, edit and delete a study-time window (SCHEDULE_FORMAT.md § 11):
// when the person is free for schoolwork, weekly or on one date. Busy events
// inside a window are subtracted from it.
import { useCallback, useState } from 'react';
import type { AvailabilityWindow } from '../model/types';
import type { EditorProps } from './EditorHost';
import type { Action } from '../state/reducer';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { DateField, TextField, TimeField } from '../ui/fields';
import { useToday } from '../ui/hooks';
import { newId } from '../lib/ids';
import { formatDuration, isValidEndTime, isValidTime, nowLocal, timeToMinutes } from '../lib/time';
import { compact, sameForm, takenIds } from './parts/common';
import { availabilityToForm, formToAvailability, recurrenceToForm, validateAvailabilityForm, type AvailabilityForm, type RepeatMode } from './parts/eventForm';
import { EditorFrame, Section, useEditorForm, useSaveFlow } from './parts/EditorFrame';
import { ItemPanel } from './parts/ItemPanel';
import { MissingItem } from './parts/MissingItem';
import { RecurrenceFields } from './parts/RecurrenceFields';
import { EndTimeInput, Segmented } from './parts/inputs';
import { newValidationErrors } from './parts/commit';

export function AvailabilityEditor(props: EditorProps<AvailabilityWindow>) {
  const { state } = useStore();
  const stored = props.id ? state.doc.availability.find((w) => w.id === props.id) : undefined;
  if (props.id && !stored) return <MissingItem itemLabel="study-time window" onClose={props.onClose} />;
  return <AvailabilityEditorForm {...props} stored={stored} />;
}

function AvailabilityEditorForm({ id, initial, onClose, stored }: EditorProps<AvailabilityWindow> & { stored?: AvailabilityWindow }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const confirm = useConfirm();
  const today = useToday();
  const [itemId] = useState(() => id ?? newId('avl', takenIds(doc)));

  const validate = useCallback((form: AvailabilityForm) => validateAvailabilityForm(form), []);
  const editor = useEditorForm<AvailabilityForm>(() => availabilityToForm(stored ?? initial, today), validate);
  const { form, set, setForm, error } = editor;
  const flow = useSaveFlow(editor);

  const setRepeat = (repeat: RepeatMode) =>
    setForm((f) => {
      const untouched = !stored?.recurrence && sameForm(f.recurrence, editor.initial.recurrence);
      return { ...f, repeat, recurrence: repeat === 'weekly' && untouched && f.date ? recurrenceToForm(undefined, f.date) : f.recurrence };
    });

  const save = () => {
    if (editor.problems.length) return flow.fail();
    const base: AvailabilityWindow =
      stored ?? compact<AvailabilityWindow>({ ...(initial as AvailabilityWindow), id: itemId, origin: 'user', overrides: undefined, locked: undefined });
    const item = formToAvailability(form, base);
    const actions: Action[] = [{ type: 'upsertAvailability', item }];
    const extra = newValidationErrors(state, actions);
    if (extra.length) return flow.fail(extra.map((e) => `${e.message} (${e.path})`));
    actions.forEach(dispatch);
    notify(stored ? 'Study time saved.' : 'Study time added.', { tone: 'success' });
    onClose();
  };

  const remove = async () => {
    if (!stored) return;
    const generated = (stored.origin ?? 'generated') === 'generated';
    const ok = await confirm({
      title: 'Delete study time?',
      message: (
        <>
          Delete {stored.label ? `“${stored.label}”` : 'this study-time window'}
          {stored.recurrence ? ' and all its repetitions' : ''}?{generated ? ' /academic-schedule will not add it again.' : ''} Scheduled work stays where it is.
        </>
      ),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'deleteAvailability', id: stored.id, now: nowLocal() });
    notify(`Deleted ${stored.label ? `“${stored.label}”` : 'the study-time window'}.`, { tone: 'success' });
    onClose();
  };

  const length =
    isValidTime(form.startTime) && isValidEndTime(form.endTime) && timeToMinutes(form.endTime) > timeToMinutes(form.startTime)
      ? timeToMinutes(form.endTime) - timeToMinutes(form.startTime)
      : null;

  return (
    <EditorFrame
      title={stored ? 'Edit study time' : 'Add study time'}
      itemLabel="study-time window"
      dirty={editor.dirty}
      onClose={onClose}
      onSave={save}
      onDelete={stored ? () => void remove() : undefined}
      saveLabel={stored ? 'Save' : 'Add study time'}
      problems={flow.lines}
      attempt={flow.attempt}
    >
      {stored ? <ItemPanel collection="availability" id={stored.id} itemLabel="study-time window" /> : null}
      <p className="muted small ed-intro">
        When are you free for schoolwork? Busy events inside this time (school, practice, appointments) are subtracted automatically, and the planner only
        places work here.
      </p>
      <TextField label="Label" value={form.label} onChange={(v) => set('label', v)} error={error('label')} placeholder="e.g. After school" autoFocus={!stored} />
      <Section title="When">
        <Segmented<RepeatMode>
          label="Repeats"
          value={form.repeat}
          onChange={setRepeat}
          options={[
            { value: 'weekly', label: 'Weekly', icon: 'repeat' },
            { value: 'once', label: 'One date', icon: 'calendar' },
          ]}
        />
        {form.repeat === 'once' ? (
          <div className="form-grid">
            <DateField label="Date" required value={form.date} onChange={(v) => set('date', v)} error={error('date')} />
          </div>
        ) : (
          <RecurrenceFields value={form.recurrence} onChange={(v) => set('recurrence', v)} error={error} today={today} />
        )}
        <div className="form-grid">
          <TimeField label="From" required value={form.startTime} onChange={(v) => set('startTime', v)} error={error('startTime')} />
          <EndTimeInput label="Until" required value={form.endTime} onChange={(v) => set('endTime', v)} error={error('endTime')} hint={length ? `${formatDuration(length)} of study time` : undefined} />
        </div>
      </Section>
    </EditorFrame>
  );
}
