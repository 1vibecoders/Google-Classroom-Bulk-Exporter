// Everything that appears on one calendar day, computed deterministically from
// the document: event occurrences, free study time, scheduled work, due dates
// and assessments. Used by the day and week views.
import type {
  Assignment,
  AvailabilityWindow,
  DateStr,
  ScheduleBlock,
  ScheduleDocument,
  ScheduleEvent,
  SchoolClass,
  TimeStr,
} from '../model/types';

/** A span of minutes since midnight, [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface EventOccurrence {
  event: ScheduleEvent;
  date: DateStr;
  /** null for all-day events. */
  start: number | null;
  end: number | null;
  busy: boolean;
}

export interface BlockView {
  block: ScheduleBlock;
  assignment?: Assignment;
  schoolClass?: SchoolClass;
  /** Display title: task title, assignment title, or block title. */
  title: string;
  /** Class name, "Break", or "Personal". */
  subtitle: string;
  color: string;
  start: number;
  end: number;
  /** Overlaps a busy event or another block. */
  conflict: boolean;
  /** Ends after the assignment's due moment, or (for assessments) after the assessment. */
  late: boolean;
}

export interface DateMarker {
  assignment: Assignment;
  schoolClass?: SchoolClass;
  kind: 'due' | 'assessment' | 'recommended';
  /** Time of day if known, else null (date-only value). */
  time: TimeStr | null;
  color: string;
}

export interface DayModel {
  date: DateStr;
  events: EventOccurrence[];
  allDayEvents: EventOccurrence[];
  /** Availability windows that apply this day (merged), before subtracting busy time. */
  availability: Interval[];
  /** Availability minus busy events: when study can happen. */
  free: Interval[];
  freeMinutes: number;
  blocks: BlockView[];
  /** Minutes of planned + done work blocks this day. */
  plannedMinutes: number;
  markers: DateMarker[];
  windows: AvailabilityWindow[];
}

/** Model of one day. */
export function buildDay(doc: ScheduleDocument, date: DateStr): DayModel {
  void doc;
  void date;
  throw new Error('buildDay: not implemented');
}

/** Models of consecutive days starting at `start`. */
export function buildDays(doc: ScheduleDocument, start: DateStr, count: number): DayModel[] {
  void doc;
  void start;
  void count;
  throw new Error('buildDays: not implemented');
}

/** Merge overlapping intervals; result sorted and non-overlapping. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  void intervals;
  throw new Error('mergeIntervals: not implemented');
}

/** `from` minus every interval in `remove`. */
export function subtractIntervals(from: Interval[], remove: Interval[]): Interval[] {
  void from;
  void remove;
  throw new Error('subtractIntervals: not implemented');
}

export interface LaidOut<T> {
  item: T;
  /** 0-based column within its overlap group. */
  column: number;
  /** Number of columns in its overlap group. */
  columns: number;
}

/** Side-by-side layout for overlapping timed items (classic calendar columns). */
export function layoutColumns<T>(items: T[], range: (item: T) => Interval): LaidOut<T>[] {
  void items;
  void range;
  throw new Error('layoutColumns: not implemented');
}

/** Color for a class id (its color, or a stable palette color, or neutral when absent). */
export function classColor(doc: ScheduleDocument, classId: string | undefined): string {
  void doc;
  void classId;
  throw new Error('classColor: not implemented');
}
