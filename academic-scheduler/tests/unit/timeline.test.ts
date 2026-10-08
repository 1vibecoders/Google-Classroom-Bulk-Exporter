import { describe, expect, it } from 'vitest';
import { buildDay } from '../../src/lib/calendar';
import type { ScheduleBlock, ScheduleDocument } from '../../src/model/types';
import {
  agendaEntries,
  agendaText,
  availableGaps,
  blockSpan,
  changeBlock,
  clickSpan,
  createSpan,
  describeBlock,
  findItem,
  formatClock,
  formatSpan,
  formatWeekRange,
  isEmptyDocument,
  moveSpan,
  nowMinutesOn,
  relativeDayLabel,
  resizeSpan,
  setupSteps,
  snapMinutes,
  spanToLdt,
  suggestNewSpan,
  unmarkedPastBlocks,
  unplannedFreeMinutes,
} from '../../src/views/timeline/logic';
import { getDayModels, sameDayModel } from '../../src/views/timeline/modelCache';

const DAY = '2026-10-13'; // a Tuesday

function doc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [
      { id: 'cls-eng', name: 'English', color: '#2563EB', origin: 'user' },
      { id: 'cls-math', name: 'Math', color: '#16A34A', origin: 'user' },
      { id: 'cls-bio', name: 'Biology', color: '#DC2626', origin: 'user' },
    ],
    assignments: [
      { id: 'a-eng', classId: 'cls-eng', title: 'Read Chapter 6', due: '2026-10-16T23:59:00', estimatedMinutes: 45 },
      { id: 'a-math', classId: 'cls-math', title: 'Problems 12–24', due: '2026-10-13T17:30:00' },
      { id: 'a-bio', classId: 'cls-bio', title: 'Finish lab questions', tasks: [{ id: 'a-bio-t1', title: 'Questions 1–5' }] },
    ],
    events: [
      {
        id: 'evt-school',
        title: 'School',
        category: 'school',
        startTime: '08:00',
        endTime: '15:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' },
        origin: 'user',
      },
    ],
    availability: [
      {
        id: 'avl-after-school',
        label: 'After school',
        startTime: '15:30',
        endTime: '21:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' },
        origin: 'user',
      },
    ],
    scheduleBlocks: [
      { id: 'b-eng', assignmentId: 'a-eng', start: `${DAY}T16:00:00`, end: `${DAY}T16:45:00`, origin: 'generated' },
      { id: 'b-break', kind: 'break', title: 'Break', start: `${DAY}T16:45:00`, end: `${DAY}T17:00:00`, origin: 'generated' },
      { id: 'b-math', assignmentId: 'a-math', start: `${DAY}T17:00:00`, end: `${DAY}T17:45:00`, origin: 'user' },
      { id: 'b-bio', assignmentId: 'a-bio', start: `${DAY}T17:45:00`, end: `${DAY}T18:30:00`, origin: 'generated' },
    ],
    ...partial,
  };
}

describe('drag and resize arithmetic', () => {
  it('snaps to 5 minutes', () => {
    expect(snapMinutes(962)).toBe(960);
    expect(snapMinutes(963)).toBe(965);
  });

  it('moves a span keeping its length, inside the day', () => {
    expect(moveSpan({ start: 960, end: 1005 }, 1021)).toEqual({ start: 1020, end: 1065 });
    expect(moveSpan({ start: 960, end: 1005 }, -50)).toEqual({ start: 0, end: 45 });
    expect(moveSpan({ start: 960, end: 1005 }, 1430)).toEqual({ start: 1395, end: 1440 });
  });

  it('resizes from the bottom edge to at least 5 minutes and at most midnight', () => {
    expect(resizeSpan({ start: 960, end: 1005 }, 1032)).toEqual({ start: 960, end: 1030 });
    expect(resizeSpan({ start: 960, end: 1005 }, 900)).toEqual({ start: 960, end: 965 });
    expect(resizeSpan({ start: 960, end: 1005 }, 2000)).toEqual({ start: 960, end: 1440 });
  });

  it('creates a span by dragging in either direction', () => {
    expect(createSpan(962, 1048)).toEqual({ start: 960, end: 1050 });
    expect(createSpan(1048, 962)).toEqual({ start: 960, end: 1050 });
    expect(createSpan(1000, 1001)).toEqual({ start: 1000, end: 1005 });
  });

  it('a click on empty time starts at the quarter hour', () => {
    expect(clickSpan(968)).toEqual({ start: 960, end: 1020 });
    expect(clickSpan(1435)).toEqual({ start: 1425, end: 1440 });
  });

  it('writes an end at midnight as 00:00 of the next date', () => {
    expect(spanToLdt(DAY, { start: 1380, end: 1440 })).toEqual({ start: '2026-10-13T23:00:00', end: '2026-10-14T00:00:00' });
    expect(spanToLdt('2026-12-31', { start: 0, end: 1440 }).end).toBe('2027-01-01T00:00:00');
  });

  it('reads a block that ends at midnight', () => {
    const block: ScheduleBlock = { id: 'b', title: 'Late', start: '2026-10-13T23:00', end: '2026-10-14T00:00:00' };
    expect(blockSpan(block)).toEqual({ date: DAY, span: { start: 1380, end: 1440 } });
  });
});

