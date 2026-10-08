// Pure logic of the list views: safe links, relative dates, assignment rows,
// filters and groups (§ 8.1 numbers), issues, class stats, the settings form
// and the weekly overview grid.
import { describe, expect, it } from 'vitest';
import type { Assignment, ScheduleDocument } from '../../src/model/types';
import { formatBlockTime, formatTimeRange, formatWhen, relativeDays, safeHref, sourceSummary } from '../../src/views/lists/format';
import {
  DEFAULT_FILTER,
  NO_CLASS,
  assignmentIssues,
  buildRows,
  countOpen,
  groupRows,
  issueIds,
  itemIssues,
  matchesFilter,
} from '../../src/views/lists/assignmentModel';
import { classStats } from '../../src/views/lists/classModel';
import { draftFrom, settingsFromDraft, timeOptions, validateDraft } from '../../src/views/lists/settingsModel';
import { buildWeekColumns } from '../../src/views/lists/WeekGrid';
import { DEFAULT_SETTINGS, resolveSettings } from '../../src/model/constants';

const NOW = '2026-10-07T12:00:00'; // Wednesday; week Mon Oct 5 – Sun Oct 11

function asg(partial: Partial<Assignment> & { id: string }): Assignment {
  return { title: partial.id, ...partial };
}

function doc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [
      { id: 'eng', name: 'English', color: '#2563EB', origin: 'user' },
      { id: 'bio', name: 'Biology', origin: 'user', references: [{ title: 'Syllabus', url: 'https://example.org/s.pdf' }] },
    ],
    assignments: [
      asg({ id: 'overdue', classId: 'eng', title: 'Overdue essay', due: '2026-10-06T23:59:00', estimatedMinutes: 60 }),
      asg({ id: 'week', classId: 'eng', title: 'Read chapter 6', due: '2026-10-09', estimatedMinutes: 45, priority: 'high' }),
      asg({ id: 'week2', classId: 'bio', title: 'Lab report', due: '2026-10-09T08:00:00', estimatedMinutes: 90 }),
      asg({
        id: 'later',
        classId: 'bio',
        title: 'Unit test',
        type: 'test',
        assessmentDate: '2026-10-20',
        estimatedMinutes: 120,
        tasks: [
          { id: 'later-t1', title: 'Flashcards', estimatedMinutes: 60, status: 'done', issues: [{ kind: 'ambiguity', message: 'Which chapters?' }] },
          { id: 'later-t2', title: 'Practice questions', estimatedMinutes: 60 },
        ],
      }),
      asg({ id: 'nodate', title: 'Return library books', estimatedMinutes: 15 }),
      asg({ id: 'done', classId: 'eng', title: 'Old worksheet', due: '2026-10-02', status: 'done', completedAt: '2026-10-01T18:00:00' }),
      asg({ id: 'withdrawn', classId: 'eng', title: 'Withdrawn quiz', due: '2026-10-01', sourceState: 'withdrawn', estimatedMinutes: 30 }),
      asg({ id: 'unest', classId: 'bio', title: 'Poster', due: '2026-10-30' }),
    ],
    events: [
      {
        id: 'school',
        title: 'School',
        startTime: '08:00',
        endTime: '15:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01', exceptDates: ['2026-10-09'] },
      },
      {
        id: 'fencing',
        title: 'Fencing',
        classId: 'bio',
        startTime: '16:00',
        endTime: '18:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', interval: 2 },
      },
      { id: 'doctor', title: 'Doctor', date: '2026-10-08', startTime: '15:30', endTime: '16:30' },
      { id: 'trip', title: 'Trip', date: '2026-10-10', endDate: '2026-10-11', allDay: true },
    ],
    availability: [
      {
        id: 'after',
        label: 'After school',
        startTime: '15:30',
        endTime: '21:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' },
      },
    ],
    scheduleBlocks: [
      { id: 'b1', assignmentId: 'week2', start: '2026-10-08T17:00:00', end: '2026-10-08T17:45:00' },
      { id: 'b2', assignmentId: 'later', taskId: 'later-t2', start: '2026-10-06T17:00:00', end: '2026-10-06T17:30:00', status: 'done' },
      { id: 'b3', assignmentId: 'later', taskId: 'later-t2', start: '2026-10-12T17:00:00', end: '2026-10-12T17:30:00' },
    ],
    issues: [
      { id: 'root-1', kind: 'workload', message: 'Thursday is tight', itemId: 'b3', date: '2026-10-12' },
      { id: 'root-2', kind: 'conflict', message: 'Two dates', itemId: 'bio', status: 'dismissed' },
    ],
    ...partial,
  };
}

