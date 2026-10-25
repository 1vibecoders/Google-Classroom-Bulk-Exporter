// .ics (Google Calendar export) import: folded lines and escapes, UTC and
// TZID times converted to the schedule's zone, all-day events, weekly repeats
// with BYDAY / INTERVAL / UNTIL / COUNT / EXDATE, unsupported repeats reported
// as skipped, stable IDs so importing twice changes nothing, and broken input
// that never throws.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { icsEventId, icsToSchedule } from '../../src/lib/ics';
import { applyImport, defaultSelection, planImport } from '../../src/lib/importDiff';
import { validateDocument } from '../../src/lib/validate';
import type { ScheduleDocument, ScheduleEvent } from '../../src/model/types';

const NOW = '2026-10-12T16:00:00';
const TODAY = '2026-10-12';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../fixtures/ics', name), 'utf8');
}

function empty(timezone = 'America/New_York'): ScheduleDocument {
  return { schemaVersion: '1.0', meta: { timezone }, classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [] };
}

function example(): ScheduleDocument {
  const result = validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: TODAY });
  if (!result.doc) throw new Error('example invalid');
  return result.doc;
}

function byUid(events: ScheduleEvent[], uid: string): ScheduleEvent {
  const event = events.find((e) => e.id === icsEventId(uid));
  if (!event) throw new Error(`no event for ${uid}`);
  return event;
}

function calendar(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');
}

describe('icsToSchedule: Google Calendar export', () => {
  const result = icsToSchedule(empty(), fixture('google-export.ics'), NOW);

  it('produces a valid schedule with only the events added', () => {
    const checked = validateDocument(result.doc, { today: TODAY });
    expect(checked.errors).toEqual([]);
    expect(result.doc.events).toHaveLength(6);
    expect(result.doc.meta?.generator?.name).toBe('Google Calendar (.ics)');
    expect(result.doc.meta?.timezone).toBe('America/New_York');
  });

  it('unfolds lines, unescapes text and ignores VALARM properties', () => {
    const chem = byUid(result.events, '7kq2m9chem2period@google.com');
    expect(chem.title).toBe('Chemistry, Period 2 with Ms. Alvarez – a long title that Google folds onto a second line');
    expect(chem.location).toBe('Room 204; Science wing');
    expect(chem.id).toBe('ics-7kq2m9chem2period-google.com');
    expect(chem.origin).toBe('generated');
    expect(chem.source).toEqual({ kind: 'calendar', id: '7kq2m9chem2period@google.com', label: 'Calendar file (.ics)', retrievedAt: NOW });
  });

  it('maps a weekly BYDAY rule with UNTIL and EXDATE (comma list and repeated lines)', () => {
    const chem = byUid(result.events, '7kq2m9chem2period@google.com');
    expect(chem.date).toBeUndefined();
    expect(chem.startTime).toBe('08:00');
    expect(chem.endTime).toBe('09:20');
    // UNTIL=20261218T045959Z is Dec 17, 23:59 in New York.
    expect(chem.recurrence).toEqual({
      frequency: 'weekly',
      daysOfWeek: ['mon', 'wed', 'fri'],
      startDate: '2026-09-09',
      endDate: '2026-12-17',
      exceptDates: ['2026-11-25', '2026-11-27', '2026-12-04'],
    });
  });

  it('turns COUNT with INTERVAL into an end date', () => {
    // Every other Tuesday, 4 times: Sep 15, Sep 29, Oct 13, Oct 27.
    expect(byUid(result.events, 'piano-lessons@google.com').recurrence).toEqual({
      frequency: 'weekly',
      daysOfWeek: ['tue'],
      interval: 2,
      startDate: '2026-09-15',
      endDate: '2026-10-27',
    });
  });

  it('converts UTC times to the schedule zone', () => {
    const dentist = byUid(result.events, 'dentist-2026@google.com');
    expect(dentist).toMatchObject({ date: '2026-10-15', startTime: '16:00', endTime: '17:30' });
    expect(dentist.allDay).toBeUndefined();
  });

  it('reads all-day events with an exclusive DTEND, and TRANSPARENT as not busy', () => {
    const brk = byUid(result.events, 'thanksgiving-break@google.com');
    expect(brk).toMatchObject({ date: '2026-11-26', endDate: '2026-11-27', allDay: true, busy: false });
    expect(brk.startTime).toBeUndefined();
  });

  it('keeps only the first occurrence of unsupported repeats and reports them, with changed occurrences and cancelled events', () => {
    expect(byUid(result.events, 'morning-run@google.com')).toMatchObject({ date: '2026-10-01', startTime: '06:30', endTime: '07:15' });
    expect(byUid(result.events, 'morning-run@google.com').recurrence).toBeUndefined();
    expect(byUid(result.events, 'robotics-club@google.com').date).toBe('2026-10-01');
    expect(result.skipped.map((s) => s.title)).toEqual(['Chemistry, Period 2 (lab day)', 'Morning run', 'Robotics club', 'Cancelled meeting']);
    expect(result.skipped[1].reason).toMatch(/repeats daily; only the first occurrence \(2026-10-01\)/);
    expect(result.skipped[2].reason).toMatch(/repeats monthly/);
    expect(result.skipped[3].reason).toMatch(/cancelled/);
  });

  it('reports a weekly rule with parts the model cannot hold', () => {
    const r = icsToSchedule(
      empty(),
      calendar('BEGIN:VEVENT', 'UID:x', 'SUMMARY:Odd', 'DTSTART:20261005T100000', 'DTEND:20261005T110000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU;BYSETPOS=1', 'END:VEVENT'),
      NOW,
    );
    expect(r.events[0]).toMatchObject({ date: '2026-10-05' });
    expect(r.skipped).toEqual([{ title: 'Odd', reason: expect.stringMatching(/BYSETPOS/) }]);
  });
});

