// First-run setup (SPEC.md § 5), streamlined (lib/onboarding.ts records the
// owner decisions): short welcome slides, then three steps. 1. Get your work
// in: Google Classroom, a file import, or start empty. 2. When do you usually
// study: a one-tap preset, or the detailed editor; this is the only required
// answer. Continuing builds the first schedule (lib/ai/firstSchedule.ts): with
// AI set up, the free setup run reads and estimates everything brought in; the
// fixed-rule planner then places the work, undoable in one step. 3. Your plan:
// what the planner promises, and "Start with one thing" shortcuts into the app.
// The commitments description waits in the app's "Finish setting up" card.
// Every answer is saved in the schedule as soon as it is given, and the current
// step in this browser, so the wizard resumes after a refresh.
import { useEffect, useRef, useState } from 'react';
import '../styles/import.css';
import '../styles/lists.css';
import '../styles/onboarding.css';
import { useStore } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { Icon, type IconName } from '../ui/Icon';
import { useToday } from '../ui/hooks';
import { navigate, routeToHash, type Route } from '../router';
import { MOTTO } from '../model/constants';
import { LatticeMark, Wordmark } from '../ui/LatticeMark';
import { STUDY_PRESETS, commitmentsDescriptionMissing, markSetupInProgress, onboardingNeeds, presetChanges, selectedPreset } from '../lib/onboarding';
import { nowLocal } from '../lib/time';
import { useAiStatus } from '../state/aiStore';
import { useFirstSchedule } from './useFirstSchedule';
import { ClassroomSyncCard } from './ClassroomSyncCard';
import { WindowRow } from './CommitmentsView';
import { WelcomeSlides } from './onboarding/WelcomeSlides';

const STEPS = [
  { name: 'work', label: 'Get your work in' },
  { name: 'study', label: 'Study time' },
  { name: 'ready', label: 'Your plan' },
] as const;
type StepName = 'welcome' | (typeof STEPS)[number]['name'];
const STEP_KEY = 'academic-scheduler:onboarding-step';

function readStep(): StepName {
  try {
    const saved = window.localStorage.getItem(STEP_KEY);
    return STEPS.find((s) => s.name === saved)?.name ?? 'welcome';
  } catch {
    return 'welcome';
  }
}

