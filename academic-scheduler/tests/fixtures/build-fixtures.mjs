// Regenerates the schedule-format test fixtures in ./valid and ./invalid.
//
//   node tests/fixtures/build-fixtures.mjs
//
// Every fixture is a small schedule file derived from one valid base
// document with one focused change. Each file carries its own description in
// the root extension property "x-fixture" (allowed by the format, ignored by
// readers): { kind, rule, description, expectedErrorPaths?, expectedWarningPaths? }.
// See README.md in this folder.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const README_INTRO = `# Schedule-format test fixtures

Small schedule files that pin down what is valid and what is not under
[SCHEDULE_FORMAT.md](../../SCHEDULE_FORMAT.md) version 1.0. They are shared by
the website's tests (\`tests/unit/schema-parity.test.ts\`) and by the
\`/academic-schedule\` skill's Python validator
(\`skills/academic-schedule/scripts/validate_schedule.py\`), so both sides
enforce the same rules. The two shipped examples (\`examples/*.json\`) are
valid fixtures as well.

**Do not edit the JSON files by hand.** They are generated from one small
valid base document (\`valid/base.json\`) with one focused change each:

\`\`\`
node tests/fixtures/build-fixtures.mjs
\`\`\`

This also rewrites this README (the tables below come from the fixtures).

## Layout and metadata

- \`valid/*.json\` — must be accepted: no errors (warnings are allowed).
- \`invalid/structural-*.json\` — break a rule marked **[S]** in § 13: the
  JSON Schema (\`schema/schedule-1.0.schema.json\`, draft 2020-12) rejects
  them, and so must every validator.
- \`invalid/semantic-*.json\` — break only a rule marked **[V]** in § 13: the
  JSON Schema accepts them, every full validator must reject them.

Each file (except \`structural-root-is-array.json\`, whose root is \`[]\`)
describes itself in the root extension property \`"x-fixture"\` — legal in
every schedule file and ignored by readers:

\`\`\`json
"x-fixture": {
  "kind": "valid" | "structural" | "semantic",
  "rule": "§ 13.3 rule 19",
  "description": "What the file checks",
  "expectedErrorPaths": ["scheduleBlocks[0].end"],
  "expectedWarningPaths": ["meta.timezone"]
}
\`\`\`

A validator passes a fixture when it accepts every valid file and, for every
invalid file, reports at least one error at **each** of the
\`expectedErrorPaths\` (it may report more). Paths use the website's syntax:
\`assignments[0].tasks[1].due\`; property names that are not plain
identifiers in brackets (\`assignments[0]["due date"]\`); the root is \`""\`.
\`expectedWarningPaths\` (only in \`valid/warnings-only.json\`) lists where
the website reports § 13.4 warnings; warnings are advisory and need not match
exactly. Use **today = 2026-10-07** for the "more than 5 years away" warning.

## Points a Python validator must get right

- **Full-match patterns** (\`re.fullmatch\`): \`"2026-10-05\\n"\` is not a
  Date (\`structural-date-trailing-newline.json\`); the \`jsonschema\`
  package alone accepts it.
- **Lengths in code points**: a 200-emoji title is valid
  (\`valid/unicode-lengths.json\`).
- **Integers**: \`90.0\` is the integer 90 (\`valid/integer-with-decimal-point.json\`),
  but \`true\` is not a number (\`structural-minutes-boolean.json\`,
  \`structural-interval-boolean.json\`; in Python \`bool\` is an \`int\`).
- **\`null\`** is invalid everywhere except inside \`x-…\` values
  (\`valid/every-optional-field.json\` has \`null\` and a \`"__proto__"\` key
  inside an \`x-\` value).
- **Real calendar dates** (\`semantic-impossible-date.json\`,
  \`semantic-non-leap-year-february-29.json\`, \`valid/leap-day.json\`).
- **Date comparisons (§ 13.3)**: when either value is a Date without a time,
  compare the dates only (\`valid/date-only-and-date-time-comparisons.json\`);
  both with times → compare date-times
  (\`semantic-completion-after-due-same-day-times.json\`).
- **Task dates vs. the assignment (rule 22)**: "≤ the later of due and
  assessmentDate" is checked as "not later than both of them"
  (\`valid/task-dates-before-later-of-due-and-assessment.json\`); a task's own
  \`due\` must additionally be ≤ the assignment's \`due\`. The § 9 chain
  \`recommendedStartDate ≤ recommendedCompletionDate ≤ due\` applies to each
  pair that is present (\`semantic-task-start-after-task-due.json\`).
- **Settings after defaults (rule 24)**: \`{"dayStartTime": "23:00"}\` and
  \`{"minSessionMinutes": 100}\` are invalid on their own.
- **Blocks (rule 19)**: end ≥ start + 5 min, on the start date or exactly
  00:00 of the next date.
- **Unsupported versions (§ 2)**: report one clear error and stop.

The website additionally rejects files over 10 MB and \`x-…\` values nested
more than 200 levels deep (it could not store them); these are limits of the
website, not format rules, so no fixture covers them.
`;

const A = 'biology-lab-report-2026-10-16';
const T1 = `${A}-t1`;
const T2 = `${A}-t2`;
const BLK = `blk-${A}-202610071800-1`;

