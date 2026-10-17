// Review (SPEC.md § 16.4): what the AI read in Classroom announcements and
// instructions that needs the person's decision. Each item shows the field,
// the current and proposed values, the quoted source, why it was not applied
// on its own, and Apply / Edit / Reject / Later. Decisions are stored on the
// server, so a decided item does not come back unless the evidence changes.
import { useState } from 'react';
import type { AiProposal } from '../model/aiProposal';
import { ASSIGNMENT_TYPE_LABELS } from '../model/constants';
import { recordDecision, runAnalysis, type Decision } from '../lib/ai/api';
import { applyProposal, planApplied, reviewItems, workOf, type ReviewItem } from '../lib/ai/proposals';
import { formatDuration, nowLocal } from '../lib/time';
import { forgetProposals, setAiStatus, useAiStatus } from '../state/aiStore';
import { useStore } from '../state/store';
import { routeToHash } from '../router';
import { EmptyState } from '../ui/common';
import { formatWhen, safeHref } from './lists/format';
import { newSnapshotId } from './import/logic';
import { movedLine } from './timeline/RepairCard';

const CONFIDENCE_WORDS = { low: 'low', medium: 'medium', high: 'high' } as const;

function show(item: ReviewItem, value: string | number | undefined, year: number): string {
  if (value === undefined || value === '') return 'none';
  return item.field === 'estimate' ? formatDuration(Number(value)) : formatWhen(String(value), year);
}

function heading(item: ReviewItem): string {
  const p = item.proposal;
  if (item.field === 'new') return `New ${(ASSIGNMENT_TYPE_LABELS[p.type ?? 'other'] ?? 'assessment').toLowerCase()}: ${p.title}`;
  return `${item.field === 'due' ? 'Due date' : 'Workload estimate'} of “${item.assignment!.title}”`;
}

function sourceLine(p: AiProposal, year: number): string {
  if (p.kind === 'workload') return 'The AI estimated this from the assignment’s title, points, instructions and documents:';
  const what = { announcement: 'An announcement', coursework: 'The assignment’s instructions', document: 'A course document' }[p.source.kind];
  return p.source.postedAt ? `${what} (${formatWhen(p.source.postedAt, year)}) says:` : `${what} say${p.source.kind === 'coursework' ? '' : 's'}:`;
}

function sessionsLine({ sessions, moved, notPlanned }: { sessions: number; moved: number; notPlanned?: string }): string {
  const planned = sessions ? ` Planned ${sessions} work ${sessions === 1 ? 'session' : 'sessions'} in your free study time.` : '';
  return `${movedLine(moved)}${planned}${notPlanned ? ` ${sessions ? 'Some work could not be planned' : 'Nothing could be planned'}: ${notPlanned}` : ''}`;
}

