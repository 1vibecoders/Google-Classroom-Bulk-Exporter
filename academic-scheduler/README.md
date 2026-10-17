# Lattice Study

*Scheduling that understands the assignment.* (This folder, `academic-scheduler/`, is the website.)

A calm, no-nonsense planner for students: classes, assignments, commitments, study
time and scheduled work, shown as a day timeline, a week grid and an assignment
list. It answers one question — **"What am I supposed to do, and when?"**

The website displays, edits, stores and schedules structured data with fixed,
predictable rules, and the offline version makes no
network requests at all. The online version can optionally sync Google Classroom
and [read announcements with AI](#reading-announcements-with-ai) for changed due
dates and announced tests; those findings are checked, and applied with Undo or
shown for your review.

The thinking about *what* an assignment requires happens elsewhere, in the
separate Claude [`/academic-schedule` skill](SCHEDULE_SKILL.md). The skill reads your
Google Classroom export and other documents and writes a schedule file; the
website imports that file. The two talk only through the documented
[schedule file format](SCHEDULE_FORMAT.md).

```
Google Classroom ─▶ Classroom Exporter (ZIP) ─▶ Claude /academic-schedule ─▶ schedule.json
                                                                      │
              ┌────────────── edit, plan, mark done ◀── Lattice Study (this website)
              └──────────────▶ Export schedule.json ─▶ Claude /academic-schedule (update) ─▶ …
```

Live site: see [Deployment](#deployment) (the project is deployed on Vercel).

## Contents

- [What it does](#what-it-does)
- [Getting started](#getting-started)
- [Creating a schedule by hand](#creating-a-schedule-by-hand)
- [Importing a schedule](#importing-a-schedule)
- [Exporting](#exporting)
- [Receiving classes from the browser extension](#receiving-classes-from-the-browser-extension)
- [Using it with the /academic-schedule skill](#using-it-with-the-academic-schedule-skill)
- [How planning works](#how-planning-works)
- [Where your data lives](#where-your-data-lives)
- [Google Classroom sync](#google-classroom-sync)
- [Reading announcements with AI](#reading-announcements-with-ai)
- [Security and privacy](#security-and-privacy)
- [Installation and deployment](#installation-and-deployment)
- [Development](#development)
- [Verification and evaluation](#verification-and-evaluation)
- [Limitations and known issues](#limitations-and-known-issues)
- [Project layout](#project-layout)

## What it does

| View | What you see |
| --- | --- |
| **Day** (home) | A timeline of the day: school and other commitments, your *Available* study time, scheduled work blocks (`English / Read Chapter 6`), breaks, due dates and tests, a "now" line, and how much planned work fits into your free time. Drag blocks to move them, drag the bottom edge to resize. An agenda list shows the same day as text. |
| **Week** | Seven days side by side with every class, commitment and work block; drag work to another time or day. Each day's header shows what is due and how full the day is. |
| **Tests** | Upcoming quizzes, tests and exams with their study topics (from a study guide, the AI or you), how ready you feel on each, preparation done / planned / not planned, and the preparation sessions, which cover the topics that need review first. |
| **Review** | What does not fit before its deadline, sessions that no longer fit, open issues, what was changed for you, then what the AI found that needs your decision. |
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

## Receiving classes from the browser extension

In the Google Classroom Bulk Exporter popup, scan or export a class, then use
**Send to Academic Scheduler** with this website's address. The website opens
on Import and shows the changes to review, like a Classroom sync: the same IDs
(so nothing is duplicated), the same protection of your own edits, and
**Undo import**. Due dates are read as Classroom displays them; a date without
a year that could belong to two years, or one that cannot be read, gets an
issue on the assignment for you to check (it goes away when a later scan or
sync is clear, unless you resolved or dismissed it). A scan never marks
anything as removed, because a page may not show everything.

Documents attached to the scanned items (Google Docs and Slides, PDFs, Word and
PowerPoint files; up to 40, 10 MB each, 25 MB in all) come along as files and are
read into text in the browser. Signed in, they are stored on the server with the
Drive documents, where the AI reads them; otherwise they stay in this browser
(IndexedDB). Either way they are listed under *Course documents* on the Classes
page. A document the sync already read from Drive is not replaced.

The message format is versioned (`academic-scheduler/extension-import`,
version 2; version 1 from extension 1.0.0, without documents, is still accepted). The website only reads messages from its own page, validates every
field and answers with a receipt.

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

## How planning works

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

- Your schedule: in this browser's local storage, on this device only. No
  analytics; the page's Content-Security-Policy only allows connections to its
  own origin (`connect-src 'self'`), i.e. the optional sync backend.
- Only if you sign in with Google for [Classroom sync](#google-classroom-sync):
  the server keeps your Google account id and email, an AES-256-GCM encrypted
  Google refresh token, a log of your syncs (counts only) and what it read from
  Classroom (courses, coursework, materials and announcements: titles, texts,
  due dates, links). With AI reading on, also the AI's findings per text, your
  Review decisions, and a log of AI runs (counts and tokens, no content).
  Settings → Google Classroom sync → *Download server data* / *Delete server
  data* (deletion also revokes the website's Google access).
- Clearing the browser's site data deletes it. **Export regularly** to keep a
  copy, and to move your schedule to another device.
- Several open tabs stay in sync.

## Google Classroom sync

Optional, on a deployment with the sync backend ([`api/`](api), [`server/`](server)):
Settings (or the setup's "Classes and data" step) → **Sign in with Google** →
**Sync now**. The result opens in the import preview, so nothing changes until
you import, the usual rules protect your own edits, and **Undo import** works.

- **Read-only scopes:** `classroom.courses.readonly`,
  `classroom.coursework.me.readonly`, `classroom.courseworkmaterials.readonly`,
  `classroom.announcements.readonly` and `classroom.topics.readonly` (plus
  `openid email`), and optionally `drive.readonly` for course documents (below).
  A person or school can refuse Drive; the sync then works without document text.
- **What is synced** (what the browser extension exports): active courses with
  their description and topics; published coursework (assignments and
  questions): title, topic, description, due date (converted from UTC to your
  time zone), points, the Classroom link and attached links, and whether you
  turned it in (turned-in work becomes *Done*); class materials as class
  materials; the newest 20 announcements per class (format 1.2, shown on the
  Classes page). IDs follow SCHEDULE_FORMAT.md § 14.1, so an
  item already imported via the extension and the skill is matched, not
  duplicated. Estimates, tasks, priorities, notes and planned work are never
  changed by a sync; a missing due date never clears one you have; items you
  deleted are not brought back; a teacher's "withdrawn" stays.
- **Changes only:** the Classroom API cannot list "what changed since", so each
  sync lists everything and compares stable ids and content fingerprints with
  what the server stored last time. Coursework no longer listed in a course that
  was read completely is reported as *Removed from source*; a course the server
  cannot read, or that is no longer listed, leaves its items untouched.
- **3 syncs per rolling 24 hours,** enforced on the server. A sync **counts**
  once Google has answered the course listing. Not counted: refused because
  none are left or one is already running, sign-in expired or Classroom access
  not granted, Google unreachable before answering. Settings shows how many are
  left and when the next one is available.
- **Course documents:** with Drive allowed, the text of Google Docs, Google
  Slides, PDFs and Word/PowerPoint files attached to coursework, materials and
  announcements is read and shown on the Classes page (*Course documents*).
  Drive's own change tracking is used: a file is downloaded again only when its
  modified time or checksum changes. Images, videos, forms and scans have no
  text to read and are listed with that status; files your account cannot open
  are reported, never guessed. At most 60 files are checked and 25 downloaded
  per sync; the rest waits for the next one.
- **School restrictions:** if your school blocks third-party access to
  Classroom, the sync says so; the browser extension and the /academic-schedule
  skill still work.

## Reading announcements with AI

Optional, on a deployment with the sync backend and an AI key (below): Anthropic,
or Google Gemini, which has a free tier. After each
Classroom sync, and once a day in the background, the server sends new or changed
announcements, assignment instructions and course documents (the first 20,000
characters of each; a document says which assignment it is attached to) to an AI
model and asks only for
scheduling facts: a changed due date of known work, a newly announced quiz, test or
project, or a time estimate the text states. It never answers questions or does any
part of the work (SPEC § 7), and texts are treated as data, not instructions.

- **Checked, not trusted:** every finding must quote the text it comes from (the
  quote is verified), name known work, and give a real, plausible date; anything
  else is dropped. Each has a confidence per field and says whether the date was
  stated or worked out from words like "Friday".
- **Applied or reviewed:** sure, stated findings that fill a gap (work with no due
  date, a new quiz, work with no estimate) are applied automatically with **Undo**
  (Settings can turn this off). Everything else waits on the **Review** page with
  the current and proposed value, the quote, and why it needs you: *Apply*, *Edit*,
  *Reject* or *Later*. A date you set yourself, or a different due date that
  Classroom gives, is never replaced without you; texts that disagree are shown,
  not settled by whichever was read last. Decisions are remembered.
- **Workload estimates:** the AI also estimates how long each piece of work not yet
  turned in takes, from its title, points, instructions and attached documents
  (rounded to 15 minutes below 2 hours, 30 above; labelled *AI estimate* with a
  confidence). Estimates fill only missing times (a time the teacher states wins,
  a low-confidence guess waits in Review); *Plan unscheduled work* then places the
  work with its fixed rules. The AI never builds the calendar itself (SPEC § 23).
  Multi-step work (essays, projects, big test preparation) also gets 2–8 ordered
  steps, which become its subtasks, so each planned session says which step to
  do. A newly announced quiz or test gets an AI estimate of its preparation time,
  so study time is planned before it.
- **Your commitments:** when you plan your schedule, the AI reads your own
  description of your commitments (from the setup) and adds what it states
  clearly (days and times) as busy events, labelled as coming from your
  description; anything vague ("I work some weekends") becomes an open question
  instead of a guess. An event you already have, or deleted, is not added again.
  Like `/academic-schedule`, but done live on the website.
- **First schedule:** finishing the setup runs the AI once for free on everything
  brought in and your commitments, applies the safe findings and estimates, and
  plans the work into your free study time, undoable in one step. Later,
  *Plan my schedule with AI* in Settings does the same as one of the 3 daily runs.
- **Cost controls:** 3 planning runs per person per rolling 24 hours (like syncs),
  counted only when a run used the AI; the free setup run and the daily background
  check do not count. A text is sent again only when it changes (or the task or
  model changes); texts without content are never sent; at most 60 AI requests per
  person per 24 hours and 40 per run (60 for the free setup run, outside the daily
  budget); tokens are logged as the provider reports them.
- **Big imports** are read completely, like `/academic-schedule` reads every file:
  one request stops starting AI calls after 200 seconds, and the website reads on
  in continuations of the same run (not counted as new runs, within that run's
  cap) before it plans. Facts and workload estimates are read side by side, so
  the work always gets estimates. Course documents sent from the extension are
  stored in requests of at most 40, so the AI reads all of them.
- **What is sent** to the provider (Anthropic if `ANTHROPIC_API_KEY` is set,
  otherwise Gemini if `GEMINI_API_KEY` is set; `AI_PROVIDER` picks one when both
  are): the class name, its assignments' titles and due dates, the new or
  changed texts, and (when you plan your schedule) your description of your
  commitments. Nothing is sent while AI is not configured. The model is
  `claude-haiku-5-5` (the lowest-cost Claude model) or
  `gemini-3.8-flash` (a free-tier Flash model, asked to think at a low level)
  unless `AI_MODEL` says otherwise; when Gemini stays overloaded or
  rate-limited after its retries, the same request goes once to
  `gemini-3.5-flash-lite` (`AI_FALLBACK_MODEL` changes it, empty turns it off);
  another provider can be added in `server/ai/` without touching the rest.
- **Gemini free tier and privacy:** under the
  [Gemini API terms](https://ai.google.dev/gemini-api/terms), Google uses what is
  sent to the free (unpaid) tier and the responses "to provide, improve, and
  develop Google products and services", human reviewers may read it, and the
  terms say not to submit sensitive, confidential or personal information to it.
  On the paid tier Google does not use prompts or responses to improve its
  products. The terms also require users of the API to be 18 or older. Announcements
  and documents can contain names and other personal details: for real student
  data, use a paid Gemini tier or Anthropic.

## Security and privacy

How SPEC.md § 30 is met in this deployment (a summary; no compliance with any
named standard is claimed):

- **Per-person data:** every server query is filtered by the signed-in person's
  id; a test checks that one person never sees another person's documents, AI
  findings or account export. Sessions are random ids stored hashed, in
  HttpOnly, Secure, SameSite=Lax cookies; every request that changes something
  must come from the site's own origin.
- **Secrets stay on the server:** AI and Google keys, the token key and the
  database URL are server environment variables; the built site contains none
  of them (checked by searching the build output). Google refresh tokens are
  encrypted (AES-256-GCM).
- **Every input is validated:** schedule files (both validators and the JSON
  Schema), extension messages (protocol and every field), uploads (sizes,
  counts, ids, https links only), AI answers (quotes must occur in the text,
  known ids, real dates, bounded numbers).
- **AI boundaries:** the instructions are separate from the class's texts, which
  are sent as data and never followed; the AI only reads dates, times, estimates
  and study topics and never writes work; only the class a text belongs to is
  sent with it.
- **Logs carry no content:** run ids, counts, token numbers and error kinds only.
- **Third parties:** Google (sign-in, Classroom, Drive), the AI provider you
  configure (Anthropic or Google Gemini; see
  [What is sent](#reading-announcements-with-ai)), Vercel (hosting) and Neon
  (database).
- **Your control:** export everything the server keeps (Settings, "Download server
  data"), or delete your account, which revokes Google access and deletes every
  stored record, cached AI result and decision with it (one cascade; tested).

## Installation and deployment

The website is a static site: any static host works, and it also runs from a
single file without a server.

### Deployment

The site is deployed on **Vercel** from this repository (root directory
`academic-scheduler`, settings in [`vercel.json`](vercel.json): `npm ci`,
`npm run build`, output `dist`, security headers). To deploy your own copy:

1. Import the repository in Vercel and set **Root Directory** to
   `academic-scheduler` (framework preset: Vite).
2. Deploy. The website itself needs no environment variables.
3. Optional, for Google Classroom sync:
   - Add a Postgres database (Vercel → Storage → Neon); it provides
     `DATABASE_URL`. Tables are created on first use.
   - In Google Cloud: enable the **Google Classroom API**, configure the OAuth
     consent screen (scopes above; while unverified, add your test users), and
     for course documents also enable the **Google Drive API** and add the
     `drive.readonly` scope. Google classes it as *restricted*: fine while the
     app is in testing, internal to a school, or allowlisted by the school's
     admin; a public launch needs Google's verification and security review.
     create an **OAuth client ID** of type *Web application* with the redirect
     URI `https://<your-domain>/api/auth/callback`.
   - Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY`
     (`openssl rand -base64 32`) in the Vercel project's environment variables.
     Never commit them; they are only read by the server functions.
   - Without these variables the site works as before and the sync card says
     sync is not set up. For local testing of the API use `vercel dev`.
4. Optional, for [reading announcements with AI](#reading-announcements-with-ai)
   (needs step 3):
   - Either set `ANTHROPIC_API_KEY` (an Anthropic API key with credits; usage
     is billed by Anthropic), or, for the free option, create a Gemini API key
     at <https://aistudio.google.com/apikey> and set `GEMINI_API_KEY` (read the
     free-tier privacy note above first). Optional: `AI_PROVIDER` (`anthropic`
     or `gemini`) when both keys are set, `AI_MODEL` to use another model of
     the chosen provider, and `AI_FALLBACK_MODEL` (Gemini only) for the model
     tried when the main one is overloaded.
   - Set `CRON_SECRET` (any long random value) so the daily background check
     (`vercel.json` → `crons`, 09:00 UTC) can run; without it that job refuses.
   - Without either key nothing is sent to an AI and Review is hidden.

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
npm run lint         # ESLint (TypeScript and React hooks rules)
npm run build        # dist/ + dist/academic-scheduler.html
npm run test:e2e     # end-to-end tests (Playwright, against the build)
npm run eval:ai      # optional: live AI evaluation (needs an AI key; costs a few API calls)
```

## Verification and evaluation

What is checked, and how (SPEC.md § 31–32; the criterion-by-criterion evidence is
in [`../docs/acceptance.md`](../docs/acceptance.md)):

- **Unit tests** (`npm test`, Vitest): the scheduling engine without the UI or
  the AI (free time, recurrence and exceptions, time arithmetic across
  daylight-saving changes, hard constraints, overlaps, session splitting, daily
  limits, deadline order, steps, test preparation, remaining work, infeasible
  plans, locked sessions, repair, undo), the importer and both file validators,
  the server (sign-in, sync limits, documents, AI analysis with a fake provider,
  one person's data never visible to another) and the views.
- **End-to-end tests** (`npm run test:e2e`, Playwright on desktop and phone sizes)
  against the built site.
- **Evaluation set** (`tests/eval/cases.ts`, § 31.3): synthetic classes covering a
  syllabus with several deadlines, an announcement that moves a due date, work
  with no due time, work described only in an attachment, a study guide, two
  documents with conflicting dates, an ambiguous title, a text with no deadlines,
  an unreadable PDF, a past deadline, not enough free time, and a text that tries
  to give the AI instructions. Offline (`tests/unit/evaluation.test.ts`, in CI) a
  recorded answer with deliberate noise (an invented quote, an unknown id, a
  duplicate) goes through the real checks, and the scheduling cases run the real
  planner: precision, recall, deadline, source and class accuracy, duplicates,
  hard-constraint violations and disruption after an unrelated change.
- **Live AI evaluation** (`npm run eval:ai`): sends the same cases to the AI
  provider configured by the environment (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`,
  optional `AI_MODEL`), prints the scores and writes `test-results/eval-ai.json`.
  About ten calls (cents on Haiku). It fails only if the AI obeys the injected
  instruction; accuracy is reported, not gated. Without a key it is skipped.
- **Lint and types** (`npm run lint`, `npm run typecheck`) and the build.

## Limitations and known issues

- **AI accuracy is measured only when you run `npm run eval:ai`**; CI checks the
  deterministic parts (quote checks, review rules, planner) with recorded answers.
- **AI needs sign-in.** Files sent from the extension while signed out stay in the
  browser and are uploaded at the next AI run after sign-in.
- **AI study topics** come only for quizzes, tests and exams that exist in Google
  Classroom (the AI reads server data); topics have no time estimate of their own.
- **Undo of an automatic repair** restores the whole schedule as it was, so a
  change you made after it is undone too (the import undo warns about this).
- **Sync allowance:** 3 counted syncs per rolling 24 hours; Drive documents need
  the extra `drive.readonly` permission, which some schools block.
- **Not verified on the live site:** a very large send from the extension end to
  end, and the AI account's rate-limit tier (rate limits are retried).
- **The browser extension** is still named "Academic Scheduler" until its next
  release.
- **The dark theme** keeps the older warm colors; the light theme is the neutral,
  clean one.

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
├── tests/eval/               Evaluation set (§ 31.3) and the live AI evaluation
└── scripts/build-single-file.mjs
```

The `/academic-schedule` skill itself lives in [`../skills/academic-schedule`](../skills/academic-schedule).
