// Class scans from the browser extension: Classroom's displayed dates (the
// same cases as the skill's parser), the message checks at the trust
// boundary, and the scan merged onto a schedule made by the skill and the
// API sync (same IDs, so items match instead of being duplicated).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyImport, defaultSelection, planImport } from '../../src/lib/importDiff';
import { parseClassroomDate } from '../../src/lib/sync/classroomDates';
import { EXTENSION_PROTOCOL, readExtensionMessage, scansToBatch, type ClassScan } from '../../src/lib/sync/extensionScan';
import { mergeBatch } from '../../src/lib/sync/mergeBatch';
import { validateDocument } from '../../src/lib/validate';

describe('Classroom display dates', () => {
  const parse = (text: string | null, ref = '2026-10-03', scan = '2026-10-11', past = false) => parseClassroomDate(text, ref, scan, past);

  it('reads due dates with and without a time', () => {
    expect(parse('Oct 10, 11:59 PM')).toEqual({ kind: 'date', value: '2026-10-10T23:59:00' });
    expect(parse('Due Oct 10, 12:00 AM')).toEqual({ kind: 'date', value: '2026-10-10T00:00:00' });
    expect(parse('Wed, Oct 14, 3:30 PM')).toEqual({ kind: 'date', value: '2026-10-14T15:30:00' });
    expect(parse('14 Oct')).toEqual({ kind: 'date', value: '2026-10-14' });
  });

  it('reads explicit years, relative days and time-only dates', () => {
    expect(parse('Sep 12, 2025')).toEqual({ kind: 'date', value: '2025-09-12' });
    expect(parse('Tomorrow, 8:00 AM')).toEqual({ kind: 'date', value: '2026-10-12T08:00:00' });
    expect(parse('11:59 PM')).toEqual({ kind: 'date', value: '2026-10-11T23:59:00' });
  });

  it('places year-less dates near the reference and reports ambiguity', () => {
    expect(parse('Jan 5', '2026-12-18')).toEqual({ kind: 'date', value: '2027-01-05' });
    expect(parse('Apr 2', '2026-10-01')).toMatchObject({ kind: 'date', ambiguous: [expect.any(String)] });
    expect(parse('Dec 18', '2026-10-11', '2026-10-11', true)).toEqual({ kind: 'date', value: '2025-12-18' });
  });

  it('knows "No due date" and refuses what it cannot read', () => {
    expect(parse('No due date')).toEqual({ kind: 'none' });
    expect(parse('sometime soon')).toEqual({ kind: 'unreadable' });
    expect(parse('Feb 30')).toEqual({ kind: 'unreadable' });
    expect(parse(null)).toBeNull();
  });
});

