// The vertical timeline shared by the day view (one column) and the week view
// (seven columns): hour gutter, optional column headers, day columns, drag
// and resize with a ghost preview (see dragEngine.ts) and keyboard moves.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BlockView, DayModel, EventOccurrence, Interval } from '../../lib/calendar';
import type { DateStr, LocalDateTimeStr } from '../../model/types';
import { addDays, formatDateWithWeekday, formatHourLabel } from '../../lib/time';
import { DayColumn, type ColumnHandlers, type Ghost } from './DayColumn';
import { createDragEngine, type DragEngine, type DragPreview, type TimelineGeometry } from './dragEngine';
import { NUDGE_MINUTES, formatSpan, moveSpan, nowMinutesOn, resizeSpan, type Span } from './logic';

export interface TimelineProps {
  days: DayModel[];
  now: LocalDateTimeStr;
  /** Week view: smaller text, no grip handles, no timed marker lines. */
  compact?: boolean;
  pxPerHour?: number;
  /** Accessible name of the whole timeline, e.g. "Timeline for Tuesday, October 13". */
  label: string;
  renderHeader?: (day: DayModel) => ReactNode;
  onOpenBlock: (view: BlockView) => void;
  onOpenEvent: (occurrence: EventOccurrence) => void;
  onCreate: (date: DateStr, span: Span) => void;
  onMoveBlock: (view: BlockView, date: DateStr, span: Span, via: 'pointer' | 'keyboard') => void;
}

/** Said after a keyboard move: moving a generated or planner block pins it (the reducer sets `locked`). */
function pinNote(view: BlockView): string {
  return (view.block.origin ?? 'generated') !== 'user' && !view.block.locked ? ' It is now pinned, so later imports keep your time.' : '';
}

/** The union of the days' suggested ranges (whole hours). */
export function unionRange(days: DayModel[]): Interval {
  if (days.length === 0) return { start: 7 * 60, end: 22 * 60 };
  return {
    start: Math.min(...days.map((d) => d.timelineRange.start)),
    end: Math.max(...days.map((d) => d.timelineRange.end)),
  };
}

