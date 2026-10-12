// @vitest-environment jsdom
// Mandatory onboarding (SPEC.md § 5): the app shows the setup wizard until the
// schedule has study time and a description of the person's commitments; the
// answers are saved in the schedule (format 1.1) and survive a reload.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitmentsDescriptionError, onboardingNeeds } from '../../src/lib/onboarding';
import { initialState, reducer } from '../../src/state/reducer';
import { validateDocument } from '../../src/lib/validate';
import type { AvailabilityWindow, ScheduleDocument } from '../../src/model/types';

const editorOpen = vi.hoisted(() => vi.fn());
vi.mock('../../src/editors/EditorHost', () => ({
  EditorProvider: ({ children }: { children: ReactNode }) => children,
  useEditors: () => ({ open: editorOpen, close: () => {} }),
}));
import { App } from '../../src/App';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WINDOW: AvailabilityWindow = {
  id: 'avl',
  label: 'After school',
  startTime: '15:30',
  endTime: '21:30',
  recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' },
  origin: 'user',
};

function doc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return { schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], ...partial };
}

describe('onboarding rules', () => {
  it('needs study time and a non-blank commitments description', () => {
    expect(onboardingNeeds(doc())).toEqual(['studyTime', 'commitments']);
    expect(onboardingNeeds(doc({ availability: [WINDOW] }))).toEqual(['commitments']);
    expect(onboardingNeeds(doc({ availability: [WINDOW], settings: { commitmentsDescription: '   ' } }))).toEqual(['commitments']);
    expect(onboardingNeeds(doc({ schemaVersion: '1.1', availability: [WINDOW], settings: { commitmentsDescription: 'None' } }))).toEqual([]);
  });

  it('rejects a blank or too long description', () => {
    expect(commitmentsDescriptionError('')).toMatch(/Describe your commitments/);
    expect(commitmentsDescriptionError(' \n ')).toMatch(/Describe your commitments/);
    expect(commitmentsDescriptionError('x'.repeat(2001))).toMatch(/under 2000/);
    expect(commitmentsDescriptionError('Swim Mon/Wed')).toBeUndefined();
  });

  it('saving the description makes the schedule a valid 1.1 document, and removing it goes back to 1.0', () => {
    const withText = reducer(initialState(doc({ availability: [WINDOW] })), { type: 'updateSettings', settings: { commitmentsDescription: 'Job on Saturdays' } });
    expect(withText.doc.schemaVersion).toBe('1.1');
    expect(validateDocument(JSON.parse(JSON.stringify(withText.doc))).ok).toBe(true);
    const without = reducer(withText, { type: 'updateSettings', settings: { commitmentsDescription: undefined } });
    expect(without.doc.schemaVersion).toBe('1.0');
    expect(validateDocument(JSON.parse(JSON.stringify(without.doc))).ok).toBe(true);
  });
});

let root: Root | null = null;
let container: HTMLDivElement;

async function mount(d: ScheduleDocument, hash = '#/day/2026-10-07') {
  window.location.hash = hash;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App initialState={initialState(d)} />);
  });
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string | RegExp): HTMLButtonElement {
  const all = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));
  const found = all.find((b) => (typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? '')));
  if (!found) throw new Error(`no button ${label}; buttons: ${all.map((b) => b.textContent?.trim()).join(' | ')}`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function currentStep(): string {
  return container.querySelector('[aria-current="step"]')?.textContent ?? '';
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
  localStorage.clear();
  editorOpen.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.useRealTimers();
});

describe('onboarding wizard', () => {
  it('replaces every page except Import and Settings until the required answers exist', async () => {
    await mount(doc());
    expect(text()).toContain('Set up your schedule');
    await act(async () => {
      await Promise.resolve();
    });
    expect(window.location.hash).toBe('#/welcome');
    expect(currentStep()).toContain('Study time');

    act(() => root!.unmount());
    container.remove();
    await mount(doc(), '#/settings');
    expect(text()).toContain('Settings and data');
    expect(text()).not.toContain('Set up your schedule');
  });

  it('does not continue without study time, and opens the study-time editor', async () => {
    await mount(doc());
    await click(button('Next'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Add at least one study-time window');
    expect(currentStep()).toContain('Study time');
    await click(button(/Add study time/));
    expect(editorOpen).toHaveBeenCalledWith({ kind: 'availability' });
  });

  it('requires a description, saves it, resumes at the saved step and finishes on the day view', async () => {
    await mount(doc({ availability: [WINDOW] }));
    expect(text()).toContain('After school');
    await click(button('Next'));
    expect(currentStep()).toContain('Commitments');

    const textarea = container.querySelector('textarea')!;
    await typeInto(textarea, '   ');
    await click(button('Save and continue'));
    expect(text()).toContain('Describe your commitments in a sentence or two');
    expect(currentStep()).toContain('Commitments');

    await typeInto(textarea, '  Swim practice Mon and Wed 4–6 PM.  ');
    await click(button('Save and continue'));
    expect(currentStep()).toContain('Preferences');
    expect(localStorage.getItem('academic-scheduler:onboarding-step')).toBe('2');

    // A reload resumes on the same step.
    act(() => root!.unmount());
    container.remove();
    await mount(doc({ schemaVersion: '1.1', availability: [WINDOW], settings: { commitmentsDescription: 'Swim practice Mon and Wed 4–6 PM.' } }), '#/welcome');
    expect(currentStep()).toContain('Preferences');

    await click(button('Next'));
    expect(currentStep()).toContain('Classes and data');
    await click(button('Next'));
    expect(currentStep()).toContain('Review');
    expect(text()).toContain('Swim practice Mon and Wed 4–6 PM.');
    expect(text()).toContain('1 window');
    expect(button('Finish setup').disabled).toBe(false);
    await click(button('Finish setup'));
    expect(window.location.hash).toBe('#/day/2026-10-07');
    expect(localStorage.getItem('academic-scheduler:onboarding-step')).toBeNull();
  });

  it('trims the saved description and stores it in the schedule as 1.1', async () => {
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    await click(button('Next'));
    await typeInto(container.querySelector('textarea')!, '  Job on Saturdays  ');
    await click(button('Save and continue'));
    // The store saves 250 ms after the last change.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const saved = JSON.parse(localStorage.getItem('academic-scheduler.v1') ?? 'null');
    expect(saved?.doc?.settings?.commitmentsDescription).toBe('Job on Saturdays');
    expect(saved?.doc?.schemaVersion).toBe('1.1');
  });

  it('lists what is still required on the review step and blocks Finish', async () => {
    localStorage.setItem('academic-scheduler:onboarding-step', '4');
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    expect(currentStep()).toContain('Review');
    expect(text()).toContain('Still required');
    expect(button('Finish setup').disabled).toBe(true);
    await click(button('a description of your commitments'));
    expect(currentStep()).toContain('Commitments');
  });
});
