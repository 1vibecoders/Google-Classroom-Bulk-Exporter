// The settings form's draft, its validation and how it becomes `settings`
// (pure; unit-tested). Settings are person-owned (§ 5 Settings).
import { DEFAULT_SETTINGS } from '../../model/constants';
import type { ResolvedSettings, Settings } from '../../model/types';
import { isValidEndTime, isValidTime, timeToMinutes } from '../../lib/time';

export interface SettingsDraft {
  weekStartsOn: 'monday' | 'sunday';
  dayStartTime: string;
  dayEndTime: string;
  defaultDueTime: string;
  minSessionMinutes: number | '';
  maxSessionMinutes: number | '';
  breakMinutes: number | '';
  /** '' = no limit. */
  maxDailyStudyMinutes: number | '';
}

export type SettingsErrors = Partial<Record<keyof SettingsDraft, string>>;

export const SETTINGS_KEYS: Array<keyof SettingsDraft> = [
  'weekStartsOn',
  'dayStartTime',
  'dayEndTime',
  'defaultDueTime',
  'minSessionMinutes',
  'maxSessionMinutes',
  'breakMinutes',
  'maxDailyStudyMinutes',
];

export function draftFrom(settings: ResolvedSettings): SettingsDraft {
  return {
    weekStartsOn: settings.weekStartsOn,
    dayStartTime: settings.dayStartTime,
    dayEndTime: settings.dayEndTime,
    defaultDueTime: settings.defaultDueTime,
    minSessionMinutes: settings.minSessionMinutes,
    maxSessionMinutes: settings.maxSessionMinutes,
    breakMinutes: settings.breakMinutes,
    maxDailyStudyMinutes: settings.maxDailyStudyMinutes ?? '',
  };
}

function minutesError(value: number | '', min: number, max: number, required: boolean): string | undefined {
  if (value === '') return required ? 'Enter a number of minutes.' : undefined;
  if (!Number.isInteger(value)) return 'Use whole minutes.';
  if (value < min || value > max) return `Between ${min} and ${max} minutes.`;
  return undefined;
}

/** Field errors (the format's ranges, § 5 Settings). Empty when the draft is valid. */
export function validateDraft(d: SettingsDraft): SettingsErrors {
  const errors: SettingsErrors = {};
  if (!isValidTime(d.dayStartTime)) errors.dayStartTime = 'Choose a start time.';
  if (!isValidEndTime(d.dayEndTime)) errors.dayEndTime = 'Choose an end time.';
  if (!errors.dayStartTime && !errors.dayEndTime && timeToMinutes(d.dayEndTime) <= timeToMinutes(d.dayStartTime)) {
    errors.dayEndTime = 'Must be later than the start time.';
  }
  if (!isValidTime(d.defaultDueTime)) errors.defaultDueTime = 'Enter a time, e.g. 00:00 or 23:59.';
  const min = minutesError(d.minSessionMinutes, 5, 240, true);
  if (min) errors.minSessionMinutes = min;
  const max = minutesError(d.maxSessionMinutes, 10, 480, true);
  if (max) errors.maxSessionMinutes = max;
  if (!min && !max && d.minSessionMinutes !== '' && d.maxSessionMinutes !== '' && d.maxSessionMinutes < d.minSessionMinutes) {
    errors.maxSessionMinutes = 'Must be at least the shortest session.';
  }
  const brk = minutesError(d.breakMinutes, 0, 120, true);
  if (brk) errors.breakMinutes = brk;
  const daily = minutesError(d.maxDailyStudyMinutes, 0, 1440, false);
  if (daily) errors.maxDailyStudyMinutes = daily;
  return errors;
}

/**
 * The `settings` object to save. A value equal to the default is only written
 * when the schedule already had that setting, so saving an untouched form
 * does not fill a schedule with defaults. `undefined` removes a setting.
 */
export function settingsFromDraft(d: SettingsDraft, current: Settings | undefined): Settings {
  const had = current || {};
  const out: Settings = {};
  const put = <K extends keyof Settings>(key: K, value: Settings[K], fallback: unknown) => {
    out[key] = value === fallback && had[key] === undefined ? undefined : value;
  };
  put('weekStartsOn', d.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn);
  put('dayStartTime', d.dayStartTime, DEFAULT_SETTINGS.dayStartTime);
  put('dayEndTime', d.dayEndTime, DEFAULT_SETTINGS.dayEndTime);
  put('defaultDueTime', d.defaultDueTime, DEFAULT_SETTINGS.defaultDueTime);
  put('minSessionMinutes', d.minSessionMinutes === '' ? undefined : d.minSessionMinutes, DEFAULT_SETTINGS.minSessionMinutes);
  put('maxSessionMinutes', d.maxSessionMinutes === '' ? undefined : d.maxSessionMinutes, DEFAULT_SETTINGS.maxSessionMinutes);
  put('breakMinutes', d.breakMinutes === '' ? undefined : d.breakMinutes, DEFAULT_SETTINGS.breakMinutes);
  out.maxDailyStudyMinutes = d.maxDailyStudyMinutes === '' ? undefined : d.maxDailyStudyMinutes;
  return out;
}

export function sameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  return SETTINGS_KEYS.every((k) => a[k] === b[k]);
}

/** Times every 30 minutes for the day-range pickers (plus `extra` if it is not on the grid). */
export function timeOptions(fromMinutes: number, toMinutes: number, extra?: string): string[] {
  const out: string[] = [];
  for (let m = fromMinutes; m <= toMinutes; m += 30) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  if (extra && !out.includes(extra)) {
    out.push(extra);
    out.sort();
  }
  return out;
}
