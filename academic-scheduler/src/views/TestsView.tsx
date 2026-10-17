// Tests (SPEC.md § 25, § 27.4): upcoming quizzes, tests and exams with their
// study topics, how much preparation is done, planned and still unplanned, and
// the preparation sessions. Topics come from the AI (it reads the class
// materials that look relevant; each topic keeps its source) or from the
// person; their status (not started → comfortable) decides what the next
// sessions cover (src/lib/studyPlan.ts). Dates and scope are corrected in the
// assignment editor.
import { useMemo, useState } from 'react';
import type { Assignment, StudyTopic, TopicStatus } from '../model/types';
import { TOPIC_STATUSES, TOPIC_STATUS_LABELS } from '../model/constants';
import { recordDecision, runAnalysis } from '../lib/ai/api';
import { applyProposal, planApplied, reviewItems } from '../lib/ai/proposals';
import { formatDuration, nowLocal } from '../lib/time';
import { upcomingAssessments } from '../lib/studyPlan';
import { progressByAssignment, type AssignmentProgress } from '../lib/workload';
import { useEditors } from '../editors/EditorHost';
import { forgetProposals, setAiStatus, useAiStatus } from '../state/aiStore';
import { useStore } from '../state/store';
import { EmptyState } from '../ui/common';
import { useNow } from '../ui/hooks';
import { newSnapshotId } from './import/logic';
import { formatBlockTime, formatWhen, relativeDays, safeHref } from './lists/format';
import { TOPIC_BASIS_WORDS } from './ReviewView';
import { LatticeMeter, type MeterCell } from '../ui/LatticeMeter';

const CELL: Record<TopicStatus, MeterCell> = { comfortable: 'full', in_progress: 'part', needs_review: 'flag', not_started: 'empty' };

export function TestsView() {
  const { state } = useStore();
  const now = useNow();
  const today = now.slice(0, 10);
  const tests = useMemo(() => upcomingAssessments(state.doc, today), [state.doc, today]);
  const progress = useMemo(() => progressByAssignment(state.doc, now), [state.doc, now]);
  return (
    <div className="page stack">
      <h1>Tests</h1>
      <p className="muted">
        Upcoming quizzes, tests and exams with what to study. Mark how ready you feel on each topic: topics that need more review come first in your next
        preparation sessions, and comfortable ones drop out.
      </p>
      {tests.length === 0 ? (
        <EmptyState title="No upcoming tests">Quizzes, tests and exams from Classroom, a schedule file or the AI appear here with their study topics.</EmptyState>
      ) : (
        tests.map((a) => <TestCard key={a.id} assignment={a} today={today} now={now} progress={progress.get(a.id)} />)
      )}
    </div>
  );
}

