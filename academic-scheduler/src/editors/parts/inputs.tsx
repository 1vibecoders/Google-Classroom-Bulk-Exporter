// Form controls the shared ui/fields set does not have: a date with an
// optional time, an end time that can be "midnight", a text input with
// suggestions, minutes with a readable duration, a segmented choice, a
// picker that collects ids as removable chips, and a list of dates.
import { useId, useState, type ReactNode } from 'react';
import type { SchoolClass } from '../../model/types';
import { formatDateWithWeekday, formatDuration, isValidDate } from '../../lib/time';
import { Icon } from '../../ui/Icon';
import type { DateTimeParts } from './common';

function describedBy(id: string, hint?: ReactNode, error?: string | null): string | undefined {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

function HintAndError({ id, hint, error }: { id: string; hint?: ReactNode; error?: string | null }) {
  return (
    <>
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="error" id={`${id}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

/** A date and an optional time (a DateOrDateTime value such as `due`). */
export function DateTimeInput({
  label,
  value,
  onChange,
  hint,
  error,
  className,
  required,
}: {
  label: string;
  value: DateTimeParts;
  onChange: (value: DateTimeParts) => void;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  required?: boolean;
}) {
  const id = useId();
  const empty = !value.date && !value.time;
  return (
    <fieldset className={`field ed-fieldset ${className || ''}`} aria-describedby={describedBy(id, hint, error)}>
      <legend className="field-label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </legend>
      <div className="ed-datetime">
        <input
          className="input"
          type="date"
          aria-label={`${label}: date`}
          value={value.date}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
        <input
          className="input"
          type="time"
          step={300}
          aria-label={`${label}: time (optional)`}
          value={value.time}
          aria-invalid={error ? true : undefined}
          onChange={(e) => onChange({ ...value, time: e.target.value.slice(0, 5) })}
        />
        {!empty ? (
          <button type="button" className="btn ghost icon small" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange({ date: '', time: '' })}>
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      <HintAndError id={id} hint={hint} error={error} />
    </fieldset>
  );
}

/** An end time; "midnight" stores `24:00` (the end of the day). */
export function EndTimeInput({
  label = 'End time',
  value,
  onChange,
  error,
  hint,
  required,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
}) {
  const id = useId();
  const midnight = value === '24:00';
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="ed-endtime">
        <input
          id={id}
          className="input"
          type="time"
          step={300}
          value={midnight ? '' : value}
          disabled={midnight}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          onChange={(e) => onChange(e.target.value.slice(0, 5))}
        />
        <label className="checkbox small nowrap">
          <input type="checkbox" checked={midnight} onChange={(e) => onChange(e.target.checked ? '24:00' : '')} />
          <span>Midnight</span>
        </label>
      </div>
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** Text input with suggestions (a native datalist). */
export function SuggestInput({
  label,
  value,
  onChange,
  suggestions,
  hint,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  hint?: ReactNode;
  error?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        value={value}
        placeholder={placeholder}
        list={suggestions.length ? listId : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(e) => onChange(e.target.value)}
      />
      {suggestions.length ? (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** Whole minutes with the duration spelled out ("= 2 h 30 m"). */
export function MinutesInput({
  label,
  value,
  onChange,
  hint,
  error,
  compact,
}: {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  hint?: ReactNode;
  error?: string | null;
  compact?: boolean;
}) {
  const id = useId();
  const readable = value !== '' && Number.isFinite(value) && value >= 60 ? `= ${formatDuration(value)}` : null;
  const shownHint = hint || readable ? (
    <>
      {readable}
      {readable && hint ? ' · ' : null}
      {hint}
    </>
  ) : null;
  return (
    <div className={`field ${compact ? 'ed-compact' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="ed-minutes">
        <input
          id={id}
          className="input"
          type="number"
          inputMode="numeric"
          min={0}
          max={10000}
          step={5}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, shownHint, error)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <span className="muted nowrap">min</span>
      </div>
      <HintAndError id={id} hint={shownHint} error={error} />
    </div>
  );
}

/** A small set of mutually exclusive options shown as one segmented control (radio group). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon?: Parameters<typeof Icon>[0]['name'] }>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <span className={hideLabel ? 'visually-hidden' : 'field-label'} id={id}>
        {label}
      </span>
      <div className="ed-segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((option) => (
          <label key={option.value} className={option.value === value ? 'selected' : ''}>
            <input type="radio" name={id} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
            {option.icon ? <Icon name={option.icon} size={14} /> : null}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export interface PickOption {
  id: string;
  label: string;
  /** Why it cannot be picked (shown in the list, disabled). */
  disabledReason?: string;
}

/**
 * Collects ids (prerequisites, dependencies) as removable chips with a
 * select to add more. Options that would be invalid are listed as disabled
 * with the reason.
 */
export function ChipPicker({
  label,
  selected,
  options,
  onChange,
  emptyText,
  addLabel = 'Add…',
  hint,
  error,
}: {
  label: string;
  selected: string[];
  options: PickOption[];
  onChange: (ids: string[]) => void;
  emptyText: string;
  addLabel?: string;
  hint?: ReactNode;
  error?: string | null;
}) {
  const id = useId();
  const byId = new Map(options.map((o) => [o.id, o]));
  const available = options.filter((o) => !selected.includes(o.id));
  return (
    <div className="field" role="group" aria-labelledby={`${id}-label`}>
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      {selected.length ? (
        <ul className="ed-chips">
          {selected.map((sel) => {
            const name = byId.get(sel)?.label ?? `Missing item (${sel})`;
            return (
              <li key={sel} className={`ed-chip ${byId.has(sel) ? '' : 'missing'}`}>
                <span>{name}</span>
                <button type="button" aria-label={`Remove ${name}`} onClick={() => onChange(selected.filter((x) => x !== sel))}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <span className="muted small">{emptyText}</span>
      )}
      {available.length ? (
        <select
          className="select ed-add-select"
          aria-label={`${label}: add`}
          aria-describedby={describedBy(id, hint, error)}
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...selected, e.target.value]);
          }}
        >
          <option value="">{addLabel}</option>
          {available.map((o) => (
            <option key={o.id} value={o.id} disabled={!!o.disabledReason}>
              {o.disabledReason ? `${o.label} — ${o.disabledReason}` : o.label}
            </option>
          ))}
        </select>
      ) : null}
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** A list of dates (recurrence exceptions) with add/remove. */
export function DateListInput({
  label,
  dates,
  onChange,
  hint,
  error,
  describe,
}: {
  label: string;
  dates: string[];
  onChange: (dates: string[]) => void;
  hint?: ReactNode;
  error?: string | null;
  /** Extra text per date (e.g. "not a meeting day"). */
  describe?: (date: string) => string | null;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const sorted = [...dates].sort();
  const add = () => {
    if (!isValidDate(draft)) return;
    if (!dates.includes(draft)) onChange([...dates, draft].sort());
    setDraft('');
  };
  return (
    <div className="field" role="group" aria-labelledby={`${id}-label`}>
      <span className="field-label" id={`${id}-label`}>
        {label}
      </span>
      {sorted.length ? (
        <ul className="ed-chips">
          {sorted.map((date) => {
            const text = isValidDate(date) ? formatDateWithWeekday(date, new Date().getFullYear()) : date;
            const extra = describe?.(date);
            return (
              <li key={date} className={`ed-chip ${extra ? 'muted-chip' : ''}`}>
                <span>
                  {text}
                  {extra ? <span className="muted"> · {extra}</span> : null}
                </span>
                <button type="button" aria-label={`Remove ${text}`} onClick={() => onChange(dates.filter((d) => d !== date))}>
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="ed-datelist-add">
        <input
          className="input"
          type="date"
          value={draft}
          aria-label={`${label}: date to add`}
          aria-describedby={describedBy(id, hint, error)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn small" onClick={add} disabled={!isValidDate(draft)}>
          <Icon name="plus" size={14} />
          Add date
        </button>
      </div>
      <HintAndError id={id} hint={hint} error={error} />
    </div>
  );
}

/** Options for a class picker: archived classes are hidden unless selected (§ 7). */
export function classOptions(classes: SchoolClass[], selected: string, noneLabel = 'No class (personal)'): Array<{ value: string; label: string }> {
  const list = classes
    .filter((c) => !c.archived || c.id === selected)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.id, label: c.archived ? `${c.name} (archived)` : c.name }));
  if (selected && !classes.some((c) => c.id === selected)) list.unshift({ value: selected, label: 'Deleted class' });
  return [{ value: '', label: noneLabel }, ...list];
}
