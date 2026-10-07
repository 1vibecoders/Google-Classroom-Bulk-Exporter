import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_BYTES } from '../../src/model/constants';
import {
  codePointLength,
  compareDateValues,
  isKnownTimeZone,
  locateJsonError,
  parseScheduleText,
  utf8ByteLength,
  validateDocument,
  type ValidationResult,
} from '../../src/lib/validate';

const TODAY = '2026-10-07';
const ROOT = join(__dirname, '..', '..');

type Doc = Record<string, any>;

const A = 'bio-lab-2026-10-16';
const T1 = `${A}-t1`;
const T2 = `${A}-t2`;

/** A small valid document (no warnings) that each test changes in one place. */
function base(): Doc {
  return {
    schemaVersion: '1.0',
    meta: { title: 'Test', generatedAt: '2026-10-07T18:00:00', generator: { name: 'test' }, timezone: 'America/New_York' },
    classes: [{ id: 'cls-bio', name: 'Biology', origin: 'generated' }],
    assignments: [
      {
        id: A,
        classId: 'cls-bio',
        title: 'Lab report',
        type: 'lab',
        due: '2026-10-16T23:59:00',
        estimatedMinutes: 90,
        tasks: [
          { id: T1, title: 'Analyse data', estimatedMinutes: 30 },
          { id: T2, title: 'Write report', estimatedMinutes: 60, dependsOn: [T1] },
        ],
        origin: 'generated',
      },
    ],
    events: [
      {
        id: 'evt-soccer',
        title: 'Soccer',
        startTime: '16:00',
        endTime: '17:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['tue', 'thu'], startDate: '2026-10-05' },
      },
    ],
    availability: [
      {
        id: 'avail-evenings-1800-2100',
        startTime: '18:00',
        endTime: '21:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-10-05' },
      },
    ],
    scheduleBlocks: [{ id: 'blk-1', assignmentId: A, taskId: T1, start: '2026-10-08T18:00:00', end: '2026-10-08T18:30:00' }],
  };
}

/** Validate the base document after `mutate` changed it (its return value is ignored). */
function run(mutate: (d: Doc) => unknown): ValidationResult {
  const d = base();
  mutate(d);
  return validateDocument(d, { today: TODAY });
}

function errorAt(result: ValidationResult, path: string, code?: string): void {
  const match = result.errors.find((e) => e.path === path && (code === undefined || e.code === code));
  expect(match, `expected error ${code ?? ''} at "${path}", got ${JSON.stringify(result.errors, null, 1)}`).toBeTruthy();
  expect(result.ok).toBe(false);
  expect(result.doc).toBeUndefined();
}

function onlyError(result: ValidationResult, path: string, code?: string): void {
  errorAt(result, path, code);
  expect(result.errors, JSON.stringify(result.errors, null, 1)).toHaveLength(1);
}

function warningAt(result: ValidationResult, path: string, code: string): void {
  const match = result.warnings.find((w) => w.path === path && w.code === code);
  expect(match, `expected warning ${code} at "${path}", got ${JSON.stringify(result.warnings, null, 1)}`).toBeTruthy();
}

function noWarning(result: ValidationResult, code: string): void {
  expect(result.warnings.filter((w) => w.code === code), JSON.stringify(result.warnings, null, 1)).toEqual([]);
}

const asg = (d: Doc) => d.assignments[0];
const task = (d: Doc, i = 0) => d.assignments[0].tasks[i];
const evt = (d: Doc) => d.events[0];
const avl = (d: Doc) => d.availability[0];
const blk = (d: Doc) => d.scheduleBlocks[0];

describe('the base document and the shipped examples', () => {
  it('accepts the base test document without errors or warnings', () => {
    const result = run(() => {});
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stage).toBe('content');
    expect(result.schemaVersion).toBe('1.0');
  });

  it.each(['minimal-schedule.json', 'complete-schedule.json'])('accepts examples/%s without errors or warnings', (file) => {
    const text = readFileSync(join(ROOT, 'examples', file), 'utf8');
    const result = parseScheduleText(text, { today: TODAY });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    // The examples are already canonical: normalization changes nothing.
    expect(result.doc).toEqual(JSON.parse(text));
  });
});

describe('§ 2 schemaVersion', () => {
  it('rejects an unsupported major version with one clear error before anything else', () => {
    const result = validateDocument({ schemaVersion: '2.0', classes: 'not even an array', bogus: true });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ path: 'schemaVersion', code: 'version-unsupported' });
    expect(result.errors[0].message).toContain('This file uses schema version 2.0; this website supports 1.x');
    expect(result.stage).toBe('version');
    expect(result.schemaVersion).toBe('2.0');
  });

  it('rejects a newer minor version (1.3) with the § 2 message', () => {
    const result = run((d) => {
      d.schemaVersion = '1.3';
    });
    onlyError(result, 'schemaVersion', 'version-unsupported');
    expect(result.errors[0].message).toBe(
      'This file uses schema version 1.3, but this version of the Academic Scheduler supports up to 1.0. Update the website or generate a 1.0 file.',
    );
  });

  it('rejects a missing schemaVersion', () => {
    onlyError(
      run((d) => {
        delete d.schemaVersion;
      }),
      'schemaVersion',
      'version-missing',
    );
  });

  it('reports the number 1.0 but still validates the rest of the file', () => {
    const result = run((d) => {
      d.schemaVersion = 1.0;
      asg(d).priority = 'normal';
    });
    errorAt(result, 'schemaVersion', 'version-type');
    errorAt(result, 'assignments[0].priority', 'enum');
  });

  it.each(['1', '1.00', 'v1.0', '01.0', '1.0 ', 'latest'])('rejects the malformed version %j', (version) => {
    onlyError(
      run((d) => {
        d.schemaVersion = version;
      }),
      'schemaVersion',
      'version-format',
    );
  });

  it.each([true, null, ['1.0'], { major: 1 }, 2])('rejects a non-string version %j', (version) => {
    onlyError(
      run((d) => {
        d.schemaVersion = version;
      }),
      'schemaVersion',
      'version-type',
    );
  });
});

