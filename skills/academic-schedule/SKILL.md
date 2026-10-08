---
name: academic-schedule
description: Builds or updates a realistic study and homework schedule as a schedule.json file for the Academic Scheduler website, from Google Classroom exports (single-class or Export-all-classes ZIPs), syllabi, assignment sheets, rubrics, school and exam calendars, screenshots and what the student says about their commitments and free time. Use when someone asks to plan their schoolwork or study time, turn a Classroom export into a schedule, schedule assignments and test preparation, or update an existing schedule.json after their classes or plans changed.
argument-hint: "[text] [what to plan: files, notes, or 'update']"
effort: xhigh
---

# Academic schedule

You turn a student's academic materials into one machine-readable schedule file that the
**Academic Scheduler** website imports, plus a short summary for the person. The website has no AI:
everything that needs judgment (what an assignment requires, when tests are, how long work takes,
when to do it) is decided here, by you, from evidence.

**Output contract**

1. A file (default `schedule.json`, or the name/location the person asks for) that conforms exactly
   to [references/SCHEDULE_FORMAT.md](references/SCHEDULE_FORMAT.md), version `"1.0"`. Data only: no
   comments, no prose outside the fields made for text (`description`, `estimateBasis`,
   `issues[].message`, `requestedChanges[].reason`, labels). Always write the file; JSON pasted in
   the chat is only ever an extra copy of it.
