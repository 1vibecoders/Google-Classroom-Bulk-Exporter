// @vitest-environment jsdom
// The Import wizard in a DOM: choosing a file or pasting text, error lists,
// unsupported versions, the preview (summary, sections, choices, field
// changes, passed sessions, stale exports), importing, undo, and re-importing
// the same file ("No changes").
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider, useStore } from '../../src/state/store';
import { ConfirmProvider, Toasts } from '../../src/ui/common';
import { ImportView } from '../../src/views/ImportView';
import { setPendingImport } from '../../src/views/import/pending';
import { EXPORT_IDS_KEY } from '../../src/lib/exportSchedule';
import { initialState, type AppState } from '../../src/state/reducer';
import { parseScheduleText } from '../../src/lib/validate';
import type { ScheduleDocument } from '../../src/model/types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TEXT = readFileSync(resolve(here, '../../examples/complete-schedule.json'), 'utf8');

function exampleDoc(): ScheduleDocument {
  const result = parseScheduleText(EXAMPLE_TEXT, { today: '2026-10-07' });
  if (!result.ok || !result.doc) throw new Error('example invalid');
  return result.doc;
}

let container: HTMLDivElement;
let root: Root;
let latest: AppState;

function Probe() {
  latest = useStore().state;
  return null;
}

function render(state: AppState = initialState()) {
  act(() => {
    root.render(
      <StoreProvider initial={state}>
        <ConfirmProvider>
          <Probe />
          <ImportView />
          <Toasts />
        </ConfirmProvider>
      </StoreProvider>,
    );
  });
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function buttons(label: string | RegExp): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter((b) =>
    typeof label === 'string' ? b.textContent?.trim() === label : label.test(b.textContent ?? ''),
  );
}

function button(label: string | RegExp): HTMLButtonElement {
  const found = buttons(label);
  if (!found.length) throw new Error(`no button ${label}; buttons: ${Array.from(container.querySelectorAll('button')).map((b) => b.textContent).join(' | ')}`);
  return found[0];
}

function click(el: HTMLElement) {
  act(() => {
    el.click();
  });
}

async function chooseFile(name: string, content: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([content], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();
}

async function paste(content: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, content);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  click(button(/Check pasted text/));
  await settle();
}

function importButtons(): HTMLButtonElement[] {
  return buttons(/^\s*Import\s*$/);
}

beforeEach(() => {
  setPendingImport(null);
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setPendingImport(null);
});

describe('step 1: choose a file', () => {
  it('shows a prominent drop zone, a file picker for .json and a paste box', () => {
    render();
    expect(text()).toContain('Drag your schedule file here');
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toContain('.json');
    expect(button(/Choose a file/)).toBeTruthy();
    expect(container.querySelector('textarea')).toBeTruthy();
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Choose a file');
  });

  it('lists validation errors with their paths, grouped by item, and imports nothing', async () => {
    render();
    const broken = JSON.parse(EXAMPLE_TEXT) as Record<string, unknown> & { assignments: Array<Record<string, unknown>> };
    broken.assignments[0].due = '2026-02-30';
    broken.assignments[1].priority = 'extreme';
    await chooseFile('broken.json', JSON.stringify(broken));
    expect(text()).toMatch(/This file can’t be imported: \d+ problems? found/);
    expect(text()).toContain('Nothing was imported.');
    expect(text()).toContain('Assignment “Othello Essay”');
    const paths = Array.from(container.querySelectorAll('code.imp-path')).map((c) => c.textContent);
    expect(paths).toContain('assignments[0].due');
    expect(paths.some((p) => p?.startsWith('assignments[1].priority'))).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(latest.doc.assignments).toHaveLength(0);
  });

  it('shows at most 50 problems and a count of the rest', async () => {
    render();
    const doc = { schemaVersion: '1.0', classes: Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: '', color: 'red' })), assignments: [], events: [], availability: [], scheduleBlocks: [] };
    await chooseFile('many.json', JSON.stringify(doc));
    expect(container.querySelectorAll('.imp-error-list li')).toHaveLength(50);
    expect(text()).toMatch(/and \d+ more problems not shown \(\d+ in all\)/);
  });

  it('rejects unsupported schema versions with a clear message', async () => {
    render();
    await paste('{"schemaVersion": "2.0", "classes": []}');
    expect(text()).toContain('Unsupported schedule format version');
    expect(text()).toContain('2.0');
    expect(text()).toContain('Nothing was imported.');
  });

  it('reports text that is not JSON with line and column', async () => {
    render();
    await paste('{ "schemaVersion": "1.0", ');
    expect(text()).toContain('This is not a valid JSON file');
    expect(text()).toMatch(/line \d+, column \d+/);
  });

  it('explains a Classroom ZIP without reading it', async () => {
    render();
    await chooseFile('Classroom export.zip', 'PK…');
    expect(text()).toContain('is not a schedule file');
    expect(text()).toContain('/academic-schedule');
  });
});

