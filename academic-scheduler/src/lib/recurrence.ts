// Recurrence rules (SCHEDULE_FORMAT.md § 10 "Recurrence").
import type { DateStr, Recurrence } from '../model/types';

/** True if the rule produces an occurrence on `date` (all four conditions of § 10). */
export function occursOn(rule: Recurrence, date: DateStr): boolean {
  void rule;
  void date;
  throw new Error('occursOn: not implemented');
}

/** All occurrence dates of `rule` between `from` and `to` (inclusive), ascending. */
export function occurrencesInRange(rule: Recurrence, from: DateStr, to: DateStr): DateStr[] {
  void rule;
  void from;
  void to;
  throw new Error('occurrencesInRange: not implemented');
}

/** Human description, e.g. "Every Mon, Wed and Fri from Sep 2 to Jun 18 (2 exceptions)". */
export function describeRecurrence(rule: Recurrence): string {
  void rule;
  throw new Error('describeRecurrence: not implemented');
}

/** True if the rule never produces any occurrence (used for a warning). */
export function neverOccurs(rule: Recurrence): boolean {
  void rule;
  throw new Error('neverOccurs: not implemented');
}
