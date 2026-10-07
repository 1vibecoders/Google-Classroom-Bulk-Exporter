// Types for schedule format 1.0 (SCHEDULE_FORMAT.md). The website keeps its
// whole state in exactly this shape, so what is shown, stored, imported and
// exported can never drift apart.
//
// String aliases document the expected formats; values are validated by
// src/lib/validate.ts before they enter the store.

/** `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$` — unique across the whole document. */
export type Id = string;
/** `YYYY-MM-DD` */
export type DateStr = string;
/** `HH:MM` (24-hour). `24:00` is allowed only as an end time (end of day). */
export type TimeStr = string;
/** `YYYY-MM-DDTHH:MM[:SS]`, local wall-clock time, no offset. */
export type LocalDateTimeStr = string;
/** A DateStr or a LocalDateTimeStr. */
export type DateOrDateTimeStr = string;
/** `#RRGGBB` */
export type ColorStr = string;

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** `planner` = placed by the website's deterministic planner (schedule blocks only). */
export type Origin = 'user' | 'generated' | 'planner';
export type WorkStatus = 'not_started' | 'in_progress' | 'done' | 'cancelled';
export type BlockStatus = 'planned' | 'done' | 'skipped';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type AssignmentType =
  | 'homework'
  | 'reading'
  | 'writing'
  | 'problem_set'
  | 'lab'
  | 'project'
  | 'presentation'
  | 'quiz'
  | 'test'
  | 'exam'
  | 'study'
  | 'other';
export type EventCategory = 'school' | 'class' | 'activity' | 'appointment' | 'work' | 'personal' | 'other';
export type IssueKind = 'ambiguity' | 'conflict' | 'missing_information' | 'workload' | 'other';
export type SourceKind = 'google_classroom' | 'syllabus' | 'calendar' | 'document' | 'image' | 'user' | 'schedule' | 'other';
export type ReferenceKind = 'attachment' | 'link' | 'reading' | 'rubric' | 'template' | 'other';
export type Confidence = 'low' | 'medium' | 'high';
export type BlockKind = 'work' | 'break';
export type SourceState = 'present' | 'missing' | 'withdrawn';
export type IssueStatus = 'open' | 'resolved' | 'dismissed';

/** `x-…` extension properties: preserved untouched, never interpreted. */
export type Extensions = { [key: `x-${string}`]: unknown };

export interface Issue {
  /** Stable id so a resolved/dismissed issue is not raised again. */
  id?: Id;
  kind: IssueKind;
  message: string;
  field?: string;
  /** Person-owned; default `open`. */
  status?: IssueStatus;
  /** Root issues only: the item the issue is about. */
  itemId?: Id;
  /** The day the issue concerns (shown in that day's view). */
  date?: DateStr;
}

export interface Source {
  kind: SourceKind;
  id?: string;
  url?: string;
  path?: string;
  label?: string;
  /** When the source was captured (local wall-clock time). */
  retrievedAt?: LocalDateTimeStr;
}

export interface EstimateRange {
  min: number;
  max: number;
}

/** Fields shared by every item (§ 6). */
export interface ItemBase {
  id: Id;
  origin?: Origin;
  /** The person pinned the item (or moved/resized a generated block). */
  locked?: boolean;
  /** Fields of a generated/planner item that the person changed (§ 6). */
  overrides?: string[];
  source?: Source;
  /** Additional sources besides the primary `source`. */
  sources?: Source[];
  issues?: Issue[];
}

export interface SchoolClass extends ItemBase {
  name: string;
  teacher?: string;
  section?: string;
  room?: string;
  color?: ColorStr;
  description?: string;
  archived?: boolean;
  topics?: string[];
  /** Class materials that are not work (syllabus, unit notes, slides). */
  references?: Reference[];
}

export interface Reference {
  title: string;
  url?: string;
  path?: string;
  kind?: ReferenceKind;
  required?: boolean;
}

export interface Task extends Omit<ItemBase, 'source' | 'sources'> {
  title: string;
  description?: string;
  notes?: string;
  estimatedMinutes?: number;
  estimateRange?: EstimateRange;
  status?: WorkStatus;
  completedAt?: LocalDateTimeStr;
  dependsOn?: Id[];
  recommendedStartDate?: DateStr;
  recommendedCompletionDate?: DateOrDateTimeStr;
  /** Hard checkpoint deadline (≤ the assignment's due). */
  due?: DateOrDateTimeStr;
  required?: boolean;
}

