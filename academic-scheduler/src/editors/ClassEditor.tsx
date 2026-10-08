// Create, edit and delete a class (SCHEDULE_FORMAT.md § 7): name, teacher,
// section, room, color, description, topics, class materials (references)
// and archiving. Deleting asks whether the class's assignments and events
// go too (else they are kept without a class).
import { useCallback, useMemo, useState } from 'react';
import type { SchoolClass } from '../model/types';
import type { EditorProps } from './EditorHost';
import type { Action } from '../state/reducer';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { Checkbox, ColorField, TextArea, TextField } from '../ui/fields';
import { newId } from '../lib/ids';
import { nowLocal } from '../lib/time';
import { classColor } from '../lib/calendar';
import { compact, takenIds } from './parts/common';
import { classToForm, formToClass, textToTopics, validateClassForm, type ClassForm } from './parts/classForm';
import { EditorFrame, Section, useEditorForm, useSaveFlow } from './parts/EditorFrame';
import { ItemPanel } from './parts/ItemPanel';
import { MissingItem } from './parts/MissingItem';
import { ReferencesEditor } from './parts/ReferencesEditor';
import { ChoiceDialog } from './parts/ChoiceDialog';
import { newValidationErrors } from './parts/commit';
import { plural } from './parts/labels';
import { CLASS_PALETTE } from '../model/constants';

export function ClassEditor(props: EditorProps<SchoolClass>) {
  const { state } = useStore();
  const stored = props.id ? state.doc.classes.find((c) => c.id === props.id) : undefined;
  if (props.id && !stored) return <MissingItem itemLabel="class" onClose={props.onClose} />;
  return <ClassEditorForm {...props} stored={stored} />;
}

/** First palette color no class uses yet (new classes get distinct colors). */
function nextPaletteColor(classes: SchoolClass[]): string {
  const used = new Set(classes.map((c) => (c.color || '').toUpperCase()));
  return CLASS_PALETTE.find((c) => !used.has(c.toUpperCase())) ?? CLASS_PALETTE[classes.length % CLASS_PALETTE.length];
}

