# Schedule-format test fixtures

Small schedule files that pin down what is valid and what is not under
[SCHEDULE_FORMAT.md](../../SCHEDULE_FORMAT.md) version 1.0. They are shared by
the website's tests (`tests/unit/schema-parity.test.ts`) and by the
`/academic-schedule` skill's Python validator
(`skills/academic-schedule/scripts/validate_schedule.py`), so both sides
enforce the same rules. The two shipped examples (`examples/*.json`) are
valid fixtures as well.

**Do not edit the JSON files by hand.** They are generated from one small
valid base document (`valid/base.json`) with one focused change each:

```
node tests/fixtures/build-fixtures.mjs
```

This also rewrites this README (the tables below come from the fixtures).

## Layout and metadata

- `valid/*.json` — must be accepted: no errors (warnings are allowed).
- `invalid/structural-*.json` — break a rule marked **[S]** in § 13: the
  JSON Schema (`schema/schedule-1.0.schema.json`, draft 2020-12) rejects
  them, and so must every validator.
- `invalid/semantic-*.json` — break only a rule marked **[V]** in § 13: the
  JSON Schema accepts them, every full validator must reject them.

Each file (except `structural-root-is-array.json`, whose root is `[]`)
describes itself in the root extension property `"x-fixture"` — legal in
every schedule file and ignored by readers:

```json
"x-fixture": {
  "kind": "valid" | "structural" | "semantic",
  "rule": "§ 13.3 rule 19",
  "description": "What the file checks",
  "expectedErrorPaths": ["scheduleBlocks[0].end"],
  "expectedWarningPaths": ["meta.timezone"]
}
```

A validator passes a fixture when it accepts every valid file and, for every
invalid file, reports at least one error at **each** of the
`expectedErrorPaths` (it may report more). Paths use the website's syntax:
`assignments[0].tasks[1].due`; property names that are not plain
identifiers in brackets (`assignments[0]["due date"]`); the root is `""`.
`expectedWarningPaths` (only in `valid/warnings-only.json`) lists where
the website reports § 13.4 warnings; warnings are advisory and need not match
exactly. Use **today = 2026-10-07** for the "more than 5 years away" warning.

## Points a Python validator must get right

- **Full-match patterns** (`re.fullmatch`): `"2026-10-05\n"` is not a
  Date (`structural-date-trailing-newline.json`); the `jsonschema`
  package alone accepts it.
- **Lengths in code points**: a 200-emoji title is valid
  (`valid/unicode-lengths.json`).
- **Integers**: `90.0` is the integer 90 (`valid/integer-with-decimal-point.json`),
  but `true` is not a number (`structural-minutes-boolean.json`,
  `structural-interval-boolean.json`; in Python `bool` is an `int`).
- **`null`** is invalid everywhere except inside `x-…` values
  (`valid/every-optional-field.json` has `null` and a `"__proto__"` key
  inside an `x-` value).
- **Real calendar dates** (`semantic-impossible-date.json`,
  `semantic-non-leap-year-february-29.json`, `valid/leap-day.json`).
- **Date comparisons (§ 13.3)**: when either value is a Date without a time,
  compare the dates only (`valid/date-only-and-date-time-comparisons.json`);
  both with times → compare date-times
  (`semantic-completion-after-due-same-day-times.json`).
- **Task dates vs. the assignment (rule 22)**: "≤ the later of due and
  assessmentDate" is checked as "not later than both of them"
  (`valid/task-dates-before-later-of-due-and-assessment.json`); a task's own
  `due` must additionally be ≤ the assignment's `due`. The § 9 chain
  `recommendedStartDate ≤ recommendedCompletionDate ≤ due` applies to each
  pair that is present (`semantic-task-start-after-task-due.json`).
- **Settings after defaults (rule 24)**: `{"dayStartTime": "23:00"}` and
  `{"minSessionMinutes": 100}` are invalid on their own.
- **Blocks (rule 19)**: end ≥ start + 5 min, on the start date or exactly
  00:00 of the next date.
- **Unsupported versions (§ 2)**: report one clear error and stop.

The website additionally rejects files over 10 MB and `x-…` values nested
more than 200 levels deep (it could not store them); these are limits of the
website, not format rules, so no fixture covers them.

## Valid files

