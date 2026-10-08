// Create, edit and delete an event or commitment (SCHEDULE_FORMAT.md § 10):
// one-time (a date, all-day or with times, optionally several days when all
// day) or weekly (days, every N weeks, first/last day, skipped dates); busy
// or informational; class; location; notes; the assessment it is the
// sitting of.
import { useCallback, useState } from 'react';
import type { EventCategory, ScheduleEvent } from '../model/types';
import type { EditorProps } from './EditorHost';
import type { Action } from '../state/reducer';
import { EVENT_CATEGORIES, EVENT_CATEGORY_LABELS } from '../model/constants';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { Checkbox, DateField, SelectField, TextArea, TextField, TimeField } from '../ui/fields';
import { useToday } from '../ui/hooks';
import { newId } from '../lib/ids';
import { nowLocal } from '../lib/time';
import { compact, sameForm, takenIds } from './parts/common';
import { eventToForm, formToEvent, recurrenceToForm, validateEventForm, type EventForm, type RepeatMode } from './parts/eventForm';
import { EditorFrame, Section, useEditorForm, useSaveFlow } from './parts/EditorFrame';
import { ItemPanel } from './parts/ItemPanel';
import { MissingItem } from './parts/MissingItem';
import { RecurrenceFields } from './parts/RecurrenceFields';
import { EndTimeInput, Segmented, classOptions } from './parts/inputs';
import { assignmentOptions } from './parts/options';
import { newValidationErrors } from './parts/commit';

export function EventEditor(props: EditorProps<ScheduleEvent>) {
  const { state } = useStore();
  const stored = props.id ? state.doc.events.find((e) => e.id === props.id) : undefined;
  if (props.id && !stored) return <MissingItem itemLabel="event" onClose={props.onClose} />;
  return <EventEditorForm {...props} stored={stored} />;
}

