// @vitest-environment jsdom
// The list views in a DOM: assignments (one-click done + undo, subtasks,
// issues, safe links, planning), classes (delete with a choice),
// commitments (repeat rules, delete) and settings (save, example, delete all).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../../src/state/store';
import { ConfirmProvider, Toasts } from '../../src/ui/common';
import { EditorProvider } from '../../src/editors/EditorHost';

// The editor dialogs are tested on their own; here only the requests to open them matter.
const editorOpen = vi.hoisted(() => vi.fn());
vi.mock('../../src/editors/EditorHost', () => ({
  EditorProvider: ({ children }: { children: ReactNode }) => children,
  useEditors: () => ({ open: editorOpen, close: () => {} }),
}));
import { AssignmentsView } from '../../src/views/AssignmentsView';
import { ClassesView } from '../../src/views/ClassesView';
import { CommitmentsView } from '../../src/views/CommitmentsView';
import { SettingsView } from '../../src/views/SettingsView';
import { initialState, type AppState } from '../../src/state/reducer';
import type { ScheduleDocument } from '../../src/model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function testDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [
      { id: 'eng', name: 'English', color: '#2563EB', origin: 'user', topics: ['Unit 2: Othello'] },
      { id: 'math', name: 'Math', color: '#16A34A', origin: 'generated' },
    ],
    assignments: [
      {
        id: 'essay',
        classId: 'eng',
        title: 'Othello Essay',
        type: 'writing',
        due: '2026-10-09T23:59:00',
        estimatedMinutes: 120,
        origin: 'generated',
        overrides: ['priority'],
        priority: 'high',
        tasks: [
          { id: 'essay-t1', title: 'Outline', estimatedMinutes: 30 },
          { id: 'essay-t2', title: 'Draft', estimatedMinutes: 90, issues: [{ kind: 'ambiguity', message: 'Length unclear' }] },
        ],
        references: [
          { title: 'Rubric', url: 'https://example.org/rubric.pdf', kind: 'rubric', required: true },
          { title: 'Sneaky', url: 'javascript:alert(1)' },
        ],
        issues: [{ kind: 'conflict', message: 'Two due dates in the sources' }],
      },
      { id: 'problems', classId: 'math', title: 'Problems 12–24', type: 'problem_set', due: '2026-10-08', estimatedMinutes: 45 },
    ],
    events: [
      {
        id: 'school',
        title: 'School',
        category: 'school',
        startTime: '08:00',
        endTime: '15:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' },
        origin: 'user',
      },
      { id: 'mathclub', title: 'Math club', classId: 'math', date: '2026-10-08', startTime: '15:00', endTime: '16:00', origin: 'user' },
    ],
    availability: [
      {
        id: 'avl',
        label: 'After school',
        startTime: '15:30',
        endTime: '21:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-02' },
        origin: 'user',
      },
    ],
    scheduleBlocks: [
      { id: 'blk-1', assignmentId: 'essay', taskId: 'essay-t1', start: '2026-10-08T16:00:00', end: '2026-10-08T16:30:00', status: 'done', origin: 'user' },
    ],
    ...partial,
  };
}

let latest: AppState;
function Probe() {
  latest = useStore().state;
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement;

async function mount(view: ReactNode, doc: ScheduleDocument = testDoc()) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <StoreProvider initial={initialState(doc)}>
        <ConfirmProvider>
          <EditorProvider>
            <Probe />
            {view}
            <Toasts />
          </EditorProvider>
        </ConfirmProvider>
      </StoreProvider>,
    );
  });
}

