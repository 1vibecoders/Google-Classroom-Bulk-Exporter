# Schedule File Format — version 1.0

This document is the complete, normative description of the JSON file that the
**Academic Scheduler** website imports and exports, and that the Claude
**`/schedule`** skill generates. The two components communicate only through
this format.

It is written so that a developer or an AI can produce valid files without
guessing. A machine-readable JSON Schema for the structural rules is shipped
next to this file: [`schema/schedule-1.0.schema.json`](schema/schedule-1.0.schema.json).
The JSON Schema cannot express every rule; the **semantic rules** in
[§ 13](#13-validation-rules) also apply, and the website and the skill's
validator (`skills/schedule/scripts/validate_schedule.py`) enforce all of them.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT** and **MAY**
are used as in RFC 2119.

---

## Contents

1. [File basics](#1-file-basics)
2. [Versioning](#2-versioning)
3. [Data types](#3-data-types)
4. [Time zones](#4-time-zones)
5. [Root object](#5-root-object)
6. [Fields shared by all items](#6-fields-shared-by-all-items)
7. [Classes](#7-classes)
8. [Assignments](#8-assignments)
9. [Tasks (subtasks)](#9-tasks-subtasks)
10. [Events (recurring and one-time)](#10-events-recurring-and-one-time)
11. [Availability (study time)](#11-availability-study-time)
12. [Schedule blocks (scheduled work)](#12-schedule-blocks-scheduled-work)
13. [Validation rules](#13-validation-rules)
14. [IDs: format, generation and preservation](#14-ids-format-generation-and-preservation)
15. [Updating an existing schedule (rules for generators)](#15-updating-an-existing-schedule-rules-for-generators)
16. [How the website imports a file](#16-how-the-website-imports-a-file)
17. [How the website exports a file](#17-how-the-website-exports-a-file)
18. [Examples](#18-examples)
19. [Common mistakes](#19-common-mistakes)
20. [Changelog](#20-changelog)

---

## 1. File basics

- A schedule file is **one JSON object** (RFC 8259), encoded as **UTF-8**,
  usually named `schedule.json`.
- It contains **data only**. Readers MUST treat every value as plain data.
  No field is ever evaluated, executed or interpreted as markup or code.
  Text is displayed as plain text; URLs are only used as links (and only
  `http:`/`https:` URLs are allowed).
- Property names are case-sensitive and written exactly as shown here
  (camelCase).
- **Unknown properties are invalid**, with one exception: property names that
  start with `x-` (for example `"x-myTool": {...}`) are allowed on the root
  object and on every item. Readers MUST ignore their meaning and MUST
  preserve them unchanged when they re-export the item.
- `null` is **not** a valid value for any field defined here. Omit an optional
  field instead of setting it to `null`.
- The maximum file size the website accepts is 10 MB.

## 2. Versioning

Every file MUST start with a `schemaVersion` string of the form
`"MAJOR.MINOR"`. This document defines **`"1.0"`**.

| Change | Version change | Example |
| --- | --- | --- |
| New optional field, new enum value, new collection | MINOR (`1.0` → `1.1`) | adding an optional `room` to events |
| Removing/renaming a field, changing a type or meaning, making an optional field required | MAJOR (`1.x` → `2.0`) | changing `estimatedMinutes` to hours |

Rules:

- A reader that implements version `M.n` MUST accept files whose major version
  is `M` and whose minor version is `≤ n`, and MUST **reject** any other
  version with a clear message (for example: *"This file uses schema version
  1.3, but this version of the Academic Scheduler supports up to 1.0. Update
  the website or generate a 1.0 file."*). The current website supports
  exactly `1.0`.
- A writer MUST write the lowest version that contains every feature it uses.
  Today that is always `"1.0"`.
- `schemaVersion` is a **string**. `1.0` (a number) is invalid.

## 3. Data types

| Type | Format | Valid examples | Invalid examples |
| --- | --- | --- | --- |
| **ID** | 1–100 characters; first character a letter or digit; then letters, digits, `.` `_` `:` `-`. Regex `^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$`. Case-sensitive. | `english-essay-2026-10-16`, `gc-NjI3ODk0MjE0NTQ5`, `blk:001` | `""`, `-abc`, `my essay`, `essay/1` |
| **Date** | `YYYY-MM-DD`, a real calendar date | `2026-10-16` | `2026-2-3`, `2026-02-30`, `10/16/2026` |
| **Time** | `HH:MM`, 24-hour clock, zero-padded, `00:00`–`23:59` | `08:00`, `15:30`, `23:59` | `8:00`, `3:30 PM`, `24:00` |
| **LocalDateTime** | `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS`, **no** time-zone suffix | `2026-10-16T23:59:00`, `2026-10-13T16:00` | `2026-10-16T23:59:00Z`, `2026-10-16T23:59:00-04:00`, `2026-10-16 23:59` |
| **DateOrDateTime** | a Date **or** a LocalDateTime | `2026-10-20`, `2026-10-20T09:00` | as above |
| **Weekday** | one of `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"` | `"wed"` | `"Wednesday"`, `"W"`, `3` |
| **Color** | `#RRGGBB` hexadecimal | `#3B82F6`, `#e11d48` | `blue`, `#FFF`, `rgb(0,0,0)` |
| **Minutes** | integer, `0`–`10000` | `45`, `180` | `45.5`, `"45"`, `-10` |
| **URL** | absolute `http:` or `https:` URL, ≤ 2000 characters | `https://classroom.google.com/c/abc` | `javascript:alert(1)`, `/relative/path` |
| **Text** | string; limits per field below; leading/trailing whitespace is trimmed by the website | | |

Seconds in a LocalDateTime are accepted but the website works in whole
minutes; `:SS` other than `:00` is rounded down to the minute.

## 4. Time zones

All dates and times are **local wall-clock times of the person whose
schedule this is**. There are no UTC times and no offsets in item fields.
`2026-10-16T23:59:00` means 11:59 PM on October 16 on the person's own clock.

The optional `meta.timezone` field (an IANA name such as
`"America/New_York"`) records which zone that is. It is informational: the
website never converts times between zones.

## 5. Root object

```json
{
  "schemaVersion": "1.0",
  "meta": { },
  "settings": { },
  "classes": [ ],
  "assignments": [ ],
  "events": [ ],
  "availability": [ ],
  "scheduleBlocks": [ ],
  "issues": [ ]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | string | **yes** | `"1.0"` for this version. |
| `classes` | array of [Class](#7-classes) | **yes** (may be empty) | Courses. |
| `assignments` | array of [Assignment](#8-assignments) | **yes** (may be empty) | Homework, projects, readings, quizzes, tests, … |
| `events` | array of [Event](#10-events-recurring-and-one-time) | **yes** (may be empty) | Fixed commitments: school, activities, appointments. |
| `availability` | array of [Availability](#11-availability-study-time) | **yes** (may be empty) | When the person is free to study. |
| `scheduleBlocks` | array of [ScheduleBlock](#12-schedule-blocks-scheduled-work) | **yes** (may be empty) | Work placed on the calendar. |
| `meta` | [Meta](#meta) | no | Information about the file. |
| `settings` | [Settings](#settings) | no | Scheduling preferences. |
| `issues` | array of [Issue](#issue) | no | Problems that concern the whole schedule (for example an overloaded day). |

All five collections are required so that a reader never has to guess whether
a missing collection means "none" or "unknown".

### Meta

All fields optional.

| Field | Type | Description |
| --- | --- | --- |
| `title` | Text ≤ 200 | A name for the schedule, e.g. `"Fall 2026"`. |
| `generatedAt` | string, ISO 8601 date-time (offset allowed here, e.g. `2026-10-07T14:03:00-04:00` or a LocalDateTime) | When the file was written. |
| `generator` | object `{ "name": Text ≤ 100 (required), "version": Text ≤ 50 }` | The program that wrote the file, e.g. `{"name": "claude-schedule-skill", "version": "1.0"}` or `{"name": "Academic Scheduler", "version": "1.0.0"}`. |
| `timezone` | Text ≤ 100 | IANA time-zone name, informational (see § 4). |
| `sources` | array of [Source](#source) | The materials the file was generated from (Classroom export, syllabus, …). |

### Settings

All fields optional; the default is used when a field is absent.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `weekStartsOn` | `"monday"` \| `"sunday"` | `"monday"` | First day of the week in week views. |
| `dayStartTime` | Time | `"07:00"` | Earliest time shown in day/week timelines. |
| `dayEndTime` | Time | `"22:00"` | Latest time shown (must be later than `dayStartTime`). |
| `defaultDueTime` | Time | `"23:59"` | Time of day used for a `due` that is a date without a time. |
| `minSessionMinutes` | Minutes (5–240) | `20` | Shortest work session worth scheduling. |
| `maxSessionMinutes` | Minutes (10–480) | `60` | Longest single work session; must be ≥ `minSessionMinutes`. |
| `breakMinutes` | Minutes (0–120) | `10` | Gap to leave between consecutive work sessions. |
| `maxDailyStudyMinutes` | Minutes (0–1440) | no limit | Upper limit of scheduled work per day. |

### Issue

An issue records uncertainty or a problem that a person should look at. It
appears on the root (`issues`) and on any item.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `"ambiguity"` \| `"conflict"` \| `"missing_information"` \| `"workload"` \| `"other"` | **yes** | `ambiguity`: the source can be read more than one way. `conflict`: sources disagree. `missing_information`: something needed is not in the sources. `workload`: the schedule is tight or impossible. |
| `message` | Text 1–1000 | **yes** | Plain-language explanation, e.g. `"Syllabus says the midterm is Oct 21; Classroom says Oct 20. Using Oct 21 (syllabus)."` |
| `field` | Text ≤ 100 | no | The field the issue is about, e.g. `"due"`, `"estimatedMinutes"`. |

### Source

Where an item (or the whole file) came from. Informational; preserved as is.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | `"google_classroom"` \| `"syllabus"` \| `"calendar"` \| `"document"` \| `"user"` \| `"other"` | **yes** | Type of source. |
| `id` | Text ≤ 200 | no | The source's own identifier (e.g. the Google Classroom item id). |
| `url` | URL | no | Link to the source (e.g. the Classroom page). |
| `path` | Text ≤ 500 | no | Path of the file inside an export, e.g. `English 10/Assignments/Othello Essay/metadata.json`. |
| `label` | Text ≤ 200 | no | Human-readable name, e.g. `"English 10 syllabus (PDF), p. 2"`. |

## 6. Fields shared by all items

Classes, assignments, tasks, events, availability windows and schedule blocks
all have these fields:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | ID | **yes** | | Unique in the **whole file** (across all collections and all tasks). Never changes once assigned; see § 14. |
| `origin` | `"user"` \| `"generated"` | no | `"generated"` | `user`: created or owned by the person in the website. `generated`: created by a generator such as the `/schedule` skill. Generators MUST NOT modify or delete `user` items. |
| `locked` | boolean | no | `false` | The person pinned or manually changed this item. Generators MUST NOT modify, move or delete locked items; the website's import does not overwrite them. |
| `source` | [Source](#source) | no | | Where the item came from. |
| `issues` | array of [Issue](#issue) | no | `[]` | Open questions about the item. |

Tasks have `id`, `origin`, `locked` and `issues` but no `source` (they inherit
the assignment's).

## 7. Classes

```json
{
  "id": "gc-class-NjI3ODk0MjE0NTQ5",
  "name": "English 10",
  "teacher": "Ms. Rivera",
  "section": "Period 3",
  "room": "204",
  "color": "#2563EB",
  "description": "American and British literature; essays every unit.",
  "origin": "generated",
  "source": { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5" }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id`, `origin`, `locked`, `source`, `issues` | | | See § 6. |
| `name` | Text 1–200 | **yes** | Class name. |
| `teacher` | Text ≤ 200 | no | Teacher's name. |
| `section` | Text ≤ 200 | no | Section/period. |
| `room` | Text ≤ 100 | no | Room. |
| `color` | Color | no | Display color. If absent, the website assigns one. |
| `description` | Text ≤ 5000 | no | Course description. |
| `archived` | boolean | no (default `false`) | Hidden from pickers and filters; its items still display. |

## 8. Assignments

An **assignment** is any piece of academic work or assessment: homework,
reading, essays, problem sets, labs, projects, presentations, quizzes, tests,
exams, or a study goal.

```json
{
  "id": "gc-NzAwMDAwMDAwMDAx",
  "classId": "gc-class-NjI3ODk0MjE0NTQ5",
  "title": "Othello Essay",
  "type": "writing",
  "description": "Write a 1,200–1,500 word analytical essay on jealousy in Othello. MLA format, at least three quotations.",
  "due": "2026-10-16T23:59:00",
  "recommendedCompletionDate": "2026-10-15",
  "estimatedMinutes": 240,
  "estimateRange": { "min": 200, "max": 300 },
  "estimateConfidence": "medium",
  "estimateBasis": "1,200–1,500 words of analytical writing (~3 h) plus outlining and revision; teacher's rubric requires three quotations.",
  "priority": "high",
  "status": "not_started",
  "points": "100 points",
  "tasks": [ ],
  "references": [ { "title": "Essay rubric.pdf", "kind": "rubric", "required": true, "url": "https://drive.google.com/file/d/1Abc/view" } ],
  "dependsOn": [ "gc-NzAwMDAwMDAwMDAw" ],
  "origin": "generated",
  "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAx", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAx/details" }
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `source`, `issues` | | | | See § 6. |
| `title` | Text 1–200 | **yes** | | Short title. |
| `classId` | ID | no | | The [class](#7-classes) it belongs to. Omit for personal tasks. MUST reference an existing class. |
| `type` | enum, see below | no | `"homework"` | Kind of work. |
| `description` | Text ≤ 20000 | no | | Instructions / requirements (from the source). |
| `notes` | Text ≤ 10000 | no | | The person's own notes. Owned by the person; see § 16.3. |
| `due` | DateOrDateTime | no | | **Due date**: when the work must be submitted. A Date without a time means the end of that day (`settings.defaultDueTime`). |
| `assessmentDate` | DateOrDateTime | no | | **Assessment date**: when an in-class quiz, test, exam or presentation takes place. A Date without a time means "that day, time unknown". |
| `recommendedCompletionDate` | DateOrDateTime | no | | **Recommended completion date**: when the work should ideally be finished, earlier than the deadline. Never a deadline itself. |
| `estimatedMinutes` | Minutes | no | | Best single estimate of the **total** work time still to be planned for this assignment, including all of its tasks. For assessments, the recommended total preparation time. |
| `estimateRange` | object `{ "min": Minutes, "max": Minutes }` | no | | Uncertainty range; `min ≤ estimatedMinutes ≤ max` when both are present. |
| `estimateConfidence` | `"low"` \| `"medium"` \| `"high"` | no | | How reliable the estimate is. |
| `estimateBasis` | Text ≤ 2000 | no | | The evidence behind the estimate, e.g. `"25 pages of reading + 12 short-answer questions"`. |
| `priority` | `"low"` \| `"medium"` \| `"high"` \| `"urgent"` | no | `"medium"` | Importance. |
| `status` | `"not_started"` \| `"in_progress"` \| `"done"` \| `"cancelled"` | no | `"not_started"` | `cancelled`: no longer required (removed by the teacher, excused, optional and skipped). |
| `completedAt` | LocalDateTime | no | | When it was marked done. Only allowed when `status` is `"done"`. |
| `points` | Text ≤ 100 | no | | Points/weight as written by the source, e.g. `"100 points"`, `"15% of grade"`. |
| `required` | boolean | no | `true` | `false` for optional/extra-credit work. |
| `tasks` | array of [Task](#9-tasks-subtasks) | no | `[]` | Steps of the assignment, in recommended order. |
| `references` | array of [Reference](#reference) | no | `[]` | Attachments, links and materials. |
| `dependsOn` | array of assignment IDs | no | `[]` | Assignments that should be finished first (e.g. a reading before its quiz). Must exist, must not include itself, no cycles. |

**`type` values:**

| Value | Use for |
| --- | --- |
| `homework` | General homework, worksheets, short tasks. |
| `reading` | Reading assignments. |
| `writing` | Essays, reports, responses, papers. |
| `problem_set` | Math/science problem sets. |
| `lab` | Lab work and lab reports. |
| `project` | Multi-step / multi-day projects. |
| `presentation` | Presentations (use `assessmentDate` for the presentation day). |
| `quiz` | Quizzes (use `assessmentDate`). |
| `test` | Tests (use `assessmentDate`). |
| `exam` | Midterms, finals, standardized exams (use `assessmentDate`). |
| `study` | A study goal that is not tied to one assessment. |
| `other` | Anything else. |

**Dates — they are not interchangeable:**

- `due`: submission deadline. Present for anything that is handed in.
- `assessmentDate`: the date the assessment happens. Quizzes, tests and
  exams normally have `assessmentDate` and **no** `due` (unless something must
  also be submitted, e.g. a take-home part).
- `recommendedCompletionDate`: a planning target that is earlier than
  `due`/`assessmentDate`. It MUST NOT be later than the `due` date when both
  are present.
- An assignment MAY have none of these (undated work); the website lists it
  under "No date".

### Reference

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | Text 1–300 | **yes** | Display name, e.g. a file name. |
| `url` | URL | no | Link to open it. |
| `path` | Text ≤ 500 | no | Path inside an export (informational). |
| `kind` | `"attachment"` \| `"link"` \| `"reading"` \| `"rubric"` \| `"template"` \| `"other"` | no (default `"attachment"`) | What it is. |
| `required` | boolean | no (default `false`) | `true` if the work requires using/submitting it. Reference material is `false`. |

## 9. Tasks (subtasks)

Large assignments are split into tasks. Simple homework normally has no tasks.

```json
{
  "id": "gc-NzAwMDAwMDAwMDAx-t3",
  "title": "Draft body paragraphs",
  "estimatedMinutes": 90,
  "dependsOn": [ "gc-NzAwMDAwMDAwMDAx-t2" ],
  "recommendedStartDate": "2026-10-13",
  "recommendedCompletionDate": "2026-10-14",
  "status": "not_started"
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | ID | **yes** | | Unique in the whole file. Recommended form: `<assignmentId>-t<N>`. |
| `origin`, `locked`, `issues` | | no | | See § 6. |
| `title` | Text 1–200 | **yes** | | What to do. |
| `description` | Text ≤ 5000 | no | | Details. |
| `notes` | Text ≤ 10000 | no | | The person's notes (person-owned). |
| `estimatedMinutes` | Minutes | no | | Estimated time for this task. |
| `estimateRange` | `{ "min", "max" }` | no | | As for assignments. |
| `status` | `"not_started"` \| `"in_progress"` \| `"done"` \| `"cancelled"` | no | `"not_started"` | |
| `completedAt` | LocalDateTime | no | | Only with `status: "done"`. |
| `dependsOn` | array of task IDs | no | `[]` | Tasks **of the same assignment** that must be done first. No cycles. |
| `recommendedStartDate` | Date | no | | Earliest sensible day to start. |
| `recommendedCompletionDate` | DateOrDateTime | no | | When it should be done. |

When an assignment has tasks with estimates, its `estimatedMinutes` SHOULD
equal the sum of the task estimates (it MAY be larger if some work is not
represented as a task).

## 10. Events (recurring and one-time)

Events are fixed commitments: school, classes, practice, lessons, jobs,
appointments. They block study time unless `busy` is `false`.

An event is **one-time** (has `date`) **or** **recurring** (has
`recurrence`) — exactly one of the two.

```json
{ "id": "evt-school", "title": "School", "category": "school",
  "startTime": "08:00", "endTime": "15:00",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"],
                  "startDate": "2026-09-02", "endDate": "2027-06-18",
                  "exceptDates": ["2026-11-26", "2026-11-27"] },
  "origin": "user" }
```

```json
{ "id": "evt-fencing", "title": "Fencing", "category": "activity",
  "startTime": "16:00", "endTime": "18:00",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon"], "startDate": "2026-09-07" },
  "origin": "user" }
```

```json
{ "id": "evt-doctor-2026-10-12", "title": "Doctor appointment", "category": "appointment",
  "date": "2026-10-12", "startTime": "15:30", "endTime": "16:30", "origin": "user" }
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `source`, `issues` | | | | See § 6. |
| `title` | Text 1–200 | **yes** | | Name. |
| `category` | `"school"` \| `"class"` \| `"activity"` \| `"appointment"` \| `"work"` \| `"personal"` \| `"other"` | no | `"other"` | For display. |
| `classId` | ID | no | | Related class (e.g. a class meeting or a test's room booking). |
| `date` | Date | one of `date`/`recurrence` | | Day of a one-time event. |
| `endDate` | Date | no | | Last day (inclusive) of a **multi-day all-day** one-time event. Only with `date` and `allDay: true`; must be ≥ `date`. |
| `recurrence` | [Recurrence](#recurrence) | one of `date`/`recurrence` | | Repetition rule. |
| `allDay` | boolean | no | `false` | All-day event; then `startTime`/`endTime` MUST be absent. |
| `startTime` | Time | if not `allDay` | | Start. |
| `endTime` | Time | if not `allDay` | | End; MUST be later than `startTime` (events cannot cross midnight in 1.0). |
| `busy` | boolean | no | `true` | `true`: the person is not available for study during the event. `false`: informational only. An all-day busy event blocks the whole day. |
| `location` | Text ≤ 200 | no | | Where. |
| `notes` | Text ≤ 10000 | no | | Person-owned notes. |

### Recurrence

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `frequency` | `"weekly"` | **yes** | | Only weekly repetition exists in 1.0 (use all seven days for "daily"). |
| `daysOfWeek` | array of Weekday, 1–7 unique values | **yes** | | Days on which it occurs. |
| `interval` | integer 1–52 | no | `1` | Every N weeks (`2` = every other week). |
| `startDate` | Date | **yes** | | First day the rule applies. |
| `endDate` | Date | no | | Last day (inclusive). Absent = no end. Must be ≥ `startDate`. |
| `exceptDates` | array of Date | no | `[]` | Days on which it does **not** occur (holidays, cancellations). |

An event occurs on date *d* when **all** of these hold:

1. `startDate ≤ d`, and `d ≤ endDate` if `endDate` is present;
2. the weekday of *d* is in `daysOfWeek`;
3. *d* is not in `exceptDates`;
4. `((monday(d) − monday(startDate)) in days / 7) mod interval = 0`, where
   `monday(x)` is the Monday of the Monday-to-Sunday week containing *x*
   (independent of `settings.weekStartsOn`).

To cancel one occurrence (e.g. "no school on Nov 26"), add the date to
`exceptDates`. To move one occurrence, add the original date to
`exceptDates` and create a one-time event for the new time.

## 11. Availability (study time)

Availability windows say when the person is free to do schoolwork. Busy
[events](#10-events-recurring-and-one-time) inside a window are subtracted from it.

An availability window is **recurring** (`recurrence`) or for **one date**
(`date`), with a start and end time:

```json
{ "id": "avail-weekdays", "label": "After school",
  "startTime": "15:30", "endTime": "21:30",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"], "startDate": "2026-09-02" },
  "origin": "user" }
```

```json
{ "id": "avail-2026-10-18", "label": "Saturday morning", "date": "2026-10-18",
  "startTime": "10:00", "endTime": "12:00", "origin": "user" }
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id`, `origin`, `locked`, `source`, `issues` | | | See § 6. |
| `label` | Text ≤ 200 | no | Name shown in the website. |
| `date` | Date | one of `date`/`recurrence` | A single day. |
| `recurrence` | [Recurrence](#recurrence) | one of `date`/`recurrence` | Repetition rule (same rules as events). |
| `startTime` | Time | **yes** | Start. |
| `endTime` | Time | **yes** | End; later than `startTime`. |

**Free study time** on a day = the union of that day's availability windows,
minus all busy events of that day. Overlapping windows are merged.

## 12. Schedule blocks (scheduled work)

A schedule block puts work on the calendar. It **references** the assignment
(and optionally one of its tasks) instead of copying it.

```json
{
  "id": "blk-gc-NzAwMDAwMDAwMDAx-01",
  "assignmentId": "gc-NzAwMDAwMDAwMDAx",
  "taskId": "gc-NzAwMDAwMDAwMDAx-t1",
  "start": "2026-10-13T16:00:00",
  "end": "2026-10-13T16:45:00",
  "status": "planned",
  "notes": "Outline: thesis + three body paragraph claims",
  "origin": "generated"
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `source`, `issues` | | | | See § 6. |
| `start` | LocalDateTime | **yes** | | Start. |
| `end` | LocalDateTime | **yes** | | End. Same calendar day as `start`, later than `start`, at least 5 minutes after it. |
| `assignmentId` | ID | one of `assignmentId`/`title` | | The assignment worked on. MUST exist. |
| `taskId` | ID | no | | A task of that assignment. Requires `assignmentId`; MUST belong to it. |
| `title` | Text 1–200 | one of `assignmentId`/`title` | | Label for blocks without an assignment (e.g. `"Review flashcards"`), or an override label. |
| `kind` | `"work"` \| `"break"` | no | `"work"` | `break` = an intentional break (needs `title`, no `assignmentId`). |
| `status` | `"planned"` \| `"done"` \| `"skipped"` | no | `"planned"` | Progress of this session. |
| `completedAt` | LocalDateTime | no | | Only with `status: "done"`. |
| `notes` | Text ≤ 10000 | no | | What to do in this session. |

Blocks for an assessment (type `quiz`, `test`, `exam`, `presentation`)
represent **preparation** sessions and SHOULD be placed **before** the
`assessmentDate`, spread over several days. Blocks SHOULD end before the
assignment's `due` time.

Blocks may overlap events or each other; the website shows overlaps as
conflicts but accepts them.

## 13. Validation rules

A file is valid only if **all** of the following hold. The website rejects an
invalid file as a whole and lists every problem with its location (e.g.
`assignments[3].due`).

**Structure** (also in the JSON Schema):

1. Root is an object; `schemaVersion` is `"1.0"`; the five collections are
   present and are arrays.
2. Every field has the type, format, length and enum value listed above.
3. No unknown properties except `x-…` properties.
4. No `null` values.

**Semantics** (enforced by the website and the skill's validator):

5. Every `id` is unique across the whole file (classes, assignments, tasks,
   events, availability, blocks).
6. `assignments[].classId`, `events[].classId` reference existing classes.
7. `assignments[].dependsOn` references existing assignments, not itself, and
   the dependency graph has no cycles. Same for `tasks[].dependsOn` within one
   assignment.
8. `scheduleBlocks[].assignmentId` references an existing assignment;
   `taskId` references a task of **that** assignment; a block has an
   `assignmentId` or a `title`; a `break` block has a `title` and no
   `assignmentId`.
9. Block `end` is on the same date as `start` and at least 5 minutes later.
10. Events/availability: exactly one of `date` and `recurrence`; `endTime` >
    `startTime`; all-day events have no times; `endDate` only on all-day
    one-time events and ≥ `date`; recurrence `endDate` ≥ `startDate`;
    `daysOfWeek` has no duplicates.
11. `estimateRange.min ≤ estimateRange.max`, and when `estimatedMinutes` is
    present, `min ≤ estimatedMinutes ≤ max`.
12. `completedAt` only when the status is `done`.
13. `recommendedCompletionDate` is not later than `due` (compared as
    date-times; a Date means its end of day).
14. `settings.dayEndTime` > `dayStartTime`; `maxSessionMinutes` ≥
    `minSessionMinutes`.

Warnings (accepted, but shown in the import preview): a block after its
assignment's `due`; a preparation block after its `assessmentDate`; overlapping
blocks or blocks overlapping busy events; a recurrence that never occurs;
dates more than 5 years away from today.

## 14. IDs: format, generation and preservation

IDs are what makes repeated imports safe. An ID identifies **one** real thing
(one class, one assignment, one task, one event, one availability window, one
work session) **forever**.

1. IDs MUST match the ID format (§ 3) and be unique in the whole file.
2. Once an item has an ID, that ID MUST NOT change in later versions of the
   schedule, even if the title, dates or anything else change.
3. An ID MUST NOT be reused for a different item, even after the original item
   was deleted.
4. **Derive IDs from stable source identifiers** when they exist, so that two
   independent runs produce the same IDs:
   - Google Classroom class: `gc-class-<courseId>` (the id from the Classroom
     export's `class-info.json`, e.g. `gc-class-NjI3ODk0MjE0NTQ5`).
   - Google Classroom item (assignment, material, question, announcement):
     `gc-<classroomId>` (from the item's `metadata.json`).
   - Items from other documents: a readable slug with the class and the date,
     e.g. `english-midterm-2026-10-21`, `bio-lab-3-2026-10-14`.
   - Tasks: `<assignmentId>-t<N>` (N = 1, 2, …; keep the number of an existing
     task even if tasks are reordered or removed).
   - Generated schedule blocks: `blk-<assignmentId>-<NN>` or any other unique
     scheme; never reuse a number that was used before.
5. IDs created by the website start with `u-` (e.g. `u-asg-k3j9x2p1`).
   Generators MUST NOT create IDs starting with `u-`, but MUST keep existing
   `u-` IDs unchanged.
6. Referencing fields (`classId`, `assignmentId`, `taskId`, `dependsOn`)
   always use IDs, never titles.

## 15. Updating an existing schedule (rules for generators)

When a generator (such as the `/schedule` skill) is given an existing
`schedule.json` and new materials, it MUST produce an **updated copy of the
existing file**, not a new file from scratch:

1. **Keep everything.** Every existing item that is not deliberately changed
   below MUST appear in the output with the same `id` and the same field
   values, including `origin`, `locked`, `notes`, statuses and `x-…` fields.
2. **Never touch person-owned data.** Items with `origin: "user"` and items
   with `locked: true` MUST be copied unchanged. Never delete them.
3. **Never undo progress.** A `done` assignment, task or block stays `done`
   with its `completedAt`. Blocks whose `status` is `done` or `skipped`, and
   blocks that end before the time of generation (the past), MUST be kept
   unchanged.
4. **Update in place.** When the sources show a change (new due date, new
   instructions, new estimate), update the fields of the **existing** item
   (same `id`). Record surprising changes as an issue, e.g.
   `{"kind": "conflict", "field": "due", "message": "Due date moved from Oct 16 to Oct 17 in Classroom."}`.
5. **Add** new classes, assignments, tasks and events with new IDs (§ 14).
6. **Removed work:** if an assignment that came from a source is no longer in
   that source, do **not** delete it. Keep it, add an issue
   (`missing_information`), stop scheduling new work for it, and tell the
   person. Set `status: "cancelled"` only when the source explicitly says it
   was cancelled or excused.
7. **Rebalance only future generated work.** Generated (`origin:
   "generated"`), unlocked blocks with `status: "planned"` that start after
   the time of generation MAY be moved (keep the `id`, change `start`/`end`),
   removed, or replaced by new blocks so the plan fits the new situation.
8. Do not create commitments (events or availability) the person did not
   state or that are not in the sources.

Field ownership summary:

| Fields | Owner | Generators may change? |
| --- | --- | --- |
| everything on `origin: "user"` or `locked: true` items | person | **no** |
| `status`, `completedAt` (assignments, tasks, blocks) | person | only forward (e.g. to `done` when a source shows the work was submitted), never backward |
| `notes` | person | no |
| titles, descriptions, dates, estimates, priority, tasks, references, `dependsOn`, `issues` of generated items | generator | yes |
| `start`/`end` of future planned generated blocks | generator | yes |

## 16. How the website imports a file

Importing never runs anything from the file; it only reads data.

### 16.1 Steps

1. **Read** the file (or pasted text) as JSON. Not JSON → error.
2. **Check the version** (§ 2). Unsupported → clear error, nothing imported.
3. **Validate** (§ 13). Any error → the list of errors, nothing imported.
4. **Compare** with the current schedule by `id` and show a **preview**.
5. The person confirms → the changes are applied in one step. The previous
   state is saved, so **Undo import** can restore it.

Importing the same file twice changes nothing the second time.

### 16.2 What the preview shows

Items are matched by `id` within the same collection (tasks are matched
within their assignment).

| Category | Meaning | What happens |
| --- | --- | --- |
| **New** | `id` not in the current schedule | Added. |
| **Updated** | same `id`, some fields differ | Fields replaced (except person-owned fields, § 16.3). The preview lists changed fields, e.g. *"due: Oct 16 → Oct 17"*, *"estimate: 2 h → 2 h 30 m"*. |
| **Unchanged** | same `id`, same content | Nothing. |
| **Kept (your version)** | the current item is `origin: "user"` or `locked` and the file has a different version | Current item kept. The person may tick it to accept the file's version instead. |
| **Not in this file** | a current **generated**, unlocked item that the file does not contain | Kept by default; the person may tick it to remove it. |
| **Outdated planned work** | a current generated, unlocked, **future** `planned` block that the file does not contain, whose assignment **is** in the file | Removed by default (the file has re-planned that assignment); the person may untick it to keep it. |
| **Always kept** | current `origin: "user"` items, locked items, `done`/`skipped` blocks, past blocks, `done` assignments/tasks that the file does not contain | Never removed by an import. |

ID collisions between different collections (e.g. a file's class uses the ID
of an existing assignment) are reported as errors.

### 16.3 Person-owned fields during an update

When an existing generated item is updated from the file:

- **Status never goes backwards.** Order: `not_started` < `in_progress` <
  `done`. If the current status is further along than the file's, the
  current status (and `completedAt`) is kept. `cancelled` from the file is
  applied unless the current status is `done`; a current `cancelled` is
  replaced by the file's status. Blocks: a current `done` or `skipped` block
  keeps its status.
- **Notes are kept.** A non-empty current `notes` value is kept; the file's
  `notes` is used only if the current one is empty.
- Every other field takes the file's value (fields absent in the file are
  removed, so the file fully describes the item).

### 16.4 Removing items

When the person removes an assignment through the preview, its future,
generated, unlocked, planned blocks are removed with it. An assignment that
has `done` blocks, or is itself `done`, cannot be removed by an import.

## 17. How the website exports a file

- The export is a complete, valid 1.0 file of the current schedule.
- `meta.generator` is `{"name": "Academic Scheduler", "version": "<app version>"}`
  and `meta.generatedAt` is the export time.
- Every item includes `id`, `origin` and its other fields; `locked` is written
  only when `true`; empty optional arrays are omitted (except the five root
  collections). Fields equal to their default may be written or omitted.
- LocalDateTimes are written as `YYYY-MM-DDTHH:MM:SS` (seconds `00`).
- Collections are sorted deterministically (classes by name; assignments by
  date then title; events and availability by start; blocks by start), then by
  `id`, so repeated exports of the same schedule are identical apart from
  `meta.generatedAt`.
- `x-…` properties from imported files are written back unchanged.

## 18. Examples

### 18.1 Minimal valid file

```json
{
  "schemaVersion": "1.0",
  "classes": [],
  "assignments": [],
  "events": [],
  "availability": [],
  "scheduleBlocks": []
}
```

### 18.2 Complete example

A full example with every kind of item is shipped as
[`examples/complete-schedule.json`](examples/complete-schedule.json) and is
reproduced here:

```json
{
  "schemaVersion": "1.0",
  "meta": {
    "title": "Fall 2026 — Week of Oct 12",
    "generatedAt": "2026-10-11T19:30:00-04:00",
    "generator": { "name": "claude-schedule-skill", "version": "1.0" },
    "timezone": "America/New_York",
    "sources": [
      { "kind": "google_classroom", "label": "English 10 - Period 3 - 2026-10-11.zip" },
      { "kind": "syllabus", "label": "Biology syllabus.pdf" }
    ]
  },
  "settings": {
    "weekStartsOn": "monday",
    "dayStartTime": "07:00",
    "dayEndTime": "22:00",
    "minSessionMinutes": 20,
    "maxSessionMinutes": 60,
    "breakMinutes": 10,
    "maxDailyStudyMinutes": 180
  },
  "classes": [
    {
      "id": "gc-class-NjI3ODk0MjE0NTQ5",
      "name": "English 10",
      "teacher": "Ms. Rivera",
      "section": "Period 3",
      "color": "#2563EB",
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5" }
    },
    {
      "id": "biology",
      "name": "Biology",
      "teacher": "Mr. Chen",
      "color": "#16A34A",
      "origin": "generated",
      "source": { "kind": "syllabus", "label": "Biology syllabus.pdf" }
    }
  ],
  "assignments": [
    {
      "id": "gc-NzAwMDAwMDAwMDAx",
      "classId": "gc-class-NjI3ODk0MjE0NTQ5",
      "title": "Othello Essay",
      "type": "writing",
      "description": "Write a 1,200–1,500 word analytical essay on jealousy in Othello. MLA format, at least three quotations from Acts 1–3.",
      "due": "2026-10-16T23:59:00",
      "recommendedCompletionDate": "2026-10-15",
      "estimatedMinutes": 240,
      "estimateRange": { "min": 200, "max": 300 },
      "estimateConfidence": "medium",
      "estimateBasis": "Outline 30 min, draft 1,200–1,500 words ~150 min, revise and format 60 min.",
      "priority": "high",
      "status": "in_progress",
      "points": "100 points",
      "tasks": [
        { "id": "gc-NzAwMDAwMDAwMDAx-t1", "title": "Choose thesis and quotations", "estimatedMinutes": 30, "status": "done", "completedAt": "2026-10-11T17:05:00" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t2", "title": "Outline", "estimatedMinutes": 30, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t1"], "recommendedCompletionDate": "2026-10-12" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t3", "title": "Draft", "estimatedMinutes": 120, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t2"], "recommendedStartDate": "2026-10-13", "recommendedCompletionDate": "2026-10-14" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t4", "title": "Revise, cite and format (MLA)", "estimatedMinutes": 60, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t3"], "recommendedCompletionDate": "2026-10-15" }
      ],
      "references": [
        { "title": "Essay rubric.pdf", "kind": "rubric", "required": true, "path": "English 10 - Period 3/Assignments/Othello Essay/Attachments/Essay rubric.pdf" }
      ],
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAx", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAx/details" }
    },
    {
      "id": "gc-NzAwMDAwMDAwMDAy",
      "classId": "gc-class-NjI3ODk0MjE0NTQ5",
      "title": "Read Othello Act 3",
      "type": "reading",
      "due": "2026-10-13",
      "estimatedMinutes": 45,
      "estimateRange": { "min": 35, "max": 60 },
      "estimateConfidence": "high",
      "estimateBasis": "Act 3 is ~25 pages of verse; about 1.5–2 min per page.",
      "priority": "medium",
      "status": "not_started",
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAy" }
    },
    {
      "id": "biology-unit-2-test-2026-10-16",
      "classId": "biology",
      "title": "Unit 2 Test: Cells",
      "type": "test",
      "description": "Covers chapters 3–4: cell structure, membranes, transport.",
      "assessmentDate": "2026-10-16T09:10:00",
      "estimatedMinutes": 150,
      "estimateRange": { "min": 120, "max": 180 },
      "estimateConfidence": "medium",
      "estimateBasis": "Two chapters (~40 pages) of review plus a 30-question practice set.",
      "priority": "high",
      "status": "not_started",
      "tasks": [
        { "id": "biology-unit-2-test-2026-10-16-t1", "title": "Review chapter 3 notes", "estimatedMinutes": 45 },
        { "id": "biology-unit-2-test-2026-10-16-t2", "title": "Review chapter 4 notes", "estimatedMinutes": 45 },
        { "id": "biology-unit-2-test-2026-10-16-t3", "title": "Practice questions and weak spots", "estimatedMinutes": 60, "dependsOn": ["biology-unit-2-test-2026-10-16-t1", "biology-unit-2-test-2026-10-16-t2"] }
      ],
      "issues": [
        { "kind": "conflict", "field": "assessmentDate", "message": "The syllabus says Oct 16; a Classroom announcement says 'test next Friday' (Oct 23). Using Oct 16 from the syllabus; please confirm with the teacher." }
      ],
      "origin": "generated",
      "source": { "kind": "syllabus", "label": "Biology syllabus.pdf, p. 2" }
    },
    {
      "id": "u-asg-k3j9x2p1",
      "title": "Return library books",
      "type": "other",
      "due": "2026-10-14",
      "estimatedMinutes": 15,
      "priority": "low",
      "status": "not_started",
      "origin": "user"
    }
  ],
  "events": [
    {
      "id": "evt-school",
      "title": "School",
      "category": "school",
      "startTime": "08:00",
      "endTime": "15:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-09-02", "endDate": "2027-06-18", "exceptDates": ["2026-11-26", "2026-11-27"] },
      "origin": "user"
    },
    {
      "id": "evt-fencing",
      "title": "Fencing",
      "category": "activity",
      "startTime": "16:00",
      "endTime": "18:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon"], "startDate": "2026-09-07" },
      "origin": "user"
    },
    {
      "id": "evt-piano",
      "title": "Piano",
      "category": "activity",
      "startTime": "17:00",
      "endTime": "18:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["wed"], "startDate": "2026-09-09" },
      "origin": "user"
    },
    {
      "id": "evt-doctor-2026-10-15",
      "title": "Doctor appointment",
      "category": "appointment",
      "date": "2026-10-15",
      "startTime": "15:30",
      "endTime": "16:30",
      "origin": "user"
    }
  ],
  "availability": [
    {
      "id": "avail-weekdays",
      "label": "After school",
      "startTime": "15:30",
      "endTime": "21:30",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-09-02" },
      "origin": "user"
    },
    {
      "id": "avail-weekend",
      "label": "Weekend mornings",
      "startTime": "10:00",
      "endTime": "13:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["sat", "sun"], "startDate": "2026-09-05" },
      "origin": "user"
    }
  ],
  "scheduleBlocks": [
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAy-01",
      "assignmentId": "gc-NzAwMDAwMDAwMDAy",
      "start": "2026-10-12T18:30:00",
      "end": "2026-10-12T19:20:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-01",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t2",
      "start": "2026-10-12T19:30:00",
      "end": "2026-10-12T20:00:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "blk-biology-unit-2-test-2026-10-16-01",
      "assignmentId": "biology-unit-2-test-2026-10-16",
      "taskId": "biology-unit-2-test-2026-10-16-t1",
      "start": "2026-10-13T15:30:00",
      "end": "2026-10-13T16:15:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-02",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
      "start": "2026-10-13T16:30:00",
      "end": "2026-10-13T17:20:00",
      "status": "planned",
      "notes": "Introduction and first body paragraph",
      "origin": "generated"
    },
    {
      "id": "blk-biology-unit-2-test-2026-10-16-02",
      "assignmentId": "biology-unit-2-test-2026-10-16",
      "taskId": "biology-unit-2-test-2026-10-16-t2",
      "start": "2026-10-14T15:30:00",
      "end": "2026-10-14T16:15:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-03",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
      "start": "2026-10-14T18:15:00",
      "end": "2026-10-14T19:25:00",
      "status": "planned",
      "notes": "Remaining body paragraphs and conclusion",
      "locked": true,
      "origin": "generated"
    },
    {
      "id": "blk-biology-unit-2-test-2026-10-16-03",
      "assignmentId": "biology-unit-2-test-2026-10-16",
      "taskId": "biology-unit-2-test-2026-10-16-t3",
      "start": "2026-10-15T16:40:00",
      "end": "2026-10-15T17:40:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-04",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t4",
      "start": "2026-10-15T17:50:00",
      "end": "2026-10-15T18:50:00",
      "status": "planned",
      "origin": "generated"
    },
    {
      "id": "u-blk-m2c7q9za",
      "assignmentId": "u-asg-k3j9x2p1",
      "start": "2026-10-14T15:00:00",
      "end": "2026-10-14T15:15:00",
      "status": "planned",
      "origin": "user"
    }
  ],
  "issues": [
    { "kind": "workload", "message": "The essay draft (2 h) is split over Tuesday and Wednesday. If drafting runs long, Thursday after 6:50 PM is still free; Friday morning has the biology test." }
  ]
}
```

## 19. Common mistakes

| Mistake | Correct |
| --- | --- |
| `"schemaVersion": 1.0` | `"schemaVersion": "1.0"` |
| `"due": "2026-10-16T23:59:00Z"` | `"due": "2026-10-16T23:59:00"` (local time, no `Z`) |
| `"due": "Oct 16"` | `"due": "2026-10-16"` |
| `"startTime": "4:00 PM"` | `"startTime": "16:00"` |
| `"daysOfWeek": ["Monday"]` | `"daysOfWeek": ["mon"]` |
| `"estimatedMinutes": "45"` or `"60-75"` | `"estimatedMinutes": 70, "estimateRange": {"min": 60, "max": 75}` |
| `"status": "complete"` | `"status": "done"` |
| `"priority": "normal"` | `"priority": "medium"` |
| `"classId": "English 10"` (a name) | `"classId": "gc-class-NjI3ODk0MjE0NTQ5"` (an ID) |
| `"teacher": null` | omit the field |
| a quiz with `"due"` set to the quiz day | `"type": "quiz", "assessmentDate": "2026-10-20"` |
| a block from 23:00 to 00:30 | two blocks, or end at 23:59 |
| comments or text outside the JSON object | data only |

## 20. Changelog

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | 2026-10-07 | First version. |
