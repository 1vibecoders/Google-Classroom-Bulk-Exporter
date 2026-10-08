// Week view: seven day columns (settings.weekStartsOn) with commitments, free
// study time and scheduled work; a header per day with its due dates and
// assessments and planned vs free time; blocks can be dragged to another
// time or day. A list mode shows the same week as seven agendas.
import { useMemo } from 'react';
import type { DayModel } from '../lib/calendar';
import { resolveSettings } from '../model/constants';
import { addDays, formatDateLong, formatDateWithWeekday, formatDuration, isValidDate, startOfWeek, weekdayOf } from '../lib/time';
import { WEEKDAY_SHORT } from '../model/constants';
import { navigate, routeToHash } from '../router';
import { useStore } from '../state/store';
import { useNow } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { Agenda } from './timeline/Agenda';
import { DayIssues, type DatedIssue } from './timeline/DayIssues';
import { DayStrip } from './timeline/DayStrip';
import { GettingStarted } from './timeline/GettingStarted';
import { Timeline } from './timeline/Timeline';
import { ViewToolbar, useViewMode } from './timeline/ViewToolbar';
import { useDayModels } from './timeline/modelCache';
import { dayLoad, formatWeekRange, suggestNewSpan } from './timeline/logic';
import { useTimelineActions, type TimelineActions } from './timeline/useTimelineActions';
import '../styles/timeline.css';

