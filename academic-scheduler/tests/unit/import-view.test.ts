// Pure helpers of the Import wizard (src/views/import/logic.ts).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  actionLabel,
  buildSections,
  checkChosenFile,
  diffDocuments,
  diffLines,
  diffShort,
  errorsAsText,
  firstImportedDate,
  groupErrors,
  isChosen,
  kindLabel,
  neverSetSettingKeys,
  problemsByRow,
  rawItemName,
  selectionFor,
  setChoices,
  stableStringify,
  tryParseJson,
} from '../../src/views/import/logic';
import { checkImport, defaultSelection, planImport, type ImportChange } from '../../src/lib/importDiff';
import { parseScheduleText, validateDocument } from '../../src/lib/validate';
import { emptyDocument } from '../../src/state/reducer';
import type { ScheduleDocument } from '../../src/model/types';
import { MAX_IMPORT_BYTES } from '../../src/model/constants';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TEXT = readFileSync(resolve(here, '../../examples/complete-schedule.json'), 'utf8');
const NOW = '2026-10-11T20:00:00';

function example(): ScheduleDocument {
  const result = parseScheduleText(EXAMPLE_TEXT, { today: '2026-10-07' });
  if (!result.ok || !result.doc) throw new Error('example invalid');
  return result.doc;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function row(partial: Partial<ImportChange>): ImportChange {
  return {
    key: 'assignments:a',
    collection: 'assignments',
    id: 'a',
    category: 'new',
    label: 'A',
    fields: [],
    defaultSelected: true,
    selectable: false,
    ...partial,
  };
}

describe('checkChosenFile', () => {
  it('rejects files over 10 MB before reading them', () => {
    const problem = checkChosenFile({ name: 'big.json', size: MAX_IMPORT_BYTES + 1 });
    expect(problem?.title).toBe('This file is too large');
    expect(problem?.message).toContain('10 MB');
    expect(checkChosenFile({ name: 'ok.json', size: MAX_IMPORT_BYTES })).toBeNull();
  });

  it('explains files that are never schedule files (e.g. a Classroom export ZIP)', () => {
    expect(checkChosenFile({ name: 'Classroom Export.zip', size: 1000 })?.message).toContain('/academic-schedule');
    expect(checkChosenFile({ name: 'syllabus.PDF', size: 1000 })?.title).toBe('“syllabus.PDF” is not a schedule file');
    expect(checkChosenFile({ name: 'schedule', size: 10 })).toBeNull();
    expect(checkChosenFile({ name: 'schedule.txt', size: 10 })).toBeNull();
  });

  it('reports an empty file', () => {
    expect(checkChosenFile({ name: 'schedule.json', size: 0 })?.title).toBe('This file is empty');
  });
});

describe('groupErrors', () => {
  const raw = { assignments: [{ title: 'Othello Essay' }, { title: 'Lab report' }], scheduleBlocks: [{ start: '2026-10-12T16:00:00' }] };

  it('groups errors by the item they are in, named from the file, in order of appearance', () => {
    const grouped = groupErrors(
      [
        { path: 'assignments[1].due', message: 'bad due' },
        { path: 'meta.generatedAt', message: 'bad time' },
        { path: 'assignments[1].tasks[0].title', message: 'blank' },
        { path: 'scheduleBlocks[0].end', message: 'before start' },
        { path: '', message: 'root problem' },
        { path: 'settings.dayStartTime', message: 'bad setting' },
        { path: 'events[4].title', message: 'missing' },
      ],
      raw,
    );
    expect(grouped.total).toBe(7);
    expect(grouped.shown).toBe(7);
    expect(grouped.groups.map((g) => [g.key, g.label, g.issues.length])).toEqual([
      ['assignments[1]', 'Assignment “Lab report”', 2],
      ['meta', 'File information (meta)', 1],
      ['scheduleBlocks[0]', 'Scheduled work block “2026-10-12T16:00:00”', 1],
      ['', 'Whole file', 1],
      ['settings', 'Settings', 1],
      ['events[4]', 'Event 5', 1],
    ]);
  });

  it('keeps the first 50 and counts the rest', () => {
    const errors = Array.from({ length: 73 }, (_, i) => ({ path: `classes[${i}].name`, message: 'blank' }));
    const grouped = groupErrors(errors);
    expect(grouped.shown).toBe(50);
    expect(grouped.total).toBe(73);
    expect(grouped.groups).toHaveLength(50);
    expect(errorsAsText(errors).split('\n')).toHaveLength(73);
    expect(errorsAsText([{ path: '', message: 'x' }, { path: 'a', message: 'y' }])).toBe('x\na: y');
  });

  it('names items only from plain data and survives non-JSON text', () => {
    expect(rawItemName(raw, 'assignments', 0)).toBe('Othello Essay');
    expect(rawItemName(raw, 'assignments', 9)).toBeUndefined();
    expect(rawItemName({ classes: [{ name: `  ${'x'.repeat(200)}  ` }] }, 'classes', 0)).toHaveLength(80);
    expect(rawItemName(null, 'classes', 0)).toBeUndefined();
    expect(tryParseJson('{nope')).toBeUndefined();
    expect(tryParseJson('﻿{"a":1}')).toEqual({ a: 1 });
  });
});

describe('preview sections and choices', () => {
  const base = example();

  function modified(): ScheduleDocument {
    const file = clone(base);
    file.assignments[0].due = '2026-10-20T23:59:00';
    file.settings = { ...(file.settings ?? {}), breakMinutes: 15 };
    file.scheduleBlocks = file.scheduleBlocks.slice(2);
    file.meta = { ...(file.meta ?? {}), basedOn: 'u-exp-base0001' };
    return validateDocument(file).doc!;
  }

  it('orders sections with changes first and lists toggleable keys', () => {
    const plan = planImport(base, modified(), NOW);
    const sections = buildSections(plan);
    const order = sections.map((s) => s.category);
    expect(order.indexOf('updated')).toBeLessThan(order.indexOf('setting'));
    expect(order[order.length - 1]).toBe('unchanged');
    const settings = sections.find((s) => s.category === 'setting')!;
    expect(settings.toggleKeys).toEqual(['settings:breakMinutes']);
    expect(settings.help).toMatch(/Yours are kept/);
    // Every row appears in exactly one section, except rows that follow another row.
    const shown = sections.flatMap((s) => s.rows.map((r) => r.key));
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.length).toBe(plan.changes.filter((c) => !(c.follows && !c.selectable)).length);
  });

  it('turns choices into the selection: defaults, ticks, unticks, unknown keys ignored', () => {
    const plan = planImport(base, modified(), NOW);
    expect(selectionFor(plan, {})).toEqual(defaultSelection(plan));
    const ticked = setChoices({}, ['settings:breakMinutes', 'nope:x'], true);
    const sel = selectionFor(plan, ticked);
    expect(sel.has('settings:breakMinutes')).toBe(true);
    expect(sel.has('nope:x')).toBe(false);
    const settingRow = plan.changes.find((c) => c.key === 'settings:breakMinutes')!;
    expect(isChosen(settingRow, {})).toBe(false);
    expect(isChosen(settingRow, ticked)).toBe(true);
    // The result follows the choice.
    const check = checkImport(base, modified(), plan, sel, NOW);
    expect(check.ok).toBe(true);
    expect(check.doc.settings?.breakMinutes).toBe(15);
  });

  it('never ticks rows that cannot be chosen', () => {
    expect(isChosen(row({ selectable: false, defaultSelected: true }), {})).toBe(false);
    expect(isChosen(row({ selectable: true, defaultSelected: true, blockedReason: 'used' }), { 'assignments:a': true })).toBe(false);
    expect(isChosen(row({ selectable: true, defaultSelected: true }), {})).toBe(true);
    expect(isChosen(row({ selectable: true, defaultSelected: true }), { 'assignments:a': false })).toBe(false);
  });

  it('describes what ticking does and what a row is about', () => {
    expect(actionLabel(row({ category: 'previouslyDeleted' }))).toBe('Restore');
    expect(actionLabel(row({ category: 'possibleDuplicate' }))).toBe('Add anyway');
    expect(actionLabel(row({ category: 'missing', removes: true }))).toBe('Remove');
    expect(actionLabel(row({ category: 'outdated', removes: true }))).toBe('Remove');
    expect(actionLabel(row({ category: 'yourItems' }))).toBe('Use the file’s version');
    expect(actionLabel(row({ category: 'yourItems', removes: true }))).toBe('Delete');
    expect(actionLabel(row({ category: 'kept', aspect: 'status' }))).toBe('Use the file’s status');
    expect(actionLabel(row({ category: 'kept', aspect: 'deletedInFile', removes: true }))).toBe('Delete');
    expect(actionLabel(row({ category: 'removedFromSource', aspect: 'sourceState' }))).toBe('Mark as removed from source');
    expect(actionLabel(row({ category: 'setting', aspect: 'setting', collection: 'settings' }))).toBe('Use the file’s value');
    expect(actionLabel(row({ category: 'updated', selectable: true }))).toBe('Apply this update');
    expect(kindLabel(row({ collection: 'scheduleBlocks' }))).toBe('Scheduled work block');
    expect(kindLabel(row({ parentId: 'a' }))).toBe('Task');
    expect(kindLabel(row({ collection: 'settings' }))).toBe('Setting');
  });

  it('offers the settings the current schedule never set', () => {
    const file = clone(base);
    file.settings = { ...(file.settings ?? {}), dayStartTime: '06:00' };
    const current = clone(base);
    delete current.settings;
    const plan = planImport(current, validateDocument(file).doc!, NOW);
    expect(neverSetSettingKeys(plan)).toContain('settings:dayStartTime');
  });

  it('splits problems by row', () => {
    const { byKey, general } = problemsByRow([
      { key: 'a', path: 'x', message: 'one' },
      { key: 'a', path: 'y', message: 'two' },
      { path: 'z', message: 'three' },
    ]);
    expect(byKey.get('a')).toEqual(['one', 'two']);
    expect(general).toEqual([{ path: 'z', message: 'three' }]);
  });
});