| File | Rule | What it checks | Expected error paths |
| --- | --- | --- | --- |
| `valid/minimal.json` |  | The minimal valid file of § 18.1: five empty collections. |  |
| `valid/base.json` |  | The base document every other fixture is derived from. |  |
| `valid/every-optional-field.json` |  | Every optional field of every object type is present, with x- properties on every object (null and "__proto__" inside x- values are plain data). |  |
| `valid/midnight-end-times.json` |  | "24:00" end times (event, availability, settings.dayEndTime) and a block that ends at 00:00 of the next date. |  |
| `valid/date-only-and-date-time-comparisons.json` |  | Rules 21–22 compare dates only when either value has no time: these values count as equal, so the file is valid. |  |
| `valid/task-dates-before-later-of-due-and-assessment.json` |  | A task date may be later than the assignment's due as long as it is not later than its assessmentDate (the later of the two). |  |
| `valid/date-times-without-seconds.json` |  | LocalDateTimes may omit the seconds ("YYYY-MM-DDTHH:MM"). |  |
| `valid/unicode-lengths.json` |  | Lengths count Unicode code points: a 200-emoji title (400 UTF-16 units) is within the 200-character limit. |  |
| `valid/leap-day.json` |  | 2028-02-29 is a real calendar date. |  |
| `valid/protected-items-and-history.json` |  | User, locked and planner items, done/skipped blocks, tombstones, requested changes and root issues about tasks. |  |
| `valid/settings-extremes.json` |  | Settings at the edges of their ranges: minSessionMinutes = maxSessionMinutes, zero break and daily limit, 00:00–24:00 day. |  |
| `valid/empty-optional-arrays.json` |  | Empty optional arrays are allowed (they mean the same as absent). |  |
| `valid/warnings-only.json` |  | Valid, but every § 13.4 warning applies: blocks after due/task due/assessment, overlaps (block, busy event), session length, daily limit, a recurrence that never occurs, a far date, overrides on a user item, an unknown time zone. |  |
| `valid/integer-with-decimal-point.json` |  | Integers are JSON numbers without a fractional part: 90.0 is the integer 90 (Python: json.loads gives a float; accept it when it is whole). |  |
| `valid/multi-day-all-day-event.json` |  | A one-time all-day event spanning several days (endDate ≥ date), non-busy. |  |

## Structurally invalid files (the JSON Schema rejects them too)