describe('§ 13.1 structure', () => {
  it.each([null, [], 'text', 42, true, undefined])('rule 1: the root must be an object (%j)', (input) => {
    const result = validateDocument(input);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ path: '', code: 'root-type' });
    expect(result.stage).toBe('root');
  });

  it.each(['classes', 'assignments', 'events', 'availability', 'scheduleBlocks'])('rule 1: the collection %s is required and is an array', (key) => {
    errorAt(
      run((d) => {
        delete d[key];
      }),
      key,
      'required',
    );
    errorAt(
      run((d) => {
        d[key] = {};
      }),
      key,
      'type',
    );
  });

  it('rule 1: a malformed collection does not cascade into "does not exist" errors', () => {
    onlyError(
      run((d) => {
        d.classes = { 'cls-bio': { name: 'Biology' } };
      }),
      'classes',
      'type',
    );
    onlyError(
      run((d) => {
        d.classes.push('Chemistry');
        asg(d).classId = 'cls-chem';
      }),
      'classes[1]',
      'type',
    );
  });

  describe('rule 2: types, formats, lengths, ranges, enums', () => {
    it.each([
      ['my essay', 'id-format'],
      ['-abc', 'id-format'],
      ['essay/1', 'id-format'],
      ['', 'id-format'],
      [`a${'b'.repeat(100)}`, 'id-format'],
      [12, 'type'],
    ])('ID %j is invalid', (id, code) => {
      errorAt(
        run((d) => {
          evt(d).id = id;
        }),
        'events[0].id',
        code,
      );
    });

    it.each(['english-essay-2026-10-16', 'gc-NjI3ODk0MjE0NTQ5', 'blk:001', 'A.b_c', `a${'b'.repeat(99)}`])('ID %j is valid', (id) => {
      expect(
        run((d) => {
          evt(d).id = id;
        }).ok,
      ).toBe(true);
    });

    it.each(['2026-2-3', '10/16/2026', '2026-10-16\n', ' 2026-10-16', '2026-13-01', '2026-00-10', '2026-10-32', '26-10-16'])(
      'Date %j is invalid',
      (value) => {
        errorAt(
          run((d) => {
            evt(d).recurrence.startDate = value;
          }),
          'events[0].recurrence.startDate',
          'date-format',
        );
      },
    );

    it('a Date field does not take a time', () => {
      errorAt(
        run((d) => {
          task(d).recommendedStartDate = '2026-10-08T10:00:00';
        }),
        'assignments[0].tasks[0].recommendedStartDate',
        'date-format',
      );
    });

    it.each(['8:00', '3:30 PM', '24:00', '12:60', '25:00', '08:00:00', '0800'])('Time %j is invalid', (value) => {
      errorAt(
        run((d) => {
          evt(d).startTime = value;
        }),
        'events[0].startTime',
        'time-format',
      );
    });

    it('explains that 24:00 is only an end time, and 12-hour times', () => {
      const r1 = run((d) => {
        avl(d).startTime = '24:00';
      });
      expect(r1.errors[0].message).toContain('only allowed as an end time');
      const r2 = run((d) => {
        evt(d).startTime = '4:00 PM';
      });
      expect(r2.errors[0].message).toContain('"16:00"');
    });

    it.each(['24:30', '25:00', '24:01', '00:60'])('EndTime %j is invalid', (value) => {
      errorAt(
        run((d) => {
          avl(d).endTime = value;
        }),
        'availability[0].endTime',
        'time-format',
      );
    });

    it.each([
      ['2026-10-16T23:59:00Z', 'remove the "Z"'],
      ['2026-10-16T23:59:00-04:00', 'UTC offset'],
      ['2026-10-16T23:59:00+0200', 'UTC offset'],
      ['2026-10-16 23:59', '"T"'],
      ['2026-10-16T23:59:30', 'Seconds must be ":00"'],
      ['2026-10-16T23:59:00.000', 'Fractions'],
      ['2026-10-16T24:00:00', ''],
      ['2026-10-16T9:00', ''],
    ])('LocalDateTime %j is invalid', (value, hint) => {
      const result = run((d) => {
        blk(d).start = value;
      });
      errorAt(result, 'scheduleBlocks[0].start', 'datetime-format');
      expect(result.errors.find((e) => e.path === 'scheduleBlocks[0].start')!.message).toContain(hint);
    });

    it('a LocalDateTime field needs a time', () => {
      errorAt(
        run((d) => {
          blk(d).start = '2026-10-08';
        }),
        'scheduleBlocks[0].start',
        'datetime-format',
      );
    });

    it.each(['2026-10-16', '2026-10-16T23:59', '2026-10-16T23:59:00'])('DateOrDateTime %j is valid', (value) => {
      expect(
        run((d) => {
          asg(d).due = value;
        }).ok,
      ).toBe(true);
    });

    it.each(['blue', '#FFF', 'rgb(0,0,0)', '#12345G', '#1234567'])('Color %j is invalid', (value) => {
      errorAt(
        run((d) => {
          d.classes[0].color = value;
        }),
        'classes[0].color',
        'color-format',
      );
    });

    it.each([
      [45.5, 'integer'],
      ['45', 'type'],
      [-10, 'range'],
      [10001, 'range'],
      [Number.NaN, 'integer'],
      [Number.POSITIVE_INFINITY, 'integer'],
    ])('Minutes %j is invalid', (value, code) => {
      errorAt(
        run((d) => {
          asg(d).estimatedMinutes = value;
        }),
        'assignments[0].estimatedMinutes',
        code,
      );
    });

    it('Minutes 0 and 10000 are valid; 45.0 is the integer 45', () => {
      expect(
        run((d) => {
          asg(d).estimatedMinutes = 10000;
          task(d).estimatedMinutes = 0;
        }).ok,
      ).toBe(true);
      expect(parseScheduleText(JSON.stringify(base()).replace('"estimatedMinutes":90', '"estimatedMinutes":90.0'), { today: TODAY }).ok).toBe(true);
    });

    it.each(['javascript:alert(1)', '/relative/path', 'ftp://example.org/x', 'data:text/html,hi', 'https://exa mple.org', 'https://'])(
      'URL %j is invalid',
      (url) => {
        errorAt(
          run((d) => {
            asg(d).references = [{ title: 'Rubric', url }];
          }),
          'assignments[0].references[0].url',
          'url-format',
        );
      },
    );

    it('URLs are at most 2000 characters', () => {
      errorAt(
        run((d) => {
          asg(d).references = [{ title: 'Long', url: `https://example.org/${'a'.repeat(1990)}` }];
        }),
        'assignments[0].references[0].url',
        'text-length',
      );
      expect(
        run((d) => {
          asg(d).references = [{ title: 'Long', url: `HTTPS://example.org/${'a'.repeat(1980)}` }];
        }).ok,
      ).toBe(true);
    });

    it('Text lengths are counted in code points', () => {
      expect(
        run((d) => {
          asg(d).title = '😀'.repeat(200);
        }).ok,
      ).toBe(true);
      errorAt(
        run((d) => {
          asg(d).title = '😀'.repeat(201);
        }),
        'assignments[0].title',
        'text-length',
      );
      errorAt(
        run((d) => {
          d.classes[0].room = 'x'.repeat(101);
        }),
        'classes[0].room',
        'text-length',
      );
    });

    it.each([
      ['type', 'essay'],
      ['priority', 'normal'],
      ['status', 'complete'],
      ['estimateConfidence', 'certain'],
      ['sourceState', 'gone'],
    ])('assignment %s %j is not an allowed value', (field, value) => {
      errorAt(
        run((d) => {
          asg(d)[field] = value;
        }),
        `assignments[0].${field}`,
        'enum',
      );
    });

    it('enum hints name the right value for common mistakes', () => {
      const result = run((d) => {
        asg(d).status = 'complete';
        asg(d).priority = 'normal';
        evt(d).recurrence.daysOfWeek = ['Monday'];
      });
      expect(result.errors.map((e) => e.message).join(' ')).toMatch(/Use "done".*Use "medium".*Use "mon"/s);
    });

    it.each([
      ['busy', 'false'],
      ['allDay', 1],
    ])('booleans are true/false (%s = %j)', (field, value) => {
      errorAt(
        run((d) => {
          evt(d)[field] = value;
        }),
        `events[0].${field}`,
        'type',
      );
    });

    it('array sizes: sources ≤ 20, topics ≤ 200, references ≤ 200, deleted ≤ 5000, daysOfWeek 1–7', () => {
      errorAt(
        run((d) => {
          d.classes[0].sources = Array.from({ length: 21 }, () => ({ kind: 'other' }));
        }),
        'classes[0].sources',
        'array-size',
      );
      errorAt(
        run((d) => {
          d.classes[0].topics = Array.from({ length: 201 }, (_, i) => `Topic ${i}`);
        }),
        'classes[0].topics',
        'array-size',
      );
      errorAt(
        run((d) => {
          d.classes[0].references = Array.from({ length: 201 }, (_, i) => ({ title: `R${i}` }));
        }),
        'classes[0].references',
        'array-size',
      );
      errorAt(
        run((d) => {
          d.deleted = Array.from({ length: 5001 }, (_, i) => ({ id: `old-${i}`, collection: 'assignments', deletedAt: '2026-10-01T10:00:00' }));
        }),
        'deleted',
        'array-size',
      );
      errorAt(
        run((d) => {
          evt(d).recurrence.daysOfWeek = [];
        }),
        'events[0].recurrence.daysOfWeek',
        'array-size',
      );
    });

    it('uniqueness: daysOfWeek, dependsOn', () => {
      errorAt(
        run((d) => {
          evt(d).recurrence.daysOfWeek = ['tue', 'thu', 'tue'];
        }),
        'events[0].recurrence.daysOfWeek[2]',
        'unique',
      );
      errorAt(
        run((d) => {
          task(d, 1).dependsOn = [T1, T1];
        }),
        'assignments[0].tasks[1].dependsOn[1]',
        'unique',
      );
    });

    it('numeric ranges of settings and recurrence', () => {
      for (const [field, value] of [
        ['minSessionMinutes', 4],
        ['minSessionMinutes', 241],
        ['maxSessionMinutes', 9],
        ['maxSessionMinutes', 481],
        ['breakMinutes', -1],
        ['breakMinutes', 121],
        ['maxDailyStudyMinutes', 1441],
      ] as const) {
        errorAt(
          run((d) => {
            d.settings = { [field]: value };
          }),
          `settings.${field}`,
          'range',
        );
      }
      errorAt(
        run((d) => {
          evt(d).recurrence.interval = 53;
        }),
        'events[0].recurrence.interval',
        'range',
      );
      errorAt(
        run((d) => {
          d.settings = { weekStartsOn: 'saturday' };
        }),
        'settings.weekStartsOn',
        'enum',
      );
    });

    it('required fields of every object type', () => {
      const cases: Array<[(d: Doc) => void, string]> = [
        [(d) => delete d.classes[0].name, 'classes[0].name'],
        [(d) => delete asg(d).title, 'assignments[0].title'],
        [(d) => delete task(d).id, 'assignments[0].tasks[0].id'],
        [(d) => delete evt(d).title, 'events[0].title'],
        [(d) => delete avl(d).endTime, 'availability[0].endTime'],
        [(d) => delete blk(d).start, 'scheduleBlocks[0].start'],
        [(d) => delete evt(d).recurrence.startDate, 'events[0].recurrence.startDate'],
        [(d) => delete evt(d).recurrence.frequency, 'events[0].recurrence.frequency'],
        [(d) => (asg(d).references = [{ url: 'https://example.org' }]), 'assignments[0].references[0].title'],
        [(d) => (asg(d).source = { label: 'x' }), 'assignments[0].source.kind'],
        [(d) => (d.issues = [{ message: 'x' }]), 'issues[0].kind'],
        [(d) => (d.deleted = [{ id: 'x', collection: 'events' }]), 'deleted[0].deletedAt'],
        [(d) => (d.meta.requestedChanges = [{ id: 'evt-soccer', reason: 'x' }]), 'meta.requestedChanges[0].requestedByPerson'],
        [(d) => (d.meta.generator = {}), 'meta.generator.name'],
      ];
      for (const [mutate, path] of cases) errorAt(run(mutate), path, 'required');
    });
  });

  describe('rule 3: unknown properties', () => {
    it('reports unknown properties with a suggestion', () => {
      const result = run((d) => {
        asg(d).dueDate = '2026-10-16';
        asg(d).estimated_minutes = 5;
      });
      errorAt(result, 'assignments[0].dueDate', 'unknown-property');
      expect(result.errors.find((e) => e.path === 'assignments[0].dueDate')!.message).toContain('Did you mean "due"?');
      expect(result.errors.find((e) => e.path === 'assignments[0].estimated_minutes')!.message).toContain('Did you mean "estimatedMinutes"?');
    });

    it('allows x- properties on every object, with any JSON value (null included)', () => {
      const result = run((d) => {
        d['x-root'] = null;
        d.meta['x-a'] = [null];
        d.meta.generator['x-b'] = 1;
        d.settings = { 'x-c': {} };
        d.classes[0]['x-d'] = 'v';
        asg(d)['x-e'] = { nested: null };
        asg(d).estimateRange = { min: 80, max: 100, 'x-f': true };
        asg(d).source = { kind: 'other', 'x-g': 0 };
        asg(d).references = [{ title: 'R', 'x-h': [] }];
        asg(d).issues = [{ kind: 'other', message: 'm', 'x-i': null }];
        task(d)['x-j'] = 1;
        evt(d).recurrence['x-k'] = 1;
        avl(d)['x-l'] = 1;
        blk(d)['x-m'] = 1;
        d.issues = [{ kind: 'other', message: 'm', 'x-n': 1 }];
        d.deleted = [{ id: 'old', collection: 'events', deletedAt: '2026-10-01T10:00:00', 'x-o': 1 }];
        d.meta.requestedChanges = [{ id: 'evt-soccer', reason: 'r', requestedByPerson: true, 'x-p': 1 }];
      });
      expect(result.errors).toEqual([]);
    });

    it('extension names are case-sensitive: "X-tool" is unknown', () => {
      onlyError(
        run((d) => {
          d['X-tool'] = 1;
        }),
        'X-tool',
        'unknown-property',
      );
    });

    it('tasks have no source; item issues have no itemId (specific messages)', () => {
      errorAt(
        run((d) => {
          task(d).source = { kind: 'other' };
        }),
        'assignments[0].tasks[0].source',
        'misplaced-property',
      );
    });

    it('odd property names get a bracketed path', () => {
      errorAt(
        run((d) => {
          asg(d)['due date'] = 'x';
        }),
        'assignments[0]["due date"]',
        'unknown-property',
      );
    });
  });

  it('rule 4: null is not allowed outside x- values', () => {
    errorAt(
      run((d) => {
        d.classes[0].teacher = null;
      }),
      'classes[0].teacher',
      'null',
    );
    errorAt(
      run((d) => {
        d.meta = null;
      }),
      'meta',
      'null',
    );
    errorAt(
      run((d) => {
        d.assignments = [null];
      }),
      'assignments[0]',
      'null',
    );
  });

  describe('rule 5: events and availability', () => {
    it('exactly one of date and recurrence', () => {
      errorAt(
        run((d) => {
          evt(d).date = '2026-10-08';
        }),
        'events[0].recurrence',
        'date-xor-recurrence',
      );
      errorAt(
        run((d) => {
          delete evt(d).recurrence;
        }),
        'events[0]',
        'date-xor-recurrence',
      );
      errorAt(
        run((d) => {
          avl(d).date = '2026-10-08';
        }),
        'availability[0].recurrence',
        'date-xor-recurrence',
      );
      errorAt(
        run((d) => {
          delete avl(d).recurrence;
        }),
        'availability[0]',
        'date-xor-recurrence',
      );
    });

    it('all-day events have no times; timed events need both and no endDate; endDate needs date', () => {
      const allDay = run((d) => {
        evt(d).allDay = true;
      });
      errorAt(allDay, 'events[0].startTime', 'all-day-times');
      errorAt(allDay, 'events[0].endTime', 'all-day-times');
      errorAt(
        run((d) => {
          delete evt(d).startTime;
        }),
        'events[0].startTime',
        'required',
      );
      errorAt(
        run((d) => {
          d.events[0] = { id: 'e', title: 'Trip', date: '2026-10-22', endDate: '2026-10-23', startTime: '08:00', endTime: '09:00' };
        }),
        'events[0].endDate',
        'end-date-not-all-day',
      );
      errorAt(
        run((d) => {
          d.events[0] = { id: 'e', title: 'Trip', allDay: true, endDate: '2026-10-23', recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05' } };
        }),
        'events[0].endDate',
        'end-date-without-date',
      );
      expect(
        run((d) => {
          d.events[0] = { id: 'e', title: 'Trip', allDay: true, date: '2026-10-22', endDate: '2026-10-23' };
        }).ok,
      ).toBe(true);
    });
  });

  it('rule 6: blocks have an assignmentId or a title; taskId needs assignmentId; breaks have a title and no assignment', () => {
    errorAt(
      run((d) => {
        delete blk(d).assignmentId;
        delete blk(d).taskId;
      }),
      'scheduleBlocks[0]',
      'block-needs-assignment-or-title',
    );
    errorAt(
      run((d) => {
        delete blk(d).assignmentId;
        blk(d).title = 'Study';
      }),
      'scheduleBlocks[0].taskId',
      'task-without-assignment',
    );
    errorAt(
      run((d) => {
        blk(d).kind = 'break';
        blk(d).title = 'Break';
        delete blk(d).taskId;
      }),
      'scheduleBlocks[0].assignmentId',
      'break-with-assignment',
    );
    errorAt(
      run((d) => {
        d.scheduleBlocks = [{ id: 'b', kind: 'break', start: '2026-10-08T18:00:00', end: '2026-10-08T18:10:00' }];
      }),
      'scheduleBlocks[0].title',
      'required',
    );
  });

  it('rule 7: completedAt only when status is done (assignments, tasks, blocks)', () => {
    errorAt(
      run((d) => {
        asg(d).completedAt = '2026-10-08T10:00:00';
        asg(d).status = 'in_progress';
      }),
      'assignments[0].completedAt',
      'completed-at-status',
    );
    errorAt(
      run((d) => {
        task(d).completedAt = '2026-10-08T10:00:00';
      }),
      'assignments[0].tasks[0].completedAt',
      'completed-at-status',
    );
    errorAt(
      run((d) => {
        blk(d).status = 'skipped';
        blk(d).completedAt = '2026-10-08T18:30:00';
      }),
      'scheduleBlocks[0].completedAt',
      'completed-at-status',
    );
    expect(
      run((d) => {
        blk(d).status = 'done';
        blk(d).completedAt = '2026-10-08T18:30:00';
      }).ok,
    ).toBe(true);
  });

  it('rule 8 (§ D4): estimateRange requires estimatedMinutes, with the point estimate suggested', () => {
    const result = run((d) => {
      asg(d).estimateRange = { min: 60, max: 75 };
      delete asg(d).estimatedMinutes;
    });
    onlyError(result, 'assignments[0].estimatedMinutes', 'estimate-range-needs-estimate');
    expect(result.errors[0].message).toContain('70');
    errorAt(
      run((d) => {
        task(d).estimateRange = { min: 20, max: 40 };
        delete task(d).estimatedMinutes;
      }),
      'assignments[0].tasks[0].estimatedMinutes',
      'estimate-range-needs-estimate',
    );
  });

  it('rule 9: origin "planner" only on schedule blocks', () => {
    for (const [mutate, path] of [
      [(d: Doc) => (d.classes[0].origin = 'planner'), 'classes[0].origin'],
      [(d: Doc) => (asg(d).origin = 'planner'), 'assignments[0].origin'],
      [(d: Doc) => (task(d).origin = 'planner'), 'assignments[0].tasks[0].origin'],
      [(d: Doc) => (evt(d).origin = 'planner'), 'events[0].origin'],
      [(d: Doc) => (avl(d).origin = 'planner'), 'availability[0].origin'],
    ] as const) {
      const result = run(mutate);
      errorAt(result, path, 'enum');
      expect(result.errors[0].message).toContain('only allowed on schedule blocks');
    }
    expect(
      run((d) => {
        blk(d).origin = 'planner';
      }).ok,
    ).toBe(true);
  });

  it('rule 10: itemId only on root issues', () => {
    errorAt(
      run((d) => {
        asg(d).issues = [{ kind: 'other', message: 'm', itemId: T1 }];
      }),
      'assignments[0].issues[0].itemId',
      'misplaced-property',
    );
    expect(
      run((d) => {
        d.issues = [{ kind: 'other', message: 'm', itemId: T1 }];
      }).ok,
    ).toBe(true);
  });

  it('rule 11: overrides are unique names allowed for the item type, or x- names', () => {
    errorAt(
      run((d) => {
        asg(d).overrides = ['notes'];
      }),
      'assignments[0].overrides[0]',
      'override-name',
    );
    for (const never of ['id', 'origin', 'locked', 'overrides', 'issues', 'source', 'sources', 'status', 'completedAt']) {
      errorAt(
        run((d) => {
          asg(d).overrides = [never];
        }),
        'assignments[0].overrides[0]',
        'override-name',
      );
    }
    errorAt(
      run((d) => {
        d.classes[0].overrides = ['title'];
      }),
      'classes[0].overrides[0]',
      'override-name',
    );
    errorAt(
      run((d) => {
        blk(d).overrides = ['status'];
      }),
      'scheduleBlocks[0].overrides[0]',
      'override-name',
    );
    errorAt(
      run((d) => {
        asg(d).overrides = ['title', 'title'];
      }),
      'assignments[0].overrides[1]',
      'unique',
    );
    errorAt(
      run((d) => {
        asg(d).overrides = [3];
      }),
      'assignments[0].overrides[0]',
      'type',
    );
    expect(
      run((d) => {
        asg(d).overrides = ['due', 'priority', 'tasks', 'x-anything'];
        task(d).overrides = ['due', 'required', 'recommendedStartDate'];
        d.classes[0].overrides = ['topics', 'references', 'archived'];
        evt(d).overrides = ['assignmentId', 'recurrence', 'busy'];
        avl(d).overrides = ['label', 'date'];
        blk(d).overrides = ['start', 'end', 'description'];
      }).ok,
    ).toBe(true);
  });

  it('rule 12: dates are real calendar dates (leap years included)', () => {
    errorAt(
      run((d) => {
        asg(d).due = '2026-02-30';
      }),
      'assignments[0].due',
      'real-date',
    );
    errorAt(
      run((d) => {
        blk(d).start = '2027-02-29T18:00:00';
        blk(d).end = '2027-02-29T18:30:00';
      }),
      'scheduleBlocks[0].start',
      'real-date',
    );
    errorAt(
      run((d) => {
        d.issues = [{ kind: 'other', message: 'm', date: '2026-04-31' }];
      }),
      'issues[0].date',
      'real-date',
    );
    expect(
      run((d) => {
        asg(d).due = '2028-02-29';
      }).ok,
    ).toBe(true);
  });

  it('rule 12: required Text contains a non-whitespace character (and is not empty)', () => {
    for (const [mutate, path] of [
      [(d: Doc) => (asg(d).title = '   '), 'assignments[0].title'],
      [(d: Doc) => (d.classes[0].name = '\t\n'), 'classes[0].name'],
      [(d: Doc) => (task(d).title = ' '), 'assignments[0].tasks[0].title'],
      [(d: Doc) => (d.issues = [{ kind: 'other', message: ' ' }]), 'issues[0].message'],
      [(d: Doc) => (d.meta.requestedChanges = [{ id: 'x', reason: '  ', requestedByPerson: true }]), 'meta.requestedChanges[0].reason'],
      [(d: Doc) => (asg(d).references = [{ title: ' ' }]), 'assignments[0].references[0].title'],
      [(d: Doc) => (d.meta.generator = { name: ' ' }), 'meta.generator.name'],
    ] as const) {
      errorAt(run(mutate), path, 'text-blank');
    }
    errorAt(
      run((d) => {
        asg(d).title = '';
      }),
      'assignments[0].title',
      'text-empty',
    );
    // Optional Text may be empty or blank.
    expect(
      run((d) => {
        asg(d).notes = '   ';
        d.classes[0].teacher = '';
      }).ok,
    ).toBe(true);
  });
});