describe('keyboard and dialog moves', () => {
  const block: ScheduleBlock = { id: 'b', title: 'Study', start: `${DAY}T16:00:00`, end: `${DAY}T16:45:00` };

  it('moves by 15 minutes, by days, to a date and to a start time', () => {
    expect(changeBlock(block, { minutes: 15 })).toMatchObject({ start: `${DAY}T16:15:00`, end: `${DAY}T17:00:00` });
    expect(changeBlock(block, { minutes: -15 })).toMatchObject({ start: `${DAY}T15:45:00`, end: `${DAY}T16:30:00` });
    expect(changeBlock(block, { days: 1 })).toMatchObject({ date: '2026-10-14', start: '2026-10-14T16:00:00', end: '2026-10-14T16:45:00' });
    expect(changeBlock(block, { date: '2026-11-02' })).toMatchObject({ start: '2026-11-02T16:00:00' });
    expect(changeBlock(block, { startAt: 9 * 60 + 7 })).toMatchObject({ start: `${DAY}T09:07:00`, end: `${DAY}T09:52:00` });
  });

  it('resizes by 15 minutes', () => {
    expect(changeBlock(block, { resize: 15 })).toMatchObject({ start: `${DAY}T16:00:00`, end: `${DAY}T17:00:00` });
    expect(changeBlock(block, { resize: -60 })).toMatchObject({ end: `${DAY}T16:05:00` });
  });

  it('returns null when nothing changes or the input is unusable', () => {
    const lastSlot: ScheduleBlock = { id: 'c', title: 'x', start: `${DAY}T23:30:00`, end: '2026-10-14T00:00:00' };
    expect(changeBlock(lastSlot, { minutes: 15 })).toBeNull();
    expect(changeBlock(lastSlot, { resize: 15 })).toBeNull();
    expect(changeBlock(block, { date: 'not-a-date' })).toBeNull();
    expect(changeBlock({ ...block, start: 'garbage' }, { minutes: 15 })).toBeNull();
  });
});

describe('labels', () => {
  it('formats clock times and spans', () => {
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(16 * 60 + 30)).toBe('4:30 PM');
    expect(formatClock(1440)).toBe('12:00 AM');
    expect(formatSpan(990, 1040)).toBe('4:30 – 5:20 PM');
    expect(formatSpan(690, 735)).toBe('11:30 AM – 12:15 PM');
    expect(formatSpan(1380, 1440)).toBe('11:00 PM – 12:00 AM');
  });

  it('describes days relative to today', () => {
    expect(relativeDayLabel('2026-10-07', '2026-10-07')).toBe('Today');
    expect(relativeDayLabel('2026-10-08', '2026-10-07')).toBe('Tomorrow');
    expect(relativeDayLabel('2026-10-06', '2026-10-07')).toBe('Yesterday');
    expect(relativeDayLabel('2026-10-13', '2026-10-07')).toBe('In 6 days');
    expect(relativeDayLabel('2026-10-01', '2026-10-07')).toBe('6 days ago');
  });

  it('formats week ranges', () => {
    expect(formatWeekRange('2026-10-12', '2026-10-18', 2026)).toBe('Oct 12 – 18');
    expect(formatWeekRange('2026-09-28', '2026-10-04', 2026)).toBe('Sep 28 – Oct 4');
    expect(formatWeekRange('2026-12-28', '2027-01-03', 2026)).toBe('Dec 28 – Jan 3, 2027');
  });

  it('knows where now is', () => {
    expect(nowMinutesOn(DAY, `${DAY}T16:12:00`)).toBe(972);
    expect(nowMinutesOn(DAY, '2026-10-12T16:12:00')).toBeNull();
  });
});

describe('agenda', () => {
  it('lists the day like the requirements example', () => {
    const model = buildDay(doc(), DAY);
    expect(agendaText(model)).toEqual([
      '8:00 AM School',
      '3:30 PM Available until 4:00 PM',
      '4:00 PM English / Read Chapter 6',
      '4:45 PM Break',
      '5:00 PM Math / Problems 12–24',
      '5:45 PM Biology / Finish lab questions',
      '6:30 PM Available until 9:30 PM',
    ]);
  });

  it('shows no Available time when availability is not provided', () => {
    const model = buildDay(doc({ availability: [] }), DAY);
    expect(availableGaps(model)).toEqual([]);
    expect(agendaEntries(model).some((e) => e.kind === 'available')).toBe(false);
  });

  it('skipped blocks do not use free time', () => {
    const d = doc();
    d.scheduleBlocks = d.scheduleBlocks.map((b) => (b.id === 'b-bio' ? { ...b, status: 'skipped' as const } : b));
    const gaps = availableGaps(buildDay(d, DAY));
    expect(gaps[gaps.length - 1]).toEqual({ start: 17 * 60 + 45, end: 21 * 60 + 30 });
  });
});

