import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME, APP_VERSION } from '../../src/model/constants';
import type { ScheduleDocument } from '../../src/model/types';
import {
  EXPORT_IDS_KEY,
  createExport,
  exportDocument,
  exportFileName,
  exportJson,
  recentExportIds,
  rememberExportId,
} from '../../src/lib/exportSchedule';
import { parseScheduleText, validateDocument } from '../../src/lib/validate';

const ROOT = join(__dirname, '..', '..');
const NOW = '2026-10-07T18:30:00';
const OPTIONS = { exportId: 'u-exp-test0001', timezone: 'America/New_York' };

type Json = Record<string, any>;

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'schedule-1.0.schema.json'), 'utf8'));
const schemaValidate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

function loadDoc(path: string): ScheduleDocument {
  const result = parseScheduleText(readFileSync(join(ROOT, path), 'utf8'), { today: '2026-10-07' });
  if (!result.ok || !result.doc) throw new Error(`${path}: ${JSON.stringify(result.errors)}`);
  return result.doc;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

/**
 * Content comparison that ignores what § 17 allows the export to change:
 * collection order, the meta block, default origin written explicitly,
 * `locked: false`, empty optional arrays, `:00` seconds.
 */
function content(doc: ScheduleDocument): Json {
  const clean = (value: unknown, isItem = false): unknown => {
    if (Array.isArray(value)) return value.map((v) => clean(v));
    if (!value || typeof value !== 'object') {
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
    }
    const out: Json = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || (key === 'locked' && v === false)) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = clean(v, key === 'tasks');
    }
    if (isItem && out.origin === undefined) out.origin = 'generated';
    return out;
  };
  const byId = (list: unknown[]) =>
    Object.fromEntries(
      list.map((item) => {
        const c = clean(item, true) as Json;
        if (Array.isArray(c.tasks)) c.tasks = c.tasks.map((t: Json) => ({ origin: 'generated', ...t }));
        return [c.id, c];
      }),
    );
  return {
    settings: clean(doc.settings ?? {}),
    classes: byId(doc.classes),
    assignments: byId(doc.assignments),
    events: byId(doc.events),
    availability: byId(doc.availability),
    scheduleBlocks: byId(doc.scheduleBlocks),
    issues: clean(doc.issues ?? []),
    deleted: clean(doc.deleted ?? []),
    extensions: Object.fromEntries(Object.entries(doc).filter(([k]) => k.startsWith('x-'))),
  };
}

