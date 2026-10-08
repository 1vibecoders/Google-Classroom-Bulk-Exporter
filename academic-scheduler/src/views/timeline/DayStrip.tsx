// The all-day strip of a day: all-day events and the day's due dates,
// assessments, checkpoints and "aim to finish" targets, e.g.
// "Due 11:59 PM · English 10 · Othello Essay", "Test · Biology · Unit 2 test".
// An assessment whose sitting is an event that day is shown by that event
// (§ 10), not twice.
import type { CSSProperties } from 'react';
import type { DateMarker, DayModel, EventOccurrence } from '../../lib/calendar';
import { formatDateShort } from '../../lib/time';
import { Icon, type IconName } from '../../ui/Icon';

interface DayStripProps {
  model: DayModel;
  compact?: boolean;
  onOpenAssignment: (id: string) => void;
  onOpenEvent: (occurrence: EventOccurrence) => void;
  /** Compact mode: show at most this many entries, then "+N more". */
  maxItems?: number;
  /** Where "+N more" leads (the day view). */
  moreHref?: string;
}

const MARKER_ICONS: Record<DateMarker['kind'], IconName> = { due: 'clock', assessment: 'target', recommended: 'info' };

/** Markers worth showing (assessments with a sitting event are shown by the event). */
export function visibleMarkers(model: DayModel): DateMarker[] {
  return model.markers.filter((m) => !m.sitting);
}

export function markerText(m: DateMarker): { label: string; className: string | null; title: string } {
  return {
    label: m.label,
    className: m.schoolClass ? m.schoolClass.name : null,
    title: m.task ? `${m.assignment.title}: ${m.task.title}` : m.assignment.title,
  };
}

/** "withdrawn by teacher", "no longer in source" or "optional" — work that is not counted (§ 8.1). */
export function markerNote(m: DateMarker): string | null {
  const a = m.assignment;
  if (a.sourceState === 'withdrawn') return 'withdrawn by teacher';
  if (a.sourceState === 'missing') return 'no longer in source';
  if (a.required === false || (m.task && m.task.required === false)) return 'optional';
  return null;
}

export function DayStrip({ model, compact = false, onOpenAssignment, onOpenEvent, maxItems, moreHref }: DayStripProps) {
  const markers = visibleMarkers(model);
  const total = model.allDayEvents.length + markers.length;
  if (total === 0) return null;
  const limit = maxItems ?? Number.POSITIVE_INFINITY;
  let shown = 0;

  return (
    <ul className={`strip${compact ? ' strip-compact' : ''}`} aria-label="All day">
      {model.allDayEvents.map((o) => {
        if (shown >= limit) return null;
        shown++;
        const span = o.span ? ` (${formatDateShort(o.span.first)} – ${formatDateShort(o.span.last)})` : '';
        const text = `${o.event.title}${span}`;
        return (
          <li key={`e:${o.event.id}`}>
            <button
              type="button"
              className={`strip-chip strip-event${o.busy ? ' is-busy' : ''}`}
              onClick={() => onOpenEvent(o)}
              title={`All day: ${text}${o.busy ? ' (busy)' : ''}`}
            >
              <Icon name="calendar" size={12} />
              <span className="strip-kind">All day</span>
              <span className="strip-text">{text}</span>
              {o.busy && !compact ? <span className="strip-note">busy</span> : null}
            </button>
          </li>
        );
      })}
      {markers.map((m, i) => {
        if (shown >= limit) return null;
        shown++;
        const t = markerText(m);
        const note = markerNote(m);
        const full = [t.label, t.className, t.title, note].filter(Boolean).join(' · ');
        return (
          <li key={`m:${m.assignment.id}:${m.task?.id ?? ''}:${m.kind}:${i}`}>
            <button
              type="button"
              className={`strip-chip strip-marker kind-${m.kind}${m.done ? ' is-done' : ''}`}
              style={{ '--chip-color': m.color } as CSSProperties}
              onClick={() => onOpenAssignment(m.assignment.id)}
              title={`${full}${m.done ? ' (done)' : ''}`}
              aria-label={`${full}${m.done ? ', done' : ''}`}
            >
              <Icon name={MARKER_ICONS[m.kind]} size={12} />
              <span className="strip-kind">{t.label}</span>
              {t.className && !compact ? <span className="strip-class">{t.className}</span> : null}
              <span className="strip-text">{t.title}</span>
              {m.done ? <span className="strip-note">done</span> : note && !compact ? <span className="strip-note">{note}</span> : null}
            </button>
          </li>
        );
      })}
      {total > shown ? (
        <li>
          {moreHref ? (
            <a className="strip-more" href={moreHref}>
              +{total - shown} more
            </a>
          ) : (
            <span className="strip-more">+{total - shown} more</span>
          )}
        </li>
      ) : null}
    </ul>
  );
}
