// Import preview and merge (SCHEDULE_FORMAT.md § 16). Pure functions: the
// preview never changes anything; applyImport returns a new document.
import type { CollectionName, LocalDateTimeStr, ScheduleDocument } from '../model/types';

export type ChangeCategory =
  | 'new'
  | 'updated'
  | 'unchanged'
  /** Current item is user-origin or locked and the file differs (not listed in meta.requestedChanges): current kept unless accepted. */
  | 'kept'
  /** A user/locked item the file changes or removes AND lists in meta.requestedChanges: pre-selected when requestedByPerson. */
  | 'yourItems'
  /** File item whose id is in the current `deleted` tombstones: not restored unless selected. */
  | 'previouslyDeleted'
  /** New file item that matches a current item under § 15.3 rule 2 or 3: not added unless selected. */
  | 'possibleDuplicate'
  /** Assignment whose sourceState changes from present to missing/withdrawn: applied by default. */
  | 'removedFromSource'
  /** Current generated, unlocked item absent from the file: kept unless the person removes it. */
  | 'missing'
  /** Current generated/planner, unlocked, future planned block absent from the file whose assignment is in the file (or a generated title-only block): removed unless kept. */
  | 'outdated'
  /** Current item absent from the file that is never removed (user, locked, done, past). */
  | 'protected'
  /** A setting whose value differs: current kept unless the file's value is selected. */
  | 'setting';

export interface FieldChange {
  field: string;
  /** Human-readable before/after, e.g. "Oct 16, 11:59 PM" → "Oct 17, 11:59 PM". */
  before: string;
  after: string;
}

export interface ImportChange {
  /** Stable key for UI choices: `${collection}:${id}` (`settings:<name>` for settings). */
  key: string;
  collection: CollectionName | 'settings';
  /** Item id, or the setting name. */
  id: string;
  category: ChangeCategory;
  /** Display label, e.g. assignment title or "Mon Oct 13, 4:00–4:45 PM · Othello Essay". */
  label: string;
  /** For updated/kept: what differs (person-owned fields that will be preserved are excluded for 'updated'). */
  fields: FieldChange[];
  /**
   * Whether the change is acted on by default. kept/yourItems/previouslyDeleted/setting: accept the
   * file's version; missing/outdated: remove the current item; removedFromSource: apply. Other
   * categories are always applied (true) and are not selectable.
   */
  defaultSelected: boolean;
  /** Whether the person can toggle this change in the preview. */
  selectable: boolean;
  /** Why it is in this category, in plain language. */
  reason?: string;
}

export interface ImportPlan {
  changes: ImportChange[];
  /** Counts per category per collection, for the summary. */
  summary: Record<ChangeCategory, Partial<Record<CollectionName | 'settings', number>>>;
  /** Blocking problems found while comparing (e.g. ID used by a different collection). */
  errors: string[];
  /** Non-blocking notes (e.g. validation warnings, settings that will change). */
  notes: string[];
  /** True when applying would change nothing (re-import of the same file). */
  noChanges: boolean;
  settingsChanged: boolean;
}

/**
 * Compare the current document with a validated incoming document.
 * "Future" is relative to the incoming file's meta.generatedAt when present,
 * else `now` (SCHEDULE_FORMAT.md § 16): past = end ≤ t, future = start ≥ t,
 * in progress counts as past.
 */
export function planImport(current: ScheduleDocument, incoming: ScheduleDocument, now: LocalDateTimeStr): ImportPlan {
  void current;
  void incoming;
  void now;
  throw new Error('planImport: not implemented');
}

/**
 * Apply an import. `selected` holds the keys of selectable changes the person
 * wants acted on (see ImportChange.defaultSelected); non-selectable changes
 * are always applied. Person-owned fields (status never regresses, notes,
 * overrides, issue status, cancelled) are preserved per § 16.3; `deleted`
 * tombstones are unioned; settings change only where selected.
 */
export function applyImport(
  current: ScheduleDocument,
  incoming: ScheduleDocument,
  plan: ImportPlan,
  selected: Set<string>,
  now: LocalDateTimeStr,
): ScheduleDocument {
  void current;
  void incoming;
  void plan;
  void selected;
  void now;
  throw new Error('applyImport: not implemented');
}
