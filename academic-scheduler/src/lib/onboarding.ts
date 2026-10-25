// Onboarding (SPEC.md § 5). Owner decisions:
// - Earlier: two answers were required, at least one study-time window and the
//   person's own short description of their commitments
//   (settings.commitmentsDescription, format 1.1).
// - 2026-10-24: the owner asked for a streamlined setup, so the commitments
//   description is deferrable. It no longer blocks the app; the Day and Week
//   views ask for it in the "Finish setting up" card (views/timeline/GettingStarted.tsx),
//   and the AI reads it whenever it is filled in (lib/ai/firstSchedule.ts sends
//   it with every "plan my schedule with AI" run). Only study time is still
//   required: the planner cannot place any work without it, and a one-tap
//   preset makes it quick.
// Everything else in the wizard is optional and uses the defaults.
import type { AvailabilityWindow, ScheduleDocument, TimeStr, Weekday } from '../model/types';
import { collectIds, newId } from './ids';

export type OnboardingNeed = 'studyTime';

export const MAX_COMMITMENTS_DESCRIPTION = 2000;

// The wizard is "in progress" from its "Get your work in" step until the person
// enters the app, even once study time exists: signing in with Google (which
// returns to Settings) or importing during setup must bring the person back to it. Per browser.
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
    /* storage blocked: only the required answer decides */
  }
}

/** What the schedule still needs before the app can be used; empty when onboarding is complete. */
export function onboardingNeeds(doc: ScheduleDocument): OnboardingNeed[] {
  return doc.availability.length === 0 ? ['studyTime'] : [];
}

/** The deferrable answer: true while the person has not described their commitments yet. */
export function commitmentsDescriptionMissing(doc: ScheduleDocument): boolean {
  return !doc.settings?.commitmentsDescription?.trim();
}

/** Why `text` cannot be saved as the commitments description, or undefined when it can. */
export function commitmentsDescriptionError(text: string): string | undefined {
  if (!text.trim()) return 'Describe your commitments in a sentence or two (write “None” if you have none).';
  // Code points, like the format's length rule.
  if ([...text.trim()].length > MAX_COMMITMENTS_DESCRIPTION) return `Keep it under ${MAX_COMMITMENTS_DESCRIPTION} characters.`;
  return undefined;
}

// ---------------------------------------------------------------------------
// One-tap study-time presets
// ---------------------------------------------------------------------------

interface PresetWindow {
  label: string;
  days: Weekday[];
  startTime: TimeStr;
  endTime: TimeStr;
}

export interface StudyPreset {
  id: string;
  label: string;
  hint: string;
  windows: PresetWindow[];
}

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const AFTER_SCHOOL: PresetWindow = { label: 'Weekdays 4–7 PM', days: WEEKDAYS, startTime: '16:00', endTime: '19:00' };

export const STUDY_PRESETS: StudyPreset[] = [
  { id: 'afternoons', label: 'Weekdays 4–7 PM', hint: 'After school, Monday to Friday', windows: [AFTER_SCHOOL] },
  { id: 'evenings', label: 'Evenings', hint: 'Monday to Friday, 7–10 PM', windows: [{ label: 'Weekday evenings', days: WEEKDAYS, startTime: '19:00', endTime: '22:00' }] },
  {
    id: 'weekends',
    label: 'Weekends too',
    hint: 'Weekdays 4–7 PM, plus Saturday and Sunday 10 AM–1 PM',
    windows: [AFTER_SCHOOL, { label: 'Weekend mornings', days: ['sat', 'sun'], startTime: '10:00', endTime: '13:00' }],
  },
];

function sameWindow(w: AvailabilityWindow, p: PresetWindow): boolean {
  const days = w.recurrence?.daysOfWeek;
  return w.label === p.label && w.startTime === p.startTime && w.endTime === p.endTime && !!days && days.join() === p.days.join();
}

const isPresetWindow = (w: AvailabilityWindow) => STUDY_PRESETS.some((p) => p.windows.some((pw) => sameWindow(w, pw)));

/** The preset the study time currently is exactly, if any. */
export function selectedPreset(availability: AvailabilityWindow[]): string | undefined {
  return STUDY_PRESETS.find((p) => availability.length === p.windows.length && p.windows.every((pw) => availability.some((w) => sameWindow(w, pw))))?.id;
}

/**
 * Choosing a preset: the windows an earlier preset added are replaced by this preset's windows;
 * windows the person made or edited themselves are kept.
 */
export function presetChanges(doc: ScheduleDocument, presetId: string, today: string): { remove: string[]; add: AvailabilityWindow[] } {
  const preset = STUDY_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { remove: [], add: [] };
  const taken = collectIds(doc);
  return {
    remove: doc.availability.filter(isPresetWindow).map((w) => w.id),
    add: preset.windows.map((p) => ({
      id: newId('avl', taken),
      label: p.label,
      startTime: p.startTime,
      endTime: p.endTime,
      recurrence: { frequency: 'weekly', daysOfWeek: [...p.days], startDate: today },
      origin: 'user',
    })),
  };
}