describe('§ 13.2 IDs and references', () => {
  it('rule 13: item IDs are unique across the whole file, tasks included', () => {
    onlyError(
      run((d) => {
        evt(d).id = 'cls-bio';
      }),
      'events[0].id',
      'duplicate-id',
    );
    onlyError(
      run((d) => {
        task(d, 1).id = A;
        task(d, 1).dependsOn = [];
      }),
      'assignments[0].tasks[1].id',
      'duplicate-id',
    );
    onlyError(
      run((d) => {
        d.assignments.push({ id: 'other', title: 'Other', tasks: [{ id: T1, title: 'Copy' }] });
      }),
      'assignments[1].tasks[0].id',
      'duplicate-id',
    );
    onlyError(
      run((d) => {
        d.scheduleBlocks.push({ ...blk(d), start: '2026-10-09T18:00:00', end: '2026-10-09T18:30:00' });
      }),
      'scheduleBlocks[1].id',
      'duplicate-id',
    );
  });

  it('rule 14: deleted IDs are unique and not used by any item', () => {
    onlyError(
      run((d) => {
        d.deleted = [{ id: T2, collection: 'tasks', deletedAt: '2026-10-06T10:00:00' }];
      }),
      'assignments[0].tasks[1].id',
      'deleted-id-used',
    );
    onlyError(
      run((d) => {
        d.deleted = [
          { id: 'old', collection: 'events', deletedAt: '2026-10-06T10:00:00' },
          { id: 'old', collection: 'events', deletedAt: '2026-10-06T11:00:00' },
        ];
      }),
      'deleted[1].id',
      'duplicate-tombstone',
    );
  });

  it('rule 15: issue IDs are unique among all issues (root, items, tasks)', () => {
    onlyError(
      run((d) => {
        d.issues = [{ id: 'i1', kind: 'other', message: 'a' }];
        task(d).issues = [{ id: 'i1', kind: 'other', message: 'b' }];
      }),
      'assignments[0].tasks[0].issues[0].id',
      'duplicate-issue-id',
    );
    // Issue IDs are a separate namespace from item IDs.
    expect(
      run((d) => {
        d.issues = [{ id: A, kind: 'other', message: 'a' }];
      }).ok,
    ).toBe(true);
  });

  it('rule 16: requestedChanges IDs are unique', () => {
    onlyError(
      run((d) => {
        d.meta.requestedChanges = [
          { id: 'evt-soccer', reason: 'a', requestedByPerson: true },
          { id: 'evt-soccer', reason: 'b', requestedByPerson: false },
        ];
      }),
      'meta.requestedChanges[1].id',
      'duplicate-requested-change',
    );
  });

  describe('rule 17: references resolve', () => {
    it('assignment and event classId', () => {
      onlyError(
        run((d) => {
          asg(d).classId = 'cls-chem';
        }),
        'assignments[0].classId',
        'unknown-reference',
      );
      onlyError(
        run((d) => {
          evt(d).classId = A;
        }),
        'events[0].classId',
        'wrong-reference',
      );
    });

    it('event assignmentId', () => {
      onlyError(
        run((d) => {
          evt(d).assignmentId = 'nope';
        }),
        'events[0].assignmentId',
        'unknown-reference',
      );
      onlyError(
        run((d) => {
          evt(d).assignmentId = 'cls-bio';
        }),
        'events[0].assignmentId',
        'wrong-reference',
      );
    });

    it('block assignmentId and a taskId of that assignment', () => {
      onlyError(
        run((d) => {
          blk(d).assignmentId = 'nope';
        }),
        'scheduleBlocks[0].assignmentId',
        'unknown-reference',
      );
      onlyError(
        run((d) => {
          blk(d).taskId = 'nope';
        }),
        'scheduleBlocks[0].taskId',
        'unknown-reference',
      );
      onlyError(
        run((d) => {
          d.assignments.push({ id: 'other', title: 'Other' });
          blk(d).assignmentId = 'other';
        }),
        'scheduleBlocks[0].taskId',
        'task-of-other-assignment',
      );
      onlyError(
        run((d) => {
          blk(d).taskId = 'cls-bio';
        }),
        'scheduleBlocks[0].taskId',
        'wrong-reference',
      );
    });

    it('assignment dependsOn: existing other assignments', () => {
      onlyError(
        run((d) => {
          asg(d).dependsOn = [A];
        }),
        'assignments[0].dependsOn[0]',
        'depends-on-self',
      );
      onlyError(
        run((d) => {
          asg(d).dependsOn = ['nope'];
        }),
        'assignments[0].dependsOn[0]',
        'unknown-reference',
      );
      onlyError(
        run((d) => {
          asg(d).dependsOn = [T1];
        }),
        'assignments[0].dependsOn[0]',
        'wrong-reference',
      );
    });

    it('task dependsOn: other tasks of the same assignment', () => {
      onlyError(
        run((d) => {
          task(d).dependsOn = [T1];
        }),
        'assignments[0].tasks[0].dependsOn[0]',
        'depends-on-self',
      );
      onlyError(
        run((d) => {
          task(d).dependsOn = ['nope'];
        }),
        'assignments[0].tasks[0].dependsOn[0]',
        'task-dependency-outside',
      );
      onlyError(
        run((d) => {
          d.assignments.push({ id: 'other', title: 'Other', tasks: [{ id: 'other-t1', title: 'x', dependsOn: [T1] }] });
        }),
        'assignments[1].tasks[0].dependsOn[0]',
        'task-dependency-outside',
      );
    });

    it('root issue itemId: any existing item, tasks included', () => {
      onlyError(
        run((d) => {
          d.issues = [{ kind: 'other', message: 'm', itemId: 'nope' }];
        }),
        'issues[0].itemId',
        'unknown-reference',
      );
      for (const id of ['cls-bio', A, T2, 'evt-soccer', 'avail-evenings-1800-2100', 'blk-1']) {
        expect(
          run((d) => {
            d.issues = [{ kind: 'other', message: 'm', itemId: id }];
          }).ok,
        ).toBe(true);
      }
    });

    it('requestedChanges and tombstones may name items that are not in the file', () => {
      expect(
        run((d) => {
          d.meta.requestedChanges = [{ id: 'u-evt-gone', reason: 'Deleted as you asked.', requestedByPerson: true }];
          d.deleted = [{ id: 'gone', collection: 'assignments', deletedAt: '2026-10-01T10:00:00' }];
        }).ok,
      ).toBe(true);
    });
  });

  it('rule 18: no dependency cycles (assignments; tasks within one assignment)', () => {
    const result = run((d) => {
      d.assignments.push(
        { id: 'b', title: 'B', dependsOn: ['c'] },
        { id: 'c', title: 'C', dependsOn: ['d'] },
        { id: 'd', title: 'D', dependsOn: ['b'] },
        { id: 'e', title: 'E', dependsOn: ['b'] }, // depends on the cycle, not part of it
      );
    });
    onlyError(result, 'assignments[1].dependsOn', 'dependency-cycle');
    expect(result.errors[0].message).toContain('"b", "c", "d"');
    onlyError(
      run((d) => {
        task(d).dependsOn = [T2];
      }),
      'assignments[0].tasks[0].dependsOn',
      'dependency-cycle',
    );
    // A long chain (no cycle) does not overflow anything.
    const chain = run((d) => {
      d.assignments = Array.from({ length: 5000 }, (_, i) => ({ id: `a${i}`, title: `A${i}`, dependsOn: i > 0 ? [`a${i - 1}`] : [] }));
      d.scheduleBlocks = [];
    });
    expect(chain.errors).toEqual([]);
  });
});

