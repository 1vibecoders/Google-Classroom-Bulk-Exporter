// Form controls with labels, hints and errors wired up for screen readers.
import { useId, type ReactNode } from 'react';
import { CLASS_PALETTE, WEEKDAYS, WEEKDAY_SHORT, WEEKDAY_LABELS } from '../model/constants';
import type { Weekday } from '../model/types';

interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  required?: boolean;
}

function Shell({ id, label, hint, error, className, required, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={`field ${className || ''}`}>
      <label htmlFor={id}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
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
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string | null) {
  return [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
}

export function TextField(props: FieldShell & { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; autoFocus?: boolean; type?: string }) {
  const id = useId();
  const { value, onChange, placeholder, maxLength, autoFocus, type = 'text', ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoFocus={autoFocus}
        required={shell.required}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

export function TextArea(props: FieldShell & { value: string; onChange: (v: string) => void; rows?: number; maxLength?: number; placeholder?: string }) {
  const id = useId();
  const { value, onChange, rows = 4, maxLength, placeholder, ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

export function NumberField(props: FieldShell & { value: number | ''; onChange: (v: number | '') => void; min?: number; max?: number; step?: number; suffix?: string }) {
  const id = useId();
  const { value, onChange, min, max, step = 1, suffix, ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input
          id={id}
          className="input"
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-invalid={shell.error ? true : undefined}
          aria-describedby={describedBy(id, shell.hint, shell.error)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
        {suffix ? <span className="muted nowrap">{suffix}</span> : null}
      </div>
    </Shell>
  );
}

export function SelectField<T extends string>(
  props: FieldShell & { value: T | ''; onChange: (v: T | '') => void; options: Array<{ value: T | ''; label: string }> },
) {
  const id = useId();
  const { value, onChange, options, ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <select
        id={id}
        className="select"
        value={value}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
        onChange={(e) => onChange(e.target.value as T | '')}
      >
        {options.map((o) => (
          <option key={o.value || '__none'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

/** Native date picker; value is YYYY-MM-DD or ''. */
export function DateField(props: FieldShell & { value: string; onChange: (v: string) => void; min?: string; max?: string }) {
  const id = useId();
  const { value, onChange, min, max, ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <input
        id={id}
        className="input"
        type="date"
        value={value}
        min={min}
        max={max}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Shell>
  );
}

/** Native time picker; value is HH:MM or ''. */
export function TimeField(props: FieldShell & { value: string; onChange: (v: string) => void; step?: number }) {
  const id = useId();
  const { value, onChange, step = 300, ...shell } = props;
  return (
    <Shell id={id} {...shell}>
      <input
        id={id}
        className="input"
        type="time"
        value={value}
        step={step}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
        onChange={(e) => onChange(e.target.value.slice(0, 5))}
      />
    </Shell>
  );
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      <label className="checkbox">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function WeekdayPicker({ value, onChange, label = 'Days', error }: { value: Weekday[]; onChange: (v: Weekday[]) => void; label?: string; error?: string | null }) {
  const id = useId();
  const toggle = (day: Weekday) => {
    const next = value.includes(day) ? value.filter((d) => d !== day) : [...value, day];
    onChange(WEEKDAYS.filter((d) => next.includes(d)));
  };
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="weekday-picker">
        {WEEKDAYS.map((day) => (
          <button key={day} type="button" aria-pressed={value.includes(day)} aria-label={WEEKDAY_LABELS[day]} onClick={() => toggle(day)}>
            {WEEKDAY_SHORT[day]}
          </button>
        ))}
      </div>
      {error ? (
        <span className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function ColorField({ value, onChange, label = 'Color' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="swatches">
        {CLASS_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className="swatch"
            style={{ background: color }}
            aria-pressed={value.toUpperCase() === color.toUpperCase()}
            aria-label={`Color ${color}`}
            onClick={() => onChange(color)}
          />
        ))}
        <input
          type="color"
          aria-label="Custom color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#2563eb'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          style={{ width: 32, height: 28, border: 'none', background: 'none', padding: 0 }}
        />
      </div>
    </div>
  );
}
