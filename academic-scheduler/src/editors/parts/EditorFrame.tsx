// The dialog every editor uses: a native <dialog> (ui/Modal) holding one
// <form>, a footer with Delete / Cancel / Save, a summary of the problems
// that block saving, and a guard that asks before unsaved changes are
// discarded (Escape, the backdrop, the close button and Cancel all ask).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../../ui/Modal';
import { Icon } from '../../ui/Icon';
import { useConfirm } from '../../ui/common';
import { errorFor, problemSummary, sameForm, type Problem } from './common';
import '../../styles/editors.css';

export interface EditorFormState<F> {
  form: F;
  initial: F;
  setForm: (update: F | ((form: F) => F)) => void;
  set: <K extends keyof F>(key: K, value: F[K]) => void;
  problems: Problem[];
  /** A save was attempted: required-field errors are shown from now on. */
  submitted: boolean;
  setSubmitted: (value: boolean) => void;
  dirty: boolean;
  /** The inline error for a field key (or null). */
  error: (key: string) => string | null;
}

/** Form state, validation and dirty tracking for an editor. */
export function useEditorForm<F>(init: () => F, validate: (form: F) => Problem[]): EditorFormState<F> {
  const [initial] = useState(init);
  const [form, setFormState] = useState<F>(initial);
  const [submitted, setSubmitted] = useState(false);
  const problems = useMemo(() => validate(form), [validate, form]);
  const dirty = useMemo(() => !sameForm(form, initial), [form, initial]);
  const setForm = useCallback((update: F | ((form: F) => F)) => setFormState(update as F), []);
  const set = useCallback(<K extends keyof F>(key: K, value: F[K]) => setFormState((f) => ({ ...f, [key]: value })), []);
  const error = useCallback((key: string) => errorFor(problems, key, submitted), [problems, submitted]);
  return { form, initial, setForm, set, problems, submitted, setSubmitted, dirty, error };
}

export interface EditorFrameProps {
  title: string;
  /** "assignment", "event", … (used in the discard question). */
  itemLabel: string;
  dirty: boolean;
  onClose: () => void;
  /** Called when the form is submitted (Save button or Enter). */
  onSave: () => void;
  onDelete?: () => void;
  saveLabel?: string;
  /** Problems that block saving, shown after a failed save attempt. */
  problems: string[];
  /** Increase after each failed save attempt: moves focus to the summary. */
  attempt: number;
  size?: 'normal' | 'wide';
  children: ReactNode;
}

export function EditorFrame({ title, itemLabel, dirty, onClose, onSave, onDelete, saveLabel = 'Save', problems, attempt, size = 'normal', children }: EditorFrameProps) {
  const confirm = useConfirm();
  const formId = useId();
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const closing = useRef(false);

  const requestClose = useCallback(async () => {
    if (closing.current) return;
    if (dirty) {
      closing.current = true;
      const discard = await confirm({
        title: 'Discard changes?',
        message: `Your changes to this ${itemLabel} have not been saved.`,
        confirmLabel: 'Discard changes',
        danger: true,
      });
      closing.current = false;
      if (!discard) {
        keepOpen(formRef.current);
        return;
      }
    }
    onClose();
  }, [confirm, dirty, itemLabel, onClose]);

  const close = useCallback(() => void requestClose(), [requestClose]);

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  return (
    <Modal
      title={title}
      onClose={close}
      size={size}
      footer={
        <>
          {onDelete ? (
            <div className="left">
              <button type="button" className="btn danger" onClick={onDelete}>
                <Icon name="trash" />
                Delete
              </button>
            </div>
          ) : null}
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary" form={formId}>
            <Icon name="check" />
            {saveLabel}
          </button>
        </>
      }
    >
      <form
        ref={formRef}
        id={formId}
        className="ed-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {problems.length > 0 ? (
          <div className="banner error ed-problems" role="alert" tabIndex={-1} ref={summaryRef}>
            <Icon name="warning" />
            <div>
              <strong>
                {problems.length === 1 ? 'Fix this problem before saving:' : `Fix these ${problems.length} problems before saving:`}
              </strong>
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {children}
      </form>
    </Modal>
  );
}

/**
 * After "keep editing": make sure the editor's dialog is still shown. A
 * browser may close a dialog on a repeated Escape even though its `cancel`
 * event is handled (the cancel is then not cancelable); the form is still
 * mounted, so show it again instead of leaving the person's edits hidden.
 */
function keepOpen(form: HTMLFormElement | null): void {
  setTimeout(() => {
    const dialog = form?.closest('dialog');
    if (!dialog || !dialog.isConnected || dialog.open) return;
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute('open', '');
    }
  }, 0);
}

/**
 * Save bookkeeping: counts failed attempts (to focus the summary) and keeps
 * extra problems (from the final document check) until the form changes.
 */
export function useSaveFlow<F>(state: EditorFormState<F>) {
  const [attempt, setAttempt] = useState(0);
  const [extra, setExtra] = useState<{ form: F; lines: string[] } | null>(null);
  const lines = summaryLines(state.problems, state.submitted, extra && extra.form === state.form ? extra.lines : []);
  const { setSubmitted, form } = state;
  const fail = useCallback(
    (extraLines: string[] = []) => {
      setSubmitted(true);
      setExtra({ form, lines: extraLines });
      setAttempt((n) => n + 1);
    },
    [form, setSubmitted],
  );
  return { attempt, lines, fail };
}

/** Problems to list in the frame's summary: nothing before the first save attempt. */
export function summaryLines(problems: Problem[], submitted: boolean, extra: string[] = []): string[] {
  if (!submitted) return [];
  return [...problems.map(problemSummary), ...extra];
}

/** Small "section" wrapper with a heading, used inside editor forms. */
export function Section({ title, children, actions, description }: { title: string; children: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <section className="ed-section" aria-labelledby={id}>
      <div className="ed-section-head">
        <h3 id={id}>{title}</h3>
        {actions ? <div className="ed-section-actions">{actions}</div> : null}
      </div>
      {description ? <p className="ed-section-desc muted small">{description}</p> : null}
      {children}
    </section>
  );
}
