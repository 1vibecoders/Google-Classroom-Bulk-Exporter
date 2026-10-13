// The one path from an import batch (Google Classroom sync, browser extension)
// to the import preview: merge onto the current schedule, validate, and open
// the preview with the batch's warnings. Nothing changes until the person
// imports.
import type { ImportBatch } from '../../model/importBatch';
import type { ScheduleDocument } from '../../model/types';
import { mergeBatch } from '../../lib/sync/mergeBatch';
import { nowLocal, todayLocal } from '../../lib/time';
import { validateDocument } from '../../lib/validate';
import { navigate } from '../../router';
import { setPendingImport } from './pending';

/** Opens the preview; returns a message when the batch cannot be used (nothing changed). */
export function openBatchPreview(current: ScheduleDocument, batch: ImportBatch, fileName: string): string | null {
  const checked = validateDocument(mergeBatch(current, batch), { today: todayLocal() });
  if (!checked.ok || !checked.doc) {
    const first = checked.errors[0];
    return `The data could not be used (${first ? `${first.path}: ${first.message}` : 'invalid'}). Nothing was changed.`;
  }
  const warnings = batch.warnings.map((message) => ({ path: '', code: 'sync', message }));
  setPendingImport({ loaded: { incoming: checked.doc, fileName, warnings: [...warnings, ...checked.warnings], importTime: nowLocal() }, choices: {} });
  navigate({ name: 'import' });
  return null;
}
