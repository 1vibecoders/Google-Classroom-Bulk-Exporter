// Validation of schedule files against SCHEDULE_FORMAT.md (structure § 1–12
// and semantic rules § 13). Imported data is treated strictly as data: this
// module only inspects values; nothing is evaluated, executed or interpreted.
//
// Design:
// - The structure of every object type is described once, as data (the
//   `ObjSpec` tables below, in the field order of the spec). A generic walker
//   checks types, formats, lengths (in code points), ranges, enums, unknown
//   properties and nulls, and builds a normalized copy (Text trimmed,
//   LocalDateTimes in the canonical `YYYY-MM-DDTHH:MM:00` form, `x-…` values
//   deep-copied unchanged). The same tables give the export its field order.
// - Conditional structure (§ 13.1 rules 5–8) is checked per object type.
// - The semantic rules (§ 13.1 rule 12, § 13.2, § 13.3) run on the normalized
//   copy; values that failed the structural check are left out of it, so one
//   mistake is reported once instead of cascading.
// - Warnings (§ 13.4) never make a file invalid.
//
// Robustness: property names are looked up in Maps (never in plain objects),
// so keys such as `__proto__` or `constructor` are just unknown properties;
// `x-…` values are copied with own data properties only.
import {
  ASSIGNMENT_TYPES,
  BLOCK_STATUSES,
  CONFIDENCES,
  EVENT_CATEGORIES,
  ISSUE_KINDS,
  MAX_IMPORT_BYTES,
  PRIORITIES,
  REFERENCE_KINDS,
  SOURCE_KINDS,
  SUPPORTED_MAJOR,
  SUPPORTED_MINOR,
  WEEKDAYS,
  WORK_STATUSES,
  resolveSettings,
} from '../model/constants';
import type { DateStr, ScheduleDocument, Settings, Weekday } from '../model/types';
import {
  dateFromDayNumber,
  dateOf,
  dayNumber,
  dueMoment,
  formatDuration,
  isDateOnly,
  isValidDate,
  ldtToMinutes,
  mondayOf,
  startOfDayMoment,
  timeToMinutes,
  todayLocal,
  weekdayOf,
} from './time';

// ===========================================================================
// Public API
// ===========================================================================

export interface ValidationIssue {
  /** JSON-path-like location, e.g. `assignments[3].due`, or `` for the root. */
  path: string;
  message: string;
  /** Short machine-readable rule name, e.g. `duplicate-id` (for tests and grouping). */
  code?: string;
}

/**
 * How far validation got: `size` (file too large), `json` (not JSON),
 * `root` (not an object), `version` (schemaVersion missing/unsupported),
 * `content` (the whole document was checked).
 */
export type ValidationStage = 'size' | 'json' | 'root' | 'version' | 'content';

export interface ValidationResult {
  ok: boolean;
  /**
   * The validated document when ok: a normalized copy (never the input
   * object). Text is trimmed, LocalDateTimes are written as
   * `YYYY-MM-DDTHH:MM:00`, `x-…` properties are deep copies of the input.
   */
  doc?: ScheduleDocument;
  errors: ValidationIssue[];
  /** Accepted-but-suspicious things (§ 13 "Warnings"). */
  warnings: ValidationIssue[];
  /** The file's schemaVersion if it could be read. */
  schemaVersion?: string;
  stage?: ValidationStage;
}

export interface ValidateOptions {
  /** Used for the "more than 5 years away" warning. Defaults to the device date. */
  today?: DateStr;
}

/**
 * Validate a parsed JSON value. Reports every problem (not just the first),
 * each with a path. Rejects unsupported schemaVersion values with a clear
 * message (§ 2) before doing anything else.
 *
 * Properties whose value is `undefined` (possible for in-memory documents,
 * never in JSON) are treated as absent.
 */
export function validateDocument(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const ctx: Ctx = { errors: [], warnings: [], dates: [] };
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          code: 'root-type',
          message: `A schedule file must contain one JSON object ({ "schemaVersion": "1.0", … }), but this contains ${describe(input)}.`,
        },
      ],
      warnings: [],
      stage: 'root',
    };
  }

  const version = checkVersion(input);
  if (version.stop) {
    return { ok: false, errors: [version.stop], warnings: [], schemaVersion: version.version, stage: 'version' };
  }
  if (version.error) ctx.errors.push(version.error);

  const normalized = walkObject(input, ROOT_SPEC, '', ctx, 'schemaVersion');
  const doc = (normalized === INVALID ? {} : normalized) as Record<string, unknown>;
  doc.schemaVersion = '1.0';
  // Keep the root key order of a canonical file: schemaVersion first.
  const ordered: Record<string, unknown> = { schemaVersion: '1.0' };
  for (const key of Object.keys(doc)) if (key !== 'schemaVersion') ordered[key] = doc[key];

  const partial = ordered as unknown as PartialDoc;
  checkSemantics(partial, input, ctx);
  collectWarnings(partial, ctx, resolveToday(options.today));

  const ok = ctx.errors.length === 0;
  return {
    ok,
    doc: ok ? (ordered as unknown as ScheduleDocument) : undefined,
    errors: ctx.errors,
    warnings: ctx.warnings,
    schemaVersion: version.version,
    stage: 'content',
  };
}

/**
 * Parse text (file contents or pasted JSON) and validate it. Enforces the
 * 10 MB limit (UTF-8 bytes), strips a byte-order mark and reports JSON
 * syntax errors with line and column.
 */
export function parseScheduleText(text: string, options: ValidateOptions = {}): ValidationResult {
  if (typeof text !== 'string') {
    return fail('json', '', 'not-text', 'The file could not be read as text.');
  }
  const bytes = utf8ByteLength(text, MAX_IMPORT_BYTES);
  if (bytes > MAX_IMPORT_BYTES) {
    return fail(
      'size',
      '',
      'too-large',
      `This file is larger than ${formatMegabytes(MAX_IMPORT_BYTES)}${bytes === Infinity ? '' : ` (${formatMegabytes(bytes)})`}; the website accepts schedule files up to ${formatMegabytes(MAX_IMPORT_BYTES)}.`,
    );
  }
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (body.trim() === '') {
    return fail('json', '', 'empty', 'The file is empty. A schedule file is one JSON object that starts with { "schemaVersion": "1.0", … }.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    const where = locateJsonError(body, err);
    return fail('json', '', 'json-syntax', `This is not valid JSON: ${where.message} (line ${where.line}, column ${where.column}).`);
  }
  return validateDocument(parsed, options);
}

/** UTF-8 size of a string (stops counting once `limit` is exceeded; then returns Infinity). */
export function utf8ByteLength(text: string, limit = Infinity): number {
  if (text.length > limit) return Infinity; // every UTF-16 unit is at least one byte
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > limit) return Infinity;
  }
  return bytes;
}

// ===========================================================================
// Structure descriptions (shared with the export)
// ===========================================================================

/** How a value is checked and normalized. */
export type Kind =
  | { k: 'id' }
  | { k: 'date' }
  | { k: 'time' }
  | { k: 'endTime' }
  | { k: 'ldt' }
  | { k: 'dodt' }
  | { k: 'color' }
  | { k: 'url' }
  | { k: 'int'; min: number; max: number }
  | { k: 'bool' }
  | { k: 'enum'; values: readonly string[]; hints?: ReadonlyMap<string, string> }
  | { k: 'text'; max: number; required?: boolean }
  | { k: 'array'; of: Kind; min?: number; max?: number; unique?: boolean }
  | { k: 'object'; spec: ObjSpec }
  | { k: 'overrides'; itemType: string; allowed: readonly string[] };

/** One object type of the format. `fields` is in canonical (export) order. */
export interface ObjSpec {
  /** For messages, e.g. "an assignment". */
  name: string;
  fields: ReadonlyMap<string, Kind>;
  required: readonly string[];
  /** Property names that exist elsewhere in the format but not here, with a specific message. */
  misplaced?: ReadonlyMap<string, string>;
  /** Items (class, assignment, task, event, availability, block): `origin` defaults to "generated". */
  item?: boolean;
  /** Conditional structure checks (§ 13.1 rules 5–8) on the raw object. */
  check?: (raw: Record<string, unknown>, path: string, ctx: Ctx) => void;
}

const ID: Kind = { k: 'id' };
const DATE: Kind = { k: 'date' };
const TIME: Kind = { k: 'time' };
const END_TIME: Kind = { k: 'endTime' };
const LDT: Kind = { k: 'ldt' };
const DODT: Kind = { k: 'dodt' };
const COLOR: Kind = { k: 'color' };
const URL_KIND: Kind = { k: 'url' };
const BOOL: Kind = { k: 'bool' };
const MINUTES: Kind = { k: 'int', min: 0, max: 10000 };
const int = (min: number, max: number): Kind => ({ k: 'int', min, max });
const text = (max: number, required = false): Kind => ({ k: 'text', max, required });
const oneOf = (values: readonly string[], hints?: Array<[string, string]>): Kind => ({
  k: 'enum',
  values,
  hints: hints ? new Map(hints) : undefined,
});
const arrayOf = (of: Kind, opts: { min?: number; max?: number; unique?: boolean } = {}): Kind => ({ k: 'array', of, ...opts });
const object = (spec: ObjSpec): Kind => ({ k: 'object', spec });

function spec(
  name: string,
  fields: Array<[string, Kind]>,
  required: string[],
  extra: Partial<Pick<ObjSpec, 'misplaced' | 'item' | 'check'>> = {},
): ObjSpec {
  return { name, fields: new Map(fields), required, ...extra };
}

const ISSUE_STATUSES = ['open', 'resolved', 'dismissed'] as const;
const STATUS_HINTS: Array<[string, string]> = [
  ['complete', 'Use "done".'],
  ['completed', 'Use "done".'],
  ['finished', 'Use "done".'],
  ['todo', 'Use "not_started".'],
  ['not started', 'Use "not_started".'],
  ['in progress', 'Use "in_progress".'],
  ['canceled', 'Use "cancelled".'],
];
const PLANNER_HINT: [string, string] = ['planner', '"planner" is only allowed on schedule blocks (§ 6.1).'];
const ORIGINS = ['user', 'generated'] as const;
const BLOCK_ORIGINS = ['user', 'generated', 'planner'] as const;

