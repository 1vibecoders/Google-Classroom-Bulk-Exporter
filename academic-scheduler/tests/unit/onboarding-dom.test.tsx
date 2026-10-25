// @vitest-environment jsdom
// Streamlined onboarding (SPEC.md § 5, lib/onboarding.ts): the app shows the
// setup until the schedule has study time; the commitments description can
// wait and is asked for in the "Finish setting up" card. Answers are saved in
// the schedule (the description as format 1.1) and the step survives a reload.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDY_PRESETS, commitmentsDescriptionError, commitmentsDescriptionMissing, onboardingNeeds, presetChanges, selectedPreset } from '../../src/lib/onboarding';
import { initialState, reducer } from '../../src/state/reducer';
import { setAiStatus } from '../../src/state/aiStore';
import { validateDocument } from '../../src/lib/validate';
import type { AvailabilityWindow, ScheduleDocument } from '../../src/model/types';

const editorOpen = vi.hoisted(() => vi.fn());
vi.mock('../../src/editors/EditorHost', () => ({
  EditorProvider: ({ children }: { children: ReactNode }) => children,
  useEditors: () => ({ open: editorOpen, close: () => {} }),
}));
// A test can hand the next first-schedule build a promise of its own (to hold it, or make it fail).
const firstScheduleGate = vi.hoisted(() => ({ next: null as Promise<never> | null }));
vi.mock('../../src/lib/ai/firstSchedule', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/ai/firstSchedule')>();
  return {
    ...real,
    firstSchedule: (...args: Parameters<typeof real.firstSchedule>) => {
      const gate = firstScheduleGate.next;
      firstScheduleGate.next = null;
      return gate ?? real.firstSchedule(...args);
    },
  };
});
import { App } from '../../src/App';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STEP_KEY = 'academic-scheduler:onboarding-step';
const ACTIVE_KEY = 'academic-scheduler:onboarding-active';

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
  it('needs only study time; the commitments description can wait', () => {
    expect(onboardingNeeds(doc())).toEqual(['studyTime']);
    expect(onboardingNeeds(doc({ availability: [WINDOW] }))).toEqual([]);
    expect(commitmentsDescriptionMissing(doc({ availability: [WINDOW] }))).toBe(true);
    expect(commitmentsDescriptionMissing(doc({ settings: { commitmentsDescription: '   ' } }))).toBe(true);
    expect(commitmentsDescriptionMissing(doc({ schemaVersion: '1.1', settings: { commitmentsDescription: 'None' } }))).toBe(false);
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

  it('a study-time preset replaces an earlier preset but keeps the person’s own windows, and stays a valid schedule', () => {
    let state = initialState(doc({ availability: [WINDOW] }));
    const apply = (id: string) => {
      const { remove, add } = presetChanges(state.doc, id, '2026-10-07');
      for (const r of remove) state = reducer(state, { type: 'deleteAvailability', id: r, now: '2026-10-07T12:00:00' });
      for (const item of add) state = reducer(state, { type: 'upsertAvailability', item });
    };
    apply('weekends');
    expect(state.doc.availability.map((w) => w.label)).toEqual(['After school', 'Weekdays 4–7 PM', 'Weekend mornings']);
    apply('evenings');
    expect(state.doc.availability.map((w) => w.label)).toEqual(['After school', 'Weekday evenings']);
    expect(validateDocument(JSON.parse(JSON.stringify(state.doc))).ok).toBe(true);
    // Exactly a preset (nothing else) shows as chosen.
    expect(selectedPreset(state.doc.availability)).toBeUndefined();
    expect(selectedPreset(state.doc.availability.filter((w) => w.id !== 'avl'))).toBe('evenings');
    expect(presetChanges(state.doc, 'nope', '2026-10-07')).toEqual({ remove: [], add: [] });
    expect(STUDY_PRESETS.map((p) => p.label)).toEqual(['Weekdays 4–7 PM', 'Evenings', 'Weekends too']);
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

function remount() {
  act(() => root!.unmount());
  container.remove();
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

async function settle() {
  await act(async () => {
    await Promise.resolve();
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
  it('replaces every page except Import and Settings until there is study time, starting with the welcome slides', async () => {
    await mount(doc());
    expect(text()).toContain('Set up your schedule');
    expect(text()).toContain('Everything due, in one place');
    await settle();
    expect(window.location.hash).toBe('#/welcome');

    remount();
    await mount(doc(), '#/settings');
    expect(text()).toContain('Settings and data');
    expect(text()).not.toContain('Set up your schedule');
  });

  it('moves through the slides with Back / Next and the dots, and Get started opens the first step with focus on it', async () => {
    await mount(doc(), '#/welcome');
    expect(button('Back').disabled).toBe(true);
    const live = container.querySelector('[aria-live="polite"]');
    await click(button('Next'));
    expect(text()).toContain('Planned into your real free time');
    // The live region stays the same node, so screen readers announce the new slide.
    expect(container.querySelector('[aria-live="polite"]')).toBe(live);
    expect(container.querySelectorAll('.ob-dot')[1].getAttribute('aria-current')).toBe('true');
    button('Back').focus();
    await click(button('Back'));
    expect(text()).toContain('Everything due, in one place');
    // Back is disabled on the first slide, so focus moves to Next instead of falling to the page.
    expect(document.activeElement).toBe(button('Next'));
    await click(container.querySelector<HTMLButtonElement>('button[aria-label^="Slide 3"]')!);
    expect(text()).toContain('Nothing is planned after its due date');
    expect(() => button('Skip intro')).toThrow();
    await click(button('Get started'));
    expect(currentStep()).toContain('Get your work in');
    expect(document.activeElement?.textContent).toBe('Get your work in');
    expect(localStorage.getItem(STEP_KEY)).toBe('work');
    expect(localStorage.getItem(ACTIVE_KEY)).toBe('1');

    // Back to the slides: focus goes to the slide title.
    await click(button('Back'));
    expect(document.activeElement?.textContent).toBe('Everything due, in one place');
  });

  it('keeps study time locked while the first plan is built, and recovers when the build fails', async () => {
    localStorage.setItem(STEP_KEY, 'study');
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    let fail: (error: Error) => void = () => {};
    firstScheduleGate.next = new Promise<never>((_, reject) => {
      fail = reject;
    });
    await click(button('Build my plan'));
    expect(button(/Building your plan/).disabled).toBe(true);
    for (const b of [button(/Weekdays 4–7 PM/), button(/Customize/), container.querySelector<HTMLButtonElement>('button[aria-label="Edit After school"]')!, container.querySelector<HTMLButtonElement>('button[aria-label="Delete After school"]')!]) {
      expect(b.disabled).toBe(true);
    }

    await act(async () => {
      fail(new Error('Network down'));
    });
    await settle();
    expect(button('Build my plan').disabled).toBe(false);
    expect(button(/Customize/).disabled).toBe(false);
    expect(currentStep()).toContain('Study time');
    expect(text()).toContain('Your plan could not be built (Network down)');
  });

  it('stays in setup until the person enters the app, also after Google sign-in returns to Settings', async () => {
    const answered = doc({ availability: [WINDOW] });
    localStorage.setItem(STEP_KEY, 'work');
    await mount(answered, '#/welcome');
    expect(currentStep()).toContain('Get your work in');
    remount();

    await mount(answered, '#/day/2026-10-07');
    await settle();
    expect(window.location.hash).toBe('#/welcome');
    remount();

    // Google's sign-in returns to Settings: back to the wizard, with the Classroom card open for the result.
    await mount(answered, '#/settings?google=connected');
    await settle();
    expect(window.location.hash).toBe('#/welcome?google=connected');
    expect(button(/Google Classroom/).getAttribute('aria-expanded')).toBe('true');
  });

  it('starts empty, sets study time with one tap, builds the plan, resumes after a reload and enters the app', async () => {
    localStorage.setItem(STEP_KEY, 'work');
    await mount(doc(), '#/welcome');
    expect(container.querySelector('a.ob-choice[href="#/import"]')?.textContent).toContain('.json');
    await click(button(/Start empty/));
    expect(currentStep()).toContain('Study time');

    // Study time is the one required answer.
    await click(button('Build my plan'));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Choose when you usually study');
    await click(button(/Customize/));
    expect(editorOpen).toHaveBeenCalledWith({ kind: 'availability' });

    await click(button(/Weekdays 4–7 PM/));
    expect(button(/Weekdays 4–7 PM/).getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await click(button(/Weekends too/));
    expect(button(/Weekdays 4–7 PM/).getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('.ls-items .ls-item')).toHaveLength(2);

    await click(button('Build my plan'));
    expect(currentStep()).toContain('Your plan');
    expect(text()).toContain('Nothing is planned after its due date');
    expect(text()).toContain('Start with one thing');
    expect(text()).toContain('Finish setting up');
    expect(localStorage.getItem(STEP_KEY)).toBe('ready');

    // A reload resumes on the same step.
    remount();
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    expect(currentStep()).toContain('Your plan');
    await click(button('Just take me in'));
    expect(window.location.hash).toBe('#/day/2026-10-07');
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_KEY)).toBeNull();
  });

  it('a "Start with one thing" shortcut enters the app there', async () => {
    localStorage.setItem(STEP_KEY, 'ready');
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    await click(button(/Check what’s due/));
    expect(window.location.hash).toBe('#/assignments');
    expect(localStorage.getItem(STEP_KEY)).toBeNull();
  });

  it('goes back to study time when the plan step has none', async () => {
    localStorage.setItem(STEP_KEY, 'ready');
    await mount(doc(), '#/welcome');
    expect(currentStep()).toContain('Study time');
  });

  it('offers planning with AI as a daily run once the free setup run is used, and planning without AI', async () => {
    localStorage.setItem(STEP_KEY, 'study');
    await mount(doc({ availability: [WINDOW] }), '#/welcome');
    const status = { configured: true, proposals: [], pending: 0, budget: { limit: 20, used: 0 }, setupAvailable: false, runs: { limit: 3, used: 1 } };
    act(() => setAiStatus(status));
    expect(text()).toContain('counts as one of the 3 daily planning runs');
    expect(button('Plan with AI').disabled).toBe(false);
    act(() => setAiStatus({ ...status, runs: { limit: 3, used: 3 } }));
    expect(button('Plan with AI').disabled).toBe(true);
    await click(button('Plan without AI'));
    expect(currentStep()).toContain('Your plan');
    act(() => setAiStatus(null));
  });

  it('asks for the commitments description later in the "Finish setting up" card and saves it as 1.1', async () => {
    await mount(doc({ availability: [WINDOW] }), '#/day/2026-10-07');
    await settle();
    expect(window.location.hash).toBe('#/day/2026-10-07');
    const card = () => container.querySelector('.getting-started');
    expect(card()?.textContent).toContain('Describe your commitments');
    await click(button('Describe them'));
    const textarea = container.querySelector<HTMLTextAreaElement>('.getting-started textarea')!;
    expect(document.activeElement).toBe(textarea);
    expect(button('Not now').getAttribute('aria-controls')).toBe('gs-describe-form');
    expect(document.getElementById('gs-describe-form')?.contains(textarea)).toBe(true);

    await click(button('Save'));
    expect(text()).toContain('Describe your commitments in a sentence or two');
    await typeInto(textarea, '  Job on Saturdays  ');
    await click(button('Save'));
    expect(card()?.textContent ?? '').not.toContain('Describe your commitments');
    // The form is gone: focus moves to the card title instead of falling to the page.
    expect(document.activeElement?.id).toBe('gs-title');
    // The store saves 250 ms after the last change.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    const saved = JSON.parse(localStorage.getItem('academic-scheduler.v1') ?? 'null');
    expect(saved?.doc?.settings?.commitmentsDescription).toBe('Job on Saturdays');
    expect(saved?.doc?.schemaVersion).toBe('1.1');
  });
});
