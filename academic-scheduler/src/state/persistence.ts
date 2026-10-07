// Saving the schedule in this browser (localStorage). Nothing leaves the
// device. Stored data is re-validated on load; if it is unreadable it is kept
// under a backup key instead of being thrown away.
import type { AppState } from './reducer';
import { initialState } from './reducer';
import { validateDocument } from '../lib/validate';

export const STORAGE_KEY = 'academic-scheduler.v1';
export const BACKUP_KEY = 'academic-scheduler.v1.unreadable-backup';

export interface LoadResult {
  state: AppState;
  problem: string | null;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadState(): LoadResult {
  const store = storage();
  if (!store) return { state: initialState(), problem: 'This browser does not allow saving data; changes will be lost when the page closes.' };
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return { state: initialState(), problem: 'Saved data could not be read.' };
  }
  if (!raw) return { state: initialState(), problem: null };
  try {
    const parsed = JSON.parse(raw) as AppState;
    const result = validateDocument(parsed && parsed.doc);
    if (!result.ok || !result.doc) throw new Error(result.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; '));
    const snapshots = Array.isArray(parsed.snapshots)
      ? parsed.snapshots.filter((s) => s && validateDocument(s.doc).ok)
      : [];
    return { state: { doc: result.doc, snapshots }, problem: null };
  } catch (err) {
    try {
      store.setItem(BACKUP_KEY, raw);
    } catch {
      /* ignore */
    }
    return {
      state: initialState(),
      problem: `Saved data could not be loaded (${(err as Error).message}). It was kept as a backup in this browser; starting with an empty schedule.`,
    };
  }
}

export function saveState(state: AppState): string | null {
  const store = storage();
  if (!store) return 'Saving is not available in this browser.';
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch (err) {
    // Quota exceeded: drop undo snapshots first, then retry.
    try {
      store.setItem(STORAGE_KEY, JSON.stringify({ ...state, snapshots: [] }));
      return 'Storage is almost full: undo history was not saved.';
    } catch {
      return `Could not save your schedule (${(err as Error).name}). Export it to keep a copy.`;
    }
  }
}
