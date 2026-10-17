// Light gamification (SPEC.md § 28): XP, a level and a few achievements,
// computed from the schedule itself, never stored. So a reward cannot be
// given twice, undo takes its reward back with it, it travels with an export,
// and it cannot change deadlines or the plan (§ 28.2).
//
// What earns XP (§ 28.1), all from finished work:
// - Done work sessions: 1 XP per 5 minutes, counting at most DAILY_CAP minutes
//   a day and nothing that ends after LATE (no reward for overwork or late nights).
// - Finished assignments: 20 XP, and 20 more for large work (≥ 2 h estimated).
// - Finished steps of an assignment: 5 XP each, at most 5 steps per assignment
//   (no reward for splitting work into many trivial steps).
// - Preparation done at least 2 days before its test: 5 XP per session.
// Levels get longer: level n starts at 50·n·(n−1) XP (0, 100, 300, 600, …).
import type { Assignment, LocalDateTimeStr, ScheduleDocument } from '../model/types';
import { dateOf, dayNumber, isValidDateOrDateTime, isValidLocalDateTime, ldtToMinutes, timeOf } from './time';

const DAILY_CAP = 180;
const LATE = '23:00';
const BIG_WORK = 120;

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned: boolean;
}

export interface Progress {
  xp: number;
  level: number;
  /** XP into the current level, and how many it takes to the next one. */
  intoLevel: number;
  levelSize: number;
  achievements: Achievement[];
}

const levelStart = (n: number) => 50 * n * (n - 1);

function estimateOf(a: Assignment): number {
  return a.estimatedMinutes ?? (a.tasks ?? []).reduce((sum, t) => sum + (t.status === 'cancelled' ? 0 : t.estimatedMinutes ?? 0), 0);
}

export function computeProgress(doc: ScheduleDocument, now: LocalDateTimeStr): Progress {
  const nowMin = ldtToMinutes(now);
  const byId = new Map(doc.assignments.map((a) => [a.id, a] as const));
  const perDay = new Map<number, number>();
  const daysWorked = new Set<number>();
  let xp = 0;
  let earlyPrep = 0;
  let sessionsDone = 0;

  for (const b of doc.scheduleBlocks) {
    if (b.status !== 'done' || (b.kind ?? 'work') !== 'work' || !isValidLocalDateTime(b.start) || !isValidLocalDateTime(b.end)) continue;
    if (ldtToMinutes(b.end) > nowMin) continue;
    const day = dayNumber(dateOf(b.start));
    const lateEnd = dateOf(b.end) !== dateOf(b.start) || timeOf(b.end)! > LATE;
    const minutes = Math.max(0, ldtToMinutes(b.end) - ldtToMinutes(b.start));
    const counted = lateEnd ? 0 : Math.min(minutes, DAILY_CAP - (perDay.get(day) ?? 0));
    perDay.set(day, (perDay.get(day) ?? 0) + counted);
    xp += Math.floor(counted / 5);
    sessionsDone++;
    daysWorked.add(day);
    const a = b.assignmentId ? byId.get(b.assignmentId) : undefined;
    if (a?.assessmentDate && isValidDateOrDateTime(a.assessmentDate) && dayNumber(dateOf(a.assessmentDate)) - day >= 2) {
      xp += 5;
      earlyPrep++;
    }
  }

  let finished = 0;
  let bigFinished = 0;
  for (const a of doc.assignments) {
    xp += 5 * Math.min(5, (a.tasks ?? []).filter((t) => t.status === 'done').length);
    if (a.status !== 'done') continue;
    finished++;
    xp += 20;
    if (estimateOf(a) >= BIG_WORK) {
      xp += 20;
      bigFinished++;
    }
  }

  let level = 1;
  while (xp >= levelStart(level + 1)) level++;
  const achievements: Achievement[] = [
    { id: 'first-session', title: 'First session', description: 'Finish a planned work session.', earned: sessionsDone >= 1 },
    { id: 'five-days', title: 'Steady week', description: 'Finish work on 5 different days.', earned: daysWorked.size >= 5 },
    { id: 'ahead', title: 'Ahead of the test', description: 'Finish 3 preparation sessions at least 2 days before a test.', earned: earlyPrep >= 3 },
    { id: 'big-work', title: 'Big work done', description: 'Finish an assignment of 2 hours or more.', earned: bigFinished >= 1 },
    { id: 'ten-done', title: 'Ten done', description: 'Finish 10 assignments.', earned: finished >= 10 },
  ];
  return { xp, level, intoLevel: xp - levelStart(level), levelSize: levelStart(level + 1) - levelStart(level), achievements };
}