describe('what an import changed', () => {
  it('counts added, updated and removed items and changed settings', () => {
    const before = example();
    const after = clone(before);
    after.assignments[0].estimatedMinutes = 999;
    after.scheduleBlocks.pop();
    after.classes.push({ id: 'u-cls-new00001', name: 'Chemistry', color: '#16A34A', origin: 'user' });
    after.settings = { ...(after.settings ?? {}), breakMinutes: 20 };
    const diff = diffDocuments(before, after);
    expect(diff).toMatchObject({ added: { classes: 1 }, updated: { assignments: 1 }, removed: { scheduleBlocks: 1 }, settings: 1, changed: true });
    expect(diffLines(diff).map((l) => `${l.label}: ${l.text}`)).toEqual([
      'Added: 1 class',
      'Updated: 1 assignment',
      'Removed: 1 scheduled work block',
      'Settings: 1 changed',
    ]);
    expect(diffShort(diff)).toBe('1 added · 1 updated · 1 removed · 1 setting');
  });

  it('ignores key order and treats identical documents as unchanged', () => {
    const doc = example();
    const reordered = JSON.parse(stableStringify(doc)) as ScheduleDocument;
    const diff = diffDocuments(doc, reordered);
    expect(diff.changed).toBe(false);
    expect(diffLines(diff)).toEqual([]);
    expect(stableStringify({ b: 1, a: [{ d: 2, c: undefined }] })).toBe('{"a":[{"d":2}],"b":1}');
  });

  it('notices changes outside items (meta, issues)', () => {
    const doc = example();
    const after = clone(doc);
    after.meta = { ...(after.meta ?? {}), title: 'Another title' };
    const diff = diffDocuments(doc, after);
    expect(diff.changed).toBe(true);
    expect(diffShort(diff)).toBe('');
  });

  it('finds the first day worth opening after an import', () => {
    const empty = emptyDocument();
    const doc = example();
    expect(firstImportedDate(empty, doc, '2026-10-07')).toBe(doc.scheduleBlocks.map((b) => b.start.slice(0, 10)).sort()[0]);
    expect(firstImportedDate(empty, doc, '2026-10-13')! >= '2026-10-13').toBe(true);
    expect(firstImportedDate(doc, doc, '2026-10-07')).toBeUndefined();
    const onlyAssignments = { ...doc, scheduleBlocks: [] };
    expect(firstImportedDate(empty, onlyAssignments, '2026-10-01')).toMatch(/^2026-10-\d\d$/);
  });
});