function base() {
  return {
    schemaVersion: '1.0',
    meta: {
      title: 'Fixture schedule',
      generatedAt: '2026-10-07T18:00:00',
      generator: { name: 'fixture-builder', version: '1.0' },
      timezone: 'America/New_York',
    },
    classes: [{ id: 'cls-biology', name: 'Biology', teacher: 'Mr. Chen', color: '#16A34A', origin: 'generated' }],
    assignments: [
      {
        id: A,
        classId: 'cls-biology',
        title: 'Lab report: osmosis',
        type: 'lab',
        due: '2026-10-16T23:59:00',
        estimatedMinutes: 90,
        priority: 'high',
        tasks: [
          { id: T1, title: 'Analyse the data', estimatedMinutes: 30 },
          { id: T2, title: 'Write the report', estimatedMinutes: 60, dependsOn: [T1] },
        ],
        origin: 'generated',
        source: { kind: 'syllabus', label: 'Biology syllabus.pdf' },
      },
    ],
    events: [
      {
        id: 'evt-soccer',
        title: 'Soccer practice',
        category: 'activity',
        startTime: '16:00',
        endTime: '17:30',
        recurrence: { frequency: 'weekly', daysOfWeek: ['tue', 'thu'], startDate: '2026-10-05' },
        origin: 'generated',
        source: { kind: 'user', label: 'Told /academic-schedule on 2026-10-07' },
      },
    ],
    availability: [
      {
        id: 'avail-evenings-1800-2100',
        label: 'Evenings',
        startTime: '18:00',
        endTime: '21:00',
        recurrence: { frequency: 'weekly', daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'], startDate: '2026-10-05' },
        origin: 'generated',
      },
    ],
    scheduleBlocks: [
      {
        id: BLK,
        assignmentId: A,
        taskId: T1,
        start: '2026-10-08T18:00:00',
        end: '2026-10-08T18:30:00',
        description: 'Graph the mass changes and compute the averages.',
        origin: 'generated',
      },
    ],
  };
}

const fixtures = [];

function add(dir, name, meta, mutate, raw) {
  fixtures.push({ dir, name, meta, mutate, raw });
}
const valid = (name, description, mutate, extra = {}) => add('valid', name, { kind: 'valid', description, ...extra }, mutate);
const structural = (name, rule, description, paths, mutate, raw) =>
  add('invalid', `structural-${name}`, { kind: 'structural', rule, description, expectedErrorPaths: paths }, mutate, raw);
const semantic = (name, rule, description, paths, mutate) =>
  add('invalid', `semantic-${name}`, { kind: 'semantic', rule, description, expectedErrorPaths: paths }, mutate);

const asg = (d) => d.assignments[0];
const task = (d, i = 0) => d.assignments[0].tasks[i];
const evt = (d) => d.events[0];
const avl = (d) => d.availability[0];
const blk = (d) => d.scheduleBlocks[0];
const secondAssignment = (d, extra = {}) => {
  d.assignments.push({ id: 'biology-reading-ch5-2026-10-14', classId: 'cls-biology', title: 'Read chapter 5', type: 'reading', due: '2026-10-14', origin: 'generated', ...extra });
  return d.assignments[1];
};

// ---------------------------------------------------------------------------
// Valid files
// ---------------------------------------------------------------------------

valid('minimal', 'The minimal valid file of § 18.1: five empty collections.', () => ({
  schemaVersion: '1.0',
  classes: [],
  assignments: [],
  events: [],
  availability: [],
  scheduleBlocks: [],
}));

valid('base', 'The base document every other fixture is derived from.', () => {});

valid('every-optional-field', 'Every optional field of every object type is present, with x- properties on every object (null and "__proto__" inside x- values are plain data).', (d) => {
  // A computed key creates an own property named "__proto__" (plain data in the file).
  d['x-tool'] = { note: null, list: [1, null, { deep: true }], ['__proto__']: { polluted: true } };
  d.meta = {
    title: 'Fall 2026',
    generatedAt: '2026-10-07T18:00:00',
    generator: { name: 'fixture-builder', version: '1.0', 'x-build': 7 },
    timezone: 'America/New_York',
    basedOn: 'u-exp-h7w2c9qe',
    sources: [{ kind: 'schedule', label: 'schedule.json', 'x-size': 1234 }],
    requestedChanges: [{ id: 'u-evt-p4n0l7s2', reason: 'You asked to move piano to Thursdays.', requestedByPerson: true, 'x-why': null }],
    'x-meta': 'kept',
  };
  d.settings = {
    weekStartsOn: 'sunday',
    dayStartTime: '06:30',
    dayEndTime: '23:00',
    defaultDueTime: '23:59',
    minSessionMinutes: 15,
    maxSessionMinutes: 90,
    breakMinutes: 5,
    maxDailyStudyMinutes: 240,
    'x-theme': 'dark',
  };
  d.classes[0] = {
    id: 'cls-biology',
    origin: 'generated',
    locked: false,
    overrides: ['teacher', 'x-tool'],
    name: 'Biology',
    teacher: 'Dr. Chen',
    section: 'Period 2',
    room: 'Lab 3',
    color: '#16a34a',
    description: 'Cells, genetics and ecology.',
    archived: false,
    topics: ['Unit 2: Cells', 'Unit 3: Genetics'],
    references: [
      { title: 'Lab safety rules.pdf', url: 'https://example.org/safety.pdf', path: 'Biology/Materials/Lab safety rules.pdf', kind: 'reading', required: false, 'x-ref': 1 },
    ],
    source: { kind: 'syllabus', id: 'bio-syllabus-2026', url: 'https://example.org/syllabus', path: 'syllabus.pdf', label: 'Biology syllabus.pdf', retrievedAt: '2026-10-01T08:00', 'x-src': true },
    sources: [{ kind: 'image', label: 'Whiteboard photo' }],
    issues: [{ id: 'cls-biology:other:room', kind: 'other', message: 'Room changes in November.', field: 'room', status: 'open', date: '2026-11-02', 'x-issue': [] }],
    'x-class': { a: 1 },
  };
  Object.assign(asg(d), {
    locked: false,
    overrides: ['priority'],
    topic: 'Unit 2: Cells',
    description: 'Write up the osmosis lab: hypothesis, method, results, discussion.',
    notes: 'Ask about the error bars.',
    assessmentDate: '2026-10-16T09:00:00',
    recommendedCompletionDate: '2026-10-15',
    estimatedMinutes: 90,
    estimateRange: { min: 75, max: 105, 'x-range': 'midpoint' },
    estimateConfidence: 'medium',
    estimateBasis: 'Two pages of writing plus a graph.',
    status: 'in_progress',
    points: '20 points',
    required: true,
    sourceState: 'present',
    references: [{ title: 'Rubric', url: 'https://example.org/rubric', kind: 'rubric', required: true }],
    dependsOn: ['biology-reading-ch5-2026-10-14'],
    sources: [{ kind: 'document', label: 'Lab handout' }],
    issues: [{ id: `${A}:ambiguity:due`, kind: 'ambiguity', message: 'The handout says "Friday".', field: 'due', status: 'dismissed' }],
    'x-assignment': 'kept',
  });
  Object.assign(task(d, 0), {
    origin: 'generated',
    locked: true,
    overrides: ['title'],
    description: 'Means and error bars.',
    notes: 'Use the class spreadsheet.',
    estimatedMinutes: 30,
    estimateRange: { min: 20, max: 40 },
    status: 'done',
    completedAt: '2026-10-08T18:30:00',
    recommendedStartDate: '2026-10-08',
    recommendedCompletionDate: '2026-10-09',
    due: '2026-10-12',
    required: true,
    issues: [{ id: `${T1}:other`, kind: 'other', message: 'Two groups lost their data.' }],
    'x-task': 1,
  });
  secondAssignment(d, { estimatedMinutes: 40, status: 'done', completedAt: '2026-10-07T17:00:00', required: false, sourceState: 'withdrawn' });
  d.events[0] = {
    ...evt(d),
    locked: false,
    overrides: ['startTime'],
    classId: 'cls-biology',
    busy: true,
    location: 'Field 2',
    notes: 'Bring cleats.',
    recurrence: { frequency: 'weekly', daysOfWeek: ['tue', 'thu'], interval: 1, startDate: '2026-10-05', endDate: '2026-12-17', exceptDates: ['2026-11-26'], 'x-rec': null },
    sources: [{ kind: 'calendar', label: 'Team calendar' }],
    issues: [],
    'x-event': true,
  };
  d.events.push({ id: 'evt-field-trip-2026-10-22', title: 'Field trip', category: 'school', date: '2026-10-22', endDate: '2026-10-23', allDay: true, busy: true, assignmentId: A, origin: 'generated' });
  Object.assign(avl(d), { locked: false, overrides: ['endTime'], source: { kind: 'user', label: 'Told /academic-schedule on 2026-10-07' }, 'x-avl': 0 });
  d.availability.push({ id: 'avail-2026-10-17-1000-1200', label: 'Saturday morning', date: '2026-10-17', startTime: '10:00', endTime: '12:00', origin: 'generated' });
  Object.assign(blk(d), { status: 'done', completedAt: '2026-10-08T18:30:00', kind: 'work', title: 'Data analysis', notes: 'Went well.', locked: true, overrides: ['description'], 'x-blk': {} });
  d.scheduleBlocks.push(
    { id: 'u-blk-k2m9x7qa', start: '2026-10-08T18:30:00', end: '2026-10-08T18:40:00', kind: 'break', title: 'Break', origin: 'planner' },
    { id: 'u-blk-p3n8z1wd', assignmentId: A, taskId: T2, start: '2026-10-13T18:00', end: '2026-10-13T19:00', status: 'planned', origin: 'planner' },
  );
  d.issues = [{ id: 'workload:2026-10-15', kind: 'workload', message: 'Thursday is tight.', date: '2026-10-15', itemId: T2, status: 'resolved', field: 'estimatedMinutes', 'x-root-issue': 1 }];
  d.deleted = [{ id: 'gc-NzAwMDAwMDAwMDA0', collection: 'assignments', deletedAt: '2026-10-06T16:12:00', sourceId: 'NzAwMDAwMDAwMDA0', title: 'Optional crossword', 'x-tomb': 'x' }];
});

valid('midnight-end-times', '"24:00" end times (event, availability, settings.dayEndTime) and a block that ends at 00:00 of the next date.', (d) => {
  d.settings = { dayEndTime: '24:00' };
  Object.assign(evt(d), { startTime: '21:00', endTime: '24:00' });
  Object.assign(avl(d), { startTime: '20:00', endTime: '24:00' });
  Object.assign(blk(d), { start: '2026-10-08T23:00:00', end: '2026-10-09T00:00:00' });
});

valid('date-only-and-date-time-comparisons', 'Rules 21–22 compare dates only when either value has no time: these values count as equal, so the file is valid.', (d) => {
  Object.assign(asg(d), { due: '2026-10-16', recommendedCompletionDate: '2026-10-16T22:00:00' });
  Object.assign(task(d, 0), { recommendedStartDate: '2026-10-12', recommendedCompletionDate: '2026-10-12T20:00:00', due: '2026-10-12' });
  Object.assign(task(d, 1), { due: '2026-10-16T23:59:00', recommendedCompletionDate: '2026-10-16' });
});

valid('task-dates-before-later-of-due-and-assessment', 'A task date may be later than the assignment\'s due as long as it is not later than its assessmentDate (the later of the two).', (d) => {
  Object.assign(asg(d), { due: '2026-10-12T08:00:00', assessmentDate: '2026-10-16T09:00:00', type: 'presentation' });
  Object.assign(task(d, 1), { recommendedCompletionDate: '2026-10-15' });
});

valid('date-times-without-seconds', 'LocalDateTimes may omit the seconds ("YYYY-MM-DDTHH:MM").', (d) => {
  asg(d).due = '2026-10-16T23:59';
  Object.assign(blk(d), { start: '2026-10-08T18:00', end: '2026-10-08T18:30' });
  d.meta.generatedAt = '2026-10-07T18:00';
});

valid('unicode-lengths', 'Lengths count Unicode code points: a 200-emoji title (400 UTF-16 units) is within the 200-character limit.', (d) => {
  asg(d).title = '📚'.repeat(200);
  d.classes[0].name = 'Biología — Señora Núñez';
  d.classes[0].room = '🧪'.repeat(100);
});

valid('leap-day', '2028-02-29 is a real calendar date.', (d) => {
  asg(d).due = '2028-02-29T23:59:00';
});

valid('protected-items-and-history', 'User, locked and planner items, done/skipped blocks, tombstones, requested changes and root issues about tasks.', (d) => {
  d.classes.push({ id: 'u-cls-a8d2k4m1', name: 'Piano', origin: 'user' });
  d.assignments.push({ id: 'u-asg-k3j9x2p1', title: 'Practice scales', classId: 'u-cls-a8d2k4m1', estimatedMinutes: 30, locked: true, origin: 'user', tasks: [{ id: 'u-tsk-q1w2e3r4', title: 'C major', origin: 'user' }] });
  d.scheduleBlocks.push(
    { id: 'u-blk-a1b2c3d4', assignmentId: 'u-asg-k3j9x2p1', taskId: 'u-tsk-q1w2e3r4', start: '2026-10-06T19:00:00', end: '2026-10-06T19:30:00', status: 'skipped', origin: 'user' },
    { id: 'u-blk-e5f6g7h8', assignmentId: A, taskId: T2, start: '2026-10-09T18:00:00', end: '2026-10-09T19:00:00', origin: 'planner', locked: true },
  );
  d.issues = [{ id: 'u-iss-z9y8x7w6', kind: 'conflict', message: 'Your practice overlaps soccer.', itemId: 'u-tsk-q1w2e3r4', status: 'dismissed' }];
  d.deleted = [
    { id: `${A}-t3`, collection: 'tasks', deletedAt: '2026-10-07T12:00:00', title: 'Peer review' },
    { id: 'evt-band', collection: 'events', deletedAt: '2026-10-07T12:01:00' },
  ];
  d.meta.requestedChanges = [{ id: 'u-asg-k3j9x2p1', reason: 'A teacher email moved the recital.', requestedByPerson: false }];
});

valid('settings-extremes', 'Settings at the edges of their ranges: minSessionMinutes = maxSessionMinutes, zero break and daily limit, 00:00–24:00 day.', (d) => {
  d.settings = { dayStartTime: '00:00', dayEndTime: '24:00', minSessionMinutes: 60, maxSessionMinutes: 60, breakMinutes: 0, maxDailyStudyMinutes: 0, defaultDueTime: '00:00', weekStartsOn: 'monday' };
});

valid('empty-optional-arrays', 'Empty optional arrays are allowed (they mean the same as absent).', (d) => {
  Object.assign(asg(d), { references: [], dependsOn: [], issues: [], overrides: [], sources: [] });
  Object.assign(task(d, 0), { dependsOn: [], issues: [], overrides: [] });
  evt(d).recurrence.exceptDates = [];
  d.issues = [];
  d.deleted = [];
  d.meta.sources = [];
  d.meta.requestedChanges = [];
  d.classes[0].topics = [];
  d.classes[0].references = [];
});

valid(
  'warnings-only',
  'Valid, but every § 13.4 warning applies: blocks after due/task due/assessment, overlaps (block, busy event), session length, daily limit, a recurrence that never occurs, a far date, overrides on a user item, an unknown time zone.',
  (d) => {
    d.meta.timezone = 'Mars/Olympus_Mons';
    d.settings = { maxDailyStudyMinutes: 60 };
    Object.assign(task(d, 0), { due: '2026-10-08' });
    secondAssignment(d, { type: 'quiz', due: undefined, assessmentDate: '2026-10-09' });
    d.scheduleBlocks = [
      // after its task's due (date-only due = 00:00 that day)
      { id: 'blk-1', assignmentId: A, taskId: T1, start: '2026-10-08T18:00:00', end: '2026-10-08T18:30:00', origin: 'generated' },
      // after the assignment's due; 90 minutes (> maxSessionMinutes 60)
      { id: 'blk-2', assignmentId: A, start: '2026-10-17T10:00:00', end: '2026-10-17T11:30:00', origin: 'generated' },
      // preparation after the assessment (date-only assessmentDate = 00:00); overlaps soccer (Fri? no: Thu)
      { id: 'blk-3', assignmentId: 'biology-reading-ch5-2026-10-14', start: '2026-10-15T16:30:00', end: '2026-10-15T16:40:00', origin: 'planner' },
      // overlaps blk-3
      { id: 'blk-4', title: 'Flashcards', start: '2026-10-15T16:35:00', end: '2026-10-15T17:35:00', origin: 'generated' },
    ];
    d.events.push({
      id: 'evt-never',
      title: 'Club',
      startTime: '12:00',
      endTime: '13:00',
      recurrence: { frequency: 'weekly', daysOfWeek: ['mon'], startDate: '2026-10-06', endDate: '2026-10-11' },
    });
    d.classes.push({ id: 'u-cls-a8d2k4m1', name: 'Piano', origin: 'user', overrides: ['name'] });
    d.deleted = [{ id: 'old-item', collection: 'assignments', deletedAt: '2019-01-01T00:00:00' }];
  },
  {
    expectedWarningPaths: [
      'meta.timezone',
      'scheduleBlocks[0].end',
      'scheduleBlocks[1].end',
      'scheduleBlocks[1]',
      'scheduleBlocks[2].end',
      'scheduleBlocks[2]',
      'scheduleBlocks[3]',
      'events[1].recurrence',
      'classes[1].overrides',
      'deleted[0].deletedAt',
    ],
  },
);

add(
  'valid',
  'integer-with-decimal-point',
  { kind: 'valid', description: 'Integers are JSON numbers without a fractional part: 90.0 is the integer 90 (Python: json.loads gives a float; accept it when it is whole).' },
  () => {},
  'DECIMAL_INTEGER',
);

valid('multi-day-all-day-event', 'A one-time all-day event spanning several days (endDate ≥ date), non-busy.', (d) => {
  d.events.push({ id: 'evt-fall-break-2026-10-26', title: 'Fall break', category: 'school', date: '2026-10-26', endDate: '2026-10-30', allDay: true, busy: false });
});

// ---------------------------------------------------------------------------
// Structurally invalid files (the JSON Schema rejects them too)
// ---------------------------------------------------------------------------

structural('root-is-array', '§ 13.1 rule 1', 'The root must be an object.', [''], null, '[]\n');
structural('schema-version-number', '§ 2, § 13.1 rule 1', 'schemaVersion must be the string "1.0", not the number 1.0.', ['schemaVersion'], null, 'NUMBER_VERSION');
structural('schema-version-unsupported-major', '§ 2', 'Major version 2 is not supported (single clear error).', ['schemaVersion'], (d) => {
  d.schemaVersion = '2.0';
});
structural('schema-version-newer-minor', '§ 2', 'Minor version 1.3 is newer than 1.0.', ['schemaVersion'], (d) => {
  d.schemaVersion = '1.3';
});
structural('schema-version-missing', '§ 2', 'schemaVersion is required.', ['schemaVersion'], (d) => {
  delete d.schemaVersion;
});
structural('missing-collection', '§ 13.1 rule 1', 'All five collections are required.', ['scheduleBlocks'], (d) => {
  delete d.scheduleBlocks;
});
structural('collection-not-array', '§ 13.1 rule 1', 'Collections are arrays.', ['classes'], (d) => {
  d.classes = {};
});
structural('unknown-property', '§ 13.1 rule 3', 'Unknown properties are invalid ("dueDate" instead of "due").', ['assignments[0].dueDate'], (d) => {
  asg(d).dueDate = '2026-10-16';
});
structural('uppercase-extension-prefix', '§ 1, § 13.1 rule 3', 'Only names starting with lowercase "x-" are extensions; "X-tool" is unknown.', ['X-tool'], (d) => {
  d['X-tool'] = {};
});
structural('proto-key', '§ 13.1 rule 3', 'A "__proto__" property is just an unknown property (no prototype pollution).', ['assignments[0].__proto__'], null, 'PROTO');
structural('null-value', '§ 1, § 13.1 rule 4', 'null is not a valid value; omit the field instead.', ['classes[0].teacher'], (d) => {
  d.classes[0].teacher = null;
});
structural('null-in-array', '§ 13.1 rule 4', 'null is not a valid array entry.', ['assignments[0].tasks[1].dependsOn[0]'], (d) => {
  task(d, 1).dependsOn = [null];
});
structural('id-with-space', '§ 3 ID', 'IDs have no spaces.', ['scheduleBlocks[0].id'], (d) => {
  blk(d).id = 'blk 1';
});
structural('id-too-long', '§ 3 ID', 'IDs have at most 100 characters.', ['classes[0].id'], (d) => {
  const id = `c${'x'.repeat(100)}`;
  d.classes[0].id = id;
  asg(d).classId = id;
});
structural('id-leading-dash', '§ 3 ID', 'IDs start with a letter or digit.', ['events[0].id'], (d) => {
  evt(d).id = '-evt-soccer';
});
structural('date-us-format', '§ 3 Date', '"10/16/2026" is not a Date.', ['assignments[0].due'], (d) => {
  asg(d).due = '10/16/2026';
});
structural('date-trailing-newline', '§ 3 patterns (full match)', '"2026-10-05\\n" is not a Date: patterns must match the whole value (Python: re.fullmatch).', ['events[0].recurrence.startDate'], (d) => {
  evt(d).recurrence.startDate = '2026-10-05\n';
});
structural('date-with-time-in-date-field', '§ 3 Date', 'recommendedStartDate is a Date, not a LocalDateTime.', ['assignments[0].tasks[0].recommendedStartDate'], (d) => {
  task(d, 0).recommendedStartDate = '2026-10-08T18:00:00';
});
structural('datetime-utc-z', '§ 3 LocalDateTime, § 4', 'Local date-times have no "Z".', ['scheduleBlocks[0].start'], (d) => {
  blk(d).start = '2026-10-08T18:00:00Z';
});
structural('datetime-offset', '§ 3 LocalDateTime, § 4', 'Local date-times have no UTC offset.', ['assignments[0].due'], (d) => {
  asg(d).due = '2026-10-16T23:59:00-04:00';
});
structural('datetime-nonzero-seconds', '§ 3 seconds', 'Seconds must be ":00".', ['assignments[0].due'], (d) => {
  asg(d).due = '2026-10-16T23:59:59';
});
structural('datetime-space-separator', '§ 3 LocalDateTime', 'Date and time are separated by "T".', ['meta.generatedAt'], (d) => {
  d.meta.generatedAt = '2026-10-07 18:00';
});
structural('time-24-00-as-start', '§ 3 Time', '"24:00" is only allowed as an end time.', ['availability[0].startTime'], (d) => {
  avl(d).startTime = '24:00';
});
structural('time-12-hour-clock', '§ 3 Time', '"4:00 PM" is not a Time.', ['events[0].startTime'], (d) => {
  evt(d).startTime = '4:00 PM';
});
structural('end-time-24-30', '§ 3 EndTime', '"24:30" is not an EndTime.', ['settings.dayEndTime'], (d) => {
  d.settings = { dayEndTime: '24:30' };
});
structural('weekday-full-name', '§ 3 Weekday', '"Tuesday" is not a Weekday.', ['events[0].recurrence.daysOfWeek[0]'], (d) => {
  evt(d).recurrence.daysOfWeek = ['Tuesday', 'thu'];
});
structural('recurrence-duplicate-days', '§ 13.1 rule 5', 'daysOfWeek values are unique.', ['events[0].recurrence.daysOfWeek[1]'], (d) => {
  evt(d).recurrence.daysOfWeek = ['tue', 'tue'];
});
structural('recurrence-no-days', '§ 13.1 rule 5', 'daysOfWeek has at least one value.', ['availability[0].recurrence.daysOfWeek'], (d) => {
  avl(d).recurrence.daysOfWeek = [];
});
structural('recurrence-daily', '§ 10 Recurrence', 'Only "weekly" exists in 1.0.', ['events[0].recurrence.frequency'], (d) => {
  evt(d).recurrence.frequency = 'daily';
});
structural('recurrence-interval-zero', '§ 10 Recurrence', 'interval is 1–52.', ['events[0].recurrence.interval'], (d) => {
  evt(d).recurrence.interval = 0;
});
structural('minutes-fraction', '§ 3 Minutes', 'Minutes are whole numbers.', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimatedMinutes = 90.5;
});
structural('minutes-string', '§ 3 Minutes', 'Minutes are numbers, not strings.', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimatedMinutes = '90';
});
structural('minutes-negative', '§ 3 Minutes', 'Minutes are 0–10000.', ['assignments[0].tasks[0].estimatedMinutes'], (d) => {
  task(d, 0).estimatedMinutes = -10;
});
structural('minutes-too-large', '§ 3 Minutes', 'Minutes are 0–10000.', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimatedMinutes = 10001;
});
structural('minutes-boolean', '§ 3 Minutes', 'true is not a number (Python: bool is a subclass of int; reject it).', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimatedMinutes = true;
});
structural('interval-boolean', '§ 10 Recurrence', 'interval is an integer, not a boolean.', ['events[0].recurrence.interval'], (d) => {
  evt(d).recurrence.interval = true;
});
structural('url-javascript', '§ 3 URL', 'Only http: and https: URLs are allowed.', ['assignments[0].references[0].url'], (d) => {
  asg(d).references = [{ title: 'Rubric', url: 'javascript:alert(1)' }];
});
structural('url-relative', '§ 3 URL', 'URLs are absolute.', ['assignments[0].source.url'], (d) => {
  asg(d).source.url = '/c/abc';
});
structural('enum-status-complete', '§ 8 status', '"complete" is not a status ("done").', ['assignments[0].status'], (d) => {
  asg(d).status = 'complete';
});
structural('enum-priority-normal', '§ 8 priority', '"normal" is not a priority ("medium").', ['assignments[0].priority'], (d) => {
  asg(d).priority = 'normal';
});
structural('enum-source-kind', '§ 5 Source', 'Unknown source kind.', ['assignments[0].source.kind'], (d) => {
  asg(d).source.kind = 'email';
});
structural('title-too-long', '§ 8 title', 'title has at most 200 characters.', ['assignments[0].title'], (d) => {
  asg(d).title = 'a'.repeat(201);
});
structural('title-empty', '§ 8 title', 'A required Text is not empty.', ['assignments[0].tasks[1].title'], (d) => {
  task(d, 1).title = '';
});
structural('boolean-as-string', '§ 10 busy', 'Booleans are true/false, not strings.', ['events[0].busy'], (d) => {
  evt(d).busy = 'false';
});
structural('color-short-hex', '§ 3 Color', 'Colors are #RRGGBB.', ['classes[0].color'], (d) => {
  d.classes[0].color = '#FFF';
});
structural('event-date-and-recurrence', '§ 13.1 rule 5', 'An event has date or recurrence, not both.', ['events[0].recurrence'], (d) => {
  evt(d).date = '2026-10-08';
});
structural('event-neither-date-nor-recurrence', '§ 13.1 rule 5', 'An event needs date or recurrence.', ['events[0]'], (d) => {
  delete evt(d).recurrence;
});
structural('event-all-day-with-times', '§ 13.1 rule 5', 'An all-day event has no startTime/endTime.', ['events[0].startTime', 'events[0].endTime'], (d) => {
  evt(d).allDay = true;
});
structural('event-missing-end-time', '§ 13.1 rule 5', 'A timed event needs startTime and endTime.', ['events[0].endTime'], (d) => {
  delete evt(d).endTime;
});
structural('event-end-date-not-all-day', '§ 13.1 rule 5', 'endDate only on all-day one-time events.', ['events[0].endDate'], (d) => {
  d.events[0] = { id: 'evt-trip-2026-10-22', title: 'Trip', date: '2026-10-22', endDate: '2026-10-23', startTime: '08:00', endTime: '16:00' };
});
structural('event-end-date-with-recurrence', '§ 13.1 rule 5', 'endDate requires date.', ['events[0].endDate'], (d) => {
  Object.assign(evt(d), { allDay: true, endDate: '2026-12-01' });
  delete evt(d).startTime;
  delete evt(d).endTime;
});
structural('availability-date-and-recurrence', '§ 13.1 rule 5', 'Availability has date or recurrence, not both.', ['availability[0].recurrence'], (d) => {
  avl(d).date = '2026-10-08';
});
structural('availability-missing-start', '§ 11', 'startTime is required.', ['availability[0].startTime'], (d) => {
  delete avl(d).startTime;
});
structural('block-without-assignment-or-title', '§ 13.1 rule 6', 'A block needs an assignmentId or a title.', ['scheduleBlocks[0]'], (d) => {
  delete blk(d).assignmentId;
  delete blk(d).taskId;
});
structural('block-break-with-assignment', '§ 13.1 rule 6', 'A break has a title and no assignmentId.', ['scheduleBlocks[0].assignmentId'], (d) => {
  Object.assign(blk(d), { kind: 'break', title: 'Break' });
  delete blk(d).taskId;
});
structural('block-task-without-assignment', '§ 13.1 rule 6', 'taskId requires assignmentId.', ['scheduleBlocks[0].taskId'], (d) => {
  delete blk(d).assignmentId;
  blk(d).title = 'Data analysis';
});
structural('completed-at-without-done', '§ 13.1 rule 7', 'completedAt only when status is "done".', ['assignments[0].tasks[0].completedAt'], (d) => {
  task(d, 0).completedAt = '2026-10-08T18:30:00';
});
structural('completed-at-with-skipped-block', '§ 13.1 rule 7', 'completedAt only when status is "done".', ['scheduleBlocks[0].completedAt'], (d) => {
  Object.assign(blk(d), { status: 'skipped', completedAt: '2026-10-08T18:30:00' });
});
structural('estimate-range-without-estimate', '§ 13.1 rule 8', 'estimateRange requires estimatedMinutes.', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimateRange = { min: 60, max: 75 };
  delete asg(d).estimatedMinutes;
});
structural('estimate-range-missing-max', '§ 8 estimateRange', 'estimateRange has min and max.', ['assignments[0].estimateRange.max'], (d) => {
  asg(d).estimateRange = { min: 60 };
});
structural('origin-planner-on-assignment', '§ 13.1 rule 9', '"planner" only on schedule blocks.', ['assignments[0].origin'], (d) => {
  asg(d).origin = 'planner';
});
structural('item-issue-with-item-id', '§ 13.1 rule 10', 'itemId only on root issues.', ['assignments[0].issues[0].itemId'], (d) => {
  asg(d).issues = [{ kind: 'other', message: 'See the task.', itemId: T1 }];
});
structural('issue-missing-message', '§ 5 Issue', 'Issues need a message.', ['issues[0].message'], (d) => {
  d.issues = [{ kind: 'workload' }];
});
structural('overrides-person-owned-field', '§ 13.1 rule 11', '"notes" can never be listed in overrides.', ['assignments[0].overrides[0]'], (d) => {
  asg(d).overrides = ['notes'];
});
structural('overrides-duplicate', '§ 13.1 rule 11', 'overrides entries are unique.', ['assignments[0].overrides[1]'], (d) => {
  asg(d).overrides = ['title', 'title'];
});
structural('overrides-wrong-item-type', '§ 13.1 rule 11', '"title" is not a field of a class.', ['classes[0].overrides[0]'], (d) => {
  d.classes[0].overrides = ['title'];
});
structural('task-with-source', '§ 6', 'Tasks have no source.', ['assignments[0].tasks[0].source'], (d) => {
  task(d, 0).source = { kind: 'syllabus' };
});
structural('too-many-sources', '§ 6 sources', 'sources has at most 20 entries.', ['classes[0].sources'], (d) => {
  d.classes[0].sources = Array.from({ length: 21 }, (_, i) => ({ kind: 'document', label: `Doc ${i + 1}` }));
});
structural('settings-out-of-range', '§ 5 Settings', 'minSessionMinutes is 5–240.', ['settings.minSessionMinutes'], (d) => {
  d.settings = { minSessionMinutes: 2 };
});
structural('settings-unknown-field', '§ 5 Settings', 'Unknown settings field.', ['settings.theme'], (d) => {
  d.settings = { theme: 'dark' };
});
structural('generator-without-name', '§ 5 Meta', 'meta.generator needs a name.', ['meta.generator.name'], (d) => {
  d.meta.generator = { version: '1.0' };
});
structural('requested-change-missing-reason', '§ 5 Requested change', 'A requested change needs a reason.', ['meta.requestedChanges[0].reason'], (d) => {
  d.meta.requestedChanges = [{ id: 'evt-soccer', requestedByPerson: true }];
});
structural('tombstone-bad-collection', '§ 5 Deleted item', 'collection is one of the six collection names.', ['deleted[0].collection'], (d) => {
  d.deleted = [{ id: 'old-block', collection: 'blocks', deletedAt: '2026-10-01T10:00:00' }];
});
structural('task-depends-on-duplicate', '§ 9 dependsOn', 'dependsOn entries are unique.', ['assignments[0].tasks[1].dependsOn[1]'], (d) => {
  task(d, 1).dependsOn = [T1, T1];
});

