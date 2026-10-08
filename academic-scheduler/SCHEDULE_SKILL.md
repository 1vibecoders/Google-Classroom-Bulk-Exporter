# The `/academic-schedule` Claude skill

`/academic-schedule` is a Claude skill that reads your school materials — Google Classroom exports,
syllabi, school and exam calendars, assignment sheets, rubrics, photos — works out what you actually
have to do and how long it will take, and writes a `schedule.json` file that the
**Academic Scheduler** website imports. It can also update a schedule you have been using in the
website without destroying your own changes.

The two parts are deliberately separate. **The website contains no AI**: it displays, edits and
schedules structured data with fixed rules. All interpretation — reading instructions, finding
test dates, estimating workload, deciding when to work — happens in this skill, in Claude. The two
communicate only through the documented file format, [SCHEDULE_FORMAT.md](SCHEDULE_FORMAT.md).

```
Google Classroom ─▶ Classroom Exporter ─▶ ZIP ─┐
syllabus, calendars, rubrics, photos ──────────┼─▶ Claude /academic-schedule ─▶ schedule.json ─▶ Academic Scheduler
your availability and commitments ─────────────┘            ▲                                       │ edit, mark done
                                                            └──────── exported schedule.json ◀──────┘
```

The skill lives in [`skills/academic-schedule/`](../skills/academic-schedule) in this repository.

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Installation](#installation)
- [How to use it](#how-to-use-it)
- [What you get](#what-you-get)
- [Seeing the schedule in the chat](#seeing-the-schedule-in-the-chat)
- [Ambiguity, conflicts and questions](#ambiguity-conflicts-and-questions)
- [How your own changes are protected](#how-your-own-changes-are-protected)
- [Limitations](#limitations)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)

## What it does

1. **Takes inventory of everything you give it** — single-class Classroom ZIPs, *Export all
   classes* ZIPs, extracted folders, PDFs, Word/PowerPoint/Excel files, images, calendar files and
   an existing `schedule.json` — and extracts the text of every document it can read.
2. **Reads everything thoroughly.** The skill tells Claude to work with *Extra effort*: read every
   assignment description and every relevant attachment in full instead of skimming titles, and
   keep a record of what it has read. Dates and requirements buried in PDFs and announcements are
   found this way.
3. **Extracts, per class**: teacher, topics/units, assignments, materials, quizzes, tests, exams,
   projects, readings, writing, problem sets, labs, presentations, submission requirements,
   required files and dependencies. It keeps three dates apart: **due date** (when work is
   submitted), **assessment date** (when a test happens) and **recommended completion date** (a
   target before the deadline).
4. **Separates work from reference material.** Classroom *materials*, slides and "for reference"
   attachments are attached as references, not turned into homework. Announcements are read for
   the work, date changes and cancellations they announce.
5. **Estimates workload from evidence** — pages, problems, words, questions, stages — with a range,
   a confidence level and the evidence it used ("25 pages of verse at 1.5–2.5 min/page + 12 short
   answers").
6. **Breaks large work into tasks** (choose topic → sources → outline → draft → revise → submit)
   with dependencies and checkpoints, without splitting simple homework into pieces.
7. **Plans work sessions** in your free study time around school and commitments: earliest
   deadline first, test preparation spread over the days before the test, big assignments spread
   over several days, sensible session lengths, breaks and a daily maximum. If the work does not fit,
   it says so instead of cramming.
8. **Checks its own result** with bundled scripts: the same validation rules as the website, a
   day-by-day load report, and — when updating — a check that none of your data was overwritten.
9. **Tells you what changed** in a short summary, and asks about anything genuinely unclear.

## Requirements

- **Claude with skills**: Claude Code, or Claude.ai with Skills and code execution enabled.
- **Python 3.8 or newer** where Claude runs the scripts (standard library only, nothing to
  install). Claude.ai's code environment and most computers have it.
- Optional: **`pdftotext`** (from Poppler: `poppler-utils` on Linux, `brew install poppler` on
  macOS) so the scripts can extract PDF text. Without it Claude reads PDFs directly, which works
  but is slower for long documents.

## Installation

### Claude Code — personal skill (all your projects)

```sh
git clone https://github.com/1vibecoders/Google-Classroom-Bulk-Exporter.git
mkdir -p ~/.claude/skills
cp -r Google-Classroom-Bulk-Exporter/skills/academic-schedule ~/.claude/skills/
```

### Claude Code — project skill (one project, shared with its collaborators)

```sh
mkdir -p .claude/skills
cp -r path/to/Google-Classroom-Bulk-Exporter/skills/academic-schedule .claude/skills/
```

Start Claude Code in that folder and type `/academic-schedule` (it appears in the slash-command
list), or ask "use the academic-schedule skill to plan my week". In Claude Code the skill's
frontmatter also sets the effort level to *extra high* (`effort: xhigh`).

### Claude.ai — upload the skill as a ZIP

1. Build the ZIP (from the repository root):

   ```sh
   python3 skills/academic-schedule/package_skill.py
   # → dist/academic-schedule-skill.zip (folder academic-schedule/ with SKILL.md, references/, scripts/)
   ```

   Without Python: `cd skills && zip -r ../academic-schedule-skill.zip academic-schedule -x
   "academic-schedule/tests/*" "*/__pycache__/*" "academic-schedule/package_skill.py"
   "academic-schedule/check_format_copy.py"`.
2. In Claude.ai open **Settings → Capabilities** (called *Features* in some plans), make sure code
   execution / file creation is on, and under **Skills** upload the ZIP.
3. In a chat, attach your files and ask Claude to use the academic-schedule skill.

Claude.ai reads only the skill's name and description from the frontmatter; the instruction to
use *Extra effort* is also written in the skill's text, so it applies there too. If your plan
offers extended thinking, turn it on for these conversations.

## How to use it

### One class

1. Export the class with the Google Classroom Bulk Exporter (**Export Class**).
2. Give Claude the ZIP and tell it when you can study:

   > /academic-schedule Here is my English export. I'm in school Mon–Fri 8–3, I have fencing
   > Mondays 4–6 and piano Wednesdays 5–6. I can study weekdays 3:30–9:30 and weekend mornings
   > 10–1, at most 3 hours a day. My time zone is America/New_York.

### All your classes at once

Use **Export all classes** in the exporter and give Claude the single `All classes - <date>.zip`.
The skill reads the archive's `export-manifest.json`, finds every class folder, and tells you about
classes that could not be exported (export those on their own and add the ZIPs).

### With other documents

Add anything that has dates or requirements Classroom does not show: a syllabus ("Midterm —
October 21"), a school or exam calendar (holidays, exam weeks), an assignment sheet or rubric, a
photo of the whiteboard or of your planner, a calendar export (`.ics`). The skill cross-checks them
against Classroom and reports disagreements instead of silently picking one.

### Updating your schedule (the loop with the website)

1. Use the schedule in the website: mark work done, move sessions, add your own tasks and events.
2. When Classroom changes, export your classes again **and** click **Export** in the website to
   get your current `schedule.json`.
3. Give both to Claude: *"/academic-schedule Update my schedule with this new export."*
4. Import the new file in the website. The import preview shows every change (new, updated,
   removed from source, changes to your own items, settings) before anything happens, and
   **Undo import** restores the previous state.

The skill keeps everything you did: completed work stays completed, your own items and notes are
untouched, sessions you moved stay where you put them, and items you deleted are not brought back.
Only future, automatically placed sessions are re-planned.

### Good things to tell Claude

- When you can study, your commitments (with days and times), and a realistic daily maximum.
- Your time zone (if it is not already in your `schedule.json`).
- What to focus on ("only the next two weeks", "skip the optional reading").
- Anything you know that the materials do not say ("the lab report is due Thursday now", "I read
  slowly", "I've already outlined the essay").

## What you get

**`schedule.json`** — a valid version 1.0 schedule file containing:

- your **classes** (with topics and their reference materials);
- **assignments** with type, due date and/or assessment date, estimate (with range, confidence and
  evidence), priority, tasks with dependencies and checkpoints, references to their attachments,
  and where they came from;
- your **commitments** (events) and **study time** (availability) as you described them;
- **work sessions** (schedule blocks) with a concrete description of what to do in each;
- **issues**: things you should look at (conflicts between sources, ambiguities, missing
  information, tight days), shown in the website next to the affected item or day.

**A short summary**, for example:

```
Schedule updated.
Added:
- Biology lab report — due Oct 16, 11:59 PM
- Chemistry test — Oct 20 (preparation spread over Oct 15–19)
Updated:
- English essay: due Oct 16 → Oct 17 (Classroom changed it)
Scheduled:
- 7 work sessions
- 4h 35m total
Potential issue:
- Thursday, Oct 15 has about 3h 40m of work but only 2h 30m of available time.
Questions:
- The syllabus says the midterm is Oct 21, Classroom says Oct 20. Which is right? (I used Oct 20.)
```

Import the file with **Import** in the website (choose the file, review the preview, confirm).

**On request, the schedule as text in the chat** — see the next section.

## Seeing the schedule in the chat

The `schedule.json` file is always written (and validated) first; it is what the website imports.
On top of it, Claude can show you the schedule right in the chat, as text you can read anywhere.

**How to ask.** Say "show me the schedule here", "text version" or "what does Thursday look like?",
or in Claude Code start with `text`: `/academic-schedule text Plan my week from this export`. You
can also give Claude a `schedule.json` you exported from the website and ask to see it; Claude then
shows it without changing it. After every run Claude ends its summary with the offer *"Want to see
the full schedule here? Ask for the text view."*

**What it shows**, in a monospace `text` block:

- a header with the schedule's title, the days shown, and when the file was made (with its time
  zone);
- a **week overview**: one line per day with your free study time, the work planned that day,
  overload in words ("! over free time by 45m", "! over daily limit by 30m") and what is due or
  taking place;
- **day agendas** in time order: school and other commitments, work sessions as *Class /
  assignment — step*, breaks, and the free time between them ("Available until 9:30 PM"), with
  what to do in each session; done and skipped sessions, sessions you pinned, conflicts and
  sessions that end after a deadline are written out in words; then the day's deadlines and its
  free and planned time;
- your **assignments**: overdue, this week, later and undated, each with its type, status, due or
  assessment date, estimate, and the remaining, scheduled and unscheduled time, plus its steps;
- the **open issues and questions**.

It uses exactly the website's rules (free time is your study time minus busy commitments; without
study time it says "study time not provided" and shows no overload; a due date without a time is
shown without one; remaining work is computed the same way), because it is generated from the file
by the skill's `render_schedule.py` script. Claude pastes that output unchanged and never writes the
view by hand; if the script cannot run, Claude says so instead of improvising. Your own notes are
left out unless you ask for them.

You can ask for a different range ("next week", "the next two weeks", "just Thursday"), one part
("only my assignments", "only the open questions"), a narrower layout for a phone, plain ASCII
characters, or finished work and your notes included.

Example: the start of the text view of [`examples/complete-schedule.json`](examples/complete-schedule.json)
for Oct 12–14 (real output of `render_schedule.py examples/complete-schedule.json --from
2026-10-12 --days 3 --view week`):

```text
Fall 2026 — Week of Oct 12
Mon, Oct 12 – Wed, Oct 14, 2026
Generated Sun, Oct 11, 2026, 7:30 PM (America/New_York)

── Week overview ─────────────────────────────────────────────────────────────
Mon Oct 12  free 4h       planned 1h 20m
Tue Oct 13  free 6h       planned 1h 35m
            Due: English 10 / Read Othello Act 3
            Checkpoint due: English 10 / Othello Essay — Outline (printed copy
            due in class)
Wed Oct 14  free 5h       planned 2h 10m
            Due: English 10 / Grammar worksheet 3: Commas (withdrawn by
            teacher)
```

and one day agenda (`--from 2026-10-13 --days 1 --view agenda`):

```text
Fall 2026 — Week of Oct 12
Tue, Oct 13, 2026
Generated Sun, Oct 11, 2026, 7:30 PM (America/New_York)

── Day by day ────────────────────────────────────────────────────────────────
Tuesday, October 13
  8:00 AM–3:00 PM     School
  3:30 PM–4:15 PM     Biology / Unit 2 Test: Cells — Review chapter 3 notes
                        Chapter 3 notes (cell structure); redo the section
                        review questions.
  4:15 PM             ──── Available until 4:30 PM
  4:30 PM–5:20 PM     English 10 / Othello Essay — Draft
                        Introduction and first body paragraph.
  5:20 PM             ──── Available until 9:30 PM
  Due today: English 10 / Read Othello Act 3
  Checkpoint due today: English 10 / Othello Essay — Outline (printed copy due
    in class)
  Free 6h · Planned 1h 35m
```

Without `--view`, one text view contains the header, the week overview, the day agendas, the
assignments and the open issues.

**Paste instead of download.** If downloading a file is inconvenient (on a phone, for example), ask
Claude to also paste the schedule as JSON. Copy the whole `json` block, open the website, click
**Import**, open *Paste the file's text instead*, paste it and continue with the preview as usual.
The pasted text is the file's exact content; the file is still written.

## Ambiguity, conflicts and questions

- **Never silent.** When sources disagree (syllabus vs Classroom, a photo vs a document, a teacher's
  later announcement), the skill uses the most authoritative and explicit source — for example a
  later dated announcement over the original post — and records a *conflict* issue naming both
  values. When it cannot tell, it plans for the earlier date, so preparation is never late, and
  asks you.
- **No guessing.** Missing dates, unclear scope, unreadable attachments and years that could be
  either of two are recorded as *ambiguity* or *missing information* issues and listed as
  questions. Classroom shows dates without the year; the skill infers the year from the posting
  date and flags the doubtful cases.
- **No invented commitments.** If you have not said when you can study, the skill asks before
  planning sessions. If you cannot answer yet, you get the file without sessions and an issue
  reminding you.
- **Your decisions stick.** Issues you mark resolved or dismissed in the website are not raised
  again in later runs.

## How your own changes are protected

The format has explicit rules (§ 15 of [SCHEDULE_FORMAT.md](SCHEDULE_FORMAT.md)) and the skill
checks its output against them with `schedule_report.py --check`:

- Items you created (`origin: "user"`) and items you pinned or moved (`locked`) are copied unchanged.
  If a source suggests changing one (a school calendar says there is no school on a day), the change
  is listed under **Changes to your items** in the import preview and is *not ticked* unless you
  asked for it in that conversation.
- Fields you edited on generated items (recorded in `overrides`), your notes, statuses and
  completion times are kept; when a source now says something different, you get a conflict issue.
- Completed, skipped, past and pinned sessions are history and never change.
- Items you deleted are remembered (`deleted`) and not created again.
- Work that disappears from Classroom is not deleted but marked *missing*; work the teacher
  cancels is marked *withdrawn*.
- Your settings are copied; a settings change you asked for appears in the preview for you to tick.

## Limitations

- The quality of the plan depends on the materials. The Classroom export does not include your
  own submissions, grades or whether you turned work in; tell Claude what is done, or mark it done
  in the website.
- Workload estimates are evidence-based estimates for a typical high-school student, not
  measurements. They improve when you tell Claude your pace or when your completed sessions show
  it; you can always change an estimate in the website.
- Attachments the exporter could not download, Google Forms, videos and web links are not in the
  ZIP. The skill tells you when one matters.
- Scanned PDFs and photos are read by Claude directly; handwriting and poor photos may be misread —
  check the dates it reports.
- Very large exports (many classes with many attachments) take a long time to read thoroughly; that
  is intended. Media files (audio/video) are listed but not extracted.
- One time zone per schedule; times are wall-clock times without conversion.
- The website's import validates and previews everything, but the plan is only as good as the
  availability you give: if your real week differs, update your study time and commitments.

## Privacy

- The skill runs inside your Claude session. Your files are processed there under the privacy terms
  of the Claude product you use; the skill itself sends nothing anywhere else and has no network
  code.
- The bundled scripts only read your files as data: they never execute anything from them, extract
  ZIP files safely (no files outside the working folder, size limits), and work in a temporary
  folder.
- The website stores the imported schedule only in your browser and makes no network requests.
- Classroom exports can contain classmates' names in announcements and comments-like text; share
  only what you need.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The skill does not start | Type `/academic-schedule` explicitly, or say "use the academic-schedule skill". Check it is installed (`~/.claude/skills/academic-schedule/SKILL.md` or uploaded in Claude.ai settings). |
| "python3: command not found" | Install Python 3.8+, or let Claude do the checks by hand (slower). In Claude.ai, enable code execution. |
| The text view shows odd characters or lines | Ask for the ASCII version (plain characters only), or a narrower one for a phone. |
| PDFs show "read this PDF directly" | `pdftotext` is not installed; install Poppler or let Claude read the PDFs directly. |
| No work sessions were planned | Availability is missing. Tell Claude when you can study, or add study time in the website and use its *Plan unscheduled work*. |
| The website rejects the file | The import lists every error with its location. Ask Claude to run `validate_schedule.py` on the file and fix the errors; the validator uses the same rules as the website. |
| "This file uses schema version …" | The file was written for another format version; ask for a version 1.0 file. |
| Import preview warns "made from an older export" | You changed the schedule in the website after exporting the file you gave Claude. Your protected changes are kept anyway; review the list, or export again and re-run. |
| A date has the wrong year | Classroom shows dates without the year. Tell Claude the correct date; it records the reason. |
| Duplicates after importing | Re-importing the same file never duplicates. If a new run created a second copy of an item you made yourself, the preview shows it under *Possible duplicate* (not ticked); leave it unticked and tell Claude. |
| A class is missing | Check the export report: a class marked *not exported* must be exported on its own. |

## For developers

```
skills/academic-schedule/
├── SKILL.md                     the skill: instructions Claude follows (frontmatter: name, description, effort)
├── references/
│   ├── SCHEDULE_FORMAT.md       exact copy of academic-scheduler/SCHEDULE_FORMAT.md
│   ├── classroom-export.md      both ZIP layouts, every relevant field, dates, IDs, completeness
│   ├── workload-estimation.md   evidence-based rates, ranges, confidence, examples
│   ├── scheduling.md            how sessions are planned and checked
│   └── update-mode.md           round-trip rules with a worked example
├── scripts/                     Python 3.8+, standard library only; run with python3 -I
│   ├── inventory.py             safe extraction, inventory of classes/items/documents, text extraction
│   ├── validate_schedule.py     every rule of SCHEDULE_FORMAT.md § 13 (+ generator checks)
│   ├── schedule_report.py       day loads, § 8.1 remaining work, problems, update-rule check, draft summary
│   ├── render_schedule.py       the schedule as plain text for the chat (week, days, assignments, issues)
│   └── ids.py                   ID, slug, issue-ID and point-estimate helpers
├── tests/                       unittest (synthetic single-class folder and account ZIP, fixtures, packaging)
├── package_skill.py             builds dist/academic-schedule-skill.zip for Claude.ai
└── check_format_copy.py         keeps references/SCHEDULE_FORMAT.md identical to the website's
```

```sh
python3 -m unittest discover -s skills/academic-schedule/tests        # all skill tests
python3 skills/academic-schedule/check_format_copy.py [--fix]         # after editing SCHEDULE_FORMAT.md
python3 skills/academic-schedule/package_skill.py                     # build the upload ZIP
python3 -I skills/academic-schedule/scripts/validate_schedule.py academic-scheduler/examples/*.json
python3 -I skills/academic-schedule/scripts/render_schedule.py academic-scheduler/examples/complete-schedule.json
```

`validate_schedule.py` implements the same rules, paths and limits as the website's validator
(`src/lib/validate.ts`); both are tested against the shared fixtures in
[`tests/fixtures`](tests/fixtures) (`valid/` must be accepted, every `invalid/` file rejected at
its `expectedErrorPaths`). When the format changes, update the spec, the JSON Schema, both
validators and the fixtures together, then run `check_format_copy.py --fix`.