| File | Rule | What it checks | Expected error paths |
| --- | --- | --- | --- |
| `invalid/structural-root-is-array.json` | § 13.1 rule 1 | The root must be an object. | `(root)` |
| `invalid/structural-schema-version-number.json` | § 2, § 13.1 rule 1 | schemaVersion must be the string "1.0", not the number 1.0. | `schemaVersion` |
| `invalid/structural-schema-version-unsupported-major.json` | § 2 | Major version 2 is not supported (single clear error). | `schemaVersion` |
| `invalid/structural-schema-version-newer-minor.json` | § 2 | Minor version 1.3 is newer than 1.0. | `schemaVersion` |
| `invalid/structural-schema-version-missing.json` | § 2 | schemaVersion is required. | `schemaVersion` |
| `invalid/structural-missing-collection.json` | § 13.1 rule 1 | All five collections are required. | `scheduleBlocks` |
| `invalid/structural-collection-not-array.json` | § 13.1 rule 1 | Collections are arrays. | `classes` |
| `invalid/structural-unknown-property.json` | § 13.1 rule 3 | Unknown properties are invalid ("dueDate" instead of "due"). | `assignments[0].dueDate` |
| `invalid/structural-uppercase-extension-prefix.json` | § 1, § 13.1 rule 3 | Only names starting with lowercase "x-" are extensions; "X-tool" is unknown. | `X-tool` |
| `invalid/structural-proto-key.json` | § 13.1 rule 3 | A "__proto__" property is just an unknown property (no prototype pollution). | `assignments[0].__proto__` |
| `invalid/structural-null-value.json` | § 1, § 13.1 rule 4 | null is not a valid value; omit the field instead. | `classes[0].teacher` |
| `invalid/structural-null-in-array.json` | § 13.1 rule 4 | null is not a valid array entry. | `assignments[0].tasks[1].dependsOn[0]` |
| `invalid/structural-id-with-space.json` | § 3 ID | IDs have no spaces. | `scheduleBlocks[0].id` |
| `invalid/structural-id-too-long.json` | § 3 ID | IDs have at most 100 characters. | `classes[0].id` |
| `invalid/structural-id-leading-dash.json` | § 3 ID | IDs start with a letter or digit. | `events[0].id` |
| `invalid/structural-date-us-format.json` | § 3 Date | "10/16/2026" is not a Date. | `assignments[0].due` |
| `invalid/structural-date-trailing-newline.json` | § 3 patterns (full match) | "2026-10-05\n" is not a Date: patterns must match the whole value (Python: re.fullmatch). | `events[0].recurrence.startDate` |
| `invalid/structural-date-with-time-in-date-field.json` | § 3 Date | recommendedStartDate is a Date, not a LocalDateTime. | `assignments[0].tasks[0].recommendedStartDate` |
| `invalid/structural-datetime-utc-z.json` | § 3 LocalDateTime, § 4 | Local date-times have no "Z". | `scheduleBlocks[0].start` |
| `invalid/structural-datetime-offset.json` | § 3 LocalDateTime, § 4 | Local date-times have no UTC offset. | `assignments[0].due` |
| `invalid/structural-datetime-nonzero-seconds.json` | § 3 seconds | Seconds must be ":00". | `assignments[0].due` |
| `invalid/structural-datetime-space-separator.json` | § 3 LocalDateTime | Date and time are separated by "T". | `meta.generatedAt` |
| `invalid/structural-time-24-00-as-start.json` | § 3 Time | "24:00" is only allowed as an end time. | `availability[0].startTime` |
| `invalid/structural-time-12-hour-clock.json` | § 3 Time | "4:00 PM" is not a Time. | `events[0].startTime` |
| `invalid/structural-end-time-24-30.json` | § 3 EndTime | "24:30" is not an EndTime. | `settings.dayEndTime` |
| `invalid/structural-weekday-full-name.json` | § 3 Weekday | "Tuesday" is not a Weekday. | `events[0].recurrence.daysOfWeek[0]` |
| `invalid/structural-recurrence-duplicate-days.json` | § 13.1 rule 5 | daysOfWeek values are unique. | `events[0].recurrence.daysOfWeek[1]` |
| `invalid/structural-recurrence-no-days.json` | § 13.1 rule 5 | daysOfWeek has at least one value. | `availability[0].recurrence.daysOfWeek` |
| `invalid/structural-recurrence-daily.json` | § 10 Recurrence | Only "weekly" exists in 1.0. | `events[0].recurrence.frequency` |
| `invalid/structural-recurrence-interval-zero.json` | § 10 Recurrence | interval is 1–52. | `events[0].recurrence.interval` |
| `invalid/structural-minutes-fraction.json` | § 3 Minutes | Minutes are whole numbers. | `assignments[0].estimatedMinutes` |
| `invalid/structural-minutes-string.json` | § 3 Minutes | Minutes are numbers, not strings. | `assignments[0].estimatedMinutes` |
| `invalid/structural-minutes-negative.json` | § 3 Minutes | Minutes are 0–10000. | `assignments[0].tasks[0].estimatedMinutes` |
| `invalid/structural-minutes-too-large.json` | § 3 Minutes | Minutes are 0–10000. | `assignments[0].estimatedMinutes` |
| `invalid/structural-minutes-boolean.json` | § 3 Minutes | true is not a number (Python: bool is a subclass of int; reject it). | `assignments[0].estimatedMinutes` |
| `invalid/structural-interval-boolean.json` | § 10 Recurrence | interval is an integer, not a boolean. | `events[0].recurrence.interval` |
| `invalid/structural-url-javascript.json` | § 3 URL | Only http: and https: URLs are allowed. | `assignments[0].references[0].url` |
| `invalid/structural-url-relative.json` | § 3 URL | URLs are absolute. | `assignments[0].source.url` |
| `invalid/structural-enum-status-complete.json` | § 8 status | "complete" is not a status ("done"). | `assignments[0].status` |
| `invalid/structural-enum-priority-normal.json` | § 8 priority | "normal" is not a priority ("medium"). | `assignments[0].priority` |
| `invalid/structural-enum-source-kind.json` | § 5 Source | Unknown source kind. | `assignments[0].source.kind` |
| `invalid/structural-title-too-long.json` | § 8 title | title has at most 200 characters. | `assignments[0].title` |
| `invalid/structural-title-empty.json` | § 8 title | A required Text is not empty. | `assignments[0].tasks[1].title` |
| `invalid/structural-boolean-as-string.json` | § 10 busy | Booleans are true/false, not strings. | `events[0].busy` |
| `invalid/structural-color-short-hex.json` | § 3 Color | Colors are #RRGGBB. | `classes[0].color` |
| `invalid/structural-event-date-and-recurrence.json` | § 13.1 rule 5 | An event has date or recurrence, not both. | `events[0].recurrence` |
| `invalid/structural-event-neither-date-nor-recurrence.json` | § 13.1 rule 5 | An event needs date or recurrence. | `events[0]` |
| `invalid/structural-event-all-day-with-times.json` | § 13.1 rule 5 | An all-day event has no startTime/endTime. | `events[0].startTime`, `events[0].endTime` |
| `invalid/structural-event-missing-end-time.json` | § 13.1 rule 5 | A timed event needs startTime and endTime. | `events[0].endTime` |
| `invalid/structural-event-end-date-not-all-day.json` | § 13.1 rule 5 | endDate only on all-day one-time events. | `events[0].endDate` |
| `invalid/structural-event-end-date-with-recurrence.json` | § 13.1 rule 5 | endDate requires date. | `events[0].endDate` |
| `invalid/structural-availability-date-and-recurrence.json` | § 13.1 rule 5 | Availability has date or recurrence, not both. | `availability[0].recurrence` |
| `invalid/structural-availability-missing-start.json` | § 11 | startTime is required. | `availability[0].startTime` |
| `invalid/structural-block-without-assignment-or-title.json` | § 13.1 rule 6 | A block needs an assignmentId or a title. | `scheduleBlocks[0]` |
| `invalid/structural-block-break-with-assignment.json` | § 13.1 rule 6 | A break has a title and no assignmentId. | `scheduleBlocks[0].assignmentId` |
| `invalid/structural-block-task-without-assignment.json` | § 13.1 rule 6 | taskId requires assignmentId. | `scheduleBlocks[0].taskId` |
| `invalid/structural-completed-at-without-done.json` | § 13.1 rule 7 | completedAt only when status is "done". | `assignments[0].tasks[0].completedAt` |
| `invalid/structural-completed-at-with-skipped-block.json` | § 13.1 rule 7 | completedAt only when status is "done". | `scheduleBlocks[0].completedAt` |
| `invalid/structural-estimate-range-without-estimate.json` | § 13.1 rule 8 | estimateRange requires estimatedMinutes. | `assignments[0].estimatedMinutes` |
| `invalid/structural-estimate-range-missing-max.json` | § 8 estimateRange | estimateRange has min and max. | `assignments[0].estimateRange.max` |
| `invalid/structural-origin-planner-on-assignment.json` | § 13.1 rule 9 | "planner" only on schedule blocks. | `assignments[0].origin` |
| `invalid/structural-item-issue-with-item-id.json` | § 13.1 rule 10 | itemId only on root issues. | `assignments[0].issues[0].itemId` |
| `invalid/structural-issue-missing-message.json` | § 5 Issue | Issues need a message. | `issues[0].message` |
| `invalid/structural-overrides-person-owned-field.json` | § 13.1 rule 11 | "notes" can never be listed in overrides. | `assignments[0].overrides[0]` |
| `invalid/structural-overrides-duplicate.json` | § 13.1 rule 11 | overrides entries are unique. | `assignments[0].overrides[1]` |
| `invalid/structural-overrides-wrong-item-type.json` | § 13.1 rule 11 | "title" is not a field of a class. | `classes[0].overrides[0]` |
| `invalid/structural-task-with-source.json` | § 6 | Tasks have no source. | `assignments[0].tasks[0].source` |
| `invalid/structural-too-many-sources.json` | § 6 sources | sources has at most 20 entries. | `classes[0].sources` |
| `invalid/structural-settings-out-of-range.json` | § 5 Settings | minSessionMinutes is 5–240. | `settings.minSessionMinutes` |
| `invalid/structural-settings-unknown-field.json` | § 5 Settings | Unknown settings field. | `settings.theme` |
| `invalid/structural-generator-without-name.json` | § 5 Meta | meta.generator needs a name. | `meta.generator.name` |
| `invalid/structural-requested-change-missing-reason.json` | § 5 Requested change | A requested change needs a reason. | `meta.requestedChanges[0].reason` |
| `invalid/structural-tombstone-bad-collection.json` | § 5 Deleted item | collection is one of the six collection names. | `deleted[0].collection` |
| `invalid/structural-task-depends-on-duplicate.json` | § 9 dependsOn | dependsOn entries are unique. | `assignments[0].tasks[1].dependsOn[1]` |

