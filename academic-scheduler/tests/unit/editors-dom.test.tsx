// @vitest-environment jsdom
// The editor dialogs in a DOM: create, edit (overrides, pin, "allow
// /academic-schedule to update this again"), validation messages, the
// unsaved-changes guard, subtasks, delete confirmations and block moves.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../../src/state/store';
import { ConfirmProvider, Toasts } from '../../src/ui/common';
import { EditorProvider, useEditors, type EditorRequest } from '../../src/editors/EditorHost';
import { emptyDocument, initialState, type AppState } from '../../src/state/reducer';
import type { ScheduleDocument } from '../../src/model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: AppState;
let openEditor: (request: EditorRequest) => void;

function Probe() {
  latest = useStore().state;
  openEditor = useEditors().open;
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement;

function testDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    ...emptyDocument(),
    classes: [{ id: 'cls-eng', name: 'English', color: '#2563EB', origin: 'user' }],
    assignments: [
      {
        id: 'gc-essay',
        classId: 'cls-eng',
        title: 'Othello essay',
        due: '2026-10-16T23:59:00',
        priority: 'medium',
        origin: 'generated',
        source: { kind: 'google_classroom', id: 'essay', url: 'https://classroom.google.com/c/x/a/essay' },
      },
    ],
    events: [{ id: 'evt-fencing', title: 'Fencing', date: '2026-10-12', startTime: '16:00', endTime: '18:00', origin: 'generated' }],
    scheduleBlocks: [{ id: 'b-gen', assignmentId: 'gc-essay', start: '2026-10-12T19:00:00', end: '2026-10-12T19:45:00', origin: 'generated' }],
    ...partial,
  };
}

async function mount(doc: ScheduleDocument = testDoc()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <StoreProvider initial={initialState(doc)}>
        <ConfirmProvider>
          <EditorProvider>
            <Probe />
            <Toasts />
          </EditorProvider>
        </ConfirmProvider>
      </StoreProvider>,
    );
  });
}

async function open(request: EditorRequest) {
  await act(async () => openEditor(request));
}

function dialogs(): HTMLDialogElement[] {
  return Array.from(document.querySelectorAll('dialog'));
}

function dialogTitled(title: string): HTMLDialogElement | undefined {
  return dialogs().find((d) => d.querySelector('h2')?.textContent === title);
}

/** The control labelled `text` (a <label for>, or aria-label), optionally inside `scope`. */
function control<T extends HTMLElement = HTMLInputElement>(text: string, scope: ParentNode = document): T {
  const label = Array.from(scope.querySelectorAll('label')).find((l) => l.textContent?.replace(/\s*\*\s*$/, '').trim() === text && l.htmlFor);
  if (label) return document.getElementById(label.htmlFor) as T;
  const aria = Array.from(scope.querySelectorAll<HTMLElement>('[aria-label]')).find((el) => el.getAttribute('aria-label') === text);
  if (aria) return aria as T;
  throw new Error(`control "${text}" not found`);
}

async function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function buttons(text: string, scope: ParentNode = document): HTMLButtonElement[] {
  return Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.textContent?.trim() === text);
}

async function click(target: string | HTMLElement, scope: ParentNode = document) {
  const el = typeof target === 'string' ? buttons(target, scope).at(-1) : target;
  if (!el) throw new Error(`button "${target}" not found`);
  await act(async () => {
    el.click();
  });
}