// ---------------------------------------------------------------------------
// Semantically invalid files (the JSON Schema accepts them; § 13 [V] rules)
// ---------------------------------------------------------------------------

semantic('impossible-date', '§ 13.1 rule 12', '2026-02-30 matches the pattern but is not a real date.', ['assignments[0].due'], (d) => {
  asg(d).due = '2026-02-30';
});
semantic('non-leap-year-february-29', '§ 13.1 rule 12', '2027 is not a leap year.', ['scheduleBlocks[0].start', 'scheduleBlocks[0].end'], (d) => {
  Object.assign(blk(d), { start: '2027-02-29T18:00:00', end: '2027-02-29T18:30:00' });
});
semantic('impossible-issue-date', '§ 13.1 rule 12', 'November has 30 days.', ['issues[0].date'], (d) => {
  d.issues = [{ kind: 'workload', message: 'Busy day.', date: '2026-11-31' }];
});
semantic('blank-title', '§ 13.1 rule 12', 'A required Text must contain a non-whitespace character.', ['assignments[0].title'], (d) => {
  asg(d).title = '   ';
});
semantic('blank-requested-change-reason', '§ 13.1 rule 12', 'reason must contain a non-whitespace character.', ['meta.requestedChanges[0].reason'], (d) => {
  d.meta.requestedChanges = [{ id: 'evt-soccer', reason: ' \t ', requestedByPerson: false }];
});
semantic('duplicate-id-across-collections', '§ 13.2 rule 13', 'An event uses the ID of a class.', ['events[0].id'], (d) => {
  evt(d).id = 'cls-biology';
});
semantic('duplicate-task-id', '§ 13.2 rule 13', 'Two tasks of different assignments share an ID.', ['assignments[1].tasks[0].id'], (d) => {
  secondAssignment(d, { tasks: [{ id: T1, title: 'Skim the chapter' }] });
});
semantic('tombstone-id-in-use', '§ 13.2 rule 14', 'No item may use an ID listed in deleted.', ['events[0].id'], (d) => {
  d.deleted = [{ id: 'evt-soccer', collection: 'events', deletedAt: '2026-10-06T10:00:00' }];
});
semantic('duplicate-tombstone', '§ 13.2 rule 14', 'deleted IDs are unique.', ['deleted[1].id'], (d) => {
  d.deleted = [
    { id: 'old-1', collection: 'events', deletedAt: '2026-10-06T10:00:00' },
    { id: 'old-1', collection: 'assignments', deletedAt: '2026-10-06T11:00:00' },
  ];
});
semantic('duplicate-issue-id', '§ 13.2 rule 15', 'Issue IDs are unique among all issues (root and item issues).', ['assignments[0].issues[0].id'], (d) => {
  d.issues = [{ id: 'iss-1', kind: 'other', message: 'Root issue.' }];
  asg(d).issues = [{ id: 'iss-1', kind: 'other', message: 'Item issue.' }];
});
semantic('duplicate-requested-change', '§ 13.2 rule 16', 'requestedChanges IDs are unique.', ['meta.requestedChanges[1].id'], (d) => {
  d.meta.requestedChanges = [
    { id: 'evt-soccer', reason: 'Moved to Wednesday.', requestedByPerson: true },
    { id: 'evt-soccer', reason: 'Renamed.', requestedByPerson: true },
  ];
});
semantic('unknown-class', '§ 13.2 rule 17', 'classId must reference an existing class.', ['assignments[0].classId'], (d) => {
  asg(d).classId = 'cls-chemistry';
});
semantic('class-id-names-an-assignment', '§ 13.2 rule 17', 'classId must name a class, not an item of another collection.', ['events[0].classId'], (d) => {
  evt(d).classId = A;
});
semantic('event-unknown-assignment', '§ 13.2 rule 17', 'An event\'s assignmentId must exist.', ['events[0].assignmentId'], (d) => {
  evt(d).assignmentId = 'piano-theory-exam-2026-10-24';
});
semantic('block-unknown-assignment', '§ 13.2 rule 17', 'A block\'s assignmentId must exist.', ['scheduleBlocks[0].assignmentId'], (d) => {
  blk(d).assignmentId = 'gc-NzAwMDAwMDAwMDk5';
  delete blk(d).taskId;
});
semantic('block-task-of-other-assignment', '§ 13.2 rule 17', 'A block\'s taskId must be a task of its own assignment.', ['scheduleBlocks[0].taskId'], (d) => {
  secondAssignment(d);
  blk(d).assignmentId = 'biology-reading-ch5-2026-10-14';
});
semantic('assignment-depends-on-self', '§ 13.2 rule 17', 'An assignment cannot depend on itself.', ['assignments[0].dependsOn[0]'], (d) => {
  asg(d).dependsOn = [A];
});
semantic('assignment-depends-on-unknown', '§ 13.2 rule 17', 'dependsOn references existing assignments.', ['assignments[0].dependsOn[0]'], (d) => {
  asg(d).dependsOn = ['biology-unit-1-test'];
});
semantic('assignment-dependency-cycle', '§ 13.2 rule 18', 'Assignments depend on each other in a cycle.', ['assignments[0].dependsOn'], (d) => {
  asg(d).dependsOn = ['biology-reading-ch5-2026-10-14'];
  secondAssignment(d, { dependsOn: [A] });
});
semantic('task-depends-on-other-assignment-task', '§ 13.2 rule 17', 'Tasks depend only on tasks of the same assignment.', ['assignments[1].tasks[0].dependsOn[0]'], (d) => {
  secondAssignment(d, { tasks: [{ id: 'biology-reading-ch5-2026-10-14-t1', title: 'Read', dependsOn: [T1] }] });
});
semantic('task-dependency-cycle', '§ 13.2 rule 18', 'Tasks depend on each other in a cycle.', ['assignments[0].tasks[0].dependsOn'], (d) => {
  task(d, 0).dependsOn = [T2];
});
semantic('root-issue-unknown-item', '§ 13.2 rule 17', 'A root issue\'s itemId must name an existing item.', ['issues[0].itemId'], (d) => {
  d.issues = [{ kind: 'conflict', message: 'Overlaps practice.', itemId: 'evt-band' }];
});
semantic('block-shorter-than-5-minutes', '§ 13.3 rule 19', 'A block lasts at least 5 minutes.', ['scheduleBlocks[0].end'], (d) => {
  blk(d).end = '2026-10-08T18:04:00';
});
semantic('block-crosses-midnight', '§ 13.3 rule 19', 'A block ends on its start date or at 00:00 of the next date.', ['scheduleBlocks[0].end'], (d) => {
  Object.assign(blk(d), { start: '2026-10-08T23:00:00', end: '2026-10-09T00:30:00' });
});
semantic('block-ends-midnight-two-days-later', '§ 13.3 rule 19', 'Only 00:00 of the NEXT date is allowed.', ['scheduleBlocks[0].end'], (d) => {
  Object.assign(blk(d), { start: '2026-10-08T23:00:00', end: '2026-10-10T00:00:00' });
});
semantic('block-end-before-start', '§ 13.3 rule 19', 'end is after start.', ['scheduleBlocks[0].end'], (d) => {
  Object.assign(blk(d), { start: '2026-10-08T18:30:00', end: '2026-10-08T18:00:00' });
});
semantic('event-end-before-start', '§ 13.3 rule 20', 'endTime is later than startTime.', ['events[0].endTime'], (d) => {
  Object.assign(evt(d), { startTime: '17:30', endTime: '16:00' });
});
semantic('event-midnight-as-00-00', '§ 13.3 rule 20, § 19', 'An event ending at midnight uses "24:00", not "00:00".', ['events[0].endTime'], (d) => {
  Object.assign(evt(d), { startTime: '20:00', endTime: '00:00' });
});
semantic('availability-end-equals-start', '§ 13.3 rule 20', 'endTime is later than startTime (not equal).', ['availability[0].endTime'], (d) => {
  avl(d).endTime = '18:00';
});
semantic('event-end-date-before-date', '§ 13.3 rule 20', 'endDate ≥ date.', ['events[0].endDate'], (d) => {
  d.events[0] = { id: 'evt-trip-2026-10-22', title: 'Trip', date: '2026-10-22', endDate: '2026-10-21', allDay: true };
});
semantic('recurrence-end-before-start', '§ 13.3 rule 20', 'recurrence endDate ≥ startDate.', ['availability[0].recurrence.endDate'], (d) => {
  avl(d).recurrence.endDate = '2026-10-01';
});
semantic('completion-after-due', '§ 13.3 rule 21', 'recommendedCompletionDate ≤ due.', ['assignments[0].recommendedCompletionDate'], (d) => {
  asg(d).recommendedCompletionDate = '2026-10-17';
});
semantic('completion-after-due-same-day-times', '§ 13.3 rule 21', 'Both values have a time, so they are compared as date-times.', ['assignments[0].recommendedCompletionDate'], (d) => {
  Object.assign(asg(d), { due: '2026-10-16T08:00:00', recommendedCompletionDate: '2026-10-16T20:00:00' });
});
semantic('completion-after-assessment', '§ 13.3 rule 21', 'Without due, recommendedCompletionDate ≤ assessmentDate.', ['assignments[0].recommendedCompletionDate'], (d) => {
  Object.assign(asg(d), { type: 'test', assessmentDate: '2026-10-16', recommendedCompletionDate: '2026-10-18' });
  delete asg(d).due;
});
semantic('task-start-after-completion', '§ 13.3 rule 22', 'recommendedStartDate ≤ recommendedCompletionDate.', ['assignments[0].tasks[0].recommendedStartDate'], (d) => {
  Object.assign(task(d, 0), { recommendedStartDate: '2026-10-12', recommendedCompletionDate: '2026-10-10' });
});
semantic('task-completion-after-task-due', '§ 13.3 rule 22', 'A task\'s recommendedCompletionDate ≤ its due.', ['assignments[0].tasks[0].recommendedCompletionDate'], (d) => {
  Object.assign(task(d, 0), { recommendedCompletionDate: '2026-10-13', due: '2026-10-12' });
});
semantic('task-start-after-task-due', '§ 9, § 13.3 rule 22', 'recommendedStartDate ≤ recommendedCompletionDate ≤ due "each when present" (§ 9): a start after the task\'s due is invalid even without a recommendedCompletionDate.', ['assignments[0].tasks[0].recommendedStartDate'], (d) => {
  Object.assign(task(d, 0), { recommendedStartDate: '2026-10-13', due: '2026-10-12' });
});
semantic('task-due-after-assignment-due', '§ 13.3 rule 22', 'A task\'s due ≤ the assignment\'s due.', ['assignments[0].tasks[1].due'], (d) => {
  task(d, 1).due = '2026-10-17';
});
semantic('task-date-after-assessment', '§ 13.3 rule 22', 'Task dates ≤ the assignment\'s due/assessmentDate.', ['assignments[0].tasks[1].recommendedCompletionDate'], (d) => {
  Object.assign(asg(d), { type: 'test', assessmentDate: '2026-10-16T09:00:00' });
  delete asg(d).due;
  task(d, 1).recommendedCompletionDate = '2026-10-19';
});
semantic('estimate-outside-range', '§ 13.3 rule 23', 'min ≤ estimatedMinutes ≤ max.', ['assignments[0].estimatedMinutes'], (d) => {
  asg(d).estimateRange = { min: 100, max: 120 };
});
semantic('estimate-range-min-above-max', '§ 13.3 rule 23', 'estimateRange.min ≤ estimateRange.max.', ['assignments[0].tasks[0].estimateRange'], (d) => {
  task(d, 0).estimateRange = { min: 40, max: 20 };
});
semantic('settings-day-start-after-default-end', '§ 13.3 rule 24', 'dayStartTime 23:00 is after the default dayEndTime 22:00 (checked after defaults).', ['settings.dayStartTime'], (d) => {
  d.settings = { dayStartTime: '23:00' };
});
semantic('settings-min-session-above-default-max', '§ 13.3 rule 24', 'minSessionMinutes 100 is above the default maxSessionMinutes 60.', ['settings.minSessionMinutes'], (d) => {
  d.settings = { minSessionMinutes: 100 };
});
semantic('settings-day-end-before-start', '§ 13.3 rule 24', 'dayEndTime must be later than dayStartTime.', ['settings.dayEndTime'], (d) => {
  d.settings = { dayStartTime: '09:00', dayEndTime: '08:00' };
});

