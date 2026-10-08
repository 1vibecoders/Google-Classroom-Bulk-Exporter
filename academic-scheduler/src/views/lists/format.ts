// Display helpers shared by the list views (assignments, classes,
// commitments, settings). Pure functions: no React, no device clock.
import { SOURCE_KIND_LABELS } from '../../model/constants';
import type { DateOrDateTimeStr, DateStr, LocalDateTimeStr, Origin, Source, TimeStr } from '../../model/types';
import {
  dateOf,
  daysBetween,
  formatDateShort,
  formatDateWithWeekday,
  formatTime12,
  isValidDate,
  isValidDateOrDateTime,
  isValidEndTime,
  isValidLocalDateTime,
  splitLocalDateTime,
  timeOf,
} from '../../lib/time';

/** Link schemes that may be clickable. Everything else is shown as text. */
const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * The URL to use as an `href`, or null when it must not be clickable.
 * Only absolute http:, https: and mailto: URLs pass (no javascript:, data:,
 * file:, relative URLs, or values with control characters).
 */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol.toLowerCase())) return null;
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null;
  return parsed.href;
}

/** "today", "tomorrow", "yesterday", "in 3 days", "2 days ago", "in 3 weeks". */
export function relativeDays(date: DateStr, today: DateStr): string {
  if (!isValidDate(date) || !isValidDate(today)) return '';
  const diff = daysBetween(today, date);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  const abs = Math.abs(diff);
  let text: string;
  if (abs >= 14 && abs % 7 === 0) text = `${abs / 7} weeks`;
  else if (abs < 60) text = `${abs} days`;
  else text = `about ${Math.round(abs / 30)} months`;
  return diff > 0 ? `in ${text}` : `${text} ago`;
}

/** "Fri, Oct 16, 11:59 PM" or "Fri, Oct 16" for a date-only value. */
export function formatWhen(value: DateOrDateTimeStr, currentYear?: number): string {
  if (!isValidDateOrDateTime(value)) return String(value);
  const day = formatDateWithWeekday(dateOf(value), currentYear);
  const time = timeOf(value);
  return time ? `${day}, ${formatTime12(time)}` : day;
}

/** "Tue, Oct 13, 4:00 PM" for a LocalDateTime. */
export function formatLdt(value: LocalDateTimeStr, currentYear?: number): string {
  if (!isValidLocalDateTime(value)) return String(value);
  const { date, time } = splitLocalDateTime(value);
  return `${formatDateWithWeekday(date, currentYear)}, ${formatTime12(time)}`;
}

/** "4:00 PM", or "midnight" for 24:00. */
export function formatClockTime(time: TimeStr): string {
  if (time === '24:00') return 'midnight';
  if (!isValidEndTime(time)) return String(time);
  return formatTime12(time);
}

/** "4:00 PM – 6:00 PM". */
export function formatTimeRange(start: TimeStr | undefined, end: TimeStr | undefined): string {
  if (!start || !end) return '';
  return `${formatClockTime(start)} – ${formatClockTime(end)}`;
}

/** "4:00 PM – 4:45 PM" for a block's start/end date-times. */
export function formatBlockTime(start: LocalDateTimeStr, end: LocalDateTimeStr): string {
  if (!isValidLocalDateTime(start) || !isValidLocalDateTime(end)) return '';
  const s = splitLocalDateTime(start);
  const e = splitLocalDateTime(end);
  const endText = e.date !== s.date && e.time === '00:00' ? 'midnight' : formatTime12(e.time);
  return `${formatTime12(s.time)} – ${endText}`;
}

/** Who made an item, as shown next to it. */
export function originLabel(origin: Origin | undefined): string {
  switch (origin ?? 'generated') {
    case 'user':
      return 'Created by you';
    case 'planner':
      return 'Placed by the planner';
    default:
      return 'Imported from /academic-schedule';
  }
}

/** "Google Classroom · English 10 syllabus · retrieved Oct 11". */
export function sourceSummary(source: Source, currentYear?: number): string {
  const parts: string[] = [SOURCE_KIND_LABELS[source.kind] ?? 'Source'];
  if (source.label) parts.push(source.label);
  else if (source.path) parts.push(source.path);
  if (source.retrievedAt && isValidLocalDateTime(source.retrievedAt)) {
    parts.push(`retrieved ${formatDateShort(source.retrievedAt.slice(0, 10), currentYear)}`);
  }
  return parts.join(' · ');
}

/** "1 assignment" / "3 assignments". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Ids for undo snapshots (`snap-…`); never stored in a schedule file. */
export function snapshotId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `snap-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Human list of override field names: "priority and due date". */
const FIELD_LABELS: Record<string, string> = {
  name: 'name',
  title: 'title',
  teacher: 'teacher',
  section: 'section',
  room: 'room',
  color: 'color',
  description: 'description',
  archived: 'archived',
  topics: 'topics',
  references: 'references',
  classId: 'class',
  type: 'type',
  topic: 'topic',
  due: 'due date',
  assessmentDate: 'assessment date',
  recommendedCompletionDate: 'target date',
  recommendedStartDate: 'start date',
  estimatedMinutes: 'estimate',
  estimateRange: 'estimate range',
  estimateConfidence: 'estimate confidence',
  estimateBasis: 'estimate basis',
  priority: 'priority',
  points: 'points',
  required: 'required',
  sourceState: 'source state',
  tasks: 'subtask order',
  dependsOn: 'dependencies',
  category: 'category',
  assignmentId: 'assignment',
  date: 'date',
  endDate: 'end date',
  recurrence: 'repeat rule',
  allDay: 'all day',
  startTime: 'start time',
  endTime: 'end time',
  busy: 'busy',
  location: 'location',
  label: 'label',
  start: 'start',
  end: 'end',
  taskId: 'task',
  kind: 'kind',
};

export function describeFields(fields: string[]): string {
  const names = fields.map((f) => FIELD_LABELS[f] ?? f);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