/** Names allowed in `overrides`, per item type (§ 6.3). */
export const OVERRIDABLE_FIELDS = {
  class: ['name', 'teacher', 'section', 'room', 'color', 'description', 'archived', 'topics', 'references'],
  assignment: [
    'title', 'classId', 'type', 'topic', 'description', 'due', 'assessmentDate', 'recommendedCompletionDate',
    'estimatedMinutes', 'estimateRange', 'estimateConfidence', 'estimateBasis', 'priority', 'points', 'required',
    'sourceState', 'tasks', 'references', 'dependsOn',
  ],
  task: [
    'title', 'description', 'due', 'required', 'estimatedMinutes', 'estimateRange', 'dependsOn',
    'recommendedStartDate', 'recommendedCompletionDate',
  ],
  event: [
    'title', 'category', 'classId', 'assignmentId', 'date', 'endDate', 'recurrence', 'allDay', 'startTime', 'endTime',
    'busy', 'location',
  ],
  availability: ['label', 'date', 'recurrence', 'startTime', 'endTime'],
  block: ['start', 'end', 'assignmentId', 'taskId', 'title', 'kind', 'description'],
} as const;

const SOURCE_SPEC = spec(
  'a source',
  [
    ['kind', oneOf(SOURCE_KINDS)],
    ['id', text(200)],
    ['url', URL_KIND],
    ['path', text(500)],
    ['label', text(200)],
    ['retrievedAt', LDT],
  ],
  ['kind'],
);
const SOURCE = object(SOURCE_SPEC);

const ISSUE_FIELDS: Array<[string, Kind]> = [
  ['id', ID],
  ['kind', oneOf(ISSUE_KINDS)],
  ['message', text(1000, true)],
  ['field', text(100)],
  ['status', oneOf(ISSUE_STATUSES)],
  ['date', DATE],
];
const ITEM_ISSUE_SPEC = spec('an issue', ISSUE_FIELDS, ['kind', 'message'], {
  misplaced: new Map([
    ['itemId', '"itemId" is only allowed on root issues (the top-level "issues" array), never in an item\'s issues (§ 13.1 rule 10).'],
  ]),
});
const ROOT_ISSUE_SPEC = spec('an issue', [...ISSUE_FIELDS, ['itemId', ID]], ['kind', 'message']);

const ESTIMATE_RANGE_SPEC = spec('an estimate range', [['min', MINUTES], ['max', MINUTES]], ['min', 'max']);

const RECURRENCE_SPEC = spec(
  'a recurrence',
  [
    ['frequency', oneOf(['weekly'], [['daily', 'Only "weekly" exists in 1.0: use "weekly" with all seven days for "daily".']])],
    ['daysOfWeek', arrayOf(oneOf(WEEKDAYS, weekdayHints()), { min: 1, max: 7, unique: true })],
    ['interval', int(1, 52)],
    ['startDate', DATE],
    ['endDate', DATE],
    ['exceptDates', arrayOf(DATE)],
  ],
  ['frequency', 'daysOfWeek', 'startDate'],
);

const REFERENCE_SPEC = spec(
  'a reference',
  [
    ['title', text(300, true)],
    ['url', URL_KIND],
    ['path', text(500)],
    ['kind', oneOf(REFERENCE_KINDS)],
    ['required', BOOL],
  ],
  ['title'],
);

const REQUESTED_CHANGE_SPEC = spec(
  'a requested change',
  [
    ['id', ID],
    ['reason', text(500, true)],
    ['requestedByPerson', BOOL],
  ],
  ['id', 'reason', 'requestedByPerson'],
);

const TOMBSTONE_SPEC = spec(
  'a deleted-item entry',
  [
    ['id', ID],
    ['collection', oneOf(['classes', 'assignments', 'tasks', 'events', 'availability', 'scheduleBlocks'])],
    ['deletedAt', LDT],
    ['sourceId', text(200)],
    ['title', text(300)],
  ],
  ['id', 'collection', 'deletedAt'],
);

const GENERATOR_SPEC = spec('a generator', [['name', text(100, true)], ['version', text(50)]], ['name']);

const META_SPEC = spec(
  'meta',
  [
    ['title', text(200)],
    ['generatedAt', LDT],
    ['generator', object(GENERATOR_SPEC)],
    ['timezone', text(100)],
    ['exportId', ID],
    ['basedOn', ID],
    ['sources', arrayOf(SOURCE)],
    ['requestedChanges', arrayOf(object(REQUESTED_CHANGE_SPEC))],
  ],
  [],
);

const SETTINGS_SPEC = spec(
  'settings',
  [
    ['weekStartsOn', oneOf(['monday', 'sunday'])],
    ['dayStartTime', TIME],
    ['dayEndTime', END_TIME],
    ['defaultDueTime', TIME],
    ['minSessionMinutes', int(5, 240)],
    ['maxSessionMinutes', int(10, 480)],
    ['breakMinutes', int(0, 120)],
    ['maxDailyStudyMinutes', int(0, 1440)],
  ],
  [],
);

function itemSpec(
  name: string,
  itemType: keyof typeof OVERRIDABLE_FIELDS,
  fields: Array<[string, Kind]>,
  required: string[],
  opts: { withSource: boolean; planner?: boolean; check?: ObjSpec['check']; misplaced?: Array<[string, string]> },
): ObjSpec {
  const head: Array<[string, Kind]> = [
    ['id', ID],
    ['origin', opts.planner ? oneOf(BLOCK_ORIGINS) : oneOf(ORIGINS, [PLANNER_HINT])],
    ['locked', BOOL],
    ['overrides', { k: 'overrides', itemType: name, allowed: OVERRIDABLE_FIELDS[itemType] }],
  ];
  const tail: Array<[string, Kind]> = opts.withSource
    ? [
        ['source', SOURCE],
        ['sources', arrayOf(SOURCE, { max: 20 })],
        ['issues', arrayOf(object(ITEM_ISSUE_SPEC))],
      ]
    : [['issues', arrayOf(object(ITEM_ISSUE_SPEC))]];
  return spec(name, [...head, ...fields, ...tail], ['id', ...required], {
    item: true,
    check: opts.check,
    misplaced: opts.misplaced ? new Map(opts.misplaced) : undefined,
  });
}

const CLASS_SPEC = itemSpec(
  'a class',
  'class',
  [
    ['name', text(200, true)],
    ['teacher', text(200)],
    ['section', text(200)],
    ['room', text(100)],
    ['color', COLOR],
    ['description', text(5000)],
    ['archived', BOOL],
    ['topics', arrayOf(text(200), { max: 200 })],
    ['references', arrayOf(object(REFERENCE_SPEC), { max: 200 })],
  ],
  ['name'],
  { withSource: true },
);

const WORK_STATUS = oneOf(WORK_STATUSES, STATUS_HINTS);

const TASK_SPEC = itemSpec(
  'a task',
  'task',
  [
    ['title', text(200, true)],
    ['description', text(5000)],
    ['notes', text(10000)],
    ['estimatedMinutes', MINUTES],
    ['estimateRange', object(ESTIMATE_RANGE_SPEC)],
    ['status', WORK_STATUS],
    ['completedAt', LDT],
    ['dependsOn', arrayOf(ID, { unique: true })],
    ['recommendedStartDate', DATE],
    ['recommendedCompletionDate', DODT],
    ['due', DODT],
    ['required', BOOL],
  ],
  ['title'],
  {
    withSource: false,
    check: checkWorkShape,
    misplaced: [
      ['source', 'Tasks have no "source"; they inherit their assignment\'s (§ 6).'],
      ['sources', 'Tasks have no "sources"; they inherit their assignment\'s (§ 6).'],
    ],
  },
);

const ASSIGNMENT_SPEC = itemSpec(
  'an assignment',
  'assignment',
  [
    ['title', text(200, true)],
    ['classId', ID],
    ['type', oneOf(ASSIGNMENT_TYPES)],
    ['topic', text(200)],
    ['description', text(20000)],
    ['notes', text(10000)],
    ['due', DODT],
    ['assessmentDate', DODT],
    ['recommendedCompletionDate', DODT],
    ['estimatedMinutes', MINUTES],
    ['estimateRange', object(ESTIMATE_RANGE_SPEC)],
    ['estimateConfidence', oneOf(CONFIDENCES)],
    ['estimateBasis', text(2000)],
    ['priority', oneOf(PRIORITIES, [['normal', 'Use "medium".']])],
    ['status', WORK_STATUS],
    ['completedAt', LDT],
    ['points', text(100)],
    ['required', BOOL],
    ['sourceState', oneOf(['present', 'missing', 'withdrawn'])],
    ['tasks', arrayOf(object(TASK_SPEC))],
    ['references', arrayOf(object(REFERENCE_SPEC))],
    ['dependsOn', arrayOf(ID, { unique: true })],
  ],
  ['title'],
  { withSource: true, check: checkWorkShape },
);

const EVENT_SPEC = itemSpec(
  'an event',
  'event',
  [
    ['title', text(200, true)],
    ['category', oneOf(EVENT_CATEGORIES)],
    ['classId', ID],
    ['assignmentId', ID],
    ['date', DATE],
    ['endDate', DATE],
    ['recurrence', object(RECURRENCE_SPEC)],
    ['allDay', BOOL],
    ['startTime', TIME],
    ['endTime', END_TIME],
    ['busy', BOOL],
    ['location', text(200)],
    ['notes', text(10000)],
  ],
  ['title'],
  { withSource: true, check: checkEventShape },
);

const AVAILABILITY_SPEC = itemSpec(
  'a study-time window',
  'availability',
  [
    ['label', text(200)],
    ['date', DATE],
    ['recurrence', object(RECURRENCE_SPEC)],
    ['startTime', TIME],
    ['endTime', END_TIME],
  ],
  ['startTime', 'endTime'],
  { withSource: true, check: (raw, path, ctx) => checkDateOrRecurrence(raw, path, ctx, 'A study-time window') },
);

const BLOCK_SPEC = itemSpec(
  'a schedule block',
  'block',
  [
    ['start', LDT],
    ['end', LDT],
    ['assignmentId', ID],
    ['taskId', ID],
    ['title', text(200, true)],
    ['kind', oneOf(['work', 'break'])],
    ['status', oneOf(BLOCK_STATUSES, [['complete', 'Use "done".'], ['completed', 'Use "done".']])],
    ['completedAt', LDT],
    ['description', text(5000)],
    ['notes', text(10000)],
  ],
  ['start', 'end'],
  { withSource: true, planner: true, check: checkBlockShape },
);

const ROOT_SPEC = spec(
  'the schedule',
  [
    ['schemaVersion', oneOf(['1.0'])],
    ['meta', object(META_SPEC)],
    ['settings', object(SETTINGS_SPEC)],
    ['classes', arrayOf(object(CLASS_SPEC))],
    ['assignments', arrayOf(object(ASSIGNMENT_SPEC))],
    ['events', arrayOf(object(EVENT_SPEC))],
    ['availability', arrayOf(object(AVAILABILITY_SPEC))],
    ['scheduleBlocks', arrayOf(object(BLOCK_SPEC))],
    ['issues', arrayOf(object(ROOT_ISSUE_SPEC))],
    ['deleted', arrayOf(object(TOMBSTONE_SPEC), { max: 5000 })],
  ],
  ['schemaVersion', 'classes', 'assignments', 'events', 'availability', 'scheduleBlocks'],
);

