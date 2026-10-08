// Commitments view: a weekly overview grid, recurring commitments (with the
// repeat rule in words and the next occurrence), one-time events and study
// time (availability windows). Everything can be created, edited and deleted.
import { useMemo, useState } from 'react';
import { EVENT_CATEGORY_LABELS, WEEKDAYS, resolveSettings } from '../model/constants';
import type { AvailabilityWindow, Recurrence, ScheduleEvent } from '../model/types';
import { useStore } from '../state/store';
import { useEditors } from '../editors/EditorHost';
import { useNow } from '../ui/hooks';
import { Icon } from '../ui/Icon';
import { ClassChip, EmptyState, useConfirm } from '../ui/common';
import { classColor } from '../lib/calendar';
import { describeRecurrence, nextOccurrence } from '../lib/recurrence';
import {
  addDays,
  formatDateShort,
  formatDateWithWeekday,
  formatDuration,
  isValidEndTime,
  isValidTime,
  nowLocal,
  startOfWeek,
  timeToMinutes,
} from '../lib/time';
import { countOpen, itemIssues } from './lists/assignmentModel';
import { IssuePanel } from './lists/IssuePanel';
import { ControlBadges } from './lists/Provenance';
import { WeekGrid } from './lists/WeekGrid';
import { formatTimeRange, originLabel, plural, relativeDays } from './lists/format';
import '../styles/lists.css';

function minutesOf(start: string | undefined, end: string | undefined): number {
  if (!isValidTime(start) || !isValidEndTime(end)) return 0;
  return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
}

/** Average minutes per week of a weekly rule (days × length ÷ interval). */
function weeklyMinutes(rule: Recurrence, minutes: number): number {
  const interval = rule.interval && rule.interval >= 1 ? rule.interval : 1;
  return (rule.daysOfWeek.length * minutes) / interval;
}

function NextOccurrence({ rule, today, year }: { rule: Recurrence; today: string; year: number }) {
  const next = nextOccurrence(rule, today);
  if (!next) return <span className="muted">No more dates{rule.endDate ? ` (ended ${formatDateShort(rule.endDate, year)})` : ''}</span>;
  return (
    <span>
      Next: {formatDateWithWeekday(next, year)} <span className="muted">({relativeDays(next, today)})</span>
    </span>
  );
}

function useDeleteItem() {
  const { dispatch, notify } = useStore();
  const confirm = useConfirm();
  return async (kind: 'event' | 'availability', item: ScheduleEvent | AvailabilityWindow, extra?: string) => {
    const name = kind === 'event' ? (item as ScheduleEvent).title : (item as AvailabilityWindow).label || 'this study time';
    const ok = await confirm({
      title: kind === 'event' ? `Delete “${name}”?` : `Delete ${(item as AvailabilityWindow).label ? `“${name}”` : name}?`,
      danger: true,
      confirmLabel: 'Delete',
      message: (
        <div className="stack" style={{ gap: 8 }}>
          {item.recurrence ? (
            <p style={{ margin: 0 }}>This deletes every occurrence. To skip a single day instead, edit it and add an exception date.</p>
          ) : (
            <p style={{ margin: 0 }}>This cannot be undone.</p>
          )}
          {extra ? <p style={{ margin: 0 }}>{extra}</p> : null}
          {(item.origin ?? 'generated') === 'generated' ? (
            <p className="small muted" style={{ margin: 0 }}>
              It was imported from /academic-schedule; a later import will not add it again.
            </p>
          ) : null}
        </div>
      ),
    });
    if (!ok) return;
    if (kind === 'event') dispatch({ type: 'deleteEvent', id: item.id, now: nowLocal() });
    else dispatch({ type: 'deleteAvailability', id: item.id, now: nowLocal() });
    notify(`Deleted ${kind === 'event' ? `“${name}”` : name}.`, { tone: 'success' });
  };
}

function ItemActions({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="ls-item-actions">
      <button type="button" className="btn ghost icon small" onClick={onEdit} aria-label={`Edit ${label}`} title="Edit">
        <Icon name="edit" />
      </button>
      <button type="button" className="btn ghost icon small" onClick={onDelete} aria-label={`Delete ${label}`} title="Delete">
        <Icon name="trash" />
      </button>
    </div>
  );
}

