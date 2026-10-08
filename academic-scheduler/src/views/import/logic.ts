// Pure helpers for the Import wizard (SCHEDULE_FORMAT.md § 16): checking the
// chosen file before reading it, grouping validation errors, turning an
// ImportPlan into preview sections, the person's choices, and counting what
// an import changed. No React here, so everything is unit-tested directly.
//
// The file's contents are data only: labels taken from it are shown as text,
// never interpreted.
import { COLLECTION_LABELS, MAX_IMPORT_BYTES } from '../../model/constants';
import type { CollectionName, DateStr, ScheduleDocument } from '../../model/types';
import type { ValidationIssue } from '../../lib/validate';
import { CATEGORY_LABELS, formatCounts, type ChangeCategory, type ImportChange, type ImportPlan } from '../../lib/importDiff';

export const COLLECTIONS: CollectionName[] = ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'];

// ---------------------------------------------------------------------------
// Step 1: the chosen file
// ---------------------------------------------------------------------------

/** Extensions of files people are likely to pick by mistake (they are never schedule files). */
const NOT_SCHEDULE_EXTENSIONS: Record<string, string> = {
  zip: 'This looks like a Google Classroom export (a ZIP file). Give it to the /academic-schedule skill in Claude: it reads your materials and writes the schedule .json file that you import here.',
  pdf: 'PDF files cannot be imported. Give documents like this to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  doc: 'Word documents cannot be imported. Give documents like this to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  docx: 'Word documents cannot be imported. Give documents like this to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  pptx: 'Presentations cannot be imported. Give files like this to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  xlsx: 'Spreadsheets cannot be imported. Give files like this to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  png: 'Images cannot be imported. Give screenshots to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  jpg: 'Images cannot be imported. Give screenshots to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  jpeg: 'Images cannot be imported. Give screenshots to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  gif: 'Images cannot be imported.',
  webp: 'Images cannot be imported.',
  heic: 'Images cannot be imported. Give screenshots to the /academic-schedule skill in Claude: it writes the schedule .json file that you import here.',
  html: 'Web pages cannot be imported. If this is the index.html of a Classroom export, give the whole export to the /academic-schedule skill in Claude instead.',
  htm: 'Web pages cannot be imported.',
};

export interface FileProblem {
  title: string;
  message: string;
}

/** Megabytes with one decimal ("10 MB", "12.4 MB"). */
export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

/**
 * Problems that can be seen before reading the file: too large (§ 16.1: at
 * most 10 MB) or a kind of file that is never a schedule. Everything else is
 * decided by parsing and validating the contents.
 */
export function checkChosenFile(file: { name: string; size: number }): FileProblem | null {
  if (file.size > MAX_IMPORT_BYTES) {
    return {
      title: 'This file is too large',
      message: `“${file.name}” is ${formatMegabytes(file.size)}; the website accepts schedule files up to ${formatMegabytes(MAX_IMPORT_BYTES)}.`,
    };
  }
  const ext = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (ext && NOT_SCHEDULE_EXTENSIONS[ext]) {
    return { title: `“${file.name}” is not a schedule file`, message: NOT_SCHEDULE_EXTENSIONS[ext] };
  }
  if (file.size === 0) {
    return { title: 'This file is empty', message: `“${file.name}” contains nothing. A schedule file is one JSON object that starts with { "schemaVersion": "1.0", … }.` };
  }
  return null;
}

/** Read a File as text (Blob.text() where available, else FileReader). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}

// ---------------------------------------------------------------------------
// Step 1: validation errors, grouped by the item they are in
// ---------------------------------------------------------------------------

export interface ErrorGroup {
  /** Path prefix, e.g. `assignments[3]`, `meta`, `settings`, or `` for the whole file. */
  key: string;
  /** e.g. "Assignment “Othello Essay”", "Settings", "Whole file". */
  label: string;
  issues: ValidationIssue[];
}

export interface GroupedErrors {
  groups: ErrorGroup[];
  /** Number of issues in `groups`. */
  shown: number;
  total: number;
}

const GROUP_RE = /^(classes|assignments|events|availability|scheduleBlocks|issues|deleted)\[(\d+)\]/;

const GROUP_NAMES: Record<string, string> = {
  classes: 'Class',
  assignments: 'Assignment',
  events: 'Event',
  availability: 'Study time',
  scheduleBlocks: 'Scheduled work block',
  issues: 'Schedule-wide issue',
  deleted: 'Deleted-item record',
};

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shorten(value: string, max = 80): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A readable name for an item of the (invalid) file, from its title/name/label/start. */
export function rawItemName(raw: unknown, collection: string, index: number): string | undefined {
  if (!isObj(raw)) return undefined;
  const list = raw[collection];
  if (!Array.isArray(list)) return undefined;
  const item = list[index];
  if (!isObj(item)) return undefined;
  for (const key of ['title', 'name', 'label', 'message', 'start', 'id']) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) return shorten(value);
  }
  return undefined;
}