/** The object types of the format (used by the export for canonical field order). */
export const FORMAT_SPECS = {
  root: ROOT_SPEC,
  meta: META_SPEC,
  settings: SETTINGS_SPEC,
  class: CLASS_SPEC,
  assignment: ASSIGNMENT_SPEC,
  task: TASK_SPEC,
  event: EVENT_SPEC,
  availability: AVAILABILITY_SPEC,
  block: BLOCK_SPEC,
  issue: ITEM_ISSUE_SPEC,
  rootIssue: ROOT_ISSUE_SPEC,
  source: SOURCE_SPEC,
  reference: REFERENCE_SPEC,
  recurrence: RECURRENCE_SPEC,
  estimateRange: ESTIMATE_RANGE_SPEC,
  tombstone: TOMBSTONE_SPEC,
  requestedChange: REQUESTED_CHANGE_SPEC,
  generator: GENERATOR_SPEC,
} as const;

function weekdayHints(): Array<[string, string]> {
  const full = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const out: Array<[string, string]> = [];
  full.forEach((name, i) => {
    const code = WEEKDAYS[i];
    const hint = `Use "${code}".`;
    out.push([name, hint], [name[0].toUpperCase() + name.slice(1), hint], [code.toUpperCase(), hint]);
    out.push([code[0].toUpperCase() + code.slice(1), hint]);
  });
  return out;
}

// ===========================================================================
// Structural walker
// ===========================================================================

interface Ctx {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** Every structurally valid date-like value (date part), for the 5-year warning. */
  dates: Array<{ path: string; date: DateStr }>;
}

const INVALID = Symbol('invalid');
type Walked = unknown;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const DATE_RE = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const END_TIME_RE = /^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;
const LDT_RE = /^([0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))T((?:[01][0-9]|2[0-3]):[0-5][0-9])(?::00)?$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const URL_RE = /^[Hh][Tt][Tt][Pp][Ss]?:\/\/[^\s]+$/;
const EXTENSION_RE = /^x-/;
const MAX_EXTENSION_DEPTH = 200;

function err(ctx: Ctx, path: string, code: string, message: string): void {
  ctx.errors.push({ path, message, code });
}

function warn(ctx: Ctx, path: string, code: string, message: string): void {
  ctx.warnings.push({ path, message, code });
}

function fail(stage: ValidationStage, path: string, code: string, message: string): ValidationResult {
  return { ok: false, errors: [{ path, message, code }], warnings: [], stage };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Own property, present and not undefined. */
function has(obj: Record<string, unknown>, key: string): boolean {
  return hasOwn(obj, key) && obj[key] !== undefined;
}

function get(obj: Record<string, unknown>, key: string): unknown {
  return hasOwn(obj, key) ? obj[key] : undefined;
}

const SIMPLE_KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*$/;

function childPath(path: string, key: string): string {
  if (SIMPLE_KEY_RE.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

function indexPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

/** Number of Unicode code points (a surrogate pair counts once). */
export function codePointLength(value: string): number {
  let n = value.length;
  for (let i = 0; i < value.length - 1; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = value.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
}

function show(value: unknown): string {
  if (typeof value === 'string') {
    const s = codePointLength(value) > 60 ? `${Array.from(value).slice(0, 57).join('')}…` : value;
    return JSON.stringify(s);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return 'an object';
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  switch (typeof value) {
    case 'string':
      return `a string (${show(value)})`;
    case 'number':
      return `a number (${show(value)})`;
    case 'boolean':
      return `${value} (a boolean)`;
    case 'object':
      return 'an object';
    case 'undefined':
      return 'nothing';
    default:
      return `a ${typeof value}`;
  }
}

function typeError(ctx: Ctx, path: string, expected: string, value: unknown, hint = ''): typeof INVALID {
  err(ctx, path, 'type', `Expected ${expected}, found ${describe(value)}.${hint ? ` ${hint}` : ''}`);
  return INVALID;
}

function listValues(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join(', ');
}

/** Field-name suggestions for common mistakes ("dueDate" → "due"). */
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['dueDate', 'due'],
  ['dueAt', 'due'],
  ['deadline', 'due'],
  ['dueTime', 'due'],
  ['subtasks', 'tasks'],
  ['steps', 'tasks'],
  ['estimate', 'estimatedMinutes'],
  ['minutes', 'estimatedMinutes'],
  ['duration', 'estimatedMinutes'],
  ['estimatedTime', 'estimatedMinutes'],
  ['class', 'classId'],
  ['course', 'classId'],
  ['courseId', 'classId'],
  ['assignment', 'assignmentId'],
  ['task', 'taskId'],
  ['blocks', 'scheduleBlocks'],
  ['sessions', 'scheduleBlocks'],
  ['version', 'schemaVersion'],
  ['days', 'daysOfWeek'],
  ['weekdays', 'daysOfWeek'],
  ['repeat', 'recurrence'],
  ['note', 'notes'],
  ['name', 'title'],
  ['title', 'name'],
  ['start', 'startTime'],
  ['end', 'endTime'],
  ['startTime', 'start'],
  ['endTime', 'end'],
  ['done', 'status'],
  ['completed', 'status'],
  ['exceptions', 'exceptDates'],
]);

function squash(name: string): string {
  return name.toLowerCase().replace(/[_\-\s]/g, '');
}

function unknownPropertyMessage(key: string, s: ObjSpec): string {
  let suggestion: string | undefined;
  const squashed = squash(key);
  for (const field of s.fields.keys()) {
    if (squash(field) === squashed) {
      suggestion = field;
      break;
    }
  }
  if (!suggestion) {
    const alias = ALIASES.get(key);
    if (alias && s.fields.has(alias)) suggestion = alias;
  }
  const base = `Unknown property ${JSON.stringify(key)} in ${s.name}. Only the fields defined in SCHEDULE_FORMAT.md and "x-…" extension properties are allowed.`;
  return suggestion ? `${base} Did you mean "${suggestion}"?` : base;
}

class ExtensionTooDeep extends Error {}

/**
 * Deep copy of a JSON value. Object keys become own data properties (so a
 * key named `__proto__` stays data and never changes a prototype).
 */
export function cloneJsonValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_EXTENSION_DEPTH) throw new ExtensionTooDeep();
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(out, key, {
      value: cloneJsonValue((value as Record<string, unknown>)[key], depth + 1),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

function walkObject(
  raw: unknown,
  s: ObjSpec,
  path: string,
  ctx: Ctx,
  skip?: string,
): Record<string, unknown> | typeof INVALID {
  if (!isPlainObject(raw)) return typeError(ctx, path, `${s.name} (a JSON object)`, raw);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (key === skip) continue;
    const value = raw[key];
    if (value === undefined) continue;
    const p = childPath(path, key);
    if (EXTENSION_RE.test(key)) {
      try {
        out[key] = cloneJsonValue(value);
      } catch (e) {
        if (!(e instanceof ExtensionTooDeep) && !(e instanceof RangeError)) throw e;
        err(ctx, p, 'too-deep', `This "x-…" value is nested more than ${MAX_EXTENSION_DEPTH} levels deep; the website cannot store it.`);
      }
      continue;
    }
    const kind = s.fields.get(key);
    if (kind) {
      const result = walk(value, kind, p, ctx);
      if (result !== INVALID) out[key] = result;
      continue;
    }
    const misplaced = s.misplaced?.get(key);
    if (misplaced) err(ctx, p, 'misplaced-property', misplaced);
    else err(ctx, p, 'unknown-property', unknownPropertyMessage(key, s));
  }
  for (const key of s.required) {
    if (key === skip) continue;
    if (!has(raw, key)) err(ctx, childPath(path, key), 'required', `Missing required field "${key}" in ${s.name}.`);
  }
  s.check?.(raw, path, ctx);
  return out;
}

function walk(value: unknown, kind: Kind, path: string, ctx: Ctx): Walked | typeof INVALID {
  if (value === null) {
    err(ctx, path, 'null', 'null is not allowed. Omit an optional field instead of setting it to null.');
    return INVALID;
  }
  switch (kind.k) {
    case 'id': {
      if (typeof value !== 'string') return typeError(ctx, path, 'an ID (a string)', value);
      if (!ID_RE.test(value)) {
        err(
          ctx,
          path,
          'id-format',
          `${show(value)} is not a valid ID. An ID has 1–100 characters: a letter or digit, then letters, digits, ".", "_", ":" or "-" (no spaces or "/"). References use IDs, never names.`,
        );
      }
      // Kept even when malformed so that references to it still resolve
      // (the document is not returned anyway when there is an error).
      return value;
    }
    case 'date':
      return walkDate(value, path, ctx);
    case 'ldt':
      return walkLocalDateTime(value, path, ctx, false);
    case 'dodt':
      if (typeof value === 'string' && DATE_RE.test(value)) return walkDate(value, path, ctx);
      return walkLocalDateTime(value, path, ctx, true);
    case 'time':
    case 'endTime': {
      if (typeof value !== 'string') return typeError(ctx, path, 'a time string "HH:MM"', value);
      const re = kind.k === 'time' ? TIME_RE : END_TIME_RE;
      if (!re.test(value)) {
        let hint = kind.k === 'time' ? 'Use the 24-hour clock "HH:MM" from "00:00" to "23:59".' : 'Use the 24-hour clock "HH:MM" ("00:00"–"23:59"), or "24:00" for midnight at the end of the day.';
        if (kind.k === 'time' && value === '24:00') hint = '"24:00" is only allowed as an end time (event or study-time "endTime", settings "dayEndTime").';
        else if (/^\d{1,2}(:\d{2})?\s*[AaPp]\.?[Mm]\.?$/.test(value)) hint = 'Use the 24-hour clock without AM/PM, e.g. "16:00" instead of "4:00 PM".';
        else if (/^\d:\d{2}$/.test(value)) hint = `Hours have two digits, e.g. "0${value}".`;
        else if (/^\d{2}:\d{2}:\d{2}$/.test(value)) hint = 'Times have no seconds: use "HH:MM".';
        err(ctx, path, 'time-format', `${show(value)} is not a valid time. ${hint}`);
        return INVALID;
      }
      return value;
    }
    case 'color': {
      if (typeof value !== 'string') return typeError(ctx, path, 'a color string "#RRGGBB"', value);
      if (!COLOR_RE.test(value)) {
        err(ctx, path, 'color-format', `${show(value)} is not a valid color. Use "#RRGGBB" with six hexadecimal digits, e.g. "#2563EB".`);
        return INVALID;
      }
      return value;
    }
    case 'url': {
      if (typeof value !== 'string') return typeError(ctx, path, 'a URL string', value);
      const length = codePointLength(value);
      if (length > 2000) {
        err(ctx, path, 'text-length', `This URL is too long: ${length} characters (at most 2000).`);
        return INVALID;
      }
      if (!URL_RE.test(value)) {
        err(ctx, path, 'url-format', `${show(value)} is not allowed: only absolute http:// or https:// URLs (without spaces) can be used.`);
        return INVALID;
      }
      return value;
    }
    case 'int': {
      if (typeof value !== 'number') {
        const hint = typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? 'Write numbers without quotes.' : '';
        return typeError(ctx, path, 'a whole number', value, hint);
      }
      if (!Number.isInteger(value)) {
        err(ctx, path, 'integer', `${show(value)} is not a whole number. Use whole minutes (or a whole number), e.g. 45.`);
        return INVALID;
      }
      if (value < kind.min || value > kind.max) {
        err(ctx, path, 'range', `${value} is out of range: use a whole number from ${kind.min} to ${kind.max}.`);
        return INVALID;
      }
      return value;
    }
    case 'bool': {
      if (typeof value !== 'boolean') {
        const hint = value === 'true' || value === 'false' ? 'Write true or false without quotes.' : '';
        return typeError(ctx, path, 'true or false', value, hint);
      }
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string') return typeError(ctx, path, `one of ${listValues(kind.values)}`, value);
      if (!kind.values.includes(value)) {
        const hint = kind.hints?.get(value);
        err(ctx, path, 'enum', `${show(value)} is not allowed here. ${hint ? `${hint} ` : ''}Allowed values: ${listValues(kind.values)}.`);
        return INVALID;
      }
      return value;
    }
    case 'text': {
      if (typeof value !== 'string') return typeError(ctx, path, 'text (a string)', value);
      const length = codePointLength(value);
      if (length > kind.max) {
        err(ctx, path, 'text-length', `Too long: ${length} characters (at most ${kind.max}).`);
        return INVALID;
      }
      const trimmed = value.trim();
      if (kind.required) {
        if (value.length === 0) {
          err(ctx, path, 'text-empty', 'Must not be empty.');
          return INVALID;
        }
        if (trimmed.length === 0) {
          err(ctx, path, 'text-blank', 'Must contain at least one character that is not a space.');
          return INVALID;
        }
      }
      return trimmed;
    }
    case 'array': {
      if (!Array.isArray(value)) return typeError(ctx, path, 'an array ([ … ])', value);
      if (kind.min !== undefined && value.length < kind.min) {
        err(ctx, path, 'array-size', `Needs at least ${kind.min} ${kind.min === 1 ? 'entry' : 'entries'}.`);
      }
      if (kind.max !== undefined && value.length > kind.max) {
        err(ctx, path, 'array-size', `Too many entries: ${value.length} (at most ${kind.max}).`);
      }
      const out: unknown[] = new Array(value.length);
      const seen = new Map<string, number>();
      for (let i = 0; i < value.length; i++) {
        const p = indexPath(path, i);
        const item = value[i];
        if (item === undefined) {
          err(ctx, p, 'type', 'Array entries cannot be empty.');
          continue;
        }
        if (kind.unique && typeof item === 'string') {
          const first = seen.get(item);
          if (first !== undefined) err(ctx, p, 'unique', `Duplicate entry ${show(item)} (already at position ${first}).`);
          else seen.set(item, i);
        }
        const result = walk(item, kind.of, p, ctx);
        out[i] = result === INVALID ? undefined : result;
      }
      return out;
    }
    case 'object':
      return walkObject(value, kind.spec, path, ctx);
    case 'overrides': {
      if (!Array.isArray(value)) return typeError(ctx, path, 'an array of field names', value);
      const seen = new Set<string>();
      const out: unknown[] = new Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const p = indexPath(path, i);
        const name = value[i];
        if (name === null) {
          err(ctx, p, 'null', 'null is not allowed.');
          continue;
        }
        if (typeof name !== 'string') {
          typeError(ctx, p, 'a field name (a string)', name);
          continue;
        }
        if (seen.has(name)) err(ctx, p, 'unique', `Duplicate entry ${show(name)}: each field is listed once.`);
        seen.add(name);
        if (!kind.allowed.includes(name) && !EXTENSION_RE.test(name)) {
          const never = ['id', 'origin', 'locked', 'overrides', 'issues', 'source', 'sources', 'notes', 'status', 'completedAt'];
          err(
            ctx,
            p,
            'override-name',
            never.includes(name)
              ? `${show(name)} can never be listed in "overrides": it is structural or already person-owned (§ 6.3).`
              : `${show(name)} cannot be listed in "overrides" of ${kind.itemType}. Allowed: ${kind.allowed.join(', ')}, or an "x-…" name.`,
          );
        }
        out[i] = name;
      }
      return out;
    }
  }
}

function walkDate(value: unknown, path: string, ctx: Ctx): Walked | typeof INVALID {
  if (typeof value !== 'string') return typeError(ctx, path, 'a date string "YYYY-MM-DD"', value);
  if (!DATE_RE.test(value)) {
    let hint = 'Use "YYYY-MM-DD", e.g. "2026-10-16".';
    if (LDT_RE.test(value) || /^\d{4}-\d{2}-\d{2}T/.test(value)) hint = 'This field takes a date without a time: "YYYY-MM-DD".';
    else if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) hint = 'Month and day have two digits, e.g. "2026-02-03".';
    err(ctx, path, 'date-format', `${show(value)} is not a valid date. ${hint}`);
    return INVALID;
  }
  if (!isValidDate(value)) {
    err(ctx, path, 'real-date', `${show(value)} is not a real calendar date.`);
    return INVALID;
  }
  ctx.dates.push({ path, date: value });
  return value;
}

function walkLocalDateTime(value: unknown, path: string, ctx: Ctx, orDate: boolean): Walked | typeof INVALID {
  const expected = orDate ? 'a date "YYYY-MM-DD" or a date-time "YYYY-MM-DDTHH:MM:SS"' : 'a date-time string "YYYY-MM-DDTHH:MM:SS"';
  if (typeof value !== 'string') return typeError(ctx, path, expected, value);
  const m = LDT_RE.exec(value);
  if (!m) {
    let hint = orDate ? 'Use "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM:SS" in local time.' : 'Use "YYYY-MM-DDTHH:MM:SS" in local time, e.g. "2026-10-16T23:59:00".';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      hint = 'Times are local wall-clock times: remove the "Z" or the UTC offset (§ 4).';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+$/.test(value)) {
      hint = 'Fractions of a second are not allowed; write ":00" seconds or leave them out.';
    } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
      hint = 'Seconds must be ":00" (the format works in whole minutes).';
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value)) {
      hint = 'Put a "T" between the date and the time, e.g. "2026-10-16T23:59:00".';
    } else if (!orDate && DATE_RE.test(value)) {
      hint = 'This field needs a time as well, e.g. "2026-10-16T00:00:00".';
    }
    err(ctx, path, 'datetime-format', `${show(value)} is not a valid ${orDate ? 'date or date-time' : 'date-time'}. ${hint}`);
    return INVALID;
  }
  if (!isValidDate(m[1])) {
    err(ctx, path, 'real-date', `${show(value)} is not a real calendar date.`);
    return INVALID;
  }
  ctx.dates.push({ path, date: m[1] });
  return `${m[1]}T${m[2]}:00`;
}