describe('§ 13.3 times, dates and estimates', () => {
  it('rule 19: blocks last ≥ 5 minutes and end on their start date or at the next midnight', () => {
    onlyError(
      run((d) => {
        blk(d).end = '2026-10-08T18:04:00';
      }),
      'scheduleBlocks[0].end',
      'block-too-short',
    );
    onlyError(
      run((d) => {
        blk(d).end = '2026-10-08T18:00:00';
      }),
      'scheduleBlocks[0].end',
      'block-end-before-start',
    );
    onlyError(
      run((d) => {
        blk(d).start = '2026-10-08T23:00:00';
        blk(d).end = '2026-10-09T00:30:00';
      }),
      'scheduleBlocks[0].end',
      'block-crosses-midnight',
    );
    onlyError(
      run((d) => {
        blk(d).start = '2026-10-08T23:00:00';
        blk(d).end = '2026-10-10T00:00:00';
      }),
      'scheduleBlocks[0].end',
      'block-crosses-midnight',
    );
    const midnight = run((d) => {
      blk(d).start = '2026-10-08T23:55:00';
      blk(d).end = '2026-10-09T00:00:00';
    });
    expect(midnight.errors).toEqual([]);
    expect(
      run((d) => {
        blk(d).end = '2026-10-08T18:05';
      }).errors,
    ).toEqual([]);
  });

  it('rule 20: endTime > startTime (24:00 is the latest); endDate ≥ date; recurrence endDate ≥ startDate', () => {
    onlyError(
      run((d) => {
        evt(d).endTime = '16:00';
      }),
      'events[0].endTime',
      'end-time-before-start',
    );
    onlyError(
      run((d) => {
        evt(d).startTime = '20:00';
        evt(d).endTime = '00:00';
      }),
      'events[0].endTime',
      'end-time-before-start',
    );
    onlyError(
      run((d) => {
        avl(d).endTime = '17:00';
      }),
      'availability[0].endTime',
      'end-time-before-start',
    );
    expect(
      run((d) => {
        avl(d).startTime = '23:59';
        avl(d).endTime = '24:00';
      }).ok,
    ).toBe(true);
    onlyError(
      run((d) => {
        d.events[0] = { id: 'e', title: 'Trip', allDay: true, date: '2026-10-22', endDate: '2026-10-21' };
      }),
      'events[0].endDate',
      'end-date-before-start',
    );
    onlyError(
      run((d) => {
        evt(d).recurrence.endDate = '2026-10-04';
      }),
      'events[0].recurrence.endDate',
      'end-date-before-start',
    );
    expect(
      run((d) => {
        evt(d).recurrence.endDate = '2026-10-06';
      }).ok,
    ).toBe(true);
  });

  it('rule 21: recommendedCompletionDate ≤ due, else ≤ assessmentDate', () => {
    onlyError(
      run((d) => {
        asg(d).recommendedCompletionDate = '2026-10-17';
      }),
      'assignments[0].recommendedCompletionDate',
      'date-order',
    );
    onlyError(
      run((d) => {
        delete asg(d).due;
        asg(d).assessmentDate = '2026-10-16';
        asg(d).recommendedCompletionDate = '2026-10-17T08:00';
      }),
      'assignments[0].recommendedCompletionDate',
      'date-order',
    );
    // With a due, the assessmentDate does not limit the recommendation.
    expect(
      run((d) => {
        asg(d).assessmentDate = '2026-10-10';
        asg(d).recommendedCompletionDate = '2026-10-15';
      }).ok,
    ).toBe(true);
  });

  it('rules 21–22 compare dates only when either value has no time (never depending on settings)', () => {
    expect(
      run((d) => {
        asg(d).due = '2026-10-16';
        asg(d).recommendedCompletionDate = '2026-10-16T23:00:00';
        d.settings = { defaultDueTime: '00:00' };
      }).ok,
    ).toBe(true);
    errorAt(
      run((d) => {
        asg(d).due = '2026-10-16T08:00:00';
        asg(d).recommendedCompletionDate = '2026-10-16T09:00:00';
      }),
      'assignments[0].recommendedCompletionDate',
      'date-order',
    );
    expect(compareDateValues('2026-10-16', '2026-10-16T09:00')).toBe(0);
    expect(compareDateValues('2026-10-16T09:00:00', '2026-10-16T09:00')).toBe(0);
    expect(compareDateValues('2026-10-16T10:00', '2026-10-16T09:00')).toBeGreaterThan(0);
    expect(compareDateValues('2026-10-15T23:59', '2026-10-16')).toBeLessThan(0);
  });

  it('rule 22: task dates are ordered and within the assignment', () => {
    onlyError(
      run((d) => {
        Object.assign(task(d), { recommendedStartDate: '2026-10-12', recommendedCompletionDate: '2026-10-11' });
      }),
      'assignments[0].tasks[0].recommendedStartDate',
      'date-order',
    );
    onlyError(
      run((d) => {
        Object.assign(task(d), { recommendedCompletionDate: '2026-10-13', due: '2026-10-12' });
      }),
      'assignments[0].tasks[0].recommendedCompletionDate',
      'date-order',
    );
    onlyError(
      run((d) => {
        Object.assign(task(d), { recommendedStartDate: '2026-10-13', due: '2026-10-12' });
      }),
      'assignments[0].tasks[0].recommendedStartDate',
      'date-order',
    );
    onlyError(
      run((d) => {
        task(d).due = '2026-10-17';
      }),
      'assignments[0].tasks[0].due',
      'task-due-after-assignment-due',
    );
    // The task's due must be ≤ the assignment's due even when the assessment is later.
    onlyError(
      run((d) => {
        asg(d).assessmentDate = '2026-10-20';
        task(d).due = '2026-10-17';
      }),
      'assignments[0].tasks[0].due',
      'task-due-after-assignment-due',
    );
    onlyError(
      run((d) => {
        delete asg(d).due;
        asg(d).assessmentDate = '2026-10-16T09:00:00';
        task(d, 1).recommendedCompletionDate = '2026-10-17';
      }),
      'assignments[0].tasks[1].recommendedCompletionDate',
      'task-after-assignment',
    );
    onlyError(
      run((d) => {
        task(d, 1).recommendedStartDate = '2026-10-17';
      }),
      'assignments[0].tasks[1].recommendedStartDate',
      'task-after-assignment',
    );
    // ≤ the later of due and assessmentDate.
    expect(
      run((d) => {
        asg(d).due = '2026-10-12T08:00:00';
        asg(d).assessmentDate = '2026-10-16T09:00:00';
        task(d, 1).recommendedCompletionDate = '2026-10-15';
      }).ok,
    ).toBe(true);
    // Undated assignments do not limit task dates.
    expect(
      run((d) => {
        delete asg(d).due;
        task(d).recommendedCompletionDate = '2027-01-15';
      }).ok,
    ).toBe(true);
  });

  it('rule 23: estimateRange min ≤ max and min ≤ estimatedMinutes ≤ max', () => {
    onlyError(
      run((d) => {
        asg(d).estimateRange = { min: 100, max: 80 };
      }),
      'assignments[0].estimateRange',
      'estimate-range-order',
    );
    onlyError(
      run((d) => {
        asg(d).estimateRange = { min: 95, max: 120 };
      }),
      'assignments[0].estimatedMinutes',
      'estimate-outside-range',
    );
    onlyError(
      run((d) => {
        task(d).estimateRange = { min: 10, max: 25 };
      }),
      'assignments[0].tasks[0].estimatedMinutes',
      'estimate-outside-range',
    );
    expect(
      run((d) => {
        asg(d).estimateRange = { min: 90, max: 90 };
      }).ok,
    ).toBe(true);
  });

  it('rule 24: settings are checked after defaults are applied', () => {
    onlyError(
      run((d) => {
        d.settings = { dayStartTime: '23:00' };
      }),
      'settings.dayStartTime',
      'settings-day-times',
    );
    onlyError(
      run((d) => {
        d.settings = { dayEndTime: '06:00' };
      }),
      'settings.dayEndTime',
      'settings-day-times',
    );
    errorAt(
      run((d) => {
        d.settings = { minSessionMinutes: 100 };
      }),
      'settings.minSessionMinutes',
      'settings-session-length',
    );
    errorAt(
      run((d) => {
        d.settings = { maxSessionMinutes: 15 };
      }),
      'settings.maxSessionMinutes',
      'settings-session-length',
    );
    expect(
      run((d) => {
        d.settings = { dayStartTime: '23:00', dayEndTime: '24:00', minSessionMinutes: 100, maxSessionMinutes: 100 };
        d.scheduleBlocks = [];
      }).ok,
    ).toBe(true);
    // An invalid setting is reported once, not again as an ordering problem.
    onlyError(
      run((d) => {
        d.settings = { dayStartTime: '5:00', dayEndTime: '06:00' };
      }),
      'settings.dayStartTime',
      'time-format',
    );
  });
});