describe('safeHref', () => {
  it('allows only absolute http, https and mailto links', () => {
    expect(safeHref('https://classroom.google.com/c/abc')).toBe('https://classroom.google.com/c/abc');
    expect(safeHref('HTTP://Example.org/x')).toBe('http://example.org/x');
    expect(safeHref('mailto:teacher@example.org')).toBe('mailto:teacher@example.org');
    expect(safeHref('  https://example.org/a  ')).toBe('https://example.org/a');
  });

  it('rejects scripts, data, files, relative paths and malformed values', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      '/relative/path',
      'English 10/Assignments/rubric.pdf',
      'https://',
      'https://exa mple.org',
      '',
      undefined,
      42,
    ]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
  });
});

describe('format helpers', () => {
  it('describes days relative to today', () => {
    expect(relativeDays('2026-10-07', '2026-10-07')).toBe('today');
    expect(relativeDays('2026-10-08', '2026-10-07')).toBe('tomorrow');
    expect(relativeDays('2026-10-06', '2026-10-07')).toBe('yesterday');
    expect(relativeDays('2026-10-10', '2026-10-07')).toBe('in 3 days');
    expect(relativeDays('2026-10-04', '2026-10-07')).toBe('3 days ago');
    expect(relativeDays('2026-10-21', '2026-10-07')).toBe('in 2 weeks');
    expect(relativeDays('2026-10-23', '2026-10-07')).toBe('in 16 days');
  });

  it('formats due values, ranges and sources', () => {
    expect(formatWhen('2026-10-16T23:59:00', 2026)).toBe('Fri, Oct 16, 11:59 PM');
    expect(formatWhen('2026-10-13', 2026)).toBe('Tue, Oct 13');
    expect(formatTimeRange('15:30', '24:00')).toBe('3:30 PM – midnight');
    expect(formatBlockTime('2026-10-13T23:00:00', '2026-10-14T00:00:00')).toBe('11:00 PM – midnight');
    expect(sourceSummary({ kind: 'google_classroom', label: 'English 10', retrievedAt: '2026-10-11T18:05:00' }, 2026)).toBe(
      'Google Classroom · English 10 · retrieved Oct 11',
    );
  });
});