function groupOf(path: string, raw: unknown): { key: string; label: string } {
  const m = GROUP_RE.exec(path);
  if (m) {
    const [key, collection, index] = m;
    const name = rawItemName(raw, collection, Number(index));
    const base = GROUP_NAMES[collection];
    return { key, label: name ? `${base} “${name}”` : `${base} ${Number(index) + 1}` };
  }
  if (path === 'meta' || path.startsWith('meta.') || path.startsWith('meta[')) return { key: 'meta', label: 'File information (meta)' };
  if (path === 'settings' || path.startsWith('settings.')) return { key: 'settings', label: 'Settings' };
  const root = /^([A-Za-z0-9_$-]+)/.exec(path)?.[1];
  if (root && root !== 'schemaVersion') return { key: root, label: `“${shorten(root, 40)}”` };
  return { key: '', label: 'Whole file' };
}

/**
 * Group validation errors by the item they belong to (in order of first
 * appearance) and keep at most `limit` of them, so that a badly broken file
 * shows a readable list plus a count of the rest.
 */
export function groupErrors(errors: ValidationIssue[], raw?: unknown, limit = 50): GroupedErrors {
  const groups: ErrorGroup[] = [];
  const byKey = new Map<string, ErrorGroup>();
  let shown = 0;
  for (const issue of errors) {
    if (shown >= limit) break;
    const { key, label } = groupOf(issue.path, raw);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, issues: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.issues.push(issue);
    shown++;
  }
  return { groups, shown, total: errors.length };
}

/** Parse text only to name items in error messages; undefined when it is not JSON. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown;
  } catch {
    return undefined;
  }
}

/** Every problem as plain text, one per line (for "Copy the list"). */
export function errorsAsText(errors: ValidationIssue[]): string {
  return errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('\n');
}

// ---------------------------------------------------------------------------
// Step 2: preview sections and choices
// ---------------------------------------------------------------------------

/** Order of the preview's sections: changes first, then choices, then what stays. */
export const SECTION_ORDER: ChangeCategory[] = [
  'new',
  'updated',
  'removedFromSource',
  'yourItems',
  'previouslyDeleted',
  'possibleDuplicate',
  'outdated',
  'missing',
  'kept',
  'setting',
  'protected',
  'unchanged',
];

/** One sentence under each section heading. */
export const SECTION_HELP: Record<ChangeCategory, string> = {
  new: 'Items in the file that are not in your schedule yet. They are added.',
  updated: 'Items that came from an earlier import and changed in the file. Your notes, completed work and fields you edited are kept.',
  unchanged: 'Items that are the same in the file and in your schedule. Nothing happens.',
  kept: 'Your own, pinned or finished items that the file has in a different version. Yours is kept unless you tick a row.',
  yourItems: 'The file asks to change or remove some of your own items. Ticked rows are applied.',
  previouslyDeleted: 'Items you deleted before. They are not added again unless you tick them.',
  possibleDuplicate: 'Items that look like something already in your schedule. They are not added unless you tick them.',
  removedFromSource: 'Assignments that are no longer in their source (for example removed from Google Classroom). Ticked rows are marked that way.',
  missing: 'Imported items that are not in this file. They are kept unless you tick them to remove them.',
  outdated: 'Planned sessions the file has re-planned. Ticked sessions are removed; untick to keep them.',
  protected: 'Your own items, pinned items and finished or past sessions that the file does not contain. An import never removes them.',
  setting: 'Settings that differ in the file. Yours are kept unless you tick a row.',
};

export interface PreviewSection {
  category: ChangeCategory;
  label: string;
  help: string;
  rows: ImportChange[];
  /** Keys of the rows the person can tick or untick (selectable and not blocked). */
  toggleKeys: string[];
}

/** Whether a row can be ticked or unticked in the preview. */
export function isToggleable(row: ImportChange): boolean {
  return row.selectable && !row.blockedReason;
}

/**
 * The preview's sections, one per category that has rows. Rows that follow
 * another row's choice and cannot be chosen on their own are shown inside
 * that row (its `includes`), not as rows of their own (§ 16.1).
 */
