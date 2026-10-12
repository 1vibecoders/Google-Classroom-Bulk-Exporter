// First-run setup (SPEC.md § 5). Two answers are required: when the person can
// study (availability windows) and a short description of their commitments
// (settings.commitmentsDescription). Preferences, classes and imports are
// optional steps with sensible defaults. Every answer is saved in the schedule
// as soon as it is given, and the current step in this browser, so the wizard
// resumes after a refresh. The app shows this page until both answers exist.
import { useState } from 'react';
import '../styles/import.css';
import '../styles/lists.css';
import { useStore } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { Icon } from '../ui/Icon';
import { useToday } from '../ui/hooks';
import { navigate, routeToHash } from '../router';
import { resolveSettings } from '../model/constants';
import { describePlannerRules } from '../lib/planner';
import { onboardingNeeds, type OnboardingNeed } from '../lib/onboarding';
import { ClassroomSyncCard } from './ClassroomSyncCard';
import { CommitmentsDescriptionForm } from './CommitmentsDescriptionForm';
import { EventRow, WindowRow } from './CommitmentsView';
import { SettingsForm } from './SettingsView';

const STEPS = ['Study time', 'Commitments', 'Preferences', 'Classes and data', 'Review'] as const;
const STEP_KEY = 'academic-scheduler:onboarding-step';
const NEED_STEP: Record<OnboardingNeed, number> = { studyTime: 0, commitments: 1 };