// ---------------------------------------------------------------------------
// Conditional structure (§ 13.1 rules 5–8)
// ---------------------------------------------------------------------------

function checkDateOrRecurrence(raw: Record<string, unknown>, path: string, ctx: Ctx, what: string): void {
  const hasDate = has(raw, 'date');
  const hasRecurrence = has(raw, 'recurrence');
  if (hasDate && hasRecurrence) {
    err(ctx, childPath(path, 'recurrence'), 'date-xor-recurrence', `${what} has either "date" (one day) or "recurrence" (repeating), not both.`);
  } else if (!hasDate && !hasRecurrence) {
    err(ctx, path, 'date-xor-recurrence', `${what} needs either "date" (one day) or "recurrence" (repeating).`);
  }
}

function checkEventShape(raw: Record<string, unknown>, path: string, ctx: Ctx): void {
  checkDateOrRecurrence(raw, path, ctx, 'An event');
  const allDay = get(raw, 'allDay') === true;
  if (allDay) {
    for (const key of ['startTime', 'endTime']) {
      if (has(raw, key)) err(ctx, childPath(path, key), 'all-day-times', `An all-day event has no ${key} (remove it, or set "allDay" to false).`);
    }
    if (has(raw, 'endDate') && !has(raw, 'date')) {
      err(ctx, childPath(path, 'endDate'), 'end-date-without-date', '"endDate" requires "date" (a one-time event); a recurrence has its own endDate.');
    }
  } else {
    for (const key of ['startTime', 'endTime']) {
      if (!has(raw, key)) err(ctx, childPath(path, key), 'required', `Missing "${key}": an event that is not all-day needs startTime and endTime.`);
    }
    if (has(raw, 'endDate')) {
      err(ctx, childPath(path, 'endDate'), 'end-date-not-all-day', '"endDate" is only allowed on a multi-day all-day event ("allDay": true with "date").');
    }
  }
}

/** Assignments and tasks: completedAt only with status done; estimateRange needs estimatedMinutes. */
function checkWorkShape(raw: Record<string, unknown>, path: string, ctx: Ctx): void {
  checkCompletedAt(raw, path, ctx);
  if (has(raw, 'estimateRange') && !has(raw, 'estimatedMinutes')) {
    const range = get(raw, 'estimateRange');
    let suggestion = '';
    if (isPlainObject(range)) {
      const min = get(range, 'min');
      const max = get(range, 'max');
      if (typeof min === 'number' && typeof max === 'number' && Number.isInteger(min) && Number.isInteger(max)) {
        suggestion = ` For ${min}–${max} the point estimate is ${Math.ceil((min + max) / 2 / 5) * 5}.`;
      }
    }
    err(
      ctx,
      childPath(path, 'estimatedMinutes'),
      'estimate-range-needs-estimate',
      `"estimateRange" requires "estimatedMinutes" (the point estimate: the midpoint rounded up to a multiple of 5).${suggestion}`,
    );
  }
}

function checkCompletedAt(raw: Record<string, unknown>, path: string, ctx: Ctx): void {
  if (has(raw, 'completedAt') && get(raw, 'status') !== 'done') {
    err(ctx, childPath(path, 'completedAt'), 'completed-at-status', '"completedAt" is only allowed when "status" is "done".');
  }
}