function ReviewCard({ item, year, onDone }: { item: ReviewItem; year: number; onDone: (key: string, decision: Decision) => void }) {
  const { state, dispatch, notify } = useStore();
  const p = item.proposal;
  const [editing, setEditing] = useState(false);
  const initial = String(p.value);
  const [date, setDate] = useState(item.field === 'estimate' ? '' : initial.slice(0, 10));
  const [time, setTime] = useState(item.field === 'estimate' ? '' : initial.slice(11, 16));
  const [minutes, setMinutes] = useState(item.field === 'estimate' ? initial : '');
  const [problem, setProblem] = useState<string | null>(null);
  const href = safeHref(p.source.url);
  const headingId = `review-${p.key}`;

  const apply = () => {
    const value = !editing ? p.value : item.field === 'estimate' ? Number(minutes) : time ? `${date}T${time}:00` : date;
    if (editing && (item.field === 'estimate' ? !(Number(value) >= 5 && Number(value) <= 1440) : !/^\d{4}-\d{2}-\d{2}/.test(String(value)))) {
      setProblem(item.field === 'estimate' ? 'Enter minutes between 5 and 1440.' : 'Enter a date.');
      return;
    }
    const result = applyProposal(state.doc, item, true, value);
    if ('error' in result) {
      setProblem(result.error);
      return;
    }
    const planned = planApplied(result.doc, [workOf(item)]);
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: planned.doc, label: heading(item), now: nowLocal(), snapshotId, details: planned.changes });
    notify(`Applied: ${heading(item)}.${sessionsLine(planned)}`, { tone: planned.sessions || !planned.notPlanned ? 'success' : 'warning', action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId }) } });
    onDone(p.key, 'applied');
  };

  return (
    <article className="card" aria-labelledby={headingId}>
      <div className="card-body stack">
        <h2 id={headingId}>
          {heading(item)}
        </h2>
        <div className="small muted">{item.className}</div>
        <dl className="ls-class-stats">
          {item.field !== 'new' ? (
            <div>
              <dt>Now</dt>
              <dd>{show(item, item.previous, year)}</dd>
            </div>
          ) : null}
          <div>
            <dt>{item.field === 'new' ? (p.type && ['quiz', 'test', 'exam', 'presentation'].includes(p.type) ? 'Date' : 'Due') : 'Proposed'}</dt>
            <dd>{show(item, p.value, year)}</dd>
          </div>
        </dl>
        <div>
          <div className="small">{sourceLine(p, year)}</div>
          <blockquote className="ls-text small">{p.kind === 'workload' ? p.excerpt : `“${p.excerpt}”`}</blockquote>
          {href ? (
            <a className="small" href={href} target="_blank" rel="noopener noreferrer">
              Open in Classroom<span className="visually-hidden"> (opens in a new tab)</span>
            </a>
          ) : null}
        </div>
        {item.reasons.length || p.note ? (
          <div>
            <div className="small">Why this needs you:</div>
            <ul className="small">
              {item.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {p.note ? <li>The AI noted: {p.note}</li> : null}
            </ul>
          </div>
        ) : null}
        <div className="small muted">
          Confidence — {item.field === 'new' ? 'that it is new' : 'which work'}: {CONFIDENCE_WORDS[p.confidence.identity]}, {item.field === 'estimate' ? 'time' : 'date'}:{' '}
          {CONFIDENCE_WORDS[p.confidence.value]}. {p.kind === 'workload' ? 'An estimate, not stated by the teacher.' : p.explicit ? 'Stated in the text.' : 'Worked out, not stated.'}
        </div>
        {editing ? (
          <div className="row">
            {item.field === 'estimate' ? (
              <label>
                Minutes <input type="number" min={5} max={1440} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </label>
            ) : (
              <>
                <label>
                  Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label>
                  Time (optional) <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </label>
              </>
            )}
          </div>
        ) : null}
        {problem ? (
          <p className="small" role="alert">
            {problem}
          </p>
        ) : null}
        <div className="row">
          <button type="button" className="btn primary" onClick={apply}>
            {editing ? 'Apply my value' : 'Apply'}
          </button>
          {!editing ? (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => onDone(p.key, 'rejected')}>
            Reject
          </button>
          <button type="button" className="btn ghost" onClick={() => onDone(p.key, 'deferred')}>
            Later
          </button>
        </div>
      </div>
    </article>
  );
}

export function ReviewView() {
  const { state, dispatch, notify } = useStore();
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const year = Number(nowLocal().slice(0, 4));
  const items = status ? reviewItems(state.doc, status.proposals) : [];

  const decide = (key: string, decision: Decision) => {
    forgetProposals([key]);
    void recordDecision(key, decision).then((ok) => {
      if (!ok) notify('Your decision could not be saved on the server; it may be asked again.', { tone: 'warning' });
    });
  };

  /** Applies every item as proposed, then plans the work: one undoable change. */
  const applyAll = () => {
    let work = state.doc;
    const applied: string[] = [];
    const ids: string[] = [];
    let failed = 0;
    for (const item of items) {
      const result = applyProposal(work, item, true);
      if ('error' in result) {
        failed++;
        continue;
      }
      work = result.doc;
      applied.push(item.proposal.key);
      ids.push(workOf(item));
    }
    if (!applied.length) {
      notify('None of the findings could be applied; open each one to see why.', { tone: 'warning' });
      return;
    }
    const planned = planApplied(work, ids);
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc: planned.doc, label: 'Applied the AI findings', now: nowLocal(), snapshotId, details: planned.changes });
    for (const key of applied) decide(key, 'applied');
    notify(`Applied ${applied.length} ${applied.length === 1 ? 'finding' : 'findings'}.${sessionsLine(planned)}${failed ? ` ${failed} could not be applied; they are still listed.` : ''}`, {
      tone: failed ? 'warning' : 'success',
      action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId }) },
    });
  };

  const analyze = async () => {
    setBusy(true);
    const result = await runAnalysis(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setBusy(false);
    if ('error' in result) notify(result.error, { tone: 'error' });
    else {
      setAiStatus(result);
      if (result.message) notify(result.message, { tone: 'warning' });
    }
  };

  return (
    <div className="page stack">
      <h1>Review</h1>
      <p className="muted">
        Changes the AI read in your Classroom announcements, assignment instructions and course documents. Safe ones are applied for you (with Undo) if you allow it in{' '}
        <a href={routeToHash({ name: 'settings' })}>Settings</a>; everything else waits here. The AI only reads dates and times; it never does your work.
      </p>
      {!status?.configured ? (
        <EmptyState title="Nothing to review">
          AI reading needs the online version of this website with AI set up, and Google Classroom sync (sign in under Settings).
        </EmptyState>
      ) : (
        <>
          <div className="row">
            <button type="button" className="btn" onClick={() => void analyze()} disabled={busy}>
              {busy ? 'Reading…' : 'Read new announcements now'}
            </button>
            {items.length > 1 ? (
              <button type="button" className="btn primary" onClick={applyAll}>
                Apply all {items.length}
              </button>
            ) : null}
            {status.pending ? <span className="small muted">{status.pending} new or changed texts not read yet.</span> : null}
          </div>
          {items.length === 0 ? (
            <EmptyState title="Nothing to review">Everything the AI found is applied or decided.</EmptyState>
          ) : (
            items.map((item) => <ReviewCard key={item.proposal.key} item={item} year={year} onDone={decide} />)
          )}
        </>
      )}
    </div>
  );
}