describe('§ 13.4 warnings', () => {
  it('a block that ends after its assignment\'s due (date-only due = defaultDueTime that day)', () => {
    const result = run((d) => {
      asg(d).due = '2026-10-08';
    });
    expect(result.ok).toBe(true);
    warningAt(result, 'scheduleBlocks[0].end', 'block-after-due');
    // With defaultDueTime 23:59 the same block is fine.
    noWarning(
      run((d) => {
        asg(d).due = '2026-10-08';
        d.settings = { defaultDueTime: '23:59' };
      }),
      'block-after-due',
    );
  });

  it('a block that ends after its task\'s due', () => {
    warningAt(
      run((d) => {
        task(d).due = '2026-10-08T18:15';
      }),
      'scheduleBlocks[0].end',
      'block-after-task-due',
    );
  });

  it('a preparation block that ends after the assessmentDate (date-only = 00:00 that day)', () => {
    const result = run((d) => {
      delete asg(d).due;
      asg(d).type = 'test';
      asg(d).assessmentDate = '2026-10-08';
    });
    expect(result.ok).toBe(true);
    warningAt(result, 'scheduleBlocks[0].end', 'block-after-assessment');
  });

  it('done and skipped blocks are history: no deadline warnings', () => {
    const result = run((d) => {
      asg(d).due = '2026-10-08';
      blk(d).status = 'done';
    });
    noWarning(result, 'block-after-due');
  });

  it('overlapping blocks, and blocks overlapping busy events', () => {
    const result = run((d) => {
      d.scheduleBlocks.push({ id: 'blk-2', title: 'Flashcards', start: '2026-10-08T18:20:00', end: '2026-10-08T18:50:00' });
      d.scheduleBlocks.push({ id: 'blk-3', title: 'Reading', start: '2026-10-08T17:00:00', end: '2026-10-08T17:45:00' });
    });
    warningAt(result, 'scheduleBlocks[1]', 'block-overlap');
    warningAt(result, 'scheduleBlocks[2]', 'block-overlaps-event');
    expect(result.warnings.filter((w) => w.code === 'block-overlap')).toHaveLength(1);
    // Touching is not overlapping; non-busy events and skipped blocks do not count.
    const clean = run((d) => {
      d.scheduleBlocks.push({ id: 'blk-2', title: 'Flashcards', start: '2026-10-08T18:30:00', end: '2026-10-08T18:50:00' });
      d.scheduleBlocks.push({ id: 'blk-3', title: 'Reading', start: '2026-10-08T17:00:00', end: '2026-10-08T17:30:00', status: 'skipped' });
      d.events.push({ id: 'evt-show', title: 'TV', busy: false, date: '2026-10-08', startTime: '18:00', endTime: '19:00' });
    });
    expect(clean.warnings).toEqual([]);
  });

  it('busy all-day and multi-day events overlap every block on their days; recurrences honour exceptDates and interval', () => {
    warningAt(
      run((d) => {
        d.events.push({ id: 'evt-trip', title: 'Trip', allDay: true, date: '2026-10-07', endDate: '2026-10-09' });
      }),
      'scheduleBlocks[0]',
      'block-overlaps-event',
    );
    noWarning(
      run((d) => {
        Object.assign(evt(d), { startTime: '18:00', endTime: '19:00' });
        evt(d).recurrence.exceptDates = ['2026-10-08'];
      }),
      'block-overlaps-event',
    );
    noWarning(
      run((d) => {
        Object.assign(evt(d), { startTime: '18:00', endTime: '19:00' });
        evt(d).recurrence.interval = 2; // the week of Oct 5 occurs, Oct 12 does not
        blk(d).start = '2026-10-15T18:00:00';
        blk(d).end = '2026-10-15T18:30:00';
      }),
      'block-overlaps-event',
    );
  });

  it('generated/planner session length and daily limit — never for user or locked blocks alone', () => {
    const result = run((d) => {
      d.settings = { maxDailyStudyMinutes: 60 };
      d.scheduleBlocks.push(
        { id: 'blk-2', assignmentId: A, start: '2026-10-09T18:00:00', end: '2026-10-09T19:30:00', origin: 'planner' },
        { id: 'blk-3', assignmentId: A, start: '2026-10-12T18:00:00', end: '2026-10-12T18:10:00' },
      );
    });
    warningAt(result, 'scheduleBlocks[1]', 'session-too-long');
    warningAt(result, 'scheduleBlocks[1]', 'daily-limit');
    warningAt(result, 'scheduleBlocks[2]', 'session-too-short');
    const protectedOnly = run((d) => {
      d.settings = { maxDailyStudyMinutes: 60 };
      d.scheduleBlocks = [
        { id: 'blk-2', assignmentId: A, start: '2026-10-09T18:00:00', end: '2026-10-09T19:30:00', origin: 'user' },
        { id: 'blk-3', assignmentId: A, start: '2026-10-12T18:00:00', end: '2026-10-12T18:10:00', locked: true },
      ];
    });
    expect(protectedOnly.warnings).toEqual([]);
  });

  it('a recurrence that never occurs', () => {
    warningAt(
      run((d) => {
        evt(d).recurrence = { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-06', endDate: '2026-10-11' };
      }),
      'events[0].recurrence',
      'recurrence-never-occurs',
    );
    warningAt(
      run((d) => {
        avl(d).recurrence = { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-05', endDate: '2026-10-12', exceptDates: ['2026-10-05', '2026-10-12'] };
      }),
      'availability[0].recurrence',
      'recurrence-never-occurs',
    );
    warningAt(
      run((d) => {
        // interval 2 from the week of Oct 5: the week of Oct 12 is skipped.
        avl(d).recurrence = { frequency: 'weekly', daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-06', endDate: '2026-10-18' };
      }),
      'availability[0].recurrence',
      'recurrence-never-occurs',
    );
    noWarning(
      run((d) => {
        avl(d).recurrence = { frequency: 'weekly', daysOfWeek: ['mon'], interval: 2, startDate: '2026-10-06', endDate: '2026-10-19' };
      }),
      'recurrence-never-occurs',
    );
  });

  it('dates more than 5 years from today (using the today option)', () => {
    const result = run((d) => {
      asg(d).due = '2032-01-01';
      d.deleted = [{ id: 'old', collection: 'events', deletedAt: '2021-10-06T10:00:00' }];
    });
    expect(result.ok).toBe(true);
    warningAt(result, 'assignments[0].due', 'far-date');
    warningAt(result, 'deleted[0].deletedAt', 'far-date');
    noWarning(validateDocument(base(), { today: '2031-10-01' }), 'far-date');
    expect(validateDocument(base(), { today: '2031-12-31' }).warnings.some((w) => w.code === 'far-date')).toBe(true);
  });

  it('overrides on a user item (ignored)', () => {
    warningAt(
      run((d) => {
        task(d).origin = 'user';
        task(d).overrides = ['title'];
      }),
      'assignments[0].tasks[0].overrides',
      'overrides-on-user-item',
    );
  });

  it('a meta.timezone that is not a known IANA name', () => {
    warningAt(
      run((d) => {
        d.meta.timezone = 'Eastern Time';
      }),
      'meta.timezone',
      'unknown-timezone',
    );
    warningAt(
      run((d) => {
        d.meta.timezone = '+02:00';
      }),
      'meta.timezone',
      'unknown-timezone',
    );
    expect(isKnownTimeZone('Europe/Berlin')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('normalized result', () => {
  it('returns a copy, never the input object', () => {
    const input = base();
    const result = validateDocument(input, { today: TODAY });
    expect(result.doc).not.toBe(input);
    expect(result.doc!.assignments[0]).not.toBe(input.assignments[0]);
    result.doc!.assignments[0].title = 'changed';
    expect(input.assignments[0].title).toBe('Lab report');
  });

  it('trims Text, writes LocalDateTimes as YYYY-MM-DDTHH:MM:00 and keeps date-only values', () => {
    const result = run((d) => {
      asg(d).title = '  Lab report \n';
      asg(d).notes = '  my notes  ';
      asg(d).due = '2026-10-16';
      asg(d).recommendedCompletionDate = '2026-10-15T20:00';
      blk(d).start = '2026-10-08T18:00';
      d.meta.generatedAt = '2026-10-07T18:00';
    });
    const doc = result.doc!;
    expect(doc.assignments[0].title).toBe('Lab report');
    expect(doc.assignments[0].notes).toBe('my notes');
    expect(doc.assignments[0].due).toBe('2026-10-16');
    expect(doc.assignments[0].recommendedCompletionDate).toBe('2026-10-15T20:00:00');
    expect(doc.scheduleBlocks[0].start).toBe('2026-10-08T18:00:00');
    expect(doc.meta!.generatedAt).toBe('2026-10-07T18:00:00');
  });

  it('keeps x- values unchanged as deep copies', () => {
    const ext = { a: [1, null, { b: 'c' }], d: null };
    const result = run((d) => {
      d['x-tool'] = ext;
      asg(d)['x-mine'] = ' spaced ';
    });
    const doc = result.doc as unknown as Record<string, unknown>;
    expect(doc['x-tool']).toEqual(ext);
    expect(doc['x-tool']).not.toBe(ext);
    expect((doc.assignments as Array<Record<string, unknown>>)[0]['x-mine']).toBe(' spaced ');
  });

  it('treats undefined properties (in-memory documents) as absent', () => {
    const result = run((d) => {
      asg(d).notes = undefined;
      asg(d).estimateRange = undefined;
      d.settings = undefined;
    });
    expect(result.ok).toBe(true);
    expect('notes' in result.doc!.assignments[0]).toBe(false);
    expect('settings' in result.doc!).toBe(false);
  });

  it('puts schemaVersion first and keeps the other keys in input order', () => {
    const d = base();
    const reordered = { scheduleBlocks: d.scheduleBlocks, classes: d.classes, schemaVersion: '1.0', assignments: d.assignments, events: d.events, availability: d.availability };
    expect(Object.keys(validateDocument(reordered).doc!)).toEqual(['schemaVersion', 'scheduleBlocks', 'classes', 'assignments', 'events', 'availability']);
  });
});

describe('robustness: data is only data', () => {
  it('"__proto__" and "constructor" keys are unknown properties and pollute nothing', () => {
    const text = JSON.stringify(base()).replace('"title":"Lab report"', '"title":"Lab report","__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}}');
    const result = parseScheduleText(text, { today: TODAY });
    errorAt(result, 'assignments[0].__proto__', 'unknown-property');
    errorAt(result, 'assignments[0].constructor', 'unknown-property');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('"__proto__" inside an x- value stays plain data in the copy', () => {
    const text = JSON.stringify({ ...base(), 'x-tool': { safe: 1 } }).replace('"safe":1', '"safe":1,"__proto__":{"polluted":true}');
    const result = parseScheduleText(text, { today: TODAY });
    expect(result.ok).toBe(true);
    const ext = (result.doc as unknown as Record<string, Record<string, unknown>>)['x-tool'];
    expect(Object.keys(ext)).toEqual(['safe', '__proto__']);
    expect(Object.getPrototypeOf(ext)).toBe(Object.prototype);
    expect((ext as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('enum and alias lookups do not see inherited properties', () => {
    errorAt(
      run((d) => {
        asg(d).status = 'constructor';
        asg(d).priority = 'toString';
        asg(d).hasOwnProperty = 1;
      }),
      'assignments[0].status',
      'enum',
    );
  });

  it('strings are never interpreted', () => {
    const result = run((d) => {
      asg(d).title = '<img src=x onerror=alert(1)>';
      asg(d).description = '${process.exit(1)} {{constructor.constructor("alert(1)")()}}';
    });
    expect(result.ok).toBe(true);
    expect(result.doc!.assignments[0].title).toBe('<img src=x onerror=alert(1)>');
  });

  it('extremely deep x- values are rejected cleanly instead of crashing later', () => {
    const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`;
    const text = JSON.stringify({ ...base(), 'x-deep': 0 }).replace('"x-deep":0', `"x-deep":${deep}`);
    const result = parseScheduleText(text, { today: TODAY });
    errorAt(result, 'x-deep', 'too-deep');
  });

  it('reports every problem, not just the first', () => {
    const result = run((d) => {
      asg(d).priority = 'normal';
      evt(d).startTime = '4 PM';
      blk(d).end = '2026-10-08T18:01:00';
      d.classes[0].color = 'green';
      d.issues = [{ kind: 'other', message: 'm', itemId: 'nope' }];
    });
    expect(result.errors.map((e) => e.path).sort()).toEqual(
      ['assignments[0].priority', 'classes[0].color', 'events[0].startTime', 'issues[0].itemId', 'scheduleBlocks[0].end'].sort(),
    );
  });
});

describe('parseScheduleText', () => {
  it('parses and validates text', () => {
    const result = parseScheduleText(JSON.stringify(base()), { today: TODAY });
    expect(result.ok).toBe(true);
  });

  it('strips a UTF-8 byte-order mark', () => {
    expect(parseScheduleText(`﻿${JSON.stringify(base())}`, { today: TODAY }).ok).toBe(true);
  });

  it('rejects empty text', () => {
    expect(parseScheduleText('   \n').errors[0]).toMatchObject({ code: 'empty', path: '' });
    expect(parseScheduleText('').stage).toBe('json');
  });

  it('rejects a top-level value that is not an object', () => {
    for (const text of ['[]', '"schedule"', '42', 'null', 'true']) {
      const result = parseScheduleText(text);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].code).toBe('root-type');
    }
  });

  it('enforces the 10 MB limit in UTF-8 bytes', () => {
    // 6 million "é" are 6 M UTF-16 units but 12 MB of UTF-8.
    const big = `{"x-pad":"${'é'.repeat(6 * 1024 * 1024)}"}`;
    expect(big.length).toBeLessThan(MAX_IMPORT_BYTES);
    const result = parseScheduleText(big);
    expect(result.stage).toBe('size');
    expect(result.errors[0].code).toBe('too-large');
    expect(result.errors[0].message).toContain('10 MB');
    // Just under the limit (ASCII) is accepted for parsing.
    const pad = MAX_IMPORT_BYTES - JSON.stringify(base()).length - 20;
    const fits = JSON.stringify({ ...base(), 'x-pad': 'a'.repeat(pad) });
    expect(utf8ByteLength(fits)).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
    expect(parseScheduleText(fits, { today: TODAY }).ok).toBe(true);
  });

  it.each([
    ['{"schemaVersion": "1.0",}', 1, 25, 'trailing comma'],
    ['{\n  "schemaVersion": "1.0"\n  "classes": []\n}', 3, 3, 'comma missing'],
    ["{'schemaVersion': '1.0'}", 1, 2, 'double quotes'],
    ['{\n  // comment\n  "a": 1\n}', 2, 3, 'comments'],
    ['{"a": "unterminated}', 1, 7, 'not closed'],
    ['{"a": [1, 2', 1, 12, 'ends too early'],
    ['{"a": tru}', 1, 7, 'unexpected word "tru"'],
    ['{"a": 01}', 1, 7, 'invalid number'],
    ['{"a": NaN}', 1, 7, 'unexpected word "NaN"'],
    ['{"a": "line\nbreak"}', 1, 12, 'must be escaped'],
    ['{"a": 1} {"b": 2}', 1, 10, 'after the end'],
    ['{"a": [1,]}', 1, 10, 'trailing comma before ]'],
    ['{"a": "\\x"}', 1, 8, 'invalid escape'],
    ['{"a" 1}', 1, 6, 'expected ":"'],
  ])('reports JSON syntax errors with line and column: %j', (text, line, column, words) => {
    const result = parseScheduleText(text);
    expect(result.stage).toBe('json');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('json-syntax');
    expect(result.errors[0].message).toContain(words);
    expect(result.errors[0].message).toContain(`(line ${line}, column ${column})`);
  });

  it('locates errors on later lines and counts columns in characters', () => {
    const loc = locateJsonError('{\n  "title": "😀😀",\n  "x": ]\n}');
    expect(loc.line).toBe(3);
    expect(loc.column).toBe(8);
  });

  it('handles very deep nesting without a stack overflow', () => {
    const deep = `${'['.repeat(100000)}${']'.repeat(99999)}`;
    const result = parseScheduleText(deep);
    expect(result.stage).toBe('json');
    expect(result.errors[0].message).toContain('ends too early');
    expect(parseScheduleText(`${'['.repeat(100000)}${']'.repeat(100000)}`).errors[0].code).toBe('root-type');
  });
});

describe('helpers', () => {
  it('codePointLength counts surrogate pairs once', () => {
    expect(codePointLength('abc')).toBe(3);
    expect(codePointLength('😀')).toBe(1);
    expect(codePointLength('a😀b')).toBe(3);
    expect(codePointLength('\ud800')).toBe(1); // lone surrogate
  });

  it('utf8ByteLength matches TextEncoder', () => {
    for (const s of ['', 'abc', 'é', '€', '😀', 'a😀é€\ud800x']) {
      expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
    }
    expect(utf8ByteLength('abcdef', 3)).toBe(Infinity);
  });
});