// ---------------------------------------------------------------------------

function build(fixture) {
  if (fixture.raw === '[]\n') return fixture.raw;
  const doc = base();
  let result = doc;
  if (fixture.mutate) {
    const replaced = fixture.mutate(doc);
    if (replaced) result = replaced;
  }
  const withMeta = { schemaVersion: result.schemaVersion, 'x-fixture': fixture.meta, ...result };
  if (!('schemaVersion' in result)) delete withMeta.schemaVersion;
  // JSON.stringify leaves out keys set to undefined.
  let json = JSON.stringify(withMeta, null, 2);
  if (fixture.raw === 'NUMBER_VERSION') json = json.replace('"schemaVersion": "1.0"', '"schemaVersion": 1.0');
  if (fixture.raw === 'DECIMAL_INTEGER') json = json.replace('"estimatedMinutes": 90,', '"estimatedMinutes": 90.0,');
  if (fixture.raw === 'PROTO') json = json.replace(`"id": "${A}",`, `"id": "${A}",\n      "__proto__": { "polluted": true },`);
  return `${json}\n`;
}

for (const dir of ['valid', 'invalid']) {
  const path = join(here, dir);
  mkdirSync(path, { recursive: true });
  for (const file of readdirSync(path)) if (file.endsWith('.json')) rmSync(join(path, file));
}
const names = new Set();
for (const fixture of fixtures) {
  if (names.has(fixture.name)) throw new Error(`Duplicate fixture name ${fixture.name}`);
  names.add(fixture.name);
  writeFileSync(join(here, fixture.dir, `${fixture.name}.json`), build(fixture));
}
writeFileSync(join(here, 'README.md'), readme());
console.log(`Wrote ${fixtures.filter((f) => f.dir === 'valid').length} valid and ${fixtures.filter((f) => f.dir === 'invalid').length} invalid fixtures and README.md.`);

function readme() {
  const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const rows = (filter) =>
    fixtures
      .filter(filter)
      .map((f) => {
        const paths = (f.meta.expectedErrorPaths ?? []).map((p) => `\`${p === '' ? '(root)' : p}\``).join(', ');
        return `| \`${f.dir}/${f.name}.json\` | ${cell(f.meta.rule ?? '')} | ${cell(f.meta.description)} | ${paths} |`;
      })
      .join('\n');
  const header = '| File | Rule | What it checks | Expected error paths |\n| --- | --- | --- | --- |';
  return `${README_INTRO}
## Valid files

${header}
${rows((f) => f.dir === 'valid')}

## Structurally invalid files (the JSON Schema rejects them too)

${header}
${rows((f) => f.meta.kind === 'structural')}

## Semantically invalid files (the JSON Schema accepts them; a § 13 [V] rule rejects them)

${header}
${rows((f) => f.meta.kind === 'semantic')}
`;
}
