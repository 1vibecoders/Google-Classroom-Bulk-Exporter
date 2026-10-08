// Import wizard (SCHEDULE_FORMAT.md § 16): 1. choose a file (or paste its
// text) → read, parse and validate; 2. preview what would be added, updated,
// kept or removed, with choices; 3. import in one step (the previous schedule
// is saved, so the import can be undone) and show what changed.
//
// The file is data only: it is parsed with JSON.parse, validated, compared and
// merged by pure functions (src/lib/validate.ts, src/lib/importDiff.ts); its
// text is only ever rendered as text.
import { useEffect, useRef, useState } from 'react';
import '../styles/import.css';
import { useStore } from '../state/store';
import { useConfirm } from '../ui/common';
import { useToday } from '../ui/hooks';
import { applyImport, type ImportPlan } from '../lib/importDiff';
import { validateDocument } from '../lib/validate';
import { nowLocal } from '../lib/time';
import { ChooseStep } from './import/ChooseStep';
import { PreviewStep } from './import/PreviewStep';
import { DoneStep, type ImportResult } from './import/DoneStep';
import { getPendingImport, setPendingImport, type LoadedFile } from './import/pending';
import { newSnapshotId, type Choices } from './import/logic';

type Step = { name: 'choose' } | { name: 'preview'; loaded: LoadedFile } | { name: 'done'; loaded: LoadedFile; result: ImportResult };

const STEPS: Array<{ name: Step['name']; label: string }> = [
  { name: 'choose', label: 'Choose a file' },
  { name: 'preview', label: 'Review the changes' },
  { name: 'done', label: 'Done' },
];

export function ImportView() {
  const { state, dispatch, notify } = useStore();
  const confirm = useConfirm();
  const today = useToday();
  const [step, setStep] = useState<Step>(() => {
    const pending = getPendingImport();
    return pending ? { name: 'preview', loaded: pending.loaded } : { name: 'choose' };
  });
  const [choices, setChoices] = useState<Choices>(() => getPendingImport()?.choices ?? {});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusKey = step.name === 'done' ? `done:${step.result.undone}` : step.name;
  const lastFocusKey = useRef(focusKey);

  // Keep the preview (file + choices) while the person visits other pages.
  useEffect(() => {
    setPendingImport(step.name === 'preview' ? { loaded: step.loaded, choices } : null);
  }, [step, choices]);

  // Move focus to the new step's heading so that screen readers announce it.
  useEffect(() => {
    if (lastFocusKey.current === focusKey) return;
    lastFocusKey.current = focusKey;
    headingRef.current?.focus();
  }, [focusKey]);

  // Outside step 1, a file dropped on the page must not make the browser leave the preview.
  useEffect(() => {
    if (step.name === 'choose') return;
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, [step.name]);

  const startPreview = (loaded: LoadedFile) => {
    setChoices({});
    setStep({ name: 'preview', loaded });
  };

  const cancel = () => {
    setChoices({});
    setStep({ name: 'choose' });
  };

  const runImport = (plan: ImportPlan, selected: Set<string>) => {
    if (step.name !== 'preview') return;
    const { loaded } = step;
    const before = state.doc;
    let after;
    try {
      after = applyImport(before, loaded.incoming, plan, selected, loaded.importTime);
    } catch (err) {
      notify(`Nothing was imported: ${err instanceof Error ? err.message : 'the file could not be combined with your schedule'}.`, { tone: 'error' });
      return;
    }
    // Last safety check: never store a schedule that is not valid.
    const verify = validateDocument(after);
    if (!verify.ok) {
      const first = verify.errors[0];
      notify(`Nothing was imported: the result would not be a valid schedule (${first ? `${first.path}: ${first.message}` : 'unknown problem'}).`, { tone: 'error' });
      return;
    }
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: after, label: `Import ${loaded.fileName}`, now: nowLocal(), snapshotId });
    setChoices({});
    setStep({ name: 'done', loaded, result: { fileName: loaded.fileName, snapshotId, before, after, undone: false } });
  };

  const markPassed = (blockId: string, status: 'done' | 'skipped') => {
    dispatch({ type: 'setBlockStatus', id: blockId, status, now: nowLocal() });
    notify(status === 'done' ? 'Session marked done. It is kept as it is; the preview was updated.' : 'Session marked skipped. It is kept as it is; the preview was updated.', {
      tone: 'success',
    });
  };

  const canUndo = step.name === 'done' && !step.result.undone && state.snapshots.some((s) => s.id === step.result.snapshotId);

  const undo = async () => {
    if (step.name !== 'done' || !canUndo) return;
    const { result } = step;
    if (state.doc !== result.after) {
      const ok = await confirm({
        title: 'Undo the import?',
        message: 'You changed your schedule after importing. Undoing restores it exactly as it was before the import, so those later changes are undone too.',
        confirmLabel: 'Undo import',
        danger: true,
      });
      if (!ok) return;
    }
    dispatch({ type: 'undo', snapshotId: result.snapshotId });
    setStep({ ...step, result: { ...result, undone: true } });
  };

  const review = () => {
    if (step.name !== 'done') return;
    setChoices({});
    setStep({ name: 'preview', loaded: { ...step.loaded, importTime: nowLocal() } });
  };

  const currentIndex = STEPS.findIndex((s) => s.name === step.name);

  return (
    <div className="imp-page">
      <div className="page-header">
        <div>
          <h1 ref={step.name === 'choose' ? headingRef : undefined} tabIndex={-1} className="imp-h1">
            Import schedule
          </h1>
          <div className="page-subtitle">Add or update your schedule from a file made by the /academic-schedule skill or exported from this website.</div>
        </div>
      </div>

      <ol className="imp-steps" aria-label="Import steps">
        {STEPS.map((s, i) => (
          <li key={s.name} className={i < currentIndex ? 'past' : i === currentIndex ? 'current' : ''} aria-current={i === currentIndex ? 'step' : undefined}>
            <span className="imp-step-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>{s.label}</span>
            {i < currentIndex ? <span className="visually-hidden"> (completed)</span> : null}
          </li>
        ))}
      </ol>

      {step.name === 'choose' ? <ChooseStep onLoaded={startPreview} /> : null}
      {step.name === 'preview' ? (
        <PreviewStep
          loaded={step.loaded}
          current={state.doc}
          choices={choices}
          onChoices={setChoices}
          onCancel={cancel}
          onImport={runImport}
          onMarkPassed={markPassed}
          headingRef={headingRef}
        />
      ) : null}
      {step.name === 'done' ? (
        <DoneStep
          result={step.result}
          today={today}
          canUndo={canUndo}
          onUndo={() => void undo()}
          onReview={review}
          onImportAnother={cancel}
          headingRef={headingRef}
        />
      ) : null}
    </div>
  );
}
