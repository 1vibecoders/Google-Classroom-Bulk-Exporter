# Planning work sessions

How to turn assignments, estimates, commitments and study time into schedule blocks that a student
can actually follow — and how to check the result. Planning follows fixed rules so that two runs
with the same inputs produce the same plan; judgment goes into the inputs (estimates, priorities,
spreading), not into ad-hoc placement.

## Contents

1. [Inputs](#1-inputs)
2. [Free time](#2-free-time)
3. [What to plan](#3-what-to-plan)
4. [Order](#4-order)
5. [Sessions](#5-sessions)
6. [Spreading work and assessment preparation](#6-spreading-work-and-assessment-preparation)
7. [Placing a session](#7-placing-a-session)
8. [When it does not fit](#8-when-it-does-not-fit)
9. [Block content and IDs](#9-block-content-and-ids)
10. [Sanity checks](#10-sanity-checks)
11. [Re-planning in update mode](#11-re-planning-in-update-mode)

## 1. Inputs

- `meta.generatedAt` ("now") and `meta.timezone`.
- `settings` (or their defaults): `minSessionMinutes` 20, `maxSessionMinutes` 60, `breakMinutes`
  10, `maxDailyStudyMinutes` none, `defaultDueTime` `00:00`. Use the person's settings from the
  input schedule. If the person states preferences ("at most 2 hours a day", "45-minute sessions"),
  apply them to this plan and, only if they ask to change their settings, change `settings` too.
- Events (busy unless `busy: false`), availability windows, existing blocks that stay.
- Assignments with remaining work (§ 8.1), their tasks, dependencies and dates.

If `availability` is empty and the person has not told you when they can study, ask first
(SKILL.md Step 9). Never assume "after school until 10 PM".

## 2. Free time

For each day from today to the horizon:

1. Union of that day's availability windows (recurring windows that occur that day — § 10
   recurrence rules, `exceptDates` included — and one-date windows).
2. Minus every busy event of that day: timed events by their times, a busy all-day event removes
   the whole day. Recurring events follow the same occurrence rules.
3. Minus the blocks that stay (user, locked, done, skipped, past, in-progress, and generated blocks
   you keep), each extended by `breakMinutes` on both sides.
4. Today: only the part after now, rounded up to the next 5 minutes.

`schedule_report.py` prints free time per day; use it to check your numbers.

## 3. What to plan

For each assignment, the **unscheduled minutes** of § 8.1: remaining minutes (done tasks and done
blocks subtracted) minus minutes of planned blocks that stay. Nothing for `done`/`cancelled` work,
`required: false` work (unless the person wants it), or `missing`/`withdrawn` work that is not in
progress.

With tasks, plan per task (each task's own remaining minutes) in dependency order, plus the
assignment's untasked remainder, if any.

## 4. Order

Each piece of work has a **deadline moment**:

- the assignment's `due` (date-only → `settings.defaultDueTime` that day; with the default `00:00`
  this means the end of the previous day), and/or its `assessmentDate` (date-only → 00:00 of that
  day) — the earlier of the two;
- a task's `due` checkpoint when earlier;
- a **target**: `recommendedCompletionDate` (end of that day) — plan to finish by then when possible.

Plan pieces in this order: earliest deadline first; ties → higher `priority` (urgent > high >
medium > low); then larger remaining work first; then ID. A piece is placed only after everything
it depends on (`dependsOn` of assignments and tasks) has been placed, and its sessions start after
the last session of those prerequisites.

## 5. Sessions

- Split a piece's minutes into `n = ceil(minutes / maxSessionMinutes)` sessions of nearly equal
  length, rounded to 5 minutes, each between `minSessionMinutes` and `maxSessionMinutes`.
  Example: 150 min with max 60 → 50 + 50 + 50, not 60 + 60 + 30.
- Work shorter than `minSessionMinutes` still gets one session of `minSessionMinutes` (the extra
  minutes are a buffer); shorter generated sessions make the validator warn.
- Keep `breakMinutes` between consecutive sessions. Break blocks (`kind: "break"`, `title:
  "Break"`) are optional; use them when the person likes to see breaks.
- At most `maxDailyStudyMinutes` of work blocks per day, counting the person's own blocks.
- Do not put more than about two different demanding subjects back to back without a longer break;
  alternate reading/writing with problem solving when a day has several sessions.

## 6. Spreading work and assessment preparation

Assessments influence the days **before** them. A "Biology exam Friday" is not "Study Biology —
Friday":

- Quiz: 1–2 sessions over the 1–3 days before.
- Unit test: 3–4 sessions over the 4–7 days before; the last one the day before; mix review of
  notes, practice questions and a final review of weak spots.
- Midterm / final / standardized test: sessions over 1–2 weeks, at most one session per subject per
  day, increasing slightly toward the date; a final review the day before.
- Never place preparation on the assessment day before a morning test; a block must end before the
  `assessmentDate` (date-only → 00:00 of that day).

Large work (essays, projects, labs, long readings):

- At most one or two sessions of the same assignment per day; follow the task order (outline before
  draft before revision).
- Finish by the `recommendedCompletionDate` (or, without one, about one day before a major
  deadline) so that something unexpected does not break the plan; small homework may be done on
  the last free day before its deadline.
- Respect task `due` checkpoints ("outline due in class Tuesday" → the outline session ends before
  Tuesday's deadline moment).
- Start no earlier than a task's `recommendedStartDate`.

Choose the days first (spread evenly over the available days between the start and the target),
then place each session on its day (§ 7). If a chosen day has no room, use the nearest earlier day
with room, then the nearest later day that still meets the target.

## 7. Placing a session

On a chosen day, put the session in the **earliest** free interval that is long enough (after
breaks), so that plans are predictable. Prefer not to start a demanding session in the last 30
minutes of the day's availability. Never place a session:

- in the past, in school hours, during a busy event, or outside the person's availability;
- after the piece's deadline moment or after the task's checkpoint;
- so that the day exceeds `maxDailyStudyMinutes`.

## 8. When it does not fit

Do not squeeze, shorten below what the evidence says, or plan after the deadline. Instead:

1. Plan what fits (earliest deadline first). Leave the rest unscheduled.
2. Add an issue with the numbers:
   - a day that is overloaded or a deadline that cannot be met: root issue
     `{"id": "workload:<date>", "kind": "workload", "date": "<date>", "message": "…"}` (with
     `itemId` when it is about a protected item), e.g. *"By Thursday, Oct 15 there are about 6 h of
     work due (essay revision, lab report, test preparation) but only 4 h 30 m of free study time.
     The lab report is 1 h 30 m short."*;
   - on a generated assignment that cannot be fully scheduled: an item issue
     `<assignmentId>:workload`.
3. In the summary, list the problem and options: study on a free weekend morning, start earlier,
   drop or postpone optional work, ask the teacher, or add study time. The person decides.

`schedule_report.py` checks feasibility as "earliest deadline first against free time": if the
cumulative remaining work due by a deadline exceeds the free time before it, the plan cannot work
without changes.

## 9. Block content and IDs

- `assignmentId` (and `taskId` when the session is for one task), `start`/`end` as LocalDateTimes
  on the same date (or ending at `00:00` of the next date), `origin: "generated"`.
- `description`: what exactly to do in this session — pages, problems, paragraphs, which part of a
  review sheet — written for the student: *"Problems 12–24 (even); check answers in the back."*
- Never `notes` (person-owned) and never `status` other than `planned` for new blocks.
- IDs: `blk-<assignmentId>-<YYYYMMDDHHMM of meta.generatedAt>-<N>`, N counting this run's blocks of
  that assignment (`ids.py block-id`). Blocks are never matched: each run's new sessions get new
  IDs; existing blocks keep theirs when moved.

## 10. Sanity checks

Run `schedule_report.py schedule.json --check` and read it like the student will live it:

- Every day: planned work ≤ free time after now, ≤ the daily maximum; nothing outside free time
  (except the person's own blocks).
- Every assignment that counts: unscheduled 0, or explained by a workload issue.
- Every upcoming quiz/test/exam/presentation has preparation sessions before it, on more than one
  day when it needs an hour or more.
- No block ends after its due, its assessment or its task checkpoint; dependencies are in order.
- Generated sessions within the session-length settings, with breaks between them.
- Weekly total is plausible for the person (compare with what they said; typical high-school
  homework is 1–3 hours on a school day). Late-night sessions only if their availability says so.
- The plan leaves some slack before big deadlines.

## 11. Re-planning in update mode

- Blocks that stay: `user`, locked, `done`, `skipped`, past and in-progress blocks, and generated
  blocks with `notes` (those may move but not disappear).
- Future, unlocked, `planned` blocks with origin `generated` or `planner` may be kept, moved (same
  ID, new times) or removed and replaced. Keep the ones that still fit the new situation, so the
  person's week does not change for no reason; re-plan only the work whose dates, estimates or
  remaining minutes changed, plus anything displaced by new commitments.
- A past `planned` block becomes `done` (with `completedAt`) or `skipped` only on evidence (e.g. the
  person says so). Otherwise leave it: it counts as not done, so its minutes return to the
  unscheduled work.
- Remove the future generated/planner blocks of assignments that became `missing` or `withdrawn`
  (not those with notes), and of work that is now `done`.