export function WeekView({ date }: { date: string }) {
  const { state } = useStore();
  const doc = state.doc;
  const now = useNow();
  const today = now.slice(0, 10);
  const settings = useMemo(() => resolveSettings(doc.settings), [doc.settings]);
  const anchor = isValidDate(date) ? date : today;
  const weekStart = startOfWeek(anchor, settings.weekStartsOn === 'sunday' ? 'sunday' : 'monday');
  const weekEnd = addDays(weekStart, 6);
  const days = useDayModels(doc, weekStart, 7);
  const [mode, setMode] = useViewMode('week');
  const actions = useTimelineActions();

  const totals = useMemo(() => {
    let planned = 0;
    let free = 0;
    let over = 0;
    let due = 0;
    for (const d of days) {
      planned += d.plannedMinutes;
      free += d.freeMinutes;
      if (d.overFreeTime || d.overDailyMax) over++;
      // Open due dates, checkpoints and assessments (an assessment with a sitting event counts once).
      due += d.markers.filter((m) => m.kind !== 'recommended' && !m.done).length;
    }
    return { planned, free, over, due, availabilityDefined: days[0]?.availabilityDefined ?? false };
  }, [days]);

  const issues = useMemo<DatedIssue[]>(() => days.flatMap((d) => d.issues.map((i) => ({ ...i, day: d.date }))), [days]);

  if (days.length === 0) return null;
  const currentYear = Number(today.slice(0, 4));
  const range = formatWeekRange(weekStart, weekEnd, currentYear);
  const isCurrent = today >= weekStart && today <= weekEnd;
  const go = (next: string) => navigate({ name: 'week', date: next });
  const addDay = isCurrent ? today : weekStart;
  const addModel = days.find((d) => d.date === addDay) ?? days[0];

  return (
    <div className="week-view">
      <ViewToolbar
        title={`Week of ${range}`}
        subtitle={isCurrent ? 'This week' : undefined}
        prevLabel="Previous week"
        nextLabel="Next week"
        todayLabel="This week"
        isCurrent={isCurrent}
        onPrev={() => go(addDays(weekStart, -7))}
        onNext={() => go(addDays(weekStart, 7))}
        onToday={() => go(today)}
        date={anchor}
        dateLabel="Go to the week of a date"
        onDate={go}
        mode={mode}
        onMode={setMode}
        onAdd={() => actions.createBlock(addModel.date, suggestNewSpan(addModel, now))}
        addLabel="Add work"
      />

      <GettingStarted doc={doc} />

      <section className="card week-summary" aria-label="Week summary">
        <dl className="ds-stats">
          <div>
            <dt>Planned work</dt>
            <dd>{formatDuration(totals.planned)}</dd>
          </div>
          {totals.availabilityDefined ? (
            <div>
              <dt>Free study time</dt>
              <dd>{formatDuration(totals.free)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Due dates and assessments</dt>
            <dd>{totals.due}</dd>
          </div>
          {totals.availabilityDefined ? (
            <div>
              <dt>Days over capacity</dt>
              <dd className={totals.over ? 'is-warning' : ''}>
                {totals.over ? (
                  <>
                    <Icon name="warning" size={14} /> {totals.over}
                  </>
                ) : (
                  'None'
                )}
              </dd>
            </div>
          ) : null}
        </dl>
        {!totals.availabilityDefined ? (
          <div className="ds-prompt">
            <p>
              <strong>Add your study time</strong> to see free time for each day and which days have more work than fits.
            </p>
            <button type="button" className="btn small primary" onClick={actions.addStudyTime}>
              <Icon name="plus" />
              Add study time
            </button>
          </div>
        ) : null}
      </section>

      {mode === 'timeline' ? (
        <>
          <div className="card tl-card week-card">
            <Timeline
              days={days}
              now={now}
              compact
              label={`Week of ${range}`}
              renderHeader={(day) => <WeekDayHeader day={day} today={today} maxDaily={settings.maxDailyStudyMinutes} actions={actions} now={now} />}
              onOpenBlock={actions.openBlock}
              onOpenEvent={actions.openEvent}
              onCreate={actions.createBlock}
              onMoveBlock={actions.moveBlock}
            />
          </div>
          <p className="tl-help muted small no-print">
            Drag a block to another time or day, or drag its bottom edge to change its length (Esc cancels). Click empty time to add work. Click a day’s date to
            open it. Keyboard: focus a block and press Enter, or use Alt+arrow keys to move it.
          </p>
        </>
      ) : (
        <div className="week-list">
          {days.map((day) => (
            <WeekDaySection key={day.date} day={day} today={today} now={now} maxDaily={settings.maxDailyStudyMinutes} actions={actions} />
          ))}
        </div>
      )}

      <DayIssues doc={doc} issues={issues} onStatus={actions.setIssueStatus} onOpenItem={actions.openItem} title="Issues this week" showDates />
      {actions.dialog}
    </div>
  );
}

function loadText(day: DayModel): string {
  if (!day.availabilityDefined) return `${formatDuration(day.plannedMinutes)} planned`;
  return `${formatDuration(day.plannedMinutes)} of ${formatDuration(day.freeMinutes)} free`;
}

function OverFlag({ day, maxDaily }: { day: DayModel; maxDaily: number | null }) {
  const load = dayLoad(day, maxDaily);
  if (!load.overloaded) return null;
  const why = day.overFreeTime ? `${formatDuration(load.overFreeBy)} more work than free time` : `${formatDuration(load.overMaxBy)} over your daily limit`;
  return (
    <span className="tl-flag warn" title={why}>
      <Icon name="warning" size={10} /> Over<span className="visually-hidden">: {why}</span>
    </span>
  );
}

function WeekDayHeader({ day, today, maxDaily, actions, now }: { day: DayModel; today: string; maxDaily: number | null; actions: TimelineActions; now: string }) {
  const isToday = day.date === today;
  const long = formatDateLong(day.date);
  return (
    <div className={`wk-head${isToday ? ' is-today' : ''}${day.date < today ? ' is-past' : ''}`}>
      <div className="wk-head-top">
        <a className="wk-date" href={routeToHash({ name: 'day', date: day.date })} aria-label={`Open ${long}${isToday ? ' (today)' : ''}`}>
          <span className="wk-dow">{WEEKDAY_SHORT[weekdayOf(day.date)]}</span>
          <span className="wk-dom">{Number(day.date.slice(8))}</span>
        </a>
        {isToday ? <span className="badge accent wk-today">Today</span> : null}
        <button type="button" className="btn ghost icon small wk-add no-print" aria-label={`Add work on ${long}`} title="Add work" onClick={() => actions.createBlock(day.date, suggestNewSpan(day, now))}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="wk-load">
        <span>{loadText(day)}</span>
        <OverFlag day={day} maxDaily={maxDaily} />
      </div>
      <DayStrip model={day} compact maxItems={3} moreHref={routeToHash({ name: 'day', date: day.date })} onOpenAssignment={actions.openAssignment} onOpenEvent={actions.openEvent} />
    </div>
  );
}

function WeekDaySection({ day, today, now, maxDaily, actions }: { day: DayModel; today: string; now: string; maxDaily: number | null; actions: TimelineActions }) {
  const isToday = day.date === today;
  const headingId = `wk-day-${day.date}`;
  return (
    <section className={`card week-day${isToday ? ' is-today' : ''}`} aria-labelledby={headingId}>
      <div className="card-header">
        <h2 id={headingId}>
          <a href={routeToHash({ name: 'day', date: day.date })}>{formatDateWithWeekday(day.date)}</a>
        </h2>
        {isToday ? <span className="badge accent">Today</span> : null}
        <span className="spacer" />
        <span className="muted small">{loadText(day)}</span>
        <OverFlag day={day} maxDaily={maxDaily} />
        <button type="button" className="btn ghost icon small no-print" aria-label={`Add work on ${formatDateLong(day.date)}`} title="Add work" onClick={() => actions.createBlock(day.date, suggestNewSpan(day, now))}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div className="card-body stack">
        <DayStrip model={day} onOpenAssignment={actions.openAssignment} onOpenEvent={actions.openEvent} />
        <Agenda model={day} now={now} actions={actions} label={`Schedule for ${formatDateLong(day.date)}`} showDescriptions={false} emptyText="Nothing scheduled." />
      </div>
    </section>
  );
}
