// Memoized day models for the day and week views.
//
// Models are cached per document (the store never mutates a document in
// place, so a new document means new data). When the document changes, a
// day's fresh model is compared with the previous model of that date; if
// nothing shown on that day changed (the same item objects, the same computed
// numbers) the previous object is reused, so memoized day columns of the week
// view do not re-render when another day is edited.
import { useMemo } from 'react';
import { buildDays, type DayModel, type Interval } from '../../lib/calendar';
import type { DateStr, ScheduleDocument } from '../../model/types';
import { addDays, isValidDate } from '../../lib/time';

const byDocument = new WeakMap<ScheduleDocument, Map<DateStr, DayModel>>();
/** The most recent model of each date (any document), for structural reuse. */
const recent = new Map<DateStr, DayModel>();
const MAX_RECENT = 120;

function sameIntervals(a: Interval[], b: Interval[]): boolean {
  return a.length === b.length && a.every((x, i) => x.start === b[i].start && x.end === b[i].end);
}

function sameList<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean {
  return a.length === b.length && a.every((x, i) => same(x, b[i]));
}

/** True when two models of the same date would render identically. */
export function sameDayModel(a: DayModel, b: DayModel): boolean {
  if (a === b) return true;
  return (
    a.date === b.date &&
    a.availabilityDefined === b.availabilityDefined &&
    a.freeMinutes === b.freeMinutes &&
    a.plannedMinutes === b.plannedMinutes &&
    a.doneMinutes === b.doneMinutes &&
    a.overFreeTime === b.overFreeTime &&
    a.overDailyMax === b.overDailyMax &&
    a.timelineRange.start === b.timelineRange.start &&
    a.timelineRange.end === b.timelineRange.end &&
    sameIntervals(a.availability, b.availability) &&
    sameIntervals(a.free, b.free) &&
    sameList(a.windows, b.windows, (x, y) => x === y) &&
    sameList(
      [...a.events, ...a.allDayEvents],
      [...b.events, ...b.allDayEvents],
      (x, y) =>
        x.event === y.event &&
        x.start === y.start &&
        x.end === y.end &&
        x.busy === y.busy &&
        x.schoolClass === y.schoolClass &&
        x.assignment === y.assignment &&
        x.span?.first === y.span?.first &&
        x.span?.last === y.span?.last,
    ) &&
    sameList(
      a.blocks,
      b.blocks,
      (x, y) =>
        x.block === y.block &&
        x.assignment === y.assignment &&
        x.task === y.task &&
        x.schoolClass === y.schoolClass &&
        x.color === y.color &&
        x.label === y.label &&
        x.title === y.title &&
        x.late === y.late &&
        x.lateReason === y.lateReason &&
        sameList(x.conflictsWith, y.conflictsWith, (p, q) => p.kind === q.kind && p.id === q.id && p.title === q.title),
    ) &&
    sameList(
      a.markers,
      b.markers,
      (x, y) =>
        x.assignment === y.assignment &&
        x.task === y.task &&
        x.schoolClass === y.schoolClass &&
        x.kind === y.kind &&
        x.time === y.time &&
        x.color === y.color &&
        x.label === y.label &&
        x.done === y.done &&
        (x.sitting?.event ?? null) === (y.sitting?.event ?? null),
    ) &&
    sameList(
      a.issues,
      b.issues,
      (x, y) =>
        x.issue === y.issue &&
        x.index === y.index &&
        x.itemId === y.itemId &&
        (x.scope?.collection ?? null) === (y.scope?.collection ?? null) &&
        (x.scope?.id ?? null) === (y.scope?.id ?? null),
    )
  );
}

function remember(model: DayModel): DayModel {
  const previous = recent.get(model.date);
  const result = previous && sameDayModel(previous, model) ? previous : model;
  recent.delete(model.date);
  recent.set(model.date, result);
  if (recent.size > MAX_RECENT) {
    const oldest = recent.keys().next().value;
    if (oldest !== undefined) recent.delete(oldest);
  }
  return result;
}

/** Models of `count` consecutive days from `start`, memoized as described above. */
export function getDayModels(doc: ScheduleDocument, start: DateStr, count: number): DayModel[] {
  if (!isValidDate(start) || count <= 0) return [];
  let cache = byDocument.get(doc);
  if (!cache) {
    cache = new Map();
    byDocument.set(doc, cache);
  }
  const dates = Array.from({ length: count }, (_, i) => addDays(start, i));
  if (dates.some((d) => !cache!.has(d))) {
    const fresh = buildDays(doc, start, count);
    for (const model of fresh) if (!cache.has(model.date)) cache.set(model.date, remember(model));
  }
  return dates.map((d) => cache!.get(d)!);
}

/** React hook: memoized day models (stable array while the document and dates are unchanged). */
export function useDayModels(doc: ScheduleDocument, start: DateStr, count: number): DayModel[] {
  return useMemo(() => getDayModels(doc, start, count), [doc, start, count]);
}