function TestCard({ assignment: a, today, now, progress: p }: { assignment: Assignment; today: string; now: string; progress?: AssignmentProgress }) {
  const { state, dispatch, notify } = useStore();
  const editors = useEditors();
  const ai = useAiStatus();
  const [newTopic, setNewTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const year = Number(today.slice(0, 4));
  const date = a.assessmentDate ?? a.due;
  const className = state.doc.classes.find((c) => c.id === a.classId)?.name;
  const topics = a.studyTopics ?? [];
  const suggestion = ai?.configured ? reviewItems(state.doc, ai.proposals).find((i) => i.field === 'topics' && i.assignment?.id === a.id) : undefined;
  const sessions = (p?.blocks ?? []).filter((b) => (b.status ?? 'planned') === 'planned' && (b.kind ?? 'work') === 'work' && b.end > now);
  const headingId = `test-${a.id}`;

  const setTopics = (next: StudyTopic[]) => dispatch({ type: 'setStudyTopics', id: a.id, topics: next, now: nowLocal() });
  const setStatus = (t: StudyTopic, status: TopicStatus) => setTopics(topics.map((x) => (x.id === t.id ? { ...x, status } : x)));
  const remove = (t: StudyTopic) => {
    setTopics(topics.filter((x) => x.id !== t.id));
    notify(`Removed “${t.title}”.`, { tone: 'success', action: { label: 'Undo', run: () => setTopics(topics) } });
  };
  const add = () => {
    const title = newTopic.trim().slice(0, 200);
    if (!title) return;
    let n = topics.length + 1;
    while (topics.some((t) => t.id === `mine-${n}`)) n++;
    setTopics([...topics, { id: `mine-${n}`, title, basis: 'user' }]);
    setNewTopic('');
  };
  const commit = (doc: typeof state.doc, label: string, message: string) => {
    const snapshotId = newSnapshotId();
    dispatch({ type: 'replaceDocument', doc, label, now: nowLocal(), snapshotId });
    notify(message, { tone: 'success', action: { label: 'Undo', run: () => dispatch({ type: 'undo', snapshotId }) } });
  };
  const acceptSuggestion = () => {
    if (!suggestion) return;
    const result = applyProposal(state.doc, suggestion, true);
    if ('error' in result) {
      notify(result.error, { tone: 'error' });
      return;
    }
    commit(result.doc, `Study topics for ${a.title}`, `Added the AI’s study topics for “${a.title}”.`);
    forgetProposals([suggestion.proposal.key]);
    void recordDecision(suggestion.proposal.key, 'applied');
  };
  const rejectSuggestion = () => {
    if (!suggestion) return;
    forgetProposals([suggestion.proposal.key]);
    void recordDecision(suggestion.proposal.key, 'rejected');
  };
  const plan = () => {
    const planned = planApplied(state.doc, [a.id]);
    if (!planned.sessions) {
      notify(planned.notPlanned ?? 'No preparation could be planned.', { tone: 'warning' });
      return;
    }
    commit(planned.doc, `Planned preparation for ${a.title}`, `Planned ${planned.sessions} preparation ${planned.sessions === 1 ? 'session' : 'sessions'}.`);
  };
  const findTopics = async () => {
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
    <article className="card test-card" aria-labelledby={headingId}>
      <div className="card-body stack">
        <div className="row test-head">
          <div>
            <h2 id={headingId}>{a.title}</h2>
            <div className="small muted">
              {className ? `${className} · ` : ''}
              {date ? `${formatWhen(date, year)} · ${relativeDays(date.slice(0, 10), today)}` : 'No date yet'}
              {a.topic ? ` · Scope: ${a.topic}` : ''}
            </div>
          </div>
          <button type="button" className="btn small" onClick={() => editors.open({ kind: 'assignment', id: a.id })}>
            Correct date or scope
          </button>
        </div>

        <dl className="ls-class-stats">
          <div>
            <dt>Done</dt>
            <dd>{formatDuration(p?.doneMinutes ?? 0)}</dd>
          </div>
          <div>
            <dt>Planned</dt>
            <dd>{formatDuration(p?.scheduledMinutes ?? 0)}</dd>
          </div>
          <div>
            <dt>Not planned</dt>
            <dd>{p?.unscheduledMinutes === null ? 'No estimate' : formatDuration(p?.unscheduledMinutes ?? 0)}</dd>
          </div>
        </dl>
        {p?.unscheduledMinutes ? (
          <div>
            <button type="button" className="btn" onClick={plan}>
              Plan preparation
            </button>
          </div>
        ) : null}

        <section aria-labelledby={`${headingId}-topics`} className="stack">
          <div className="row test-readiness">
            <h3 id={`${headingId}-topics`} className="ls-subhead">
              Study topics
            </h3>
            {topics.length ? (
              <>
                <LatticeMeter
                  cells={topics.slice(0, 12).map((t) => CELL[t.status ?? 'not_started'])}
                  value={topics.filter((t) => t.status === 'comfortable').length}
                  max={topics.length}
                  label={`${topics.filter((t) => t.status === 'comfortable').length} of ${topics.length} topics comfortable`}
                />
                <span className="small muted">
                  {topics.filter((t) => t.status === 'comfortable').length} of {topics.length} comfortable
                  {topics.some((t) => t.status === 'needs_review') ? ` · ${topics.filter((t) => t.status === 'needs_review').length} need more review` : ''}
                </span>
              </>
            ) : null}
          </div>
          {topics.length ? (
            <ul className="test-topics">
              {topics.map((t) => {
                const href = safeHref(t.source?.url);
                return (
                  <li key={t.id} className={`topic-${t.status ?? 'not_started'}`}>
                    <div>
                      <strong>{t.title}</strong> <span className="small muted">· {TOPIC_BASIS_WORDS[t.basis ?? 'user']}</span>
                      {t.quote ? (
                        <div className="small muted">
                          “{t.quote}”
                          {href ? (
                            <>
                              {' · '}
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                Source<span className="visually-hidden"> (opens in a new tab)</span>
                              </a>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <span className="row">
                      <select className="select test-status" value={t.status ?? 'not_started'} onChange={(e) => setStatus(t, e.target.value as TopicStatus)} aria-label={`How ready you are on ${t.title}`}>
                        {TOPIC_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {TOPIC_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn small ghost" onClick={() => remove(t)} aria-label={`Remove ${t.title}`}>
                        Remove
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              No study topics yet, so what will be on it is unknown. A study guide, the AI or you can add them.
            </p>
          )}
          {suggestion ? (
            <div className="test-suggestion">
              <p className="small" style={{ margin: 0 }}>
                The AI read the class materials and suggests: {(suggestion.proposal.topics ?? []).map((t) => t.title).join(', ')}.
              </p>
              {suggestion.reasons.length ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {suggestion.reasons.join(' ')}
                </p>
              ) : null}
              <span className="row">
                <button type="button" className="btn small primary" onClick={acceptSuggestion}>
                  Add these topics
                </button>
                <button type="button" className="btn small ghost" onClick={rejectSuggestion}>
                  Not these
                </button>
              </span>
            </div>
          ) : !topics.length && ai?.configured ? (
            <div>
              <button type="button" className="btn small" onClick={() => void findTopics()} disabled={busy}>
                {busy ? 'Reading class materials…' : 'Find topics with AI'}
              </button>
            </div>
          ) : null}
          <form
            className="test-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <div className="field">
              <label htmlFor={`${headingId}-new`}>Add a topic</label>
              <input id={`${headingId}-new`} className="input" value={newTopic} maxLength={200} onChange={(e) => setNewTopic(e.target.value)} placeholder="e.g. Osmosis practice problems" />
            </div>
            <button type="submit" className="btn" disabled={!newTopic.trim()}>
              Add
            </button>
          </form>
        </section>

        {sessions.length ? (
          <section aria-labelledby={`${headingId}-sessions`}>
            <h3 id={`${headingId}-sessions`} className="ls-subhead">
              Preparation sessions
            </h3>
            <ul className="small">
              {sessions.map((b) => (
                <li key={b.id}>
                  {formatBlockTime(b.start, b.end)}
                  {b.description ? ` · ${b.description}` : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </article>
  );
}