function buttonByText(text: string | RegExp, scope: ParentNode = document): HTMLButtonElement {
  const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'));
  const button = buttons.find((b) => (typeof text === 'string' ? b.textContent?.trim() === text : text.test(b.textContent ?? '')));
  if (!button) throw new Error(`button "${text}" not found among: ${buttons.map((b) => b.textContent?.trim()).join(' | ')}`);
  return button;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  editorOpen.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0)); // Wed, Oct 7 2026, noon
  window.location.hash = '#/assignments';
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('AssignmentsView', () => {
  it('lists upcoming work by deadline with totals', async () => {
    await mount(<AssignmentsView />);
    const groups = Array.from(container.querySelectorAll('.ls-group h2')).map((h) => h.textContent);
    expect(groups).toEqual(['This week 2']);
    const titles = Array.from(container.querySelectorAll('.ls-asg-title button')).map((b) => b.textContent);
    // Date-only due Oct 8 (00:00) comes before Oct 9, 11:59 PM.
    expect(titles).toEqual(['Problems 12–24', 'Othello Essay']);
    const totals = container.querySelector('.ls-totals')!.textContent!;
    // Essay: Outline has 30 min done → 0 + 90 = 90 left; Problems: 45.
    expect(totals).toContain('2 h 15 m left');
    expect(totals).toContain('Not yet scheduled');
    const essay = Array.from(container.querySelectorAll('.ls-asg')).find((li) => li.textContent?.includes('Othello Essay'))!;
    expect(essay.textContent).toContain('1 h 30 m left');
    expect(essay.textContent).toContain('2 issues');
    expect(essay.textContent).toContain('Edited');
    expect(essay.textContent).toContain('in 2 days');
  });

  it('marks work done with one click and undoes it', async () => {
    await mount(<AssignmentsView />);
    const box = container.querySelector<HTMLInputElement>('input[aria-label="Mark “Problems 12–24” done"]')!;
    await click(box);
    expect(latest.doc.assignments.find((a) => a.id === 'problems')!.status).toBe('done');
    expect(latest.doc.assignments.find((a) => a.id === 'problems')!.completedAt).toBe('2026-10-07T12:00:00');
    // Hidden from the default "not done" list.
    expect(Array.from(container.querySelectorAll('.ls-asg-title button')).map((b) => b.textContent)).toEqual(['Othello Essay']);
    await click(buttonByText('Undo'));
    expect(latest.doc.assignments.find((a) => a.id === 'problems')!.status).toBeUndefined();
  });

  it('shows details: subtasks to check off, safe links only, issues to resolve', async () => {
    await mount(<AssignmentsView />);
    await click(buttonByText('Othello Essay'));
    const details = container.querySelector('.ls-asg-details')!;
    expect(details).toBeTruthy();

    // References: the https link is a link, the javascript: one is text.
    const links = Array.from(details.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('https://example.org/rubric.pdf');
    expect(links.some((h) => h?.startsWith('javascript'))).toBe(false);
    expect(details.textContent).toContain('Link not opened for safety');

    // Check off a subtask.
    const outline = Array.from(details.querySelectorAll<HTMLLabelElement>('.ls-tasks label')).find((l) => l.textContent?.includes('Outline'))!;
    await click(outline.querySelector('input')!);
    expect(latest.doc.assignments[0].tasks![0].status).toBe('done');

    // Resolve the assignment issue (it gets an id), dismiss the task issue.
    await click(buttonByText(/Resolve/, details.querySelector('.ls-issues')!));
    const issue = latest.doc.assignments[0].issues![0];
    expect(issue.status).toBe('resolved');
    expect(issue.id).toMatch(/^u-iss-[a-z0-9]{8}$/);
    await click(buttonByText('Dismiss', container.querySelector('.ls-issues')!));
    const taskIssue = latest.doc.assignments[0].tasks![1].issues![0];
    expect(taskIssue.status).toBe('dismissed');
    expect(taskIssue.id).toMatch(/^u-iss-/);
    // Changing issue status is not an edit of the generated item.
    expect(latest.doc.assignments[0].overrides).toEqual(['priority']);

    // "Allow /academic-schedule to update this again" clears overrides.
    await click(buttonByText(/Allow \/academic-schedule to update this again/));
    expect(latest.doc.assignments[0].overrides).toBeUndefined();
  });

  it('filters by search text and class', async () => {
    await mount(<AssignmentsView classId="math" />);
    expect(Array.from(container.querySelectorAll('.ls-asg-title button')).map((b) => b.textContent)).toEqual(['Problems 12–24']);
    expect(container.querySelector('.ls-totals')!.getAttribute('aria-label')).toBe('Workload totals for Math');
    await click(buttonByText(/Clear filters/));
    const search = container.querySelector<HTMLInputElement>('#asg-search')!;
    await type(search, 'draft');
    expect(Array.from(container.querySelectorAll('.ls-asg-title button')).map((b) => b.textContent)).toEqual(['Othello Essay']);
  });

  it('plans unscheduled work with the fixed rule and adds the reviewed sessions', async () => {
    await mount(<AssignmentsView />);
    await click(buttonByText('Plan unscheduled work'));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('A fixed rule, not AI');
    const boxes = Array.from(dialog.querySelectorAll<HTMLInputElement>('.plan-block input'));
    expect(boxes.length).toBeGreaterThan(1);
    // Leave the first proposed session out.
    await click(boxes[0]);
    const before = latest.doc.scheduleBlocks.length;
    await click(buttonByText(/^Add \d+ sessions?$/));
    const added = latest.doc.scheduleBlocks.slice(before);
    expect(added.length).toBe(boxes.length - 1);
    expect(added.every((b) => b.origin === 'planner' && b.id.startsWith('u-blk-'))).toBe(true);
    expect(document.querySelector('dialog')).toBeNull();
    await click(buttonByText('Undo'));
    expect(latest.doc.scheduleBlocks.length).toBe(before);
  });

  it('explains when there is no study time to plan into', async () => {
    await mount(<AssignmentsView />, testDoc({ availability: [] }));
    await click(buttonByText('Plan unscheduled work'));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('You have not entered any study time yet');
    expect(dialog.textContent).toContain('Not planned');
    expect(buttonByText('Add sessions', dialog).disabled).toBe(true);
  });

  it('asks before deleting and mentions done sessions', async () => {
    await mount(<AssignmentsView />);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="More actions for “Othello Essay”"]')!);
    await click(buttonByText('Delete'));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('you marked done');
    expect(dialog.textContent).toContain('remembers that you deleted it');
    await click(buttonByText('Delete assignment'));
    expect(latest.doc.assignments.map((a) => a.id)).toEqual(['problems']);
    expect(latest.doc.scheduleBlocks).toHaveLength(0);
    expect(latest.doc.deleted?.map((t) => t.id)).toContain('essay');
  });
});

