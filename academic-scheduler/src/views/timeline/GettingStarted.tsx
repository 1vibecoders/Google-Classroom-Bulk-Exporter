// Setup guide on the day and week views. On an empty schedule: a welcome card
// with the steps to build a schedule by hand, or import one made by
// /academic-schedule. On a partly set-up schedule: a compact "finish setting
// up" checklist (finished steps ticked) that the person can hide. The checklist
// also asks for the description of the person's commitments, which setup lets
// them leave for later (lib/onboarding.ts), with the form right in the card.
import { useEffect, useRef, useState } from 'react';
import type { ScheduleDocument } from '../../model/types';
import { useEditors } from '../../editors/EditorHost';
import { routeToHash } from '../../router';
import { useStore } from '../../state/store';
import { useAiStatus } from '../../state/aiStore';
import { commitmentsDescriptionMissing } from '../../lib/onboarding';
import { Icon, type IconName } from '../../ui/Icon';
import { CommitmentsDescriptionForm } from '../CommitmentsDescriptionForm';
import { isEmptyDocument, setupSteps, type SetupStepKind } from './logic';

const STEPS: Record<SetupStepKind, { icon: IconName; title: string; text: string; button: string }> = {
  class: { icon: 'book', title: 'Add your classes', text: 'Name, teacher and a color for each course.', button: 'Add a class' },
  event: { icon: 'calendar', title: 'Add your commitments', text: 'School hours, practice, lessons, appointments — anything that takes your time.', button: 'Add a commitment' },
  availability: { icon: 'clock', title: 'Add your study time', text: 'When you are usually free for schoolwork, e.g. weekdays 3:30–9:30 PM.', button: 'Add study time' },
  assignment: { icon: 'list', title: 'Add assignments', text: 'Due dates and how long each will take; then place work blocks on the timeline.', button: 'Add an assignment' },
};

const HIDE_KEY = 'academic-scheduler:setup-guide-hidden';

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function GettingStarted({ doc }: { doc: ScheduleDocument }) {
  const editors = useEditors();
  const { notify } = useStore();
  const ai = useAiStatus();
  const [hidden, setHidden] = useState(readHidden);
  const [writing, setWriting] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  const empty = isEmptyDocument(doc);
  const steps = setupSteps(doc);
  // The description counts as a step of the checklist (not of the empty-schedule welcome).
  const describe = !empty && commitmentsDescriptionMissing(doc);
  const total = steps.length + (empty ? 0 : 1);
  const remaining = steps.filter((s) => !s.done).length + (describe ? 1 : 0);
  useEffect(() => {
    if (writing) formRef.current?.querySelector('textarea')?.focus();
  }, [writing]);
  // After saving, the form and its button are gone: move focus to the card title so it does not fall to the page.
  useEffect(() => {
    if (!focusTitle.current) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });
  if (remaining === 0 || (!empty && hidden)) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY, '1');
    } catch {
      /* storage blocked: hidden for this visit only */
    }
  };

  return (
    <section className={`card getting-started no-print${empty ? '' : ' is-partial'}`} aria-labelledby="gs-title">
      <div className="card-body stack">
        <div className="gs-head">
          <div>
            <h2 id="gs-title" ref={titleRef} tabIndex={-1}>{empty ? 'Welcome — let’s set up your schedule' : 'Finish setting up'}</h2>
            <p className="muted gs-lead">
              {empty
                ? 'Build it by hand in four steps, or import a schedule file made by the /academic-schedule skill. Everything stays in this browser.'
                : `${total - remaining} of ${total} steps done. The rest makes free time, over-capacity warnings and planning work.`}
            </p>
          </div>
          {!empty ? (
            <button type="button" className="btn ghost small gs-hide" onClick={hide} aria-label="Hide the setup guide">
              Hide
            </button>
          ) : null}
        </div>
        <ol className="gs-steps">
          {describe ? (
            <li>
              <span className="gs-num" aria-hidden="true">
                <Icon name="edit" size={14} />
              </span>
              <div className="gs-text">
                <strong>Describe your commitments</strong>
                <span className="muted small">School hours, practice, a job, in your own words. With AI, they become commitments on your calendar.</span>
              </div>
              <button type="button" className="btn small" aria-expanded={writing} aria-controls={writing ? 'gs-describe-form' : undefined} onClick={() => setWriting((w) => !w)}>
                {writing ? 'Not now' : 'Describe them'}
              </button>
            </li>
          ) : null}
          {steps.map((step, i) => {
            const info = STEPS[step.kind];
            return (
              <li key={step.kind} className={step.done ? 'is-done' : undefined}>
                <span className="gs-num" aria-hidden="true">
                  {step.done ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <div className="gs-text">
                  <strong>
                    <Icon name={info.icon} size={14} /> {info.title}
                    {step.done ? <span className="visually-hidden"> (done)</span> : null}
                  </strong>
                  <span className="muted small">{step.done ? `Done: ${step.count} added.` : info.text}</span>
                </div>
                {!step.done ? (
                  <button type="button" className="btn small" onClick={() => editors.open({ kind: step.kind })}>
                    {info.button}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
        {describe && writing ? (
          <div ref={formRef} id="gs-describe-form">
            <CommitmentsDescriptionForm
              onSaved={() => {
                focusTitle.current = true;
                setWriting(false);
                notify(ai?.configured ? 'Commitments saved. “Plan my schedule with AI” in Settings adds them to your calendar.' : 'Commitments saved.', { tone: 'success' });
              }}
            />
          </div>
        ) : null}
        {empty ? (
          <div className="row gs-alt">
            <a className="btn primary" href={routeToHash({ name: 'import' })}>
              <Icon name="upload" />
              Import a schedule
            </a>
            <a className="btn ghost" href={routeToHash({ name: 'settings' })}>
              Try the example schedule (Settings → Data)
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