function checkBlockShape(raw: Record<string, unknown>, path: string, ctx: Ctx): void {
  const hasAssignment = has(raw, 'assignmentId');
  if (!hasAssignment && !has(raw, 'title')) {
    err(ctx, path, 'block-needs-assignment-or-title', 'A schedule block needs an "assignmentId" or a "title".');
  }
  if (has(raw, 'taskId') && !hasAssignment) {
    err(ctx, childPath(path, 'taskId'), 'task-without-assignment', '"taskId" requires "assignmentId" (the assignment the task belongs to).');
  }
  if (get(raw, 'kind') === 'break') {
    if (hasAssignment) err(ctx, childPath(path, 'assignmentId'), 'break-with-assignment', 'A break block has no "assignmentId".');
    if (!has(raw, 'title')) err(ctx, childPath(path, 'title'), 'required', 'A break block needs a "title", e.g. "Break".');
  }
  checkCompletedAt(raw, path, ctx);
}

// ---------------------------------------------------------------------------
// schemaVersion (§ 2)
// ---------------------------------------------------------------------------

function checkVersion(root: Record<string, unknown>): { version?: string; error?: ValidationIssue; stop?: ValidationIssue } {
  const supported = `${SUPPORTED_MAJOR}.${SUPPORTED_MINOR}`;
  if (!has(root, 'schemaVersion')) {
    return {
      stop: {
        path: 'schemaVersion',
        code: 'version-missing',
        message: `This file has no "schemaVersion", so it is not a schedule file (or it is incomplete). A schedule file starts with "schemaVersion": "${supported}".`,
      },
    };
  }
  const value = root.schemaVersion;
  if (typeof value !== 'string') {
    if (typeof value === 'number' && value === SUPPORTED_MAJOR + SUPPORTED_MINOR / 10) {
      return {
        error: {
          path: 'schemaVersion',
          code: 'version-type',
          message: `"schemaVersion" must be the string "${supported}" (in quotes), not the number ${supported}.`,
        },
      };
    }
    return {
      stop: {
        path: 'schemaVersion',
        code: 'version-type',
        message: `"schemaVersion" must be a string such as "${supported}", but this file has ${describe(value)}.`,
      },
    };
  }
  const m = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value);
  if (!m) {
    return {
      version: value,
      stop: {
        path: 'schemaVersion',
        code: 'version-format',
        message: `${show(value)} is not a schema version. Expected "MAJOR.MINOR"; this website reads version "${supported}" files.`,
      },
    };
  }
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== SUPPORTED_MAJOR) {
    return {
      version: value,
      stop: {
        path: 'schemaVersion',
        code: 'version-unsupported',
        message: `This file uses schema version ${value}; this website supports ${SUPPORTED_MAJOR}.x (up to ${supported}). Ask the program that wrote the file for a version ${supported} file.`,
      },
    };
  }
  if (minor > SUPPORTED_MINOR) {
    return {
      version: value,
      stop: {
        path: 'schemaVersion',
        code: 'version-unsupported',
        message: `This file uses schema version ${value}, but this version of the Academic Scheduler supports up to ${supported}. Update the website or generate a ${supported} file.`,
      },
    };
  }
  return { version: value };
}

// ===========================================================================
// Semantic rules (§ 13.1 rule 12 is in the walker; § 13.2, § 13.3 here)
// ===========================================================================

// The normalized partial document: fields that failed the structural check
// are absent, array entries that were not objects are undefined holes.
type Obj = Record<string, unknown>;
interface PartialDoc {
  meta?: Obj;
  settings?: Obj;
  classes?: Array<Obj | undefined>;
  assignments?: Array<Obj | undefined>;
  events?: Array<Obj | undefined>;
  availability?: Array<Obj | undefined>;
  scheduleBlocks?: Array<Obj | undefined>;
  issues?: Array<Obj | undefined>;
  deleted?: Array<Obj | undefined>;
}

type CollectionKey = 'classes' | 'assignments' | 'tasks' | 'events' | 'availability' | 'scheduleBlocks';

interface ItemInfo {
  id: string;
  path: string;
  collection: CollectionKey;
  item: Obj;
  /** For tasks: the id of their assignment. */
  assignmentId?: string;
}

const COLLECTION_WORD: Record<CollectionKey, string> = {
  classes: 'a class',
  assignments: 'an assignment',
  tasks: 'a task',
  events: 'an event',
  availability: 'a study-time window',
  scheduleBlocks: 'a schedule block',
};

function list(value: unknown): Array<Obj | undefined> {
  return Array.isArray(value) ? (value as Array<Obj | undefined>) : [];
}

function str(obj: Obj | undefined, key: string): string | undefined {
  if (!obj) return undefined;
  const v = get(obj, key);
  return typeof v === 'string' ? v : undefined;
}

function num(obj: Obj | undefined, key: string): number | undefined {
  if (!obj) return undefined;
  const v = get(obj, key);
  return typeof v === 'number' ? v : undefined;
}

function strList(obj: Obj | undefined, key: string): Array<string | undefined> {
  if (!obj) return [];
  const v = get(obj, key);
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : undefined)) : [];
}

/** All items of the document, in document order (tasks right after their assignment). */
function enumerateItems(doc: PartialDoc): ItemInfo[] {
  const out: ItemInfo[] = [];
  const add = (collection: CollectionKey, path: string, item: Obj | undefined, assignmentId?: string) => {
    if (!item) return;
    const id = str(item, 'id');
    if (id === undefined) return;
    out.push({ id, path, collection, item, assignmentId });
  };
  list(doc.classes).forEach((c, i) => add('classes', `classes[${i}]`, c));
  list(doc.assignments).forEach((a, i) => {
    add('assignments', `assignments[${i}]`, a);
    const aid = str(a, 'id');
    list(a && get(a, 'tasks')).forEach((t, j) => add('tasks', `assignments[${i}].tasks[${j}]`, t, aid));
  });
  list(doc.events).forEach((e, i) => add('events', `events[${i}]`, e));
  list(doc.availability).forEach((w, i) => add('availability', `availability[${i}]`, w));
  list(doc.scheduleBlocks).forEach((b, i) => add('scheduleBlocks', `scheduleBlocks[${i}]`, b));
  return out;
}

/** Collections whose list of IDs is incomplete because of a structural error. */
function damagedCollections(doc: PartialDoc, rawRoot: Record<string, unknown>): Set<CollectionKey> {
  const damaged = new Set<CollectionKey>();
  const complete = (entries: Array<Obj | undefined>) => entries.every((item) => item !== undefined && str(item, 'id') !== undefined);
  for (const key of ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'] as const) {
    if (!Array.isArray(get(rawRoot, key)) || !complete(list(doc[key]))) damaged.add(key);
  }
  const rawAssignments = get(rawRoot, 'assignments');
  if (damaged.has('assignments')) damaged.add('tasks');
  else if (Array.isArray(rawAssignments)) {
    rawAssignments.forEach((raw, i) => {
      const tasks = isPlainObject(raw) ? get(raw, 'tasks') : undefined;
      if (tasks !== undefined && !Array.isArray(tasks)) damaged.add('tasks');
      const normalized = list(doc.assignments)[i];
      if (!complete(list(normalized && get(normalized, 'tasks')))) damaged.add('tasks');
    });
  }
  return damaged;
}

/**
 * Compare two DateOrDateTime values (§ 13.3): when either is a Date without a
 * time only the dates are compared; otherwise the date-times.
 */
export function compareDateValues(a: string, b: string): number {
  if (isDateOnly(a) || isDateOnly(b)) {
    const da = dateOf(a);
    const db = dateOf(b);
    return da < db ? -1 : da > db ? 1 : 0;
  }
  return ldtToMinutes(a) - ldtToMinutes(b);
}