async function pressEnter(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0));
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('AssignmentEditor', () => {
  it('creates an assignment with a class, a date-only due date and an estimate', async () => {
    await mount();
    await open({ kind: 'assignment' });
    const dialog = dialogTitled('New assignment')!;
    expect(dialog).toBeTruthy();
    await type(control('Title', dialog), 'Read Chapter 6');
    await type(control<HTMLSelectElement>('Class', dialog), 'cls-eng');
    await type(control('Due: date', dialog), '2026-10-16');
    await type(control('Estimated total time', dialog), '45');
    expect(dialog.textContent).toContain('No time: planned to be finished by the end of the day before.');
    await click('Add assignment');
    const created = latest.doc.assignments.find((a) => a.title === 'Read Chapter 6')!;
    expect(created).toMatchObject({ classId: 'cls-eng', due: '2026-10-16', estimatedMinutes: 45, origin: 'user' });
    expect(created.id).toMatch(/^u-asg-[a-z0-9]{8}$/);
    expect(created.type).toBeUndefined(); // the default stays absent
    expect(dialogTitled('New assignment')).toBeUndefined();
  });

  it('records the person’s edit of a generated assignment, then lets /academic-schedule update it again, and pins it', async () => {
    await mount();
    await open({ kind: 'assignment', id: 'gc-essay' });
    let dialog = dialogTitled('Edit assignment')!;
    expect(dialog.textContent).toContain('Imported from /academic-schedule');
    await type(control<HTMLSelectElement>('Priority', dialog), 'high');
    await click('Save', dialog);
    expect(latest.doc.assignments[0]).toMatchObject({ priority: 'high', overrides: ['priority'] });
    expect(latest.doc.assignments[0].locked).toBeUndefined();

    await open({ kind: 'assignment', id: 'gc-essay' });
    dialog = dialogTitled('Edit assignment')!;
    expect(dialog.textContent).toContain('Your edits are kept');
    await click('Allow /academic-schedule to update this again', dialog);
    expect(latest.doc.assignments[0].overrides).toBeUndefined();
    expect(latest.doc.assignments[0].priority).toBe('high');
    await click('Pin', dialog);
    expect(latest.doc.assignments[0].locked).toBe(true);
    expect(dialog.textContent).toContain('Pinned');
    // Saving the form afterwards keeps the pin (the form saves on top of the latest item).
    await type(control('Title', dialog), 'Othello essay (final)');
    await click('Save', dialog);
    expect(latest.doc.assignments[0]).toMatchObject({ title: 'Othello essay (final)', locked: true, overrides: ['title'] });
  });

  it('“Allow /academic-schedule to update this again” also clears subtask edits, and a later save does not bring them back', async () => {
    const doc = testDoc();
    doc.assignments[0].tasks = [{ id: 'gc-essay-t1', title: 'My outline', overrides: ['title'], origin: 'generated' }];
    await mount(doc);
    await open({ kind: 'assignment', id: 'gc-essay' });
    const dialog = dialogTitled('Edit assignment')!;
    expect(dialog.textContent).toContain('subtask “My outline”');
    await click('Allow /academic-schedule to update this again', dialog);
    expect(latest.doc.assignments[0].tasks![0].overrides).toBeUndefined();
    expect(dialog.textContent).not.toContain('Edited');
    await type(control<HTMLSelectElement>('Priority', dialog), 'high');
    await click('Save', dialog);
    expect(latest.doc.assignments[0].overrides).toEqual(['priority']);
    expect(latest.doc.assignments[0].tasks![0]).toEqual({ id: 'gc-essay-t1', title: 'My outline', origin: 'generated' });
  });

  it('adds, reorders and removes subtasks (with undo)', async () => {
    await mount();
    await open({ kind: 'assignment', id: 'gc-essay' });
    const dialog = dialogTitled('Edit assignment')!;
    const quick = control('New subtask title', dialog);
    await type(quick, 'Outline');
    await pressEnter(quick);
    await type(quick, 'Draft');
    await click('Add subtask', dialog);
    await type(quick, 'Extra');
    await pressEnter(quick);
    await click(control<HTMLButtonElement>('Move “Draft” up', dialog));
    await click(control<HTMLButtonElement>('Remove “Extra”', dialog));
    expect(dialog.textContent).toContain('Removed “Extra” (when you save).');
    await click('Undo', dialog);
    await click(control<HTMLButtonElement>('Remove “Extra”', dialog));
    await click('Save', dialog);
    const tasks = latest.doc.assignments[0].tasks!;
    expect(tasks.map((t) => t.title)).toEqual(['Draft', 'Outline']);
    expect(tasks.every((t) => /^u-tsk-/.test(t.id) && t.origin === 'user')).toBe(true);
  });

  it('rejects a mailto: or javascript: reference link', async () => {
    await mount();
    await open({ kind: 'assignment' });
    const dialog = dialogTitled('New assignment')!;
    await type(control('Title', dialog), 'Lab');
    await click('Add reference', dialog);
    const ref = dialog.querySelector<HTMLElement>('[aria-label="Reference 1"]')!;
    await type(control('Title', ref), 'Ask teacher');
    await type(control('Link', ref), 'javascript:alert(1)');
    await click('Add assignment');
    expect(latest.doc.assignments.some((a) => a.title === 'Lab')).toBe(false);
    expect(dialog.textContent).toContain('Use a full web address that starts with http:// or https://');
    await type(control('Link', ref), 'https://example.com/lab.pdf');
    await click('Add assignment');
    expect(latest.doc.assignments.find((a) => a.title === 'Lab')!.references).toEqual([{ title: 'Ask teacher', url: 'https://example.com/lab.pdf', kind: 'link' }]);
  });

  it('asks before deleting and deletes the assignment with its blocks', async () => {
    await mount();
    await open({ kind: 'assignment', id: 'gc-essay' });
    await click('Delete', dialogTitled('Edit assignment')!);
    const confirm = dialogTitled('Delete assignment?')!;
    expect(confirm.textContent).toContain('1 scheduled session');
    await click('Delete assignment', confirm);
    expect(latest.doc.assignments).toHaveLength(0);
    expect(latest.doc.scheduleBlocks).toHaveLength(0);
    expect(latest.doc.deleted?.map((d) => d.id)).toEqual(['gc-essay']);
  });
});

