# Reading a Google Classroom export

The **Google Classroom Bulk Exporter** (a Chrome extension in the same repository as this skill)
saves classes as ZIP files. This page describes everything in those archives that matters for a
schedule, and how each piece maps to the schedule format
([SCHEDULE_FORMAT.md](SCHEDULE_FORMAT.md)). `scripts/inventory.py` reads all of it for you; use this
page to interpret what it shows and to read files yourself.

## Contents

1. [The two archive layouts](#1-the-two-archive-layouts)
2. [export-manifest.json](#2-export-manifestjson)
3. [Class folder files](#3-class-folder-files)
4. [Item folders](#4-item-folders)
5. [Which items become assignments](#5-which-items-become-assignments)
6. [Dates as Classroom displays them](#6-dates-as-classroom-displays-them)
7. [IDs and sources](#7-ids-and-sources)
8. [Is the export complete? (missing work)](#8-is-the-export-complete-missing-work)
9. [Pitfalls](#9-pitfalls)

## 1. The two archive layouts

**Single class** (`<Class> - <date>.zip`): one top folder named `<Class name> - <Section>`
(shortened to 50 characters, unsafe characters replaced):

```
English 10 - Period 3/
  export-manifest.json        (newer exports: kind "class", its one class has folder ".")
  class-info.json
  class-description.txt
  export-report.txt / export-report.json
  index.html
  Assignments/<item>/         description.txt, metadata.json, Attachments/…
  Materials/<item>/
  Questions/<item>/
  Announcements/<item>/       (only when announcements were included)
  Other Coursework/<item>/
```

**All classes** (`All classes - <date>.zip`, made with *Export all classes*):

```
Google Classroom Export - 2026-10-11/
  export-manifest.json        kind "account": every class, its folder and status
  index.html, export-report.txt
  English 10 - Period 3/      exactly the single-class layout above
  Biology - Period 2/
  Biology - Period 2 (2)/     two classes with the same name and section
```

Robust detection (also for older exports without a manifest): **every folder that contains a
`class-info.json` is a class folder.** A class that failed has no folder; only the manifest lists
it. A class folder whose writing stopped with an error may lack `class-info.json`.

## 2. export-manifest.json

| Field | Meaning |
| --- | --- |
| `kind` | `"account"` or `"class"`. |
| `exportedAt` | Export time, ISO 8601 **UTC** (e.g. `2026-10-11T22:05:00.000Z`). Convert to the person's time zone for `source.retrievedAt` (2026-10-11 18:05 in New York). It also anchors year-less dates. |
| `accountIndex` | The `N` of `/u/N/` (which Google account). |
| `options` | `includeAnnouncements`, `readItemPages`, `googleFilesExportedAs` (`office`/`pdf`). |
| `classes[]` | `courseId`, `name`, `section`, `teacher` (from the class card; `null` if none shown), `url`, `folder` (`"."`, the folder name, or `null` when not exported), `status` (`exported`, `partial`, `failed`), `counts`, `error` (only when something went wrong). |
| `totals` | Classes, items, files downloaded/failed, links. |

`status: "partial"` without `error` means only some attachment downloads failed; with `error` the
folder may be incomplete. `failed`: nothing was exported (tell the person; ask them to export that
class on its own if it matters).

## 3. Class folder files

**class-info.json**

| Field | Use |
| --- | --- |
| `exportedAt` | As in the manifest (UTC). |
| `class.id` | Course id in URL form (e.g. `NjI3ODk0MjE0NTQ5`) → class ID `gc-class-<id>`, `source.id`. |
| `class.name`, `class.section` | Class `name` (put the section in `section`, not in the name). |
| `class.url` | `source.url` of the class. |
| `class.details` | Banner lines such as "Subject: English", "Room 204" → `room` when clearly a room. |
| `topics` | Classroom topics in order → class `topics`. |
| `options` | As in the manifest. |
| `discovery.warnings` | Problems while listing items (see § 8). |
| `items[]` | `type`, `title`, `topic`, `folder` (relative), `classroomUrl` — the item list. |

**class-description.txt**: name, section, banner lines, item counts, topics.
**export-report.json / .txt**: `failures` (attachments that could not be downloaded, with the
reason), `links` (saved as links), `warnings` (class and item warnings, see § 8).
**index.html**: an offline table of contents; nothing that is not elsewhere.

The **teacher** is not in `class-info.json`. Take it from the account manifest's `teacher`, or from
a syllabus or the class description. Otherwise omit it (never guess).

## 4. Item folders

Each item has `description.txt` (human-readable: title, type, topic, due date, points, posted
date, link, the full instructions, where each attachment went) and `metadata.json`:

| Field | Meaning and use |
| --- | --- |
| `type` | `assignment`, `material`, `question`, `announcement` or `other` (Classroom's own type, not the schedule's). |
| `title` | Item title (folder names are shortened; this is the full title). |
| `topic` | Classroom topic or `null` → assignment `topic`. |
| `classroomId` | Item id in URL form → `gc-<id>`, `source.id`. |
| `classroomUrl` | → `source.url`. |
| `dueText` | Due date **as displayed** (`"Oct 10, 11:59 PM"`, `"No due date"`), or `null`. |
| `pointsText` | `"100 points"`, `"Ungraded"` → `points` (as written). |
| `postedText` / `editedText` | Posting / edit date as displayed (year-less). |
| `statusText` | `"Scheduled …"` or `"Draft"` (only visible to teachers). |
| `description` | The full instructions or announcement text. If `options.readItemPages` was `false`, it may be shortened. |
| `folder` | Item folder relative to the class folder. |
| `attachments[]` | `title`, `type` ("PDF", "Google Docs", "YouTube video", "Google Forms", "Folder", "Link", …), `kind`, `source` (`attachment` = attached to the item; `description-link` = a Drive/Docs link found in the text), `originalUrl`, `status` (`downloaded`, `failed`, `link`), `file` (path relative to the item folder, e.g. `Attachments/Rubric.pdf`), `size`, `contentType`, `originalFilename`, `exportedAs`, `note`, `error`. |
| `extraction.warnings` | Item-level problems, e.g. "Item page matched by position … please spot-check". |

Google Docs/Sheets/Slides are exported as .docx/.xlsx/.pptx (or PDF). Google Forms, Drive folders,
YouTube videos and websites are saved as `.url` shortcut files: they are **links**, their content is
not in the export. A Google Form attached to an assignment is often a quiz or a worksheet to fill
in: judge by the title and the instructions. A video to watch takes about its length (unknown: ask
or estimate from the instructions, low confidence).

Attachments with `status: "failed"` were not downloaded (no access, downloading disabled). If one
is needed to understand or estimate the work, say so in a `missing_information` issue and ask the
person for the file.

## 5. Which items become assignments

| Classroom item | In the schedule |
| --- | --- |
| Assignment, Question, Other coursework | An **assignment** (choose `type` from the actual work: reading, writing, problem_set, lab, project, quiz, …). A Question is usually short homework. |
| Material | **Never an assignment.** A `references` entry (`required: false`) of the class, or of the assignment it supports. If its text explicitly assigns work ("read pages 10–25 by Monday"), that work is an assignment with ID `gc-<itemId>-<slug(title)>` (§ 14.1 derived work). |
| Announcement | Read it. It yields an assignment only for work it announces (derived ID), and it may change other items: a new test date, a cancellation (`sourceState: "withdrawn"` on that assignment), "no school Monday" (an exception date on the person's School event via `requestedChanges`, `requestedByPerson: false`). An announcement that asks for no work becomes at most a class reference. |
| Attachments | `references` of the assignment: `required: true` only when the work requires using or submitting it (rubric, template, assigned reading); `kind` `rubric`, `template`, `reading`, `link` or `attachment`; `path` = its path inside the export; `url` only when it is an `http(s)` URL. |
| Topics | Class `topics` (in order) and each assignment's `topic`. |

An item's instructions can contain several separately-dated pieces of work ("Read ch. 3 by Monday;
questions due Wednesday"). Decide whether that is one assignment with tasks (task `due`
checkpoints) or separate assignments (derived IDs) — one assignment with tasks when it is one
graded submission, separate assignments when each piece is handed in or assessed on its own.

## 6. Dates as Classroom displays them

Classroom shows dates of the current year **without the year** (`Oct 10, 11:59 PM`) and the
exporter keeps them as displayed. It may also show `Today`, `Tomorrow`, `Yesterday`, a time only
(something posted today), or a full date with the year for other years (`Sep 12, 2025`).

- **Year (§ 14.2):** use the year that puts the date closest to the item's posted date; when the
  posted date is unknown, closest to the export date. A posted date itself is the latest such date
  that is not after the export. When two years are about equally plausible (dates about six months
  apart), add an `ambiguity` issue and plan for the nearer future date. `inventory.py` does this and
  marks ambiguous cases; always sanity-check the result against the instructions and the term.
- **Relative words and times** are relative to the export date in the person's time zone.
- **Time:** `11:59 PM` → `T23:59:00`. With a time, write a LocalDateTime; without one, a Date
  (meaning "time not stated").
- **`No due date`**: no `due`. Look for a date in the description ("due next Friday") — if the text
  gives one, use it and say so in the issue/estimate basis; if not, the work is undated (or ask).
- The description may contradict `dueText` ("due Friday in class" vs `Oct 16, 11:59 PM`): the
  Classroom due field is the submission deadline unless a **later** teacher statement changes it;
  record a `conflict` issue either way.
- Relative phrases inside texts ("next Tuesday", "in two weeks") are relative to the **posted**
  date of that item, not to today.

## 7. IDs and sources

- **Course and item ids** are normalized to the URL form: the unpadded base64 of the decimal id
  (`627894214549` → `NjI3ODk0MjE0NTQ5`). The export already uses that form; `ids.py classroom-id`
  converts a decimal id.
- New class: `gc-class-<courseId>`. New item: `gc-<itemId>`. Work announced in an item's text:
  `gc-<itemId>-<slug(title)>` with a `source` that has **no** `id` (several items can come from one
  post). Always look for an existing item first (§ 15.3).
- `source` of a Classroom item: `{"kind": "google_classroom", "id": "<itemId>", "url":
  "<classroomUrl>", "path": "<path of metadata.json inside the export>", "label": "<archive name>"}`.
  For the class also `"retrievedAt": "<exportedAt in local time>"`, and the same on the
  `meta.sources` entry of each export used.

## 8. Is the export complete? (missing work)

An assignment may be marked `sourceState: "missing"` (never deleted) only when the inputs include a
**newer** export of the same course (its `exportedAt` later than the class's `source.retrievedAt`)
that is complete for that item type (§ 15.6):

- assignments, questions, materials, other coursework are always exported; announcements and work
  derived from them only when `options.includeAnnouncements` is `true`;
- no warning says a list may be incomplete, an item or item page could not be read, or announcements
  were skipped (in `class-info.json` → `discovery.warnings` or `export-report.json` → `warnings`).
  Attachment download failures do not matter;
- in an account archive, the class's manifest entry has `status` `exported` (or `partial` without
  `error`) and its folder has both `class-info.json` and `export-report.json`.

`inventory.py` reports this per class as "Complete enough to mark vanished items missing". A class
that a newer account export no longer lists (archived or left) does not make its work missing: add a
`missing_information` issue about the class instead. With several exports of one course, use only
the newest; an older or equally old one changes nothing (mention it in the summary).

Export options also limit what you may overwrite (§ 15.4 rule 5): with `readItemPages: false`
descriptions may be shortened, so keep the current, longer description.

## 9. Pitfalls

- **Same titles:** "Poetry Terms" and "Poetry Terms (2)" are different items (different ids); the
  folder name has the suffix, the title does not.
- **Re-posts:** a teacher may delete and re-post an item (new id, same title). See § 15.3 "Re-post".
- **"Not listed on the Classwork page; found through a link"**: a real item, included anyway.
- **"Item page matched by position"**: spot-check its due date and instructions against the title.
- **Student status is not exported:** the export does not say whether the person turned work in.
  Completion comes from the existing schedule (statuses, done blocks) or from the person.
- **Shortened instructions** when item pages were not read; **failed attachments**; **links**
  whose content is not in the archive: say what you could not read.
- **Folder names are shortened** and made safe for Windows (`:` → ` -`, `?` → `_`); use `title`
  from `metadata.json`, not the folder name.