describe('icsToSchedule: time zones', () => {
  const result = icsToSchedule(empty(), fixture('time-zones.ics').replace(/\n/g, '\r\n'), NOW);

  it('converts TZID times with Intl', () => {
    // 15:00 in London (BST) is 10:00 in New York (EDT).
    expect(byUid(result.events, 'london-call')).toMatchObject({ date: '2026-10-15', startTime: '10:00', endTime: '11:00' });
  });

  it('moves BYDAY and EXDATE with a start that converts to another day', () => {
    // Monday 08:30 in Tokyo is Sunday 19:30 in New York.
    const tutoring = byUid(result.events, 'tokyo-tutoring');
    expect(tutoring).toMatchObject({ startTime: '19:30', endTime: '20:30' });
    expect(tutoring.recurrence).toEqual({ frequency: 'weekly', daysOfWeek: ['sun'], startDate: '2026-09-13', exceptDates: ['2026-09-27'] });
  });

  it('reads an unknown TZID and floating times as wall-clock times, with a warning for the zone', () => {
    expect(byUid(result.events, 'mars-meeting')).toMatchObject({ date: '2026-10-16', startTime: '09:00', endTime: '10:00' });
    expect(byUid(result.events, 'floating-study')).toMatchObject({ date: '2026-10-17', startTime: '14:00', endTime: '15:30' });
    expect(result.warnings.some((w) => w.includes('Mars/Olympus_Mons'))).toBe(true);
  });

  it('ends an event that crosses midnight at 24:00, with a warning', () => {
    expect(byUid(result.events, 'late-shift')).toMatchObject({ date: '2026-10-18', startTime: '22:00', endTime: '24:00' });
    expect(result.warnings.some((w) => w.includes('Late shift'))).toBe(true);
    expect(validateDocument(result.doc, { today: TODAY }).errors).toEqual([]);
  });

  it('uses another schedule zone when meta.timezone says so', () => {
    const london = icsToSchedule(empty('Europe/London'), fixture('time-zones.ics'), NOW);
    expect(byUid(london.events, 'london-call')).toMatchObject({ startTime: '15:00', endTime: '16:00' });
  });
});

