import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateFromDayNumber,
  dateOf,
  dateRange,
  dayNumber,
  dueMoment,
  formatDateLong,
  formatDateOrDateTime,
  formatDuration,
  formatTime12,
  isValidDate,
  isValidLocalDateTime,
  isValidTime,
  ldtToMinutes,
  minutesBetween,
  minutesToLdt,
  mondayOf,
  normalizeLocalDateTime,
  startOfWeek,
  timeToMinutes,
  todayLocal,
  weekdayOf,
} from '../../src/lib/time';

describe('validation', () => {
  it('accepts only real dates', () => {
    expect(isValidDate('2026-10-16')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
    expect(isValidDate('10/16/2026')).toBe(false);
    expect(isValidDate(20261016)).toBe(false);
  });
  it('accepts 24-hour HH:MM times only', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
    expect(isValidTime('15:60')).toBe(false);
  });
  it('accepts local date-times without offsets', () => {
    expect(isValidLocalDateTime('2026-10-16T23:59:00')).toBe(true);
    expect(isValidLocalDateTime('2026-10-16T23:59')).toBe(true);
    expect(isValidLocalDateTime('2026-10-16T23:59:00Z')).toBe(false);
    expect(isValidLocalDateTime('2026-10-16T23:59:00-04:00')).toBe(false);
    expect(isValidLocalDateTime('2026-10-16 23:59')).toBe(false);
    expect(isValidLocalDateTime('2026-02-30T10:00')).toBe(false);
  });
});

describe('calendar arithmetic', () => {
  it('round-trips day numbers across years and leap days', () => {
    for (const d of ['1970-01-01', '2026-03-08', '2026-11-01', '2028-02-29', '2099-12-31']) {
      expect(dateFromDayNumber(dayNumber(d))).toBe(d);
    }
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('knows weekdays and week starts', () => {
    expect(weekdayOf('2026-10-12')).toBe('mon');
    expect(weekdayOf('2026-10-16')).toBe('fri');
    expect(weekdayOf('2026-10-18')).toBe('sun');
    expect(mondayOf('2026-10-18')).toBe('2026-10-12');
    expect(mondayOf('2026-10-12')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-14', 'sunday')).toBe('2026-10-11');
    expect(startOfWeek('2026-10-11', 'sunday')).toBe('2026-10-11');
  });
  it('lists date ranges inclusively', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });
});

describe('times and date-times', () => {
  it('converts between representations', () => {
    expect(timeToMinutes('16:45')).toBe(1005);
    expect(normalizeLocalDateTime('2026-10-13T16:00:59')).toBe('2026-10-13T16:00:00');
    expect(minutesBetween('2026-10-13T16:00', '2026-10-13T16:45:00')).toBe(45);
    expect(minutesToLdt(ldtToMinutes('2026-10-13T23:30:00') + 45)).toBe('2026-10-14T00:15:00');
    expect(dateOf('2026-10-16T23:59:00')).toBe('2026-10-16');
  });
  it('treats date-only due dates as the default due time', () => {
    expect(dueMoment('2026-10-16')).toBe('2026-10-16T23:59:00');
    expect(dueMoment('2026-10-16', '17:00')).toBe('2026-10-16T17:00:00');
    expect(dueMoment('2026-10-16T08:00')).toBe('2026-10-16T08:00:00');
  });
  it('is not affected by daylight-saving transitions', () => {
    // US DST ends 2026-11-01: still 24 h × 60 between consecutive days.
    expect(minutesBetween('2026-10-31T12:00', '2026-11-01T12:00')).toBe(1440);
  });
  it('reads today from the device clock', () => {
    expect(todayLocal(new Date(2026, 9, 7, 23, 59))).toBe('2026-10-07');
  });
});

describe('formatting', () => {
  it('formats for display', () => {
    expect(formatDateLong('2026-10-13')).toBe('Tuesday, October 13');
    expect(formatDateLong('2027-01-05', 2026)).toBe('Tuesday, January 5, 2027');
    expect(formatTime12('00:05')).toBe('12:05 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
    expect(formatTime12('16:00')).toBe('4:00 PM');
    expect(formatDuration(275)).toBe('4 h 35 m');
    expect(formatDuration(45)).toBe('45 m');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDateOrDateTime('2026-10-16T23:59:00')).toBe('Oct 16, 11:59 PM');
    expect(formatDateOrDateTime('2026-10-16')).toBe('Oct 16');
  });
});

describe('end of day', () => {
  it('accepts 24:00 only as an end time and formats it as midnight', async () => {
    const { isValidTime, isValidEndTime, timeToMinutes, formatTime12 } = await import('../../src/lib/time');
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidEndTime('24:00')).toBe(true);
    expect(isValidEndTime('24:01')).toBe(false);
    expect(timeToMinutes('24:00')).toBe(1440);
    expect(formatTime12('24:00')).toBe('12:00 AM');
    expect(formatTime12('12:30')).toBe('12:30 PM');
  });
});
