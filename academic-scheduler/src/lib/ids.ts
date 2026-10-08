// IDs for items created in the website: `u-<kind>-<8 random characters>`
// (SCHEDULE_FORMAT.md § 14.5). Random, so they never collide with IDs a
// generator derives from its sources.
import { ID_PATTERN } from '../model/constants';
import type { ScheduleDocument } from '../model/types';

/** `iss`: issue ids the website assigns; `exp`: export ids (meta.exportId). */
export type IdKind = 'cls' | 'asg' | 'tsk' | 'evt' | 'avl' | 'blk' | 'iss' | 'exp';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length = 8): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Every ID used anywhere in the document (items and tasks). */
export function collectIds(doc: ScheduleDocument): Set<string> {
  const ids = new Set<string>();
  for (const c of doc.classes) ids.add(c.id);
  for (const a of doc.assignments) {
    ids.add(a.id);
    for (const t of a.tasks || []) ids.add(t.id);
  }
  for (const e of doc.events) ids.add(e.id);
  for (const w of doc.availability) ids.add(w.id);
  for (const b of doc.scheduleBlocks) ids.add(b.id);
  return ids;
}

/** A new website ID that is not used in `taken`. */
export function newId(kind: IdKind, taken?: Set<string>): string {
  for (;;) {
    const id = `u-${kind}-${randomSuffix()}`;
    if (!taken || !taken.has(id)) {
      if (taken) taken.add(id);
      return id;
    }
  }
}
