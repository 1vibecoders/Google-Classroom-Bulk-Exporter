// Deterministic work planner ("Plan unscheduled work"). Not AI: a fixed
// earliest-deadline-first algorithm over the free study time the person
// entered. It only proposes blocks; the person reviews them before they are
// added.
//
// The rule, step by step (also shown to the person, see describePlannerRules):
//
// 1. What to plan. For every assignment that counts (SCHEDULE_FORMAT.md § 8.1:
//    not done/cancelled, required or already planned, still in its source)
//    and has unscheduled minutes (§ 8.1), the unscheduled work is split into
//    "parts": one per task that still has unscheduled minutes (its remaining
//    work minus its planned future sessions), in dependency order, plus the
//    work not covered by tasks; without task estimates the whole
//    unscheduled amount is one part. The parts of an assignment never add up
//    to more than its unscheduled minutes. Assignments without an estimate,
//    or whose deadline has passed, are reported instead of planned.
// 2. Deadlines. A part must end by its hard deadline: the assignment's `due`
//    (a date-only due counts at settings.defaultDueTime), before the START of
//    the assessment day for an `assessmentDate`, and by the task's own `due`.
//    Soft targets (recommendedCompletionDate: by the end of that day;
//    a task's recommendedStartDate: not before that day) are honoured when
//    there is room.
// 3. Order. Parts are taken earliest hard deadline first (no deadline last),
//    then by priority (urgent → low), title and id; a part is only taken after
//    the parts it depends on (task dependsOn, assignment dependsOn), and its
//    sessions start after the end of their planned sessions.
// 4. Where. Free study time = availability − busy events (§ 11), minus
//    existing blocks (planned or done; skipped blocks free their time), with
//    settings.breakMinutes kept between work sessions, from `from` (rounded
//    up to 5 minutes) until the deadline and at most `horizonDays` ahead.
//    Each day's work (existing + new) stays within
//    settings.maxDailyStudyMinutes.
// 5. How. A part of N minutes needs k = ⌈N / maxSessionMinutes⌉ sessions.
//    When at least k days before its deadline still have room for it, the
//    sessions have equal length (N / k, rounded up to 5 minutes); otherwise
//    they are maxSessionMinutes long, which fits fragmented time better.
//    Sessions are never shorter than minSessionMinutes (small work is
//    rounded up to one minimum session). Each goes into the earliest slot where
//    it fits whole, in three passes: (a) at most one session per assignment
//    per day, within the soft targets; (b) at most one per assignment per day
//    up to the hard deadline — so larger work and test preparation are spread
//    over several days instead of being packed into one; (c) any free slot up
//    to the deadline, where a session may also be shortened to fit a slot
//    (never below minSessionMinutes, and never leaving a remainder shorter
//    than that).
// 6. Whatever does not fit is reported in `unplaced` with the reason.
//
// The same input always gives the same output (except for generated ids).
// With an empty `availability` (§ 11) nothing is planned.
import { resolveSettings } from '../model/constants';
import type { Assignment, DateOrDateTimeStr, Id, LocalDateTimeStr, ResolvedSettings, ScheduleBlock, ScheduleDocument, Task } from '../model/types';
import { freeTimeByDate, intersectIntervals, subtractIntervals, type Interval } from './calendar';
import { collectIds, newId } from './ids';
import {
  MINUTES_PER_DAY,
  dateFromDayNumber,
  dateOf,
  dayNumber,
  dueMoment,
  formatDateWithWeekday,
  formatDuration,
  formatTime12,
  isValidDate,
  isValidDateOrDateTime,
  isValidLocalDateTime,
  isValidTime,
  ldtToMinutes,
  minutesToLdt,
  startOfDayMoment,
  timeOf,
} from './time';
import { blockMinutes, blocksByAssignment, exclusionReason, progressByAssignment, taskRemainingMinutes } from './workload';

export interface PlanOptions {
  /** Plan only from this moment on (usually now, rounded up to 5 minutes). */
  from: LocalDateTimeStr;
  /** Only these assignments (default: all not done/cancelled with unscheduled work). */
  assignmentIds?: Id[];
  /** Do not plan beyond this many days after `from` (default 28). */
  horizonDays?: number;
}

