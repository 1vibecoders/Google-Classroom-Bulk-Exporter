// One day of the timeline: free study time ("Available" bands), busy events,
// scheduled work and break blocks laid out side by side when they overlap,
// timed due/assessment lines, the now-line and the drag ghost.
import { memo, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { layoutColumns, type BlockView, type DayModel, type EventOccurrence } from '../../lib/calendar';
import { ASSIGNMENT_TYPE_LABELS, EVENT_CATEGORY_LABELS } from '../../model/constants';
import type { DateStr, LocalDateTimeStr } from '../../model/types';
import { formatDateLong, formatDuration, isValidTime, timeToMinutes } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import type { TimelineGeometry } from './dragEngine';
import { blockStatus, describeBlock, describeEvent, formatClock, formatSpan, isUnmarkedPast, type Span } from './logic';

export interface ColumnHandlers {
  onBlockPointerDown: (event: ReactPointerEvent, view: BlockView, date: DateStr, kind: 'move' | 'resize', handle: boolean) => void;
  onColumnPointerDown: (event: ReactPointerEvent, date: DateStr) => void;
  onBlockClick: (view: BlockView) => void;
  onBlockKeyDown: (event: ReactKeyboardEvent, view: BlockView, date: DateStr) => void;
  onEventClick: (occurrence: EventOccurrence) => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  registerColumn: (date: DateStr, element: HTMLElement | null) => void;
}

export interface Ghost {
  kind: 'move' | 'resize' | 'create';
  span: Span;
  label: string;
  color: string;
}

interface DayColumnProps {
  model: DayModel;
  geometry: TimelineGeometry;
  compact: boolean;
  isToday: boolean;
  now: LocalDateTimeStr;
  /** Minutes since midnight of now when this column is today, else null. */
  nowMinutes: number | null;
  ghost: Ghost | null;
  draggingId: string | null;
  handlers: ColumnHandlers;
  hintId: string;
}

type Item =
  | { kind: 'event'; key: string; start: number; end: number; occurrence: EventOccurrence }
  | { kind: 'block'; key: string; start: number; end: number; view: BlockView };

const MIN_ITEM_PX = 16;

function sizeClass(height: number): string {
  if (height < 30) return 'is-tiny';
  if (height < 52) return 'is-short';
  return '';
}

export const DayColumn = memo(function DayColumn({ model, geometry, compact, isToday, now, nowMinutes, ghost, draggingId, handlers, hintId }: DayColumnProps) {
  const { rangeStart, rangeEnd, pxPerMinute } = geometry;
  const top = (minutes: number) => (minutes - rangeStart) * pxPerMinute;
  const heightOf = (start: number, end: number) => Math.max(MIN_ITEM_PX, (end - start) * pxPerMinute);
  const minVisual = MIN_ITEM_PX / pxPerMinute;

  const items: Item[] = [
    ...model.events.map((occurrence, i) => ({
      kind: 'event' as const,
      key: `e:${occurrence.event.id}:${i}`,
      start: occurrence.start ?? 0,
      end: occurrence.end ?? 0,
      occurrence,
    })),
    ...model.blocks.map((view) => ({ kind: 'block' as const, key: `b:${view.block.id}`, start: view.start, end: view.end, view })),
  ];
  const laid = layoutColumns(items, (item) => ({ start: item.start, end: Math.max(item.end, item.start + minVisual) }));

  // Day view: work and events leave a strip on the right where the
  // "Available" labels stay readable. Week view: a label is shown only where
  // nothing covers it.
  const withInset = !compact && model.free.length > 0;
  const labelMinutes = 16 / pxPerMinute;
  const labelCovered = (start: number) => items.some((item) => item.start < start + labelMinutes && Math.max(item.end, item.start + minVisual) > start);

  const timedMarkers = compact
    ? []
    : model.markers.filter((m) => m.time && isValidTime(m.time) && m.kind !== 'recommended' && !m.sitting && timeToMinutes(m.time) >= rangeStart && timeToMinutes(m.time) <= rangeEnd);

  return (
    <div
      className={`tl-col${isToday ? ' is-today' : ''}${withInset ? ' has-inset' : ''}`}
      role="group"
      aria-label={formatDateLong(model.date)}
      ref={(el) => handlers.registerColumn(model.date, el)}
      style={{ height: (rangeEnd - rangeStart) * pxPerMinute }}
      onPointerDown={(event) => handlers.onColumnPointerDown(event, model.date)}
    >
      {model.free.map((interval) => {
        const h = (interval.end - interval.start) * pxPerMinute;
        return (
          <div key={`free:${interval.start}`} className="tl-available" style={{ top: top(interval.start), height: h }}>
            {withInset && h >= 16 ? (
              <span className="tl-available-label in-inset">
                Available
                {h >= 34 ? <span className="tl-available-time">{formatSpan(interval.start, interval.end)}</span> : null}
              </span>
            ) : !withInset && h >= 18 && !labelCovered(interval.start) ? (
              <span className="tl-available-label">Available</span>
            ) : null}
          </div>
        );
      })}

      {timedMarkers.map((m, i) => (
        <div
          key={`m:${m.assignment.id}:${m.task?.id ?? ''}:${m.kind}:${i}`}
          className={`tl-marker-line${m.done ? ' is-done' : ''}`}
          style={{ top: top(timeToMinutes(m.time!)), '--marker-color': m.color } as CSSProperties}
          aria-hidden="true"
        >
          <span>
            {m.label} · {m.task ? `${m.assignment.title}: ${m.task.title}` : m.assignment.title}
          </span>
        </div>
      ))}

      {laid.map(({ item, column, columns }) => {
        const left = `calc((100% - var(--tl-inset)) * ${column / columns} + 2px)`;
        const width = `calc((100% - var(--tl-inset)) / ${columns} - 4px)`;
        const height = heightOf(item.start, item.end);
        const style: CSSProperties = { top: top(item.start), height, left, width };
        if (item.kind === 'event') {
          return <EventCard key={item.key} occurrence={item.occurrence} style={style} size={sizeClass(height)} compact={compact} onClick={handlers.onEventClick} />;
        }
        return (
          <BlockCard
            key={item.key}
            view={item.view}
            date={model.date}
            style={style}
            size={sizeClass(height)}
            compact={compact}
            unmarked={isUnmarkedPast(model.date, item.view, now)}
            dragging={draggingId === item.view.block.id}
            handlers={handlers}
            hintId={hintId}
          />
        );
      })}

      {nowMinutes !== null && nowMinutes >= rangeStart && nowMinutes <= rangeEnd ? (
        <div className="tl-now" style={{ top: top(nowMinutes) }} aria-hidden="true">
          <span className="tl-now-dot" />
          {!compact ? <span className="tl-now-label">{formatClock(nowMinutes)}</span> : null}
        </div>
      ) : null}

      {ghost ? (
        <div
          className={`tl-ghost kind-${ghost.kind}`}
          style={{ top: top(ghost.span.start), height: heightOf(ghost.span.start, ghost.span.end), '--block-color': ghost.color } as CSSProperties}
          aria-hidden="true"
        >
          <span className="tl-ghost-label">{ghost.label}</span>
          <span className="tl-ghost-time">
            {formatSpan(ghost.span.start, ghost.span.end)} · {formatDuration(ghost.span.end - ghost.span.start)}
          </span>
        </div>
      ) : null}
    </div>
  );
});

function EventCard({ occurrence, style, size, compact, onClick }: { occurrence: EventOccurrence; style: CSSProperties; size: string; compact: boolean; onClick: (o: EventOccurrence) => void }) {
  const e = occurrence.event;
  const category = e.category ? EVENT_CATEGORY_LABELS[e.category] : null;
  const description = describeEvent(occurrence);
  const assessmentWord = occurrence.assignment?.type ? ASSIGNMENT_TYPE_LABELS[occurrence.assignment.type] : 'Assessment';
  return (
    <button
      type="button"
      data-tl-item=""
      className={`tl-event ${occurrence.busy ? 'is-busy' : 'is-free'} ${size}`}
      style={style}
      aria-label={description}
      title={description}
      onClick={() => onClick(occurrence)}
    >
      <span className="tl-event-title">{e.title}</span>
      {occurrence.start !== null && occurrence.end !== null ? (
        <span className="tl-event-meta">
          {formatSpan(occurrence.start, occurrence.end)}
          {!compact && category ? ` · ${category}` : ''}
          {occurrence.busy ? '' : ' · not busy'}
        </span>
      ) : null}
      {occurrence.assignment ? (
        <span className="tl-event-link">
          <Icon name="target" size={11} /> {assessmentWord}: {occurrence.assignment.title}
        </span>
      ) : null}
    </button>
  );
}

interface BlockCardProps {
  view: BlockView;
  date: DateStr;
  style: CSSProperties;
  size: string;
  compact: boolean;
  unmarked: boolean;
  dragging: boolean;
  handlers: ColumnHandlers;
  hintId: string;
}

function BlockCard({ view, date, style, size, compact, unmarked, dragging, handlers, hintId }: BlockCardProps) {
  const status = blockStatus(view);
  const description = describeBlock(view);
  const showTask = !!view.taskTitle && view.taskTitle !== view.workTitle;
  const classes = [
    'tl-block',
    size,
    view.isBreak ? 'is-break' : '',
    status === 'done' ? 'is-done' : '',
    status === 'skipped' ? 'is-skipped' : '',
    view.conflict ? 'has-conflict' : '',
    view.late ? 'is-late' : '',
    unmarked ? 'is-unmarked' : '',
    dragging ? 'is-dragging' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      data-tl-item=""
      data-block-id={view.block.id}
      style={{ ...style, '--block-color': view.color } as CSSProperties}
      onPointerDown={(event) => handlers.onBlockPointerDown(event, view, date, 'move', false)}
      onContextMenu={handlers.onContextMenu}
    >
      <button
        type="button"
        className="tl-block-main"
        aria-label={description}
        aria-describedby={hintId}
        title={description}
        onClick={() => handlers.onBlockClick(view)}
        onKeyDown={(event) => handlers.onBlockKeyDown(event, view, date)}
      >
        <span className="tl-block-title">
          {status === 'done' ? <Icon name="check" size={12} /> : null}
          {view.block.locked ? <Icon name="lock" size={11} /> : null}
          <span className="tl-block-label">{view.label}</span>
        </span>
        {showTask && !compact ? <span className="tl-block-task">{view.taskTitle}</span> : null}
        <span className="tl-block-time">
          {formatSpan(view.start, view.end)}
          {compact ? '' : ` · ${formatDuration(view.minutes)}`}
        </span>
        <span className="tl-block-flags">
          {status === 'done' ? <span className="tl-flag ok">Done</span> : null}
          {status === 'skipped' ? <span className="tl-flag">Skipped</span> : null}
          {view.conflict ? (
            <span className="tl-flag warn">
              <Icon name="warning" size={10} />
              Conflict
            </span>
          ) : null}
          {view.late ? <span className="tl-flag danger">Late</span> : null}
          {unmarked ? <span className="tl-flag">Done?</span> : null}
        </span>
      </button>
      {!compact ? (
        <span className="tl-grip" aria-hidden="true" onPointerDown={(event) => { event.stopPropagation(); handlers.onBlockPointerDown(event, view, date, 'move', true); }}>
          <Icon name="grip" size={12} />
        </span>
      ) : null}
      <span
        className="tl-resize"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          handlers.onBlockPointerDown(event, view, date, 'resize', true);
        }}
      />
    </div>
  );
}