## Semantically invalid files (the JSON Schema accepts them; a § 13 [V] rule rejects them)

| File | Rule | What it checks | Expected error paths |
| --- | --- | --- | --- |
| `invalid/semantic-impossible-date.json` | § 13.1 rule 12 | 2026-02-30 matches the pattern but is not a real date. | `assignments[0].due` |
| `invalid/semantic-non-leap-year-february-29.json` | § 13.1 rule 12 | 2027 is not a leap year. | `scheduleBlocks[0].start`, `scheduleBlocks[0].end` |
| `invalid/semantic-impossible-issue-date.json` | § 13.1 rule 12 | November has 30 days. | `issues[0].date` |
| `invalid/semantic-blank-title.json` | § 13.1 rule 12 | A required Text must contain a non-whitespace character. | `assignments[0].title` |
| `invalid/semantic-blank-requested-change-reason.json` | § 13.1 rule 12 | reason must contain a non-whitespace character. | `meta.requestedChanges[0].reason` |
| `invalid/semantic-duplicate-id-across-collections.json` | § 13.2 rule 13 | An event uses the ID of a class. | `events[0].id` |
| `invalid/semantic-duplicate-task-id.json` | § 13.2 rule 13 | Two tasks of different assignments share an ID. | `assignments[1].tasks[0].id` |
| `invalid/semantic-tombstone-id-in-use.json` | § 13.2 rule 14 | No item may use an ID listed in deleted. | `events[0].id` |
| `invalid/semantic-duplicate-tombstone.json` | § 13.2 rule 14 | deleted IDs are unique. | `deleted[1].id` |
| `invalid/semantic-duplicate-issue-id.json` | § 13.2 rule 15 | Issue IDs are unique among all issues (root and item issues). | `assignments[0].issues[0].id` |
| `invalid/semantic-duplicate-requested-change.json` | § 13.2 rule 16 | requestedChanges IDs are unique. | `meta.requestedChanges[1].id` |
| `invalid/semantic-unknown-class.json` | § 13.2 rule 17 | classId must reference an existing class. | `assignments[0].classId` |
| `invalid/semantic-class-id-names-an-assignment.json` | § 13.2 rule 17 | classId must name a class, not an item of another collection. | `events[0].classId` |
| `invalid/semantic-event-unknown-assignment.json` | § 13.2 rule 17 | An event's assignmentId must exist. | `events[0].assignmentId` |
| `invalid/semantic-block-unknown-assignment.json` | § 13.2 rule 17 | A block's assignmentId must exist. | `scheduleBlocks[0].assignmentId` |
| `invalid/semantic-block-task-of-other-assignment.json` | § 13.2 rule 17 | A block's taskId must be a task of its own assignment. | `scheduleBlocks[0].taskId` |
| `invalid/semantic-assignment-depends-on-self.json` | § 13.2 rule 17 | An assignment cannot depend on itself. | `assignments[0].dependsOn[0]` |
| `invalid/semantic-assignment-depends-on-unknown.json` | § 13.2 rule 17 | dependsOn references existing assignments. | `assignments[0].dependsOn[0]` |
| `invalid/semantic-assignment-dependency-cycle.json` | § 13.2 rule 18 | Assignments depend on each other in a cycle. | `assignments[0].dependsOn` |
| `invalid/semantic-task-depends-on-other-assignment-task.json` | § 13.2 rule 17 | Tasks depend only on tasks of the same assignment. | `assignments[1].tasks[0].dependsOn[0]` |
| `invalid/semantic-task-dependency-cycle.json` | § 13.2 rule 18 | Tasks depend on each other in a cycle. | `assignments[0].tasks[0].dependsOn` |
| `invalid/semantic-root-issue-unknown-item.json` | § 13.2 rule 17 | A root issue's itemId must name an existing item. | `issues[0].itemId` |
| `invalid/semantic-block-shorter-than-5-minutes.json` | § 13.3 rule 19 | A block lasts at least 5 minutes. | `scheduleBlocks[0].end` |
| `invalid/semantic-block-crosses-midnight.json` | § 13.3 rule 19 | A block ends on its start date or at 00:00 of the next date. | `scheduleBlocks[0].end` |
| `invalid/semantic-block-ends-midnight-two-days-later.json` | § 13.3 rule 19 | Only 00:00 of the NEXT date is allowed. | `scheduleBlocks[0].end` |
| `invalid/semantic-block-end-before-start.json` | § 13.3 rule 19 | end is after start. | `scheduleBlocks[0].end` |
| `invalid/semantic-event-end-before-start.json` | § 13.3 rule 20 | endTime is later than startTime. | `events[0].endTime` |
| `invalid/semantic-event-midnight-as-00-00.json` | § 13.3 rule 20, § 19 | An event ending at midnight uses "24:00", not "00:00". | `events[0].endTime` |
| `invalid/semantic-availability-end-equals-start.json` | § 13.3 rule 20 | endTime is later than startTime (not equal). | `availability[0].endTime` |
| `invalid/semantic-event-end-date-before-date.json` | § 13.3 rule 20 | endDate ≥ date. | `events[0].endDate` |
| `invalid/semantic-recurrence-end-before-start.json` | § 13.3 rule 20 | recurrence endDate ≥ startDate. | `availability[0].recurrence.endDate` |
| `invalid/semantic-completion-after-due.json` | § 13.3 rule 21 | recommendedCompletionDate ≤ due. | `assignments[0].recommendedCompletionDate` |
| `invalid/semantic-completion-after-due-same-day-times.json` | § 13.3 rule 21 | Both values have a time, so they are compared as date-times. | `assignments[0].recommendedCompletionDate` |
| `invalid/semantic-completion-after-assessment.json` | § 13.3 rule 21 | Without due, recommendedCompletionDate ≤ assessmentDate. | `assignments[0].recommendedCompletionDate` |
| `invalid/semantic-task-start-after-completion.json` | § 13.3 rule 22 | recommendedStartDate ≤ recommendedCompletionDate. | `assignments[0].tasks[0].recommendedStartDate` |
| `invalid/semantic-task-completion-after-task-due.json` | § 13.3 rule 22 | A task's recommendedCompletionDate ≤ its due. | `assignments[0].tasks[0].recommendedCompletionDate` |
| `invalid/semantic-task-start-after-task-due.json` | § 9, § 13.3 rule 22 | recommendedStartDate ≤ recommendedCompletionDate ≤ due "each when present" (§ 9): a start after the task's due is invalid even without a recommendedCompletionDate. | `assignments[0].tasks[0].recommendedStartDate` |
| `invalid/semantic-task-due-after-assignment-due.json` | § 13.3 rule 22 | A task's due ≤ the assignment's due. | `assignments[0].tasks[1].due` |
| `invalid/semantic-task-date-after-assessment.json` | § 13.3 rule 22 | Task dates ≤ the assignment's due/assessmentDate. | `assignments[0].tasks[1].recommendedCompletionDate` |
| `invalid/semantic-estimate-outside-range.json` | § 13.3 rule 23 | min ≤ estimatedMinutes ≤ max. | `assignments[0].estimatedMinutes` |
| `invalid/semantic-estimate-range-min-above-max.json` | § 13.3 rule 23 | estimateRange.min ≤ estimateRange.max. | `assignments[0].tasks[0].estimateRange` |
| `invalid/semantic-settings-day-start-after-default-end.json` | § 13.3 rule 24 | dayStartTime 23:00 is after the default dayEndTime 22:00 (checked after defaults). | `settings.dayStartTime` |
| `invalid/semantic-settings-min-session-above-default-max.json` | § 13.3 rule 24 | minSessionMinutes 100 is above the default maxSessionMinutes 60. | `settings.minSessionMinutes` |
| `invalid/semantic-settings-day-end-before-start.json` | § 13.3 rule 24 | dayEndTime must be later than dayStartTime. | `settings.dayEndTime` |
