// Last line of defence before an editor saves: apply the store actions to a
// copy of the state with the real reducer and validate the resulting
// document with the import validator (SCHEDULE_FORMAT.md § 13). Any error
// the edit would introduce blocks the save, so the schedule always stays
// exportable. Errors that already existed are not blamed on the edit.
import { validateDocument, type ValidationIssue } from '../../lib/validate';
import { reducer, type Action, type AppState } from '../../state/reducer';

export function applyActions(state: AppState, actions: Action[]): AppState {
  return actions.reduce((current, action) => reducer(current, action), state);
}

/** Validation errors that `actions` would add to the document. */
export function newValidationErrors(state: AppState, actions: Action[]): ValidationIssue[] {
  const next = applyActions(state, actions);
  const after = validateDocument(next.doc);
  if (after.ok) return [];
  const before = validateDocument(state.doc);
  const known = new Set(before.errors.map((e) => `${e.path}\u0000${e.message}`));
  return after.errors.filter((e) => !known.has(`${e.path}\u0000${e.message}`));
}