describe('ClassesView', () => {
  it('shows class cards with counts and deletes a class keeping its work', async () => {
    await mount(<ClassesView />);
    const cards = Array.from(container.querySelectorAll('.ls-class'));
    expect(cards.map((c) => c.querySelector('h2')!.textContent)).toEqual(['English', 'Math']);
    expect(cards[0].textContent).toContain('Unit 2: Othello');
    expect(cards[0].textContent).toContain('1 h 30 m');
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="More actions for English"]')!);
    await click(buttonByText('Delete class'));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('English has 1 assignment');
    await click(buttonByText('Delete class', dialog));
    expect(latest.doc.classes.map((c) => c.id)).toEqual(['math']);
    expect(latest.doc.assignments.find((a) => a.id === 'essay')!.classId).toBeUndefined();
  });

  it('deletes a class with its assignments and events when asked', async () => {
    await mount(<ClassesView />);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="More actions for Math"]')!);
    await click(buttonByText('Delete class'));
    const dialog = document.querySelector('dialog')!;
    await click(dialog.querySelector<HTMLInputElement>('input[value="delete"]')!);
    await click(buttonByText(/Delete class and 1 assignment and 1 event/, dialog));
    expect(latest.doc.assignments.map((a) => a.id)).toEqual(['essay']);
    expect(latest.doc.events.map((e) => e.id)).toEqual(['school']);
    // The generated class and its generated assignment (no origin = generated) leave tombstones.
    expect(latest.doc.deleted?.map((t) => t.id).sort()).toEqual(['math', 'problems']);
  });
});

describe('CommitmentsView', () => {
  it('describes recurring commitments, one-time events and study time', async () => {
    await mount(<CommitmentsView />);
    const text = container.textContent!;
    expect(text).toContain('Every weekday from Sep 2');
    expect(text).toContain('Next: Wed, Oct 7');
    expect(text).toContain('Math club');
    expect(text).toContain('about 30 h per week');
    expect(container.querySelectorAll('.wg-col')).toHaveLength(7);
    expect(container.querySelector('button[aria-label^="School, Wednesday 8:00 AM"]')).toBeTruthy();
  });

  it('deletes an event after confirmation', async () => {
    await mount(<CommitmentsView />);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Delete Math club"]')!);
    await click(buttonByText('Delete', document.querySelector('dialog')!));
    expect(latest.doc.events.map((e) => e.id)).toEqual(['school']);
  });

  it('opens the editors from the grid and the lists', async () => {
    await mount(<CommitmentsView />);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label^="Study time: After school, Thursday"]')!);
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'availability', id: 'avl' });
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Edit School"]')!);
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'event', id: 'school' });
  });

  it('prompts for study time on an empty schedule', async () => {
    await mount(<CommitmentsView />, testDoc({ events: [], availability: [] }));
    expect(container.textContent).toContain('No commitments or study time yet');
    await click(buttonByText(/Add school hours/));
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'event', initial: { category: 'school', startTime: '08:00', endTime: '15:00' } });
  });
});