describe('assignment rows', () => {
  const d = doc();
  const rows = buildRows(d, NOW);
  const byId = new Map(rows.map((r) => [r.assignment.id, r]));

  it('puts each assignment in its deadline group', () => {
    expect(byId.get('overdue')!.group).toBe('overdue');
    expect(byId.get('week')!.group).toBe('thisWeek');
    expect(byId.get('week2')!.group).toBe('thisWeek');
    expect(byId.get('later')!.group).toBe('later');
    expect(byId.get('nodate')!.group).toBe('noDate');
    expect(byId.get('done')!.group).toBe('done');
    // Withdrawn work does not count (§ 8.1 rule 3), so it is not "overdue".
    expect(byId.get('withdrawn')!.group).toBe('past');
  });

  it('carries the § 8.1 numbers', () => {
    const later = byId.get('later')!.progress;
    // Task 1 done (0) + task 2: 60 − 30 done = 30; untasked remainder 0.
    expect(later.remainingMinutes).toBe(30);
    expect(later.scheduledMinutes).toBe(30);
    expect(later.unscheduledMinutes).toBe(0);
    expect(byId.get('week2')!.progress.unscheduledMinutes).toBe(45);
    expect(byId.get('unest')!.progress.remainingMinutes).toBeNull();
    expect(byId.get('withdrawn')!.progress.remainingMinutes).toBe(0);
  });

  it('groups by deadline in a fixed order, soonest first, with remaining sums', () => {
    const groups = groupRows(
      rows.filter((r) => matchesFilter(r, { ...DEFAULT_FILTER, status: 'all' })),
      'deadline',
    );
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'thisWeek', 'later', 'noDate', 'past', 'done']);
    const week = groups.find((g) => g.key === 'thisWeek')!;
    // Date-only due Oct 9 (00:00 by default) sorts before Oct 9, 8:00 AM.
    expect(week.rows.map((r) => r.assignment.id)).toEqual(['week', 'week2']);
    expect(week.remainingMinutes).toBe(45 + 90);
    expect(groups.find((g) => g.key === 'later')!.rows.map((r) => r.assignment.id)).toEqual(['later', 'unest']);
  });

  it('groups by class (No class last)', () => {
    const groups = groupRows(rows, 'class', d.classes);
    expect(groups.map((g) => g.label)).toEqual(['Biology', 'English', 'No class']);
    // Open work first, done last.
    expect(groups[1].rows.map((r) => r.assignment.id).at(-1)).toBe('done');
  });

  it('filters by class, no class, status, type and search text', () => {
    const ids = (filter: Partial<typeof DEFAULT_FILTER>) =>
      rows
        .filter((r) => matchesFilter(r, { ...DEFAULT_FILTER, ...filter }))
        .map((r) => r.assignment.id)
        .sort();
    expect(ids({})).not.toContain('done');
    expect(ids({ status: 'done' })).toEqual(['done']);
    expect(ids({ status: 'all', classId: 'eng' })).toEqual(['done', 'overdue', 'week', 'withdrawn']);
    expect(ids({ classId: NO_CLASS })).toEqual(['nodate']);
    expect(ids({ type: 'test' })).toEqual(['later']);
    expect(ids({ query: 'practice' })).toEqual(['later']); // a subtask title
    expect(ids({ query: 'biology lab' })).toEqual(['week2']); // class name + title
    expect(ids({ query: 'nothing-matches' })).toEqual([]);
  });

  it('collects issues about an assignment, its tasks and its blocks', () => {
    const later = d.assignments.find((a) => a.id === 'later')!;
    const entries = assignmentIssues(d, later);
    expect(entries.map((e) => e.holder.kind).sort()).toEqual(['root', 'task']);
    expect(entries.find((e) => e.holder.kind === 'task')!.context).toBe('Subtask: Flashcards');
    expect(byId.get('later')!.openIssues).toBe(2);
    const bio = itemIssues(d, 'classes', d.classes[1]);
    expect(bio).toHaveLength(1);
    expect(countOpen(bio)).toBe(0);
    expect([...issueIds(d)].sort()).toEqual(['root-1', 'root-2']);
  });
});

describe('class stats', () => {
  it('counts open work, remaining minutes and the next deadline per class', () => {
    const stats = classStats(doc(), NOW);
    const eng = stats.get('eng')!;
    expect(eng.assignments).toBe(4);
    expect(eng.open).toBe(3);
    expect(eng.remainingMinutes).toBe(60 + 45);
    expect(eng.overdue).toBe(1);
    expect(eng.next?.assignment.id).toBe('overdue');
    const bio = stats.get('bio')!;
    expect(bio.remainingMinutes).toBe(90 + 30);
    expect(bio.unestimated).toBe(1);
    expect(bio.events).toBe(1);
    expect(bio.blocks).toBe(3);
    expect(bio.doneBlocks).toBe(1);
    expect(bio.next).toMatchObject({ kind: 'due', assignment: { id: 'week2' } });
    expect(stats.get('')!.assignments).toBe(1);
  });

  it('labels an assessment as the next date when it comes first', () => {
    const d = doc({
      assignments: [asg({ id: 't', classId: 'bio', type: 'test', assessmentDate: '2026-10-09T09:10:00', due: '2026-10-12', estimatedMinutes: 30 })],
    });
    expect(classStats(d, NOW).get('bio')!.next).toMatchObject({ kind: 'assessment', value: '2026-10-09T09:10:00' });
  });
});

