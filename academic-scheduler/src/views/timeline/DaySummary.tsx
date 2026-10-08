// Day summary (planned work vs free study time, over-capacity warnings in
// words, daily limit), the "add study time" prompt when no availability is
// set (§ 11: then no free time and no overload are shown), and the list of
// finished sessions that are still marked planned (§ 12.1).
import type { BlockView, DayModel } from '../../lib/calendar';
import type { BlockStatus, LocalDateTimeStr, ScheduleBlock } from '../../model/types';
import { formatDuration } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { dayLoad, formatSpan, nowMinutesOn, unplannedFreeMinutes } from './logic';

interface DaySummaryProps {
  model: DayModel;
  maxDaily: number | null;
  now: LocalDateTimeStr;
  onAddStudyTime: () => void;
}

export function DaySummary({ model, maxDaily, now, onAddStudyTime }: DaySummaryProps) {
  const load = dayLoad(model, maxDaily);
  // Free time nobody has planned yet; for today only the part that is still ahead.
  const unplanned = unplannedFreeMinutes(model, now);
  const isToday = nowMinutesOn(model.date, now) !== null;
  const ratio = load.free > 0 ? Math.min(1, load.planned / load.free) : load.planned > 0 ? 1 : 0;
  return (
    <section className="card day-summary" aria-labelledby={`ds-${model.date}`}>
      <h2 id={`ds-${model.date}`} className="visually-hidden">
        Day summary
      </h2>
      <dl className="ds-stats">
        <div>
          <dt>Planned work</dt>
          <dd>{formatDuration(load.planned)}</dd>
        </div>
        {model.availabilityDefined ? (
          <>
            <div>
              <dt>Free study time</dt>
              <dd>{formatDuration(load.free)}</dd>
            </div>
            {unplanned !== null ? (
              <div>
                <dt>{isToday ? 'Unplanned from now' : 'Still unplanned'}</dt>
                <dd>{formatDuration(unplanned)}</dd>
              </div>
            ) : null}
          </>
        ) : null}
        {load.done > 0 ? (
          <div>
            <dt>Done</dt>
            <dd>{formatDuration(load.done)}</dd>
          </div>
        ) : null}
        {maxDaily !== null ? (
          <div>
            <dt>Daily limit</dt>
            <dd>{formatDuration(maxDaily)}</dd>
          </div>
        ) : null}
      </dl>
      {model.availabilityDefined && (load.free > 0 || load.planned > 0) ? (
        <div className={`ds-meter${model.overFreeTime ? ' is-over' : ''}`} aria-hidden="true">
          <span style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      ) : null}
      {model.overFreeTime ? (
        <p className="banner warning ds-warning">
          <Icon name="warning" />
          <span>
            <strong>Over capacity:</strong> {formatDuration(load.planned)} of work is planned but there is only {formatDuration(load.free)} of free study time (
            {formatDuration(load.overFreeBy)} too much).
          </span>
        </p>
      ) : null}
      {model.overDailyMax && maxDaily !== null ? (
        <p className="banner warning ds-warning">
          <Icon name="warning" />
          <span>
            <strong>Above your daily limit:</strong> {formatDuration(load.planned)} planned, limit {formatDuration(maxDaily)} ({formatDuration(load.overMaxBy)} over).
          </span>
        </p>
      ) : null}
      {!model.availabilityDefined ? (
        <div className="ds-prompt">
          <p>
            <strong>Add your study time</strong> — the hours you are usually free for schoolwork. Then this page shows your free time and warns when a day has more work
            than fits.
          </p>
          <button type="button" className="btn small primary" onClick={onAddStudyTime}>
            <Icon name="plus" />
            Add study time
          </button>
        </div>
      ) : load.free === 0 && load.planned === 0 ? (
        <p className="muted small ds-note">No free study time on this day.</p>
      ) : null}
    </section>
  );
}

interface UnmarkedProps {
  blocks: BlockView[];
  onStatus: (block: ScheduleBlock, status: BlockStatus, label: string) => void;
  onOpen: (view: BlockView) => void;
}

/** Sessions of the day that are over but still "planned": ask whether they happened. */
export function UnmarkedSessions({ blocks, onStatus, onOpen }: UnmarkedProps) {
  if (blocks.length === 0) return null;
  return (
    <section className="card ds-unmarked" aria-labelledby="ds-unmarked-title">
      <div className="card-header">
        <h2 id="ds-unmarked-title">Did you do {blocks.length === 1 ? 'this' : 'these'}?</h2>
      </div>
      <ul className="ds-unmarked-list">
        {blocks.map((view) => (
          <li key={view.block.id}>
            <button type="button" className="agenda-link" onClick={() => onOpen(view)}>
              {view.label}
            </button>
            <span className="muted small">{formatSpan(view.start, view.end)}</span>
            <span className="row ds-unmarked-actions">
              <button type="button" className="btn small" onClick={() => onStatus(view.block, 'done', view.label)} aria-label={`Mark ${view.label} done`}>
                <Icon name="check" size={14} />
                Done
              </button>
              <button type="button" className="btn small ghost" onClick={() => onStatus(view.block, 'skipped', view.label)} aria-label={`Mark ${view.label} skipped`}>
                Skipped
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
