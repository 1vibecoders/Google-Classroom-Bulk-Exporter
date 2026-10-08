// The list rendering of a day, in time order — the screen-reader friendly and
// narrow-screen alternative to the timeline, matching the requirements'
// example:
//   3:30 ───── Available
//   4:00 ───── English / Read Chapter 6
//   4:45 ───── Break
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import type { BlockView, DayModel, EventOccurrence } from '../../lib/calendar';
import { ASSIGNMENT_TYPE_LABELS, EVENT_CATEGORY_LABELS } from '../../model/constants';
import type { BlockStatus, LocalDateTimeStr, ScheduleBlock } from '../../model/types';
import { formatDuration } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import { agendaEntries, blockStatus, conflictText, formatClock, isUnmarkedPast, type AgendaEntry } from './logic';

export interface AgendaActions {
  openBlock: (view: BlockView) => void;
  openEvent: (occurrence: EventOccurrence) => void;
  setBlockStatus: (block: ScheduleBlock, status: BlockStatus, label: string) => void;
}

interface AgendaProps {
  model: DayModel;
  now: LocalDateTimeStr;
  actions: AgendaActions;
  /** Accessible name of the list. */
  label: string;
  emptyText?: ReactNode;
  /** Show each block's "what to do" description. */
  showDescriptions?: boolean;
}

export function Agenda({ model, now, actions, label, emptyText, showDescriptions = true }: AgendaProps) {
  const entries = useMemo(() => agendaEntries(model), [model]);
  if (entries.length === 0) {
    return <p className="agenda-empty muted">{emptyText ?? 'Nothing scheduled at a set time.'}</p>;
  }
  return (
    <ol className="agenda" aria-label={label}>
      {entries.map((entry) => (
        <AgendaRow key={entryKey(entry)} entry={entry} model={model} now={now} actions={actions} showDescriptions={showDescriptions} />
      ))}
    </ol>
  );
}

function entryKey(entry: AgendaEntry): string {
  if (entry.kind === 'block') return `b:${entry.view.block.id}`;
  if (entry.kind === 'event') return `e:${entry.occurrence.event.id}:${entry.start}`;
  return `a:${entry.start}`;
}

function AgendaRow({ entry, model, now, actions, showDescriptions }: { entry: AgendaEntry; model: DayModel; now: LocalDateTimeStr; actions: AgendaActions; showDescriptions: boolean }) {
  if (entry.kind === 'available') {
    return (
      <li className="agenda-row kind-available">
        <span className="agenda-time">{formatClock(entry.start)}</span>
        <span className="agenda-rule" aria-hidden="true" />
        <div className="agenda-body">
          <span className="agenda-title">Available</span>
          <span className="agenda-meta">
            until {formatClock(entry.end)} · {formatDuration(entry.end - entry.start)} free
          </span>
        </div>
      </li>
    );
  }

  if (entry.kind === 'event') {
    const o = entry.occurrence;
    const e = o.event;
    const meta = [`until ${formatClock(entry.end)}`, e.category ? EVENT_CATEGORY_LABELS[e.category] : null, o.busy ? null : 'not busy', e.location || null].filter(Boolean).join(' · ');
    return (
      <li className={`agenda-row kind-event${o.busy ? ' is-busy' : ''}`}>
        <span className="agenda-time">{formatClock(entry.start)}</span>
        <span className="agenda-rule" aria-hidden="true" />
        <div className="agenda-body">
          <button type="button" className="agenda-link" onClick={() => actions.openEvent(o)}>
            {e.title}
          </button>
          <span className="agenda-meta">{meta}</span>
          {o.assignment ? (
            <span className="agenda-meta">
              <Icon name="target" size={12} /> {o.assignment.type ? ASSIGNMENT_TYPE_LABELS[o.assignment.type] : 'Assessment'}: {o.assignment.title}
            </span>
          ) : null}
        </div>
      </li>
    );
  }

  const view = entry.view;
  const status = blockStatus(view);
  const unmarked = isUnmarkedPast(model.date, view, now);
  const showTask = !!view.taskTitle && view.taskTitle !== view.workTitle;
  const meta = [showTask ? view.taskTitle : null, `until ${formatClock(entry.end)}`, formatDuration(view.minutes)].filter(Boolean).join(' · ');
  return (
    <li
      className={`agenda-row kind-block${view.isBreak ? ' is-break' : ''}${status === 'done' ? ' is-done' : ''}${status === 'skipped' ? ' is-skipped' : ''}`}
      style={{ '--block-color': view.color } as CSSProperties}
    >
      <span className="agenda-time">{formatClock(entry.start)}</span>
      <span className="agenda-rule" aria-hidden="true" />
      <div className="agenda-body">
        <div className="agenda-line">
          {!view.isBreak ? (
            <input
              type="checkbox"
              className="agenda-check"
              checked={status === 'done'}
              aria-label={`Done: ${view.label}`}
              onChange={(event) => actions.setBlockStatus(view.block, event.target.checked ? 'done' : 'planned', view.label)}
            />
          ) : null}
          <span className="agenda-swatch" aria-hidden="true" />
          <button type="button" className="agenda-link agenda-block-title" onClick={() => actions.openBlock(view)}>
            {view.label}
          </button>
        </div>
        <span className="agenda-meta">{meta}</span>
        <span className="agenda-flags">
          {status === 'done' ? <span className="tl-flag ok">Done</span> : null}
          {status === 'skipped' ? <span className="tl-flag">Skipped</span> : null}
          {view.block.locked ? (
            <span className="tl-flag">
              <Icon name="lock" size={10} /> Pinned
            </span>
          ) : null}
          {unmarked ? <span className="tl-flag">Over — did you do it?</span> : null}
          {view.conflict ? (
            <span className="tl-flag warn">
              <Icon name="warning" size={10} /> Conflict: {conflictText(view)}
            </span>
          ) : null}
          {view.late && view.lateReason ? <span className="tl-flag danger">Late: {view.lateReason}</span> : null}
        </span>
        {showDescriptions && view.block.description ? <span className="agenda-desc">{view.block.description}</span> : null}
      </div>
    </li>
  );
}