describe('exportDocument', () => {
  const complete = loadDoc('examples/complete-schedule.json');

  it('produces a valid file (validateDocument and the JSON Schema) for the complete example', () => {
    const exported = exportDocument(complete, NOW, OPTIONS);
    const result = validateDocument(exported, { today: '2026-10-07' });
    expect(result.errors).toEqual([]);
    expect(schemaValidate(exported), JSON.stringify(schemaValidate.errors)).toBe(true);
  });

  it('round trip: export → validate → the same content', () => {
    const exported = exportDocument(complete, NOW, OPTIONS);
    const reimported = validateDocument(JSON.parse(JSON.stringify(exported))).doc!;
    expect(content(reimported)).toEqual(content(complete));
  });

  it('is idempotent and deterministic', () => {
    const first = exportJson(complete, NOW, OPTIONS);
    const again = exportJson(complete, NOW, OPTIONS);
    expect(again).toBe(first);
    const reexported = exportJson(validateDocument(JSON.parse(first)).doc!, NOW, OPTIONS);
    expect(reexported).toBe(first);
  });

  it('does not depend on the order of collections or of object keys in the current schedule', () => {
    const shuffled = JSON.parse(JSON.stringify(complete)) as Json;
    for (const key of ['classes', 'assignments', 'events', 'availability', 'scheduleBlocks']) shuffled[key].reverse();
    shuffled.assignments = shuffled.assignments.map((a: Json) => Object.fromEntries(Object.entries(a).reverse()));
    expect(exportJson(shuffled as ScheduleDocument, NOW, OPTIONS)).toBe(exportJson(complete, NOW, OPTIONS));
  });

  it('does not modify its input', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(complete)) as ScheduleDocument);
    expect(() => exportDocument(frozen, NOW, OPTIONS)).not.toThrow();
  });

  it('writes meta per § 17 and D25', () => {
    const doc = {
      ...complete,
      meta: {
        ...complete.meta,
        exportId: 'u-exp-oldoldol',
        basedOn: 'u-exp-h7w2c9qe',
        generatedAt: '2026-10-01T08:00:00',
        timezone: 'Europe/Paris',
        'x-meta': { kept: true },
      },
    } as ScheduleDocument;
    const meta = exportDocument(doc, '2026-10-07T18:30', OPTIONS).meta as Json;
    expect(meta).toEqual({
      title: complete.meta!.title,
      generatedAt: '2026-10-07T18:30:00',
      generator: { name: APP_NAME, version: APP_VERSION },
      timezone: 'America/New_York',
      exportId: 'u-exp-test0001',
      sources: complete.meta!.sources,
      'x-meta': { kept: true },
    });
    expect(Object.keys(meta)).toEqual(['title', 'generatedAt', 'generator', 'timezone', 'exportId', 'sources', 'x-meta']);
  });

  it('writes a fresh u-exp- exportId and the browser time zone by default', () => {
    const a = exportDocument(complete, NOW).meta!;
    const b = exportDocument(complete, NOW).meta!;
    expect(a.exportId).toMatch(/^u-exp-[a-z0-9]{8}$/);
    expect(a.exportId).not.toBe(b.exportId);
    expect(a.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(a.title).toBe(complete.meta!.title);
  });

  it('writes a minimal meta for a schedule that never had one', () => {
    const exported = exportDocument({ schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [] }, NOW, OPTIONS);
    expect(exported).toEqual({
      schemaVersion: '1.0',
      meta: { generatedAt: NOW, generator: { name: APP_NAME, version: APP_VERSION }, timezone: 'America/New_York', exportId: 'u-exp-test0001' },
      classes: [],
      assignments: [],
      events: [],
      availability: [],
      scheduleBlocks: [],
    });
    expect(validateDocument(exported).ok).toBe(true);
  });

  it('sorts collections deterministically (§ 17)', () => {
    const doc: ScheduleDocument = {
      schemaVersion: '1.0',
      classes: [
        { id: 'c3', name: 'biology' },
        { id: 'c2', name: 'Art' },
        { id: 'c1', name: 'Biology' },
      ],
      assignments: [
        { id: 'a-undated', title: 'Aaa' },
        { id: 'a-late', title: 'Zebra', due: '2026-10-20' },
        { id: 'a-time', title: 'Beta', due: '2026-10-16T09:00:00' },
        { id: 'a-date', title: 'Gamma', due: '2026-10-16' },
        { id: 'a-assess', title: 'Alpha', assessmentDate: '2026-10-16T09:00:00' },
      ],
      events: [
        { id: 'e2', title: 'Late', date: '2026-10-09', startTime: '18:00', endTime: '19:00' },
        { id: 'e1', title: 'Rec', startTime: '08:00', endTime: '15:00', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-09-01' } },
        { id: 'e3', title: 'All day', date: '2026-10-09', allDay: true },
      ],
      availability: [
        { id: 'w2', date: '2026-10-09', startTime: '18:00', endTime: '20:00' },
        { id: 'w1', date: '2026-10-09', startTime: '10:00', endTime: '12:00' },
      ],
      scheduleBlocks: [
        { id: 'b2', title: 'x', start: '2026-10-09T18:00:00', end: '2026-10-09T18:30:00' },
        { id: 'b1', title: 'x', start: '2026-10-09T18:00', end: '2026-10-09T18:20:00' },
        { id: 'b0', title: 'x', start: '2026-10-08T18:00:00', end: '2026-10-08T18:20:00' },
      ],
    };
    const out = exportDocument(doc, NOW, OPTIONS);
    expect(out.classes.map((c) => c.id)).toEqual(['c2', 'c1', 'c3']);
    expect(out.assignments.map((a) => a.id)).toEqual(['a-date', 'a-assess', 'a-time', 'a-late', 'a-undated']);
    expect(out.events.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
    expect(out.availability.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(out.scheduleBlocks.map((b) => b.id)).toEqual(['b0', 'b1', 'b2']);
  });

  it('writes every item with id and origin, locked only when true, overrides only when not empty', () => {
    const doc: ScheduleDocument = {
      schemaVersion: '1.0',
      classes: [{ id: 'c1', name: 'Bio', locked: false, overrides: [] }],
      assignments: [
        { id: 'a1', title: 'A', origin: 'user', locked: true, tasks: [{ id: 'a1-t1', title: 'T', locked: false }], overrides: ['title'] },
      ],
      events: [],
      availability: [],
      scheduleBlocks: [{ id: 'b1', title: 'x', start: '2026-10-09T18:00:00', end: '2026-10-09T18:30:00', origin: 'planner' }],
    };
    const out = exportDocument(doc, NOW, OPTIONS) as unknown as Json;
    expect(out.classes[0]).toEqual({ id: 'c1', origin: 'generated', name: 'Bio' });
    expect(out.assignments[0]).toEqual({
      id: 'a1',
      origin: 'user',
      locked: true,
      overrides: ['title'],
      title: 'A',
      tasks: [{ id: 'a1-t1', origin: 'generated', title: 'T' }],
    });
    expect(Object.keys(out.assignments[0])).toEqual(['id', 'origin', 'locked', 'overrides', 'title', 'tasks']);
    expect(out.scheduleBlocks[0].origin).toBe('planner');
  });

  it('omits empty optional arrays (but keeps the five root collections) and empty settings', () => {
    const doc = {
      schemaVersion: '1.0',
      settings: {},
      classes: [{ id: 'c1', name: 'Bio', topics: [], references: [], sources: [], issues: [] }],
      assignments: [{ id: 'a1', title: 'A', tasks: [], references: [], dependsOn: [] }],
      events: [
        { id: 'e1', title: 'E', startTime: '08:00', endTime: '09:00', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', exceptDates: [] } },
      ],
      availability: [],
      scheduleBlocks: [],
      issues: [],
      deleted: [],
    } as ScheduleDocument;
    const out = exportDocument(doc, NOW, OPTIONS) as unknown as Json;
    expect(Object.keys(out)).toEqual(['schemaVersion', 'meta', 'classes', 'assignments', 'events', 'availability', 'scheduleBlocks']);
    expect(out.classes[0]).toEqual({ id: 'c1', origin: 'generated', name: 'Bio' });
    expect(out.assignments[0]).toEqual({ id: 'a1', origin: 'generated', title: 'A' });
    expect(out.events[0].recurrence).toEqual({ frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05' });
  });

  it('writes LocalDateTimes as YYYY-MM-DDTHH:MM:SS and keeps date-only values', () => {
    const doc: ScheduleDocument = {
      schemaVersion: '1.0',
      classes: [],
      assignments: [{ id: 'a1', title: 'A', due: '2026-10-16T23:59', recommendedCompletionDate: '2026-10-15', status: 'done', completedAt: '2026-10-07T10:00' }],
      events: [],
      availability: [],
      scheduleBlocks: [{ id: 'b1', assignmentId: 'a1', start: '2026-10-09T18:00', end: '2026-10-09T18:30' }],
      deleted: [{ id: 'old', collection: 'events', deletedAt: '2026-10-01T09:00' }],
    };
    const out = exportDocument(doc, '2026-10-07T18:30', OPTIONS);
    expect(out.assignments[0].due).toBe('2026-10-16T23:59:00');
    expect(out.assignments[0].recommendedCompletionDate).toBe('2026-10-15');
    expect(out.assignments[0].completedAt).toBe('2026-10-07T10:00:00');
    expect(out.scheduleBlocks[0]).toMatchObject({ start: '2026-10-09T18:00:00', end: '2026-10-09T18:30:00' });
    expect(out.deleted![0].deletedAt).toBe('2026-10-01T09:00:00');
    expect(out.meta!.generatedAt).toBe('2026-10-07T18:30:00');
  });

  it('preserves x- properties everywhere, unchanged', () => {
    const doc = {
      schemaVersion: '1.0',
      'x-root': { a: [1, null] },
      classes: [{ id: 'c1', name: 'Bio', 'x-c': null, references: [{ title: 'R', 'x-r': 'kept' }] }],
      assignments: [{ id: 'a1', title: 'A', estimatedMinutes: 30, estimateRange: { min: 20, max: 40, 'x-range': 1 }, 'x-a': ' spaced ' }],
      events: [
        { id: 'e1', title: 'E', startTime: '08:00', endTime: '09:00', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', 'x-rec': true } },
      ],
      availability: [],
      scheduleBlocks: [],
      settings: { 'x-theme': 'dark' },
    } as unknown as ScheduleDocument;
    const out = exportDocument(doc, NOW, OPTIONS) as unknown as Json;
    expect(out['x-root']).toEqual({ a: [1, null] });
    expect(out.classes[0]['x-c']).toBeNull();
    expect(out.classes[0].references[0]['x-r']).toBe('kept');
    expect(out.assignments[0].estimateRange['x-range']).toBe(1);
    expect(out.assignments[0]['x-a']).toBe(' spaced ');
    expect(out.events[0].recurrence['x-rec']).toBe(true);
    expect(out.settings).toEqual({ 'x-theme': 'dark' });
    expect(Object.keys(out).at(-1)).toBe('x-root');
    expect(validateDocument(out).ok).toBe(true);
  });

  it('writes only fields the format defines and keeps the file valid', () => {
    const doc = {
      schemaVersion: '1.0',
      classes: [{ id: 'c1', name: '  Bio  ', junk: 1, color: undefined }],
      assignments: [{ id: 'a1', title: 'A', status: 'not_started', completedAt: '2026-10-07T10:00:00', notes: undefined }],
      events: [],
      availability: [],
      scheduleBlocks: [],
      somethingElse: true,
    } as unknown as ScheduleDocument;
    const out = exportDocument(doc, NOW, OPTIONS) as unknown as Json;
    expect(out.classes[0]).toEqual({ id: 'c1', origin: 'generated', name: 'Bio' });
    expect(out.assignments[0]).toEqual({ id: 'a1', origin: 'generated', title: 'A', status: 'not_started' });
    expect('somethingElse' in out).toBe(false);
    expect(validateDocument(out).ok).toBe(true);
  });

  it('keeps at most 5000 tombstones, dropping the oldest', () => {
    const deleted = Array.from({ length: 5003 }, (_, i) => ({
      id: `old-${i}`,
      collection: 'assignments' as const,
      deletedAt: `2026-0${1 + (i % 9)}-01T10:00:00`,
    }));
    deleted[1].deletedAt = '2025-01-01T00:00:00';
    deleted[2].deletedAt = '2025-01-02T00:00:00';
    deleted[3].deletedAt = '2025-01-03T00:00:00';
    const out = exportDocument({ schemaVersion: '1.0', classes: [], assignments: [], events: [], availability: [], scheduleBlocks: [], deleted }, NOW, OPTIONS);
    expect(out.deleted).toHaveLength(5000);
    const ids = new Set(out.deleted!.map((t) => t.id));
    expect(ids.has('old-1') || ids.has('old-2') || ids.has('old-3')).toBe(false);
    expect(out.deleted![0].id).toBe('old-0'); // order otherwise kept
  });

  it.each(
    readdirSync(join(ROOT, 'tests', 'fixtures', 'valid'))
      .filter((f) => f.endsWith('.json'))
      .sort(),
  )('exports the valid fixture %s as a valid file with the same content', (file) => {
    const doc = loadDoc(`tests/fixtures/valid/${file}`);
    const exported = exportDocument(doc, NOW, OPTIONS);
    const result = validateDocument(JSON.parse(JSON.stringify(exported)), { today: '2026-10-07' });
    expect(result.errors).toEqual([]);
    expect(schemaValidate(exported), JSON.stringify(schemaValidate.errors)).toBe(true);
    expect(content(result.doc!)).toEqual(content(doc));
  });
});

describe('exportJson, exportFileName, createExport', () => {
  const complete = loadDoc('examples/complete-schedule.json');

  it('exportJson pretty-prints with 2 spaces and a trailing newline', () => {
    const json = exportJson(complete, NOW, OPTIONS);
    expect(json.endsWith('}\n')).toBe(true);
    expect(json.startsWith('{\n  "schemaVersion": "1.0",\n  "meta": {')).toBe(true);
    expect(JSON.parse(json)).toEqual(exportDocument(complete, NOW, OPTIONS));
  });

  it('exportFileName uses the date of now', () => {
    expect(exportFileName('2026-10-07T18:30:00')).toBe('schedule-2026-10-07.json');
  });

  it('createExport returns the document, JSON, file name, the exportId to remember and no problems', () => {
    const result = createExport(complete, NOW, { timezone: 'America/New_York' });
    expect(result.exportId).toMatch(/^u-exp-[a-z0-9]{8}$/);
    expect(result.doc.meta!.exportId).toBe(result.exportId);
    expect(JSON.parse(result.json)).toEqual(result.doc);
    expect(result.fileName).toBe('schedule-2026-10-07.json');
    expect(result.problems).toEqual([]);
  });

  it('createExport reports problems of an invalid in-memory schedule instead of hiding them', () => {
    const broken = { ...complete, assignments: [...complete.assignments, { id: 'dangling', title: 'X', classId: 'nope' }] } as ScheduleDocument;
    const result = createExport(broken, NOW, OPTIONS);
    expect(result.problems.map((p) => p.path)).toEqual([`assignments[${complete.assignments.length}].classId`]);
  });
});

describe('recent export IDs (D25)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      getItem: (key) => data.get(key) ?? null,
      key: (i) => [...data.keys()][i] ?? null,
      removeItem: (key) => void data.delete(key),
      setItem: (key, value) => void data.set(key, String(value)),
    };
  }

  it('remembers export IDs, most recent first, without duplicates', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    expect(recentExportIds()).toEqual([]);
    rememberExportId('u-exp-aaaaaaaa');
    rememberExportId('u-exp-bbbbbbbb');
    rememberExportId('u-exp-aaaaaaaa');
    expect(recentExportIds()).toEqual(['u-exp-aaaaaaaa', 'u-exp-bbbbbbbb']);
    for (let i = 0; i < 60; i++) rememberExportId(`u-exp-${String(i).padStart(8, '0')}`);
    expect(recentExportIds()).toHaveLength(50);
    expect(recentExportIds()[0]).toBe('u-exp-00000059');
  });

  it('survives unreadable or unavailable storage', () => {
    const storage = memoryStorage();
    storage.setItem(EXPORT_IDS_KEY, '{not json');
    vi.stubGlobal('localStorage', storage);
    expect(recentExportIds()).toEqual([]);
    rememberExportId('u-exp-cccccccc');
    expect(recentExportIds()).toEqual(['u-exp-cccccccc']);
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(recentExportIds()).toEqual([]);
    expect(() => rememberExportId('u-exp-dddddddd')).not.toThrow();
  });
});
