// Enumerations, defaults and display labels of schedule format 1.0.
import type {
  AssignmentType,
  BlockStatus,
  CollectionName,
  Confidence,
  EventCategory,
  IssueKind,
  IssueStatus,
  Priority,
  ReferenceKind,
  ResolvedSettings,
  Settings,
  SourceKind,
  SourceState,
  Weekday,
  WorkStatus,
} from './types';

export const SCHEMA_VERSION = '1.0' as const;
export const SUPPORTED_MAJOR = 1;
export const SUPPORTED_MINOR = 0;
export const APP_NAME = 'Academic Scheduler';
export const APP_VERSION = '1.0.0';
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const USER_ID_PREFIX = 'u-';

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};
export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export const WORK_STATUSES: WorkStatus[] = ['not_started', 'in_progress', 'done', 'cancelled'];
export const WORK_STATUS_LABELS: Record<WorkStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const BLOCK_STATUSES: BlockStatus[] = ['planned', 'done', 'skipped'];
export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  planned: 'Planned',
  done: 'Done',
  skipped: 'Skipped',
};

export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const ASSIGNMENT_TYPES: AssignmentType[] = [
  'homework',
  'reading',
  'writing',
  'problem_set',
  'lab',
  'project',
  'presentation',
  'quiz',
  'test',
  'exam',
  'study',
  'other',
];
export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  homework: 'Homework',
  reading: 'Reading',
  writing: 'Writing',
  problem_set: 'Problem set',
  lab: 'Lab',
  project: 'Project',
  presentation: 'Presentation',
  quiz: 'Quiz',
  test: 'Test',
  exam: 'Exam',
  study: 'Study',
  other: 'Other',
};
/** Types whose key date is when they take place (assessmentDate). */
export const ASSESSMENT_TYPES: AssignmentType[] = ['quiz', 'test', 'exam', 'presentation'];

export const EVENT_CATEGORIES: EventCategory[] = ['school', 'class', 'activity', 'appointment', 'work', 'personal', 'other'];
export const EVENT_CATEGORY_LABELS: Record<EventCategory, string> = {
  school: 'School',
  class: 'Class',
  activity: 'Activity',
  appointment: 'Appointment',
  work: 'Work',
  personal: 'Personal',
  other: 'Other',
};

export const ISSUE_KINDS: IssueKind[] = ['ambiguity', 'conflict', 'missing_information', 'workload', 'other'];
export const ISSUE_KIND_LABELS: Record<IssueKind, string> = {
  ambiguity: 'Ambiguous',
  conflict: 'Conflict',
  missing_information: 'Missing information',
  workload: 'Workload',
  other: 'Note',
};
export const SOURCE_KINDS: SourceKind[] = ['google_classroom', 'syllabus', 'calendar', 'document', 'user', 'schedule', 'other'];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  google_classroom: 'Google Classroom',
  syllabus: 'Syllabus',
  calendar: 'Calendar',
  document: 'Document',
  user: 'You',
  schedule: 'Schedule file',
  other: 'Other',
};
export const SOURCE_STATE_LABELS: Record<SourceState, string> = {
  present: 'In source',
  missing: 'No longer in source',
  withdrawn: 'Withdrawn by teacher',
};
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};
export const MAX_TOMBSTONES = 5000;
/** Fields the person can never "override" (they are person-owned or structural). */
export const NON_OVERRIDABLE_FIELDS = ['id', 'origin', 'locked', 'overrides', 'issues', 'source', 'sources', 'notes', 'status', 'completedAt'];
export const REFERENCE_KINDS: ReferenceKind[] = ['attachment', 'link', 'reading', 'rubric', 'template', 'other'];
export const CONFIDENCES: Confidence[] = ['low', 'medium', 'high'];

export const COLLECTIONS: CollectionName[] = ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'];
export const COLLECTION_LABELS: Record<CollectionName, { one: string; many: string }> = {
  classes: { one: 'class', many: 'classes' },
  assignments: { one: 'assignment', many: 'assignments' },
  events: { one: 'event', many: 'events' },
  availability: { one: 'study-time window', many: 'study-time windows' },
  scheduleBlocks: { one: 'scheduled work block', many: 'scheduled work blocks' },
};

export const DEFAULT_SETTINGS: ResolvedSettings = {
  weekStartsOn: 'monday',
  dayStartTime: '07:00',
  dayEndTime: '22:00',
  defaultDueTime: '00:00',
  minSessionMinutes: 20,
  maxSessionMinutes: 60,
  breakMinutes: 10,
  maxDailyStudyMinutes: null,
};

export function resolveSettings(settings: Settings | undefined): ResolvedSettings {
  const s = settings || {};
  return {
    weekStartsOn: s.weekStartsOn ?? DEFAULT_SETTINGS.weekStartsOn,
    dayStartTime: s.dayStartTime ?? DEFAULT_SETTINGS.dayStartTime,
    dayEndTime: s.dayEndTime ?? DEFAULT_SETTINGS.dayEndTime,
    defaultDueTime: s.defaultDueTime ?? DEFAULT_SETTINGS.defaultDueTime,
    minSessionMinutes: s.minSessionMinutes ?? DEFAULT_SETTINGS.minSessionMinutes,
    maxSessionMinutes: s.maxSessionMinutes ?? DEFAULT_SETTINGS.maxSessionMinutes,
    breakMinutes: s.breakMinutes ?? DEFAULT_SETTINGS.breakMinutes,
    maxDailyStudyMinutes: s.maxDailyStudyMinutes ?? null,
  };
}

/** Palette for classes without a color (assigned in order, then reused). */
export const CLASS_PALETTE = [
  '#2563EB', // blue
  '#16A34A', // green
  '#DC2626', // red
  '#9333EA', // purple
  '#EA580C', // orange
  '#0891B2', // cyan
  '#DB2777', // pink
  '#65A30D', // lime
  '#CA8A04', // amber
  '#4F46E5', // indigo
  '#0D9488', // teal
  '#7C3AED', // violet
];
export const NO_CLASS_COLOR = '#64748B';