describe('icsToSchedule: importing again', () => {
  it('gives the same IDs every time', () => {
    const a = icsToSchedule(empty(), fixture('google-export.ics'), NOW);
    const b = icsToSchedule(empty(), fixture('google-export.ics'), '2026-10-13T09:00:00');
    expect(b.events.map((e) => e.id)).toEqual(a.events.map((e) => e.id));
  });

  it('adds the events once; the second import of the same file changes nothing and creates no duplicates', () => {
    const current = example();
    const first = validateDocument(icsToSchedule(current, fixture('google-export.ics'), NOW).doc, { today: TODAY });
    expect(first.errors).toEqual([]);
    const plan1 = planImport(current, first.doc!, NOW);
    expect(plan1.errors).toEqual([]);
    expect(plan1.summary.new.events).toBe(6);
    expect(plan1.summary.missing.events ?? 0).toBe(0);
    const after = applyImport(current, first.doc!, plan1, defaultSelection(plan1), NOW);
    expect(after.events.length).toBe(current.events.length + 6);

    const second = validateDocument(icsToSchedule(after, fixture('google-export.ics'), '2026-10-13T09:00:00').doc, { today: TODAY });
    expect(second.errors).toEqual([]);
    expect(second.doc!.events.length).toBe(after.events.length);
    const plan2 = planImport(after, second.doc!, '2026-10-13T09:00:00');
    expect(plan2.summary.new.events ?? 0).toBe(0);
    expect(plan2.summary.updated.events ?? 0).toBe(0);
    expect(plan2.summary.possibleDuplicate.events ?? 0).toBe(0);
  });

  it('updates a moved event in place and keeps the person’s notes; a deleted event is not brought back', () => {
    const base = icsToSchedule(empty(), fixture('google-export.ics'), NOW).doc;
    const dentistId = icsEventId('dentist-2026@google.com');
    const runId = icsEventId('morning-run@google.com');
    base.events = base.events.map((e) => (e.id === dentistId ? { ...e, notes: 'Bring insurance card' } : e));
    base.events = base.events.filter((e) => e.id !== runId);
    base.deleted = [{ id: runId, collection: 'events', deletedAt: NOW }];
    const moved = fixture('google-export.ics').replace('DTSTART:20261015T200000Z', 'DTSTART:20261015T190000Z');
    const next = icsToSchedule(base, moved, NOW).doc;
    expect(next.events.filter((e) => e.id === dentistId)).toEqual([expect.objectContaining({ startTime: '15:00', endTime: '17:30', notes: 'Bring insurance card' })]);
    expect(next.events.some((e) => e.id === runId)).toBe(false);
  });
});

describe('icsToSchedule: broken input', () => {
  it('skips unreadable events and keeps the good ones', () => {
    const r = icsToSchedule(empty(), fixture('broken.ics'), NOW);
    expect(r.events.map((e) => e.title)).toEqual(['Good one', 'Unclosed at end of file']);
    expect(r.skipped.map((s) => s.title)).toEqual(['No start', 'Bad start', 'February 30', 'No end', 'Same UID again']);
    expect(validateDocument(r.doc, { today: TODAY }).errors).toEqual([]);
  });

  it('never throws on text that is not a calendar', () => {
    for (const text of ['', '{"schemaVersion":"1.0"}', '\u0000￿ garbage', 'BEGIN:VCALENDAR', undefined as unknown as string]) {
      const r = icsToSchedule(empty(), text, NOW);
      expect(r.events).toEqual([]);
      expect(r.doc.events).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  it('gives events without a UID a stable ID and makes long UIDs fit', () => {
    const text = calendar('BEGIN:VEVENT', 'SUMMARY:No UID', 'DTSTART;VALUE=DATE:20261020', 'END:VEVENT');
    const a = icsToSchedule(empty(), text, NOW).events[0];
    expect(a.id).toBe(icsToSchedule(empty(), text, NOW).events[0].id);
    expect(a.source).toBeUndefined();
    const long = icsEventId(`${'x'.repeat(300)}@example.com`);
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  });
});