describe('block state in words', () => {
  it('describes conflicts and lateness with text', () => {
    const d = doc();
    d.scheduleBlocks.push({ id: 'b-overlap', assignmentId: 'a-math', start: `${DAY}T14:30:00`, end: `${DAY}T15:30:00`, origin: 'user' });
    const model = buildDay(d, DAY);
    const overlap = model.blocks.find((b) => b.block.id === 'b-overlap')!;
    expect(describeBlock(overlap)).toContain('Overlaps School');
    const late = model.blocks.find((b) => b.block.id === 'b-math')!;
    expect(late.late).toBe(true);
    expect(describeBlock(late)).toContain('Late: Ends after the due time');
  });

  it('finds past sessions that are still planned', () => {
    const model = buildDay(doc(), DAY);
    expect(unmarkedPastBlocks(model, `${DAY}T17:00:00`).map((v) => v.block.id)).toEqual(['b-eng']);
    expect(unmarkedPastBlocks(model, '2026-10-12T23:00:00')).toEqual([]);
  });
});

describe('suggested time for a new block', () => {
  it('uses the first unplanned free gap after now', () => {
    const model = buildDay(doc(), DAY);
    expect(suggestNewSpan(model, '2026-10-07T09:00:00')).toEqual({ start: 15 * 60 + 30, end: 16 * 60 });
    expect(suggestNewSpan(model, `${DAY}T19:05:00`)).toEqual({ start: 19 * 60 + 15, end: 20 * 60 + 15 });
  });

  it('falls back to 4:00 PM without study time', () => {
    const model = buildDay(doc({ availability: [] }), DAY);
    expect(suggestNewSpan(model, '2026-10-07T09:00:00')).toEqual({ start: 960, end: 1020 });
  });
});

describe('memoized day models', () => {
  it('reuses a day model when only another day changed', () => {
    const d1 = doc();
    const [a1, b1] = getDayModels(d1, DAY, 2);
    expect(getDayModels(d1, DAY, 2)[0]).toBe(a1);
    // Move a block to the next day: Tuesday changes, Wednesday changes; Thursday not.
    const d2: ScheduleDocument = { ...d1, scheduleBlocks: d1.scheduleBlocks.map((b) => (b.id === 'b-bio' ? { ...b, start: '2026-10-14T17:45:00', end: '2026-10-14T18:30:00' } : b)) };
    const [a2, b2, c2] = getDayModels(d2, DAY, 3);
    expect(a2).not.toBe(a1);
    expect(b2).not.toBe(b1);
    const d3: ScheduleDocument = { ...d2, scheduleBlocks: [...d2.scheduleBlocks] };
    const [a3, b3, c3] = getDayModels(d3, DAY, 3);
    expect(a3).toBe(a2);
    expect(b3).toBe(b2);
    expect(c3).toBe(c2);
    expect(sameDayModel(a2, buildDay(d2, DAY))).toBe(true);
  });
});

describe('items', () => {
  it('finds items of every kind, tasks included', () => {
    const d = doc();
    expect(findItem(d, 'a-bio-t1')).toEqual({ kind: 'task', id: 'a-bio-t1', assignmentId: 'a-bio', title: 'Finish lab questions: Questions 1–5' });
    expect(findItem(d, 'evt-school')?.kind).toBe('event');
    expect(findItem(d, 'b-break')?.title).toBe('Break');
    expect(findItem(d, 'nope')).toBeNull();
    expect(isEmptyDocument(d)).toBe(false);
    expect(isEmptyDocument({ schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [] })).toBe(true);
  });
});

describe('unplanned free time', () => {
  it('counts the whole day ahead, only from now on today, and nothing for past days', () => {
    const model = buildDay(doc(), DAY);
    // Free 3:30–9:30 PM minus blocks 4:00–6:30 PM: 30 min + 3 h.
    expect(unplannedFreeMinutes(model, '2026-10-07T09:00:00')).toBe(210);
    expect(unplannedFreeMinutes(model, `${DAY}T19:00:00`)).toBe(150);
    expect(unplannedFreeMinutes(model, `${DAY}T22:00:00`)).toBe(0);
    expect(unplannedFreeMinutes(model, '2026-10-14T08:00:00')).toBeNull();
    expect(unplannedFreeMinutes(buildDay(doc({ availability: [] }), DAY), '2026-10-07T09:00:00')).toBeNull();
  });
});

describe('setup steps', () => {
  it('lists the four steps in order with what is done', () => {
    expect(setupSteps(doc({ events: [], assignments: [] }))).toEqual([
      { kind: 'class', done: true, count: 3 },
      { kind: 'event', done: false, count: 0 },
      { kind: 'availability', done: true, count: 1 },
      { kind: 'assignment', done: false, count: 0 },
    ]);
    expect(setupSteps(doc()).every((s) => s.done)).toBe(true);
  });
});
