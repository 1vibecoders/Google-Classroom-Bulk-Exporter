// The Google Classroom classes, open work and announcements in the schedule,
// sent with an AI run (server/uploadedSources.ts) so the AI reads what was
// imported from the browser extension or a schedule file, not only what a
// Google sync stored. Cut to the server's limits; at most MAX_BYTES of text in
// all (UTF-8: non-English text takes up to 3 bytes a character), open work of
// the nearest due dates first (Vercel Functions accept request bodies up to 4.5 MB).
import type { ScheduleDocument } from '../../model/types';

const MAX_CLASSES = 40;
const MAX_WORK = 1500;
const MAX_ANNOUNCEMENTS = 20;
const MAX_TEXT = 5000;
const MAX_BYTES = 2_500_000;
const CLASS_ID = /^gc-class-[A-Za-z0-9._:-]{1,90}$/;
const WORK_ID = /^gc-[A-Za-z0-9._:-]{1,90}$/;

export interface UploadSources {
  classes: Array<{ id: string; name: string; description?: string; announcements?: Array<{ text: string; postedAt?: string; url?: string }> }>;
  work: Array<{ id: string; classId: string; title: string; description?: string; due?: string; points?: string; url?: string }>;
}

const encoder = new TextEncoder();
const bytes = (s: string | undefined) => (s ? encoder.encode(s).length : 0);
const cut = (s: string | undefined, max: number) => (s ? Array.from(s).slice(0, max).join('') : undefined);
const https = (url: string | undefined) => (url && /^https:\/\/[^\s]{1,1990}$/.test(url) ? url : undefined);

export function uploadSources(doc: ScheduleDocument): UploadSources {
  let used = 0;
  const fits = (n: number) => (used + n <= MAX_BYTES ? ((used += n), true) : false);
  const classes: UploadSources['classes'] = [];
  for (const c of doc.classes) {
    if (classes.length >= MAX_CLASSES || c.archived || !CLASS_ID.test(c.id)) continue;
    const announcements = (c.announcements ?? [])
      .slice(0, MAX_ANNOUNCEMENTS)
      .map((a) => ({ text: cut(a.text, MAX_TEXT)!, ...(a.postedAt ? { postedAt: a.postedAt } : {}), ...(https(a.url) ? { url: a.url } : {}) }))
      .filter((a) => a.text.trim() && fits(bytes(a.text) + 200));
    const description = cut(c.description, MAX_TEXT);
    classes.push({ id: c.id, name: cut(c.name, 200)!, ...(description ? { description } : {}), ...(announcements.length ? { announcements } : {}) });
  }
  const sent = new Set(classes.map((c) => c.id));
  const open = doc.assignments
    .filter((a) => a.classId && sent.has(a.classId) && WORK_ID.test(a.id) && a.source?.kind === 'google_classroom' && a.status !== 'done' && a.status !== 'cancelled')
    .sort((x, y) => (x.due ?? '9999').localeCompare(y.due ?? '9999'));
  const work: UploadSources['work'] = [];
  for (const a of open) {
    if (work.length >= MAX_WORK) break;
    const description = cut(a.description, MAX_TEXT);
    if (!fits(bytes(description) + 300)) break;
    work.push({
      id: a.id,
      classId: a.classId!,
      title: cut(a.title, 200)!,
      ...(description ? { description } : {}),
      ...(a.due ? { due: a.due } : {}),
      ...(a.points && a.points.length <= 100 ? { points: a.points } : {}),
      ...(https(a.source?.url) ? { url: a.source!.url } : {}),
    });
  }
  return { classes, work };
}
