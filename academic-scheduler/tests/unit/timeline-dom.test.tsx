// @vitest-environment jsdom
// Day and week views in a DOM: rendering, pointer drag/resize with snapping,
// Escape to cancel, dragging across days, keyboard moves, quick actions,
// creating a block from empty time, issues and empty states.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../../src/state/store';
import { ConfirmProvider, Toasts } from '../../src/ui/common';
import { EditorProvider } from '../../src/editors/EditorHost';
import { DayView } from '../../src/views/DayView';
import { WeekView } from '../../src/views/WeekView';
import { emptyDocument, initialState, type AppState } from '../../src/state/reducer';
import type { ScheduleDocument } from '../../src/model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const DAY = '2026-10-13'; // Tuesday

function testDoc(partial: Partial<ScheduleDocument> = {}): ScheduleDocument {
  return {
    schemaVersion: '1.0',
    classes: [
      { id: 'cls-eng', name: 'English', color: '#2563EB', origin: 'user' },
      { id: 'cls-math', name: 'Math', color: '#16A34A', origin: 'user' },
    ],
    assignments: [
      { id: 'a-eng', classId: 'cls-eng', title: 'Read Chapter 6', due: '2026-10-16T23:59:00', estimatedMinutes: 90 },
      { id: 'a-math', classId: 'cls-math', title: 'Problems 12–24', assessmentDate: '2026-10-15', type: 'test' },
    ],
    events: [
      {
        id: 'evt-school',
        title: 'School',
        category: 'school',
        startTime: '08:00',
        endTime: '15:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' },
        origin: 'user',
      },
    ],
    availability: [
      {
        id: 'avl-1',
        startTime: '15:30',
        endTime: '21:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-09-01' },
        origin: 'user',
      },
    ],
    scheduleBlocks: [
      { id: 'b-eng', assignmentId: 'a-eng', start: `${DAY}T16:00:00`, end: `${DAY}T16:45:00`, origin: 'generated' },
      { id: 'b-break', kind: 'break', title: 'Break', start: `${DAY}T16:45:00`, end: `${DAY}T17:00:00`, origin: 'user' },
      { id: 'b-math', assignmentId: 'a-math', start: `${DAY}T17:00:00`, end: `${DAY}T17:45:00`, origin: 'user' },
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
  fakeLayout();
}

/** jsdom has no layout: give every day column a rectangle (100 px wide, side by side, top at 0). */
function fakeLayout() {
  container.querySelectorAll<HTMLElement>('.tl-col').forEach((el, i) => {
    el.getBoundingClientRect = () => ({ top: 0, left: i * 100, right: (i + 1) * 100, bottom: 2000, width: 100, height: 2000, x: i * 100, y: 0, toJSON: () => ({}) }) as DOMRect;
  });
}

/** y position (px) of a time on a timeline that starts at 7:00 with `pxPerHour`. */
function y(time: string, pxPerHour = 56): number {
  const [h, m] = time.split(':').map(Number);
  return ((h * 60 + m - 7 * 60) * pxPerHour) / 60;
}

function blockButton(id: string): HTMLButtonElement {
  const el = Array.from(container.querySelectorAll<HTMLElement>('.tl-block')).find((b) => b.dataset.blockId === id);
  if (!el) throw new Error(`block ${id} not rendered`);
  return el.querySelector<HTMLButtonElement>('.tl-block-main')!;
}

function block(id: string) {
  return latest.doc.scheduleBlocks.find((b) => b.id === id)!;
}

async function pointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  await act(async () => {
    target.dispatchEvent(new FakePointerEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, pointerId: 1, pointerType: 'mouse' }));
  });
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
  if (!button) throw new Error(`button "${text}" not found`);
  return button;
}

beforeAll(() => {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
});

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