export interface UnplacedWork {
  assignmentId: Id;
  /** The task the minutes belong to, when the work is a task's. */
  taskId?: Id;
  /** Minutes that could not be placed (0 when unknown, e.g. no estimate). */
  minutes: number;
  reason: string;
}

export interface PlanResult {
  /** New blocks (origin "planner", status "planned", ids `u-blk-…`), sorted by start. */
  blocks: ScheduleBlock[];
  unplaced: UnplacedWork[];
}

export const DEFAULT_HORIZON_DAYS = 28;

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** One piece of work to place: a task's unscheduled minutes, or an assignment's untasked work. */
interface Part {
  assignment: Assignment;
  task?: Task;
  minutes: number;
  /** Absolute minutes: sessions must end by this (Infinity = no deadline). */
  hardEnd: number;
  /** Assignment-level hard deadline (for sorting). */
  assignmentEnd: number;
  /** Preferred end (recommendedCompletionDate), ≤ hardEnd. */
  softEnd: number;
  /** Preferred earliest start (task recommendedStartDate), or -Infinity. */
  softStart: number;
  /** "the due time (Fri, Oct 16, 11:59 PM)" — what hardEnd is, for reasons. */
  deadlineText: string | null;
  /** Index among the parts of its assignment (task order). */
  order: number;
}

interface DayState {
  dayNum: number;
  /** Free study time (absolute minutes): availability − busy events. */
  free: Interval[];
  /** Minutes of non-skipped work blocks starting this day (existing + new). */
  load: number;
  /** Assignments with a non-skipped block this day (existing + new). */
  used: Set<Id>;
}