describe('ClassEditor', () => {
  it('shows required errors only after a save attempt and does not save', async () => {
    await mount();
    await open({ kind: 'class' });
    const dialog = dialogTitled('New class')!;
    expect(dialog.textContent).not.toContain('Name is required.');
    await click('Add class', dialog);
    expect(dialog.textContent).toContain('Fix this problem before saving');
    expect(dialog.textContent).toContain('Name is required.');
    expect(latest.doc.classes).toHaveLength(1);
    expect(document.activeElement?.classList.contains('ed-problems')).toBe(true);
  });

  it('asks before discarding unsaved changes', async () => {
    await mount();
    await open({ kind: 'class' });
    const dialog = dialogTitled('New class')!;
    await type(control('Class name', dialog), 'Biology');
    await click('Cancel', dialog);
    expect(dialogTitled('Discard changes?')).toBeTruthy();
    await click('Cancel', dialogTitled('Discard changes?')!);
    expect(dialogTitled('New class')).toBeTruthy();
    await click(control<HTMLButtonElement>('Close', dialog));
    await click('Discard changes', dialogTitled('Discard changes?')!);
    expect(dialogTitled('New class')).toBeUndefined();
    expect(latest.doc.classes).toHaveLength(1);
  });

  it('closes without asking when nothing changed', async () => {
    await mount();
    await open({ kind: 'class', id: 'cls-eng' });
    await click('Cancel', dialogTitled('Edit class')!);
    expect(dialogTitled('Discard changes?')).toBeUndefined();
    expect(dialogTitled('Edit class')).toBeUndefined();
  });

  it('deleting a class with work asks whether to keep its assignments', async () => {
    await mount();
    await open({ kind: 'class', id: 'cls-eng' });
    await click('Delete', dialogTitled('Edit class')!);
    const choice = dialogTitled('Delete class?')!;
    expect(choice.textContent).toContain('1 assignment');
    await click('Delete class only', choice);
    expect(latest.doc.classes).toHaveLength(0);
    expect(latest.doc.assignments[0].classId).toBeUndefined();
    expect(latest.doc.assignments[0].title).toBe('Othello essay');
  });
});