function readStep(): number {
  try {
    const n = Number(window.localStorage.getItem(STEP_KEY));
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

function writeStep(n: number | null): void {
  try {
    if (n === null) window.localStorage.removeItem(STEP_KEY);
    else window.localStorage.setItem(STEP_KEY, String(n));
  } catch {
    /* storage blocked: the step is kept for this visit only */
  }
}

export function OnboardingView() {
  const { state, notify } = useStore();
  const doc = state.doc;
  const editors = useEditors();
  const today = useToday();
  const year = Number(today.slice(0, 4));
  const [step, setStepState] = useState(readStep);
  const [problem, setProblem] = useState<string | null>(null);
  const needs = onboardingNeeds(doc);

  const go = (n: number) => {
    setProblem(null);
    setStepState(n);
    writeStep(n);
  };

  const nextFromStudyTime = () => {
    if (doc.availability.length === 0) setProblem('Add at least one study-time window to continue.');
    else go(1);
  };

  const finish = () => {
    if (needs.length) return;
    writeStep(null);
    notify('Setup complete. You can change any of this later in Settings and Commitments.', { tone: 'success' });
    navigate({ name: 'day', date: today });
  };

  return (
    <div className="imp-page">
      <div className="page-header">
        <div>
          <h1 className="imp-h1">Set up your schedule</h1>
          <div className="page-subtitle">
            Two answers are required: when you can study and a short description of your commitments. Everything else is optional and can be changed later.
          </div>
        </div>
      </div>

      <ol className="imp-steps" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'past' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}>
            <span className="imp-step-num" aria-hidden="true">
              {i + 1}
            </span>
            <span>{label}</span>
            {i < step ? <span className="visually-hidden"> (completed)</span> : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <section className="card" aria-labelledby="ob-study">
          <div className="card-body stack">
            <h2 id="ob-study">When can you study? (required)</h2>
            <p className="muted">
              Add the times you are usually free for schoolwork, for example weekdays 3:30–9:30 PM and Saturday 10 AM–1 PM. Work is only planned inside
              these windows; busy commitments inside them are subtracted.
            </p>
            {doc.availability.length ? (
              <ul className="ls-items">
                {doc.availability.map((w) => (
                  <WindowRow key={w.id} window={w} today={today} year={year} />
                ))}
              </ul>
            ) : (
              <p className="muted">No study time yet.</p>
            )}
            <div className="row">
              <button type="button" className="btn" onClick={() => editors.open({ kind: 'availability' })}>
                <Icon name="plus" size={14} /> Add study time
              </button>
            </div>
            {problem ? (
              <p className="banner warning" role="alert">
                <Icon name="warning" /> {problem}
              </p>
            ) : null}
            <div className="row">
              <button type="button" className="btn primary" onClick={nextFromStudyTime}>
                Next
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="card" aria-labelledby="ob-commitments">
          <div className="card-body stack">
            <h2 id="ob-commitments">What are your commitments? (required)</h2>
            <p className="muted">
              A brief description is enough. It is kept with your schedule for you and for the /academic-schedule skill. To keep planned work away from a
              commitment, also add it as a commitment below.
            </p>
            <CommitmentsDescriptionForm submitLabel="Save and continue" onSaved={() => go(2)} />
            <h3>Commitments on the calendar (optional)</h3>
            {doc.events.length ? (
              <ul className="ls-items">
                {doc.events.map((e) => (
                  <EventRow key={e.id} event={e} today={today} year={year} />
                ))}
              </ul>
            ) : null}
            <div className="row">
              <button type="button" className="btn" onClick={() => editors.open({ kind: 'event' })}>
                <Icon name="plus" size={14} /> Add a commitment
              </button>
              <button type="button" className="btn ghost" onClick={() => go(0)}>
                Back
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <p className="muted">Optional. The defaults suit most students; save only if you change something.</p>
          <SettingsForm />
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => go(1)}>
              Back
            </button>
            <button type="button" className="btn primary" onClick={() => go(3)}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <section className="card" aria-labelledby="ob-data">
          <div className="card-body stack">
            <h2 id="ob-data">Classes and data (optional)</h2>
            <p className="muted">
              {doc.classes.length ? `${doc.classes.length} ${doc.classes.length === 1 ? 'class' : 'classes'} so far. ` : ''}
              Add classes by hand, or import a schedule file: the browser extension exports your Google Classroom classes to a ZIP, the /academic-schedule
              skill turns it into a schedule file, and Import adds it here with a preview first. You can do this later.
            </p>
            <div className="row">
              <button type="button" className="btn" onClick={() => editors.open({ kind: 'class' })}>
                <Icon name="plus" size={14} /> Add a class
              </button>
              <a className="btn" href={routeToHash({ name: 'import' })}>
                <Icon name="upload" /> Import a schedule file
              </a>
            </div>
            <ClassroomSyncCard />
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => go(2)}>
                Back
              </button>
              <button type="button" className="btn primary" onClick={() => go(4)}>
                Next
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section className="card" aria-labelledby="ob-review">
          <div className="card-body stack">
            <h2 id="ob-review">Review</h2>
            <dl className="ob-review">
              <dt>Study time</dt>
              <dd>{doc.availability.length ? `${doc.availability.length} ${doc.availability.length === 1 ? 'window' : 'windows'}` : 'Missing'}</dd>
              <dt>Your commitments</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{doc.settings?.commitmentsDescription?.trim() || 'Missing'}</dd>
              <dt>Commitments on the calendar</dt>
              <dd>{doc.events.length ? `${doc.events.length}` : 'None yet (optional)'}</dd>
              <dt>Classes</dt>
              <dd>{doc.classes.length ? `${doc.classes.length}` : 'None yet (optional)'}</dd>
              <dt>How work will be planned</dt>
              <dd>
                <ul>
                  {describePlannerRules(resolveSettings(doc.settings)).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </dd>
            </dl>
            {needs.length ? (
              <div className="banner warning" role="alert">
                <Icon name="warning" />
                <span>
                  Still required:{' '}
                  {needs.map((need, i) => (
                    <span key={need}>
                      {i ? ' and ' : ''}
                      <button type="button" className="btn small" onClick={() => go(NEED_STEP[need])}>
                        {need === 'studyTime' ? 'study time' : 'a description of your commitments'}
                      </button>
                    </span>
                  ))}
                  .
                </span>
              </div>
            ) : null}
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => go(3)}>
                Back
              </button>
              <button type="button" className="btn primary" onClick={finish} disabled={needs.length > 0}>
                Finish setup
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
