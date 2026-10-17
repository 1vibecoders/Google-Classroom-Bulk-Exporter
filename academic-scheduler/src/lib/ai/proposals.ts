// What to do with the AI's proposals (src/model/aiProposal.ts), decided
// deterministically against the current schedule (SPEC.md § 16.3, § 17.3):
//
// - A proposal is applied automatically only when the person allows it
//   (Settings), every field is high confidence, the value was stated (not
//   worked out from "Friday"), and it fills a gap: work with no due date, a
//   new assessment, work with no estimate. Anything else goes to Review.
// - It never replaces a value the person set (origin "user", pinned, or the
//   field in `overrides`) or a due date Classroom itself gives: those
//   conflicts are shown in Review with both values (§ 16.4).
// - Applying by the person marks the field as theirs (`overrides`), so a
//   later sync does not undo the decision; automatic changes do not.
// - Every result is validated as a whole schedule before it is used.
// - Applied work is planned into free study time right away (planApplied: the
//   fixed-rule planner, never the AI), so accepting an estimate changes the calendar;
//   its sessions that no longer fit (e.g. after an earlier due date) are moved (repair.ts).
import type { AiProposal } from '../../model/aiProposal';
import type { Assignment, AssignmentType, ScheduleDocument, Source } from '../../model/types';
import { resolveSettings } from '../../model/constants';
import { repairPlan } from '../repair';
import { fitToDue } from '../sync/fitToDue';
import { nowLocal, todayLocal } from '../time';
import { validateDocument } from '../validate';

export interface ReviewItem {
  proposal: AiProposal;
  className: string;
  /** The work it is about (absent for a new assessment). */
  assignment?: Assignment;
  field: 'due' | 'new' | 'estimate';
  previous?: string | number;
  /** Why it is not applied automatically; empty: safe to apply on its own. */
  reasons: string[];
}

const ASSESSMENT_DATE_TYPES: AssignmentType[] = ['quiz', 'test', 'exam', 'presentation'];

/** § 14.1 slug: ASCII, lowercase, runs of other characters as "-", at most 40 characters. */
function slug(text: string): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'item';
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

function personOwns(a: Assignment, field: string): boolean {
  return a.origin === 'user' || !!a.locked || !!a.overrides?.includes(field);
}

/** ID for work announced in a Classroom item (§ 14.1): `gc-<itemId>-<slug(title)>`. An item with it, or a deleted one, means it is already handled. */
export function newAssessmentId(p: AiProposal): string {
  return `gc-${p.source.id}-${slug(p.title ?? '')}`.slice(0, 76).replace(/-+$/, '');
}

function existingNew(doc: ScheduleDocument, p: AiProposal): boolean {
  const id = newAssessmentId(p);
  if (doc.assignments.some((a) => a.id === id) || doc.deleted?.some((t) => t.id === id)) return true;
  return doc.assignments.some((a) => a.classId === p.classId && squash(a.title) === squash(p.title ?? ''));
}

/** The proposals that still need something, with what they would change and why they wait for the person. */
export function reviewItems(doc: ScheduleDocument, proposals: AiProposal[]): ReviewItem[] {
  const classes = new Map(doc.classes.map((c) => [c.id, c.name]));
  const items: ReviewItem[] = [];
  // Texts that disagree about the same work (§ 14.3): each waits for the person, never "the last one read wins".
  const values = new Map<string, Set<string>>();
  for (const p of proposals) if (p.assignmentId) values.set(`${p.kind}:${p.assignmentId}`, (values.get(`${p.kind}:${p.assignmentId}`) ?? new Set()).add(String(p.value)));
  // A time the teacher states beats the AI's own estimate of the same work.
  const stated = new Set(proposals.filter((p) => p.kind === 'estimate').map((p) => p.assignmentId));
  for (const p of proposals) {
    const className = classes.get(p.classId);
    // Not imported yet: it waits until the class and its work are in the schedule.
    if (!className) continue;
    if (p.kind === 'workload' && stated.has(p.assignmentId)) continue;
    const reasons: string[] = [];
    if (p.kind === 'workload') {
      // An estimate is never stated; only a low-confidence one waits for the person.
      if (p.confidence.value === 'low') reasons.push('The AI had little to go on; check the time.');
    } else {
      if (p.confidence.identity !== 'high') reasons.push(p.kind === 'new_assessment' ? 'Not sure this is a separate assessment.' : 'Not sure which assignment this is about.');
      if (p.confidence.value !== 'high') reasons.push(p.kind === 'estimate' ? 'The time is uncertain.' : 'The date is uncertain.');
      if (!p.explicit) reasons.push('Worked out from words like “Friday”, not stated as a date.');
    }
    if (p.assignmentId && (values.get(`${p.kind}:${p.assignmentId}`)?.size ?? 0) > 1) reasons.push('Other Classroom texts give a different value.');
    if (p.kind === 'new_assessment') {
      if (existingNew(doc, p)) continue;
      items.push({ proposal: p, className, field: 'new', reasons });
      continue;
    }
    const assignment = doc.assignments.find((a) => a.id === p.assignmentId);
    if (!assignment) continue;
    if (p.kind === 'due_change') {
      if (assignment.due === p.value) continue;
      if (personOwns(assignment, 'due')) reasons.push('You set this date yourself; it is never changed without you.');
      else if (assignment.due) reasons.push('Classroom gives a different due date; check which one is right.');
      items.push({ proposal: p, className, assignment, field: 'due', previous: assignment.due, reasons });
    } else {
      if (assignment.estimatedMinutes === p.value) continue;
      if (personOwns(assignment, 'estimatedMinutes')) reasons.push('You set this estimate yourself; it is never changed without you.');
      else if (assignment.estimatedMinutes !== undefined) reasons.push('There is already an estimate.');
      items.push({ proposal: p, className, assignment, field: 'estimate', previous: assignment.estimatedMinutes, reasons });
    }
  }
  return items;
}