function checkSemantics(doc: PartialDoc, rawRoot: Record<string, unknown>, ctx: Ctx): void {
  const items = enumerateItems(doc);

  // Rule 13: unique item IDs across the whole file.
  const byId = new Map<string, ItemInfo>();
  for (const info of items) {
    const first = byId.get(info.id);
    if (first) {
      err(
        ctx,
        `${info.path}.id`,
        'duplicate-id',
        `Duplicate ID "${info.id}": ${first.path} (${COLLECTION_WORD[first.collection]}) already uses it. Every ID must be unique in the whole file, tasks included.`,
      );
    } else byId.set(info.id, info);
  }

  // Rule 14: tombstones unique, and their IDs are not used by items.
  const tombstones = new Map<string, string>();
  list(doc.deleted).forEach((t, i) => {
    const id = str(t, 'id');
    if (id === undefined) return;
    const first = tombstones.get(id);
    if (first !== undefined) err(ctx, `deleted[${i}].id`, 'duplicate-tombstone', `"${id}" is already listed in ${first}. Each deleted ID is listed once.`);
    else tombstones.set(id, `deleted[${i}]`);
  });
  for (const info of items) {
    const tomb = tombstones.get(info.id);
    if (tomb !== undefined) {
      err(
        ctx,
        `${info.path}.id`,
        'deleted-id-used',
        `"${info.id}" is listed in ${tomb} as an item the person deleted; no item may use this ID. Leave the item out (or remove the tombstone to restore it).`,
      );
    }
  }

  // Rule 15: issue IDs unique among all issues of the file.
  const issueIds = new Map<string, string>();
  const checkIssueList = (issues: unknown, path: string) => {
    list(issues).forEach((issue, i) => {
      const id = str(issue, 'id');
      if (id === undefined) return;
      const p = `${path}[${i}]`;
      const first = issueIds.get(id);
      if (first !== undefined) err(ctx, `${p}.id`, 'duplicate-issue-id', `Duplicate issue ID "${id}" (already used by ${first}). Issue IDs are unique among all issues of the file.`);
      else issueIds.set(id, p);
    });
  };
  checkIssueList(doc.issues, 'issues');
  for (const info of items) checkIssueList(get(info.item, 'issues'), `${info.path}.issues`);

  // Rule 16: requestedChanges IDs unique.
  const requested = new Map<string, number>();
  list(doc.meta && get(doc.meta, 'requestedChanges')).forEach((rc, i) => {
    const id = str(rc, 'id');
    if (id === undefined) return;
    const first = requested.get(id);
    if (first !== undefined) {
      err(ctx, `meta.requestedChanges[${i}].id`, 'duplicate-requested-change', `"${id}" is already listed in meta.requestedChanges[${first}]. List each item once.`);
    } else requested.set(id, i);
  });

  // Rule 17: references resolve. A collection with a structural error (not
  // an array, an entry that is not an object, an item without a usable ID)
  // cannot prove that an ID is missing, so "does not exist" is not reported
  // for it: the structural error is reported instead (no cascades).
  const damaged = damagedCollections(doc, rawRoot);
  const expectRef = (path: string, id: string | undefined, collection: CollectionKey, what: string) => {
    if (id === undefined) return;
    const target = byId.get(id);
    if (!target) {
      if (!damaged.has(collection)) err(ctx, path, 'unknown-reference', `${what} "${id}" does not exist in this file.`);
    } else if (target.collection !== collection) {
      err(ctx, path, 'wrong-reference', `"${id}" is ${COLLECTION_WORD[target.collection]} (${target.path}), not ${COLLECTION_WORD[collection]}.`);
    }
  };
  list(doc.assignments).forEach((a, i) => {
    if (!a) return;
    const path = `assignments[${i}]`;
    const aid = str(a, 'id');
    expectRef(`${path}.classId`, str(a, 'classId'), 'classes', 'Class');
    strList(a, 'dependsOn').forEach((dep, j) => {
      if (dep === undefined) return;
      if (dep === aid) err(ctx, `${path}.dependsOn[${j}]`, 'depends-on-self', 'An assignment cannot depend on itself.');
      else expectRef(`${path}.dependsOn[${j}]`, dep, 'assignments', 'Assignment');
    });
    const tasks = list(get(a, 'tasks'));
    const taskIds = new Set(tasks.map((t) => str(t, 'id')).filter((x): x is string => x !== undefined));
    const tasksComplete = tasks.every((t) => t !== undefined && str(t, 'id') !== undefined);
    tasks.forEach((t, j) => {
      if (!t) return;
      const tid = str(t, 'id');
      strList(t, 'dependsOn').forEach((dep, k) => {
        if (dep === undefined) return;
        const p = `${path}.tasks[${j}].dependsOn[${k}]`;
        if (dep === tid) err(ctx, p, 'depends-on-self', 'A task cannot depend on itself.');
        else if (!taskIds.has(dep)) {
          const target = byId.get(dep);
          if (!target && !tasksComplete) return;
          err(
            ctx,
            p,
            'task-dependency-outside',
            target
              ? `"${dep}" is not a task of this assignment (${target.path}). Tasks can only depend on tasks of the same assignment.`
              : `Task "${dep}" does not exist in this assignment.`,
          );
        }
      });
    });
  });
  list(doc.events).forEach((e, i) => {
    if (!e) return;
    expectRef(`events[${i}].classId`, str(e, 'classId'), 'classes', 'Class');
    expectRef(`events[${i}].assignmentId`, str(e, 'assignmentId'), 'assignments', 'Assignment');
  });
  list(doc.scheduleBlocks).forEach((b, i) => {
    if (!b) return;
    const assignmentId = str(b, 'assignmentId');
    expectRef(`scheduleBlocks[${i}].assignmentId`, assignmentId, 'assignments', 'Assignment');
    const taskId = str(b, 'taskId');
    if (taskId === undefined || assignmentId === undefined) return;
    const assignment = byId.get(assignmentId);
    if (!assignment || assignment.collection !== 'assignments') return; // already reported
    const task = byId.get(taskId);
    const p = `scheduleBlocks[${i}].taskId`;
    if (!task) {
      if (!damaged.has('tasks')) err(ctx, p, 'unknown-reference', `Task "${taskId}" does not exist in this file.`);
    }
    else if (task.collection !== 'tasks') err(ctx, p, 'wrong-reference', `"${taskId}" is ${COLLECTION_WORD[task.collection]} (${task.path}), not a task.`);
    else if (task.assignmentId !== assignmentId) {
      err(ctx, p, 'task-of-other-assignment', `Task "${taskId}" belongs to assignment "${task.assignmentId}", not to "${assignmentId}" (this block's assignmentId).`);
    }
  });
  list(doc.issues).forEach((issue, i) => {
    const itemId = str(issue, 'itemId');
    if (itemId !== undefined && !byId.has(itemId) && damaged.size === 0) {
      err(ctx, `issues[${i}].itemId`, 'unknown-reference', `Item "${itemId}" does not exist in this file (itemId must name an existing item of any collection, tasks included).`);
    }
  });

  // Rule 18: no dependency cycles.
  const assignments = list(doc.assignments);
  const assignmentIds = new Set(assignments.map((a) => str(a, 'id')).filter((x): x is string => x !== undefined));
  reportCycles(
    ctx,
    assignments.map((a, i) => ({ id: str(a, 'id'), path: `assignments[${i}]`, deps: strList(a, 'dependsOn') })),
    assignmentIds,
    'assignments',
  );
  assignments.forEach((a, i) => {
    if (!a) return;
    const tasks = list(get(a, 'tasks'));
    const ids = new Set(tasks.map((t) => str(t, 'id')).filter((x): x is string => x !== undefined));
    reportCycles(
      ctx,
      tasks.map((t, j) => ({ id: str(t, 'id'), path: `assignments[${i}].tasks[${j}]`, deps: strList(t, 'dependsOn') })),
      ids,
      'tasks',
    );
  });

  // Rule 19: blocks last ≥ 5 minutes and stay within their start date (or end at the next midnight).
  list(doc.scheduleBlocks).forEach((b, i) => {
    const start = str(b, 'start');
    const end = str(b, 'end');
    if (start === undefined || end === undefined) return;
    const p = `scheduleBlocks[${i}].end`;
    const minutes = ldtToMinutes(end) - ldtToMinutes(start);
    const startDate = dateOf(start);
    const endDate = dateOf(end);
    const sameDay = startDate === endDate;
    const nextMidnight = dayNumber(endDate) === dayNumber(startDate) + 1 && end.slice(11, 16) === '00:00';
    if (minutes <= 0) err(ctx, p, 'block-end-before-start', `The block ends (${end}) before or when it starts (${start}).`);
    else if (!sameDay && !nextMidnight) {
      err(
        ctx,
        p,
        'block-crosses-midnight',
        `A block must end on the date it starts (${startDate}) or at 00:00 of the next date (midnight). Split work that crosses midnight into two blocks.`,
      );
    } else if (minutes < 5) err(ctx, p, 'block-too-short', `The block lasts ${minutes} minute${minutes === 1 ? '' : 's'}; a block lasts at least 5 minutes.`);
  });

  // Rule 20: end times after start times; end dates not before start dates.
  const checkTimes = (obj: Obj | undefined, path: string, what: string) => {
    const startTime = str(obj, 'startTime');
    const endTime = str(obj, 'endTime');
    if (startTime !== undefined && endTime !== undefined && timeToMinutes(endTime) <= timeToMinutes(startTime)) {
      err(
        ctx,
        `${path}.endTime`,
        'end-time-before-start',
        `endTime (${endTime}) must be later than startTime (${startTime}). ${what} cannot cross midnight; use "24:00" for midnight at the end of the day.`,
      );
    }
    const recurrence = obj && get(obj, 'recurrence');
    if (isPlainObject(recurrence)) {
      const startDate = str(recurrence, 'startDate');
      const endDate = str(recurrence, 'endDate');
      if (startDate !== undefined && endDate !== undefined && endDate < startDate) {
        err(ctx, `${path}.recurrence.endDate`, 'end-date-before-start', `The recurrence endDate (${endDate}) is before its startDate (${startDate}).`);
      }
    }
  };
  list(doc.events).forEach((e, i) => {
    if (!e) return;
    checkTimes(e, `events[${i}]`, 'Events');
    const date = str(e, 'date');
    const endDate = str(e, 'endDate');
    if (date !== undefined && endDate !== undefined && endDate < date) {
      err(ctx, `events[${i}].endDate`, 'end-date-before-start', `endDate (${endDate}) is before date (${date}).`);
    }
  });
  list(doc.availability).forEach((w, i) => checkTimes(w, `availability[${i}]`, 'Study-time windows'));

  // Rules 21–23: date order and estimates.
  list(doc.assignments).forEach((a, i) => {
    if (!a) return;
    const path = `assignments[${i}]`;
    const due = str(a, 'due');
    const assessment = str(a, 'assessmentDate');
    const rcd = str(a, 'recommendedCompletionDate');
    if (rcd !== undefined) {
      if (due !== undefined) {
        if (compareDateValues(rcd, due) > 0) {
          err(ctx, `${path}.recommendedCompletionDate`, 'date-order', `recommendedCompletionDate (${rcd}) is later than due (${due}); it is a target before the deadline.`);
        }
      } else if (assessment !== undefined && compareDateValues(rcd, assessment) > 0) {
        err(
          ctx,
          `${path}.recommendedCompletionDate`,
          'date-order',
          `recommendedCompletionDate (${rcd}) is later than assessmentDate (${assessment}); it is a target before the assessment.`,
        );
      }
    }
    checkEstimate(a, path, ctx);
    list(get(a, 'tasks')).forEach((t, j) => {
      if (!t) return;
      const tp = `${path}.tasks[${j}]`;
      checkEstimate(t, tp, ctx);
      const start = str(t, 'recommendedStartDate');
      const done = str(t, 'recommendedCompletionDate');
      const taskDue = str(t, 'due');
      if (start !== undefined && done !== undefined && compareDateValues(start, done) > 0) {
        err(ctx, `${tp}.recommendedStartDate`, 'date-order', `recommendedStartDate (${start}) is later than recommendedCompletionDate (${done}).`);
      }
      if (done !== undefined && taskDue !== undefined && compareDateValues(done, taskDue) > 0) {
        err(ctx, `${tp}.recommendedCompletionDate`, 'date-order', `recommendedCompletionDate (${done}) is later than the task's due (${taskDue}).`);
      }
      if (start !== undefined && taskDue !== undefined && compareDateValues(start, taskDue) > 0) {
        err(ctx, `${tp}.recommendedStartDate`, 'date-order', `recommendedStartDate (${start}) is later than the task's due (${taskDue}).`);
      }
      const taskDueTooLate = taskDue !== undefined && due !== undefined && compareDateValues(taskDue, due) > 0;
      if (taskDueTooLate) {
        err(ctx, `${tp}.due`, 'task-due-after-assignment-due', `The task's due (${taskDue}) is later than the assignment's due (${due}).`);
      }
      // Each task date ≤ the assignment's due or assessmentDate (the later of
      // the two when both exist), i.e. not later than both of them.
      const limits = [due, assessment].filter((x): x is string => x !== undefined);
      if (limits.length > 0) {
        const limitText =
          limits.length === 2
            ? `both the assignment's due (${due}) and its assessmentDate (${assessment})`
            : due !== undefined
              ? `the assignment's due (${due})`
              : `the assignment's assessmentDate (${assessment})`;
        for (const [key, value] of [
          ['recommendedStartDate', start],
          ['recommendedCompletionDate', done],
          ['due', taskDue],
        ] as const) {
          if (value === undefined || (key === 'due' && taskDueTooLate)) continue;
          if (limits.every((limit) => compareDateValues(value, limit) > 0)) {
            err(ctx, `${tp}.${key}`, 'task-after-assignment', `The task's ${key} (${value}) is later than ${limitText}.`);
          }
        }
      }
    });
  });

  // Rule 24: settings, after defaults are applied.
  const rawSettings = get(rawRoot, 'settings');
  const settings = doc.settings;
  if (isPlainObject(rawSettings) && settings) {
    const usable = (key: string) => !has(rawSettings, key) || has(settings, key);
    const resolved = resolveSettings(settings as Settings);
    if (usable('dayStartTime') && usable('dayEndTime') && timeToMinutes(resolved.dayEndTime) <= timeToMinutes(resolved.dayStartTime)) {
      const path = has(settings, 'dayEndTime') ? 'settings.dayEndTime' : 'settings.dayStartTime';
      err(
        ctx,
        path,
        'settings-day-times',
        `dayEndTime (${resolved.dayEndTime}${has(settings, 'dayEndTime') ? '' : ', the default'}) must be later than dayStartTime (${resolved.dayStartTime}${has(settings, 'dayStartTime') ? '' : ', the default'}).`,
      );
    }
    if (usable('minSessionMinutes') && usable('maxSessionMinutes') && resolved.maxSessionMinutes < resolved.minSessionMinutes) {
      const path = has(settings, 'maxSessionMinutes') ? 'settings.maxSessionMinutes' : 'settings.minSessionMinutes';
      err(
        ctx,
        path,
        'settings-session-length',
        `maxSessionMinutes (${resolved.maxSessionMinutes}${has(settings, 'maxSessionMinutes') ? '' : ', the default'}) must be at least minSessionMinutes (${resolved.minSessionMinutes}${has(settings, 'minSessionMinutes') ? '' : ', the default'}).`,
      );
    }
  }
}

