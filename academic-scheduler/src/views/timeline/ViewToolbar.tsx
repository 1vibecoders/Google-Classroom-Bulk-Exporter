// Header of the day and week views: title, previous / today / next, a date
// picker, the Timeline / List switch, Print and "Add work".
import { useCallback, useId, useState, type ReactNode } from 'react';
import { isValidDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';

export type ViewMode = 'timeline' | 'list';

const MODE_KEY = 'academic-scheduler:view-mode:';

function readMode(key: string): ViewMode | null {
  try {
    const value = window.localStorage.getItem(MODE_KEY + key);
    return value === 'timeline' || value === 'list' ? value : null;
  } catch {
    return null;
  }
}

function narrowScreen(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;
  } catch {
    return false;
  }
}

/**
 * Timeline or list, remembered per view in this browser. Without a stored
 * choice the week view starts as a list on narrow screens.
 */
export function useViewMode(key: 'day' | 'week'): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setModeState] = useState<ViewMode>(() => readMode(key) ?? (key === 'week' && narrowScreen() ? 'list' : 'timeline'));
  const setMode = useCallback(
    (next: ViewMode) => {
      setModeState(next);
      try {
        window.localStorage.setItem(MODE_KEY + key, next);
      } catch {
        /* storage blocked: keep the choice for this visit only */
      }
    },
    [key],
  );
  return [mode, setMode];
}

interface ViewToolbarProps {
  title: string;
  subtitle?: ReactNode;
  prevLabel: string;
  nextLabel: string;
  todayLabel: string;
  isCurrent: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  date: string;
  dateLabel: string;
  onDate: (date: string) => void;
  mode: ViewMode;
  onMode: (mode: ViewMode) => void;
  onAdd: () => void;
  addLabel: string;
}

export function ViewToolbar(props: ViewToolbarProps) {
  const dateId = useId();
  const { mode, onMode } = props;
  return (
    <div className="page-header view-toolbar">
      <div className="vt-title">
        <h1>{props.title}</h1>
        {props.subtitle ? <div className="page-subtitle">{props.subtitle}</div> : null}
      </div>
      <span className="spacer" />
      <div className="vt-controls no-print">
        <div className="vt-nav" role="group" aria-label="Navigate">
          <button type="button" className="btn icon" onClick={props.onPrev} aria-label={props.prevLabel} title={props.prevLabel}>
            <Icon name="chevronLeft" />
          </button>
          <button type="button" className="btn" onClick={props.onToday} aria-current={props.isCurrent ? 'date' : undefined}>
            {props.todayLabel}
          </button>
          <button type="button" className="btn icon" onClick={props.onNext} aria-label={props.nextLabel} title={props.nextLabel}>
            <Icon name="chevronRight" />
          </button>
        </div>
        <label className="visually-hidden" htmlFor={dateId}>
          {props.dateLabel}
        </label>
        <input
          id={dateId}
          className="input vt-date"
          type="date"
          value={props.date}
          onChange={(event) => {
            if (isValidDate(event.target.value)) props.onDate(event.target.value);
          }}
        />
        <div className="segmented" role="group" aria-label="Show as">
          <button type="button" aria-pressed={mode === 'timeline'} onClick={() => onMode('timeline')}>
            <Icon name="calendar" size={14} />
            Timeline
          </button>
          <button type="button" aria-pressed={mode === 'list'} onClick={() => onMode('list')}>
            <Icon name="list" size={14} />
            List
          </button>
        </div>
        <button type="button" className="btn icon ghost" onClick={() => window.print()} aria-label="Print" title="Print">
          <Icon name="file" />
        </button>
        <button type="button" className="btn primary" onClick={props.onAdd}>
          <Icon name="plus" />
          <span>{props.addLabel}</span>
        </button>
      </div>
    </div>
  );
}