describe('settings form', () => {
  const defaults = draftFrom(resolveSettings(undefined));

  it('accepts the defaults and reports out-of-range values', () => {
    expect(validateDraft(defaults)).toEqual({});
    const errors = validateDraft({
      ...defaults,
      dayStartTime: '22:00',
      dayEndTime: '21:00',
      minSessionMinutes: 3,
      maxSessionMinutes: 600,
      breakMinutes: 7.5,
      maxDailyStudyMinutes: 2000,
    });
    expect(Object.keys(errors).sort()).toEqual(['breakMinutes', 'dayEndTime', 'maxDailyStudyMinutes', 'maxSessionMinutes', 'minSessionMinutes']);
    expect(validateDraft({ ...defaults, minSessionMinutes: 60, maxSessionMinutes: 30 }).maxSessionMinutes).toMatch(/at least/);
    expect(validateDraft({ ...defaults, dayEndTime: '24:00' })).toEqual({});
    expect(validateDraft({ ...defaults, defaultDueTime: '' }).defaultDueTime).toBeTruthy();
  });

  it('writes only changed or previously set values', () => {
    expect(settingsFromDraft(defaults, undefined)).toEqual({
      weekStartsOn: undefined,
      dayStartTime: undefined,
      dayEndTime: undefined,
      defaultDueTime: undefined,
      minSessionMinutes: undefined,
      maxSessionMinutes: undefined,
      breakMinutes: undefined,
      maxDailyStudyMinutes: undefined,
    });
    const changed = settingsFromDraft({ ...defaults, defaultDueTime: '23:59', maxDailyStudyMinutes: 180 }, undefined);
    expect(changed.defaultDueTime).toBe('23:59');
    expect(changed.maxDailyStudyMinutes).toBe(180);
    expect(changed.dayStartTime).toBeUndefined();
    // A value the schedule already had stays explicit even when it equals the default.
    expect(settingsFromDraft(defaults, { dayStartTime: '07:00' }).dayStartTime).toBe(DEFAULT_SETTINGS.dayStartTime);
  });

  it('offers half-hour times and keeps an off-grid current value', () => {
    const options = timeOptions(30, 24 * 60, '21:45');
    expect(options[0]).toBe('00:30');
    expect(options.at(-1)).toBe('24:00');
    expect(options).toContain('21:45');
  });
});

describe('weekly overview grid', () => {
  it('places recurring and one-time items on the days they occur', () => {
    const columns = buildWeekColumns(doc(), '2026-10-05');
    expect(columns.map((c) => c.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    expect(columns[0].events.map((e) => e.id)).toEqual(['school', 'fencing']);
    expect(columns[3].events.map((e) => e.id)).toEqual(['school', 'doctor']);
    // Friday is an exception date of School.
    expect(columns[4].events).toHaveLength(0);
    expect(columns[4].windows.map((w) => w.id)).toEqual(['after']);
    expect(columns[5].allDay.map((e) => e.id)).toEqual(['trip']);
    expect(columns[6].allDay.map((e) => e.id)).toEqual(['trip']);
    expect(columns[0].events[0]).toMatchObject({ start: 480, end: 900, busy: true, recurring: true });
    // Every other Monday: not in the week of Oct 12.
    expect(buildWeekColumns(doc(), '2026-10-12')[0].events.map((e) => e.id)).toEqual(['school']);
  });
});