const ENGLISH: ClassScan = {
  createdAt: '2026-10-12T14:00:00.000Z',
  classInfo: { courseId: 'NjI3ODk0MjE0NTQ5', name: 'English 10', section: 'Period 3', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5' },
  topics: ['Unit 3: Othello'],
  items: [
    {
      id: 'NzAwMDAwMDAwMDAx',
      type: 'assignment',
      title: 'Othello Essay',
      topic: 'Unit 3: Othello',
      description: 'Write 4 pages.',
      classroomUrl: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAx/details',
      meta: { dueText: 'Oct 16, 11:59 PM', pointsText: '100 points', postedText: 'Oct 1' },
      resources: [{ kind: 'drive-file', title: 'Essay rubric', url: 'https://drive.google.com/file/d/rubric/view' }],
    },
    {
      id: 'NzAwMDAwMDAwMDA5',
      type: 'question',
      title: 'Poetry question',
      topic: null,
      description: '',
      classroomUrl: null,
      meta: { dueText: 'whenever', pointsText: 'Ungraded', postedText: null },
      resources: [],
    },
    {
      id: 'ODAwMDAwMDAwMDAx',
      type: 'material',
      title: 'Unit 3 notes',
      topic: 'Unit 3: Othello',
      description: '',
      classroomUrl: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/m/ODAwMDAwMDAwMDAx/details',
      meta: { dueText: null, pointsText: null, postedText: null },
      resources: [{ kind: 'link', title: 'Slides', url: 'https://docs.google.com/presentation/d/s' }],
    },
    {
      id: 'OTAwMDAwMDAwMDAx',
      type: 'announcement',
      title: 'Essay conferences',
      topic: null,
      description: 'Essay conferences are on Thursday.',
      classroomUrl: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/OTAwMDAwMDAwMDAx',
      meta: { dueText: null, pointsText: null, postedText: 'Oct 9' },
      resources: [],
    },
  ],
  warnings: ['2 items could not be opened.'],
};

const message = (snapshots: unknown, extra: Record<string, unknown> = {}) => ({ protocol: EXTENSION_PROTOCOL, version: 1, type: 'import', id: 'm1', snapshots, ...extra });

describe('the extension message (trust boundary)', () => {
  it('ignores other messages and its own receipts', () => {
    expect(readExtensionMessage({ type: 'import' })).toBeNull();
    expect(readExtensionMessage({ protocol: EXTENSION_PROTOCOL, type: 'received', id: 'm1' })).toBeNull();
    expect(readExtensionMessage('hello')).toBeNull();
  });

  it('answers an unknown version, an empty send and unusable classes with a reason', () => {
    expect(readExtensionMessage(message([ENGLISH], { version: 3 }))).toMatchObject({ id: 'm1', error: expect.stringContaining('Update the extension') });
    expect(readExtensionMessage(message([]))).toMatchObject({ error: 'The extension sent no classes.' });
    expect(readExtensionMessage(message([{ classInfo: { courseId: '../x y', name: 'Bad' } }]))).toMatchObject({ error: expect.stringContaining('could not read') });
  });

  it('keeps only https links, drops items with unusable ids and cuts long text', () => {
    const scan = structuredClone(ENGLISH) as unknown as Record<string, unknown>;
    const items = scan.items as Array<Record<string, unknown>>;
    items[0].resources = [{ kind: 'link', title: 'x', url: 'javascript:alert(1)' }, { kind: 'link', title: 'ok', url: 'https://example.org' }];
    items[0].title = 'T'.repeat(500);
    items.push({ id: 'has space', type: 'assignment', title: 'Bad id' });
    const read = readExtensionMessage(message([scan]));
    if (!read || 'error' in read) throw new Error('expected scans');
    expect(read.scans[0].items).toHaveLength(4);
    expect(read.scans[0].items[0].resources).toEqual([{ kind: 'link', title: 'ok', url: 'https://example.org' }]);
    expect(read.scans[0].items[0].title).toHaveLength(200);
  });
});

describe('a scan as an import batch', () => {
  const batch = scansToBatch([ENGLISH], 'America/New_York', '2026-10-12T10:00:00');

  it('maps classes, work, materials and announcements with the format’s IDs', () => {
    expect(batch.sourceType).toBe('browser_extension');
    expect(batch.courses).toEqual([
      {
        id: 'gc-class-NjI3ODk0MjE0NTQ5',
        sourceId: 'NjI3ODk0MjE0NTQ5',
        name: 'English 10',
        section: 'Period 3',
        url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5',
        topics: ['Unit 3: Othello'],
        materials: [
          { title: 'Unit 3 notes', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/m/ODAwMDAwMDAwMDAx/details' },
          { title: 'Unit 3 notes: Slides', url: 'https://docs.google.com/presentation/d/s' },
        ],
        announcements: [{ text: 'Essay conferences are on Thursday.', postedAt: '2026-10-09', url: 'https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/p/OTAwMDAwMDAwMDAx' }],
        state: 'present',
      },
    ]);
    expect(batch.assignments[0]).toMatchObject({ id: 'gc-NzAwMDAwMDAwMDAx', due: '2026-10-16T23:59:00', points: '100 points', topic: 'Unit 3: Othello', links: [{ title: 'Essay rubric', url: 'https://drive.google.com/file/d/rubric/view' }] });
    expect(batch.assignments[1]).not.toHaveProperty('due');
    expect(batch.assignments[1]).not.toHaveProperty('points');
    expect(batch.assignments.every((a) => a.state === 'present')).toBe(true);
    const unreadable = 'Classroom shows the due date as “whenever”, which could not be read, so it was left out.';
    expect(batch.assignments[1].dueNote).toEqual({ kind: 'missing_information', message: unreadable });
    expect(batch.warnings).toEqual([`“Poetry question” (English 10): ${unreadable}`, 'English 10: 2 items could not be opened.']);
  });

  it('turns an unclear due date into an issue to review, which follows the source until the person decides', () => {
    const scan = structuredClone(ENGLISH);
    scan.items = [{ ...scan.items[0], id: 'NzAwMDAwMDAwMDA4', title: 'Reading log', meta: { dueText: 'Apr 2', pointsText: null, postedText: null } }];
    scan.createdAt = '2026-10-01T14:00:00.000Z';
    const current = validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: '2026-10-12' }).doc!;
    const merged = mergeBatch(current, scansToBatch([scan], 'America/New_York', '2026-10-01T10:00:00'));
    const essay = merged.assignments.find((a) => a.id === 'gc-NzAwMDAwMDAwMDA4')!;
    expect(essay.issues).toContainEqual({ id: 'gc-NzAwMDAwMDAwMDA4-due', kind: 'ambiguity', field: 'due', message: expect.stringContaining('without a year') });
    expect(validateDocument(merged, { today: '2026-10-12' }).errors).toEqual([]);
    // A clear date later removes the open issue; a dismissed one stays dismissed.
    const clear = scansToBatch([{ ...scan, items: [{ ...scan.items[0], meta: { dueText: 'Apr 2, 2027', pointsText: null, postedText: null } }] }], 'America/New_York', '2026-10-01T10:00:00');
    expect(mergeBatch(merged, clear).assignments.find((a) => a.id === essay.id)!.issues).toBeUndefined();
    essay.issues!.find((i) => i.id === 'gc-NzAwMDAwMDAwMDA4-due')!.status = 'dismissed';
    expect(mergeBatch(merged, clear).assignments.find((a) => a.id === essay.id)!.issues).toContainEqual(expect.objectContaining({ id: 'gc-NzAwMDAwMDAwMDA4-due', status: 'dismissed' }));
    expect(merged.assignments.find((a) => a.id === essay.id)!.source).toMatchObject({ label: 'Google Classroom (browser extension scan)' });
  });

  it('matches the schedule’s existing Classroom items instead of duplicating them', () => {
    const current = validateDocument(JSON.parse(readFileSync(resolve(__dirname, '../../examples/complete-schedule.json'), 'utf8')), { today: '2026-10-12' }).doc!;
    const incoming = validateDocument(mergeBatch(current, batch), { today: '2026-10-12' });
    expect(incoming.errors).toEqual([]);
    const plan = planImport(current, incoming.doc!, '2026-10-12T10:00:00');
    expect(plan.summary.new).toEqual({ assignments: 1 });
    const after = applyImport(current, incoming.doc!, plan, defaultSelection(plan), '2026-10-12T10:00:00');
    expect(after.assignments.filter((a) => a.id === 'gc-NzAwMDAwMDAwMDAx')).toHaveLength(1);
    expect(after.classes.find((c) => c.id === 'gc-class-NjI3ODk0MjE0NTQ5')!.announcements).toHaveLength(1);
    expect(after.schemaVersion).toBe('1.2');
  });
});