export function buildSections(plan: ImportPlan): PreviewSection[] {
  const byCategory = new Map<ChangeCategory, ImportChange[]>();
  for (const row of plan.changes) {
    if (row.follows && !row.selectable) continue;
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  const sections: PreviewSection[] = [];
  for (const category of SECTION_ORDER) {
    const rows = byCategory.get(category);
    if (!rows?.length) continue;
    sections.push({
      category,
      label: CATEGORY_LABELS[category],
      help: SECTION_HELP[category],
      rows,
      toggleKeys: rows.filter(isToggleable).map((r) => r.key),
    });
  }
  return sections;
}

/** The person's ticks and unticks, by row key; rows not listed use their default. */
export type Choices = Readonly<Record<string, boolean>>;

/** Whether a row is ticked, given the person's choices. */
export function isChosen(row: ImportChange, choices: Choices): boolean {
  if (!isToggleable(row)) return false;
  return Object.prototype.hasOwnProperty.call(choices, row.key) ? choices[row.key] : row.defaultSelected;
}

/**
 * The selection for checkImport/applyImport: every toggleable row that is
 * ticked. Choices for rows the plan no longer has (the schedule changed
 * meanwhile) are ignored.
 */
export function selectionFor(plan: ImportPlan, choices: Choices): Set<string> {
  const selected = new Set<string>();
  for (const row of plan.changes) if (isChosen(row, choices)) selected.add(row.key);
  return selected;
}

/** Choices with every given key set to `value`. */
export function setChoices(choices: Choices, keys: readonly string[], value: boolean): Choices {
  const next: Record<string, boolean> = { ...choices };
  for (const key of keys) next[key] = value;
  return next;
}

/** What ticking a row does, as a short verb phrase shown next to its checkbox. */
export function actionLabel(row: ImportChange): string {
  if (row.aspect === 'setting') return 'Use the file’s value';
  if (row.aspect === 'sourceState') return 'Mark as removed from source';
  if (row.aspect === 'status') return 'Use the file’s status';
  if (row.aspect === 'deletedInFile') return 'Delete';
  switch (row.category) {
    case 'previouslyDeleted':
      return 'Restore';
    case 'possibleDuplicate':
      return 'Add anyway';
    case 'missing':
    case 'outdated':
      return 'Remove';
    case 'updated':
      return 'Apply this update';
    case 'yourItems':
    case 'kept':
      return row.removes ? 'Delete' : 'Use the file’s version';
    default:
      return row.removes ? 'Remove' : 'Apply';
  }
}

/** What kind of thing a row is about: "Assignment", "Task", "Scheduled work block", "Setting". */
export function kindLabel(row: ImportChange): string {
  if (row.collection === 'settings') return 'Setting';
  if (row.parentId) return 'Task';
  const one = COLLECTION_LABELS[row.collection].one;
  return one.charAt(0).toUpperCase() + one.slice(1);
}

/** Color tone of a category's line in the summary block: added, changed, removed, a choice, or nothing happens. */
export function categoryTone(category: ChangeCategory): 'add' | 'change' | 'remove' | 'choice' | 'same' {
  switch (category) {
    case 'new':
      return 'add';
    case 'updated':
    case 'removedFromSource':
      return 'change';
    case 'outdated':
      return 'remove';
    case 'unchanged':
    case 'protected':
      return 'same';
    default:
      return 'choice';
  }
}

/** The settings rows the current schedule never set (it uses the defaults), § 16.6. */
export function neverSetSettingKeys(plan: ImportPlan): string[] {
  return plan.changes.filter((r) => r.collection === 'settings' && r.neverSet && isToggleable(r)).map((r) => r.key);
}

/** Problems of the merged schedule by row key, plus those that belong to no row. */
export function problemsByRow(problems: ReadonlyArray<{ key?: string; path: string; message: string }>): {
  byKey: Map<string, string[]>;
  general: Array<{ path: string; message: string }>;
} {
  const byKey = new Map<string, string[]>();
  const general: Array<{ path: string; message: string }> = [];
  for (const p of problems) {
    if (p.key) {
      const list = byKey.get(p.key) ?? [];
      list.push(p.message);
      byKey.set(p.key, list);
    } else general.push({ path: p.path, message: p.message });
  }
  return { byKey, general };
}

// ---------------------------------------------------------------------------
// What an import changes (live result line, success screen)
// ---------------------------------------------------------------------------

type Counts = Partial<Record<CollectionName, number>>;

export interface DocDiff {
  added: Counts;
  updated: Counts;
  removed: Counts;
  /** Number of settings whose value changed. */
  settings: number;
  /** Anything at all differs (items, settings, issues, meta, tombstones). */
  changed: boolean;
}

/** JSON with object keys sorted, so that key order never counts as a change. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isObj(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function bump(counts: Counts, collection: CollectionName): void {
  counts[collection] = (counts[collection] ?? 0) + 1;
}

/** Items added, updated and removed (by id), and settings changed, between two documents. */
export function diffDocuments(before: ScheduleDocument, after: ScheduleDocument): DocDiff {
  const diff: DocDiff = { added: {}, updated: {}, removed: {}, settings: 0, changed: false };
  for (const collection of COLLECTIONS) {
    const old = new Map<string, unknown>();
    for (const item of before[collection] as Array<{ id: string }>) old.set(item.id, item);
    const seen = new Set<string>();
    for (const item of after[collection] as Array<{ id: string }>) {
      seen.add(item.id);
      const previous = old.get(item.id);
      if (previous === undefined) bump(diff.added, collection);
      else if (previous !== item && stableStringify(previous) !== stableStringify(item)) bump(diff.updated, collection);
    }
    for (const id of old.keys()) if (!seen.has(id)) bump(diff.removed, collection);
  }
  const s1 = (before.settings ?? {}) as Record<string, unknown>;
  const s2 = (after.settings ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(s1), ...Object.keys(s2)])) {
    if (stableStringify(s1[key]) !== stableStringify(s2[key])) diff.settings++;
  }
  diff.changed = before !== after && stableStringify(before) !== stableStringify(after);
  return diff;
}