export interface Assignment extends ItemBase {
  title: string;
  classId?: Id;
  type?: AssignmentType;
  topic?: string;
  description?: string;
  notes?: string;
  due?: DateOrDateTimeStr;
  assessmentDate?: DateOrDateTimeStr;
  recommendedCompletionDate?: DateOrDateTimeStr;
  estimatedMinutes?: number;
  estimateRange?: EstimateRange;
  estimateConfidence?: Confidence;
  estimateBasis?: string;
  priority?: Priority;
  status?: WorkStatus;
  completedAt?: LocalDateTimeStr;
  points?: string;
  required?: boolean;
  tasks?: Task[];
  references?: Reference[];
  dependsOn?: Id[];
  sourceState?: SourceState;
}

export interface Recurrence {
  frequency: 'weekly';
  daysOfWeek: Weekday[];
  interval?: number;
  startDate: DateStr;
  endDate?: DateStr;
  exceptDates?: DateStr[];
}

export interface ScheduleEvent extends ItemBase {
  title: string;
  category?: EventCategory;
  classId?: Id;
  date?: DateStr;
  endDate?: DateStr;
  recurrence?: Recurrence;
  allDay?: boolean;
  startTime?: TimeStr;
  endTime?: TimeStr;
  busy?: boolean;
  location?: string;
  notes?: string;
  /** This event is the sitting of that assessment. */
  assignmentId?: Id;
}

export interface AvailabilityWindow extends ItemBase {
  label?: string;
  date?: DateStr;
  recurrence?: Recurrence;
  startTime: TimeStr;
  endTime: TimeStr;
}

export interface ScheduleBlock extends ItemBase {
  start: LocalDateTimeStr;
  end: LocalDateTimeStr;
  assignmentId?: Id;
  taskId?: Id;
  title?: string;
  kind?: BlockKind;
  status?: BlockStatus;
  completedAt?: LocalDateTimeStr;
  /** Generator-owned: what to do in this session. */
  description?: string;
  /** Person-owned. */
  notes?: string;
}

export interface Settings {
  weekStartsOn?: 'monday' | 'sunday';
  dayStartTime?: TimeStr;
  dayEndTime?: TimeStr;
  defaultDueTime?: TimeStr;
  minSessionMinutes?: number;
  maxSessionMinutes?: number;
  breakMinutes?: number;
  maxDailyStudyMinutes?: number;
}

export interface Meta {
  title?: string;
  /** LocalDateTime in `timezone`. */
  generatedAt?: LocalDateTimeStr;
  /** Written fresh by the website on every export. */
  exportId?: Id;
  /** Generators: the exportId of the schedule this file was based on. */
  basedOn?: Id;
  generator?: { name: string; version?: string };
  timezone?: string;
  sources?: Source[];
  requestedChanges?: RequestedChange[];
}

/** A generator's change to a `user` or locked item (§ 15). */
export interface RequestedChange {
  id: Id;
  reason: string;
  requestedByPerson: boolean;
}

export type TombstoneCollection = CollectionName | 'tasks';

/** Record of a generated item the person deleted, so generators do not re-create it. */
export interface Tombstone {
  id: Id;
  collection: TombstoneCollection;
  deletedAt: LocalDateTimeStr;
  sourceId?: string;
  title?: string;
}

/** The whole schedule file / the whole application state. */
export interface ScheduleDocument {
  schemaVersion: '1.0';
  meta?: Meta;
  settings?: Settings;
  classes: SchoolClass[];
  assignments: Assignment[];
  events: ScheduleEvent[];
  availability: AvailabilityWindow[];
  scheduleBlocks: ScheduleBlock[];
  issues?: Issue[];
  deleted?: Tombstone[];
}

/** Collections that hold top-level items, in document order. */
export type CollectionName = 'classes' | 'assignments' | 'events' | 'availability' | 'scheduleBlocks';

/** Settings with every default applied. */
export type ResolvedSettings = Required<Omit<Settings, 'maxDailyStudyMinutes'>> & { maxDailyStudyMinutes: number | null };
