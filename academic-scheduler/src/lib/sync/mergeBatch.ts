// Turn an import batch (src/model/importBatch.ts) into the schedule file the
// import preview compares with the current schedule. The result is the current
// schedule with only what the source owns changed, so the preview lists real
// changes and nothing else, and every rule of the import (matching by ID,
// "Previously deleted", fields the person changed, undo) applies unchanged.
//
// The source owns: a class's name, section, room, description and
// announcements, and adds its topics and materials; an assignment's title,
// class, topic, description, due date, points, Classroom links and whether
// Classroom still lists it. A turned-in assignment becomes done (status only
// moves forward, SCHEDULE_FORMAT.md § 15.10). Everything else (estimates,
// tasks, priority, notes, blocks) stays as it is. A value Classroom does not
// give (e.g. no due date) never clears one the schedule already has.
import { schemaVersionFor } from '../../model/constants';
import type { ImportBatch, ImportedLink } from '../../model/importBatch';
import type { Announcement, Assignment, Reference, ScheduleDocument, SchoolClass, Source } from '../../model/types';

export const SYNC_FILE_NAME = 'Google Classroom sync';

function classroomSource(sourceId: string, url: string | undefined, retrievedAt: string): Source {
  return { kind: 'google_classroom', id: sourceId, ...(url ? { url } : {}), label: 'Google Classroom', retrievedAt };
}

/** Keep the current source when it already names this Classroom item, so a sync does not rewrite it every time. */
function sourceFor(current: { source?: Source } | undefined, sourceId: string, url: string | undefined, retrievedAt: string): Source {
  const cur = current?.source;
  return cur && cur.kind === 'google_classroom' && cur.id === sourceId ? cur : classroomSource(sourceId, url, retrievedAt);
}

/** `current` plus the links it does not have yet (matched by URL), at most `max`. */
function withLinks(current: Reference[] | undefined, links: ImportedLink[] | undefined, max: number): Reference[] {
  const out = [...(current ?? [])];
  for (const link of links ?? []) {
    if (out.length < max && !out.some((r) => r.url === link.url)) out.push({ title: link.title, url: link.url, kind: 'link' });
  }
  return out;
}

export function mergeBatch(current: ScheduleDocument, batch: ImportBatch): ScheduleDocument {
  const doc = structuredClone(current);
  const classIndex = new Map(doc.classes.map((c, i) => [c.id, i]));
  const asgIndex = new Map(doc.assignments.map((a, i) => [a.id, i]));
  // Items the person deleted are not brought back (a generator never re-creates them, § 15).
  const deleted = new Set((doc.deleted ?? []).map((t) => t.id));

  for (const course of batch.courses) {
    if (deleted.has(course.id)) continue;
    const i = classIndex.get(course.id);
    const cur = i === undefined ? undefined : doc.classes[i];
    const next: SchoolClass = {
      ...(cur ?? { id: course.id, origin: 'generated' as const }),
      name: course.name,
      ...(course.section ? { section: course.section } : {}),
      ...(course.room ? { room: course.room } : {}),
      ...(course.description ? { description: course.description } : {}),
      source: sourceFor(cur, course.sourceId, course.url, batch.importedAt),
    };
    if (course.topics?.length) next.topics = [...new Set([...(cur?.topics ?? []), ...course.topics])].slice(0, 200);
    const references = withLinks(cur?.references, course.materials, 200);
    if (references.length) next.references = references;
    // Announcements are listed as a whole, so the list is replaced; absent means they could not be read.
    if (course.announcements?.length) {
      next.announcements = course.announcements.map((a): Announcement => {
        const refs = withLinks(undefined, a.links, 50);
        return { text: a.text, ...(a.postedAt ? { postedAt: a.postedAt } : {}), ...(a.url ? { url: a.url } : {}), ...(refs.length ? { references: refs } : {}) };
      });
    } else if (course.announcements) delete next.announcements;
    if (i === undefined) {
      classIndex.set(course.id, doc.classes.length);
      doc.classes.push(next);
    } else doc.classes[i] = next;
  }

  for (const item of batch.assignments) {
    if (deleted.has(item.id)) continue;
    const i = asgIndex.get(item.id);
    const cur = i === undefined ? undefined : doc.assignments[i];
    if (item.state === 'missing') {
      // Only an assignment the schedule has can be reported as gone.
      if (cur && cur.sourceState !== 'missing' && cur.sourceState !== 'withdrawn') doc.assignments[i!] = { ...cur, sourceState: 'missing' };
      continue;
    }
    if (!item.title || !classIndex.has(item.classId)) continue;
    const references = withLinks(cur?.references, item.links, Infinity);
    const next: Assignment = {
      ...(cur ?? { id: item.id, origin: 'generated' as const }),
      title: item.title,
      classId: item.classId,
      ...(item.topic ? { topic: item.topic } : {}),
      ...(item.description ? { description: item.description } : {}),
      ...(item.due ? { due: item.due } : {}),
      ...(item.points ? { points: item.points } : {}),
      ...(references.length ? { references } : {}),
      source: sourceFor(cur, item.sourceId, item.url, batch.importedAt),
    };
    // Listed again after being missing. A teacher's "withdrawn" is a statement, not a listing, so it stays.
    if (cur?.sourceState === 'missing') next.sourceState = 'present';
    if (item.turnedIn && next.status !== 'done' && next.status !== 'cancelled') next.status = 'done';
    if (i === undefined) {
      asgIndex.set(item.id, doc.assignments.length);
      doc.assignments.push(next);
    } else doc.assignments[i] = next;
  }

  // "Now" for the preview is when Classroom was read; keep the person's title and sources.
  doc.meta = { ...(doc.meta ?? {}), generatedAt: batch.importedAt, timezone: batch.timezone, generator: { name: SYNC_FILE_NAME } };
  delete doc.meta.exportId;
  delete doc.meta.basedOn;
  delete doc.meta.requestedChanges;
  doc.schemaVersion = schemaVersionFor(doc);
  return doc;
}
