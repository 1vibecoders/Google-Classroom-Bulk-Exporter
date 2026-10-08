// Setup guide on the day and week views. On an empty schedule: a welcome card
// with the steps to build a schedule by hand, or import one made by
// /academic-schedule. On a partly set-up schedule: a compact "finish setting
// up" checklist (finished steps ticked) that the person can hide.
import { useState } from 'react';
import type { ScheduleDocument } from '../../model/types';
import { useEditors } from '../../editors/EditorHost';
import { routeToHash } from '../../router';
import { Icon, type IconName } from '../../ui/Icon';
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
  const [hidden, setHidden] = useState(readHidden);
  const empty = isEmptyDocument(doc);
  const steps = setupSteps(doc);
  const remaining = steps.filter((s) => !s.done).length;
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
            <h2 id="gs-title">{empty ? 'Welcome — let’s set up your schedule' : 'Finish setting up'}</h2>
            <p className="muted gs-lead">
              {empty
                ? 'Build it by hand in four steps, or import a schedule file made by the /academic-schedule skill. Everything stays in this browser.'
                : `${steps.length - remaining} of ${steps.length} steps done. The rest makes free time, over-capacity warnings and planning work.`}
            </p>
          </div>
          {!empty ? (
            <button type="button" className="btn ghost small gs-hide" onClick={hide} aria-label="Hide the setup guide">
              Hide
            </button>
          ) : null}
        </div>
        <ol className="gs-steps">
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