interface PlacedBlock {
  assignmentId: Id;
  taskId?: Id;
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const roundUp5 = (n: number) => Math.ceil(n / 5) * 5;
const roundDown5 = (n: number) => Math.floor(n / 5) * 5;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Fri, Oct 16, 11:59 PM" or "Fri, Oct 16". */
function describeMoment(value: DateOrDateTimeStr): string {
  const time = timeOf(value);
  const day = formatDateWithWeekday(dateOf(value));
  return time ? `${day}, ${formatTime12(time)}` : day;
}

function assessmentWord(a: Assignment): string {
  return a.type === 'quiz' || a.type === 'test' || a.type === 'exam' || a.type === 'presentation' ? a.type : 'assessment';
}

/** End of a soft target date: date-only → the end of that day; date-time → that moment. */
function softMoment(value: DateOrDateTimeStr | undefined): number {
  if (!value || !isValidDateOrDateTime(value)) return Number.POSITIVE_INFINITY;
  return timeOf(value) === null ? (dayNumber(value) + 1) * MINUTES_PER_DAY : ldtToMinutes(value);
}

interface Deadline {
  at: number;
  text: string;
  /** Why nothing can be planned once `at` is past, given the current time. */
  passedText: (now: number) => string;
}

/** The assignment's hard deadlines (§ 12.2), earliest first. */
function assignmentDeadlines(a: Assignment, dueTime: string): Deadline[] {
  const out: Deadline[] = [];
  if (a.due && isValidDateOrDateTime(a.due)) {
    const due = a.due;
    const dateOnly = timeOf(due) === null;
    const text = `the due ${dateOnly ? 'date' : 'time'} (${describeMoment(due)})`;
    out.push({
      at: ldtToMinutes(dueMoment(due, dueTime)),
      text,
      // A date-only due is planned at the default due time (§ 8), but the
      // assignment lists call it overdue only once its whole day is over, so
      // on the due day say why nothing can be planned instead of "has passed".
      passedText: (now) =>
        dateOnly && now < (dayNumber(due) + 1) * MINUTES_PER_DAY
          ? `It is due today (${describeMoment(due)}). A due date without a time is planned as due at ${formatTime12(dueTime)} on that day (Settings → Default due time), so no study time is left before it.`
          : `${capitalize(text)} has passed.`,
    });
  }
  if (a.assessmentDate && isValidDateOrDateTime(a.assessmentDate)) {
    const value = a.assessmentDate;
    const word = assessmentWord(a);
    out.push({
      at: ldtToMinutes(startOfDayMoment(dateOf(value))),
      text: `the ${word} on ${formatDateWithWeekday(dateOf(value))}`,
      // A date-only assessment has passed once its whole day is over.
      passedText: (now) =>
        now >= (timeOf(value) === null ? (dayNumber(value) + 1) * MINUTES_PER_DAY : ldtToMinutes(value))
          ? `The ${word} (${describeMoment(value)}) has passed.`
          : `The ${word} is today (${describeMoment(value)}); preparation is only planned on earlier days.`,
    });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** Tasks in array order, moved after their dependencies when needed (stable topological order). */
function tasksInDependencyOrder(tasks: Task[]): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const done = new Set<Id>();
  const pending = [...tasks];
  const out: Task[] = [];
  while (pending.length > 0) {
    let i = pending.findIndex((t) => (t.dependsOn || []).every((d) => !ids.has(d) || done.has(d)));
    if (i === -1) i = 0; // a cycle (invalid data): keep array order
    const [t] = pending.splice(i, 1);
    done.add(t.id);
    out.push(t);
  }
  return out;
}

function exclusionText(reason: ReturnType<typeof exclusionReason>): string {
  switch (reason) {
    case 'finished':
      return 'It is marked done or cancelled.';
    case 'optional':
      return 'It is optional and has no planned sessions, so it is not planned automatically.';
    case 'notInSource':
      return 'It is no longer in its source (missing or withdrawn), so it is not planned automatically.';
    default:
      return 'It is not planned automatically.';
  }
}

/** Plain-language summary of the planner's fixed rule, for the plan dialog. */
export function describePlannerRules(settings: ResolvedSettings, horizonDays = DEFAULT_HORIZON_DAYS): string[] {
  const lines = [
    'Earliest deadline first: work due soonest is placed first (then by priority).',
    'Only into your free study time: your study-time windows minus busy commitments and the work already on your calendar.',
    'Everything ends before its deadline; test and exam preparation ends before the day of the test.',
    `Sessions of ${settings.minSessionMinutes}–${settings.maxSessionMinutes} minutes with ${settings.breakMinutes}-minute breaks between them.`,
    'Larger work and test preparation are spread over several days (one session per assignment per day while there is room).',
    'Subtasks are planned in order: a step comes after the steps it depends on.',
  ];
  if (settings.maxDailyStudyMinutes !== null) lines.push(`At most ${formatDuration(settings.maxDailyStudyMinutes)} of work per day.`);
  lines.push(`Looks ${horizonDays} days ahead. Nothing you already planned is moved or changed.`);
  return lines;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export function planUnscheduledWork(doc: ScheduleDocument, options: PlanOptions): PlanResult {
  const settings = resolveSettings(doc.settings);
  const unplaced: UnplacedWork[] = [];
  if (!isValidLocalDateTime(options.from)) return { blocks: [], unplaced };

  // Session settings, made safe (multiples of 5, min ≤ max).
  const minSession = Math.max(5, roundUp5(Number(settings.minSessionMinutes) || 20));
  const maxSession = Math.max(minSession, roundDown5(Number(settings.maxSessionMinutes) || 60));
  const breakMinutes = Math.max(0, Number(settings.breakMinutes) || 0);
  const maxDaily = typeof settings.maxDailyStudyMinutes === 'number' ? Math.max(0, settings.maxDailyStudyMinutes) : null;
  const dueTime = isValidTime(settings.defaultDueTime) ? settings.defaultDueTime : '00:00';

  // `nowMin` decides which existing blocks are future (§ 8.1); `fromMin` is
  // where new sessions may start.
  const nowMin = ldtToMinutes(options.from);
  const fromMin = roundUp5(nowMin);
  const horizonDays = Math.max(1, Math.floor(options.horizonDays ?? DEFAULT_HORIZON_DAYS));
  const horizonEnd = fromMin + horizonDays * MINUTES_PER_DAY;
  const firstDay = Math.floor(fromMin / MINUTES_PER_DAY);
  const lastDay = Math.floor((horizonEnd - 1) / MINUTES_PER_DAY);

  const progress = progressByAssignment(doc, options.from);
  const blocksOf = blocksByAssignment(doc);
  const assignmentsById = new Map(doc.assignments.map((a) => [a.id, a] as const));
  const selected = options.assignmentIds ? new Set(options.assignmentIds) : null;
  const noAvailability = doc.availability.length === 0;

  // ---- 1. Parts --------------------------------------------------------------
  const parts: Part[] = [];
  for (const a of doc.assignments) {
    if (selected && !selected.has(a.id)) continue;
    const p = progress.get(a.id)!;
    const blocks = blocksOf.get(a.id) || [];
    if (!p.counts) {
      if (selected) unplaced.push({ assignmentId: a.id, minutes: 0, reason: exclusionText(exclusionReason(a, blocks)) });
      continue;
    }
    const deadlines = assignmentDeadlines(a, dueTime);
    const deadline = deadlines[0] ?? null;
    const passed = deadline !== null && deadline.at <= fromMin;
    if (p.remainingMinutes === null) {
      if (passed) {
        if (selected) unplaced.push({ assignmentId: a.id, minutes: 0, reason: deadline.passedText(nowMin) });
      } else if (selected || p.scheduledMinutes === 0) {
        unplaced.push({ assignmentId: a.id, minutes: 0, reason: 'It has no time estimate. Add an estimated duration to plan it.' });
      }
      continue;
    }
    const unscheduled = p.unscheduledMinutes ?? 0;
    if (unscheduled <= 0) continue;
    if (passed) {
      unplaced.push({ assignmentId: a.id, minutes: unscheduled, reason: deadline.passedText(nowMin) });
      continue;
    }
    if (noAvailability) {
      unplaced.push({
        assignmentId: a.id,
        minutes: unscheduled,
        reason: 'No study time has been entered yet. Add your study time (Commitments → Study time) so work can be planned.',
      });
      continue;
    }
    parts.push(...partsOf(doc, a, blocks, unscheduled, deadline, nowMin, dueTime));
  }

  // ---- 2. Day states ---------------------------------------------------------
  const days = new Map<number, DayState>();
  if (parts.length > 0) {
    const freeByDate = freeTimeByDate(doc, dateFromDayNumber(firstDay), dateFromDayNumber(lastDay));
    for (let n = firstDay; n <= lastDay; n++) {
      const base = n * MINUTES_PER_DAY;
      const free = (freeByDate.get(dateFromDayNumber(n))?.free || []).map((i) => ({ start: base + i.start, end: base + i.end }));
      days.set(n, { dayNum: n, free, load: 0, used: new Set() });
    }
  }

  // Occupied time (absolute minutes). Work blocks are widened by the break
  // length so that new sessions keep a break from them; break blocks are not.
  const occupied: Interval[] = [];
  const plannedEnds = new Map<string, number>(); // key: assignmentId or assignmentId|taskId → latest end of planned future work
  const noteEnd = (key: string, end: number) => plannedEnds.set(key, Math.max(plannedEnds.get(key) ?? Number.NEGATIVE_INFINITY, end));
  for (const b of doc.scheduleBlocks) {
    if ((b.status ?? 'planned') === 'skipped') continue;
    if (!isValidLocalDateTime(b.start) || !isValidLocalDateTime(b.end)) continue;
    const start = ldtToMinutes(b.start);
    const end = Math.max(start, ldtToMinutes(b.end));
    const isWork = (b.kind ?? 'work') === 'work';
    occupied.push(isWork ? { start: start - breakMinutes, end: end + breakMinutes } : { start, end });
    const day = days.get(Math.floor(start / MINUTES_PER_DAY));
    if (day && isWork) day.load += blockMinutes(b);
    if (day && b.assignmentId) day.used.add(b.assignmentId);
    if (isWork && b.assignmentId && (b.status ?? 'planned') === 'planned' && end > nowMin) {
      noteEnd(b.assignmentId, end);
      if (b.taskId) noteEnd(`${b.assignmentId}|${b.taskId}`, end);
    }
  }

  // ---- 3. Order --------------------------------------------------------------
  const sorted = [...parts].sort(
    (x, y) =>
      x.hardEnd - y.hardEnd ||
      x.assignmentEnd - y.assignmentEnd ||
      (PRIORITY_RANK[x.assignment.priority ?? 'medium'] ?? 2) - (PRIORITY_RANK[y.assignment.priority ?? 'medium'] ?? 2) ||
      compareText(x.assignment.title, y.assignment.title) ||
      compareText(x.assignment.id, y.assignment.id) ||
      x.order - y.order,
  );
  const dependencies = new Map<Part, Part[]>(
    sorted.map((part) => [
      part,
      sorted.filter(
        (other) =>
          other !== part &&
          ((other.assignment === part.assignment && !!other.task && !!part.task && (part.task.dependsOn || []).includes(other.task.id)) ||
            (part.assignment.dependsOn || []).includes(other.assignment.id)),
      ),
    ]),
  );

  // ---- 4/5. Placement ----------------------------------------------------------
  const placed: PlacedBlock[] = [];

  /** Free slots of `day` inside `window`, minus occupied time (with breaks). */
  const slotsOn = (day: DayState, window: Interval[]): Interval[] => {
    const dayStart = day.dayNum * MINUTES_PER_DAY;
    const nearby = occupied.filter((o) => o.end > dayStart && o.start < dayStart + MINUTES_PER_DAY);
    return subtractIntervals(intersectIntervals(day.free, window), nearby);
  };
  const fits = (slot: Interval) => roundDown5(slot.end - roundUp5(slot.start)) >= minSession;

  /** Days in [start, end) where the assignment has no session yet and a session would fit. */
  const usableDays = (assignmentId: Id, start: number, end: number): number => {
    let count = 0;
    for (let n = Math.floor(start / MINUTES_PER_DAY); n * MINUTES_PER_DAY < end; n++) {
      const day = days.get(n);
      if (day && !day.used.has(assignmentId) && slotsOn(day, [{ start, end }]).some(fits)) count++;
    }
    return count;
  };

  /**
   * Earliest slot for one session of `want` minutes inside [windowStart,
   * windowEnd). Without `allowShorter` the session must fit whole; with it, a
   * shorter session (≥ minSessionMinutes) may be placed, but never one that
   * leaves less than a minimum session of `remaining` behind.
   */
  const placeOne = (
    part: Part,
    windowStart: number,
    windowEnd: number,
    onePerDay: boolean,
    allowShorter: boolean,
    want: number,
    remaining: number,
    flags: { dailyLimitHit: boolean },
  ): PlacedBlock | null => {
    if (windowEnd - windowStart < minSession) return null;
    const window = [{ start: windowStart, end: windowEnd }];
    for (let n = Math.floor(windowStart / MINUTES_PER_DAY); n * MINUTES_PER_DAY < windowEnd; n++) {
      const day = days.get(n);
      if (!day) continue;
      if (onePerDay && day.used.has(part.assignment.id)) continue;
      const dailyLeft = maxDaily === null ? Number.POSITIVE_INFINITY : roundDown5(maxDaily - day.load);
      for (const slot of slotsOn(day, window)) {
        const start = roundUp5(slot.start);
        const room = roundDown5(slot.end - start);
        if (room < minSession) continue;
        if (dailyLeft < Math.min(want, room)) flags.dailyLimitHit = true;
        let length = Math.min(want, room, dailyLeft);
        if (length < want) {
          if (!allowShorter) continue;
          const rest = remaining - length;
          if (rest > 0 && rest < minSession) length = roundDown5(remaining - minSession);
          if (length < minSession) continue;
        }
        const block: PlacedBlock = { assignmentId: part.assignment.id, taskId: part.task?.id, start, end: start + length };
        placed.push(block);
        occupied.push({ start: block.start - breakMinutes, end: block.end + breakMinutes });
        day.load += length;
        day.used.add(part.assignment.id);
        noteEnd(part.assignment.id, block.end);
        if (part.task) noteEnd(`${part.assignment.id}|${part.task.id}`, block.end);
        return block;
      }
    }
    return null;
  };

  const processed = new Set<Part>();
  const pending = [...sorted];
  while (pending.length > 0) {
    let index = pending.findIndex((p) => dependencies.get(p)!.every((d) => processed.has(d)));
    if (index === -1) index = 0; // dependency cycle (invalid data): take the earliest
    const [part] = pending.splice(index, 1);
    processed.add(part);

    // Sessions must start after the planned work this part depends on.
    let notBefore = fromMin;
    let after: string | null = null;
    const a = part.assignment;
    for (const depId of part.task?.dependsOn || []) {
      const dep = (a.tasks || []).find((t) => t.id === depId);
      if (!dep || dep.status === 'done' || dep.status === 'cancelled') continue;
      const end = plannedEnds.get(`${a.id}|${depId}`);
      if (end !== undefined && end > notBefore) {
        notBefore = end;
        after = dep.title;
      }
    }
    for (const depId of a.dependsOn || []) {
      const dep = assignmentsById.get(depId);
      if (!dep || dep.status === 'done' || dep.status === 'cancelled') continue;
      const end = plannedEnds.get(depId);
      if (end !== undefined && end > notBefore) {
        notBefore = end;
        after = dep.title;
      }
    }

    const hardEnd = Math.min(part.hardEnd, horizonEnd);
    const softStart = Math.max(notBefore, part.softStart);
    const softEnd = Math.min(part.softEnd, hardEnd);
    // Equal sessions when they can go on separate days; otherwise full-length
    // sessions, which fit fragmented free time better.
    const sessions = Math.ceil(part.minutes / maxSession);
    const size =
      usableDays(a.id, notBefore, hardEnd) >= sessions ? roundUp5(Math.ceil(part.minutes / sessions)) : maxSession;
    const passes = [
      { start: softStart, end: softEnd, onePerDay: true, allowShorter: false },
      { start: notBefore, end: hardEnd, onePerDay: true, allowShorter: false },
      { start: notBefore, end: hardEnd, onePerDay: false, allowShorter: true },
    ];
    const flags = { dailyLimitHit: false };
    let remaining = part.minutes;
    for (const pass of passes) {
      while (remaining > 0) {
        const want = Math.max(minSession, roundUp5(Math.min(size, remaining)));
        const block = placeOne(part, pass.start, pass.end, pass.onePerDay, pass.allowShorter, want, remaining, flags);
        if (!block) break;
        remaining -= block.end - block.start;
      }
      if (remaining <= 0) break;
    }
    if (remaining > 0) {
      unplaced.push({
        assignmentId: a.id,
        ...(part.task ? { taskId: part.task.id } : {}),
        minutes: remaining,
        reason: unplacedReason(part, notBefore, after, hardEnd, flags.dailyLimitHit),
      });
    }
  }

  // ---- Result ----------------------------------------------------------------
  const taken = collectIds(doc);
  for (const t of doc.deleted || []) taken.add(t.id);
  const blocks: ScheduleBlock[] = placed
    .sort((x, y) => x.start - y.start || x.end - y.end || compareText(x.assignmentId, y.assignmentId) || compareText(x.taskId ?? '', y.taskId ?? ''))
    .map((p) => ({
      id: newId('blk', taken),
      assignmentId: p.assignmentId,
      ...(p.taskId ? { taskId: p.taskId } : {}),
      start: minutesToLdt(p.start),
      end: minutesToLdt(p.end),
      status: 'planned' as const,
      origin: 'planner' as const,
    }));
  return { blocks, unplaced };

  function unplacedReason(part: Part, notBefore: number, after: string | null, end: number, dailyLimitHit: boolean): string {
    const until = part.hardEnd > horizonEnd ? `in the next ${horizonDays} days` : `before ${part.deadlineText ?? 'the deadline'}`;
    if (after !== null && notBefore + minSession > end) {
      return `It comes after “${after}”, which is planned too close to ${part.deadlineText ?? 'the end of the planning period'}.`;
    }
    const window = [{ start: notBefore, end }];
    let anyFree = false;
    for (let n = Math.floor(notBefore / MINUTES_PER_DAY); n * MINUTES_PER_DAY < end; n++) {
      const day = days.get(n);
      if (day && intersectIntervals(day.free, window).some((i) => i.end - i.start >= minSession)) anyFree = true;
    }
    if (!anyFree) return `There is no free study time ${until}.`;
    if (dailyLimitHit && maxDaily !== null) {
      return `Your daily limit of ${formatDuration(maxDaily)} of work is reached on the free days ${until}.`;
    }
    return `Not enough free study time ${until}.`;
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Split an assignment's unscheduled minutes into parts (§ 8.1): one per task
 * with unscheduled minutes (dependency order) plus the work not covered by
 * tasks, capped so that the parts never exceed `unscheduled`.
 */
function partsOf(
  doc: ScheduleDocument,
  a: Assignment,
  blocks: ScheduleBlock[],
  unscheduled: number,
  deadline: Deadline | null,
  nowMin: number,
  dueTime: string,
): Part[] {
  const assignmentEnd = deadline ? deadline.at : Number.POSITIVE_INFINITY;
  const assignmentSoft = softMoment(a.recommendedCompletionDate);
  const work = blocks.filter((b) => (b.kind ?? 'work') === 'work');
  const futurePlanned = work.filter((b) => (b.status ?? 'planned') === 'planned' && isValidLocalDateTime(b.end) && ldtToMinutes(b.end) > nowMin);
  const tasks = a.tasks || [];
  const raw: Array<{ task?: Task; minutes: number }> = [];

  if (tasks.some((t) => typeof t.estimatedMinutes === 'number')) {
    for (const t of tasksInDependencyOrder(tasks)) {
      const remaining = taskRemainingMinutes(doc, a, t);
      const scheduled = futurePlanned.filter((b) => b.taskId === t.id).reduce((s, b) => s + blockMinutes(b), 0);
      raw.push({ task: t, minutes: Math.max(0, remaining - scheduled) });
    }
    const liveEstimates = tasks
      .filter((t) => t.status !== 'cancelled')
      .reduce((s, t) => s + (typeof t.estimatedMinutes === 'number' ? t.estimatedMinutes : 0), 0);
    const doneWithoutTask = work.filter((b) => b.status === 'done' && !b.taskId).reduce((s, b) => s + blockMinutes(b), 0);
    const untasked = Math.max(0, (a.estimatedMinutes ?? 0) - liveEstimates - doneWithoutTask);
    const scheduledWithoutTask = futurePlanned.filter((b) => !b.taskId).reduce((s, b) => s + blockMinutes(b), 0);
    raw.push({ minutes: Math.max(0, untasked - scheduledWithoutTask) });
  } else {
    raw.push({ minutes: unscheduled });
  }

  const parts: Part[] = [];
  let budget = unscheduled;
  raw.forEach(({ task, minutes }, order) => {
    const amount = Math.min(minutes, budget);
    if (amount <= 0) return;
    budget -= amount;
    let hardEnd = assignmentEnd;
    let deadlineText = deadline ? deadline.text : null;
    if (task?.due && isValidDateOrDateTime(task.due)) {
      const taskEnd = ldtToMinutes(dueMoment(task.due, dueTime));
      if (taskEnd < hardEnd) {
        hardEnd = taskEnd;
        deadlineText = `the deadline of “${task.title}” (${describeMoment(task.due)})`;
      }
    }
    const softEnd = Math.min(hardEnd, assignmentSoft, softMoment(task?.recommendedCompletionDate));
    const softStart =
      task?.recommendedStartDate && isValidDate(task.recommendedStartDate)
        ? dayNumber(task.recommendedStartDate) * MINUTES_PER_DAY
        : Number.NEGATIVE_INFINITY;
    parts.push({ assignment: a, task, minutes: amount, hardEnd, assignmentEnd, softEnd, softStart, deadlineText, order });
  });
  return parts;
}