function ClassEditorForm({ id, initial, onClose, stored }: EditorProps<SchoolClass> & { stored?: SchoolClass }) {
  const { state, dispatch, notify } = useStore();
  const doc = state.doc;
  const confirm = useConfirm();
  const [itemId] = useState(() => id ?? newId('cls', takenIds(doc)));
  const [choosingDelete, setChoosingDelete] = useState(false);

  const validate = useCallback((form: ClassForm) => validateClassForm(form), []);
  const editor = useEditorForm<ClassForm>(() => {
    if (stored) return classToForm(stored);
    return classToForm({ color: nextPaletteColor(doc.classes), ...initial });
  }, validate);
  const { form, set, error } = editor;
  const flow = useSaveFlow(editor);

  const autoColor = useMemo(() => (stored ? classColor(doc, stored.id) : CLASS_PALETTE[0]), [doc, stored]);
  const topicCount = textToTopics(form.topicsText).length;

  const save = () => {
    if (editor.problems.length) return flow.fail();
    const base: SchoolClass = stored ?? compact<SchoolClass>({ ...(initial as SchoolClass), id: itemId, origin: 'user', overrides: undefined, locked: undefined });
    const item = formToClass(form, base, editor.initial);
    const actions: Action[] = [{ type: 'upsertClass', item }];
    const extra = newValidationErrors(state, actions);
    if (extra.length) return flow.fail(extra.map((e) => `${e.message} (${e.path})`));
    actions.forEach(dispatch);
    notify(stored ? `Saved “${item.name}”.` : `Added the class “${item.name}”.`, { tone: 'success' });
    onClose();
  };

  const assignments = stored ? doc.assignments.filter((a) => a.classId === stored.id) : [];
  const events = stored ? doc.events.filter((e) => e.classId === stored.id) : [];
  const generated = stored && (stored.origin ?? 'generated') === 'generated';

  const finishDelete = (deleteContents: boolean) => {
    if (!stored) return;
    dispatch({ type: 'deleteClass', id: stored.id, deleteContents, now: nowLocal() });
    notify(
      deleteContents
        ? `Deleted “${stored.name}” with ${plural(assignments.length, 'assignment')} and ${plural(events.length, 'event')}.`
        : `Deleted “${stored.name}”.${assignments.length + events.length ? ' Its assignments and events were kept without a class.' : ''}`,
      { tone: 'success' },
    );
    onClose();
  };

  const remove = async () => {
    if (!stored) return;
    if (assignments.length || events.length) {
      setChoosingDelete(true);
      return;
    }
    const ok = await confirm({
      title: 'Delete class?',
      message: (
        <>
          Delete “{stored.name}”?{generated ? ' /academic-schedule will not add it again.' : ''} This cannot be undone.
        </>
      ),
      confirmLabel: 'Delete class',
      danger: true,
    });
    if (ok) finishDelete(false);
  };

  const doneBlocks = stored
    ? doc.scheduleBlocks.filter((b) => b.status === 'done' && b.assignmentId && assignments.some((a) => a.id === b.assignmentId)).length
    : 0;

  return (
    <>
      <EditorFrame
        title={stored ? 'Edit class' : 'New class'}
        itemLabel="class"
        dirty={editor.dirty}
        onClose={onClose}
        onSave={save}
        onDelete={stored ? () => void remove() : undefined}
        saveLabel={stored ? 'Save' : 'Add class'}
        problems={flow.lines}
        attempt={flow.attempt}
      >
        {stored ? <ItemPanel collection="classes" id={stored.id} itemLabel="class" /> : null}
        <div className="form-grid">
          <TextField className="span-2" label="Class name" required autoFocus={!stored} value={form.name} onChange={(v) => set('name', v)} error={error('name')} placeholder="e.g. English 10" />
          <TextField label="Teacher" value={form.teacher} onChange={(v) => set('teacher', v)} error={error('teacher')} />
          <TextField label="Section or period" value={form.section} onChange={(v) => set('section', v)} error={error('section')} placeholder="e.g. Period 3" />
          <TextField label="Room" value={form.room} onChange={(v) => set('room', v)} error={error('room')} />
          <div className="field">
            <ColorField value={form.color || autoColor} onChange={(v) => set('color', v)} />
            {form.color ? (
              <button type="button" className="btn ghost small ed-inline-btn" onClick={() => set('color', '')}>
                Use automatic color
              </button>
            ) : (
              <span className="hint">Automatic color. Pick one to keep it fixed.</span>
            )}
            {error('color') ? (
              <span className="error" role="alert">
                {error('color')}
              </span>
            ) : null}
          </div>
          <TextArea className="span-2" label="Description" rows={3} value={form.description} onChange={(v) => set('description', v)} error={error('description')} />
          <TextArea
            className="span-2"
            label="Topics or units"
            rows={3}
            value={form.topicsText}
            onChange={(v) => set('topicsText', v)}
            hint={`One per line${topicCount ? ` · ${plural(topicCount, 'topic')}` : ''}. Offered when you enter an assignment’s topic.`}
            error={error('topics')}
          />
          <div className="span-2">
            <Checkbox
              label="Archived"
              checked={form.archived}
              onChange={(v) => set('archived', v)}
              hint="Archived classes are hidden from pickers and filters; their assignments and events still show."
            />
          </div>
        </div>
        <Section title="Class materials" description="Syllabus, unit notes, slides and other references that are not work.">
          <ReferencesEditor rows={form.references} onChange={(rows) => set('references', rows)} error={error} emptyText="No materials yet." />
        </Section>
      </EditorFrame>
      {choosingDelete && stored ? (
        <ChoiceDialog<'class' | 'all'>
          title="Delete class?"
          onCancel={() => setChoosingDelete(false)}
          onChoose={(choice) => {
            setChoosingDelete(false);
            finishDelete(choice === 'all');
          }}
          choices={[
            { value: 'class', label: 'Delete class only', primary: true },
            { value: 'all', label: 'Delete everything', danger: true },
          ]}
        >
          <p>
            “{stored.name}” has {plural(assignments.length, 'assignment')} and {plural(events.length, 'event')}.
          </p>
          <ul className="ed-choice-list">
            <li>
              <strong>Delete class only:</strong> keep them as personal items without a class.
            </li>
            <li>
              <strong>Delete everything:</strong> also delete the assignments (with their scheduled work{doneBlocks ? `, including ${plural(doneBlocks, 'session')} marked done` : ''}) and the events.
            </li>
          </ul>
          <p className="muted small">This cannot be undone.{generated ? ' /academic-schedule will not add deleted items again.' : ''}</p>
        </ChoiceDialog>
      ) : null}
    </>
  );
}