function EventRow({ event, today, year }: { event: ScheduleEvent; today: string; year: number }) {
  const { state } = useStore();
  const doc = state.doc;
  const editors = useEditors();
  const remove = useDeleteItem();
  const cls = event.classId ? doc.classes.find((c) => c.id === event.classId) : undefined;
  const assessment = event.assignmentId ? doc.assignments.find((a) => a.id === event.assignmentId) : undefined;
  const issues = itemIssues(doc, 'events', event);
  const open = countOpen(issues);
  const when = event.allDay ? 'All day' : formatTimeRange(event.startTime, event.endTime);
  return (
    <li className="ls-item">
      <span
        className={`ls-item-mark${event.busy === false ? ' is-free' : ''}`}
        style={cls ? { background: classColor(doc, cls.id) } : undefined}
        aria-hidden="true"
      />
      <div className="ls-item-body">
        <div className="ls-item-title-row">
          <h3 className="ls-item-title">{event.title}</h3>
          <span className="badge">{EVENT_CATEGORY_LABELS[event.category ?? 'other']}</span>
          {event.busy === false ? (
            <span className="badge" title="Informational: does not block study time">
              Not busy
            </span>
          ) : null}
          <ControlBadges item={event} />
          {open ? (
            <span className="badge warning">
              <Icon name="warning" size={12} /> {plural(open, 'issue')}
            </span>
          ) : null}
        </div>
        <div className="ls-item-meta small">
          {event.recurrence ? (
            <>
              <span>
                <Icon name="repeat" size={12} /> {describeRecurrence(event.recurrence, { currentYear: year })}
              </span>
              <span>{when}</span>
              <NextOccurrence rule={event.recurrence} today={today} year={year} />
            </>
          ) : (
            <>
              <span>
                <Icon name="calendar" size={12} /> {event.date ? formatDateWithWeekday(event.date, year) : ''}
                {event.endDate && event.endDate !== event.date ? ` – ${formatDateWithWeekday(event.endDate, year)}` : ''}
              </span>
              <span>{when}</span>
              {event.date && event.date >= today ? <span className="muted">{relativeDays(event.date, today)}</span> : null}
            </>
          )}
        </div>
        <div className="ls-item-meta small muted">
          {cls ? <ClassChip name={cls.name} color={classColor(doc, cls.id)} /> : null}
          {event.location ? <span>{event.location}</span> : null}
          {assessment ? <span>Sitting of “{assessment.title}”</span> : null}
          <span>{originLabel(event.origin)}</span>
        </div>
        {event.notes ? <p className="ls-text small">{event.notes}</p> : null}
        {issues.length ? <IssuePanel entries={issues} /> : null}
      </div>
      <ItemActions
        label={event.title}
        onEdit={() => editors.open({ kind: 'event', id: event.id })}
        onDelete={() => void remove('event', event, assessment ? `The assessment “${assessment.title}” itself stays in your assignments.` : undefined)}
      />
    </li>
  );
}

function WindowRow({ window: w, today, year }: { window: AvailabilityWindow; today: string; year: number }) {
  const { state } = useStore();
  const editors = useEditors();
  const remove = useDeleteItem();
  const minutes = minutesOf(w.startTime, w.endTime);
  const issues = itemIssues(state.doc, 'availability', w);
  const label = w.label || 'Study time';
  return (
    <li className="ls-item">
      <span className="ls-item-mark is-study" aria-hidden="true" />
      <div className="ls-item-body">
        <div className="ls-item-title-row">
          <h3 className="ls-item-title">{label}</h3>
          <span className="small muted">{formatTimeRange(w.startTime, w.endTime)}</span>
          <ControlBadges item={w} />
        </div>
        <div className="ls-item-meta small">
          {w.recurrence ? (
            <>
              <span>
                <Icon name="repeat" size={12} /> {describeRecurrence(w.recurrence, { currentYear: year })}
              </span>
              <span className="muted">about {formatDuration(weeklyMinutes(w.recurrence, minutes))} per week</span>
              <NextOccurrence rule={w.recurrence} today={today} year={year} />
            </>
          ) : (
            <>
              <span>
                <Icon name="calendar" size={12} /> {w.date ? formatDateWithWeekday(w.date, year) : ''}
              </span>
              <span className="muted">{formatDuration(minutes)}</span>
              {w.date && w.date >= today ? <span className="muted">{relativeDays(w.date, today)}</span> : null}
            </>
          )}
          <span className="muted">{originLabel(w.origin)}</span>
        </div>
        {issues.length ? <IssuePanel entries={issues} /> : null}
      </div>
      <ItemActions label={label} onEdit={() => editors.open({ kind: 'availability', id: w.id })} onDelete={() => void remove('availability', w)} />
    </li>
  );
}