function EventEditorForm({ id, initial, onClose, stored }: EditorProps<ScheduleEvent> & { stored?: ScheduleEvent }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const confirm = useConfirm();
  const today = useToday();
  const [itemId] = useState(() => id ?? newId('evt', takenIds(doc)));

  const validate = useCallback((form: EventForm) => validateEventForm(form, doc), [doc]);
  const editor = useEditorForm<EventForm>(() => eventToForm(stored ?? initial, today), validate);
  const { form, set, setForm, error } = editor;
  const flow = useSaveFlow(editor);

  const setRepeat = (repeat: RepeatMode) =>
    setForm((f) => {
      // A rule the person has not touched yet follows the chosen date.
      const untouched = !stored?.recurrence && sameForm(f.recurrence, editor.initial.recurrence);
      return { ...f, repeat, recurrence: repeat === 'weekly' && untouched && f.date ? recurrenceToForm(undefined, f.date) : f.recurrence };
    });

  const linkAssessment = (assignmentId: string) =>
    setForm((f) => {
      const a = doc.assignments.find((x) => x.id === assignmentId);
      return {
        ...f,
        assignmentId,
        // Fill empty fields from the assessment; never overwrite typed values.
        title: !f.title.trim() && a ? a.title : f.title,
        classId: !f.classId && a?.classId ? a.classId : f.classId,
      };
    });

  const save = () => {
    if (editor.problems.length) return flow.fail();
    const base: ScheduleEvent = stored ?? compact<ScheduleEvent>({ ...(initial as ScheduleEvent), id: itemId, origin: 'user', overrides: undefined, locked: undefined });
    const item = formToEvent(form, base);
    const actions: Action[] = [{ type: 'upsertEvent', item }];
    const extra = newValidationErrors(state, actions);
    if (extra.length) return flow.fail(extra.map((e) => `${e.message} (${e.path})`));
    actions.forEach(dispatch);
    notify(stored ? `Saved “${item.title}”.` : `Added “${item.title}”.`, { tone: 'success' });
    onClose();
  };

  const remove = async () => {
    if (!stored) return;
    const generated = (stored.origin ?? 'generated') === 'generated';
    const ok = await confirm({
      title: 'Delete event?',
      message: (
        <>
          Delete “{stored.title}”{stored.recurrence ? ' and all its repetitions' : ''}?{generated ? ' /academic-schedule will not add it again.' : ''} This cannot be
          undone.
          {stored.recurrence ? <p className="muted small">To cancel a single day instead, add it to “Skip these dates”.</p> : null}
        </>
      ),
      confirmLabel: 'Delete event',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'deleteEvent', id: stored.id, now: nowLocal() });
    notify(`Deleted “${stored.title}”.`, { tone: 'success' });
    onClose();
  };

  const linked = form.assignmentId ? doc.assignments.find((a) => a.id === form.assignmentId) : undefined;

  return (
    <EditorFrame
      title={stored ? 'Edit event' : 'New event or commitment'}
      itemLabel="event"
      dirty={editor.dirty}
      onClose={onClose}
      onSave={save}
      onDelete={stored ? () => void remove() : undefined}
      saveLabel={stored ? 'Save' : 'Add event'}
      problems={flow.lines}
      attempt={flow.attempt}
    >
      {stored ? <ItemPanel collection="events" id={stored.id} itemLabel="event" /> : null}
      <div className="form-grid">
        <TextField className="span-2" label="Title" required autoFocus={!stored} value={form.title} onChange={(v) => set('title', v)} error={error('title')} placeholder="e.g. School, Fencing, Doctor appointment" />
        <SelectField<EventCategory>
          label="Category"
          value={form.category}
          options={EVENT_CATEGORIES.map((c) => ({ value: c, label: EVENT_CATEGORY_LABELS[c] }))}
          onChange={(v) => set('category', (v || 'other') as EventCategory)}
        />
        <SelectField label="Class" value={form.classId} options={classOptions(doc.classes, form.classId, 'No class')} onChange={(v) => set('classId', v)} error={error('classId')} />
      </div>

      <Section title="When">
        <Segmented<RepeatMode>
          label="Repeats"
          value={form.repeat}
          onChange={setRepeat}
          options={[
            { value: 'once', label: 'One time', icon: 'calendar' },
            { value: 'weekly', label: 'Weekly', icon: 'repeat' },
          ]}
        />
        {form.repeat === 'once' ? (
          <div className="form-grid">
            <DateField label={form.allDay ? 'First day' : 'Date'} required value={form.date} onChange={(v) => set('date', v)} error={error('date')} />
            {form.allDay ? (
              <DateField
                label="Last day"
                value={form.endDate}
                min={form.date || undefined}
                onChange={(v) => set('endDate', v)}
                hint="For events that last several days. Leave empty for one day."
                error={error('endDate')}
              />
            ) : (
              <div />
            )}
          </div>
        ) : (
          <RecurrenceFields value={form.recurrence} onChange={(v) => set('recurrence', v)} error={error} today={today} />
        )}
        <Checkbox label="All day" checked={form.allDay} onChange={(v) => set('allDay', v)} />
        {!form.allDay ? (
          <div className="form-grid">
            <TimeField label="Start time" required value={form.startTime} onChange={(v) => set('startTime', v)} error={error('startTime')} />
            <EndTimeInput required value={form.endTime} onChange={(v) => set('endTime', v)} error={error('endTime')} hint="Events end on the day they start." />
          </div>
        ) : null}
        <Checkbox
          label="Busy (no study time during this event)"
          checked={form.busy}
          onChange={(v) => set('busy', v)}
          hint={form.allDay ? 'A busy all-day event blocks the whole day for study.' : 'Turn off for reminders that do not take your time.'}
        />
      </Section>

      <Section title="Details">
        <div className="form-grid">
          <TextField label="Location" value={form.location} onChange={(v) => set('location', v)} error={error('location')} />
          <SelectField
            label="Sitting of an assessment"
            value={form.assignmentId}
            options={assignmentOptions(doc, form.assignmentId, { preferAssessments: true, noneLabel: 'None', withType: true })}
            onChange={linkAssessment}
            error={error('assignmentId')}
            hint={linked ? 'This event is when the assessment takes place; the assignment holds the preparation.' : 'For a test or exam outside school, link the event to its assignment.'}
          />
          <TextArea className="span-2" label="Notes" rows={3} value={form.notes} onChange={(v) => set('notes', v)} error={error('notes')} />
        </div>
      </Section>
    </EditorFrame>
  );
}
