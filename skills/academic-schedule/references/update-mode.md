# Updating an existing schedule (round trip with the website)

The person works with the schedule in the website (edits, marks work done, moves blocks, adds their
own items), exports `schedule.json`, and gives it to you with new materials. Your output is an
**updated copy of that file**: the website imports it, shows a preview of every change, and keeps
the person's data safe. The normative rules are § 15 of [SCHEDULE_FORMAT.md](SCHEDULE_FORMAT.md);
this page is the practical checklist and a worked example. When in doubt, the format wins.

## Contents

1. [The loop](#1-the-loop)
2. [Checklist](#2-checklist)
3. [What may change, item by item](#3-what-may-change-item-by-item)
4. [Matching before creating](#4-matching-before-creating)
5. [Worked example](#5-worked-example)
6. [Verify](#6-verify)

## 1. The loop

```
Classroom export ─▶ /academic-schedule ─▶ schedule.json ─▶ website (import, edit, mark done)
       ▲                                                          │
       └──── new export + exported schedule.json ◀── Export ◀─────┘
```

The exported file carries `meta.exportId` (e.g. `u-exp-k2v9w4xa`). Your file sets `meta.basedOn` to
that value; the website then knows which export you started from and can tell the person when
they changed something since. A file **without** `basedOn` is treated as a fresh file, so never
omit it in update mode.

## 2. Checklist

**Start from the input (§ 15.1)**

- [ ] Every item, task, tombstone (`deleted`) and root issue of the input is in the output with the
      same ID and the same values, unless a rule below allows the change.
- [ ] `meta.generatedAt` = now (local), `meta.timezone` = the input's, `meta.generator` = yours,
      `meta.basedOn` = the input's `meta.exportId` (or its `basedOn`), `meta.sources` = this run's
      inputs including the input schedule (`{"kind": "schedule", "label": "schedule.json (exported …)"}`),
      `meta.title` kept, **no** `meta.exportId`, `meta.requestedChanges` only for this run's changes.
- [ ] `settings` copied unchanged unless the person asked to change one (then say so in the summary:
      they must tick it in the import preview).
- [ ] `x-…` properties copied unchanged everywhere.

**Protect the person's data (§ 15.2)**

- [ ] Items with `origin: "user"` or `locked: true` (and the tasks of such assignments) are byte-for-
      byte the same — or listed in `meta.requestedChanges`.
- [ ] `notes`, `locked`, `overrides` and every overridden field's value unchanged on all items.
- [ ] Statuses never go backwards; `done` work keeps `done` and `completedAt`; `cancelled` stays.
- [ ] Issues the person resolved or dismissed are kept as they are and not raised again (same ID).

**Change only what the evidence changes (§ 15.4–15.6)**

- [ ] Generated, unlocked items: update a field only when the new source states a value (a source
      that omits a field, or gives a date without the time an earlier source gave, keeps the current
      value). An overridden field keeps the person's value; add a `conflict` issue if the source
      disagrees.
- [ ] Estimates: never lowered for progress; changed only on new evidence.
- [ ] Deadline moved earlier: also move the generator-owned dates ordered before it
      (`recommendedCompletionDate`, dates of generated unlocked tasks) so the file stays valid; if a
      person-owned date is in the way, keep the old deadline, add a conflict issue, and plan for the
      new one.
- [ ] Tasks: never moved to another assignment; removed only when generated, unlocked, not done and
      not referenced by a kept block — otherwise set `status: "cancelled"`. New tasks get
      `<assignmentId>-t<N>` with N above every number used so far (tombstones included).
- [ ] Vanished from a newer, complete export → `sourceState: "missing"`; explicitly cancelled →
      `"withdrawn"`. Never delete. Remove their future generated/planner planned unlocked blocks
      (not ones with notes). Protected assignment: write the new `sourceState` and list it in
      `requestedChanges` with `requestedByPerson: false`. Back in a later complete export → `"present"`.
- [ ] Only exports newer than the class's `source.retrievedAt` change anything; afterwards set the
      class's `source.retrievedAt` to the export time (unless the class is protected).

**Add without duplicating (§ 15.3, § 15.5)**

- [ ] Match every new item against the input and against what you already created (§ 4 below).
- [ ] Never create an item whose ID is in `deleted`, or whose source id equals a tombstone's
      `sourceId` (same collection), or (without a source id) whose normalized title equals a
      tombstone's title — unless the person asks for it now.

**Blocks (§ 15.7)**

- [ ] `done`, `skipped`, past, in-progress, `user` and locked blocks are unchanged (a past `planned`
      block may become `done`/`skipped` on evidence only).
- [ ] Future, unlocked, `planned` `generated`/`planner` blocks may move (same ID) or be removed and
      replaced — never the ones with `notes` (they may move).
- [ ] New blocks: `origin: "generated"`, new IDs from this run's `generatedAt`, `description`, no `notes`.

## 3. What may change, item by item

| Input item | Allowed in your output |
| --- | --- |
| `origin: "user"` (any collection), or `locked: true` | Nothing — unless listed in `meta.requestedChanges` (the change or the deletion). |
| Generated, unlocked class/assignment/event/availability | Generator-owned fields from new evidence, except overridden fields. Not deleted (assignments: `sourceState`; others: keep, optionally a `missing_information` issue). |
| Task of a protected assignment | Nothing (requested change only). |
| Generated, unlocked task of a generated assignment | Update; add; reorder; remove if not done and unreferenced, else `cancelled`. |
| Block `done` / `skipped` | Nothing. |
| Block past or in progress, `planned` | Only `status` → `done` (+ `completedAt`) or `skipped`, on evidence. |
| Block future, `planned`, generated/planner, unlocked | Move, replace, remove (not if it has `notes`; then only move). |
| Root issue resolved/dismissed | Nothing (dropped only if its `itemId` no longer exists). |
| Open issue you raised earlier | Update or remove if it no longer applies. |
| `deleted` | Copy; you may append entries for generated items you removed under these rules. |
| `settings` | Only on the person's request in this conversation. |

## 4. Matching before creating

Before creating a class, assignment, task, event or availability window, look for one that is the
same thing (in the input and among what you created in this run), in this order:

1. **Same ID**, when the ID comes from a source id (`gc-class-…`, `gc-…`) or is a recurring-work
   occurrence (`<series>-<date>`). For title-derived IDs (`cls-…`, `evt-…`, `avail-…`, document and
   personal items) an existing item with that ID matches only if rule 3 also holds; otherwise add a
   collision suffix (`-b`, `-c`).
2. **Same source**: same `source.kind` and `source.id` (or an entry of `sources`).
3. **Fallback**: same `classId` (or both none), same type family (quiz/test/exam/presentation vs
   everything else), same normalized title (`ids.py title-key`), and both undated or dates fewer
   than 7 days apart. Not for two different Classroom ids (except a re-post), not for recurring-work
   occurrences, not when only one has a date, not for the two parts of a split commitment.

On a match, reuse the existing ID and update under the rules above. If the match is protected: same
thing by rules 1–2 → leave it unchanged and add a root `conflict` issue with `itemId` when the
source differs; matched by rule 3 → create nothing and add a root `ambiguity` issue with `itemId`
("not added to avoid a duplicate"), unless the person asked to link them (then a requested change).

Typical cases:

- The syllabus lists "Unit 2 Test" on Oct 16 and Classroom has "Unit 2 Test: Cells" (same class,
  same week): one item; the Classroom item is the more specific source (ID and `source`), the
  syllabus goes to `sources`, an `ambiguity` issue names both titles.
- The person created "Biology lab" themselves (`u-asg-…`) and Classroom now has "Biology lab" due
  the same day: do not add a second one; root `ambiguity` issue with `itemId: "u-asg-…"`.
- "Reading log" this week and last week (two Classroom ids): two different assignments.

## 5. Worked example

**Input `schedule.json`** — exported by the website on Mon, Oct 12, 7:00 AM (New York), made from an
earlier `/academic-schedule` run (fragments; everything else as in the format's § 18.2 example):

```json
{
  "schemaVersion": "1.0",
  "meta": { "title": "Fall 2026", "generatedAt": "2026-10-12T07:00:00", "timezone": "America/New_York",
            "generator": { "name": "Academic Scheduler", "version": "1.0.0" }, "exportId": "u-exp-k2v9w4xa" },
  "classes": [ { "id": "gc-class-NjI3ODk0MjE0NTQ5", "name": "English 10", "origin": "generated",
                 "source": { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "retrievedAt": "2026-10-09T17:00:00" } } ],
  "assignments": [
    { "id": "gc-NzAwMDAwMDAwMDAx", "classId": "gc-class-NjI3ODk0MjE0NTQ5", "title": "Othello Essay", "type": "writing",
      "due": "2026-10-16T23:59:00", "estimatedMinutes": 240, "status": "in_progress",
      "notes": "Ms. Rivera said Act 4 quotations are fine.", "tasks": [ "… t1 done, t2–t4 …" ], "origin": "generated" },
    { "id": "gc-NzAwMDAwMDAwMDAy", "classId": "gc-class-NjI3ODk0MjE0NTQ5", "title": "Read Othello Act 3", "type": "reading",
      "due": "2026-10-12", "overrides": ["due"], "estimatedMinutes": 50, "origin": "generated" },
    { "id": "gc-NzAwMDAwMDAwMDAz", "classId": "gc-class-NjI3ODk0MjE0NTQ5", "title": "Grammar worksheet 3: Commas",
      "due": "2026-10-14T23:59:00", "estimatedMinutes": 25, "origin": "generated" },
    { "id": "u-asg-k3j9x2p1", "title": "Return library books", "due": "2026-10-15", "estimatedMinutes": 15, "origin": "user" }
  ],
  "events": [ { "id": "u-evt-7k2m9q4d", "title": "School", "category": "school", "startTime": "08:00", "endTime": "15:00",
                "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"], "startDate": "2026-09-02" },
                "origin": "user" } ],
  "scheduleBlocks": [
    { "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-1", "assignmentId": "gc-NzAwMDAwMDAwMDAx", "taskId": "gc-NzAwMDAwMDAwMDAx-t1",
      "start": "2026-10-10T10:00:00", "end": "2026-10-10T10:30:00", "status": "done", "completedAt": "2026-10-10T10:30:00" },
    { "id": "blk-gc-NzAwMDAwMDAwMDAz-202610092000-1", "assignmentId": "gc-NzAwMDAwMDAwMDAz",
      "start": "2026-10-13T16:00:00", "end": "2026-10-13T16:30:00", "description": "Worksheet 3, items 1–20." },
    { "id": "blk-gc-NzAwMDAwMDAwMDAx-202610092000-4", "assignmentId": "gc-NzAwMDAwMDAwMDAx", "taskId": "gc-NzAwMDAwMDAwMDAx-t3",
      "start": "2026-10-14T18:15:00", "end": "2026-10-14T19:25:00", "locked": true }
  ],
  "deleted": [ { "id": "gc-NzAwMDAwMDAwMDA0", "collection": "assignments", "deletedAt": "2026-10-10T16:12:00",
                 "sourceId": "NzAwMDAwMDAwMDA0", "title": "Act 2 vocabulary crossword (optional)" } ]
}
```

(The person moved the reading's due date to Oct 12 themselves — hence `overrides: ["due"]` — moved
and lengthened one essay session — hence `locked` — and deleted the optional crossword.)

**New inputs** (Mon, Oct 12, 12:00 PM): a new English 10 export (`exportedAt`
`2026-10-12T15:30:00Z` = 11:30 local; complete: announcements included, no warnings) and the
person: *"I have fencing on Mondays from 4 to 6."*

What the new export shows, and the decisions:

| Evidence | Decision |
| --- | --- |
| Essay: due now `Oct 17, 11:59 PM` (edited). | Generated, unlocked, `due` not overridden → `due: "2026-10-17T23:59:00"`. Keep `notes`, `status`, the done task and the locked block. Plan: no change needed (the existing sessions still fit). |
| Reading: due `Oct 14`. | `due` is overridden → keep `2026-10-12`; add item issue `gc-NzAwMDAwMDAwMDAy:conflict:due:20261014` ("Classroom now says Oct 14; you set Oct 12. Keeping Oct 12."). |
| Announcement "Worksheet 3 is cancelled." | `sourceState: "withdrawn"` on `gc-NzAwMDAwMDAwMDAz`; status unchanged; remove its future generated block `blk-gc-NzAwMDAwMDAwMDAz-202610092000-1`. |
| New assignment "Act 4 quiz", in class Tue, Oct 20 (Classroom item `NzAwMDAwMDAwMDEw`). | No match (§ 4) → new `gc-NzAwMDAwMDAwMDEw`, `type: "quiz"`, `assessmentDate: "2026-10-20"`, no `due`; estimate 30–45 → 40; two prep sessions on Sat 17 and Mon 19. |
| "Act 2 vocabulary crossword (optional)" still listed. | Tombstoned (ID and `sourceId`) → not created again. |
| Announcement "No school Friday, Oct 16 (teacher workday)." | The School event is the person's → add `2026-10-16` to its `exceptDates` **and** list it in `meta.requestedChanges` with `requestedByPerson: false`. |
| The person: fencing Mondays 4–6. | New `evt-fencing` (generated, `source.kind` `user`, label "Told /academic-schedule on 2026-10-12"), `startDate` = Monday of this week, `2026-10-12`, no `endDate`. Monday's 4–6 PM study time is now busy: no essay block was there, so nothing moves. |
| Class source. | `retrievedAt` → `2026-10-12T11:30:00` (the new export's time). |

**Output** (only the changed parts; everything else is copied exactly):

```json
{
  "meta": {
    "title": "Fall 2026",
    "generatedAt": "2026-10-12T12:00:00",
    "timezone": "America/New_York",
    "generator": { "name": "academic-schedule-skill", "version": "1.0" },
    "basedOn": "u-exp-k2v9w4xa",
    "sources": [
      { "kind": "schedule", "label": "schedule.json (exported from Academic Scheduler on Oct 12)" },
      { "kind": "google_classroom", "id": "NjI3ODk0MjE0NTQ5", "label": "English 10 - Period 3 - 2026-10-12.zip", "retrievedAt": "2026-10-12T11:30:00" },
      { "kind": "user", "label": "Told /academic-schedule on 2026-10-12" }
    ],
    "requestedChanges": [
      { "id": "u-evt-7k2m9q4d", "reason": "An English 10 announcement (Oct 12) says there is no school on Friday, Oct 16 (teacher workday). Added Oct 16 to the exception dates of your School event.", "requestedByPerson": false }
    ]
  },
  "assignments": [
    { "id": "gc-NzAwMDAwMDAwMDAx", "…": "unchanged except", "due": "2026-10-17T23:59:00" },
    { "id": "gc-NzAwMDAwMDAwMDAy", "…": "unchanged except",
      "issues": [ { "id": "gc-NzAwMDAwMDAwMDAy:conflict:due:20261014", "kind": "conflict", "field": "due",
                    "message": "Classroom now says Oct 14; you set Oct 12. Keeping Oct 12." } ] },
    { "id": "gc-NzAwMDAwMDAwMDAz", "…": "unchanged except", "sourceState": "withdrawn" },
    { "id": "gc-NzAwMDAwMDAwMDEw", "classId": "gc-class-NjI3ODk0MjE0NTQ5", "title": "Act 4 quiz", "type": "quiz",
      "assessmentDate": "2026-10-20", "estimatedMinutes": 40, "estimateRange": { "min": 30, "max": 45 },
      "estimateConfidence": "medium", "estimateBasis": "In-class quiz on Act 4 (about 30 pages): re-read notes and key scenes.",
      "origin": "generated",
      "source": { "kind": "google_classroom", "id": "NzAwMDAwMDAwMDEw", "url": "https://classroom.google.com/c/NjI3ODk0MjE0NTQ5/a/NzAwMDAwMDAwMDEw/details" } }
  ],
  "events": [
    { "id": "u-evt-7k2m9q4d", "…": "unchanged except", "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon","tue","wed","thu","fri"], "startDate": "2026-09-02", "exceptDates": ["2026-10-16"] } },
    { "id": "evt-fencing", "title": "Fencing", "category": "activity", "startTime": "16:00", "endTime": "18:00",
      "recurrence": { "frequency": "weekly", "daysOfWeek": ["mon"], "startDate": "2026-10-12" },
      "origin": "generated", "source": { "kind": "user", "label": "Told /academic-schedule on 2026-10-12" } }
  ],
  "scheduleBlocks": [
    "… the done block and the locked block exactly as before; the worksheet block removed …",
    { "id": "blk-gc-NzAwMDAwMDAwMDEw-202610121200-1", "assignmentId": "gc-NzAwMDAwMDAwMDEw",
      "start": "2026-10-17T10:00:00", "end": "2026-10-17T10:20:00", "origin": "generated",
      "description": "Act 4 quiz: re-read your Act 4 notes and the key scenes (4.1 and 4.3)." },
    { "id": "blk-gc-NzAwMDAwMDAwMDEw-202610121200-2", "assignmentId": "gc-NzAwMDAwMDAwMDEw",
      "start": "2026-10-19T18:30:00", "end": "2026-10-19T18:50:00", "origin": "generated",
      "description": "Act 4 quiz: quick self-test on characters and quotations." }
  ],
  "deleted": [ "… copied unchanged …" ]
}
```

(The `"…"` entries stand for "copied unchanged"; a real file contains the complete items.)

**Summary for the person:**

```
Schedule updated.
Added:
- English 10 / Act 4 quiz — Oct 20 (2 short review sessions: Sat 17, Mon 19)
- Fencing — Mondays 4–6 PM (from what you told me)
Updated:
- English 10 / Othello Essay: due Oct 16 → Oct 17, 11:59 PM (Classroom changed it)
- English 10 / Grammar worksheet 3: cancelled by Ms. Rivera; its session was removed
Scheduled:
- 2 new work sessions (40m); your other sessions are unchanged
Potential issue:
- Read Othello Act 3: Classroom now says Oct 14, but you set Oct 12. I kept Oct 12.
Please review in the import preview:
- "Changes to your items": no school on Fri, Oct 16 (added to your School event; not ticked by default).
```

## 6. Verify

```
python3 -I scripts/validate_schedule.py schedule.json --generator
python3 -I scripts/schedule_report.py schedule.json --previous input-schedule.json --check
```

The report's "UPDATE-RULE CHECK" must show 0 violations; read every "check:" line and make sure
each one is intended (for example a settings change the person asked for). Then compare the
report's "CHANGES" section with the summary you are about to write: they must agree.