/** Rule 23: min ≤ max and min ≤ estimatedMinutes ≤ max. */
function checkEstimate(obj: Obj, path: string, ctx: Ctx): void {
  const range = get(obj, 'estimateRange');
  if (!isPlainObject(range)) return;
  const min = num(range, 'min');
  const max = num(range, 'max');
  if (min === undefined || max === undefined) return;
  if (min > max) {
    err(ctx, `${path}.estimateRange`, 'estimate-range-order', `estimateRange.min (${min}) is greater than estimateRange.max (${max}).`);
    return;
  }
  const estimate = num(obj, 'estimatedMinutes');
  if (estimate !== undefined && (estimate < min || estimate > max)) {
    err(ctx, `${path}.estimatedMinutes`, 'estimate-outside-range', `estimatedMinutes (${estimate}) is outside its estimateRange (${min}–${max}).`);
  }
}

/** Rule 18: report each dependency cycle once (Tarjan's algorithm, iterative). */
function reportCycles(
  ctx: Ctx,
  nodes: Array<{ id: string | undefined; path: string; deps: Array<string | undefined> }>,
  known: Set<string>,
  what: 'assignments' | 'tasks',
): void {
  const pathOf = new Map<string, string>();
  const edges = new Map<string, string[]>();
  const order: string[] = [];
  for (const node of nodes) {
    if (node.id === undefined || pathOf.has(node.id)) continue;
    pathOf.set(node.id, node.path);
    order.push(node.id);
    edges.set(
      node.id,
      node.deps.filter((d): d is string => d !== undefined && d !== node.id && known.has(d)),
    );
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let counter = 0;
  const components: string[][] = [];
  for (const root of order) {
    if (index.has(root)) continue;
    const frames: Array<{ node: string; next: number }> = [];
    const visit = (node: string) => {
      index.set(node, counter);
      low.set(node, counter);
      counter++;
      stack.push(node);
      onStack.add(node);
      frames.push({ node, next: 0 });
    };
    visit(root);
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const succ = edges.get(frame.node) ?? [];
      if (frame.next < succ.length) {
        const w = succ[frame.next++];
        if (!index.has(w)) visit(w);
        else if (onStack.has(w)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(w)!));
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].node;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.node)!));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          component.push(w);
        } while (w !== frame.node);
        if (component.length > 1) components.push(component);
      }
    }
  }
  const position = new Map(order.map((id, i) => [id, i]));
  for (const component of components) {
    component.sort((a, b) => position.get(a)! - position.get(b)!);
    const names = component.map((id) => `"${id}"`).join(', ');
    err(
      ctx,
      `${pathOf.get(component[0])}.dependsOn`,
      'dependency-cycle',
      `These ${what} depend on each other in a cycle: ${names}. "dependsOn" must not form a cycle.`,
    );
  }
}

// ===========================================================================
// Warnings (§ 13.4)
// ===========================================================================

function resolveToday(today: string | undefined): DateStr {
  return today !== undefined && isValidDate(today) ? today : todayLocal();
}

/** True if `rule` produces an occurrence on `date` (§ 10, conditions 1–4). */
function occursOn(rule: Obj, date: DateStr): boolean {
  const startDate = str(rule, 'startDate');
  if (startDate === undefined || date < startDate) return false;
  const endDate = str(rule, 'endDate');
  if (endDate !== undefined && date > endDate) return false;
  const days = strList(rule, 'daysOfWeek');
  if (!days.includes(weekdayOf(date))) return false;
  if (strList(rule, 'exceptDates').includes(date)) return false;
  const interval = num(rule, 'interval') ?? 1;
  const weeks = (dayNumber(mondayOf(date)) - dayNumber(mondayOf(startDate))) / 7;
  return weeks % interval === 0;
}

/** True if the recurrence can never occur (only possible with an endDate). */
function neverOccurs(rule: Obj): boolean {
  const startDate = str(rule, 'startDate');
  const endDate = str(rule, 'endDate');
  if (startDate === undefined || endDate === undefined) return false;
  if (endDate < startDate) return false; // already an error
  const interval = num(rule, 'interval') ?? 1;
  const offsets = strList(rule, 'daysOfWeek')
    .map((d) => WEEKDAYS.indexOf(d as Weekday))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);
  if (offsets.length === 0) return false; // already an error
  const except = new Set(strList(rule, 'exceptDates'));
  const first = dayNumber(startDate);
  const last = dayNumber(endDate);
  for (let week = dayNumber(mondayOf(startDate)); week <= last; week += 7 * interval) {
    for (const offset of offsets) {
      const n = week + offset;
      if (n < first || n > last) continue;
      if (!except.has(dateFromDayNumber(n))) return false;
    }
  }
  return true;
}

