# Academic Scheduler

A calm, no-nonsense planner for students: classes, assignments, commitments, study
time and scheduled work, shown as a day timeline, a week grid and an assignment
list. It answers one question — **"What am I supposed to do, and when?"**

The website contains **no AI**. It never calls a language model, never reads or
interprets documents, and never estimates workload. It displays, edits, stores and
schedules structured data with fixed, predictable rules. It makes no network
requests at all: everything stays in your browser.

The thinking about *what* an assignment requires happens elsewhere, in the
separate Claude [`/academic-schedule` skill](SCHEDULE_SKILL.md). The skill reads your
Google Classroom export and other documents and writes a schedule file; the
website imports that file. The two talk only through the documented
[schedule file format](SCHEDULE_FORMAT.md).

```
Google Classroom ─▶ Classroom Exporter (ZIP) ─▶ Claude /academic-schedule ─▶ schedule.json
                                                                      │
              ┌────────────── edit, plan, mark done ◀── Academic Scheduler (this website)
              └──────────────▶ Export schedule.json ─▶ Claude /academic-schedule (update) ─▶ …
```

Live site: see [Deployment](#deployment) (the project is deployed on Vercel).

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [Creating a schedule by hand](#creating-a-schedule-by-hand)
- [Importing a schedule](#importing-a-schedule)
- [Exporting](#exporting)
- [Using it with the /academic-schedule skill](#using-it-with-the-academic-schedule-skill)
- [How planning works (no AI)](#how-planning-works-no-ai)
- [Where your data lives](#where-your-data-lives)
- [Installation and deployment](#installation-and-deployment)
- [Development](#development)
- [Project layout](#project-layout)

## What it does

| View | What you see |
| --- | --- |
| **Day** (home) | A timeline of the day: school and other commitments, your *Available* study time, scheduled work blocks (`English / Read Chapter 6`), breaks, due dates and tests, a "now" line, and how much planned work fits into your free time. Drag blocks to move them, drag the bottom edge to resize. An agenda list shows the same day as text. |
| **Week** | Seven days side by side with every class, commitment and work block; drag work to another time or day. Each day's header shows what is due and how full the day is. |
| **Assignments** | Upcoming work sorted by deadline, with due and test dates, status (one click to mark done), estimated total and **remaining** workload, how much of it is scheduled, the next session, subtasks and references. "Plan unscheduled work" proposes blocks for whatever is not yet scheduled. |
| **Classes** | Your classes with teacher, color, description, materials and open work. |
| **Commitments** | Recurring commitments (School Mon–Fri 8:00–3:00, Fencing Mon 4:00–6:00, …), one-time events (Doctor Oct 12, 3:30–4:30) and the times you are available to study. |
| **Import** | The prominent way to bring in a schedule file: validate → preview every change → choose → import → undo if needed. |
| **Settings** | Day start/end, week start, session and break lengths, daily study maximum, data tools (export, example data, undo history, delete everything). |

Everything you create can be edited and deleted. Everything imported can be
edited afterwards.

## Getting started

Open the website (or the single offline file, see below). Then either:

- **Start by hand:** add your classes, your commitments and your study time
  (*Commitments*), then your assignments, and schedule work blocks on the Day or
  Week view — or let *Plan unscheduled work* propose them.
- **Import a schedule** made by the `/academic-schedule` skill: click **Import** in the
  header.
- **Look around first:** *Settings → Load example schedule* fills the app with a
  complete example (October 2026). Undo or *Delete all data* afterwards.

## Creating a schedule by hand

Use **+ New** in the header (or the buttons on each page):

| Item | Fields |
| --- | --- |
| Class | Name, teacher, color, description (also section, room, topics, materials). |
| Assignment | Title, class, type (homework, reading, essay, lab, quiz, test, …), description, notes, due date (time optional), test/presentation date, recommended completion date, estimated duration, priority, status, points, required/optional, **subtasks** (each with estimate, own deadline, dependencies, status) and **references** (links or files). |
| Scheduled work block | The assignment (and optionally the subtask) or a free title, date, start, end, notes; or a break. |
| Event / commitment | Title, category, one-time (date, times or all-day) or weekly (days, every N weeks, start/end date, skipped dates), busy or not, location, notes. |
| Study time | When you are available to study: weekly (e.g. Mon–Fri 15:30–21:30) or on one date. |

Due dates without a time are treated as due at the start of that day (change
this under *Settings → Default due time*), so the planner finishes such work the
day before.

## Importing a schedule

Click **Import** (always in the header), then choose a `.json` file, drop it on
the page, or paste its text. The website:

1. **Validates** it against [SCHEDULE_FORMAT.md](SCHEDULE_FORMAT.md) and lists
   every problem with its location. Files with an unsupported `schemaVersion`
   are rejected with a clear message. The file is treated strictly as data;
   nothing in it is ever executed.
2. **Previews** what would change, for example:
   ```
   New:        + 3 assignments  + 8 scheduled work blocks
   Updated:    ~ 2 due dates  ~ 1 workload estimate
   Unchanged:  24 items
   ```
   with details per item (before → after) and choices where a decision is
   yours: items you created or pinned, items you deleted before, work removed
   from Classroom, outdated planned sessions, settings.
3. **Imports** only after you confirm, and keeps an **Undo** for the last
   imports.

Items are matched by their `id`, so importing the same file twice changes
nothing, and an updated file updates the existing items instead of duplicating
them. Your own data is protected: items you created, completed work, past
sessions, your notes, statuses you set and fields you edited are never silently
overwritten (see [SCHEDULE_FORMAT.md § 16](SCHEDULE_FORMAT.md)).

## Exporting

**Export** in the header downloads `schedule-YYYY-MM-DD.json`: your complete
schedule in the same format, including what you created by hand, what you
completed and which imported items you changed or deleted. Keep it as a backup,
move it to another browser (import it there), or give it to `/academic-schedule` to
update your plan.

## Using it with the /academic-schedule skill

1. Export your classes with the Google Classroom Bulk Exporter (one class, or
   **Export all classes** for the whole account).
2. Give the ZIP — plus any syllabus, school calendar, rubric or other document,
   your current `schedule.json` if you have one, and your usual availability —
   to Claude with the `/academic-schedule` skill. See [SCHEDULE_SKILL.md](SCHEDULE_SKILL.md).
3. Import the `schedule.json` it produces here. Work with it, edit it, mark
   things done.
4. When Classroom changes, export from here and run `/academic-schedule` again with the
   new Classroom export. It updates the plan without destroying your work.

## How planning works (no AI)

*Plan unscheduled work* is a fixed rule, not a model: for every assignment with
remaining work that is not yet scheduled, earliest deadline first, it fills your
free study time (study time minus busy commitments and existing blocks) with
sessions between your minimum and maximum session length, with breaks between
them and within your daily maximum. Test preparation is spread across the days
before the test. Whatever does not fit is listed with the reason. You review the
proposed blocks before they are added. The same data always gives the same plan.

"Remaining work" is the arithmetic defined in
[SCHEDULE_FORMAT.md § 8.1](SCHEDULE_FORMAT.md): estimates of what is not done
minus the time of sessions marked done.

## Where your data lives

- In this browser's local storage, on this device only. There is no account, no
  server, no analytics, and the page's Content-Security-Policy forbids network
  connections (`connect-src 'none'`).
- Clearing the browser's site data deletes it. **Export regularly** to keep a
  copy, and to move your schedule to another device.
- Several open tabs stay in sync.

## Installation and deployment

The website is a static site: any static host works, and it also runs from a
single file without a server.

### Deployment

The site is deployed on **Vercel** from this repository (root directory
`academic-scheduler`, settings in [`vercel.json`](vercel.json): `npm ci`,
`npm run build`, output `dist`, security headers). To deploy your own copy:

1. Import the repository in Vercel and set **Root Directory** to
   `academic-scheduler` (framework preset: Vite).
2. Deploy. No environment variables or API keys are needed — there are none.

Other hosts: run `npm run build` and upload the `dist/` folder (GitHub Pages,
Netlify, any web server). Asset paths are relative, so it works under any path.

### Offline single file

`npm run build` also writes `dist/academic-scheduler.html`: the whole app in one
file. Save it anywhere and open it in a browser — no server, no internet.
(Data saved from a file opened this way stays with that browser's `file://`
storage.)

## Development

Requirements: Node.js 20 or newer.

```bash
cd academic-scheduler
npm ci
npm run dev          # http://localhost:5173
npm test             # unit tests (Vitest)
npm run typecheck
npm run build        # dist/ + dist/academic-scheduler.html
npm run test:e2e     # end-to-end tests (Playwright, against the build)
```

## Project layout

```
academic-scheduler/
├── SCHEDULE_FORMAT.md        The schedule file format (normative, versioned)
├── SCHEDULE_SKILL.md         The Claude /academic-schedule skill: install and use
├── schema/                   JSON Schema of the format
├── examples/                 Example schedule files
├── src/
│   ├── model/                Types and constants of the format
│   ├── lib/                  Pure logic: validation, recurrence, calendar, workload,
│   │                         import diff/merge, export, planner, time arithmetic
│   ├── state/                Reducer (every change), store, local storage
│   ├── ui/                   Shared components (dialogs, fields, icons, menus)
│   ├── editors/              Create/edit dialogs
│   └── views/                Day, Week, Assignments, Classes, Commitments, Import, Settings
├── tests/unit/               Vitest
├── tests/e2e/                Playwright
└── scripts/build-single-file.mjs
```

The `/academic-schedule` skill itself lives in [`../skills/academic-schedule`](../skills/academic-schedule).