export function Timeline(props: TimelineProps) {
  const { days, now, compact = false, label, renderHeader } = props;
  const pxPerHour = props.pxPerHour ?? (compact ? 44 : 56);
  const range = useMemo(() => unionRange(days), [days]);
  const geometry = useMemo<TimelineGeometry>(() => ({ rangeStart: range.start, rangeEnd: range.end, pxPerMinute: pxPerHour / 60 }), [range.start, range.end, pxPerHour]);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const hintId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef(new Map<DateStr, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const latest = useRef({ geometry, days, props });
  useEffect(() => {
    latest.current = { geometry, days, props };
  });

  const engineRef = useRef<DragEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = createDragEngine({
      geometry: () => latest.current.geometry,
      columns: () =>
        latest.current.days
          .map((d) => ({ date: d.date, element: columnsRef.current.get(d.date) }))
          .filter((c): c is { date: DateStr; element: HTMLElement } => !!c.element),
      crossDay: () => latest.current.days.length > 1,
      setPreview,
      commitMove: (view, date, span) => latest.current.props.onMoveBlock(view, date, span, 'pointer'),
      commitCreate: (date, span) => latest.current.props.onCreate(date, span),
    });
  }
  const engine = engineRef.current;
  useEffect(() => () => engine.cancel(), [engine]);

  // Keep keyboard focus on a block after a keyboard move re-renders it.
  useEffect(() => {
    const id = pendingFocus.current;
    if (!id || !containerRef.current) return;
    pendingFocus.current = null;
    for (const el of Array.from(containerRef.current.querySelectorAll<HTMLElement>('[data-block-id]'))) {
      if (el.dataset.blockId === id) {
        el.querySelector<HTMLButtonElement>('.tl-block-main')?.focus();
        break;
      }
    }
  });

  const handlers = useMemo<ColumnHandlers>(
    () => ({
      onBlockPointerDown: (event, view, date, kind, handle) => engine.blockPointerDown(event, view, date, kind, handle),
      onColumnPointerDown: (event, date) => engine.columnPointerDown(event, date),
      onBlockClick: (view) => {
        if (engine.shouldSuppressClick()) return;
        latest.current.props.onOpenBlock(view);
      },
      onEventClick: (occurrence) => {
        if (engine.shouldSuppressClick()) return;
        latest.current.props.onOpenEvent(occurrence);
      },
      onBlockKeyDown: (event, view, date) => {
        if (!event.altKey) return;
        if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && latest.current.days.length > 1) {
          // Week view: Alt+Left/Right moves the block to the previous/next day, same time.
          event.preventDefault();
          const nextDate = addDays(date, event.key === 'ArrowLeft' ? -1 : 1);
          const visible = latest.current.days.some((d) => d.date === nextDate);
          if (visible) pendingFocus.current = view.block.id;
          latest.current.props.onMoveBlock(view, nextDate, { start: view.start, end: view.end }, 'keyboard');
          setAnnouncement(`${view.label}: now ${formatDateWithWeekday(nextDate)}, ${formatSpan(view.start, view.end)}${visible ? '' : ' (in another week)'}.${pinNote(view)}`);
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        const span = { start: view.start, end: view.end };
        const next = event.shiftKey ? resizeSpan(span, span.end + direction * NUDGE_MINUTES) : moveSpan(span, span.start + direction * NUDGE_MINUTES);
        if (next.start === span.start && next.end === span.end) {
          setAnnouncement(`${view.label} cannot move further on this day.`);
          return;
        }
        pendingFocus.current = view.block.id;
        latest.current.props.onMoveBlock(view, date, next, 'keyboard');
        setAnnouncement(`${view.label}: now ${formatSpan(next.start, next.end)}.${pinNote(view)}`);
      },
      onContextMenu: (event) => {
        // A long press on touch screens opens the context menu; not while dragging.
        if (engine.busy()) event.preventDefault();
      },
      registerColumn: (date, element) => {
        if (element) columnsRef.current.set(date, element);
        else columnsRef.current.delete(date);
      },
    }),
    [engine],
  );

  // What the ghost shows: the dragged block's label and color, or "New block".
  const ghost = useMemo<{ date: DateStr; ghost: Ghost } | null>(() => {
    if (!preview) return null;
    if (preview.kind === 'create') return { date: preview.date, ghost: { kind: 'create', span: preview.span, label: 'New work block', color: 'var(--accent)' } };
    let view: BlockView | undefined;
    for (const d of days) {
      view = d.blocks.find((b) => b.block.id === preview.blockId);
      if (view) break;
    }
    return { date: preview.date, ghost: { kind: preview.kind, span: preview.span, label: view?.label ?? 'Work block', color: view?.color ?? 'var(--accent)' } };
  }, [preview, days]);

  const ticks: number[] = [];
  for (let t = range.start; t <= range.end; t += 60) ticks.push(t);
  const bodyHeight = (range.end - range.start) * geometry.pxPerMinute;
  const draggingId = preview && preview.kind !== 'create' ? preview.blockId : null;

  return (
    <div
      ref={containerRef}
      className={`tl${compact ? ' tl-compact' : ''}${preview ? ' is-dragging' : ''}`}
      style={{ '--tl-hour': `${pxPerHour}px`, '--tl-days': days.length } as CSSProperties}
    >
      <span id={hintId} className="visually-hidden">
        Press Enter for actions such as mark done, move to another day, edit or delete. Alt+Up or Alt+Down moves the block by 15 minutes; with Shift it changes the
        length.{days.length > 1 ? ' Alt+Left or Alt+Right moves it to the previous or next day.' : ''}
      </span>
      <div className="tl-scroll">
        <div
          className="tl-grid"
          role="group"
          aria-label={label}
          style={{ gridTemplateColumns: `var(--tl-gutter-w) repeat(${Math.max(1, days.length)}, minmax(var(--tl-col-min), 1fr))` }}
        >
          {renderHeader ? (
            <>
              <div className="tl-corner" aria-hidden="true" />
              {days.map((day) => (
                <div key={day.date} className="tl-head-cell">
                  {renderHeader(day)}
                </div>
              ))}
            </>
          ) : null}
          <div className="tl-gutter" style={{ height: bodyHeight }} aria-hidden="true">
            {ticks.map((t, i) => (
              <span key={t} className={`tl-tick${i === 0 ? ' is-first' : ''}${i === ticks.length - 1 ? ' is-last' : ''}`} style={{ top: (t - range.start) * geometry.pxPerMinute }}>
                {formatHourLabel(t)}
              </span>
            ))}
          </div>
          {days.map((day) => {
            const nowMinutes = nowMinutesOn(day.date, now);
            return (
              <DayColumn
                key={day.date}
                model={day}
                geometry={geometry}
                compact={compact}
                isToday={nowMinutes !== null}
                now={now}
                nowMinutes={nowMinutes}
                ghost={ghost && ghost.date === day.date ? ghost.ghost : null}
                draggingId={draggingId}
                handlers={handlers}
                hintId={hintId}
              />
            );
          })}
        </div>
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