describe('DayView', () => {
  it('renders the day: header, all-day markers, events, blocks, Available bands and the agenda', async () => {
    await mount(<DayView date={DAY} />);
    expect(container.querySelector('h1')?.textContent).toBe('Tuesday, October 13');
    expect(container.querySelectorAll('.tl-block')).toHaveLength(3);
    expect(container.querySelector('.tl-event')?.textContent).toContain('School');
    expect(container.querySelector('.tl-available')?.textContent).toContain('Available');
    const agenda = Array.from(container.querySelectorAll('.side-agenda .agenda-row')).map((li) => li.textContent);
    expect(agenda[1]).toContain('3:30 PM');
    expect(agenda[1]).toContain('Available');
    expect(agenda[2]).toContain('English / Read Chapter 6');
    expect(agenda[3]).toContain('Break');
    expect(container.querySelector('.day-summary')?.textContent).toContain('Free study time');
  });

  it('drags a block 1 hour later in 5-minute steps, shows a ghost, and pins a generated block', async () => {
    await mount(<DayView date={DAY} />);
    const start = y('16:00') + 10;
    await pointer(blockButton('b-eng'), 'pointerdown', 50, start);
    await pointer(window, 'pointermove', 50, start + 30);
    await pointer(window, 'pointermove', 50, start + 56);
    const ghost = container.querySelector('.tl-ghost');
    expect(ghost?.textContent).toContain('5:00 – 5:45 PM');
    expect(block('b-eng').start).toBe(`${DAY}T16:00:00`);
    await pointer(window, 'pointerup', 50, start + 56);
    expect(container.querySelector('.tl-ghost')).toBeNull();
    expect(block('b-eng')).toMatchObject({ start: `${DAY}T17:00:00`, end: `${DAY}T17:45:00`, locked: true });
    expect(document.body.textContent).toContain('Moved “English / Read Chapter 6”');
  });

  it('resizes a block from its bottom edge', async () => {
    await mount(<DayView date={DAY} />);
    const handle = Array.from(container.querySelectorAll<HTMLElement>('.tl-block')).find((b) => b.dataset.blockId === 'b-math')!.querySelector('.tl-resize')!;
    const at = y('17:45') - 2;
    await pointer(handle, 'pointerdown', 50, at);
    await pointer(window, 'pointermove', 50, at + 28); // +30 minutes
    await pointer(window, 'pointerup', 50, at + 28);
    expect(block('b-math')).toMatchObject({ start: `${DAY}T17:00:00`, end: `${DAY}T18:15:00` });
    expect(block('b-math').locked).toBeUndefined();
  });

  it('keeps the distance between the pointer and the end while resizing (no jump when grabbed above the edge)', async () => {
    await mount(<DayView date={DAY} />);
    const handle = Array.from(container.querySelectorAll<HTMLElement>('.tl-block')).find((b) => b.dataset.blockId === 'b-math')!.querySelector('.tl-resize')!;
    const at = y('17:45') - 6; // about 6 minutes above the end
    await pointer(handle, 'pointerdown', 50, at);
    await pointer(window, 'pointermove', 50, at + 28); // +30 minutes
    await pointer(window, 'pointerup', 50, at + 28);
    expect(block('b-math')).toMatchObject({ start: `${DAY}T17:00:00`, end: `${DAY}T18:15:00` });
  });

  it('Escape cancels a drag', async () => {
    await mount(<DayView date={DAY} />);
    const start = y('16:00') + 10;
    await pointer(blockButton('b-eng'), 'pointerdown', 50, start);
    await pointer(window, 'pointermove', 50, start + 112);
    expect(container.querySelector('.tl-ghost')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('.tl-ghost')).toBeNull();
    await pointer(window, 'pointerup', 50, start + 112);
    expect(block('b-eng').start).toBe(`${DAY}T16:00:00`);
  });

  it('moves a block with Alt+Arrow keys', async () => {
    await mount(<DayView date={DAY} />);
    await act(async () => {
      blockButton('b-math').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    });
    expect(block('b-math')).toMatchObject({ start: `${DAY}T17:15:00`, end: `${DAY}T18:00:00` });
    await act(async () => {
      blockButton('b-math').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(block('b-math')).toMatchObject({ start: `${DAY}T17:15:00`, end: `${DAY}T17:45:00` });
  });

  it('opens quick actions on click; Mark done and the Move buttons work', async () => {
    await mount(<DayView date={DAY} />);
    await act(async () => blockButton('b-math').click());
    expect(document.querySelector('dialog')?.textContent).toContain('Move or resize');
    await act(async () => buttonByText('Next day').click());
    expect(block('b-math').start).toBe('2026-10-14T17:00:00');
    await act(async () => buttonByText('15 min longer').click());
    expect(block('b-math').end).toBe('2026-10-14T18:00:00');
    await act(async () => buttonByText('Mark done').click());
    expect(block('b-math').status).toBe('done');
    expect(block('b-math').completedAt).toBeTruthy();
  });

  it('creates a block from a click on empty time', async () => {
    await mount(<DayView date={DAY} />);
    const column = container.querySelector<HTMLElement>('.tl-col')!;
    await pointer(column, 'pointerdown', 50, y('19:10'));
    await pointer(window, 'pointerup', 50, y('19:10'));
    expect(document.querySelector('dialog')).not.toBeNull();
  });

  it('switches to the list and remembers it', async () => {
    await mount(<DayView date={DAY} />);
    await act(async () => buttonByText('List').click());
    expect(container.querySelector('.agenda-card .agenda')).not.toBeNull();
    expect(container.querySelector('.tl-grid')).toBeNull();
    expect(window.localStorage.getItem('academic-scheduler:view-mode:day')).toBe('list');
  });

  it('marks a block done from the agenda checkbox', async () => {
    await mount(<DayView date={DAY} />);
    const check = container.querySelector<HTMLInputElement>('.side-agenda input[aria-label="Done: English / Read Chapter 6"]')!;
    await act(async () => check.click());
    expect(block('b-eng').status).toBe('done');
  });

  it('resolves an issue of the day and gives it an id', async () => {
    await mount(<DayView date={DAY} />, testDoc({ issues: [{ kind: 'workload', message: 'Tuesday is tight.', date: DAY }] }));
    expect(container.querySelector('.day-issues')?.textContent).toContain('Tuesday is tight.');
    await act(async () => buttonByText('Resolve').click());
    expect(latest.doc.issues?.[0]).toMatchObject({ status: 'resolved' });
    expect(latest.doc.issues?.[0].id).toMatch(/^u-iss-/);
  });

  it('warns about over capacity in words and prompts for study time when there is none', async () => {
    const over = testDoc();
    over.scheduleBlocks.push({ id: 'b-long', title: 'Project', start: `${DAY}T18:00:00`, end: `${DAY}T23:30:00`, origin: 'user' });
    await mount(<DayView date={DAY} />, over);
    expect(container.querySelector('.day-summary')?.textContent).toContain('Over capacity');
    await act(async () => root!.unmount());
    container.remove();
    await mount(<DayView date={DAY} />, testDoc({ availability: [] }));
    expect(container.querySelector('.day-summary')?.textContent).toContain('Add your study time');
    expect(container.querySelector('.tl-available')).toBeNull();
  });

  it('guides a new user on an empty schedule', async () => {
    await mount(<DayView date={DAY} />, emptyDocument());
    expect(container.textContent).toContain('Welcome');
    expect(container.textContent).toContain('Add your classes');
    expect(container.querySelector('a[href="#/import"]')).not.toBeNull();
  });

  it('shows the remaining setup steps of a partly set-up schedule until hidden', async () => {
    const partial = { ...emptyDocument(), classes: [{ id: 'cls-eng', name: 'English', origin: 'user' as const }] };
    await mount(<DayView date={DAY} />, partial);
    const card = container.querySelector('.getting-started')!;
    expect(card.textContent).toContain('Finish setting up');
    expect(card.textContent).toContain('1 of 4 steps done');
    expect(card.textContent).toContain('Add study time');
    expect(card.textContent).not.toContain('Add a class');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Hide the setup guide"]')!.click());
    expect(container.querySelector('.getting-started')).toBeNull();
    expect(window.localStorage.getItem('academic-scheduler:setup-guide-hidden')).toBe('1');
  });

  it('shows no setup guide once everything is set up', async () => {
    await mount(<DayView date={DAY} />);
    expect(container.querySelector('.getting-started')).toBeNull();
  });

  it('counts unplanned free time from now on today', async () => {
    vi.setSystemTime(new Date(2026, 9, 13, 19, 0, 0));
    await mount(<DayView date={DAY} />);
    const summary = container.querySelector('.day-summary')!.textContent ?? '';
    // Free 3:30–9:30 PM; blocks 4:00–5:45 PM; from 7:00 PM: 2 h 30 m left.
    expect(summary).toContain('Unplanned from now');
    expect(summary).toContain('2 h 30 m');
  });
});

describe('WeekView', () => {
  it('shows seven days with due/assessment markers and planned vs free', async () => {
    await mount(<WeekView date={DAY} />);
    expect(container.querySelector('h1')?.textContent).toBe('Week of Oct 12 – 18');
    expect(container.querySelectorAll('.tl-col')).toHaveLength(7);
    const heads = Array.from(container.querySelectorAll('.wk-head')).map((h) => h.textContent ?? '');
    expect(heads[3]).toContain('Test');
    expect(heads[4]).toContain('Due 11:59 PM');
    expect(heads[1]).toContain('of 6 h free');
  });

  it('drags a block to another day', async () => {
    await mount(<WeekView date={DAY} />);
    const start = y('16:00', 44) + 5;
    await pointer(blockButton('b-eng'), 'pointerdown', 150, start);
    await pointer(window, 'pointermove', 250, start + 22); // Wednesday, +30 minutes
    await pointer(window, 'pointerup', 250, start + 22);
    expect(block('b-eng')).toMatchObject({ start: '2026-10-14T16:30:00', end: '2026-10-14T17:15:00', locked: true });
  });

  it('moves a block to the next day with Alt+Right', async () => {
    await mount(<WeekView date={DAY} />);
    await act(async () => {
      blockButton('b-math').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true }));
    });
    expect(block('b-math')).toMatchObject({ start: '2026-10-14T17:00:00', end: '2026-10-14T17:45:00' });
    expect(document.activeElement).toBe(blockButton('b-math'));
  });

  it('starts the week on Sunday when the settings say so', async () => {
    await mount(<WeekView date={DAY} />, testDoc({ settings: { weekStartsOn: 'sunday' } }));
    expect(container.querySelector('h1')?.textContent).toBe('Week of Oct 11 – 17');
  });
});
