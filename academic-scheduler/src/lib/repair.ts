// Plan repair (SPEC.md § 17.2, § 26.2–26.3): after a change (a due date moved
// earlier, a new commitment, an AI finding), planned sessions that now break a
// hard constraint are moved, and nothing else is.
//
// - Broken: overlaps a busy event or another session that stays, or ends after
//   its deadline (the same checks the calendar flags, calendar.ts BlockView).
//   Sessions the website's planner made are also broken when they are no
//   longer inside study time (the person changed it), or when the day's work
//   is over settings.maxDailyStudyMinutes (the latest ones move first). Sessions
//   from a schedule file (/academic-schedule) may sit outside study time on
//   purpose, so those two checks leave them alone.
// - Only flexible sessions move: planned, starting from now on, work (not a
//   break), not locked, not the person's own (origin "user"), of work that
//   still counts. Of two flexible sessions that overlap, the later one moves.
// - The freed work is planned again by the fixed-rule planner (planner.ts):
//   never after its deadline. What does not fit is returned in `unplaced`, so
//   the person sees which work is at risk instead of a plan that only looks
//   valid.
// - `changes` says what moved and why, one line per session, for the undo
//   history (SPEC § 26.4).
import type { Id, LocalDateTimeStr, ScheduleBlock, ScheduleDocument } from '../model/types';
import { resolveSettings } from '../model/constants';
import { buildDays, freeTimeByDate } from './calendar';
import { DEFAULT_HORIZON_DAYS, planUnscheduledWork, type UnplacedWork } from './planner';
import { addDays, dateOf, dayNumber, formatDateWithWeekday, formatDuration, formatTime12, isValidLocalDateTime, ldtToMinutes, timeOf } from './time';
import { progressByAssignment } from './workload';

export interface RepairResult {
  doc: ScheduleDocument;
  /** Sessions taken off the plan because they broke a constraint. */
  moved: number;
  /** New sessions placed by the planner. */
  sessions: number;
  unplaced: UnplacedWork[];
  /** "Essay, Mon, Oct 12, 4:00 PM–5:00 PM: removed (overlaps Practice)", then the new sessions. */
  changes: string[];
}

export interface BrokenSession {
  block: ScheduleBlock;
  /** "overlaps Practice", "ends after the due time (…)", "outside your study time", "over your daily limit of 2 h". */
  why: string;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Flexible future sessions that break a constraint (see above); `assignmentIds`: only that work's. */
export function brokenSessions(doc: ScheduleDocument, now: LocalDateTimeStr, assignmentIds?: Id[]): BrokenSession[] {
  const nowMin = ldtToMinutes(now);
  const progress = progressByAssignment(doc, now);
  const flexible = (b: ScheduleBlock) =>
    (b.status ?? 'planned') === 'planned' &&
    (b.kind ?? 'work') === 'work' &&
    !b.locked &&
    b.origin !== 'user' &&
    !!b.assignmentId &&
    !!progress.get(b.assignmentId)?.counts &&
    isValidLocalDateTime(b.start) &&
    ldtToMinutes(b.start) >= nowMin;
  const candidates = doc.scheduleBlocks.filter(flexible);
  if (!candidates.length) return [];
  const today = dateOf(now);
  const lastDay = Math.max(...candidates.map((b) => dayNumber(dateOf(b.start))));
  const only = assignmentIds ? new Set(assignmentIds) : null;
  // Everything that is not flexible stays where it is.
  const kept = new Set(doc.scheduleBlocks.filter((b) => !flexible(b)).map((b) => b.id));
  const count = lastDay - dayNumber(today) + 1;
  const study = doc.availability.length ? freeTimeByDate(doc, today, addDays(today, count - 1)) : null;
  const maxDaily = resolveSettings(doc.settings).maxDailyStudyMinutes;
  const broken: BrokenSession[] = [];
  const mayMove = (b: ScheduleBlock) => !only || only.has(b.assignmentId!);
  // Days in order, each day's blocks by start: the earlier of two overlapping sessions stays.
  for (const day of buildDays(doc, today, count)) {
    const windows = study?.get(day.date)?.availability ?? [];
    const keptToday: typeof day.blocks = [];
    for (const view of day.blocks) {
      if (!flexible(view.block)) continue;
      const outside = !!study && view.block.origin === 'planner' && !windows.some((w) => w.start <= view.start && view.end <= w.end);
      const overlap = view.conflictsWith.find((c) => c.kind === 'event' || kept.has(c.id));
      const why = overlap ? `overlaps ${overlap.title}` : view.lateReason ? lower(view.lateReason) : outside ? 'outside your study time' : null;
      if (why && mayMove(view.block)) broken.push({ block: view.block, why });
      else {
        kept.add(view.block.id);
        keptToday.push(view);
      }
    }
    if (maxDaily === null) continue;
    let load = day.blocks.filter((v) => !v.isBreak && (v.block.status ?? 'planned') !== 'skipped' && !broken.some((x) => x.block === v.block)).reduce((sum, v) => sum + v.minutes, 0);
    for (const view of keptToday.reverse()) {
      if (load <= maxDaily) break;
      if (view.block.origin !== 'planner' || !mayMove(view.block)) continue;
      broken.push({ block: view.block, why: `over your daily limit of ${formatDuration(maxDaily)}` });
      kept.delete(view.block.id);
      load -= view.minutes;
    }
  }
  return broken;
}

/**
 * Moves the broken sessions (see above) and plans that work again; with
 * `assignmentIds`, only that work is repaired, and its unplanned part is planned too.
 */
export function repairPlan(doc: ScheduleDocument, now: LocalDateTimeStr, assignmentIds?: Id[]): RepairResult {
  const broken = brokenSessions(doc, now, assignmentIds);
  const ids = Array.from(new Set([...(assignmentIds ?? []), ...broken.map((b) => b.block.assignmentId!)]));
  if (!ids.length) return { doc, moved: 0, sessions: 0, unplaced: [], changes: [] };
  const gone = new Set(broken.map((b) => b.block.id));
  const rest = gone.size ? { ...doc, scheduleBlocks: doc.scheduleBlocks.filter((b) => !gone.has(b.id)) } : doc;
  const plan = planUnscheduledWork(rest, { from: now, assignmentIds: ids, horizonDays: DEFAULT_HORIZON_DAYS });
  return {
    doc: plan.blocks.length ? { ...rest, scheduleBlocks: [...rest.scheduleBlocks, ...plan.blocks] } : rest,
    moved: gone.size,
    sessions: plan.blocks.length,
    unplaced: plan.unplaced,
    changes: [...broken.map((b) => `${sessionText(doc, b.block)}: removed (${b.why})`), ...plan.blocks.map((b) => `${sessionText(doc, b)}: new session`)],
  };
}

/** "Essay, Mon, Oct 12, 4:00 PM–5:00 PM". */
function sessionText(doc: ScheduleDocument, b: ScheduleBlock): string {
  const title = doc.assignments.find((a) => a.id === b.assignmentId)?.title ?? 'Work';
  return `${title}, ${formatDateWithWeekday(dateOf(b.start))}, ${formatTime12(timeOf(b.start)!)}–${formatTime12(timeOf(b.end)!)}`;
}
