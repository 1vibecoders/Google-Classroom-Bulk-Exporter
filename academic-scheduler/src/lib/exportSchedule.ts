// Export of the current schedule as a schedule file (SCHEDULE_FORMAT.md § 17).
import type { LocalDateTimeStr, ScheduleDocument } from '../model/types';

/**
 * A complete, valid 1.0 document: meta.generator/generatedAt set, every item
 * with id + origin, `locked` only when true, empty optional arrays omitted,
 * date-times as YYYY-MM-DDTHH:MM:SS, collections sorted deterministically,
 * x- properties preserved.
 */
export function exportDocument(doc: ScheduleDocument, now: LocalDateTimeStr): ScheduleDocument {
  void doc;
  void now;
  throw new Error('exportDocument: not implemented');
}

/** Pretty-printed JSON (2 spaces, trailing newline). */
export function exportJson(doc: ScheduleDocument, now: LocalDateTimeStr): string {
  return `${JSON.stringify(exportDocument(doc, now), null, 2)}\n`;
}

/** Suggested file name: `schedule-YYYY-MM-DD.json`. */
export function exportFileName(now: LocalDateTimeStr): string {
  return `schedule-${now.slice(0, 10)}.json`;
}