function eventSortKey(e: ScheduleEvent): string {
  const first = e.recurrence ? WEEKDAYS.findIndex((d) => e.recurrence!.daysOfWeek.includes(d)) : 0;
  return `${first}|${e.allDay ? '00:00' : (e.startTime ?? '')}|${e.title.toLowerCase()}`;
}

export function CommitmentsView() {
  const { state } = useStore();
  const doc = state.doc;
  const now = useNow();
  const editors = useEditors();
  const today = now.slice(0, 10);
  const year = Number(today.slice(0, 4));
  const weekStartsOn = resolveSettings(doc.settings).weekStartsOn === 'sunday' ? 'sunday' : 'monday';
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today, weekStartsOn));
  const thisWeek = startOfWeek(today, weekStartsOn);
  const shownWeek = startOfWeek(weekStart, weekStartsOn);

  const recurring = useMemo(() => doc.events.filter((e) => e.recurrence).sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b))), [doc.events]);
  const oneTime = useMemo(
    () =>
      doc.events
        .filter((e) => !e.recurrence)
        .sort((a, b) =>
          `${a.date ?? ''}|${a.allDay ? '' : (a.startTime ?? '')}|${a.title}`.localeCompare(
            `${b.date ?? ''}|${b.allDay ? '' : (b.startTime ?? '')}|${b.title}`,
          ),
        ),
    [doc.events],
  );
  const upcoming = oneTime.filter((e) => (e.endDate ?? e.date ?? '') >= today);
  const past = oneTime.filter((e) => (e.endDate ?? e.date ?? '') < today).reverse();
  const windows = useMemo(
    () =>
      [...doc.availability].sort((a, b) =>
        `${a.recurrence ? 0 : 1}|${a.date ?? ''}|${a.startTime}`.localeCompare(`${b.recurrence ? 0 : 1}|${b.date ?? ''}|${b.startTime}`),
      ),
    [doc.availability],
  );
  const recurringWindows = windows.filter((w) => w.recurrence);
  const datedWindows = windows.filter((w) => !w.recurrence && (w.date ?? '') >= today);
  const pastWindows = windows.filter((w) => !w.recurrence && (w.date ?? '') < today);

  const empty = doc.events.length === 0 && doc.availability.length === 0;

  return (
    <div className="lists-page">
      <div className="page-header">
        <div>
          <h1>Commitments</h1>
          <div className="page-subtitle">School, activities and appointments that take your time — and when you are free to study.</div>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => editors.open({ kind: 'availability' })}>
          <Icon name="target" /> Add study time
        </button>
        <button type="button" className="btn primary" onClick={() => editors.open({ kind: 'event' })}>
          <Icon name="plus" /> New commitment
        </button>
      </div>

      {empty ? (
        <div className="card">
          <EmptyState
            title="No commitments or study time yet"
            actions={
              <>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => editors.open({ kind: 'event', initial: { category: 'school', startTime: '08:00', endTime: '15:00' } })}
                >
                  <Icon name="plus" /> Add school hours
                </button>
                <button type="button" className="btn" onClick={() => editors.open({ kind: 'event' })}>
                  <Icon name="calendar" /> Add another commitment
                </button>
                <button type="button" className="btn" onClick={() => editors.open({ kind: 'availability' })}>
                  <Icon name="target" /> Add study time
                </button>
              </>
            }
          >
            Add recurring commitments (school 8:00–3:00 on weekdays, fencing on Mondays, piano on Wednesdays), one-time events (a doctor appointment) and the
            times you are free for schoolwork.
          </EmptyState>
        </div>
      ) : (
        <>
          <section className="card ls-section" aria-labelledby="week-overview">
            <div className="card-header">
              <h2 id="week-overview" style={{ flex: 1 }}>
                Week of {formatDateShort(shownWeek, year)}
              </h2>
              <div className="row">
                <button type="button" className="btn small icon" onClick={() => setWeekStart(addDays(shownWeek, -7))} aria-label="Previous week">
                  <Icon name="chevronLeft" />
                </button>
                <button type="button" className="btn small" onClick={() => setWeekStart(thisWeek)} disabled={shownWeek === thisWeek}>
                  This week
                </button>
                <button type="button" className="btn small icon" onClick={() => setWeekStart(addDays(shownWeek, 7))} aria-label="Next week">
                  <Icon name="chevronRight" />
                </button>
              </div>
            </div>
            <div className="card-body">
              <div className="row small muted wg-legend">
                <span>
                  <span className="wg-swatch is-study" aria-hidden="true" /> Study time
                </span>
                <span>
                  <span className="wg-swatch is-busy" aria-hidden="true" /> Busy
                </span>
                <span>
                  <span className="wg-swatch is-free" aria-hidden="true" /> Not busy (informational)
                </span>
              </div>
              <WeekGrid doc={doc} weekStart={shownWeek} today={today} onOpen={(kind, id) => editors.open({ kind, id })} />
            </div>
          </section>

          <section className="card ls-section" aria-labelledby="recurring-head">
            <div className="card-header">
              <h2 id="recurring-head" style={{ flex: 1 }}>
                Recurring commitments <span className="ls-group-count">{recurring.length}</span>
              </h2>
              <button type="button" className="btn small" onClick={() => editors.open({ kind: 'event' })}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            {recurring.length ? (
              <ul className="ls-items">
                {recurring.map((e) => (
                  <EventRow key={e.id} event={e} today={today} year={year} />
                ))}
              </ul>
            ) : (
              <p className="card-body muted small" style={{ margin: 0 }}>
                Nothing repeats yet. Add school hours, practices or lessons that happen every week.
              </p>
            )}
          </section>

          <section className="card ls-section" aria-labelledby="onetime-head">
            <div className="card-header">
              <h2 id="onetime-head" style={{ flex: 1 }}>
                One-time events <span className="ls-group-count">{upcoming.length}</span>
              </h2>
              <button type="button" className="btn small" onClick={() => editors.open({ kind: 'event', initial: { date: today } })}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            {upcoming.length ? (
              <ul className="ls-items">
                {upcoming.map((e) => (
                  <EventRow key={e.id} event={e} today={today} year={year} />
                ))}
              </ul>
            ) : (
              <p className="card-body muted small" style={{ margin: 0 }}>
                No upcoming one-time events.
              </p>
            )}
            {past.length ? (
              <details className="ls-past">
                <summary>Past events ({past.length})</summary>
                <ul className="ls-items">
                  {past.map((e) => (
                    <EventRow key={e.id} event={e} today={today} year={year} />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="card ls-section" aria-labelledby="study-head">
            <div className="card-header">
              <h2 id="study-head" style={{ flex: 1 }}>
                Study time <span className="ls-group-count">{doc.availability.length}</span>
              </h2>
              <button type="button" className="btn small" onClick={() => editors.open({ kind: 'availability' })}>
                <Icon name="plus" size={14} /> Add
              </button>
            </div>
            <div className="card-body ls-explain small muted">
              When you are free for schoolwork. Busy commitments inside these windows are subtracted; what is left is your free study time, used for
              over-capacity warnings and by “Plan unscheduled work”.
            </div>
            {doc.availability.length === 0 ? (
              <div className="banner warning ls-inset-banner" role="status">
                <Icon name="warning" />
                <span>No study time yet. Without it the day view cannot show free time and work cannot be planned automatically.</span>
              </div>
            ) : (
              <ul className="ls-items">
                {[...recurringWindows, ...datedWindows].map((w) => (
                  <WindowRow key={w.id} window={w} today={today} year={year} />
                ))}
              </ul>
            )}
            {pastWindows.length ? (
              <details className="ls-past">
                <summary>Past one-day study time ({pastWindows.length})</summary>
                <ul className="ls-items">
                  {pastWindows.map((w) => (
                    <WindowRow key={w.id} window={w} today={today} year={year} />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