2. A concise summary in chat in the format of [Step 13](#step-13--tell-the-person).
3. When asked, the schedule as text in the chat, made from the validated file by
   `render_schedule.py` ([Showing the schedule in the chat](#showing-the-schedule-in-the-chat)).

## Work with Extra effort

**Use Extra effort for this task. Correctness matters far more than speed.** Take the time
necessary to thoroughly inspect every piece of material before you build the schedule:

- Read every assignment description in full and every attachment that could matter, including
  long PDFs, slides, rubrics, syllabi and spreadsheets. Do not make a shallow pass over file names
  and assignment titles: a title like "Unit 3 packet" tells you nothing about the work.
- Dates, page ranges, question counts, word counts, test announcements and cancellations are often
  buried inside documents and announcements. Find them.
- Work class by class when the material is large, but do not skip or sample. Keep a coverage ledger
  (items read / total, attachments read / total, unreadable files with the reason) and do not start
  planning until every item has been read or is explicitly recorded as unreadable.
- Prefer re-reading a source to guessing. When the evidence is genuinely ambiguous, keep the
  uncertainty (an issue in the file and a question for the person) instead of inventing an answer.

## Never do these

- Guess dates, or a year that the evidence does not support.
- Invent assignments, teacher requirements, commitments or study time.
- Treat every attachment as required work, or reference material (Classroom materials, slides,
  "for reference" links) as homework.
- Ignore information buried in PDFs, images or announcements.
- Confuse an assessment date (when a test happens) with a due date (when work is submitted).
- Schedule impossible workloads (more work than free time, sessions in school hours or after a
  deadline). Report the overload instead.
- Overwrite completed work, the person's own items, their notes or their decisions.
- Create duplicates of items that already exist (match before creating).
- Write `notes` (person-owned), `meta.exportId` (website-only), `u-` IDs or `planner` items.

## Tools

The scripts are in the `scripts/` folder next to this SKILL.md (Python 3.8+, standard library).
In Claude Code run them as `python3 -I "${CLAUDE_SKILL_DIR}/scripts/<name>.py" …`; elsewhere use the
path of the `scripts/` folder of this skill. Inputs are only read as data; nothing from them runs.

| Script | Use it to |
| --- | --- |
| `inventory.py INPUT... [--timezone ZONE] [--workdir DIR]` | Extract ZIPs safely, list every class, item, attachment and document, extract text into `<workdir>/text/`, infer Classroom years, recognize `schedule.json` files. Writes `inventory.txt` (complete) and `inventory.json`. |
| `validate_schedule.py FILE --generator` | Check every rule of the format (same rules as the website) plus generator rules. Exit 0 = valid. |
| `schedule_report.py FILE [--previous OLD] --check` | Free vs planned time per day, overloads, remaining and unscheduled work (§ 8.1), missing test prep, blocks after deadlines, order problems, feasibility; with `--previous`: changes and update-rule violations; a draft summary. |
| `ids.py COMMAND …` | Derive IDs, slugs, issue IDs and point estimates exactly as § 14.1 / § 15.8 / § 8 define them. |
| `render_schedule.py FILE [--from DATE] [--days N] [--view VIEW]` | Show a valid file as plain text for the chat: week overview, day agendas, assignments with remaining work, open issues (the website's rules). Exit 2 = invalid file, nothing shown. |

If Python is not available, do the same checks by hand with the rules in the references.

## Procedure

### Step 1 — Clock, time zone, scope

- "Now" is the current time in the person's time zone: the input schedule's `meta.timezone`, else a
  zone the person gives, else ask (or assume one and state the assumption in the summary). Write it
  as `meta.generatedAt` (a LocalDateTime, no `Z`) and `meta.timezone`.
- Planning horizon: through the latest known deadline, at least the next two weeks, unless the
  person asks otherwise. Recurring academic work: the next 3 weeks.
- Is there an existing `schedule.json` (from the website's Export)? Then this is **update mode**
  (Step 11) and the output is an updated copy of that file, never a fresh one.

### Step 2 — Inventory every input

1. Run `inventory.py` on **all** inputs at once (Classroom ZIPs including account-wide ones,
   extracted folders, syllabi, calendars, PDFs, DOCX, images, existing `schedule.json`) with
   `--timezone`. Read `inventory.txt` completely.
2. Write down the full input list: classes (including classes the export lists as not exported),
   items per class, other documents, images, schedule files, and **what the person said in the
   conversation** (commitments, availability, preferences, corrections, priorities). The
   conversation is an input too.
3. Files the script cannot read (images, scanned PDFs, legacy Office files, PDFs without
   `pdftotext`) must be opened and read directly.
4. Note gaps: classes that failed or were exported partially, attachments that could not be
   downloaded, announcements not included, item pages not read, a missing syllabus the
   instructions mention. They become questions or `missing_information` issues later.

How to read the export files, every relevant field and their pitfalls:
[references/classroom-export.md](references/classroom-export.md).

### Step 3 — Read everything relevant, thoroughly

For each class, for each item (assignments, questions, other coursework, **materials and
announcements too**): read `description.txt` in full, then every attachment (the extracted text
file, or the file itself). Then read every other document (syllabus, calendars, rubrics, assignment
sheets, handbook pages, photos of whiteboards or planners). Update the coverage ledger as you go.
Announcements and materials matter because they move dates, cancel work, announce tests and assign
readings.

### Step 4 — Extract the facts, per class

Keep working notes (not in the output) with, for every class: class name; teacher (if stated);
course/topic structure (units, topics); assignments; materials; assessments (quizzes, tests, exams,
presentations) with their dates; due dates; test and quiz dates; project deadlines and milestones;
reading requirements (chapters, page ranges); writing requirements (length, format, citations);
problem sets (which problems, how many); labs; presentations; study requirements; submission
requirements (what, where, format); required files and templates; important instructions; and
dependencies between pieces of work. Record the evidence for each fact (file and quote).

### Step 5 — Classify with these rules

**Three different dates — never interchange them:**

| Field | Meaning | Typical evidence |
| --- | --- | --- |
| `due` | Submission deadline | Classroom "Due Oct 16, 11:59 PM"; "turn in by Friday" |
| `assessmentDate` | When a quiz/test/exam/presentation **takes place** | "Unit 2 test Friday", syllabus exam dates |
| `recommendedCompletionDate` | A planning target before the deadline (soft) | "have the draft done by Wednesday", your own plan |

- An in-class quiz/test/exam: `type` quiz/test/exam with `assessmentDate`, normally **no** `due`.
  An online quiz with a deadline and no sitting: `due` and no `assessmentDate`. A presentation:
  `assessmentDate` (plus `due` only if slides must be submitted earlier).
- A step with its own hard deadline ("bring your outline Tuesday") is a task `due` checkpoint.
- Write a time whenever the source states one (`Oct 16, 11:59 PM` → `2026-10-16T23:59:00`); a Date
  only when no time is stated. Year-less Classroom dates: use the inventory's inference, check it
  against the context, and add an `ambiguity` issue when two years are plausible.

**Required vs optional vs reference:**

- A Classroom **Material**, or an **Announcement** that asks for no work, is never an assignment:
  add it as a `references` entry (`required: false`) of the class or of the assignment it supports.
- An announcement yields an assignment only for work it announces ("Read chapter 5 for Monday"),
  with the derived ID `gc-<itemId>-<slug(title)>`. A cancellation ("Worksheet 3 is cancelled") sets
  that assignment's `sourceState: "withdrawn"`. "No school Monday" is a change to the person's
  School event (Step 11, requested change, `requestedByPerson: false`).
- Optional / extra-credit work: `required: false` (not planned unless the person wants it).
- An attachment is required work only when the instructions require using or submitting it
  (rubric to follow, template to fill, reading assigned). Otherwise it is a reference.
- Recurring academic work ("vocab quiz every Friday"): one dated assignment per occurrence within
  the horizon, IDs `<seriesSlug>-<YYYY-MM-DD>`.

### Step 6 — Cross-reference and resolve conflicts

Compare every source that describes the same work or date: Classroom fields, the item's own
text, later announcements, the syllabus, school and exam calendars, photos, and what the person
said. Several sources about one thing become **one** item (other sources in `sources`).

- Use the most authoritative and explicit source: a later explicit statement by the teacher (an
  announcement or edited item) over an earlier one; the Classroom due field over a vague mention
  ("due Friday"); a dated school calendar over a guess; the person's statements about their own
  life over documents.
- **Never choose silently.** Record every disagreement as a `conflict` issue naming both values,
  which one you used and why (ID per § 15.8, ending with the value *not* used). If you cannot tell
  which is right, plan for the earlier date (so preparation is never late) and ask.

### Step 7 — Estimate workload from evidence

Follow [references/workload-estimation.md](references/workload-estimation.md): count pages,
problems, words, questions, stages; apply the per-unit ranges; use the teacher's estimate when
given. Write `estimatedMinutes` (total effort including work already done), `estimateRange`,
`estimateConfidence` and `estimateBasis` (the evidence, e.g. "25 pages of verse at 1.5–2.5 min/page
+ 12 short answers at 4–6 min"). Point estimate from a range: midpoint rounded up to a multiple of
5 (`ids.py estimate MIN MAX`). Ask when the scope is genuinely unknown and it matters.

### Step 8 — Break down multi-step work

Give tasks only to work that is multi-step, multi-day (more than one session) or has checkpoints:
a research paper → choose topic, find sources, read sources, thesis, outline, draft, revise,
proofread, submit. Each task: `estimatedMinutes`, `dependsOn` (tasks of the same assignment),
`recommendedStartDate` / `recommendedCompletionDate`, and `due` for hard checkpoints. Typically 3–8
tasks; simple homework has none — do not split a 30-minute worksheet into steps. The assignment's
`estimatedMinutes` should equal the sum of its non-cancelled task estimates.

### Step 9 — Availability and commitments

You need: school days and hours, recurring commitments (sports, lessons, jobs), one-time events,
when the person can study (availability windows), and limits (e.g. at most 2 hours on weekdays).

- Take them from the existing schedule, the person's statements and calendar documents. **Never
  invent a commitment or study time.**
- If availability is empty and the person has not stated it, **ask before planning blocks**, for
  example: *"When can you usually study? (e.g. weekdays 4–9 PM, weekends 10 AM–1 PM). Any regular
  commitments (sports, lessons, work) or days you can't study? How much study time per day is
  realistic?"* If they cannot answer now, deliver the file without blocks plus an issue
  `missing_information:availability`, and say so.
- Items from the person's statements: `origin: "generated"`, `source: {"kind": "user", "label":
  "Told /academic-schedule on <YYYY-MM-DD>"}`; a new recurring commitment without a start date
  starts on the Monday of the week of `meta.generatedAt`, without `endDate`. Never guess term dates.
- An assessment outside school hours (SAT, music exam) gets an assignment **and** a busy one-time
  event with `assignmentId` for the sitting.

### Step 10 — Plan the sessions

Follow [references/scheduling.md](references/scheduling.md). In short:

- Free time = availability windows − busy events − blocks that stay. Never plan in the past, in
  school hours, over commitments or after a deadline (a date-only `due` means
  `settings.defaultDueTime` that day — `00:00` by default, i.e. finish the day before; a date-only
  `assessmentDate` means 00:00).
- Earliest deadline first, respecting `dependsOn`, task checkpoints and priorities.
- Spread assessment preparation over several earlier days (not "Study Biology — Friday" on the test
  day) and large work over several days, finishing with a buffer before the deadline.
- Session lengths between `minSessionMinutes` and `maxSessionMinutes`, `breakMinutes` between
  sessions, at most `maxDailyStudyMinutes` of work per day (the person's own blocks count too).
- Every block references its assignment (and task) and has a concrete `description` of what to do
  in that session ("Read Act 3, pp. 75–100; mark where Iago plants suspicion"). Never `notes`.
- If the work does not fit, do not cram: leave it unscheduled, add `workload` issues with numbers
  and dates, and offer options in the summary.

### Step 11 — Updating an existing schedule

When a `schedule.json` is given, follow [references/update-mode.md](references/update-mode.md) and
§ 15 of the format exactly. The essentials:

- Start from the input file and **keep everything** (same IDs, same values) unless a rule allows a
  change. Copy `deleted`, `settings` (unless the person asked), `x-…` properties, resolved and
  dismissed issues.
- **Match before creating** (§ 15.3: same ID, same source id, same class + type family + normalized
  title with dates < 7 days apart); reuse IDs; never re-create a tombstoned item.
- Protected items (`origin: "user"` or `locked: true`, including their tasks) are copied unchanged;
  change or delete one only by listing it in `meta.requestedChanges` (`requestedByPerson` true only
  if the person asked in this request).
- Person-owned fields stay: `notes`, `locked`, `overrides` and the overridden values, statuses and
  `completedAt` (progress only moves forward on evidence), issue statuses.
- Update generated items only where the new evidence states a value; keep overridden values and add
  a `conflict` issue when the source disagrees. Never lower `estimatedMinutes` to reflect progress.
- Work that vanished from a newer, complete export gets `sourceState: "missing"` (explicitly
  cancelled: `"withdrawn"`); never delete it.
- Only future, unlocked, `planned` blocks with origin `generated` or `planner` may move or be
  removed (never ones with `notes`); `done`, `skipped`, past, in-progress, user and locked blocks
  stay exactly as they are.
- Set `meta.basedOn` to the input's `meta.exportId` (or its `basedOn`); write `meta.sources`
  including the input schedule (kind `schedule`); never copy `requestedChanges` from the input.

### Step 12 — Write and verify the file

1. Build the JSON with a small Python script (`json.dump(…, ensure_ascii=False, indent=2)`) rather
   than by hand, so it is always syntactically valid. Derive IDs with `ids.py` (or the same rules).
2. Run `validate_schedule.py schedule.json --generator`. Fix **every** error and re-run until it
   reports 0 errors. Review the warnings (blocks after deadlines, overlaps, session lengths, daily
   limit, `gen-…` rules) and fix them unless they are intended.
3. Run `schedule_report.py schedule.json --check` (add `--previous <input schedule.json>` in update
   mode). Fix every update-rule violation, overload, unscheduled work you could place, test without
   preparation, block after a deadline and order problem. Re-run both scripts after every fix.
4. Read § 19 "Common mistakes" of the format once more against your file.

### Step 13 — Tell the person

Give the file path and a concise summary in this shape (adapt the draft from `schedule_report.py`):

```
Schedule updated.            (or: Schedule created.)
Added:
- Biology lab report — due Oct 16, 11:59 PM
- Chemistry test — Oct 20 (preparation spread over Oct 15–19)
Updated:
- English essay: due Oct 16 → Oct 17 (Classroom changed it)
Scheduled:
- 7 work sessions
- 4h 35m total
Potential issues:
- Thursday, Oct 15 has about 3h 40m of work but only 2h 30m of available time.
Questions:
- The syllabus says the midterm is Oct 21, Classroom says Oct 20. Which is right? (I used Oct 20.)
```

Then, briefly: assumptions you made (time zone, horizon), anything you could not read, settings you
changed (the person must tick them in the import preview), changes to their own items listed in
`requestedChanges`, and how to import (website → **Import** → choose the file → review the preview →
**Import**). Keep it short; the details are in the file's issues.

If the person asked for the text view, add it after the summary (next section). Otherwise end with
one line offering it, e.g. *"Want to see the full schedule here? Ask for the text view."*

## Showing the schedule in the chat

The JSON file stays the source of truth: write and validate it first (Step 12), every time. If the
person only wants to see an existing `schedule.json`, do not change it; validate it and show it.

**Text view.** When the person asks to see the schedule in the chat ("show it here", "text
version", `text` or `--text` as an argument), or cannot open files right now, run
`python3 -I "${CLAUDE_SKILL_DIR}/scripts/render_schedule.py" schedule.json` on the final validated
file (elsewhere: the `scripts/` folder next to this SKILL.md) and paste its output **verbatim**
inside a ```` ```text ```` block.

- Range: with no options it shows the next 7 days from `meta.generatedAt` plus every upcoming
  assignment. Fit the request: `--from 2026-10-19 --days 7` ("next week"), `--days 14`,
  `--to DATE`, `--view week|agenda|assignments|issues` for one part ("what's on Thursday":
  `--from <that date> --days 1 --view agenda`). Long output: show a shorter range, offer the rest.
- `--now <current local time>` when the file's `meta.generatedAt` is not now (e.g. an exported
  file); `--width 60` for a phone; `--ascii` if box characters show badly; `--include-done` /
  `--include-notes` only when asked (notes belong to the person).
- Never hand-write, shorten, reorder or correct the text view, and never describe the schedule
  from memory instead: it must agree with the file. Exit status 2 means the file is invalid: fix
  it (Step 12) and run again. If the script cannot run at all, say so and offer the JSON instead
  of improvising a view.

**JSON in the chat.** When downloading a file is inconvenient, also offer the validated file's
exact content in a ```` ```json ```` block, to paste in the website under **Import** → *Paste the
file's text instead*. Read it back from disk and paste it unchanged; still write the file.

## When to stop and ask

Ask (in one batch) before planning when: availability is unknown; the time zone is unknown and
the person is not reachable through an existing schedule; or the person's goal is unclear (which
classes, which period). For everything else (an ambiguous date, a conflict, an unreadable
attachment, a class that failed to export), continue with the safest reasonable choice, record an
issue, and list the question in the summary.
