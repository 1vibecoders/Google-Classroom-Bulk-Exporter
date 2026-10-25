// The person's own description of their commitments (settings.commitmentsDescription,
// format 1.1): asked for in the "Finish setting up" card after setup, editable in Settings.
import { useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { TextArea } from '../ui/fields';
import { MAX_COMMITMENTS_DESCRIPTION, commitmentsDescriptionError } from '../lib/onboarding';

/** The commitments description form, shared by the "Finish setting up" card and Settings. */
export function CommitmentsDescriptionForm({ submitLabel = 'Save', onSaved }: { submitLabel?: string; onSaved?: () => void }) {
  const { state, dispatch, notify } = useStore();
  const saved = state.doc.settings?.commitmentsDescription ?? '';
  const [text, setText] = useState(saved);
  const [submitted, setSubmitted] = useState(false);
  const error = submitted ? commitmentsDescriptionError(text) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (commitmentsDescriptionError(text)) return;
    const value = text.trim();
    if (value !== saved) dispatch({ type: 'updateSettings', settings: { commitmentsDescription: value } });
    setText(value);
    if (onSaved) onSaved();
    else notify('Commitments saved.', { tone: 'success' });
  };

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <TextArea
        label="Your commitments"
        required
        value={text}
        onChange={setText}
        rows={5}
        maxLength={MAX_COMMITMENTS_DESCRIPTION}
        placeholder="e.g. School 8 AM–3 PM on weekdays. Swim practice Mon and Wed 4–6 PM. Library job Saturday mornings. Dinner with family around 6:30."
        hint="In your own words: school hours, practice, lessons, a job, family duties, anything that regularly takes your time."
        error={error}
      />
      <div className="row">
        <button type="submit" className="btn primary">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
