// Settings → "Reading announcements with AI" (SPEC.md § 15.4, § 17.3, § 18.3):
// whether it is set up, the automation choice, what was read and reused,
// what is waiting, the daily budget, and what is sent to the AI provider.
import { useState } from 'react';
import { runAnalysis } from '../lib/ai/api';
import { getAutoApply, setAiStatus, setAutoApply, useAiStatus } from '../state/aiStore';
import { useStore } from '../state/store';
import { routeToHash } from '../router';
import { useFirstSchedule } from './useFirstSchedule';
import { AiUsage } from './AiUsage';

export function AiAnalysisCard() {
  const { notify } = useStore();
  const status = useAiStatus();
  const [auto, setAuto] = useState(getAutoApply);
  const [busy, setBusy] = useState(false);
  const first = useFirstSchedule();

  const analyze = async () => {
    setBusy(true);
    const result = await runAnalysis(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if ('error' in result) notify(result.error, { tone: 'error' });
    else {
      setAiStatus(result);
      notify(result.message ?? 'Classroom texts read. New findings are on the Review page.', { tone: result.message ? 'warning' : 'success' });
    }
  };

  const last = status?.lastRun;
  return (
    <section className="card" aria-labelledby="ai-head">
      <div className="card-header">
        <h2 id="ai-head">Reading announcements with AI</h2>
      </div>
      <div className="card-body stack">
        {!status ? (
          <p className="small muted">Available on the online version of this website after you sign in with Google above.</p>
        ) : !status.configured ? (
          <p className="small muted">AI reading is not set up on this website’s server.</p>
        ) : (
          <>
            <p className="small">
              After each sync, an AI reads new or changed announcements, assignment instructions and course documents for changed due dates, announced quizzes and tests, estimates how long each assignment takes, and notes stated
              time estimates. It never does your work. Findings go to <a href={routeToHash({ name: 'review' })}>Review</a>.
            </p>
            <label className="small">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAutoApply(e.target.checked);
                  setAuto(e.target.checked);
                }}
              />{' '}
              Apply sure, stated findings that fill a gap (no due date yet, a new quiz, no estimate yet) without asking. You can undo them. Everything else, and
              anything that would change a date you or Classroom set, waits in Review.
            </label>
            <p className="small" role="status">
              {last
                ? `Last read ${new Date(last.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${last.trigger === 'background' ? ' (daily background check)' : ''}: ${last.analyzed} read, ${last.reused} unchanged and reused${last.failed ? `, ${last.failed} could not be read` : ''}.`
                : 'Nothing read yet.'}{' '}
              {last?.error ? `It stopped: ${last.error} ` : ''}
              {status.pending ? `${status.pending} new or changed texts are waiting. ` : ''}
              {status.runs ? `${status.runs.used} of ${status.runs.limit} planning runs used in the last 24 hours` : ''}
              {status.runs?.nextAt ? ` (next one ${new Date(status.runs.nextAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : ''}
              {status.runs ? '; ' : ''}
              {status.budget.used} of {status.budget.limit} AI requests used.
            </p>
            <div className="row">
              <button
                type="button"
                className="btn primary"
                onClick={() => void first.build(true, 'Schedule built.')}
                disabled={first.building || busy || (!status.setupAvailable && !!status.runs && status.runs.used >= status.runs.limit)}
              >
                {first.building ? 'Building your schedule…' : status.setupAvailable ? 'Build my schedule with AI (free, once)' : 'Plan my schedule with AI'}
              </button>
              <span className="small muted">
                Reads everything synced and your description of your commitments, adds those commitments to the calendar, estimates the work (with steps for bigger
                work) and plans it in your free time. {status.setupAvailable ? 'Not counted toward the 3 daily runs.' : 'Counts as one of the 3 daily runs.'}
              </span>
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => void analyze()} disabled={busy || first.building || (!!status.runs && status.runs.used >= status.runs.limit)}>
                {busy ? 'Reading…' : 'Read new announcements now'}
              </button>
            </div>
            {status.usage ? <AiUsage usage={status.usage} /> : null}
            <p className="small muted">
              Sent to the AI provider ({status.model}): the class name, the titles and due dates of its assignments, the text of new or changed announcements,
              instructions and course documents (the first 20,000 characters of each), and, when you plan your schedule, your description of your commitments.
              Nothing else, and only when there is something new to read.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
