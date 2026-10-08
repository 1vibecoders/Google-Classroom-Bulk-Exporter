import { describe, expect, it } from 'vitest';
import type { Recurrence } from '../../src/model/types';
import { describeRecurrence, neverOccurs, nextOccurrence, occurrencesInRange, occursOn } from '../../src/lib/recurrence';

const weekly = (r: Partial<Recurrence> & Pick<Recurrence, 'daysOfWeek' | 'startDate'>): Recurrence => ({ frequency: 'weekly', ...r });

describe('occursOn (§ 10)', () => {
  const school = weekly({
    daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
    startDate: '2026-09-02',
    endDate: '2027-06-18',
    exceptDates: ['2026-10-12', '2026-11-26', '2026-11-27'],
  });

  it('checks the date range (start and end inclusive)', () => {
    expect(occursOn(school, '2026-09-01')).toBe(false); // Tuesday before startDate
    expect(occursOn(school, '2026-09-02')).toBe(true); // startDate itself
    expect(occursOn(school, '2027-06-18')).toBe(true); // endDate itself (Friday)
    expect(occursOn(school, '2027-06-21')).toBe(false); // Monday after endDate
  });

  it('checks the weekday', () => {
    expect(occursOn(school, '2026-10-13')).toBe(true); // Tuesday
    expect(occursOn(school, '2026-10-17')).toBe(false); // Saturday
    expect(occursOn(school, '2026-10-18')).toBe(false); // Sunday
  });

  it('skips exceptDates', () => {
    expect(occursOn(school, '2026-10-12')).toBe(false);
    expect(occursOn(school, '2026-11-26')).toBe(false);
    expect(occursOn(school, '2026-11-25')).toBe(true);
  });

  it('has no end without endDate', () => {
    const fencing = weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05' });
    expect(occursOn(fencing, '2031-10-06')).toBe(true); // a Monday five years later
  });

  it('spec vector 1: interval 2 anchored on the week of a mid-week startDate', () => {
    const rule = weekly({ daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-14' });
    expect(occursOn(rule, '2026-10-12')).toBe(false); // before startDate
    expect(occursOn(rule, '2026-10-19')).toBe(false); // odd week
    expect(occurrencesInRange(rule, '2026-10-01', '2026-11-30')).toEqual(['2026-10-26', '2026-11-09', '2026-11-23']);
  });

  it('spec vector 2: Monday-based weeks even when startDate is a Sunday', () => {
    const rule = weekly({ daysOfWeek: ['sun', 'mon'], interval: 2, startDate: '2026-10-11' });
    expect(occurrencesInRange(rule, '2026-10-01', '2026-11-08')).toEqual([
      '2026-10-11',
      '2026-10-19',
      '2026-10-25',
      '2026-11-02',
      '2026-11-08',
    ]);
  });

  it('is not shifted by daylight-saving changes (pure day arithmetic)', () => {
    // US DST starts 2027-03-14, EU 2027-03-28; both inside the range.
    const rule = weekly({ daysOfWeek: ['mon'], interval: 2, startDate: '2027-03-01' });
    expect(occurrencesInRange(rule, '2027-03-01', '2027-04-30')).toEqual([
      '2027-03-01',
      '2027-03-15',
      '2027-03-29',
      '2027-04-12',
      '2027-04-26',
    ]);
    // US DST ends 2026-11-01.
    const every3 = weekly({ daysOfWeek: ['sun'], interval: 3, startDate: '2026-10-11' });
    expect(occurrencesInRange(every3, '2026-10-01', '2026-12-31')).toEqual(['2026-10-11', '2026-11-01', '2026-11-22', '2026-12-13']);
  });

  it('works across years and leap days', () => {
    const rule = weekly({ daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], startDate: '2028-02-27' });
    expect(occurrencesInRange(rule, '2028-02-27', '2028-03-01')).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
    const biweekly = weekly({ daysOfWeek: ['fri'], interval: 2, startDate: '2026-12-25' });
    expect(occurrencesInRange(biweekly, '2026-12-20', '2027-01-31')).toEqual(['2026-12-25', '2027-01-08', '2027-01-22']);
  });

  it('treats a missing or invalid interval as 1 and never throws on bad input', () => {
    expect(occursOn(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05', interval: 0 }), '2026-10-12')).toBe(true);
    expect(occursOn(weekly({ daysOfWeek: ['mon'], startDate: 'not a date' }), '2026-10-12')).toBe(false);
    expect(occursOn(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05' }), '2026-13-45')).toBe(false);
    expect(occurrencesInRange(weekly({ daysOfWeek: [], startDate: '2026-10-05' }), '2026-10-01', '2026-10-31')).toEqual([]);
  });
});

describe('occurrencesInRange', () => {
  it('returns ascending dates within both the range and the rule', () => {
    const rule = weekly({ daysOfWeek: ['wed', 'mon'], startDate: '2026-10-07', endDate: '2026-10-21', exceptDates: ['2026-10-14'] });
    expect(occurrencesInRange(rule, '2026-10-01', '2026-12-31')).toEqual(['2026-10-07', '2026-10-12', '2026-10-19', '2026-10-21']);
    expect(occurrencesInRange(rule, '2026-10-13', '2026-10-19')).toEqual(['2026-10-19']);
    expect(occurrencesInRange(rule, '2026-10-20', '2026-10-10')).toEqual([]);
  });
});

describe('nextOccurrence', () => {
  it('finds the next occurrence on or after a date', () => {
    const rule = weekly({ daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-14' });
    expect(nextOccurrence(rule, '2026-10-07')).toBe('2026-10-26');
    expect(nextOccurrence(rule, '2026-10-26')).toBe('2026-10-26');
    expect(nextOccurrence(rule, '2026-10-27')).toBe('2026-11-09');
  });

  it('skips exceptions and stops at endDate', () => {
    const rule = weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05', endDate: '2026-10-26', exceptDates: ['2026-10-12', '2026-10-19'] });
    expect(nextOccurrence(rule, '2026-10-06')).toBe('2026-10-26');
    expect(nextOccurrence(rule, '2026-10-27')).toBeNull();
  });
});

describe('neverOccurs', () => {
  it('is false for ordinary rules', () => {
    expect(neverOccurs(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05' }))).toBe(false);
    expect(neverOccurs(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05', endDate: '2026-10-05' }))).toBe(false);
  });

  it('detects rules without any occurrence', () => {
    // No Saturday between Monday and Friday.
    expect(neverOccurs(weekly({ daysOfWeek: ['sat'], startDate: '2026-10-12', endDate: '2026-10-16' }))).toBe(true);
    // endDate before startDate.
    expect(neverOccurs(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-12', endDate: '2026-10-05' }))).toBe(true);
    // Every occurrence excepted.
    expect(
      neverOccurs(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-12', endDate: '2026-10-19', exceptDates: ['2026-10-12', '2026-10-19'] })),
    ).toBe(true);
    // Only Monday in range falls in an odd week.
    expect(neverOccurs(weekly({ daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-14', endDate: '2026-10-25' }))).toBe(true);
    // No days.
    expect(neverOccurs(weekly({ daysOfWeek: [], startDate: '2026-10-12' }))).toBe(true);
  });
});

describe('describeRecurrence', () => {
  it('describes common patterns in plain words', () => {
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon'], startDate: '2026-10-05' }))).toBe('Every Monday from Oct 5');
    expect(describeRecurrence(weekly({ daysOfWeek: ['fri', 'mon', 'wed'], startDate: '2026-09-02', endDate: '2027-06-18' }))).toBe(
      'Every Mon, Wed and Fri from Sep 2 to Jun 18',
    );
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' }))).toBe(
      'Every weekday from Sep 2',
    );
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], startDate: '2026-10-05' }))).toBe(
      'Every day from Oct 5',
    );
    expect(describeRecurrence(weekly({ daysOfWeek: ['sat', 'sun'], startDate: '2026-10-05' }))).toBe('Every Sat and Sun from Oct 5');
  });

  it('describes intervals', () => {
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-14' }))).toBe('Every other Monday from Oct 14');
    expect(describeRecurrence(weekly({ daysOfWeek: ['tue', 'thu'], interval: 2, startDate: '2026-10-14' }))).toBe(
      'Every other week on Tue and Thu from Oct 14',
    );
    expect(describeRecurrence(weekly({ daysOfWeek: ['thu', 'tue'], interval: 3, startDate: '2026-10-14' }))).toBe(
      'Every 3 weeks on Tue and Thu from Oct 14',
    );
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon'], interval: 4, startDate: '2026-10-14' }))).toBe('Every 4 weeks on Monday from Oct 14');
  });

  it('mentions only exceptions that cancel an occurrence', () => {
    const school = weekly({
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
      startDate: '2026-09-02',
      endDate: '2027-06-18',
      exceptDates: ['2026-11-27', '2026-10-12', '2026-11-26', '2026-10-17' /* a Saturday: no effect */],
    });
    expect(describeRecurrence(school)).toBe('Every weekday from Sep 2 to Jun 18 (except Oct 12, Nov 26 and Nov 27)');
    const many = weekly({
      daysOfWeek: ['mon'],
      startDate: '2026-10-05',
      exceptDates: ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'],
    });
    expect(describeRecurrence(many)).toBe('Every Monday from Oct 5 (5 exceptions)');
  });

  it('shows years that differ from the current year', () => {
    expect(describeRecurrence(weekly({ daysOfWeek: ['mon'], startDate: '2026-09-07', endDate: '2027-06-14' }), { currentYear: 2026 })).toBe(
      'Every Monday from Sep 7 to Jun 14, 2027',
    );
  });

  it('handles empty day lists', () => {
    expect(describeRecurrence(weekly({ daysOfWeek: [], startDate: '2026-09-07' }))).toBe('Never (no days selected)');
  });
});