function writeStep(step: StepName | null): void {
  try {
    if (step === null) window.localStorage.removeItem(STEP_KEY);
    else window.localStorage.setItem(STEP_KEY, step);
  } catch {
    /* storage blocked: the step is kept for this visit only */
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function OnboardingView() {
  const { state, dispatch } = useStore();
  const ai = useAiStatus();
  const { building, build } = useFirstSchedule();
  const freeAi = !!ai?.configured && ai.setupAvailable !== false;
  // After the free run is used, planning with AI is still offered as one of the 3 daily runs.
  const paidAi = !!ai?.configured && !freeAi;
  const runsLeft = !ai?.runs || ai.runs.used < ai.runs.limit;
  const doc = state.doc;
  const editors = useEditors();
  const today = useToday();
  const year = Number(today.slice(0, 4));
  const [saved, setSaved] = useState(readStep);
  const [problem, setProblem] = useState<string | null>(null);
  // Open when Google's sign-in returns here, so its result shows.
  const [googleOpen, setGoogleOpen] = useState(() => /[?&]google=/.test(window.location.hash));
  const needs = onboardingNeeds(doc);
  // The plan screen needs study time: without it (removed meanwhile), that step comes back.
  const step: StepName = saved === 'ready' && needs.length ? 'study' : saved;
  const stepIndex = STEPS.findIndex((s) => s.name === step);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef(step);

  // From "Get your work in" on (Google sign-in, sync, import), leaving the wizard leads back to it until the person enters the app.
  useEffect(() => {
    if (step !== 'welcome') markSetupInProgress(true);
  }, [step]);

  // Move focus to the new step's heading (the slide title when back on the welcome slides) so that screen readers announce it.
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  const go = (next: StepName) => {
    setProblem(null);
    setSaved(next);
    writeStep(next);
  };

  const choosePreset = (id: string) => {
    const { remove, add } = presetChanges(doc, id, today);
    const now = nowLocal();
    for (const removed of remove) dispatch({ type: 'deleteAvailability', id: removed, now });
    for (const item of add) dispatch({ type: 'upsertAvailability', item });
    setProblem(null);
  };

  const plan = async (useAi: boolean) => {
    if (building) return;
    if (needs.length) {
      setProblem('Choose when you usually study (or customize it) to continue.');
      return;
    }
    if (await build(useAi, 'Your first schedule is ready.')) go('ready');
  };

  const enter = (route: Route) => {
    writeStep(null);
    markSetupInProgress(false);
    navigate(route);
  };

  const pickedPreset = selectedPreset(doc.availability);
  const imported = doc.classes.length + doc.assignments.length > 0;
  const upcoming = doc.scheduleBlocks.filter((b) => b.start >= today).length;
  const shortcuts: Array<{ icon: IconName; title: string; text: string; route: Route }> = [
    { icon: 'day', title: 'See today’s plan', text: 'What to work on now, and what must be done today.', route: { name: 'day', date: today } },
    { icon: 'list', title: 'Check what’s due', text: 'Every assignment, soonest deadline first.', route: { name: 'assignments' } },
    { icon: 'week', title: 'Look at your week', text: 'Your sessions spread over the next days.', route: { name: 'week', date: today } },
  ];

  return (
    <div className="imp-page ob-page">
      <div className="welcome-brand">
        <LatticeMark size={44} />
        <div>
          <Wordmark />
          <p className="motto">{MOTTO}</p>
        </div>
      </div>
      <div className="page-header">
        <div>
          <h1 className="imp-h1">Set up your schedule</h1>
          <div className="page-subtitle">Three quick steps. Only your study time is needed now; everything else can wait.</div>
        </div>
      </div>

      {step === 'welcome' ? <WelcomeSlides onDone={() => go('work')} titleRef={headingRef} /> : null}

      {step !== 'welcome' ? (
        <ol className="imp-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.name} className={i < stepIndex ? 'past' : i === stepIndex ? 'current' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
              <span className="imp-step-num" aria-hidden="true">
                {i + 1}
              </span>
              <span>{s.label}</span>
              {i < stepIndex ? <span className="visually-hidden"> (completed)</span> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {step === 'work' ? (
        <section className="card" aria-labelledby="ob-work">
          <div className="card-body stack">
            <h2 id="ob-work" ref={headingRef} tabIndex={-1} className="ob-step-title">
              Get your work in
            </h2>
            <p className="muted">Bring in your classes and assignments so there is something to plan. You can add more at any time with Import.</p>
            <div className="ob-choices">
              <button type="button" className="ob-choice" aria-expanded={googleOpen} onClick={() => setGoogleOpen((open) => !open)}>
                <span className="ob-choice-icon" aria-hidden="true">
                  <Icon name="book" size={20} />
                </span>
                <span className="ob-choice-text">
                  <strong>Google Classroom</strong>
                  <span className="small muted">Sign in with Google, or send your classes from the browser extension.</span>
                </span>
              </button>
              <a className="ob-choice" href={routeToHash({ name: 'import' })}>
                <span className="ob-choice-icon" aria-hidden="true">
                  <Icon name="upload" size={20} />
                </span>
                <span className="ob-choice-text">
                  <strong>Import a file</strong>
                  <span className="small muted">A .json schedule file from the /academic-schedule skill or a backup, or a Google Calendar export (.ics). You see a preview first.</span>
                </span>
              </a>
              <button type="button" className="ob-choice" onClick={() => go('study')}>
                <span className="ob-choice-icon" aria-hidden="true">
                  <Icon name="plus" size={20} />
                </span>
                <span className="ob-choice-text">
                  <strong>Start empty</strong>
                  <span className="small muted">Add classes and assignments yourself later.</span>
                </span>
              </button>
            </div>
            {googleOpen ? <ClassroomSyncCard analyze={false} /> : null}
            {imported ? (
              <p className="small" role="status">
                <Icon name="check" size={14} /> In your schedule so far: {plural(doc.classes.length, 'class', 'classes')}, {plural(doc.assignments.length, 'assignment', 'assignments')}.
              </p>
            ) : null}
            <div className="row ob-actions">
              <button type="button" className="btn ghost" onClick={() => go('welcome')}>
                Back
              </button>
              <span className="spacer" />
              {imported ? (
                <button type="button" className="btn primary" onClick={() => go('study')}>
                  Continue
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {step === 'study' ? (
        <section className="card" aria-labelledby="ob-study">
          <div className="card-body stack">
            <h2 id="ob-study" ref={headingRef} tabIndex={-1} className="ob-step-title">
              When do you usually study?
            </h2>
            <p className="muted">Pick what is closest. Work is only planned inside these hours, around your commitments. You can change it at any time.</p>
            <div className="ob-choices" role="group" aria-label="Study time">
              {STUDY_PRESETS.map((p) => (
                <button key={p.id} type="button" className="ob-choice ob-preset" aria-pressed={pickedPreset === p.id} onClick={() => choosePreset(p.id)} disabled={building}>
                  <span className="ob-choice-text">
                    <strong>{p.label}</strong>
                    <span className="small muted">{p.hint}</span>
                  </span>
                  {pickedPreset === p.id ? (
                    <span className="ob-choice-check" aria-hidden="true">
                      <Icon name="check" size={16} />
                    </span>
                  ) : null}
                </button>
              ))}
              <button type="button" className="ob-choice ob-preset" onClick={() => editors.open({ kind: 'availability' })} disabled={building}>
                <span className="ob-choice-text">
                  <strong>Customize</strong>
                  <span className="small muted">Set your own days and times.</span>
                </span>
              </button>
            </div>
            {doc.availability.length ? (
              <ul className="ls-items" aria-label="Your study time">
                {doc.availability.map((w) => (
                  <WindowRow key={w.id} window={w} today={today} year={year} disabled={building} />
                ))}
              </ul>
            ) : null}
            <p className="small muted">
              {freeAi
                ? 'Continuing reads your classes, announcements and documents with AI (free this once, not counted toward the 3 daily planning runs), estimates how long each assignment takes, and plans the work into your study time.'
                : paidAi
                  ? 'Planning with AI reads your classes, announcements and documents, estimates the work and plans it into your study time. It counts as one of the 3 daily planning runs (the free one is used).'
                  : 'Continuing plans the work that has a time estimate into your study time.'}
              {!ai ? ' To have the AI read your classes and estimate the work (free once), sign in with Google under “Get your work in” first.' : ''}
            </p>
            {problem ? (
              <p className="banner warning" role="alert">
                <Icon name="warning" /> {problem}
              </p>
            ) : null}
            <div className="row ob-actions">
              <button type="button" className="btn ghost" onClick={() => go('work')}>
                Back
              </button>
              <span className="spacer" />
              {paidAi ? (
                <>
                  <button type="button" className="btn" onClick={() => void plan(false)} disabled={building}>
                    Plan without AI
                  </button>
                  <button type="button" className="btn primary" onClick={() => void plan(true)} disabled={building || !runsLeft}>
                    {building ? 'Building your plan…' : 'Plan with AI'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn primary" onClick={() => void plan(freeAi)} disabled={building}>
                  {building ? 'Building your plan…' : 'Build my plan'}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {step === 'ready' ? (
        <section className="card" aria-labelledby="ob-ready">
          <div className="card-body stack">
            <h2 id="ob-ready" ref={headingRef} tabIndex={-1} className="ob-step-title">
              Your plan is ready
            </h2>
            <p>
              {upcoming
                ? `${plural(upcoming, 'work session is', 'work sessions are')} on your calendar.`
                : doc.assignments.length
                  ? 'No work session could be planned yet; the Day view shows what does not fit and why.'
                  : 'There is nothing to plan yet. When you add or import assignments, they are planned into your study time.'}
            </p>
            <ul className="ob-promises">
              <li>
                <Icon name="check" size={14} /> Nothing is planned after its due date.
              </li>
              <li>
                <Icon name="check" size={14} /> Sessions you move or add yourself stay where you put them.
              </li>
              <li>
                <Icon name="check" size={14} /> Every change can be undone.
              </li>
            </ul>
            {commitmentsDescriptionMissing(doc) ? (
              <p className="small muted">Later, describe your commitments (practice, a job, family duties) in the “Finish setting up” card, so planning keeps clear of them.</p>
            ) : null}
            <h3 id="ob-one-thing">Start with one thing</h3>
            <div className="ob-choices" role="group" aria-labelledby="ob-one-thing">
              {shortcuts.map((s) => (
                <button key={s.title} type="button" className="ob-choice" onClick={() => enter(s.route)}>
                  <span className="ob-choice-icon" aria-hidden="true">
                    <Icon name={s.icon} size={20} />
                  </span>
                  <span className="ob-choice-text">
                    <strong>{s.title}</strong>
                    <span className="small muted">{s.text}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row ob-actions">
              <button type="button" className="btn ghost" onClick={() => go('study')}>
                Back
              </button>
              <span className="spacer" />
              <button type="button" className="btn primary" onClick={() => enter({ name: 'day', date: today })}>
                Just take me in
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