function sourceOf(p: AiProposal): Source {
  const what = { announcement: 'Announcement', coursework: 'Classroom instructions', document: 'Course document' }[p.source.kind];
  const label = Array.from(p.kind === 'workload' ? `AI workload estimate: ${p.excerpt}` : `${what}: “${p.excerpt}”`).slice(0, 200).join('');
  return { kind: 'google_classroom', ...(p.source.url ? { url: p.source.url } : {}), label };
}

/**
 * The schedule with the proposal applied (`value` overrides the proposed value
 * when the person edited it), or the reason it cannot be applied.
 */
export function applyProposal(doc: ScheduleDocument, item: ReviewItem, byPerson: boolean, value: string | number = item.proposal.value): { doc: ScheduleDocument } | { error: string } {
  const next = structuredClone(doc);
  const p = item.proposal;
  if (item.field === 'new') {
    const id = newAssessmentId(p);
    const type = p.type ?? 'other';
    const dateField = ASSESSMENT_DATE_TYPES.includes(type) ? 'assessmentDate' : 'due';
    next.assignments.push({
      id,
      title: p.title ?? 'Assessment',
      classId: p.classId,
      type,
      origin: 'generated',
      [dateField]: String(value),
      source: sourceOf(p),
      // The AI's preparation estimate, so the planner spreads study time before the date.
      ...(p.prepMinutes ? { estimatedMinutes: p.prepMinutes, estimateConfidence: 'low' as const, estimateBasis: 'AI estimate of the preparation time' } : {}),
    });
  } else {
    const a = next.assignments.find((x) => x.id === item.assignment!.id);
    if (!a) return { error: 'The assignment is no longer in your schedule.' };
    const field = item.field === 'due' ? 'due' : 'estimatedMinutes';
    if (item.field === 'due') {
      const previous = a.due;
      a.due = String(value);
      Object.assign(a, fitToDue(a, previous, next.scheduleBlocks, resolveSettings(next.settings).defaultDueTime));
    } else {
      a.estimatedMinutes = Number(value);
      a.estimateBasis = Array.from(p.kind === 'workload' ? `AI estimate: ${p.excerpt}` : `Stated in Classroom: “${p.excerpt}”`).slice(0, 2000).join('');
      a.estimateConfidence = p.confidence.value;
      delete a.estimateRange;
      // Multi-step work (SKILL.md Step 8): the AI's steps become tasks, so each session says what to do.
      if (p.steps && Number(value) === p.value && !a.tasks?.length && !personOwns(a, 'tasks')) {
        a.tasks = p.steps.map((s, i) => ({
          id: `${a.id}-s${i + 1}`,
          title: s.title,
          estimatedMinutes: s.minutes,
          origin: 'generated' as const,
          ...(i ? { dependsOn: [`${a.id}-s${i}`] } : {}),
        }));
      }
    }
    if (byPerson && a.origin !== 'user' && !a.overrides?.includes(field)) a.overrides = [...(a.overrides ?? []), field];
    a.sources = [...(a.sources ?? []), sourceOf(p)].slice(-20);
  }
  const checked = validateDocument(next, { today: todayLocal() });
  if (!checked.ok || !checked.doc) {
    const first = checked.errors[0];
    return { error: `This would make your schedule invalid${first ? ` (${first.message})` : ''}. Change the plan first, or edit the value.` };
  }
  return { doc: checked.doc };
}

/** The work an item is about: its assignment, or the assessment it adds. */
export function workOf(item: ReviewItem): string {
  return item.field === 'new' ? newAssessmentId(item.proposal) : item.assignment!.id;
}

/** Plans the part of this work that is not planned yet into free study time, and moves its sessions that no longer fit; nothing else moves. */
export function planApplied(
  doc: ScheduleDocument,
  assignmentIds: string[],
): { doc: ScheduleDocument; sessions: number; moved: number; changes: string[]; notPlanned?: string } {
  if (!assignmentIds.length) return { doc, sessions: 0, moved: 0, changes: [] };
  const plan = repairPlan(doc, nowLocal(), assignmentIds);
  // Why the first piece of work could not be planned, so the person is never left wondering.
  const notPlanned = plan.unplaced[0]?.reason;
  const out = { doc: plan.doc, sessions: plan.sessions, moved: plan.moved, changes: plan.changes };
  return notPlanned ? { ...out, notPlanned } : out;
}

/** Items the person allows to be applied without asking. */
export function automatic(items: ReviewItem[]): ReviewItem[] {
  return items.filter((i) => i.reasons.length === 0 && (i.field === 'new' || i.previous === undefined));
}
