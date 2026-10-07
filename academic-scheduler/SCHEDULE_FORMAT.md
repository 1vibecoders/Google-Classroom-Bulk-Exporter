# Schedule File Format — version 1.0

This document is the complete, normative description of the JSON file that the
**Academic Scheduler** website imports and exports, and that the Claude
**`/academic-schedule`** skill generates. The two components communicate only through
this format.

It is written so that a developer or an AI can produce valid files without
guessing. A machine-readable JSON Schema (draft 2020-12) for the structural
rules is shipped next to this file:
[`schema/schedule-1.0.schema.json`](schema/schedule-1.0.schema.json).
The JSON Schema cannot express every rule; the **semantic rules** in
[§ 13](#13-validation-rules) also apply, and the website and the skill's
validator (`skills/academic-schedule/scripts/validate_schedule.py`) enforce all of them.

Terms used in this document:

- **Person**: the student whose schedule this is.
- **Writer**: any program that writes a schedule file: a **generator** (such
  as the `/academic-schedule` skill) or the website's export.
- **Item**: a class, assignment, task, event, availability window or schedule
  block.
- **Protected item**: an item with `origin: "user"` or `locked: true` (§ 6).

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
  object, on every item and on every other object defined here
  (`estimateRange`, `recurrence`, sources, references, issues, … included).
  Their values are opaque JSON (any value, `null` included). Readers MUST
  ignore their meaning and MUST preserve them unchanged when they re-export
  the object (an import merges them key by key, § 16.3).
- `null` is **not** a valid value for any field defined here. Omit an optional
  field instead of setting it to `null`. (Inside the value of an `x-…`
  property, `null` is allowed.)
- The maximum file size the website accepts is 10 MB.

## 2. Versioning

Every file MUST start with a `schemaVersion` string of the form
`"MAJOR.MINOR"`. This document defines **`"1.0"`**, the initial version of
the format.

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
| **Time** | `HH:MM`, 24-hour clock, zero-padded, `00:00`–`23:59` | `08:00`, `15:30`, `23:59` | `8:00`, `3:30 PM`, `24:00` (allowed only where the type is EndTime) |
| **EndTime** | a Time, or `24:00` (midnight at the end of the day). Used for event and availability `endTime` and `settings.dayEndTime`. Regex `^(([01][0-9]\|2[0-3]):[0-5][0-9]\|24:00)$` | `21:30`, `24:00` | `24:30`, `25:00` |
| **LocalDateTime** | `YYYY-MM-DDTHH:MM` or `YYYY-MM-DDTHH:MM:SS` with seconds `00`, **no** time-zone suffix | `2026-10-16T23:59:00`, `2026-10-13T16:00` | `2026-10-16T23:59:00Z`, `2026-10-16T23:59:00-04:00`, `2026-10-16 23:59`, `2026-10-16T23:59:30` |
| **DateOrDateTime** | a Date **or** a LocalDateTime | `2026-10-20`, `2026-10-20T09:00` | as above |
| **Weekday** | one of `"mon"`, `"tue"`, `"wed"`, `"thu"`, `"fri"`, `"sat"`, `"sun"` | `"wed"` | `"Wednesday"`, `"W"`, `3` |
| **Color** | `#RRGGBB` hexadecimal | `#3B82F6`, `#e11d48` | `blue`, `#FFF`, `rgb(0,0,0)` |
| **Minutes** | integer, `0`–`10000` | `45`, `180` | `45.5`, `"45"`, `-10` |
| **URL** | absolute `http:` or `https:` URL, ≤ 2000 characters | `https://classroom.google.com/c/abc` | `javascript:alert(1)`, `/relative/path` |
| **Text** | string; limits per field below | | a required Text of only spaces |

- **Seconds.** The seconds of a LocalDateTime, when present, MUST be `:00`
  (regex `…T([01][0-9]|2[0-3]):[0-5][0-9](:00)?`); the format works in whole
  minutes.
- **Lengths** (of Text, IDs and URLs) are counted in Unicode code points, not
  in UTF-16 units or bytes (`"😀"` is 1 character).
- **Text.** Implementations trim leading and trailing whitespace of Text on
  input. A **required** Text field (`title`, `name`, `message`, `reason`,
  reference `title`, `generator.name`) MUST contain at least one
  non-whitespace character.
- **Integers** (Minutes, `interval`, the session settings) are JSON numbers
  whose value has no fractional part (`45`; `45.0` is the same number).
  Writers write them without a decimal point.
- **Patterns** (the regexes above and in the JSON Schema) must match the
  **whole** value. Python validators MUST use full-match semantics
  (`re.fullmatch`), because Python's `$` also matches before a trailing
  newline (`"2026-10-16\n"` is not a valid Date).

What a Date without a time means for a `due` or an `assessmentDate` is defined
in § 8 ("Date-only values"); how dates are compared by the validation rules
is defined in § 13.3.

## 4. Time zones

All dates and times are **local wall-clock times of the person whose
schedule this is**. There are no UTC times and no offsets anywhere in the
file, `meta.generatedAt` included. `2026-10-16T23:59:00` means 11:59 PM on
October 16 on the person's own clock.

`meta.timezone` (an IANA name such as `"America/New_York"`) records which
zone that is. The website never converts times between zones.

- Generators MUST write `meta.timezone`: the input schedule's
  `meta.timezone`, or the zone the person gives. With neither, they ask the
  person, or assume a zone and state the assumption in their summary.
- The website's export MUST write `meta.timezone` with the browser's IANA
  time zone.
- `meta.generatedAt` is the wall-clock time in that zone at which the file
  was written. It is the reference "now" that decides which work is past and
  which is future (§ 12.1, § 16.1).

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
  "issues": [ ],
  "deleted": [ ]
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | string | **yes** | `"1.0"` for this version. |
| `classes` | array of [Class](#7-classes) | **yes** (may be empty) | Courses. |
| `assignments` | array of [Assignment](#8-assignments) | **yes** (may be empty) | Homework, projects, readings, quizzes, tests, … |
| `events` | array of [Event](#10-events-recurring-and-one-time) | **yes** (may be empty) | Fixed commitments: school, activities, appointments. |
| `availability` | array of [Availability](#11-availability-study-time) | **yes** (may be empty) | When the person is free to study. Empty means "not provided" (§ 11). |
| `scheduleBlocks` | array of [ScheduleBlock](#12-schedule-blocks-scheduled-work) | **yes** (may be empty) | Work placed on the calendar. |
| `meta` | [Meta](#meta) | no | Information about the file. |
| `settings` | [Settings](#settings) | no | Scheduling preferences (person-owned). |
| `issues` | array of [Issue](#issue) | no | Issues that concern the whole schedule, a day, or a protected item (§ 15.8). Only root issues may have `itemId`. |
| `deleted` | array of [Deleted item](#deleted-item-tombstone), ≤ 5000 entries | no | Generated items the person deleted, so that they are not created again (§ 15.1, § 16.4). |

All five collections are required so that a reader never has to guess whether
a missing collection means "none" or "unknown".

### Meta

All fields optional.

| Field | Type | Description |
| --- | --- | --- |
| `title` | Text ≤ 200 | A name for the schedule, e.g. `"Fall 2026"`. |
| `generatedAt` | LocalDateTime | When the file was written, as wall-clock time in `timezone` (§ 4), e.g. `2026-10-11T19:30:00`. No offset, no `Z`. |
| `generator` | object `{ "name": Text 1–100 (required), "version": Text ≤ 50 }` | The program that wrote the file, e.g. `{"name": "academic-schedule-skill", "version": "1.0"}` or `{"name": "Academic Scheduler", "version": "1.0.0"}`. |
| `timezone` | Text ≤ 100 | IANA time-zone name (§ 4). |
| `exportId` | ID | **Website only.** A new ID that the website writes on every export (§ 17), e.g. `u-exp-r8k2m4v1`. Generators MUST NOT write it. |
| `basedOn` | ID | **Generators only.** The `exportId` of the input schedule this file was made from (or the input's `basedOn` when it has no `exportId`). Absent when no existing schedule was given: the file is then a "fresh" file (§ 16.2). |
| `sources` | array of [Source](#source) | The materials the file was generated from (input schedule, Classroom export, syllabus, …). |
| `requestedChanges` | array of [Requested change](#requested-change) | The changes a generator made to protected items in the run that wrote this file (§ 15.9). |

Every writer replaces `generator` and `generatedAt` with its own values and
writes `timezone` (§ 4). Generators set `basedOn` (§ 15.1), set `sources` to
the materials used in the run, keep `title` unless the person asks to change
it, and write `requestedChanges` only for the run's own changes (§ 15.1). The
website writes a fresh `exportId`, keeps `title` and `sources` from the last
import and never writes `basedOn` or `requestedChanges` (§ 17).

### Settings

All fields optional; the default is used when a field is absent. Settings are
**person-owned**: generators copy them unchanged unless the person asked for a
change in the current request (§ 15.1), and the website asks before it takes
a file's settings (§ 16.6).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `weekStartsOn` | `"monday"` \| `"sunday"` | `"monday"` | First day of the week in week views. |
| `dayStartTime` | Time | `"07:00"` | Earliest time shown in day/week timelines. |
| `dayEndTime` | EndTime | `"22:00"` | Latest time shown (must be later than `dayStartTime`; `"24:00"` = midnight). |
| `defaultDueTime` | Time | `"00:00"` | Time of day at which a date-only `due` is planned (§ 8). The default `00:00` means "finish by the end of the day before"; the person can set e.g. `"23:59"` to plan up to the end of the due date. |
| `minSessionMinutes` | Minutes (5–240) | `20` | Shortest work session worth scheduling. |
| `maxSessionMinutes` | Minutes (10–480) | `60` | Longest single work session; must be ≥ `minSessionMinutes`. |
| `breakMinutes` | Minutes (0–120) | `10` | Gap to leave between consecutive work sessions. |
| `maxDailyStudyMinutes` | Minutes (0–1440) | no limit | Upper limit of scheduled work per day. |

The four session settings (`minSessionMinutes`, `maxSessionMinutes`,
`breakMinutes`, `maxDailyStudyMinutes`) guide the plans made by generators
and by the website's planner (`generated` and `planner` blocks) only. They
never constrain `user` or locked blocks, and no warning is shown for those
(§ 13.4).

### Issue

An issue records uncertainty or a problem that the person should look at. It
appears in the root `issues` array and in the `issues` of any item. Where a
generator puts an issue is defined in § 15.8.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | ID | no (generators MUST write it, § 15.8) | Stable identifier, so that the person's decision about the issue survives later runs (§ 15.8), e.g. `gc-NzAwMDAwMDAwMDAx:conflict:due:20261017T2359`, `workload:2026-10-15`. Unique among all issues of the file (root issues and the issues of every item and task). Issue IDs are a separate namespace from item IDs. When the person resolves or dismisses an issue that has no `id`, the website gives it one (`u-iss-<8 random characters>`). |
| `kind` | `"ambiguity"` \| `"conflict"` \| `"missing_information"` \| `"workload"` \| `"other"` | **yes** | `ambiguity`: the source can be read more than one way. `conflict`: sources disagree, or a source disagrees with a value the person set. `missing_information`: something needed is not in the sources. `workload`: the schedule is tight or impossible. |
| `message` | Text 1–1000 | **yes** | Plain-language explanation, e.g. `"Syllabus says the midterm is Oct 21; Classroom says Oct 20. Using Oct 21 (syllabus)."` |
| `field` | Text ≤ 100 | no | The field the issue is about, e.g. `"due"`, `"estimatedMinutes"`. |
| `status` | `"open"` \| `"resolved"` \| `"dismissed"` | no (default `"open"`) | **Person-owned.** `resolved`: the person dealt with it. `dismissed`: the person says it is not a problem. |
| `itemId` | ID | no | **Root issues only** (invalid inside an item's `issues`): the item the issue concerns, in any collection, tasks included. MUST reference an existing item. |
| `date` | Date | no | The day the issue concerns, e.g. an overloaded day. The website shows the issue in that day's view. |

### Source

Where an item (or the whole file) came from. Informational; preserved as is.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `kind` | see below | **yes** | Type of source. |
| `id` | Text ≤ 200 | no | The source's own identifier (e.g. the Google Classroom course or item id in URL form, § 14.1). Work derived from the text of a Classroom item has no own identifier: its `source` has no `id` (§ 14.1). |
| `url` | URL | no | Link to the source (e.g. the Classroom page). |
| `path` | Text ≤ 500 | no | Path of the file inside an export, e.g. `English 10/Assignments/Othello Essay/metadata.json`. |
| `label` | Text ≤ 200 | no | Human-readable name, e.g. `"English 10 syllabus (PDF), p. 2"`. |
| `retrievedAt` | LocalDateTime | no | When the source was captured, as wall-clock time in `meta.timezone` (§ 4). For a Google Classroom export: its `exportedAt` (`class-info.json` or `export-manifest.json`, a UTC time) converted to local time. Generators write it on the `source` of Classroom classes and on the Classroom entries of `meta.sources`; it decides whether a later export is newer (§ 15.6). |

| `kind` | Use for |
| --- | --- |
| `google_classroom` | A Google Classroom export (ZIP or extracted folder) or an item in it. |
| `syllabus` | A course syllabus. |
| `calendar` | A school calendar, exam calendar or personal calendar export. |
| `document` | Any other document: assignment sheet, rubric, handbook, … |
| `image` | A photo or screenshot, e.g. of a whiteboard or a planner page. |
| `user` | What the person told the generator; `label` e.g. `"Told /academic-schedule on 2026-10-11"` (§ 15.5). |
| `schedule` | An input `schedule.json`. |
| `other` | Anything else. |

### Deleted item (tombstone)

An entry of the root `deleted` array records a `generated` item that the
person deleted, so that generators do not create it again (§ 15.1) and an
import does not silently bring it back (§ 16.2).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | ID | **yes** | The deleted item's ID. Unique within `deleted`; no item in the file may have this ID. |
| `collection` | `"classes"` \| `"assignments"` \| `"tasks"` \| `"events"` \| `"availability"` \| `"scheduleBlocks"` | **yes** | Where the item was. |
| `deletedAt` | LocalDateTime | **yes** | When the person deleted it. |
| `sourceId` | Text ≤ 200 | no | The deleted item's `source.id`; when its `source` has no `id`, the `id` of the first entry of its `sources` that has one. Absent when it had neither (always for tasks, which have no `source`). |
| `title` | Text ≤ 300 | no | The item's title, name or label, for display. |

The list holds at most 5000 entries; when it would grow beyond that, the
website drops the oldest entries (by `deletedAt`). The website writes the
entries (§ 16.4); generators copy them (§ 15.1).

### Requested change

An entry of `meta.requestedChanges` tells the website that a generator changed
or deleted a protected item on purpose (§ 15.9).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | ID | **yes** | The protected item (any collection, tasks included) that was changed — or deleted, in which case it is absent from the file. Unique within `requestedChanges`. |
| `reason` | Text 1–500 | **yes** | Plain-language explanation shown to the person, e.g. `"You asked to move fencing to Tuesdays."` |
| `requestedByPerson` | boolean | **yes** | `true`: the person asked for this change in the current request. `false`: a source suggests it (e.g. a school calendar's holiday). |

## 6. Fields shared by all items

Classes, assignments, tasks, events, availability windows and schedule blocks
all have these fields:

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | ID | **yes** | | Unique in the **whole file** (across all collections and all tasks). Never changes once assigned; see § 14. |
| `origin` | `"user"` \| `"generated"` \| `"planner"` | no | `"generated"` | Who created the item (§ 6.1). `"planner"` only on schedule blocks. |
| `locked` | boolean | no | `false` | The person pinned the item (§ 6.2). |
| `overrides` | array of field names | no | `[]` | Fields of a `generated` or `planner` item whose value the person set (§ 6.3). |
| `source` | [Source](#source) | no | | Where the item came from (its primary source). |
| `sources` | array of [Source](#source), ≤ 20 entries | no | `[]` | Additional sources besides `source`, e.g. a second document that confirms or contradicts it. |
| `issues` | array of [Issue](#issue) | no | `[]` | Issues about the item (without `itemId`). |

Tasks have `id`, `origin`, `locked`, `overrides` and `issues`, but no
`source` or `sources` (they inherit the assignment's).

### 6.1 `origin`

- **`user`**: created by the person in the website (IDs start with `u-`,
  § 14). The whole item, including its tasks, is person-owned. Generators
  MUST NOT modify or delete it, except through a requested change (§ 15.9).
- **`generated`**: created by a generator such as the `/academic-schedule` skill,
  including items it created from what the person told it (those carry a
  `source` of kind `user`, § 15.5). Later generator runs MAY update its
  generator-owned fields unless it is locked or the field is overridden
  (§ 15.4).
- **`planner`**: a schedule block placed automatically by the website's
  deterministic planner (IDs start with `u-`). **Only schedule blocks** may
  have this origin. Generators treat unlocked future planned `planner` blocks
  like `generated` ones (§ 15.7) and never create `planner` items.

An item's `origin` never changes.

### 6.2 `locked`

`locked: true` means either

- the person explicitly pinned the item ("do not touch"), or
- the person moved or resized a `generated` or `planner` schedule block in the
  website; the website sets `locked: true` on every such move or resize.

Editing any other field does **not** lock an item; the website records such
edits in `overrides` instead (§ 6.3). Generators MUST NOT modify, move or
delete locked items, except through a requested change (§ 15.9); an import
keeps the current version of a locked item (§ 16.2). A locked assignment's
tasks are part of it and are protected with it.

### 6.3 `overrides`

`overrides` lists the fields of a `generated` or `planner` item whose value
the **person** set. It is person-owned:

- The website adds a field's name (once) when the person edits that field of
  a `generated` or `planner` item. Generators never add or remove names; they
  copy the array unchanged.
- Generators MUST keep the value of every field named in `overrides`,
  including its absence (when the person removed an optional value, it stays
  absent). They MAY update the item's other generator-owned fields if the
  item is unlocked (§ 15.4). When a source's value differs from an overridden
  value, the generator keeps the person's value and adds a `conflict` issue
  to the item.
- An array or object field (`tasks`, `references`, `recurrence`,
  `estimateRange`, …) is overridden as a whole.
- Each edit is recorded in one way only. An edit of a task goes into that
  task's own `overrides`; the website adds `tasks` to the assignment's
  `overrides` only when the person reorders its tasks. A task the person adds
  is a `user` task; deleting a `generated` task writes a tombstone (§ 16.4).
  Moving or resizing a block sets `locked` (§ 6.2) and writes nothing to
  `overrides`. Changes that the website makes as a consequence of a deletion
  (§ 16.4) are not edits and add nothing to `overrides`.
- On an `origin: "user"` item `overrides` has no effect (the whole item is
  person-owned); the website does not write it there.
- During an import the current item's overridden values are kept (§ 16.3).

Entries are unique. Each entry MUST be one of the names allowed for the item
type below, or an `x-…` property name. `id`, `origin`, `locked`, `overrides`,
`issues`, `source`, `sources`, `notes`, `status` and `completedAt` are never
allowed: they are structural or already person-owned.

| Item type | Names allowed in `overrides` |
| --- | --- |
| Class | `name`, `teacher`, `section`, `room`, `color`, `description`, `archived`, `topics`, `references` |
| Assignment | `title`, `classId`, `type`, `topic`, `description`, `due`, `assessmentDate`, `recommendedCompletionDate`, `estimatedMinutes`, `estimateRange`, `estimateConfidence`, `estimateBasis`, `priority`, `points`, `required`, `sourceState`, `tasks`, `references`, `dependsOn` |
| Task | `title`, `description`, `due`, `required`, `estimatedMinutes`, `estimateRange`, `dependsOn`, `recommendedStartDate`, `recommendedCompletionDate` |
| Event | `title`, `category`, `classId`, `assignmentId`, `date`, `endDate`, `recurrence`, `allDay`, `startTime`, `endTime`, `busy`, `location` |
| Availability | `label`, `date`, `recurrence`, `startTime`, `endTime` |
| Schedule block | `start`, `end`, `assignmentId`, `taskId`, `title`, `kind`, `description` |

Example — the person raised the priority of a generated reading assignment;
later runs keep `"high"`:

```json
{ "id": "gc-NzAwMDAwMDAwMDAy", "title": "Read Othello Act 3", "priority": "high",
  "overrides": ["priority"], "origin": "generated" }
```

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
  "topics": ["Unit 2: Othello", "Grammar"],
  "references": [
    { "title": "Othello (Folger edition).pdf", "kind": "reading", "required": false,
      "path": "English 10 - Period 3/Materials/Othello full text/Attachments/Othello (Folger edition).pdf" }
  ],
  "origin": "generated",
  "source": { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5",
              "retrievedAt": "2026-10-11T18:05:00" }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id`, `origin`, `locked`, `overrides`, `source`, `sources`, `issues` | | | See § 6. |
| `name` | Text 1–200 | **yes** | Class name. |
| `teacher` | Text ≤ 200 | no | Teacher's name. |
| `section` | Text ≤ 200 | no | Section/period. |
| `room` | Text ≤ 100 | no | Room. |
| `color` | Color | no | Display color. If absent, the website assigns one. |
| `description` | Text ≤ 5000 | no | Course description. |
| `archived` | boolean | no (default `false`) | Hidden from pickers and filters; its items still display. |
| `topics` | array of Text ≤ 200, ≤ 200 entries | no | The class's topics or units (e.g. the Classroom topics), in source order. |
| `references` | array of [Reference](#82-reference), ≤ 200 entries | no | Class materials that are not work: Classroom materials, the syllabus, unit notes, slides. |

A Google Classroom **material**, and an announcement that asks for no work,
are not assignments: they become `references` of the class or of the
assignments they support (§ 15.5).

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
  "topic": "Unit 2: Othello",
  "description": "Write a 1,200–1,500 word analytical essay on jealousy in Othello. MLA format, at least three quotations.",
  "due": "2026-10-16T23:59:00",
  "recommendedCompletionDate": "2026-10-15",
  "estimatedMinutes": 240,
  "estimateRange": { "min": 210, "max": 270 },
  "estimateConfidence": "medium",
  "estimateBasis": "1,200–1,500 words of analytical writing (~2 h) plus thesis, outline and revision; the rubric requires three quotations.",
  "priority": "high",
  "status": "not_started",
  "points": "100 points",
  "tasks": [ ],
  "references": [ { "title": "Essay rubric.pdf", "kind": "rubric", "required": true, "url": "https://drive.google.com/file/d/1Abc/view" } ],
  "dependsOn": [ "gc-NzAwMDAwMDAwMDAy" ],
  "origin": "generated",
  "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAx", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAx/details" }
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `overrides`, `source`, `sources`, `issues` | | | | See § 6. |
| `title` | Text 1–200 | **yes** | | Short title. |
| `classId` | ID | no | | The [class](#7-classes) it belongs to. Omit for personal work. MUST reference an existing class. |
| `type` | enum, see below | no | `"homework"` | Kind of work. |
| `topic` | Text ≤ 200 | no | | Topic or unit, e.g. the Classroom topic (usually one of the class's `topics`). |
| `description` | Text ≤ 20000 | no | | Instructions / requirements (from the source). |
| `notes` | Text ≤ 10000 | no | | The person's own notes. Person-owned; generators never write it (§ 15.2). |
| `due` | DateOrDateTime | no | | **Due date**: when the work must be submitted. A Date without a time means "time not stated" (see "Date-only values" below). |
| `assessmentDate` | DateOrDateTime | no | | **Assessment date**: when an in-class quiz, test, exam or presentation takes place. A Date without a time means "that day, time unknown". |
| `recommendedCompletionDate` | DateOrDateTime | no | | **Recommended completion date**: when the work should ideally be finished, earlier than the deadline. Never a deadline itself. |
| `estimatedMinutes` | Minutes | no | | **Total effort** for the whole assignment, including all of its tasks and the work already done. For assessments: the total recommended preparation time. Generators MUST NOT lower it to reflect progress; progress comes from task statuses and done blocks (§ 8.1). **Required** when `estimateRange` is present. |
| `estimateRange` | object `{ "min": Minutes, "max": Minutes }` | no | | Uncertainty range; `min ≤ estimatedMinutes ≤ max`. Requires `estimatedMinutes`. A generator that only has a range uses the point estimate ⌈(min + max) / 2 / 5⌉ × 5, i.e. the midpoint rounded up to a multiple of 5 (60–75 → 70; 40–60 → 50). |
| `estimateConfidence` | `"low"` \| `"medium"` \| `"high"` | no | | How reliable the estimate is. |
| `estimateBasis` | Text ≤ 2000 | no | | The evidence behind the estimate, e.g. `"25 pages of reading + 12 short-answer questions"`. |
| `priority` | `"low"` \| `"medium"` \| `"high"` \| `"urgent"` | no | `"medium"` | Importance. |
| `status` | `"not_started"` \| `"in_progress"` \| `"done"` \| `"cancelled"` | no | `"not_started"` | Person-owned progress (§ 15.2). `cancelled`: the person will not do it (e.g. excused, dropped optional work). Work withdrawn by its source is recorded with `sourceState`, not with `cancelled`. |
| `completedAt` | LocalDateTime | no | | When it was marked done. Only allowed when `status` is `"done"`. |
| `points` | Text ≤ 100 | no | | Points/weight as written by the source, e.g. `"100 points"`, `"15% of grade"`. |
| `required` | boolean | no | `true` | `false` for optional/extra-credit work. Such work is not planned automatically and is not counted in remaining-work and overload totals unless it already has planned blocks (§ 8.1). |
| `sourceState` | `"present"` \| `"missing"` \| `"withdrawn"` | no | `"present"` | Generator-owned. `missing`: not found in a newer, complete export of the same source (§ 15.6). `withdrawn`: the source explicitly removed, cancelled or excused it. The website shows `missing`/`withdrawn` work with a badge and excludes it from automatic planning and from remaining-work and overload totals unless `status` is `"in_progress"`. |
| `tasks` | array of [Task](#9-tasks-subtasks) | no | `[]` | Steps of the assignment, in recommended order. |
| `references` | array of [Reference](#82-reference) | no | `[]` | Attachments, links and materials. |
| `dependsOn` | array of assignment IDs, unique | no | `[]` | Assignments that should be finished first (e.g. a reading before its quiz). Must exist, must not include itself, no cycles. |

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
| `quiz` | Quizzes (use `assessmentDate`, or `due` for an online quiz without a fixed sitting). |
| `test` | Tests (as for quizzes). |
| `exam` | Midterms, finals, standardized exams (use `assessmentDate`). |
| `study` | A study goal that is not tied to one assessment. |
| `other` | Anything else. |

**Dates — they are not interchangeable:**

- `due`: submission deadline. Present for anything that is handed in. An
  online quiz or test with a submission deadline and no fixed sitting has
  `type` `quiz`/`test`, a `due` and **no** `assessmentDate`.
- `assessmentDate`: the date the assessment happens. Quizzes, tests and
  exams with a sitting normally have `assessmentDate` and **no** `due`
  (unless something must also be submitted, e.g. a take-home part). An
  assessment outside the school day also gets an event for the sitting
  (§ 10).
- `recommendedCompletionDate`: a planning target that is earlier than
  `due`/`assessmentDate`. It MUST NOT be later than the `due` date (or, when
  there is no `due`, the `assessmentDate`).
- An assignment MAY have none of these (undated work); the website lists it
  under "No date".

**Date-only values.** Writers MUST write a time whenever the source states
one (Classroom `Oct 16, 11:59 PM` → `"2026-10-16T23:59:00"`), and a Date
without a time only when the source states no time.

| Value | Shown by the website | Meaning for planning, sorting and warnings |
| --- | --- | --- |
| `"due": "2026-10-13"` | "Oct 13", without a time | Due at `settings.defaultDueTime` on that day. With the default `00:00` the work must be finished by the end of Oct 12. |
| `"assessmentDate": "2026-10-16"` | "Oct 16", time unknown | 00:00 of that day: preparation must end the day before. |
| `"recommendedCompletionDate": "2026-10-15"` (also task dates) | "Oct 15" | A soft target: by the end of that day. |

These interpretations do not affect validity: the ordering rules of § 13.3
compare dates in a way that never depends on settings.

### 8.1 Remaining work

Remaining work is computed in exactly this way by the website (assignment
view, remaining-workload and overload totals, planner) and by generators
(planning). All quantities are minutes.

- A **work block** is a schedule block whose `kind` is `"work"` (the
  default); its minutes are `end − start`.
- **Done minutes** are the minutes of work blocks with `status: "done"`.
  A past block whose status is still `planned` counts as **not done**; a block
  in progress (§ 12.1) counts as `planned`.

**Remaining minutes of a task** *t* of assignment *a*:

1. `0` if `t.status` is `done` or `cancelled`;
2. `0` if `t.required` is `false` and no `planned` work block has
   `taskId` = *t*;
3. otherwise `max(0, t.estimatedMinutes − done minutes of blocks with taskId = t)`.
   A task without `estimatedMinutes` contributes `0` (its time is part of the
   assignment's untasked remainder).

**Remaining minutes of an assignment** *a*:

1. `0` if `a.status` is `done` or `cancelled`;
2. `0` if `a.required` is `false` and no `planned` work block references *a*;
3. `0` if `a.sourceState` is `missing` or `withdrawn` and `a.status` is not
   `in_progress`;
4. otherwise, if *a* has at least one task with `estimatedMinutes`:
   `Σ remaining minutes of its tasks + max(0, (a.estimatedMinutes or 0) − Σ estimatedMinutes of its non-cancelled tasks − done minutes of blocks of a without taskId)`;
5. otherwise: `max(0, (a.estimatedMinutes or 0) − done minutes of all blocks of a)`.

**Scheduled minutes** of an assignment = Σ minutes of its `planned` work
blocks that end after now. **Unscheduled minutes** = `max(0, remaining −
scheduled)`.

Work that rules 1–3 set to 0 is not planned automatically (by generators or
by the website's planner) and is not part of remaining-workload or overload
totals. When `availability` is empty the website shows no overload at all
(§ 11).

*Worked example* (the Othello essay of § 18.2): `estimatedMinutes` 240; tasks
30 (done) + 30 + 120 + 60 = 240. Remaining = 0 + 30 + 120 + 60 + max(0, 240 −
240 − 0) = 210. Its planned blocks after now add up to 30 + 50 + 70 + 60 =
210, so 0 minutes are unscheduled.

### 8.2 Reference

References appear on assignments and on classes (§ 7).

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
  "id": "gc-NzAwMDAwMDAwMDAx-t2",
  "title": "Outline (printed copy due in class)",
  "estimatedMinutes": 30,
  "dependsOn": [ "gc-NzAwMDAwMDAwMDAx-t1" ],
  "recommendedCompletionDate": "2026-10-12",
  "due": "2026-10-13",
  "status": "not_started"
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | ID | **yes** | | Unique in the whole file. Form: `<assignmentId>-t<N>` (§ 14.1). |
| `origin`, `locked`, `overrides`, `issues` | | no | | See § 6. The tasks of a protected assignment are protected with it. |
| `title` | Text 1–200 | **yes** | | What to do. |
| `description` | Text ≤ 5000 | no | | Details. |
| `notes` | Text ≤ 10000 | no | | The person's notes (person-owned). |
| `estimatedMinutes` | Minutes | no | | Total effort for this task, including work already done. **Required** when `estimateRange` is present. |
| `estimateRange` | `{ "min", "max" }` | no | | As for assignments; requires `estimatedMinutes`. |
| `status` | `"not_started"` \| `"in_progress"` \| `"done"` \| `"cancelled"` | no | `"not_started"` | |
| `completedAt` | LocalDateTime | no | | Only with `status: "done"`. |
| `required` | boolean | no | `true` | `false` for an optional step; it is not planned automatically and not counted in remaining work unless it already has planned blocks (§ 8.1). |
| `due` | DateOrDateTime | no | | **Checkpoint deadline**: a hard deadline for this step set by the source (e.g. "bring your outline to class on Tuesday"). Not later than the assignment's `due`. A Date without a time means "time not stated" (§ 8). |
| `dependsOn` | array of task IDs, unique | no | `[]` | Tasks **of the same assignment** that must be done first. No cycles. |
| `recommendedStartDate` | Date | no | | Earliest sensible day to start. |
| `recommendedCompletionDate` | DateOrDateTime | no | | When it should be done (a soft target). |

Task dates are ordered (§ 13.3): `recommendedStartDate` ≤
`recommendedCompletionDate` ≤ `due` (each when present); a task's `due` is not
later than the assignment's `due`; and no task date is later than the
assignment's `due` or `assessmentDate` (the later of the two when both are
present). The website warns about a block that ends after its task's `due`.

When an assignment has tasks with estimates, its `estimatedMinutes` SHOULD
equal the sum of the estimates of its non-cancelled tasks (it MAY be larger if
some work is not represented as a task).

## 10. Events (recurring and one-time)

Events are fixed commitments: school, classes, practice, lessons, jobs,
appointments, and the sittings of assessments outside school. They block
study time unless `busy` is `false`.

An event is **one-time** (has `date`) **or** **recurring** (has
`recurrence`) — exactly one of the two.

Created by the person in the website:

```json
{ "id": "u-evt-7k2m9q4d", "title": "School", "category": "school",
  "startTime": "08:00", "endTime": "15:00",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"],
                  "startDate": "2026-09-02", "endDate": "2027-06-18",
                  "exceptDates": ["2026-11-26", "2026-11-27"] },
  "origin": "user" }
```

Created by a generator from what the person said on Friday, Oct 9 ("I have
fencing Mondays 4–6", no start date given, so the start date is the Monday of
that week, § 15.5):

```json
{ "id": "evt-fencing", "title": "Fencing", "category": "activity",
  "startTime": "16:00", "endTime": "18:00",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon"], "startDate": "2026-10-05" },
  "origin": "generated", "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-09" } }
```

A one-time event:

```json
{ "id": "u-evt-q3v8m1xa", "title": "Doctor appointment", "category": "appointment",
  "date": "2026-10-12", "startTime": "15:30", "endTime": "16:30", "origin": "user" }
```

The sitting of an assessment outside school, linked to its assignment:

```json
{ "id": "evt-piano-theory-exam-2026-10-24", "title": "Piano theory exam", "category": "appointment",
  "assignmentId": "piano-theory-exam-2026-10-24",
  "date": "2026-10-24", "startTime": "09:00", "endTime": "11:00",
  "origin": "generated", "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-11" } }
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `overrides`, `source`, `sources`, `issues` | | | | See § 6. |
| `title` | Text 1–200 | **yes** | | Name. |
| `category` | `"school"` \| `"class"` \| `"activity"` \| `"appointment"` \| `"work"` \| `"personal"` \| `"other"` | no | `"other"` | For display. |
| `classId` | ID | no | | Related class (e.g. a class meeting). MUST reference an existing class. |
| `assignmentId` | ID | no | | The assessment this event is the **sitting** of (see below). MUST reference an existing assignment. |
| `date` | Date | one of `date`/`recurrence` | | Day of a one-time event. |
| `endDate` | Date | no | | Last day (inclusive) of a **multi-day all-day** one-time event. Only with `date` and `allDay: true`; must be ≥ `date`. |
| `recurrence` | [Recurrence](#recurrence) | one of `date`/`recurrence` | | Repetition rule. |
| `allDay` | boolean | no | `false` | All-day event; then `startTime`/`endTime` MUST be absent. |
| `startTime` | Time | if not `allDay` | | Start. |
| `endTime` | EndTime | if not `allDay` | | End; MUST be later than `startTime`. `"24:00"` means midnight at the end of the day; events cannot cross midnight in 1.0. |
| `busy` | boolean | no | `true` | `true`: the person is not available for study during the event. `false`: informational only. An all-day busy event blocks the whole day. |
| `location` | Text ≤ 200 | no | | Where. |
| `notes` | Text ≤ 10000 | no | | Person-owned notes. |

**Assessment sittings outside school.** An assessment that takes place
outside the regular school day (for example a standardized test on a
Saturday 08:00–12:00, or a music exam) is represented once as an
**assignment** (the preparation, `type` `exam`/`test`/`quiz`, with
`assessmentDate` = the start of the sitting) and once as a busy one-time
**event** with `assignmentId` (the sitting itself, which blocks that time).
The website shows the link between the two and does not show the assessment
twice. Assessments held during school need no event.

### Recurrence

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `frequency` | `"weekly"` | **yes** | | Only weekly repetition exists in 1.0 (use all seven days for "daily"). |
| `daysOfWeek` | array of Weekday, 1–7 unique values | **yes** | | Days on which it occurs. |
| `interval` | integer 1–52 | no | `1` | Every N weeks (`2` = every other week). |
| `startDate` | Date | **yes** | | First day the rule applies. When the person gives none, generators use the Monday of the week containing `meta.generatedAt` (§ 15.5). |
| `endDate` | Date | no | | Last day (inclusive). Absent = no end. Must be ≥ `startDate`. |
| `exceptDates` | array of Date | no | `[]` | Days on which it does **not** occur (holidays, cancellations). |

An event occurs on date *d* when **all** of these hold:

1. `startDate ≤ d`, and `d ≤ endDate` if `endDate` is present;
2. the weekday of *d* is in `daysOfWeek`;
3. *d* is not in `exceptDates`;
4. `((monday(d) − monday(startDate)) in days / 7) mod interval = 0`, where
   `monday(x)` is the Monday of the Monday-to-Sunday week containing *x*
   (independent of `settings.weekStartsOn`). The difference is in whole
   calendar days computed on dates (e.g. as epoch-day numbers), never on
   timestamps, so daylight-saving changes cannot shift it.

   Worked vectors (`interval: 2`):
   - `startDate` 2026-10-14 (a Wednesday), `daysOfWeek` `["mon"]` → 2026-10-26,
     2026-11-09, 2026-11-23, … (Monday 2026-10-12 is before `startDate`;
     2026-10-19 is in an odd week).
   - `startDate` 2026-10-11 (a Sunday), `daysOfWeek` `["sun", "mon"]` →
     2026-10-11, 2026-10-19, 2026-10-25, 2026-11-02, 2026-11-08, … (the week of
     2026-10-11 starts on Monday 2026-10-05, so Monday 2026-10-12 is in the
     following, odd week).

To cancel one occurrence (e.g. "no school on Nov 26"), add the date to
`exceptDates`. To move one occurrence, add the original date to
`exceptDates` and create a one-time event for the new time.

## 11. Availability (study time)

Availability windows say when the person is free to do schoolwork. Busy
[events](#10-events-recurring-and-one-time) inside a window are subtracted from it.

An availability window is **recurring** (`recurrence`) or for **one date**
(`date`), with a start and end time:

```json
{ "id": "u-avl-a5f7t3r9", "label": "After school",
  "startTime": "15:30", "endTime": "21:30",
  "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"], "startDate": "2026-09-02" },
  "origin": "user" }
```

```json
{ "id": "avail-saturday-morning-1000-1200", "label": "Saturday morning", "date": "2026-10-17",
  "startTime": "10:00", "endTime": "12:00",
  "origin": "generated", "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-11" } }
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id`, `origin`, `locked`, `overrides`, `source`, `sources`, `issues` | | | See § 6. |
| `label` | Text ≤ 200 | no | Name shown in the website. |
| `date` | Date | one of `date`/`recurrence` | A single day. |
| `recurrence` | [Recurrence](#recurrence) | one of `date`/`recurrence` | Repetition rule (same rules as events). |
| `startTime` | Time | **yes** | Start. |
| `endTime` | EndTime | **yes** | End; later than `startTime` (`"24:00"` = midnight at the end of the day). |

**Free study time** on a day = the union of that day's availability windows,
minus all busy events of that day. Overlapping windows are merged.

**Empty availability.** An empty `availability` array means "not provided",
not "never free". The website then shows no "Available"/free time, skips all
overload calculations and prompts the person to add their study time.
Generators MUST ask the person for their study time before planning blocks
when `availability` is empty and the person has not stated it (§ 15.7).

## 12. Schedule blocks (scheduled work)

A schedule block puts work on the calendar. It **references** the assignment
(and optionally one of its tasks) instead of copying it.

```json
{
  "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-3",
  "assignmentId": "gc-NzAwMDAwMDAwMDAx",
  "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
  "start": "2026-10-13T16:30:00",
  "end": "2026-10-13T17:20:00",
  "status": "planned",
  "description": "Introduction and first body paragraph.",
  "origin": "generated"
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id`, `origin`, `locked`, `overrides`, `source`, `sources`, `issues` | | | | See § 6. `origin` may be `"planner"` (placed by the website's planner). Moving or resizing a `generated` or `planner` block in the website sets `locked: true`. |
| `start` | LocalDateTime | **yes** | | Start. |
| `end` | LocalDateTime | **yes** | | End, at least 5 minutes after `start`. On the same calendar date as `start`, or `00:00` of the next date, which means midnight at the end of the start date (`"start": "2026-10-13T23:00:00", "end": "2026-10-14T00:00:00"`). |
| `assignmentId` | ID | one of `assignmentId`/`title` | | The assignment worked on. MUST exist. |
| `taskId` | ID | no | | A task of that assignment. Requires `assignmentId`; MUST belong to it. |
| `title` | Text 1–200 | one of `assignmentId`/`title` | | Label for blocks without an assignment (e.g. `"Review flashcards"`), or an override label. |
| `kind` | `"work"` \| `"break"` | no | `"work"` | `break` = an intentional break (needs `title`, no `assignmentId`). |
| `status` | `"planned"` \| `"done"` \| `"skipped"` | no | `"planned"` | Progress of this session. `skipped`: the session did not happen. Person-owned (§ 15.2). |
| `completedAt` | LocalDateTime | no | | Only with `status: "done"`. |
| `description` | Text ≤ 5000 | no | | **Generator-owned**: what to do in this session, e.g. `"Introduction and first body paragraph."` |
| `notes` | Text ≤ 10000 | no | | **Person-owned**: the person's own notes. Generators never write it (§ 15.2). |

### 12.1 Past, future and in-progress blocks

"Now" is, for a generator, the current time in `meta.timezone` (§ 15.1); for
the website's import, the incoming file's `meta.generatedAt` (or the import
time when it is absent, § 16.1); otherwise the website's current time.

- A block is **past** when `end ≤ now`, **future** when `start ≥ now`, and
  **in progress** when `start < now < end`.
- Generators and the import treat an in-progress block as past: it is kept
  unchanged, except that a past `planned` block may be marked `done` or
  `skipped` (§ 15.7, § 16.3). In remaining work it counts as `planned`
  (§ 8.1).
- A past block whose `status` is still `planned` counts as **not done**. The
  website prompts the person to mark such blocks `done` or `skipped`.

### 12.2 Placing blocks

- Blocks for an assessment (type `quiz`, `test`, `exam`, `presentation`)
  represent **preparation** sessions and SHOULD end **before** the
  `assessmentDate` (a date-only `assessmentDate` means 00:00 of that day),
  spread over several days.
- Blocks SHOULD end before the assignment's `due` (a date-only `due` means
  `settings.defaultDueTime` on that day) and before their task's `due`.
- Blocks may overlap events or each other; the website shows overlaps as
  conflicts but accepts them.
- The session settings (§ 5 Settings) apply to `generated` and `planner`
  blocks only; a `user` or locked block may be of any length.

## 13. Validation rules

A file is valid only if **all** rules in § 13.1–13.3 hold. The website
rejects an invalid file as a whole and lists every problem with its location
(e.g. `assignments[3].due`). Each rule is marked:

- **[S]** — expressed in the JSON Schema; any conforming JSON Schema 2020-12
  validator enforces it. Patterns must match the whole value (§ 3): a Python
  validator MUST check them with full-match semantics, because Python's `$`
  also matches before a trailing newline (so, for example, the `jsonschema`
  package on its own accepts `"2026-10-16\n"` as a Date).
- **[V]** — semantic; the JSON Schema cannot express it. The website and
  `validate_schedule.py` enforce it.

### 13.1 Structure

1. **[S]** The root is an object; `schemaVersion` is the string `"1.0"`;
   `classes`, `assignments`, `events`, `availability` and `scheduleBlocks`
   are present and are arrays.
2. **[S]** Every field has the type, format, length, numeric range, array size,
   uniqueness and enum value given in §§ 3–12 (for example `sources` ≤ 20
   entries, class `topics` and `references` ≤ 200 entries, `deleted` ≤ 5000
   entries, `requestedChanges[].reason` 1–500 characters, unique `dependsOn`
   entries).
3. **[S]** No unknown properties except `x-…` properties (§ 1).
4. **[S]** No `null` values, except inside the value of an `x-…` property
   (§ 1).
5. **[S]** Events and availability have exactly one of `date` and
   `recurrence`. Events: `allDay: true` → no `startTime`/`endTime`;
   otherwise both are present and `endDate` is absent; `endDate` requires
   `date`. Recurrence `daysOfWeek` has 1–7 unique values.
6. **[S]** Blocks have an `assignmentId` or a `title`; `taskId` only with
   `assignmentId`; a `break` block has a `title` and no `assignmentId`.
7. **[S]** `completedAt` only when `status` is `"done"` (assignments, tasks,
   blocks).
8. **[S]** `estimateRange` only together with `estimatedMinutes`
   (assignments and tasks).
9. **[S]** `origin: "planner"` only on schedule blocks.
10. **[S]** `itemId` only on root issues, never in an item's `issues`.
11. **[S]** `overrides` entries are unique, and each is a name allowed for
    that item type (§ 6.3) or an `x-…` name.
12. **[V]** Every Date, and the date part of every LocalDateTime, is a real
    calendar date (`2026-02-30` matches the schema's pattern but is invalid).
    Every required Text field (`title`, `name`, `message`, `reason`, …)
    contains a non-whitespace character (§ 3).

### 13.2 IDs and references

13. **[V]** Every item `id` is unique across the whole file (classes,
    assignments, tasks, events, availability, blocks).
14. **[V]** `deleted[].id` values are unique, and no item in the file has an
    `id` listed in `deleted`.
15. **[V]** Issue `id`s are unique among all issues of the file (the root
    issues and the issues of every item and task).
16. **[V]** `meta.requestedChanges[].id` values are unique.
17. **[V]** References resolve:
    - `assignments[].classId` and `events[].classId` reference existing
      classes;
    - `events[].assignmentId` references an existing assignment;
    - `scheduleBlocks[].assignmentId` references an existing assignment, and
      `taskId` a task of **that** assignment;
    - `assignments[].dependsOn` references other existing assignments (not
      itself); `tasks[].dependsOn` references other tasks of the same
      assignment;
    - root `issues[].itemId` references an existing item of any collection,
      tasks included.
18. **[V]** The dependency graphs have no cycles (assignments; tasks within
    one assignment).

### 13.3 Times, dates and estimates

19. **[V]** Block `end` is at least 5 minutes after `start`, and is on the
    same date as `start` or is `00:00` of the next date (midnight at the end
    of the start date).
20. **[V]** Events and availability: `endTime` > `startTime` (`24:00` is
    later than every Time); event `endDate` ≥ `date`; recurrence `endDate` ≥
    `startDate`.
21. **[V]** Assignments: `recommendedCompletionDate` ≤ `due`; when there is no
    `due`, `recommendedCompletionDate` ≤ `assessmentDate`.
22. **[V]** Tasks:
    - `recommendedStartDate` ≤ `recommendedCompletionDate`;
    - `recommendedCompletionDate` ≤ the task's `due`;
    - the task's `due` ≤ the assignment's `due` (when both exist);
    - each task date (`recommendedStartDate`, `recommendedCompletionDate`,
      `due`) ≤ the assignment's `due` or `assessmentDate` — the later of the
      two when both are present.
23. **[V]** `estimateRange.min` ≤ `estimateRange.max`, and `min` ≤
    `estimatedMinutes` ≤ `max`.
24. **[V]** `settings.dayEndTime` > `dayStartTime`; `maxSessionMinutes` ≥
    `minSessionMinutes`. These are checked after defaults are applied (an
    absent setting takes its default), so `{"dayStartTime": "23:00"}` (end
    `22:00` by default) and `{"minSessionMinutes": 100}` (maximum `60` by
    default) are invalid.

**Comparing dates in rules 21–22:** when both values have a time, they are
compared as date-times; when either value is a Date without a time, only the
dates are compared. So `"2026-10-16"` and `"2026-10-16T09:00"` count as equal,
and validity never depends on `settings.defaultDueTime`.

### 13.4 Warnings

Warnings do not make a file invalid; the website shows them in the import
preview and next to the affected items:

- a block that ends after its assignment's `due` or after its task's `due`
  (a date-only `due` means `settings.defaultDueTime` on that day);
- a preparation block that ends after its assignment's `assessmentDate` (a
  date-only `assessmentDate` means 00:00 of that day);
- overlapping blocks, or blocks overlapping busy events;
- a `generated` or `planner` block shorter than `minSessionMinutes` or longer
  than `maxSessionMinutes`, or a day whose work blocks exceed
  `maxDailyStudyMinutes` and that contains `generated` or `planner` blocks —
  never for `user` or locked blocks alone;
- a recurrence that never occurs;
- dates more than 5 years away from today;
- `overrides` on an `origin: "user"` item (ignored);
- a `meta.timezone` that is not a known IANA time-zone name.

## 14. IDs: format, generation and preservation

IDs are what makes repeated imports safe. An ID identifies **one** real thing
(one class, one assignment, one task, one event, one availability window, one
work session) **forever**.

1. IDs MUST match the ID format (§ 3) and be unique in the whole file.
2. Once an item has an ID, that ID MUST NOT change in later versions of the
   schedule, even if the title, dates or anything else change.
3. An ID MUST NOT be reused for a different item, even after the original item
   was deleted. The root `deleted` list records deleted generated items (§ 5).
4. IDs created by the website start with `u-`
   (`u-<kind>-<8 random characters>`, e.g. `u-asg-k3j9x2p1`); this includes
   blocks placed by the website's planner. Generators MUST NOT create IDs
   starting with `u-`, but MUST keep existing `u-` IDs unchanged.
5. Referencing fields (`classId`, `assignmentId`, `taskId`, `dependsOn`,
   `itemId`, and the `id` of tombstones and requested changes) always use IDs,
   never titles.
6. Generators **match before they create** (§ 15.3). The derivation rules in
   § 14.1 are used only when an item is created for the first time; later runs
   find the existing item and reuse its ID. IDs are never re-derived from
   changed data.

### 14.1 Deriving IDs for new items (generators)

`slug(x)`: (1) remove diacritics (`é` → `e`) and convert to lowercase ASCII;
(2) replace every run of characters other than `a`–`z` and `0`–`9` with one
`-`; (3) trim `-` from both ends; (4) cut to 40 characters and trim a trailing
`-` again. If the result is empty, use `item`.

| New item | ID | Example |
| --- | --- | --- |
| Google Classroom class | `gc-class-<courseId>` | `gc-class-NjI3ODk0MjE0NTQ5` |
| Google Classroom item (assignment, question, other coursework) | `gc-<itemId>` | `gc-NzAwMDAwMDAwMDAx` |
| Work announced in the text of a Classroom item (e.g. an announcement) | `gc-<itemId>-<slug(title)>` | `gc-NzAwMDAwMDAwMDA2-read-chapter-5` |
| Class not from Classroom | `cls-<slug(name)>` | `cls-biology` |
| Item from a document (syllabus, calendar, sheet, photo) | `<slug(classShortName)>-<slug(title)>-<date>` | `biology-unit-2-test-cells-2026-10-16` |
| Item without a class (e.g. from what the person said) | `<slug(title)>-<date>` | `piano-theory-exam-2026-10-24` |
| One occurrence of recurring academic work (§ 15.5) | `<seriesSlug>-<YYYY-MM-DD>` | `english-vocab-quiz-2026-10-23` |
| Recurring event | `evt-<slug(title)>` | `evt-fencing` |
| One-time event | `evt-<slug(title)>-<YYYY-MM-DD>` | `evt-piano-theory-exam-2026-10-24` |
| Availability window | `avail-<slug(label or days)>-<HHMM>-<HHMM>` | `avail-weekend-mornings-1000-1300` |
| Task | `<assignmentId>-t<N>` | `gc-NzAwMDAwMDAwMDAx-t3` |
| Schedule block | `blk-<assignmentId or slug(title)>-<YYYYMMDDHHMM>-<N>` | `blk-gc-NzAwMDAwMDAwMDAx-202610092000-3` |

- **Classroom ids** (`courseId`, `itemId`) are normalized to the form used in
  the exporter's URLs: the unpadded base64 of the decimal id (decimal
  `627894214549` → `NjI3ODk0MjE0NTQ5`). An id already in that form is used as
  is. `source.id` uses the same form.
- **`<date>`** is the date part of the item's `due` (or, without a `due`, its
  `assessmentDate`) as known when the item is first created, or `nodate` when
  it has neither. It is the first-seen date and is never re-derived: when the
  due date later moves, the ID keeps the old date.
- **`classShortName`**: a short name of the class, e.g. `biology`,
  `english-10`.
- **Availability**: `label` when present, otherwise the window's days joined
  with `-` (e.g. `sat-sun`) or its date; the times are the window's start and
  end without the colon.
- **Tasks**: `N` is greater than every number already used by a task of that
  assignment, including tasks listed in `deleted`.
- **Blocks**: `YYYYMMDDHHMM` is the `meta.generatedAt` of the run that creates
  the block; `N` = 1, 2, … counts the blocks that run creates for that
  assignment (or title).
- **Derived work** (`gc-<itemId>-<slug(title)>`): its `source` names the
  Classroom item it was found in (`kind` `google_classroom`, with `url`,
  `path` and `label`) but has **no `id`**, because several items can come
  from one announcement. Such items are matched by ID and title (§ 15.3).
- **Length.** Assignment IDs derived by generators SHOULD be at most 78
  characters **including** any collision suffix (cut the slug parts before
  appending `-b`, `-c`, …), so that derived task IDs and block IDs (`blk-` +
  78 + `-YYYYMMDDHHMM-` + up to 4 digits) stay within 100 characters. Every
  derived ID MUST be at most 100 characters: when it would be longer (for
  example because it contains a long ID written by another tool), cut the
  part taken from that ID or slug until it fits.
- **Collisions**: when a derived ID is already used by a different item or
  listed in `deleted` for a different item, append `-b`, `-c`, … until it is
  free. Whether an existing item with the derived ID is the same item or a
  different one is decided by § 15.3, rule 1.
- The `u-` prefix stays reserved for IDs created by the website.

### 14.2 Year-less Classroom dates

Classroom shows dates of the current year without the year (`Oct 10,
11:59 PM`), and the exporter keeps them as displayed. Generators use the year
that puts the date closest to the item's posted date (from `metadata.json` /
`description.txt`), or to the export date when the posted date is unknown.
When two years are about equally plausible, they add an `ambiguity` issue.

## 15. Updating an existing schedule (rules for generators)

When a generator (such as the `/academic-schedule` skill) is given an existing
`schedule.json` together with new materials or instructions, it MUST produce
an **updated copy of that file**, not a new file from scratch. § 15.3–15.9
also apply when there is no input schedule.

### 15.1 Start from the input file

1. **Keep everything.** Every item, task, tombstone and root issue of the
   input MUST appear in the output with the same `id` and the same field
   values — including `origin`, `locked`, `overrides`, `notes`, statuses,
   `completedAt`, issue statuses and `x-…` properties — unless a rule below
   allows the change.
2. **Clock.** "Now" is the current time in the input schedule's
   `meta.timezone`, or in a zone the person gives; with neither, the
   generator asks the person, or assumes a zone and states the assumption in
   its summary. It writes `meta.generatedAt` (now, as a LocalDateTime) and
   `meta.timezone`. Past, future and in progress are defined in § 12.1.
3. **Meta.** Replace `meta.generator` and `meta.generatedAt`. Set
   `meta.basedOn` to the input schedule's `meta.exportId` (or, when the input
   has no `exportId`, copy its `basedOn`); omit `basedOn` when no existing
   schedule was given. Never write `meta.exportId` (only the website's export
   writes it, § 17). Set `meta.sources` to the materials used in this run,
   including the input schedule (kind `schedule`). Keep `meta.title` unless
   the person asks to change it. `meta.requestedChanges` lists only this
   run's changes (§ 15.9); never copy it from the input.
4. **Settings** are person-owned: copy them unchanged unless the person asked
   in this request to change one, and describe every changed setting in the
   summary, telling the person to tick it in the import preview (the website
   asks the person before it takes a file's settings, § 16.6).
5. **Tombstones.** Copy `deleted` unchanged. Never create an item whose `id`
   is listed there, nor an item whose `source.id`, or the `id` of an entry of
   its `sources`, equals the `sourceId` of an entry of the same collection.
   An item without a source id, and a task, MUST NOT be created either when a
   tombstone of the same collection has the same normalized `title` (§ 15.3;
   for a task: a tombstone whose ID starts with `<assignmentId>-t`), unless
   the person asks for it in this request; occurrences of recurring academic
   work (§ 15.5) are exempt, since their date is part of their ID. A
   generator MAY append entries for `generated` items that it removes itself
   under these rules.

### 15.2 Protected items and person-owned fields

1. **Protected items** (`origin: "user"` or `locked: true`) MUST be copied
   unchanged, including everything inside them (the tasks of a protected
   assignment), and MUST NOT be deleted. The only exception is a requested
   change (§ 15.9).
2. **Person-owned fields of all other items** MUST be kept: `notes`,
   `locked`, `overrides` and the values of the fields it names (§ 6.3),
   `status` and `completedAt` (see 3), and the `status` of issues.
   Generators never write `notes` on items they create; what to do in a
   session goes into the block's `description`.
3. **Never undo progress.** A `done` assignment, task or block stays `done`
   with its `completedAt`. Statuses only move forward (`not_started` →
   `in_progress` → `done`) and only when a source shows it (e.g. Classroom
   shows the work as turned in). Work that a source withdraws is recorded with
   `sourceState` (§ 15.6), not with `status: "cancelled"`; a generator sets an
   assignment's status to `cancelled` only when the person asks for it in
   this request (tasks: § 15.4).
4. Issues about a protected item go into the root `issues`, with `itemId`
   (§ 15.8).

### 15.3 Match before creating an item

Matching applies to classes, assignments, tasks, events and availability
windows. Before creating one, a generator MUST look for an item that
represents the same thing — in the input schedule and among the items it has
already created in this run — in this order:

1. an item of the same collection with the same `id` (the ID § 14.1 would
   derive), when that ID comes from a source id (`gc-class-…`, `gc-…`) or is
   an occurrence of recurring academic work (`<seriesSlug>-<YYYY-MM-DD>`).
   For an ID derived from a title (`cls-…`, `evt-…`, `avail-…`, the IDs of
   items from documents or from what the person said), an existing item with
   that ID is a match only when rule 3 also holds; otherwise the new item is
   a different one and gets a collision suffix (§ 14.1);
2. an item of the same collection whose `source`, or an entry of whose
   `sources`, has the same `kind` and `id` (derived work has no `source.id`,
   § 14.1, so it is matched by rules 1 and 3 only);
3. as a **fallback** for what rules 1–2 cannot match: an item of the same
   collection with the same `classId` (or both without one), the same type
   family, the same normalized title, and either no date on both or dates
   **fewer than 7 days** apart.
   - Type families: assignments of type `quiz`, `test`, `exam` and
     `presentation` form one family, all other assignment types another; in
     the other collections the collection is the family.
   - Normalized title: `slug(x)` without the 40-character limit (§ 14.1) of
     the `title` — for classes the `name`, for availability the `label` (or,
     without one, its days or date as in § 14.1).
   - Dates compared (date parts only): `due`, else `assessmentDate` for
     assignments; `due`, else `recommendedCompletionDate` for tasks; `date` or
     `recurrence.startDate` for events and availability. Classes have none.
   - Rule 3 MUST NOT match: (a) two items whose sources have the same `kind`
     and both have an `id`, when the ids differ (e.g. this week's and last
     week's Classroom post "Reading log"), except for a re-post (below);
     (b) occurrences of recurring academic work (§ 15.5), which are matched
     by ID only; (c) items of which only one has a date; (d) the two parts of
     a recurring commitment that was split at a date (§ 15.5).

Tasks are matched the same way within their assignment. **Schedule blocks are
never matched**: every block a run creates is a new session, and existing
blocks change only under § 15.7. The generator also checks `deleted`
(§ 15.1, rule 5).

- **Re-post.** A new Classroom item that looks like a re-post of an existing
  item (rule 3 holds except for the different ids) whose own Classroom item
  is absent from the same complete export (§ 15.6, rule 1) MAY be matched to
  it: the existing item keeps its `id`, the new Classroom item becomes its
  `source`, the old one moves into `sources`, `sourceState` stays
  `"present"`, and an `ambiguity` issue is added.
- **Several inputs, one item.** When two inputs of a run describe the same
  work or the same course (a Classroom assignment and the syllabus entry for
  the same test; a Classroom class and the syllabus's course), the generator
  creates **one** item. Its ID and `source` come from the most specific
  source, in this order: `google_classroom`, `syllabus` or `document`,
  `calendar`, `image`, `user`; the other sources go into `sources`, and
  disagreements become `conflict` issues. An existing item that gains a new
  source keeps its ID and adds the source to `sources`.
- **Different titles.** When the titles differ but the generator judges that
  two items are the same (e.g. "Unit 2 Test" and "Unit 2 Test: Cells"), it
  MAY match them (never against exclusions (a)–(d)) and adds an `ambiguity`
  issue naming both titles.

On a match the generator reuses the existing item's `id` and updates it under
§ 15.4 where allowed. When a rule-1 or rule-2 match is a **protected** item,
it is the same item: the generator leaves it unchanged and, when the source's
values differ from it, adds a root `conflict` issue with `itemId` (§ 15.8).
When a rule-3 (or different-titles) match is a protected item, it creates
nothing new and adds a root issue `{"kind": "ambiguity", "itemId": "<that
id>", "message": "…"}` explaining that the item was not added to avoid a
duplicate — or, when the person asked to link the two, changes the protected
item through a requested change (§ 15.9).

### 15.4 Updating generated items

1. **Update in place.** A generator MAY update the generator-owned fields
   (§ 15.10) of an unlocked `generated` item, keeping its `id`, when the
   sources show a change (new due date, new instructions, new estimate). It
   MUST keep the value of every field named in the item's `overrides`. When a
   source's value differs from an overridden value, it keeps the person's
   value and adds an issue to the item, e.g. `{"id":
   "gc-NzAwMDAwMDAwMDAx:conflict:due:20261017T2359", "kind": "conflict",
   "field": "due", "message": "Classroom now says Oct 17, 11:59 PM; you set
   Oct 16. Keeping Oct 16."}` (issue IDs: § 15.8). When the person asks in
   this request to change an overridden field ("use the teacher's new
   date"), the generator still keeps the person's value (the import keeps it
   too, § 16.3) and tells the person in its summary to change the field in
   the website.
2. **Record surprising changes** as issues on the item, e.g.
   `{"id": "gc-NzAwMDAwMDAwMDAy:conflict:due:20261014", "kind": "conflict", "field": "due", "message": "Due date moved from Oct 13 to Oct 14 in Classroom."}`.
3. **Estimates.** `estimatedMinutes` is the total effort including work
   already done; a generator MUST NOT lower it to reflect progress. It
   changes an existing estimate only when the evidence changed (new
   instructions, a teacher's estimate, a longer reading). A point estimate
   derived from a range is ⌈(min + max) / 2 / 5⌉ × 5 (§ 8).
4. **Tasks.** A generator may add, change, reorder and remove only
   `generated`, unlocked tasks of `generated`, unlocked assignments, and
   respects each task's `overrides`. A task that is `user`, locked, `done`,
   or referenced by a block that stays in the file MUST NOT be removed:
   - a `generated`, unlocked task that is not done gets `status: "cancelled"`
     instead;
   - a `done` task is neither removed nor cancelled; its other
     generator-owned fields may still be updated;
   - a `user` or locked task changes only through a requested change
     (§ 15.9).

   New tasks get IDs `<assignmentId>-t<N>` with `N` greater than any number
   used before (§ 14.1). A task never changes assignment: generators MUST NOT
   move a task to another assignment; they cancel the old task (or leave it,
   under the rules above) and create a new one.
5. **Only values the source states replace current ones.** A field is
   changed only when the source states a value for it. When the field is
   absent from the source, when the Classroom export was made with
   `options.readItemPages` `false` or reports that the item's page could not
   be read, or when the source gives a date without the time that an earlier
   source gave, the generator keeps the current value — and writes it, since
   an import removes fields that the file leaves out (§ 16.3).
6. **Deadlines that move earlier.** When a generator moves a `due` or
   `assessmentDate` earlier, it also moves the generator-owned dates that
   § 13.3 orders before it (the assignment's `recommendedCompletionDate`, and
   the dates of its `generated`, unlocked tasks, `done` ones included) so
   that the file stays valid. It never changes a person-owned or protected
   value (a field named in `overrides`, a date of a `user` or locked task):
   when such a value would be later than the new deadline, it keeps the
   current deadline, adds a `conflict` issue to the item saying that the
   source moved the deadline and that the person's date must be changed
   first, and plans the work so that it is finished by the new deadline.

### 15.5 Adding items

1. **New items.** Add new classes, assignments, tasks, events and
   availability windows (when § 15.3 finds no match) with IDs from § 14.1.
2. **Classroom materials and announcements.** A Google Classroom
   **Material**, or an **Announcement** that asks for no work, MUST NOT become
   an assignment. Attach it as a Reference with `required: false` to the class
   (`references`) or to the assignments it supports. An announcement yields
   assignments only for the work it announces (ID
   `gc-<itemId>-<slug(title)>`). Classroom topics go into the class's
   `topics` and the assignment's `topic`.
3. **What the person says.** Items created from the person's own statements
   ("I have fencing Mondays 4–6") get `origin: "generated"` and
   `"source": {"kind": "user", "label": "Told /academic-schedule on <YYYY-MM-DD>"}`.
   Later runs may update them like other generated items. § 15.6 never
   applies to items whose `source.kind` is `user`.
4. **Commitments.** Do not create events or availability that the person did
   not state and the sources do not contain. When the person gives no start
   date for a **new** commitment, use the Monday of the week containing
   `meta.generatedAt` as `recurrence.startDate` and omit `endDate`. Never
   guess term dates.

   **Changing a recurring commitment from a date onward** ("fencing moved to
   Tuesdays") does not rewrite its past. Let *d* be the date the person gives,
   otherwise the date of the earliest occurrence of the old or the new rule
   that starts after `meta.generatedAt`. Set the existing item's
   `recurrence.endDate` to the day before *d*, and create a new item for the
   new rule with `recurrence.startDate` *d* and an ID per § 14.1 with a
   collision suffix (e.g. `evt-fencing-b`). For a protected item, the change
   to the existing item is a requested change (§ 15.9). Edit the existing item in place
   only when the person corrects a mistake ("fencing was always on
   Tuesdays") or when *d* is not after its `startDate`. § 15.3 rule 3 never
   matches the two parts of such a split.
5. **Assessment sittings outside school** get an assignment and a linked
   event (§ 10).
6. **Recurring academic work** ("vocabulary quiz every Friday", "read 20
   minutes every night"): create one dated assignment per occurrence within a
   stated horizon (default: the next 3 weeks), with IDs
   `<seriesSlug>-<YYYY-MM-DD>`. Later runs add the next occurrences, which
   are matched by ID only (§ 15.3), never to an earlier occurrence. There is
   no recurrence field on assignments.
7. **Dates.** Write a time whenever the source states one, a Date otherwise
   (§ 8). An online quiz or test with a deadline and no fixed sitting gets
   `due` and no `assessmentDate`.
8. **Optional work** gets `required: false`; reference material is not work.

### 15.6 Items no longer in their source

A generator MUST NOT delete a generated item because a newer source no
longer lists it.

**Only newer exports count.** A Google Classroom export is used to change
items (§ 15.4) or to mark them missing only when its `exportedAt`
(`class-info.json` or `export-manifest.json`) is later than the `retrievedAt`
of the class's `source` (§ 5 Source); without a `retrievedAt` it counts as
newer. When several exports of one course are supplied, only the newest is
used. An older or equally old export changes nothing and is mentioned in the
summary. After using an export, the generator sets the class's
`source.retrievedAt` to the export's time (unless the class is protected).

For an **assignment**:

1. It counts as **missing** only when all of these hold:
   - the inputs of this run include a newer export of the same course (the
     same class `source.id`) that covers the item's type: assignments,
     questions, materials and other coursework are always exported;
     announcements, and work derived from them, only when the export's
     `includeAnnouncements` option was on (`class-info.json` →
     `options.includeAnnouncements`);
   - that export reports no item-read failures: neither `class-info.json`
     (`discovery.warnings`) nor `export-report.json` (`warnings`) says that a
     list may be incomplete, that an item or item page could not be read, or
     that announcements were skipped (attachment download failures do not
     matter);
   - in an archive whose `export-manifest.json` has `kind` `"account"` (one
     folder per class): the course's `classes[]` entry has `status`
     `"exported"`, or `"partial"` without `error` (only attachments failed),
     and its folder contains both `class-info.json` and `export-report.json`.
     A course with status `"failed"`, with an `error`, or with either file
     missing counts as not exported;
   - for an item from a document (syllabus, calendar, …): a newer version of
     the same document is supplied and no longer contains it. A document
     counts as a newer version of the same document only when the person
     says so or its own date or version is later; otherwise the generator
     adds an `ambiguity` issue and marks nothing missing.

   Items whose `source.kind` is `user` are never missing. An item with
   several sources (`source` and `sources`) is missing only when each of its
   sources meets these conditions. A course that a newer account export no
   longer lists (archived or left) does not make its work missing: the
   generator adds a `missing_information` issue about the class (§ 15.8)
   asking whether to archive it.
2. Set `sourceState: "missing"` — or `"withdrawn"` when a source explicitly
   removes, cancels or excuses the work (e.g. an announcement "Worksheet 3 is
   cancelled"; the conditions of rule 1 are then not needed). Leave `status`
   unchanged. Remove the assignment's future, unlocked, planned blocks whose
   origin is `generated` or `planner` (except blocks with notes, § 15.7), and
   mention the change in the summary. For a **protected** assignment, write
   the new `sourceState` and list the assignment in `meta.requestedChanges`
   with `requestedByPerson: false` (§ 15.9), so that the import offers the
   change unticked; its blocks are kept. For each future `user` or locked
   block of a missing or withdrawn assignment, add a root issue with
   `itemId` (the block) so that the person can decide about it.
3. When a missing assignment appears again in a complete export, set
   `sourceState` back to `"present"`.
4. Other generated items that a source no longer lists are kept; the
   generator MAY add a `missing_information` issue to them.

The website shows `missing`/`withdrawn` assignments with a badge, excludes
them from automatic planning and from remaining-work and overload totals
unless they are `in_progress` (§ 8.1), and lists the change under "Removed
from source" when importing (§ 16.2).

### 15.7 Planning work

1. **Only future generated or planner work moves.** Blocks with origin
   `generated` or `planner` that are unlocked, `planned` and future (§ 12.1)
   MAY be moved (same `id`, new `start`/`end`), removed, or replaced by new
   blocks so that the plan fits the new situation. A `generated` (or
   `planner`) block with non-empty `notes` MAY be moved but MUST NOT be
   removed. All other blocks —
   `user`, locked, `done`, `skipped`, past and in-progress blocks — MUST be
   kept unchanged, with one exception: a generator MAY change the `status` of
   a past `planned` block to `done` (with `completedAt`) or `skipped` when
   the evidence shows it (e.g. Classroom shows the work as turned in).
   Generators never create `planner` blocks or `u-` IDs.
2. **What to plan:** the unscheduled minutes (§ 8.1) of each assignment;
   nothing for `required: false` work or for `missing`/`withdrawn` work that
   is not in progress. Respect `dependsOn`, task `due` dates, `due` and
   `assessmentDate` (§ 12.2); spread preparation and large work over several
   days.
3. **Where:** inside free study time (§ 11), not overlapping other blocks.
4. **Session settings** (§ 5 Settings) shape the generated blocks: session
   length between `minSessionMinutes` and `maxSessionMinutes`, `breakMinutes`
   between consecutive sessions, and at most `maxDailyStudyMinutes` of work
   blocks per day. `user` and locked blocks count toward the day's total but
   are never moved, shortened or flagged because of these settings.
5. **No availability:** when `availability` is empty and the person has not
   stated their study time, the generator MUST ask before planning blocks
   (§ 11).
6. **Block content:** `assignmentId` (and `taskId` when the session is for one
   task), `description` for what to do in the session, never `notes`. IDs per
   § 14.1.

### 15.8 Issues

1. **Where:** an issue about an unlocked `generated` item goes into that
   item's `issues`. An issue about a protected item goes into the root
   `issues` with `itemId`. An issue about the whole schedule or a day goes
   into the root `issues`, with `date` when it concerns one day.
2. **IDs:** generators MUST give every issue an `id`, derived from what it
   is about, so that two runs (or two generators) give the same problem the
   same ID and a different problem a different one:
   - about an item: `<itemId>:<kind>:<field>:<value>`, where `<value>` is the
     source value the issue is about (for a conflict: the value that was
     **not** used). A date or date-time is written without `-` and `:`
     (`20261017`, `20261017T2359`), any other value as `slug(value)`
     (§ 14.1). Leave out `:<field>` or `:<value>` when there is none, e.g.
     `gc-NzAwMDAwMDAwMDAx:conflict:due:20261017T2359`,
     `biology-unit-2-test-cells-2026-10-16:conflict:assessmentDate:20261023`;
   - about a day: `<kind>:<date>`, e.g. `workload:2026-10-15`;
   - about the whole schedule: `<kind>:<slug(subject)>`, e.g.
     `missing_information:availability`.

   When the result would be longer than 100 characters, cut the `<itemId>`
   part.
3. **Lifecycle:** generators MUST keep issues whose `status` is `resolved` or
   `dismissed` (copy them unchanged, by `id`) and MUST NOT raise an issue with
   the same `id` again. When the underlying values change (e.g. Classroom
   moves the date once more), the new issue has a new `<value>` and so a new
   `id`. The only exception: every writer removes root issues whose `itemId`
   names an item that no longer exists (an invalid reference, § 13.2).
4. New issues are open (omit `status`). Open issues that no longer apply MAY
   be removed or updated.

### 15.9 Changes to the person's own items

1. A generator MAY change or delete a protected item (or a protected task)
   **only** by listing it in `meta.requestedChanges`:
   `{"id": "<item id>", "reason": "…", "requestedByPerson": true|false}`.
   - `requestedByPerson: true`: the person asked for it in this request
     ("move fencing to Tuesdays", "the essay I added myself is the Classroom
     one").
   - `requestedByPerson: false`: a source suggests it, e.g. a school calendar
     lists a holiday, so the generator adds the date to the `exceptDates` of
     the person's School event.
2. To change an item, write the changed item (same `id`) and list it. To
   delete an item, leave it out of the file and list its `id`; items that
   reference it are removed or changed too (and listed when they are
   protected).
3. Without a listing, protected items MUST be copied unchanged (§ 15.2).
4. `requestedChanges` describes only the changes of the run that wrote the
   file; generators never copy it from their input. Each change is also
   explained in the summary.

The website shows listed items under "Changes to your items", pre-ticked when
`requestedByPerson` is `true` and unticked otherwise (§ 16.2).

### 15.10 Field ownership summary

| Data | Owner | May a generator change it? | Website import (§ 16.3) |
| --- | --- | --- | --- |
| everything on protected items (`origin: "user"` or `locked: true`), including the tasks of a protected assignment | person | **no**, except through `meta.requestedChanges` (§ 15.9) | current item kept ("Kept (your version)" / "Changes to your items") |
| `notes` (every item) | person | no; copied, never written on new items | non-empty current value kept |
| `overrides` and the values of the fields it names | person | no; copied unchanged | current overridden values kept; names unioned |
| `locked` | person | no | file's value (a locked current item is kept as a whole) |
| `status`, `completedAt` (assignments, tasks, blocks) | person | only forward (`not_started` → `in_progress` → `done`) when a source shows it; `cancelled` only when the person asks (tasks: § 15.4) | never goes backwards; current `cancelled` kept |
| issue `status` | person | no; resolved/dismissed issues are kept and not raised again | current `resolved`/`dismissed` kept |
| `settings` | person | only when the person asks in this request | "Settings", opt-in |
| `deleted` | person (written by the website) | copied; MAY append entries for items it removes | unioned |
| titles, names, descriptions, dates, estimates, priority, `topic`, `topics`, tasks, references, `dependsOn`, `sources`, `sourceState`, `issues` of unlocked `generated` items | generator | yes, except overridden fields | file's value |
| `description` of unlocked `generated`/`planner` blocks | generator | yes | file's value |
| `start`/`end` of unlocked, future, `planned` `generated`/`planner` blocks | generator | yes (move, replace; remove unless it has `notes`) | file's value; missing ones → "Outdated planned work" (files with `meta.basedOn`) |
| `done`/`skipped` blocks | person | no (a past `planned` block MAY become `done` or `skipped` on evidence, § 15.7) | current block kept as a whole |
| `origin` | fixed when the item is created | no | current value |
| `meta.generator`, `meta.generatedAt`, `meta.timezone` | writer | rewritten by every writer (§ 4) | not stored; the export writes its own |
| `meta.exportId` / `meta.basedOn` | website / generator | `basedOn`: the input's `exportId`; never writes `exportId` | `basedOn` used for the preview; the export writes a fresh `exportId` |
| `meta.title`, `meta.sources` | writer | `sources`: this run's inputs; `title`: kept | stored and written back on export |
| `meta.requestedChanges` | writer | this run's changes only | used for the preview only |

## 16. How the website imports a file

Importing never runs anything from the file; it only reads data.

### 16.1 Steps

1. **Read** the file (or pasted text) as JSON. Not JSON, or larger than
   10 MB → error.
2. **Check the version** (§ 2). Unsupported → clear error, nothing imported.
3. **Validate** (§ 13). Any error → the list of errors, nothing imported.
   Warnings are shown in the preview.
4. **Compare** with the current schedule (§ 16.2) and show a **preview**.
   "Now" for deciding which blocks are past or future is the incoming
   file's `meta.generatedAt`, or the import time when it is absent (§ 12.1).
   A block that the preview would move or remove but that has already ended
   at the import time is marked *"This session has passed — did you do
   it?"*; marking it done or skipped there changes the current block first,
   so that it is kept (§ 16.3). A file whose `meta.basedOn` is not the
   website's most recent `exportId` gets the warning *"This file was made
   from an older export; changes you made since then are kept where they are
   protected, but review the list carefully."* (the website remembers its
   recent export IDs).
5. **Check the result.** The website builds the merged schedule from the
   person's current choices and validates it with every rule of § 13.
   "Import" is enabled only when it is valid; otherwise the preview shows the
   problem on the affected rows (e.g. a date the person set that is later
   than the file's new `due`: untick that item's update, or change the date
   first).
6. The person confirms → the changes are applied in one step. The previous
   state is saved, so **Undo import** can restore it.

Importing the same file twice changes nothing the second time. When a choice
in the preview does not add a file item, the file items that reference it
are not added either, and the preview shows them in the same row. A choice
can remove a current item only if every item that references it
(`classId`, `assignmentId`, `taskId`) can be removed with it — `generated`
or `planner`, unlocked, not `done`, not "Always kept" — and then removes them
together (in the same row); otherwise the row cannot be ticked and shows the
reason, e.g. *"3 of your own assignments use this class"*. A removal also
removes the item's ID from `dependsOn` lists and the root issues about it
(§ 16.4).

### 16.2 What the preview shows

Items are matched by `id`. An `id` that a file item and a current item use in
different collections (e.g. a file's class uses the ID of an existing
assignment) is an error, and so is a file task whose `id` belongs to a task
of a **different** current assignment (a task never changes assignment): the
import is rejected with a clear error.

**Tasks** are not categorized on their own; they belong to their
assignment's row. Under an assignment that is kept (Kept (your version),
Always kept, or Unchanged), the file's tasks are ignored with it. Under an
Updated assignment, § 16.3 decides each task, and the row lists the tasks
that are added, changed or removed.

A file **without** `meta.basedOn` is a **fresh** file (made without the
person's schedule): "Outdated planned work" is not used for it, so current
blocks that it does not contain fall under "Not in this file" (kept by
default).

| Category | Which items | Default | What happens |
| --- | --- | --- | --- |
| **Previously deleted** | File items whose `id` is in the current `deleted` list, or whose `source.id` (or the `id` of an entry of their `sources`) equals the `sourceId` of a current tombstone of the same collection. | not ticked | Not added. Ticking restores the item and removes its tombstone. |
| **Possible duplicate** | Other file items whose `id` is not in the current schedule but that match a current item under § 15.3, rule 2 or 3 (same collection and the same source kind and id; or the same class, type family and normalized title, with dates fewer than 7 days apart). The row names the current item. | not ticked | Not added. Ticking adds the file item. |
| **New** | Other file items whose `id` is not in the current schedule. | applied | Added. |
| **Updated** | Same `id`, current item `generated` or `planner` and unlocked (for a block: not `done` or `skipped`), and the merged item (§ 16.3) differs from the current item (§ 16.5). | applied | The merged item replaces the current one. The preview lists the fields whose merged value differs from the current value, e.g. *"due: Oct 16 → Oct 17"*, *"estimate: 2 h → 2 h 30 m"*. |
| **Removed from source** | Updated assignments whose `sourceState` changes from `present` to `missing` or `withdrawn`. | applied | The new `sourceState` is taken; unticking keeps the current one (the other updates still apply) and also unticks the "Outdated planned work" rows of that assignment's blocks, which are shown in the same row. |
| **Changes to your items** | Protected current items whose `id` is listed in the file's `meta.requestedChanges`: changed (in the file, different) or deleted (not in the file). The reason is shown. | ticked if `requestedByPerson` is `true`, else not ticked | Ticked: the file's version replaces the current item, or the item is removed. Not ticked: the current item is kept. |
| **Kept (your version)** | (a) Protected current items that the file has in a different version and does not list in `requestedChanges`; and current `done` or `skipped` blocks that the file has in a different version (shown, **not selectable**: they are history). (b) Current items whose `status` is `cancelled` while the file has another status. (c) Current items named by a tombstone in the file's `deleted` that no other category removes (shown with the note *"deleted in the imported file"*). | not ticked | Current version kept. Ticking takes the file's version — for (b) the file's status, for (c) removes the item. |
| **Unchanged** | Same `id`, and the merged item (§ 16.3) equals the current item (§ 16.5). | — | Nothing. |
| **Outdated planned work** | Only for files with `meta.basedOn`. Current blocks that the file does not contain, are `generated` or `planner`, unlocked, future and `planned`, have no `notes`, and either belong to an assignment that **is** in the file, or (`generated` only, and only when the file contains at least one `generated` block) have no `assignmentId`. | applied | Removed (the file has re-planned that work). Unticking keeps them. |
| **Not in this file** | Other current `generated` or `planner` items that are unlocked and not in the file (and not "Always kept"). | not ticked | Kept. Ticking removes them. |
| **Settings** | One row per setting whose value in the file differs from the current value (an absent setting means its default). | not ticked | Current value kept. Ticking takes the file's value. |
| **Always kept** | Current `user` items, locked items, `done`/`skipped` blocks, past and in-progress blocks, `done` assignments and tasks that the file does not contain (unless listed under "Changes to your items"). | — | Never removed by an import. |

Every item of the file and of the current schedule (tasks: with their
assignment) is in exactly one of these categories, checked in this order:
Previously deleted, Possible duplicate, New, Changes to your items, Kept
(your version) (a), Always kept, Outdated planned work, Not in this file,
Updated, Unchanged. "Removed from source", "Kept (your version)" (b) and (c),
and "Settings" are additional rows: they never move an item out of its
category.

### 16.3 Person-owned fields during an update

When an existing `generated` or `planner` item is updated from the file, the
**merged** item is built like this:

- **`origin`** is never taken from the file: the merged origin is the current
  origin. (A file item whose `id` matches a current `user` item is treated as
  a `user` item, whatever origin the file gives it.)
- **Status never goes backwards.** Order: `not_started` < `in_progress` <
  `done`. If the current status is further along than the file's, the current
  status (and `completedAt`) is kept. A current `cancelled` is kept; when the
  file has a different status, the difference is offered under "Kept (your
  version)" (opt-in). The file's `cancelled` is applied only when the current
  status is `not_started` or `in_progress`.
- **Blocks.** A current `done` or `skipped` block is kept as a whole, every
  field included; a different file version is only shown, under "Kept (your
  version)", and cannot be selected. For a current `planned` block that is
  past or in progress (§ 12.1), only the file's `done` or `skipped` (with
  `completedAt`) is taken; its other fields stay as they are. Future
  `planned` blocks are merged like other items.
- **Notes are kept.** A non-empty current `notes` value is kept; the file's
  `notes` is used only if the current one is empty.
- **Overrides are kept.** Every field named in the current item's
  `overrides` keeps its current value (including its absence). The resulting
  `overrides` is the union of the current and the incoming names.
- **Issue decisions are kept.** Item issues are taken from the file, except
  that an issue whose `id` matches a current issue with status `resolved` or
  `dismissed` keeps that current status.
- **`x-…` properties** are merged key by key: each `x-…` key of the file
  takes the file's value, and `x-…` keys that only the current item has are
  kept. (Items that are kept keep all their current `x-…` keys.)
- **Tasks** are merged task by task (not replaced as one field), each with
  these same rules; a current `user` or locked task keeps its current
  version. The merged `tasks` array is the file's tasks in file order,
  followed by the current tasks that the file does not contain but that are
  kept — `user`, locked, `done`, or referenced by a block that remains — in
  their current order. A current `generated`, unlocked, not-done task that
  the file does not contain and that no remaining block references is
  removed (and listed in the assignment's row). When `tasks` is named in the
  assignment's `overrides`, the current tasks are kept as they are.
- Every other field takes the file's value (fields absent in the file are
  removed, so the file fully describes the item).

### 16.4 Removing items and tombstones

- When the person removes an assignment through the preview, its blocks are
  removed with it. An assignment that is `done`, or that has blocks that are
  `done`, `user` or locked, cannot be removed by an import.
- **Dependents.** Deleting an item — in the website's editors, or by ticking
  a removal in the import preview — also removes its ID from every
  `dependsOn`; deletes the events that are its sitting (`assignmentId`);
  deletes its blocks (in the editors, after asking when some are `done`);
  removes `taskId` from the blocks of a deleted task (they stay with the
  assignment); and deletes the root issues whose `itemId` names it, one of
  its tasks or one of the deleted blocks. Deleting a class asks whether to
  delete its assignments and events too or to keep them without the class
  (`classId` removed). These follow-on changes are not edits by the person
  and add nothing to `overrides`.
- **Tombstones.** Whenever the person deletes an item whose `origin` is
  `generated` — in the website's editors, or by ticking a removal in the
  import preview — the website appends an entry to `deleted`: `id`,
  `collection`, `deletedAt` (now), `sourceId` (the item's `source.id`, or
  else the `id` of the first entry of its `sources` that has one, if any)
  and `title` (title, name or label, cut to 300 characters). Deleting an
  assignment also appends one entry for each of its `generated` tasks and for
  a `generated` sitting event. Blocks removed as "Outdated planned work" or
  together with their assignment get no entry. Restoring an item (or undoing
  its deletion) removes its entry. When the list would exceed 5000 entries,
  the oldest entries (by `deletedAt`) are dropped.

### 16.5 When an item is "Unchanged"

An item is **Unchanged** when the merged item that § 16.3 would produce
equals the current item. Items are compared after normalization: defaults
are filled in (e.g. `origin` `generated`, `priority` `medium`, `status`
`not_started`, `required` `true`, `sourceState` `present`, `busy` `true`,
`kind` `work`, issue `status` `open`), empty arrays equal absent arrays,
LocalDateTimes are reduced to the minute (seconds dropped), Text is trimmed,
and the order of object keys is ignored. The preview's list of changed fields
uses the same normalization and contains only fields whose merged value
differs from the current value: person-owned values that the merge keeps
(notes, overridden fields, a `cancelled` status, an issue decision) are not
listed.

### 16.6 Settings, root issues, tombstones and meta

- **Settings** are person-owned: each differing setting is a row under
  "Settings", not taken unless the person ticks it. The preview marks the
  settings that the current schedule has never set (it uses the defaults)
  and offers to take those all at once.
- **Root issues** are taken from the file, except that an issue whose `id`
  matches a current issue with status `resolved` or `dismissed` keeps that
  status. Issues with a `date` are shown in that day's view.
- **Tombstones:** the file's `deleted` entries are unioned into the current
  list (for the same `id`, the current entry wins). An entry that names an
  item kept in the resulting schedule is not added (see "Kept (your version)"
  (c)).
- **Meta:** the website stores the file's `meta.title` and `meta.sources` and
  writes them back on export (§ 17). `meta.basedOn` and
  `meta.requestedChanges` are used only for this preview and are not stored.

## 17. How the website exports a file

- The export is a complete, valid 1.0 file of the current schedule.
- `meta.generator` is `{"name": "Academic Scheduler", "version": "<app version>"}`,
  `meta.generatedAt` is the export time (a LocalDateTime) and `meta.timezone`
  is the browser's IANA time zone; both MUST be written. Every export writes
  a fresh `meta.exportId` (`u-exp-<8 random characters>`) and remembers it,
  so that a file made from it can be recognized later (`meta.basedOn`,
  § 16.1). `meta.title` and `meta.sources` are those of the last import (if
  any). `meta.basedOn` and `meta.requestedChanges` are never written.
- `deleted` is written when it is not empty (at most 5000 entries).
- Every item includes `id`, `origin` and its other fields; `locked` is written
  only when `true`; `overrides` only when not empty; empty optional arrays are
  omitted (except the five root collections). Fields equal to their default
  may be written or omitted.
- LocalDateTimes are written as `YYYY-MM-DDTHH:MM:SS` (seconds `00`).
- Collections are sorted deterministically (classes by name; assignments by
  date then title; events and availability by start; blocks by start), then by
  `id`, so repeated exports of the same schedule are identical apart from
  `meta.generatedAt` and `meta.exportId`.
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

A full example is shipped as
[`examples/complete-schedule.json`](examples/complete-schedule.json) and is
reproduced below. It is the output of a `/academic-schedule` run on Sunday, Oct 11,
2026 at 7:30 PM (New York time). The inputs were the `schedule.json` the
person exported from the website (based on an earlier run on Friday, Oct 9
at 8:00 PM), a new English 10 Classroom export, the Biology syllabus, a photo
of the Biology whiteboard, and what the person said ("My piano theory exam is
Saturday, Oct 24, 9 to 11 AM; I want to do two past papers"). It shows:

- **Based on an export:** `meta.basedOn` is the `exportId` of the
  `schedule.json` the person exported; the English 10 class and its
  `meta.sources` entry record when the Classroom export was made
  (`retrievedAt`).
- **Protected items copied unchanged:** the person's Piano and Doctor
  appointment events, the After-school window, the library-books assignment
  and its block (`u-` IDs, `origin: "user"`), and the essay session on
  Wednesday that the person moved and lengthened to 70 minutes
  (`locked: true`; longer than `maxSessionMinutes`, which is fine for a locked
  block). The person's School event is unchanged except for the requested
  change below.
- **A requested change:** an English 10 announcement says there is no school
  on Monday, Oct 12, so the generator added that date to the School event's
  `exceptDates` and listed the event in `meta.requestedChanges` with
  `requestedByPerson: false`; the import offers the change unticked.
- **Items created from what the person said:** Fencing and Weekend mornings
  (said on Friday, Oct 9 without a start date, so they start on Monday,
  Oct 5), and the piano theory exam: an assignment plus a sitting event with
  `assignmentId`.
- **Person-owned data kept:** the essay's `notes`; `overrides: ["priority"]`
  on "Read Othello Act 3" (the person raised its priority); a `resolved`
  issue on the essay that is not raised again.
- **A tombstone:** the person deleted "Act 2 vocabulary crossword
  (optional)" on Oct 10. The new Classroom export still contains it, but the
  generator did not create it again.
- **`sourceState: "withdrawn"`:** an announcement cancelled Grammar
  worksheet 3; it has no planned blocks and 0 remaining minutes.
- **Classroom structure:** the Othello text (a Classroom material) is a class
  reference, not an assignment; Classroom topics on the class and its
  assignments.
- **A task checkpoint:** the outline (task `t2`) is due in class on Tuesday,
  Oct 13; its session is on Monday evening.
- **Totals that add up (§ 8.1):** every assignment's planned minutes equal its
  remaining minutes (essay 210, reading 50, biology test 150, theory exam
  120, library books 15).
- **Issues** (IDs per § 15.8): a `conflict` on the biology test (syllabus
  versus whiteboard photo, which is also in the test's `sources`) whose `id`
  ends with the date that was not used (`…:assessmentDate:20261023`), and a
  root `workload` issue with `itemId` and `date`.
- **Blocks:** session text in `description`; a past `done` block; IDs from
  two runs (`…-202610092000-N` from Oct 9, `…-202610111930-N` from this run).

```json
{
  "schemaVersion": "1.0",
  "meta": {
    "title": "Fall 2026 — Week of Oct 12",
    "generatedAt": "2026-10-11T19:30:00",
    "generator": { "name": "academic-schedule-skill", "version": "1.0" },
    "timezone": "America/New_York",
    "basedOn": "u-exp-h7w2c9qe",
    "sources": [
      { "kind": "schedule", "label": "schedule.json (exported from Academic Scheduler on Oct 11)" },
      { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "label": "English 10 - Period 3 - 2026-10-11.zip", "retrievedAt": "2026-10-11T18:05:00" },
      { "kind": "syllabus", "label": "Biology syllabus.pdf" },
      { "kind": "image", "label": "Biology whiteboard photo IMG_2041.jpg (Oct 9)" },
      { "kind": "user", "label": "Told /academic-schedule on 2026-10-11" }
    ],
    "requestedChanges": [
      { "id": "u-evt-7k2m9q4d", "reason": "An English 10 announcement (Oct 9) says there is no school on Monday, Oct 12 (Indigenous Peoples' Day). Added 2026-10-12 to the exception dates of your School event.", "requestedByPerson": false }
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
      "topics": ["Unit 2: Othello", "Grammar"],
      "references": [
        { "title": "Othello (Folger edition).pdf", "kind": "reading", "required": false, "path": "English 10 - Period 3/Materials/Othello full text/Attachments/Othello (Folger edition).pdf", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/m/NzAwMDAwMDAwMDA1/details" }
      ],
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5", "retrievedAt": "2026-10-11T18:05:00" }
    },
    {
      "id": "cls-biology",
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
      "topic": "Unit 2: Othello",
      "description": "Write a 1,200–1,500 word analytical essay on jealousy in Othello. MLA format, at least three quotations from Acts 1–3. Bring a printed outline to class on Tuesday, Oct 13.",
      "notes": "Ms. Rivera said quotations from Act 4 are fine too.",
      "due": "2026-10-16T23:59:00",
      "recommendedCompletionDate": "2026-10-15",
      "estimatedMinutes": 240,
      "estimateRange": { "min": 210, "max": 270 },
      "estimateConfidence": "medium",
      "estimateBasis": "Thesis and quotations 30 min, outline 30 min, draft of 1,200–1,500 words about 120 min, revision and MLA formatting 60 min.",
      "priority": "high",
      "status": "in_progress",
      "points": "100 points",
      "tasks": [
        { "id": "gc-NzAwMDAwMDAwMDAx-t1", "title": "Choose thesis and quotations", "estimatedMinutes": 30, "status": "done", "completedAt": "2026-10-10T10:30:00" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t2", "title": "Outline (printed copy due in class)", "estimatedMinutes": 30, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t1"], "recommendedCompletionDate": "2026-10-12", "due": "2026-10-13" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t3", "title": "Draft", "estimatedMinutes": 120, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t2"], "recommendedStartDate": "2026-10-13", "recommendedCompletionDate": "2026-10-14" },
        { "id": "gc-NzAwMDAwMDAwMDAx-t4", "title": "Revise, cite and format (MLA)", "estimatedMinutes": 60, "dependsOn": ["gc-NzAwMDAwMDAwMDAx-t3"], "recommendedCompletionDate": "2026-10-15" }
      ],
      "references": [
        { "title": "Essay rubric.pdf", "kind": "rubric", "required": true, "path": "English 10 - Period 3/Assignments/Othello Essay/Attachments/Essay rubric.pdf" }
      ],
      "issues": [
        { "id": "gc-NzAwMDAwMDAwMDAx:conflict:due:20261016", "kind": "conflict", "field": "due", "status": "resolved", "message": "Classroom shows Oct 16, 11:59 PM; the rubric says 'due Friday in class'. Using Oct 16, 11:59 PM (Classroom)." }
      ],
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAx", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAx/details" }
    },
    {
      "id": "gc-NzAwMDAwMDAwMDAy",
      "classId": "gc-class-NjI3ODk0MjE0NTQ5",
      "title": "Read Othello Act 3",
      "type": "reading",
      "topic": "Unit 2: Othello",
      "due": "2026-10-13",
      "estimatedMinutes": 50,
      "estimateRange": { "min": 40, "max": 60 },
      "estimateConfidence": "high",
      "estimateBasis": "Act 3 is about 25 pages of verse; 1.5–2.5 min per page.",
      "priority": "high",
      "status": "not_started",
      "overrides": ["priority"],
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAy", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAy/details" }
    },
    {
      "id": "gc-NzAwMDAwMDAwMDAz",
      "classId": "gc-class-NjI3ODk0MjE0NTQ5",
      "title": "Grammar worksheet 3: Commas",
      "type": "homework",
      "topic": "Grammar",
      "due": "2026-10-14T23:59:00",
      "estimatedMinutes": 25,
      "estimateRange": { "min": 20, "max": 30 },
      "estimateConfidence": "high",
      "estimateBasis": "20 short sentence-correction items.",
      "priority": "low",
      "status": "not_started",
      "sourceState": "withdrawn",
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDAz", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDAz/details" }
    },
    {
      "id": "biology-unit-2-test-cells-2026-10-16",
      "classId": "cls-biology",
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
        { "id": "biology-unit-2-test-cells-2026-10-16-t1", "title": "Review chapter 3 notes", "estimatedMinutes": 45 },
        { "id": "biology-unit-2-test-cells-2026-10-16-t2", "title": "Review chapter 4 notes", "estimatedMinutes": 45 },
        { "id": "biology-unit-2-test-cells-2026-10-16-t3", "title": "Practice questions and weak spots", "estimatedMinutes": 60, "dependsOn": ["biology-unit-2-test-cells-2026-10-16-t1", "biology-unit-2-test-cells-2026-10-16-t2"] }
      ],
      "issues": [
        { "id": "biology-unit-2-test-cells-2026-10-16:conflict:assessmentDate:20261023", "kind": "conflict", "field": "assessmentDate", "message": "The syllabus (p. 2) puts the Unit 2 test on Friday, Oct 16; the whiteboard photo from Friday, Oct 9 says 'Unit 2 test Fri 10/23'. Using Oct 16, the earlier date, so preparation is not late. Please confirm with Mr. Chen." }
      ],
      "origin": "generated",
      "source": { "kind": "syllabus", "label": "Biology syllabus.pdf, p. 2" },
      "sources": [
        { "kind": "image", "label": "Biology whiteboard photo IMG_2041.jpg (Oct 9)" }
      ]
    },
    {
      "id": "piano-theory-exam-2026-10-24",
      "title": "Piano theory exam",
      "type": "exam",
      "assessmentDate": "2026-10-24T09:00:00",
      "estimatedMinutes": 120,
      "estimateRange": { "min": 90, "max": 150 },
      "estimateConfidence": "medium",
      "estimateBasis": "You plan two timed past papers of about 60 minutes each.",
      "priority": "medium",
      "status": "not_started",
      "origin": "generated",
      "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-11" }
    },
    {
      "id": "u-asg-k3j9x2p1",
      "title": "Return library books",
      "type": "other",
      "due": "2026-10-15",
      "estimatedMinutes": 15,
      "priority": "low",
      "status": "not_started",
      "origin": "user"
    }
  ],
  "events": [
    {
      "id": "u-evt-7k2m9q4d",
      "title": "School",
      "category": "school",
      "startTime": "08:00",
      "endTime": "15:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-09-02", "endDate": "2027-06-18", "exceptDates": ["2026-10-12", "2026-11-26", "2026-11-27"] },
      "origin": "user"
    },
    {
      "id": "evt-fencing",
      "title": "Fencing",
      "category": "activity",
      "startTime": "16:00",
      "endTime": "18:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon"], "startDate": "2026-10-05" },
      "origin": "generated",
      "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-09" }
    },
    {
      "id": "u-evt-p4n0l7s2",
      "title": "Piano",
      "category": "activity",
      "startTime": "17:00",
      "endTime": "18:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["wed"], "startDate": "2026-09-09" },
      "origin": "user"
    },
    {
      "id": "u-evt-d8c3t5r1",
      "title": "Doctor appointment",
      "category": "appointment",
      "date": "2026-10-15",
      "startTime": "15:30",
      "endTime": "16:30",
      "origin": "user"
    },
    {
      "id": "evt-piano-theory-exam-2026-10-24",
      "title": "Piano theory exam",
      "category": "appointment",
      "assignmentId": "piano-theory-exam-2026-10-24",
      "date": "2026-10-24",
      "startTime": "09:00",
      "endTime": "11:00",
      "origin": "generated",
      "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-11" }
    }
  ],
  "availability": [
    {
      "id": "u-avl-a5f7t3r9",
      "label": "After school",
      "startTime": "15:30",
      "endTime": "21:30",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-09-02" },
      "origin": "user"
    },
    {
      "id": "avail-weekend-mornings-1000-1300",
      "label": "Weekend mornings",
      "startTime": "10:00",
      "endTime": "13:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["sat", "sun"], "startDate": "2026-10-05" },
      "origin": "generated",
      "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-09" }
    }
  ],
  "scheduleBlocks": [
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-1",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t1",
      "start": "2026-10-10T10:00:00",
      "end": "2026-10-10T10:30:00",
      "status": "done",
      "completedAt": "2026-10-10T10:30:00",
      "description": "Pick a thesis about jealousy and mark three quotations in Acts 1–3.",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAy-202610092000-1",
      "assignmentId": "gc-NzAwMDAwMDAwMDAy",
      "start": "2026-10-12T18:30:00",
      "end": "2026-10-12T19:20:00",
      "status": "planned",
      "description": "Read Act 3 (about 25 pages); mark where Iago plants suspicion.",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-2",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t2",
      "start": "2026-10-12T19:30:00",
      "end": "2026-10-12T20:00:00",
      "status": "planned",
      "description": "Outline: thesis and three body-paragraph claims, each with a quotation. Print it for class tomorrow.",
      "origin": "generated"
    },
    {
      "id": "blk-biology-unit-2-test-cells-2026-10-16-202610092000-1",
      "assignmentId": "biology-unit-2-test-cells-2026-10-16",
      "taskId": "biology-unit-2-test-cells-2026-10-16-t1",
      "start": "2026-10-13T15:30:00",
      "end": "2026-10-13T16:15:00",
      "status": "planned",
      "description": "Chapter 3 notes (cell structure); redo the section review questions.",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-3",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
      "start": "2026-10-13T16:30:00",
      "end": "2026-10-13T17:20:00",
      "status": "planned",
      "description": "Introduction and first body paragraph.",
      "origin": "generated"
    },
    {
      "id": "u-blk-m2c7q9za",
      "assignmentId": "u-asg-k3j9x2p1",
      "start": "2026-10-14T15:00:00",
      "end": "2026-10-14T15:15:00",
      "status": "planned",
      "origin": "user"
    },
    {
      "id": "blk-biology-unit-2-test-cells-2026-10-16-202610092000-2",
      "assignmentId": "biology-unit-2-test-cells-2026-10-16",
      "taskId": "biology-unit-2-test-cells-2026-10-16-t2",
      "start": "2026-10-14T15:30:00",
      "end": "2026-10-14T16:15:00",
      "status": "planned",
      "description": "Chapter 4 notes (membranes and transport); redo the section review questions.",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-4",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
      "start": "2026-10-14T18:15:00",
      "end": "2026-10-14T19:25:00",
      "status": "planned",
      "description": "Remaining body paragraphs and conclusion.",
      "locked": true,
      "origin": "generated"
    },
    {
      "id": "blk-biology-unit-2-test-cells-2026-10-16-202610092000-3",
      "assignmentId": "biology-unit-2-test-cells-2026-10-16",
      "taskId": "biology-unit-2-test-cells-2026-10-16-t3",
      "start": "2026-10-15T16:40:00",
      "end": "2026-10-15T17:40:00",
      "status": "planned",
      "description": "30-question practice set; reread the notes for every question you miss.",
      "origin": "generated"
    },
    {
      "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-5",
      "assignmentId": "gc-NzAwMDAwMDAwMDAx",
      "taskId": "gc-NzAwMDAwMDAwMDAx-t4",
      "start": "2026-10-15T17:50:00",
      "end": "2026-10-15T18:50:00",
      "status": "planned",
      "description": "Revise, add MLA citations and the Works Cited page, check formatting.",
      "origin": "generated"
    },
    {
      "id": "blk-piano-theory-exam-2026-10-24-202610111930-1",
      "assignmentId": "piano-theory-exam-2026-10-24",
      "start": "2026-10-17T10:00:00",
      "end": "2026-10-17T11:00:00",
      "status": "planned",
      "description": "Past paper 1, timed; mark it with the answer key.",
      "origin": "generated"
    },
    {
      "id": "blk-piano-theory-exam-2026-10-24-202610111930-2",
      "assignmentId": "piano-theory-exam-2026-10-24",
      "start": "2026-10-18T10:00:00",
      "end": "2026-10-18T11:00:00",
      "status": "planned",
      "description": "Past paper 2, timed; review the mistakes from both papers.",
      "origin": "generated"
    }
  ],
  "issues": [
    { "id": "workload:2026-10-15", "kind": "workload", "itemId": "u-evt-d8c3t5r1", "date": "2026-10-15", "message": "Thursday, Oct 15 is tight: after your doctor appointment (3:30–4:30 PM) there are 2 h of work (biology practice questions, then essay revision). If revision runs long, Thursday after 6:50 PM and Friday after school are still free; the essay is due Friday at 11:59 PM." }
  ],
  "deleted": [
    { "id": "gc-NzAwMDAwMDAwMDA0", "collection": "assignments", "deletedAt": "2026-10-10T16:12:00", "sourceId": "NzAwMDAwMDAwMDA0", "title": "Act 2 vocabulary crossword (optional)" }
  ]
}
```

## 19. Common mistakes

| Mistake | Correct |
| --- | --- |
| `"schemaVersion": 1.0` | `"schemaVersion": "1.0"` |
| `"due": "2026-10-16T23:59:00Z"` | `"due": "2026-10-16T23:59:00"` (local time, no `Z`) |
| `"generatedAt": "2026-10-11T23:30:00Z"` | `"generatedAt": "2026-10-11T19:30:00"` plus `"timezone": "America/New_York"` |
| `"due": "Oct 16"` | `"due": "2026-10-16"` |
| `"due": "2026-10-16"` when Classroom says `Oct 16, 11:59 PM` | `"due": "2026-10-16T23:59:00"` (write the time whenever the source states one) |
| `"startTime": "4:00 PM"` | `"startTime": "16:00"` |
| `"daysOfWeek": ["Monday"]` | `"daysOfWeek": ["mon"]` |
| `"estimatedMinutes": "45"` or `"60-75"` | `"estimatedMinutes": 70, "estimateRange": {"min": 60, "max": 75}` |
| `"estimateRange"` without `"estimatedMinutes"` | always both |
| lowering `estimatedMinutes` after work was done | keep the total; progress comes from task statuses and done blocks (§ 8.1) |
| `"status": "complete"` | `"status": "done"` |
| `"priority": "normal"` | `"priority": "medium"` |
| `"classId": "English 10"` (a name) | `"classId": "gc-class-NjI3ODk0MjE0NTQ5"` (an ID) |
| `"teacher": null` | omit the field |
| a quiz with `"due"` set to the quiz day | `"type": "quiz", "assessmentDate": "2026-10-20"` |
| a Classroom material turned into an assignment | a class or assignment reference with `"required": false` |
| a generator writing `"notes"` on a block | `"description"` (`notes` belongs to the person) |
| a generator editing a `user` or locked item silently | list it in `meta.requestedChanges` (§ 15.9) |
| re-creating an item listed in `deleted` | leave it out |
| deleting an assignment that vanished from Classroom | keep it with `"sourceState": "missing"` (§ 15.6) |
| `"origin": "planner"` on an assignment | `planner` exists only on schedule blocks |
| `"itemId"` inside an item's `issues` | only root issues have `itemId` |
| a block from 23:00 to 00:30 | two blocks: `"start": "2026-10-13T23:00:00", "end": "2026-10-14T00:00:00"` and 00:00–00:30 on the next date |
| `"endTime": "00:00"` for an event that ends at midnight | `"endTime": "24:00"` |
| `"due": "2026-10-16T23:59:59"` | `"due": "2026-10-16T23:59:00"` (seconds are always `00`) |
| a generator writing `meta.exportId` | write `meta.basedOn` (the input's `exportId`); only the website writes `exportId` |
| comments or text outside the JSON object | data only |

## 20. Changelog

| Version | Date | Changes |
| --- | --- | --- |
| 1.0 | 2026-10-07 | Initial version. |
