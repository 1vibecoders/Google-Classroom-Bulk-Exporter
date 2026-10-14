// Mandatory onboarding (SPEC.md § 5; the project owner made two answers
// required): at least one study-time window, and the person's own short
// description of their commitments (settings.commitmentsDescription, format 1.1).
// Everything else in the wizard is optional and uses the defaults.
import type { ScheduleDocument } from '../model/types';

export type OnboardingNeed = 'studyTime' | 'commitments';

export const MAX_COMMITMENTS_DESCRIPTION = 2000;

// The wizard is "in progress" from its "Classes and data" step until Finish, even once the
// two answers exist: signing in with Google (which returns to Settings) or
// importing during setup must bring the person back to it. Per browser.
const ACTIVE_KEY = 'academic-scheduler:onboarding-active';

export function setupInProgress(): boolean {
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSetupInProgress(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(ACTIVE_KEY, '1');
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* storage blocked: only the two required answers decide */
  }
}

/** What the schedule still needs before the app can be used; empty when onboarding is complete. */
export function onboardingNeeds(doc: ScheduleDocument): OnboardingNeed[] {
  const needs: OnboardingNeed[] = [];
  if (doc.availability.length === 0) needs.push('studyTime');
  if (!doc.settings?.commitmentsDescription?.trim()) needs.push('commitments');
  return needs;
}

/** Why `text` cannot be saved as the commitments description, or undefined when it can. */
export function commitmentsDescriptionError(text: string): string | undefined {
  if (!text.trim()) return 'Describe your commitments in a sentence or two (write “None” if you have none).';
  // Code points, like the format's length rule.
  if ([...text.trim()].length > MAX_COMMITMENTS_DESCRIPTION) return `Keep it under ${MAX_COMMITMENTS_DESCRIPTION} characters.`;
  return undefined;
}
