// The schedule part of Review (SPEC.md § 27.5): what could not be planned,
// sessions that no longer fit, open issues, and what was changed for you, so
// infeasible work is never hidden in Settings. The AI findings that need a
// decision follow below it on the Review page.
import { useMemo } from 'react';
import type { LocalDateTimeStr } from '../../model/types';
import { atRiskWork } from '../../lib/repair';
import { formatDuration, isValidLocalDateTime } from '../../lib/time';
import { formatLdt } from '../lists/format';
import { routeToHash } from '../../router';
import { useStore } from '../../state/store';
import { assignmentIssues, countOpen } from '../lists/assignmentModel';
import { RepairCard } from '../timeline/RepairCard';

export function ScheduleProblems({ now }: { now: LocalDateTimeStr }) {
  const { state } = useStore();
  const doc = state.doc;
  const atRisk = useMemo(() => atRiskWork(doc, now), [doc, now]);
  const issues = useMemo(() => doc.assignments.reduce((n, a) => n + countOpen(assignmentIssues(doc, a)), 0), [doc]);
  const recent = state.snapshots.filter((s) => s.details?.length).slice(0, 3);
  const year = Number(now.slice(0, 4));
  const title = (id: string) => doc.assignments.find((a) => a.id === id)?.title ?? 'Work';

  return (
    <section className="stack" aria-labelledby="sp-title">
      <h2 id="sp-title">Your schedule</h2>
      {atRisk.length ? (
        <section className="card" aria-labelledby="sp-risk">
          <div className="card-header">
            <h3 id="sp-risk">Could not be planned in time</h3>
          </div>
          <ul className="card-body stack" style={{ margin: 0 }}>
            {atRisk.map((u) => (
              <li key={`${u.assignmentId}-${u.taskId ?? ''}`}>
                <strong>{title(u.assignmentId)}</strong> · {formatDuration(u.minutes)} does not fit. <span className="small">{u.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <RepairCard now={now} />
      {issues ? (
        <p className="small" style={{ margin: 0 }}>
          {issues === 1 ? '1 open issue' : `${issues} open issues`} on your assignments (they do not stop planning). <a href={routeToHash({ name: 'assignments' })}>See assignments</a>
        </p>
      ) : null}
      {recent.length ? (
        <section className="card" aria-labelledby="sp-applied">
          <div className="card-header">
            <h3 id="sp-applied">Changed for you recently</h3>
          </div>
          <div className="card-body stack">
            {recent.map((s) => (
              <details key={s.id} className="small">
                <summary>
                  {s.label}
                  {isValidLocalDateTime(s.createdAt) ? ` · ${formatLdt(s.createdAt, year)}` : ''}
                  {s.automatic ? ' · automatic' : ''}
                </summary>
                <ul>
                  {s.details!.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            ))}
            <a className="small" href={routeToHash({ name: 'settings' })}>
              Undo in Settings → Undo history
            </a>
          </div>
        </section>
      ) : null}
      {!atRisk.length && !issues && !recent.length ? <p className="small muted" style={{ margin: 0 }}>Everything planned fits. Nothing needs you here.</p> : null}
    </section>
  );
}
