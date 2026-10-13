// The import that is being reviewed, kept while the person looks at other
// pages (in memory only, for this tab): coming back to Import shows the same
// preview with the same choices. Cleared after importing or cancelling.
import type { ScheduleDocument } from '../../model/types';
import type { ValidationIssue } from '../../lib/validate';
import type { Choices } from './logic';

export interface LoadedFile {
  /** The validated, normalized document (validateDocument().doc). */
  incoming: ScheduleDocument;
  /** File name, or "pasted text". */
  fileName: string;
  /** Validation warnings (§ 13.4), shown in the preview. */
  warnings: ValidationIssue[];
  /** The import time ("now" when the file has no meta.generatedAt, § 16.1). */
  importTime: string;
}

export interface PendingImport {
  loaded: LoadedFile;
  choices: Choices;
}

let pending: PendingImport | null = null;
const listeners = new Set<(value: PendingImport | null) => void>();

export function getPendingImport(): PendingImport | null {
  return pending;
}

export function setPendingImport(value: PendingImport | null): void {
  pending = value;
  for (const listener of listeners) listener(value);
}

/** Called on every change (an open Import page shows an import that arrives, e.g. from the extension). */
export function onPendingImport(listener: (value: PendingImport | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
