// Weekly repetition (§ 10 Recurrence) shared by the event and study-time
// editors: days, every N weeks, first/last day, skipped dates, and a plain
// description with the next occurrence.
import type { RecurrenceForm } from './eventForm';
import { formToRecurrence, recurrenceNeverOccurs } from './eventForm';
import { describeRecurrence, nextOccurrence, occursOn } from '../../lib/recurrence';
import { formatDateWithWeekday, isValidDate } from '../../lib/time';
import { NumberField, DateField, WeekdayPicker } from '../../ui/fields';
import { Icon } from '../../ui/Icon';
import { DateListInput } from './inputs';

export function RecurrenceFields({
  value,
  onChange,
  error,
  today,
}: {
  value: RecurrenceForm;
  onChange: (value: RecurrenceForm) => void;
  error: (key: string) => string | null;
  today: string;
}) {
  const set = <K extends keyof RecurrenceForm>(key: K, v: RecurrenceForm[K]) => onChange({ ...value, [key]: v });
  const year = Number(today.slice(0, 4));
  const complete = value.daysOfWeek.length > 0 && isValidDate(value.startDate) && (!value.endDate || isValidDate(value.endDate));
  const rule = complete ? formToRecurrence(value, undefined) : null;
  const never = complete && recurrenceNeverOccurs(value);
  const next = rule && !never ? nextOccurrence(rule, today) : null;
  const pattern = rule ? { ...rule, exceptDates: [] } : null;

  return (
    <div className="ed-recurrence">
      <WeekdayPicker label="On these days" value={value.daysOfWeek} onChange={(days) => set('daysOfWeek', days)} error={error('recurrence.daysOfWeek')} />
      <div className="form-grid">
        <NumberField
          label="Repeat every"
          suffix={value.interval === 1 ? 'week' : 'weeks'}
          value={value.interval}
          min={1}
          max={52}
          onChange={(v) => set('interval', v)}
          hint="1 = every week, 2 = every other week."
          error={error('recurrence.interval')}
        />
        <div />
        <DateField label="Starts on" required value={value.startDate} onChange={(v) => set('startDate', v)} error={error('recurrence.startDate')} />
        <DateField
          label="Ends on"
          value={value.endDate}
          min={value.startDate || undefined}
          onChange={(v) => set('endDate', v)}
          hint="Leave empty if it has no end."
          error={error('recurrence.endDate')}
        />
      </div>
      <DateListInput
        label="Skip these dates"
        dates={value.exceptDates}
        onChange={(dates) => set('exceptDates', dates)}
        hint="Holidays or cancelled days. To move one occurrence, skip it here and add a one-time event."
        error={error('recurrence.exceptDates')}
        describe={(date) => (pattern && isValidDate(date) && !occursOn(pattern, date) ? 'not a day it occurs' : null)}
      />
      {rule ? (
        <p className={`ed-preview small ${never ? 'warning' : ''}`} aria-live="polite">
          <Icon name={never ? 'warning' : 'repeat'} size={14} />
          <span>
            {never ? (
              'This rule never occurs: no chosen day falls between the start and end dates (after skipped dates).'
            ) : (
              <>
                {describeRecurrence(rule, { currentYear: year })}
                {next ? ` · next: ${formatDateWithWeekday(next, year)}` : ' · no more occurrences after today'}
              </>
            )}
          </span>
        </p>
      ) : null}
    </div>
  );
}
