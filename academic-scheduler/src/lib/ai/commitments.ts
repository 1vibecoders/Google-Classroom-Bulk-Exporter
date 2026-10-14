// Adds the events the AI read from the person's description of their
// commitments (server/ai/commitments.ts) to the schedule, as /academic-schedule
// does (SKILL.md, Step 9): origin "generated", source "user", a weekly
// commitment starts on the Monday of this week with no end date. Match before
// creating: an event with the same ID or title, or one the person deleted, is
// not added again. Vague parts become open questions (missing_information
// issues) instead of guessed events. Every event is validated before it stays.
import type { CommitmentsResult } from '../../model/aiProposal';
import type { ScheduleDocument, ScheduleEvent } from '../../model/types';
import { mondayOf } from '../time';
import { validateDocument } from '../validate';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

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

export function applyCommitments(doc: ScheduleDocument, result: CommitmentsResult, today: string): { doc: ScheduleDocument; added: number; questions: number } {
  let work = doc;
  let added = 0;
  const source = { kind: 'user' as const, label: 'From your description of your commitments' };
  const taken = new Set([...doc.events.map((e) => e.id), ...(doc.deleted ?? []).map((t) => t.id)]);
  for (const e of result.events) {
    const base = `cm-${slug(e.title)}`;
    if (doc.deleted?.some((t) => t.id === base) || work.events.some((x) => squash(x.title) === squash(e.title) && sameTimes(x, e))) continue;
    // The same title at other times (e.g. "Practice" Mon 4 PM and Sat 9 AM) gets its own ID.
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    const event: ScheduleEvent = {
      id,
      title: e.title,
      category: e.category,
      origin: 'generated',
      busy: true,
      ...(e.daysOfWeek ? { recurrence: { frequency: 'weekly', daysOfWeek: e.daysOfWeek, startDate: mondayOf(today) } } : { date: e.date }),
      startTime: e.startTime,
      endTime: e.endTime,
      source,
    };
    const next = { ...work, events: [...work.events, event] };
    if (!validateDocument(next, { today }).ok) continue;
    taken.add(id);
    work = next;
    added++;
  }
  let questions = 0;
  const issues = [...(work.issues ?? [])];
  for (const q of result.questions) {
    const id = `commitments-unclear-${slug(q)}`;
    if (issues.some((i) => i.id === id)) continue;
    issues.push({ id, kind: 'missing_information', message: `About your commitments: ${q}`, field: 'settings.commitmentsDescription' });
    questions++;
  }
  if (questions) {
    const next = { ...work, issues };
    if (validateDocument(next, { today }).ok) work = next;
    else questions = 0;
  }
  return { doc: work, added, questions };
}

function sameTimes(x: ScheduleEvent, e: { startTime: string; endTime: string }): boolean {
  return x.startTime === e.startTime && x.endTime === e.endTime;
}
