// Weekly overview of commitments and study time: seven day columns with the
// events (busy ones striped) on top of the study-time windows (green), so the
// free study time is visible at a glance. Every item opens its editor.
import { useMemo } from 'react';
import { WEEKDAY_LABELS, WEEKDAY_SHORT, resolveSettings } from '../../model/constants';
import type { DateStr, ScheduleDocument } from '../../model/types';
import { classColor, eventOccursOn, layoutColumns, windowAppliesOn } from '../../lib/calendar';
import { addDays, dateRange, formatDateShort, formatHourLabel, isValidEndTime, isValidTime, timeToMinutes, weekdayOf } from '../../lib/time';
import { formatTimeRange } from './format';

interface GridItem {
  kind: 'event' | 'window';
  id: string;
  title: string;
  start: number;
  end: number;
  startTime: string;
  endTime: string;
  busy: boolean;
  recurring: boolean;
  color?: string;
}

interface DayColumn {
  date: DateStr;
  windows: GridItem[];
  events: GridItem[];
  allDay: Array<{ id: string; title: string; busy: boolean }>;
}

function span(startTime: string | undefined, endTime: string | undefined): { start: number; end: number } | null {
  if (!isValidTime(startTime) || !isValidEndTime(endTime)) return null;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  return end > start ? { start, end } : null;
}

export function buildWeekColumns(doc: ScheduleDocument, weekStart: DateStr): DayColumn[] {
  return dateRange(weekStart, addDays(weekStart, 6)).map((date) => {
    const column: DayColumn = { date, windows: [], events: [], allDay: [] };
    for (const w of doc.availability) {
      if (!windowAppliesOn(w, date)) continue;
      const s = span(w.startTime, w.endTime);
      if (!s) continue;
      column.windows.push({
        kind: 'window',
        id: w.id,
        title: w.label || 'Study time',
        ...s,
        startTime: w.startTime,
        endTime: w.endTime,
        busy: false,
        recurring: !!w.recurrence,
      });
    }
    for (const e of doc.events) {
      if (!eventOccursOn(e, date)) continue;
      if (e.allDay) {
        column.allDay.push({ id: e.id, title: e.title, busy: e.busy !== false });
        continue;
      }
      const s = span(e.startTime, e.endTime);
      if (!s) continue;
      column.events.push({
        kind: 'event',
        id: e.id,
        title: e.title,
        ...s,
        startTime: e.startTime!,
        endTime: e.endTime!,
        busy: e.busy !== false,
        recurring: !!e.recurrence,
        color: e.classId ? classColor(doc, e.classId) : undefined,
      });
    }
    return column;
  });
}

export function WeekGrid({
  doc,
  weekStart,
  today,
  onOpen,
}: {
  doc: ScheduleDocument;
  weekStart: DateStr;
  today: DateStr;
  onOpen: (kind: 'event' | 'availability', id: string) => void;
}) {
  const columns = useMemo(() => buildWeekColumns(doc, weekStart), [doc, weekStart]);
  const settings = resolveSettings(doc.settings);
  const year = Number(today.slice(0, 4));

  // Range: the day settings, widened to whole hours that fit every item.
  let start = isValidTime(settings.dayStartTime) ? timeToMinutes(settings.dayStartTime) : 7 * 60;
  let end = isValidEndTime(settings.dayEndTime) ? timeToMinutes(settings.dayEndTime) : 22 * 60;
  for (const c of columns) {
    for (const item of [...c.windows, ...c.events]) {
      start = Math.min(start, item.start);
      end = Math.max(end, item.end);
    }
  }
  start = Math.floor(start / 60) * 60;
  end = Math.min(1440, Math.ceil(end / 60) * 60);
  if (end <= start) end = Math.min(1440, start + 60);
  const total = end - start;
  const hours: number[] = [];
  for (let m = start; m < end; m += 60) hours.push(m);
  const hasAllDay = columns.some((c) => c.allDay.length > 0);
  const pct = (m: number) => `${((m - start) / total) * 100}%`;
  const height = (a: number, b: number) => `${((b - a) / total) * 100}%`;

  return (
    <div className="wg-scroll">
      <div className="wg" style={{ ['--wg-hours' as string]: String(hours.length) }}>
        <div className="wg-corner" aria-hidden="true" />
        {columns.map((c) => (
          <div key={c.date} className={`wg-day-head${c.date === today ? ' is-today' : ''}`}>
            <span className="wg-wd">{WEEKDAY_SHORT[weekdayOf(c.date)]}</span>
            <span className="wg-date">{formatDateShort(c.date, year)}</span>
          </div>
        ))}

        {hasAllDay ? (
          <>
            <div className="wg-allday-label small muted">All day</div>
            {columns.map((c) => (
              <div key={c.date} className="wg-allday">
                {c.allDay.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className={`wg-chip${e.busy ? ' is-busy' : ''}`}
                    onClick={() => onOpen('event', e.id)}
                    aria-label={`${e.title}, ${WEEKDAY_LABELS[weekdayOf(c.date)]}, all day`}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            ))}
          </>
        ) : null}

        <div className="wg-hours" aria-hidden="true">
          {hours.map((m) => (
            <div key={m} className="wg-hour">
              {formatHourLabel(m)}
            </div>
          ))}
        </div>
        {columns.map((c) => (
          <div key={c.date} className={`wg-col${c.date === today ? ' is-today' : ''}`}>
            {hours.map((m) => (
              <div key={m} className="wg-line" style={{ top: pct(m) }} aria-hidden="true" />
            ))}
            {c.windows.map((w, i) => (
              <button
                key={`${w.id}-${i}`}
                type="button"
                className="wg-window"
                style={{ top: pct(w.start), height: height(w.start, w.end) }}
                onClick={() => onOpen('availability', w.id)}
                aria-label={`Study time: ${w.title}, ${WEEKDAY_LABELS[weekdayOf(c.date)]} ${formatTimeRange(w.startTime, w.endTime)}`}
                title={`${w.title} · ${formatTimeRange(w.startTime, w.endTime)}`}
              >
                <span className="wg-window-label">{w.title}</span>
              </button>
            ))}
            {layoutColumns(c.events, (e) => ({ start: e.start, end: e.end })).map(({ item: e, column, columns: count }) => (
              <button
                key={e.id}
                type="button"
                className={`wg-event${e.busy ? ' is-busy' : ' is-free'}`}
                style={{
                  top: pct(e.start),
                  height: height(e.start, e.end),
                  left: `calc(${(column / count) * 100}% + 2px)`,
                  width: `calc(${100 / count}% - 4px)`,
                  ...(e.color ? { ['--event-color' as string]: e.color } : {}),
                }}
                onClick={() => onOpen('event', e.id)}
                aria-label={`${e.title}, ${WEEKDAY_LABELS[weekdayOf(c.date)]} ${formatTimeRange(e.startTime, e.endTime)}${e.busy ? '' : ', not busy'}`}
                title={`${e.title} · ${formatTimeRange(e.startTime, e.endTime)}`}
              >
                <span className="wg-event-title">{e.title}</span>
                <span className="wg-event-time">{formatTimeRange(e.startTime, e.endTime)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
