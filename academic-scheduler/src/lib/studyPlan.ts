// What each preparation session covers (SPEC.md § 25.3–25.4): the study topics
// of an assessment are spread over its upcoming planner-made sessions in the
// order the person needs them: "needs more review" first, then not started,
// then in progress; "comfortable" topics are left out. Sessions beyond one per
// group recap what still needs review (spaced retrieval), so marking a topic
// as hard brings it back into more sessions. Only the session's description
// changes (generator-owned, § 12); its time and the plan stay as they are.
import type { Assignment, Id, ScheduleBlock, ScheduleDocument, StudyTopic } from '../model/types';
import { isValidLocalDateTime, ldtToMinutes, nowLocal } from './time';

const ORDER: Record<string, number> = { needs_review: 0, not_started: 1, in_progress: 2 };

/** Topics still to study, most needed first (stable within a status). */
export function topicsToStudy(topics: StudyTopic[] | undefined): StudyTopic[] {
  return (topics ?? [])
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => (t.status ?? 'not_started') !== 'comfortable')
    .sort((a, b) => ORDER[a.t.status ?? 'not_started'] - ORDER[b.t.status ?? 'not_started'] || a.i - b.i)
    .map(({ t }) => t);
}

/** One description per session, in order: groups of topics, then recaps of what needs review (or of everything). */
export function prepDescriptions(topics: StudyTopic[] | undefined, sessions: number): string[] {
  const todo = topicsToStudy(topics);
  if (!todo.length || sessions <= 0) return [];
  const groups = Math.min(sessions, todo.length);
  const size = Math.ceil(todo.length / groups);
  const out: string[] = [];
  for (let i = 0; i < groups; i++) out.push(`Study: ${todo.slice(i * size, (i + 1) * size).map((t) => t.title).join(', ')}`);
  const hard = todo.filter((t) => t.status === 'needs_review');
  while (out.length < sessions) out.push(`Recap and practice: ${(hard.length ? hard : todo).map((t) => t.title).join(', ')}`);
  return out.map((d) => Array.from(d).slice(0, 5000).join(''));
}

const ownsDescription = (b: ScheduleBlock) => b.origin === 'planner' && !b.locked && !b.overrides?.includes('description');

/** The schedule with the planner-made future sessions of these assessments (default: all with topics) describing what they cover. */
export function withPrepDescriptions(doc: ScheduleDocument, assignmentId?: Id, now = nowLocal()): ScheduleDocument {
  const nowMin = ldtToMinutes(now);
  const targets = doc.assignments.filter((a: Assignment) => (assignmentId ? a.id === assignmentId : true) && a.studyTopics?.length);
  if (!targets.length) return doc;
  const changes = new Map<Id, string | undefined>();
  for (const a of targets) {
    const sessions = doc.scheduleBlocks
      .filter((b) => b.assignmentId === a.id && (b.status ?? 'planned') === 'planned' && (b.kind ?? 'work') === 'work' && ownsDescription(b) && isValidLocalDateTime(b.start) && ldtToMinutes(b.start) >= nowMin)
      .sort((x, y) => ldtToMinutes(x.start) - ldtToMinutes(y.start));
    const texts = prepDescriptions(a.studyTopics, sessions.length);
    sessions.forEach((b, i) => changes.set(b.id, texts[i]));
  }
  if (!changes.size) return doc;
  return {
    ...doc,
    scheduleBlocks: doc.scheduleBlocks.map((b) => {
      if (!changes.has(b.id)) return b;
      const description = changes.get(b.id);
      if (description === b.description) return b;
      const { description: _, ...rest } = b;
      return description ? { ...b, description } : rest;
    }),
  };
}

const ASSESSMENT_TYPES = new Set(['quiz', 'test', 'exam']);

/** Quizzes, tests and exams still ahead (or undated), soonest first: what the Tests view shows (§ 27.4). */
export function upcomingAssessments(doc: ScheduleDocument, today: string): Assignment[] {
  const when = (a: Assignment) => a.assessmentDate ?? a.due;
  return doc.assignments
    .filter((a) => (ASSESSMENT_TYPES.has(a.type ?? '') || !!a.assessmentDate || !!a.studyTopics?.length) && a.status !== 'done' && a.status !== 'cancelled')
    .filter((a) => !when(a) || when(a)!.slice(0, 10) >= today)
    .sort((x, y) => (when(x) ?? '9999').localeCompare(when(y) ?? '9999') || x.title.localeCompare(y.title));
}