describe('EventEditor', () => {
  it('creates a weekly commitment', async () => {
    await mount();
    await open({ kind: 'event' });
    const dialog = dialogTitled('New event or commitment')!;
    await type(control('Title', dialog), 'Piano');
    const weekly = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((r) => r.value === 'weekly')!;
    await click(weekly);
    await click(control<HTMLButtonElement>('Monday', dialog));
    await type(control('Start time', dialog), '17:00');
    await type(control('End time', dialog), '18:00');
    expect(dialog.textContent).toContain('Every Mon and Wed from Oct 7');
    await click('Add event', dialog);
    const event = latest.doc.events.find((e) => e.title === 'Piano')!;
    expect(event).toMatchObject({
      startTime: '17:00',
      endTime: '18:00',
      origin: 'user',
      recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'wed'], startDate: '2026-10-07' },
    });
    expect(event.date).toBeUndefined();
  });

  it('“Add school hours” starts as a weekly rule on school days', async () => {
    await mount(testDoc({ events: [] }));
    await open({ kind: 'event', initial: { category: 'school', startTime: '08:00', endTime: '15:00' } });
    const dialog = dialogTitled('New event or commitment')!;
    expect(control('Title', dialog).value).toBe('School');
    await click('Add event', dialog);
    const saved = latest.doc.events[0];
    expect(saved).toMatchObject({ title: 'School', category: 'school', startTime: '08:00', endTime: '15:00' });
    expect(saved.date).toBeUndefined();
    expect(saved.recurrence).toEqual({ frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-10-07' });
  });

  it('validates the end time and accepts midnight', async () => {
    await mount();
    await open({ kind: 'event', id: 'evt-fencing' });
    const dialog = dialogTitled('Edit event')!;
    await type(control('End time', dialog), '15:00');
    expect(dialog.textContent).toContain('End time must be later than the start time.');
    await click('Save', dialog);
    expect(latest.doc.events[0].endTime).toBe('18:00');
    await click(Array.from(dialog.querySelectorAll<HTMLLabelElement>('label')).find((l) => l.textContent === 'Midnight')!.querySelector('input')!);
    await click('Save', dialog);
    expect(latest.doc.events[0]).toMatchObject({ endTime: '24:00', overrides: ['endTime'] });
  });

  it('deletes after confirmation and leaves a tombstone for a generated event', async () => {
    await mount();
    await open({ kind: 'event', id: 'evt-fencing' });
    await click('Delete', dialogTitled('Edit event')!);
    await click('Delete event', dialogTitled('Delete event?')!);
    expect(latest.doc.events).toHaveLength(0);
    expect(latest.doc.deleted?.[0]).toMatchObject({ id: 'evt-fencing', collection: 'events', title: 'Fencing' });
  });
});

describe('AvailabilityEditor', () => {
  it('adds weekly study time', async () => {
    await mount();
    await open({ kind: 'availability' });
    const dialog = dialogTitled('Add study time')!;
    await type(control('Label', dialog), 'After school');
    await type(control('From', dialog), '15:30');
    await type(control('Until', dialog), '21:30');
    await click('Add study time', dialog);
    expect(latest.doc.availability[0]).toMatchObject({
      label: 'After school',
      startTime: '15:30',
      endTime: '21:30',
      recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-10-07' },
      origin: 'user',
    });
  });
});

describe('BlockEditor', () => {
  it('moving a generated block with the +15 min button pins it', async () => {
    await mount();
    await open({ kind: 'block', id: 'b-gen' });
    const dialog = dialogTitled('Edit scheduled work')!;
    await click('+15 min', dialog);
    expect(dialog.textContent).toContain('Saving a new time pins this block');
    await click('Save', dialog);
    expect(latest.doc.scheduleBlocks[0]).toMatchObject({ start: '2026-10-12T19:15:00', end: '2026-10-12T20:00:00', locked: true });
    expect(latest.doc.scheduleBlocks[0].overrides).toBeUndefined();
  });

  it('creates a block from the initial times with a free title, and rejects too-short blocks', async () => {
    await mount(testDoc({ scheduleBlocks: [] }));
    await open({ kind: 'block', initial: { start: '2026-10-13T16:00:00', end: '2026-10-13T16:45:00' } });
    const dialog = dialogTitled('Schedule work')!;
    await type(control('Title', dialog), 'Review flashcards');
    await type(control('End', dialog), '16:03');
    await click('Add to schedule', dialog);
    expect(latest.doc.scheduleBlocks).toHaveLength(0);
    expect(dialog.textContent).toContain('at least 5 minutes');
    await type(control('End', dialog), '16:30');
    await click('Add to schedule', dialog);
    expect(latest.doc.scheduleBlocks[0]).toMatchObject({ title: 'Review flashcards', start: '2026-10-13T16:00:00', end: '2026-10-13T16:30:00', origin: 'user' });
  });

  it('shows a "no longer exists" dialog for a missing item', async () => {
    await mount();
    await open({ kind: 'block', id: 'nope' });
    expect(dialogTitled('This scheduled block no longer exists')).toBeTruthy();
  });
});