describe('editor requests from the assignment view', () => {
  it('creates work for the selected class and schedules a session for an assignment', async () => {
    await mount(<AssignmentsView classId="eng" />);
    await click(buttonByText('New assignment'));
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'assignment', initial: { classId: 'eng' } });
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="Edit “Othello Essay”"]')!);
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'assignment', id: 'essay' });
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="More actions for “Othello Essay”"]')!);
    await click(buttonByText('Schedule a work session'));
    // Noon now: the suggested session starts today at 4 PM, one hour long.
    expect(editorOpen).toHaveBeenLastCalledWith({ kind: 'block', initial: { assignmentId: 'essay', start: '2026-10-07T16:00:00', end: '2026-10-07T17:00:00' } });
  });

  it('plans a single assignment from its menu', async () => {
    await mount(<AssignmentsView />);
    await click(container.querySelector<HTMLButtonElement>('button[aria-label="More actions for “Problems 12–24”"]')!);
    await click(buttonByText('Plan unscheduled work', container.querySelector('.ls-asg-list')!));
    const dialog = document.querySelector('dialog')!;
    expect(dialog.querySelector('h2')!.textContent).toBe('Plan “Problems 12–24”');
    const titles = Array.from(dialog.querySelectorAll('.plan-block-what strong')).map((s) => s.textContent);
    expect(titles.length).toBeGreaterThan(0);
    expect(new Set(titles)).toEqual(new Set(['Problems 12–24']));
  });
});

describe('SettingsView', () => {
  it('saves only the settings the person changed', async () => {
    await mount(<SettingsView />);
    expect(container.textContent).toContain('date-only due dates are treated as due at the start of that day');
    const save = buttonByText(/Save settings/);
    expect(save.disabled).toBe(true);
    await click(buttonByText('End of the day (23:59)'));
    expect(save.disabled).toBe(false);
    await click(save);
    expect(latest.doc.settings).toEqual({ defaultDueTime: '23:59' });
  });

  it('loads the example schedule after confirmation and can restore the previous one', async () => {
    await mount(<SettingsView />);
    await click(buttonByText(/Load example schedule/));
    expect(document.querySelector('dialog')!.textContent).toContain('October 12, 2026');
    await click(buttonByText('Load example'));
    expect(latest.doc.assignments.length).toBeGreaterThan(3);
    expect(latest.doc.meta?.title).toContain('Fall 2026');
    expect(latest.snapshots).toHaveLength(1);
    expect(container.textContent).toContain('Example loaded');
    await click(buttonByText(/Restore/, container.querySelector('.ls-snapshots')!));
    await click(buttonByText('Restore', document.querySelector('dialog')!));
    expect(latest.doc.assignments.map((a) => a.id)).toEqual(['essay', 'problems']);
    expect(latest.snapshots).toHaveLength(2);
  });

  it('deletes all data only after typing the confirmation word', async () => {
    await mount(<SettingsView />);
    await click(buttonByText(/Delete all data/));
    const dialog = document.querySelector('dialog')!;
    const confirmButton = buttonByText(/Delete everything/, dialog);
    expect(confirmButton.disabled).toBe(true);
    await type(dialog.querySelector<HTMLInputElement>('#delete-all-confirm')!, 'delete');
    expect(confirmButton.disabled).toBe(false);
    await click(confirmButton);
    expect(latest.doc.assignments).toHaveLength(0);
    expect(latest.doc.classes).toHaveLength(0);
    expect(latest.snapshots[0].label).toBe('Before deleting all data');
    expect(latest.snapshots[0].doc.assignments).toHaveLength(2);
  });

  it('links to the format specification and states there is no AI', async () => {
    await mount(<SettingsView />);
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent?.includes('SCHEDULE_FORMAT.md'))!;
    expect(link.getAttribute('href')).toBe('https://github.com/1vibecoders/Google-Classroom-Bulk-Exporter/blob/main/academic-scheduler/SCHEDULE_FORMAT.md');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(container.textContent).toContain('No AI in this website.');
    expect(container.textContent).toContain('Schedule format 1.0');
  });
});