function eventOccursOn(event: Obj, date: DateStr): boolean {
  const recurrence = get(event, 'recurrence');
  if (isPlainObject(recurrence)) return occursOn(recurrence, date);
  const start = str(event, 'date');
  if (start === undefined) return false;
  const end = get(event, 'allDay') === true ? (str(event, 'endDate') ?? start) : start;
  return date >= start && date <= end;
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function isKnownTimeZone(name: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(name)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function collectWarnings(doc: PartialDoc, ctx: Ctx, today: DateStr): void {
  const settings = resolveSettings(doc.settings as Settings | undefined);
  const assignmentsById = new Map<string, Obj>();
  const tasksById = new Map<string, Obj>();
  for (const a of list(doc.assignments)) {
    const id = str(a, 'id');
    if (!a || id === undefined) continue;
    if (!assignmentsById.has(id)) assignmentsById.set(id, a);
    for (const t of list(get(a, 'tasks'))) {
      const tid = str(t, 'id');
      if (t && tid !== undefined && !tasksById.has(tid)) tasksById.set(tid, t);
    }
  }

  interface BlockInfo {
    index: number;
    path: string;
    date: DateStr;
    start: number; // minutes of the day
    end: number; // minutes of the day (1440 = next midnight)
    status: string;
    work: boolean;
    planLike: boolean; // generated/planner and unlocked
    label: string;
  }
  const blocks: BlockInfo[] = [];
  list(doc.scheduleBlocks).forEach((b, i) => {
    const start = str(b, 'start');
    const end = str(b, 'end');
    if (!b || start === undefined || end === undefined) return;
    const startAbs = ldtToMinutes(start);
    const endAbs = ldtToMinutes(end);
    const date = dateOf(start);
    const dayStart = dayNumber(date) * 1440;
    if (endAbs <= startAbs || endAbs - dayStart > 1440) return; // invalid; already an error
    const assignmentId = str(b, 'assignmentId');
    const assignment = assignmentId !== undefined ? assignmentsById.get(assignmentId) : undefined;
    const origin = str(b, 'origin') ?? 'generated';
    blocks.push({
      index: i,
      path: `scheduleBlocks[${i}]`,
      date,
      start: startAbs - dayStart,
      end: endAbs - dayStart,
      status: str(b, 'status') ?? 'planned',
      work: (str(b, 'kind') ?? 'work') === 'work',
      planLike: origin !== 'user' && get(b, 'locked') !== true,
      label: str(b, 'title') ?? str(assignment, 'title') ?? assignmentId ?? 'block',
    });

    // Deadlines (planned blocks only: done/skipped blocks are history).
    if ((str(b, 'status') ?? 'planned') !== 'planned') return;
    if (assignment) {
      const due = str(assignment, 'due');
      if (due !== undefined && endAbs > ldtToMinutes(dueMoment(due, settings.defaultDueTime))) {
        warn(
          ctx,
          `scheduleBlocks[${i}].end`,
          'block-after-due',
          `This block ends after "${str(assignment, 'title') ?? assignmentId}" is due (${due}${isDateOnly(due) ? `, planned as ${settings.defaultDueTime} that day` : ''}).`,
        );
      }
      const assessment = str(assignment, 'assessmentDate');
      if (assessment !== undefined && endAbs > ldtToMinutes(startOfDayMoment(assessment))) {
        warn(
          ctx,
          `scheduleBlocks[${i}].end`,
          'block-after-assessment',
          `This preparation block ends after the assessment "${str(assignment, 'title') ?? assignmentId}" (${assessment}${isDateOnly(assessment) ? ', i.e. 00:00 that day' : ''}).`,
        );
      }
    }
    const taskId = str(b, 'taskId');
    const task = taskId !== undefined ? tasksById.get(taskId) : undefined;
    const taskDue = str(task, 'due');
    if (taskDue !== undefined && endAbs > ldtToMinutes(dueMoment(taskDue, settings.defaultDueTime))) {
      warn(
        ctx,
        `scheduleBlocks[${i}].end`,
        'block-after-task-due',
        `This block ends after its task "${str(task, 'title') ?? taskId}" is due (${taskDue}${isDateOnly(taskDue) ? `, planned as ${settings.defaultDueTime} that day` : ''}).`,
      );
    }
  });

  // Overlaps: blocks with blocks, blocks with busy events (skipped blocks did not happen).
  const byDate = new Map<DateStr, BlockInfo[]>();
  for (const block of blocks) {
    if (block.status === 'skipped') continue;
    const day = byDate.get(block.date);
    if (day) day.push(block);
    else byDate.set(block.date, [block]);
  }
  const busyEvents = list(doc.events).flatMap((e, i) => (e && get(e, 'busy') !== false ? [{ e, i }] : []));
  for (const [date, day] of byDate) {
    const sorted = [...day].sort((a, b) => a.start - b.start || a.index - b.index);
    const active: BlockInfo[] = [];
    for (const block of sorted) {
      for (let k = active.length - 1; k >= 0; k--) if (active[k].end <= block.start) active.splice(k, 1);
      for (const other of active) {
        const [first, second] = other.index < block.index ? [other, block] : [block, other];
        warn(
          ctx,
          second.path,
          'block-overlap',
          `Overlaps ${first.path} ("${first.label}", ${hhmm(first.start)}–${hhmm(first.end)}) on ${date}.`,
        );
      }
      active.push(block);
    }
    for (const { e, i } of busyEvents) {
      if (!eventOccursOn(e, date)) continue;
      const allDay = get(e, 'allDay') === true;
      const startTime = str(e, 'startTime');
      const endTime = str(e, 'endTime');
      if (!allDay && (startTime === undefined || endTime === undefined)) continue;
      const evStart = allDay ? 0 : timeToMinutes(startTime!);
      const evEnd = allDay ? 1440 : timeToMinutes(endTime!);
      for (const block of sorted) {
        if (block.start < evEnd && block.end > evStart) {
          warn(
            ctx,
            block.path,
            'block-overlaps-event',
            `Overlaps the busy event "${str(e, 'title') ?? `events[${i}]`}" (${allDay ? 'all day' : `${startTime}–${endTime}`}) on ${date}.`,
          );
        }
      }
    }
  }

  // Session settings: generated/planner, unlocked, planned work blocks only (§ 5, § 12.2).
  for (const block of blocks) {
    if (!block.work || !block.planLike || block.status !== 'planned') continue;
    const length = block.end - block.start;
    if (length < settings.minSessionMinutes) {
      warn(ctx, block.path, 'session-too-short', `This planned session lasts ${formatDuration(length)}, less than minSessionMinutes (${settings.minSessionMinutes}).`);
    } else if (length > settings.maxSessionMinutes) {
      warn(ctx, block.path, 'session-too-long', `This planned session lasts ${formatDuration(length)}, more than maxSessionMinutes (${settings.maxSessionMinutes}).`);
    }
  }
  if (settings.maxDailyStudyMinutes !== null) {
    const limit = settings.maxDailyStudyMinutes;
    const totals = new Map<DateStr, { minutes: number; firstPlanLike?: BlockInfo }>();
    for (const block of blocks) {
      if (!block.work || block.status === 'skipped') continue;
      const entry = totals.get(block.date) ?? { minutes: 0 };
      entry.minutes += block.end - block.start;
      if (block.planLike && block.status === 'planned' && !entry.firstPlanLike) entry.firstPlanLike = block;
      totals.set(block.date, entry);
    }
    for (const [date, entry] of totals) {
      if (entry.minutes > limit && entry.firstPlanLike) {
        warn(
          ctx,
          entry.firstPlanLike.path,
          'daily-limit',
          `${date} has ${formatDuration(entry.minutes)} of scheduled work, more than maxDailyStudyMinutes (${formatDuration(limit)}).`,
        );
      }
    }
  }

  // Recurrences that never occur.
  const checkRecurrence = (obj: Obj | undefined, path: string) => {
    const recurrence = obj && get(obj, 'recurrence');
    if (isPlainObject(recurrence) && neverOccurs(recurrence)) {
      warn(ctx, `${path}.recurrence`, 'recurrence-never-occurs', 'This recurrence never occurs (no matching day between startDate and endDate that is not an exception).');
    }
  };
  list(doc.events).forEach((e, i) => checkRecurrence(e, `events[${i}]`));
  list(doc.availability).forEach((w, i) => checkRecurrence(w, `availability[${i}]`));

  // Dates more than 5 years away from today.
  const year = Number(today.slice(0, 4));
  const rest = today.slice(4);
  const lower = `${String(year - 5).padStart(4, '0')}${rest}`;
  const upper = `${String(year + 5).padStart(4, '0')}${rest}`;
  for (const { path, date } of ctx.dates) {
    if (date < lower || date > upper) {
      warn(ctx, path, 'far-date', `${date} is more than 5 years from today (${today}). Check the year.`);
    }
  }

  // overrides on user items (ignored).
  for (const info of enumerateItems(doc)) {
    const overrides = get(info.item, 'overrides');
    if (str(info.item, 'origin') === 'user' && Array.isArray(overrides) && overrides.length > 0) {
      warn(ctx, `${info.path}.overrides`, 'overrides-on-user-item', '"overrides" has no effect on an item the person created (origin "user"); it is ignored.');
    }
  }

  // meta.timezone must be an IANA name.
  const timezone = str(doc.meta, 'timezone');
  if (timezone !== undefined && !isKnownTimeZone(timezone)) {
    warn(ctx, 'meta.timezone', 'unknown-timezone', `${show(timezone)} is not a known IANA time-zone name (for example "America/New_York").`);
  }
}

// ===========================================================================
// JSON syntax errors with line and column
// ===========================================================================

interface JsonErrorLocation {
  message: string;
  line: number;
  column: number;
}

class JsonSyntax extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

/**
 * Find the first JSON syntax error in `text` (which JSON.parse rejected) and
 * describe it in plain language. Works the same in every browser (engine
 * error messages differ). Falls back to the engine's message.
 */
export function locateJsonError(text: string, engineError?: unknown): JsonErrorLocation {
  let offset: number | undefined;
  let message: string | undefined;
  try {
    scanJson(text);
  } catch (e) {
    if (e instanceof JsonSyntax) {
      offset = e.offset;
      message = e.message;
    }
  }
  if (offset === undefined || message === undefined) {
    const raw = engineError instanceof Error ? engineError.message : 'syntax error';
    const pos = /position (\d+)/.exec(raw);
    offset = pos ? Number(pos[1]) : text.length;
    message = raw.replace(/\s*in JSON at position \d+.*$/, '').replace(/^JSON\.parse:\s*/, '') || 'syntax error';
  }
  return { message, ...lineAndColumn(text, offset) };
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: codePointLength(text.slice(lineStart, end)) + 1 };
}

function scanJson(text: string): void {
  const n = text.length;
  let i = 0;
  const ws = () => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const fail = (message: string, at = i): never => {
    throw new JsonSyntax(message, at);
  };
  const unexpected = (context: string): never => {
    if (i >= n) return fail(`the text ends too early (${context})`, n);
    const ch = text[i];
    if (ch === "'") fail('text and property names must use double quotes ("), not single quotes');
    if (ch === '/') fail('comments are not allowed in JSON');
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 40));
    if (word) fail(`unexpected word "${word[0]}" (${context}; values are true, false, null, numbers, or text in double quotes)`);
    return fail(`unexpected character ${JSON.stringify(ch)} (${context})`);
  };
  const readString = () => {
    const start = i;
    i++; // opening quote
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        i++;
        return;
      }
      if (c === 92) {
        const next = text[i + 1];
        if (next === undefined) break;
        if ('"\\/bfnrt'.includes(next)) i += 2;
        else if (next === 'u') {
          if (!/^[0-9A-Fa-f]{4}$/.test(text.slice(i + 2, i + 6))) fail('invalid \\u escape in text (it needs four hexadecimal digits)');
          i += 6;
        } else fail(`invalid escape "\\${next}" in text`);
        continue;
      }
      if (c < 32) fail('line breaks and control characters must be escaped inside text (e.g. \\n)');
      i++;
    }
    fail('a text value is not closed (a closing " is missing)', start);
  };
  const readNumber = () => {
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(text.slice(i, i + 400));
    if (!m) return fail('invalid number');
    const after = text[i + m[0].length];
    if (after !== undefined && /[0-9.eE+\-A-Za-z]/.test(after)) fail('invalid number (no leading zeros, "+" signs, "NaN" or "Infinity")');
    i += m[0].length;
  };
  const readKey = () => {
    ws();
    if (i >= n) fail('the text ends too early (a closing } is missing)', n);
    if (text[i] === '}') fail('trailing comma before }: remove the last comma');
    if (text[i] !== '"') unexpected('expected a property name in double quotes');
    readString();
    ws();
    if (i >= n) fail('the text ends too early (":" and a value are missing)', n);
    if (text[i] !== ':') fail('expected ":" after the property name');
    i++;
  };

  // A small state machine with an explicit stack, so deep nesting cannot
  // overflow the call stack.
  const stack: Array<'object' | 'array'> = [];
  let expectValue = true;
  for (;;) {
    if (expectValue) {
      ws();
      if (i >= n) fail('the text ends too early (a value is missing)', n);
      const ch = text[i];
      if (ch === '{') {
        i++;
        ws();
        if (text[i] === '}') {
          i++;
          expectValue = false;
        } else {
          stack.push('object');
          readKey();
        }
      } else if (ch === '[') {
        i++;
        ws();
        if (text[i] === ']') {
          i++;
          expectValue = false;
        } else stack.push('array');
      } else if (ch === '"') {
        readString();
        expectValue = false;
      } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
        readNumber();
        expectValue = false;
      } else {
        const literal = ['true', 'false', 'null'].find((word) => text.startsWith(word, i) && !/[A-Za-z0-9_]/.test(text[i + word.length] ?? ''));
        if (!literal) unexpected('expected a value');
        i += literal!.length;
        expectValue = false;
      }
      continue;
    }
    if (stack.length === 0) break;
    const top = stack[stack.length - 1];
    ws();
    if (i >= n) fail(`the text ends too early (a closing ${top === 'object' ? '}' : ']'} is missing)`, n);
    const ch = text[i];
    if (ch === ',') {
      i++;
      if (top === 'object') readKey();
      else {
        ws();
        if (text[i] === ']') fail('trailing comma before ]: remove the last comma');
      }
      expectValue = true;
    } else if ((top === 'object' && ch === '}') || (top === 'array' && ch === ']')) {
      i++;
      stack.pop();
    } else if (top === 'object') unexpected('expected "," or "}" after a value; is a comma missing?');
    else unexpected('expected "," or "]" after an array element; is a comma missing?');
  }
  ws();
  if (i < n) fail('unexpected text after the end of the JSON value');
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}