describe('step 2: preview, step 3: import', () => {
  it('previews a new schedule like the requirements’ summary, imports it, and can undo', async () => {
    render();
    await chooseFile('complete-schedule.json', EXAMPLE_TEXT);
    expect(text()).toContain('Schedule Import');
    const newLine = Array.from(container.querySelectorAll('.imp-line')).find((l) => l.textContent?.startsWith('New:'));
    expect(newLine?.textContent).toContain('+ 6 assignments');
    expect(newLine?.textContent).toContain('+ 12 scheduled work blocks');
    expect(container.querySelector('[aria-current="step"]')?.textContent).toContain('Review the changes');
    // Sections with item labels.
    expect(container.querySelector('#imp-sec-new')).toBeTruthy();
    expect(text()).toContain('Othello Essay');
    // Nothing changed yet.
    expect(latest.doc.assignments).toHaveLength(0);

    const [importButton] = importButtons();
    expect(importButton.disabled).toBe(false);
    click(importButton);
    expect(text()).toContain('Schedule imported');
    expect(text()).toContain('Added:');
    expect(latest.doc.assignments).toHaveLength(6);
    expect(latest.snapshots[0].label).toBe('Import complete-schedule.json');
    expect(container.querySelector('a[href="#/assignments"]')).toBeTruthy();
    expect(container.querySelector('a[href^="#/day/"]')).toBeTruthy();
    expect(text()).toMatch(/Go to \w{3}, Oct \d+/);

    click(button(/Undo import/));
    expect(text()).toContain('Import undone');
    expect(latest.doc.assignments).toHaveLength(0);

    // Review again → import again.
    click(button(/Review “complete-schedule.json” again/));
    expect(text()).toContain('Schedule Import');
  });

  it('shows "No changes" when the same file is imported again', async () => {
    render(initialState(exampleDoc()));
    await chooseFile('complete-schedule.json', EXAMPLE_TEXT);
    expect(text()).toContain('No changes.');
    expect(text()).toMatch(/Unchanged:\s*27 items/);
    for (const b of importButtons()) expect(b.disabled).toBe(true);
    expect(text()).toContain('Nothing to import: no changes.');
  });

  it('lists field changes before → after, offers settings unticked, and follows the choices', async () => {
    const current = exampleDoc();
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    file.assignments[0].due = '2026-10-20T23:59:00';
    file.settings = { ...(file.settings ?? {}), breakMinutes: 15 };
    render(initialState(current));
    await chooseFile('update.json', JSON.stringify(file));

    const updatedLine = Array.from(container.querySelectorAll('.imp-line')).find((l) => l.textContent?.startsWith('Updated:'));
    expect(updatedLine?.textContent).toContain('~ 1 due date');
    const fields = Array.from(container.querySelectorAll('.imp-fields li')).map((li) => li.textContent);
    expect(fields.some((f) => f?.includes('Due date:') && f.includes('Oct 16, 11:59 PM') && f.includes('Oct 20, 11:59 PM'))).toBe(true);

    const settings = container.querySelector('#imp-sec-setting')!;
    const box = settings.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(box.checked).toBe(false);
    expect(settings.textContent).toContain('Use the file’s value');
    expect(settings.textContent).toContain('0 of 1 ticked');
    click(box);
    expect(box.checked).toBe(true);
    expect(settings.textContent).toContain('1 of 1 ticked');

    click(importButtons()[0]);
    expect(latest.doc.settings?.breakMinutes).toBe(15);
    expect(latest.doc.assignments.find((a) => a.id === file.assignments[0].id)?.due).toBe('2026-10-20T23:59:00');
    expect(text()).toContain('Updated:');
  });

  it('select all / none toggles every choosable row of a section', async () => {
    const current = exampleDoc();
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    file.settings = { ...(file.settings ?? {}), breakMinutes: 15, dayStartTime: '06:00' };
    render(initialState(current));
    await chooseFile('settings.json', JSON.stringify(file));
    const section = container.querySelector('#imp-sec-setting')!;
    const boxes = () => Array.from(section.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes().map((b) => b.checked)).toEqual([false, false]);
    click(Array.from(section.querySelectorAll('button')).find((b) => b.textContent === 'Select all')!);
    expect(boxes().map((b) => b.checked)).toEqual([true, true]);
    click(Array.from(section.querySelectorAll('button')).find((b) => b.textContent === 'Select none')!);
    expect(boxes().map((b) => b.checked)).toEqual([false, false]);
  });

  it('warns about a file made from an older export', async () => {
    localStorage.setItem(EXPORT_IDS_KEY, JSON.stringify(['u-exp-newest01', 'u-exp-older001']));
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    file.meta = { ...(file.meta ?? {}), basedOn: 'u-exp-older001' };
    render(initialState(exampleDoc()));
    await chooseFile('old.json', JSON.stringify(file));
    expect(text()).toContain('This file was made from an older export');
  });

  it('only calls a file "made from your latest export" when this browser made that export', async () => {
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    file.meta = { ...(file.meta ?? {}), basedOn: 'u-exp-latest01' };
    render(initialState(exampleDoc()));
    // No export recorded in this browser (e.g. the export was made on another device).
    await chooseFile('elsewhere.json', JSON.stringify(file));
    expect(text()).not.toContain('Made from your latest export of this schedule.');
    expect(text()).toContain('Made from an export of a schedule that this browser has no record of');
  });

  it('says a file was made from the latest export when it was', async () => {
    localStorage.setItem(EXPORT_IDS_KEY, JSON.stringify(['u-exp-latest01']));
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    file.meta = { ...(file.meta ?? {}), basedOn: 'u-exp-latest01' };
    render(initialState(exampleDoc()));
    await chooseFile('latest.json', JSON.stringify(file));
    expect(text()).toContain('Made from your latest export of this schedule.');
    expect(text()).not.toContain('older export');
  });

  it('asks about sessions that have passed and keeps them once marked done', async () => {
    // Import time: Oct 11, 10 PM; the file was made at Oct 11, 7:30 PM.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 11, 22, 0, 0));
    try {
      const current = exampleDoc();
      // A generated planned session that started after the file was made but ended before the import;
      // the file has it at a later time, so the preview would move it.
      const block = current.scheduleBlocks.find((b) => (b.status ?? 'planned') === 'planned' && (b.origin ?? 'generated') === 'generated' && !b.locked && b.start > '2026-10-11T19:30:00');
      expect(block).toBeTruthy();
      block!.start = '2026-10-11T19:40:00';
      block!.end = '2026-10-11T20:00:00';
      render(initialState(current));
      await chooseFile('moved.json', EXAMPLE_TEXT);
      expect(text()).toContain('This session has passed — did you do it?');
      click(button(/Mark done/));
      expect(latest.doc.scheduleBlocks.find((b) => b.id === block!.id)?.status).toBe('done');
      expect(text()).not.toContain('This session has passed — did you do it?');
    } finally {
      vi.useRealTimers();
    }
  });

  it('blocks a file whose IDs mean something else in the schedule', async () => {
    const current = exampleDoc();
    const file = JSON.parse(EXAMPLE_TEXT) as ScheduleDocument;
    // A class that uses the ID of an existing assignment.
    file.classes.push({ id: current.assignments[0].id, name: 'Clash', color: '#16A34A' });
    file.assignments = file.assignments.filter((a) => a.id !== current.assignments[0].id);
    file.scheduleBlocks = file.scheduleBlocks.filter((b) => b.assignmentId !== current.assignments[0].id);
    file.events = file.events.filter((e) => e.assignmentId !== current.assignments[0].id);
    file.issues = (file.issues ?? []).filter((i) => i.itemId !== current.assignments[0].id);
    render(initialState(current));
    await chooseFile('clash.json', JSON.stringify(file));
    expect(text()).toContain('can’t be combined with your schedule');
    expect(importButtons()).toHaveLength(0);
    click(button('Choose another file'));
    expect(text()).toContain('Drag your schedule file here');
  });

  it('keeps the preview while visiting other pages', async () => {
    render();
    await chooseFile('complete-schedule.json', EXAMPLE_TEXT);
    expect(text()).toContain('Schedule Import');
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(text()).toContain('Schedule Import');
    click(buttons('Cancel')[0]);
    expect(text()).toContain('Drag your schedule file here');
  });
});