function total(counts: Counts): number {
  return Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
}

export interface DiffLine {
  tone: 'add' | 'change' | 'remove';
  label: string;
  text: string;
}

/** "Added: 3 assignments, 8 scheduled work blocks" etc.; empty when nothing changed. */
export function diffLines(diff: DocDiff): DiffLine[] {
  const lines: DiffLine[] = [];
  if (total(diff.added)) lines.push({ tone: 'add', label: 'Added', text: formatCounts(diff.added).join(', ') });
  if (total(diff.updated)) lines.push({ tone: 'change', label: 'Updated', text: formatCounts(diff.updated).join(', ') });
  if (total(diff.removed)) lines.push({ tone: 'remove', label: 'Removed', text: formatCounts(diff.removed).join(', ') });
  if (diff.settings) lines.push({ tone: 'change', label: 'Settings', text: `${diff.settings} changed` });
  return lines;
}

/** One short line: "31 added · 2 updated · 1 removed · 1 setting". */
export function diffShort(diff: DocDiff): string {
  const parts: string[] = [];
  const a = total(diff.added);
  const u = total(diff.updated);
  const r = total(diff.removed);
  if (a) parts.push(`${a} added`);
  if (u) parts.push(`${u} updated`);
  if (r) parts.push(`${r} removed`);
  if (diff.settings) parts.push(`${diff.settings} ${diff.settings === 1 ? 'setting' : 'settings'}`);
  return parts.join(' · ');
}

/**
 * A day worth opening after the import: the first day (today or later, else
 * the earliest) with an added or changed session; else the first due or
 * assessment date of an added or changed assignment.
 */
export function firstImportedDate(before: ScheduleDocument, after: ScheduleDocument, today: DateStr): DateStr | undefined {
  const pick = (dates: string[]): DateStr | undefined => {
    const sorted = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return sorted.find((d) => d >= today) ?? sorted[0];
  };
  const oldBlocks = new Map(before.scheduleBlocks.map((b) => [b.id, stableStringify(b)]));
  const blockDates = after.scheduleBlocks.filter((b) => oldBlocks.get(b.id) !== stableStringify(b)).map((b) => b.start.slice(0, 10));
  const fromBlocks = pick(blockDates);
  if (fromBlocks) return fromBlocks;
  const oldAsg = new Map(before.assignments.map((a) => [a.id, stableStringify(a)]));
  const asgDates: string[] = [];
  for (const a of after.assignments) {
    if (oldAsg.get(a.id) === stableStringify(a)) continue;
    if (a.due) asgDates.push(a.due.slice(0, 10));
    if (a.assessmentDate) asgDates.push(a.assessmentDate.slice(0, 10));
  }
  return pick(asgDates);
}

/** Ids for undo snapshots (`snap-…`); never stored in a schedule file. */
export function newSnapshotId(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `snap-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The device's IANA time zone, if the browser tells. */
export function deviceTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone ? zone : undefined;
  } catch {
    return undefined;
  }
}

/** A short file name for labels ("Import schedule.json"); pasted text is "pasted text". */
export function displayFileName(name: string): string {
  return shorten(name || 'schedule file', 60);
}
