// "What should I work on now?" (SPEC.md § 27.1): on today's Day view, the
// session running now or the next one today, with what to do and Done / Skip,
// and the work that is overdue (it stays explicit, § 26.2). Other days show nothing.
import { useMemo } from 'react';
import type { BlockView, DayModel } from '../../lib/calendar';
import type { BlockStatus, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../../model/types';
import { progressByAssignment } from '../../lib/workload';
import { routeToHash } from '../../router';
import { formatDuration } from '../../lib/time';
import { formatSpan, nowMinutesOn } from './logic';

interface NextUpProps {
  doc: ScheduleDocument;
  model: DayModel;
  now: LocalDateTimeStr;
  onStatus: (block: ScheduleBlock, status: BlockStatus, label: string) => void;
  onOpen: (view: BlockView) => void;
}

export function NextUp({ doc, model, now, onStatus, onOpen }: NextUpProps) {
  const minute = nowMinutesOn(model.date, now);
  const overdue = useMemo(() => {
    const progress = progressByAssignment(doc, now);
    return doc.assignments.filter((a) => progress.get(a.id)?.overdue);
  }, [doc, now]);
  if (minute === null) return null;
  const work = model.blocks.filter((v) => !v.isBreak && (v.block.status ?? 'planned') === 'planned' && v.end > minute);
  const current = work.find((v) => v.start <= minute);
  const next = current ?? work[0];
  const left = work.reduce((sum, v) => sum + v.end - Math.max(v.start, minute), 0);

  return (
    <section className="card next-up" aria-labelledby="next-up-title">
      <div className="card-header">
        <h2 id="next-up-title">{current ? 'Now' : next ? 'Next up' : 'Today'}</h2>
      </div>
      <div className="card-body stack">
        {next ? (
          <>
            <div>
              <button type="button" className="agenda-link" onClick={() => onOpen(next)}>
                {next.label}
              </button>
              <div className="small muted">
                {formatSpan(next.start, next.end)}
                {next.taskTitle && next.taskTitle !== next.title ? ` · ${next.taskTitle}` : ''}
              </div>
              {next.block.description ? <p className="small next-up-what">{next.block.description}</p> : null}
            </div>
            {current ? (
              <span className="row">
                <button type="button" className="btn small primary" onClick={() => onStatus(next.block, 'done', next.label)}>
                  Done
                </button>
                <button type="button" className="btn small ghost" onClick={() => onStatus(next.block, 'skipped', next.label)}>
                  Skip
                </button>
              </span>
            ) : null}
            <p className="small muted" style={{ margin: 0 }}>
              {formatDuration(left)} of planned work left today.
            </p>
          </>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            No more planned work today.
          </p>
        )}
        {overdue.length ? (
          <p className="small warning-text" style={{ margin: 0 }}>
            Overdue: {overdue.slice(0, 3).map((a) => a.title).join(', ')}
            {overdue.length > 3 ? ` and ${overdue.length - 3} more` : ''}. <a href={routeToHash({ name: 'assignments' })}>See assignments</a>
          </p>
        ) : null}
      </div>
    </section>
  );
}
