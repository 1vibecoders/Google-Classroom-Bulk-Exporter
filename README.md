# Google Classroom Bulk Exporter

A Chrome extension (Manifest V3) that exports an entire Google Classroom class
into one organized ZIP archive: every assignment, material, question and
(optionally) announcement, with its instructions, metadata and attached files,
kept together in one folder per item.

It runs entirely in your browser with your existing Google sign-in. Nothing is
uploaded anywhere.

```text
English 10 - Period 3/
├── index.html                  ← offline table of contents
├── class-info.json
├── class-description.txt
├── export-report.txt           ← what was downloaded, what failed and why
├── export-report.json
├── Assignments/
│   ├── Macbeth Act 1 Questions/
│   │   ├── description.txt
│   │   ├── metadata.json
│   │   └── Attachments/
│   │       ├── Macbeth.pdf
│   │       ├── Act 1 notes.docx      (Google Doc, exported)
│   │       └── Act 1 slides.pptx     (Google Slides, exported)
│   └── Essay - Unit 1/
│       ├── description.txt
│       ├── metadata.json
│       └── Attachments/
│           └── Self assessment.url   (Google Form, saved as a link)
├── Materials/
│   ├── Poetry Terms/
│   └── Poetry Terms (2)/             (two materials with the same title)
├── Questions/
├── Announcements/
└── Other Coursework/                 (items whose type could not be determined)
```

## Install (load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or Edge/Brave: `edge://extensions`, `brave://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Pin the extension (puzzle-piece icon → pin) so its button is easy to reach.

No build step is needed. Chrome 116 or newer is required.

To produce a ZIP for the Chrome Web Store or for sharing: `npm run package`
(writes `dist/google-classroom-bulk-exporter-<version>.zip`).

## Use

1. Open a class at [classroom.google.com](https://classroom.google.com) (its Stream or Classwork page).
2. Click the extension button. The popup shows the detected class.
3. Optionally click **Scan only** to see how many assignments, materials and
   attachments were found without downloading anything.
4. Click **Export Class**. Leave the Classroom tab open while the popup says
   *scanning class*: the exporter opens the Classwork page (and the Stream, if
   announcements are included), scrolls through it and expands each item.
   It takes the tab back to where you were when scanning finishes.
5. Files then download in the background (you can use the tab normally and
   close or reopen the popup). The ZIP is saved to
   `Downloads/Classroom Exports/<Class> - <date>.zip`; an existing file is never
   overwritten (Chrome adds ` (1)`).
6. When finished the popup shows how many items were processed, files
   downloaded, files that could not be downloaded and links saved.
   **Show Details** lists every failure with its reason; **Save report**
   saves the report as a text file; **Show in folder** opens the archive.

Options (in the popup):

| Option | Default | Effect |
| --- | --- | --- |
| Include announcements from the Stream | on | Also exports Stream announcements and their attachments. |
| Open each item's page for complete instructions | on | Reads each item's own page; finds attachments and full text the Classwork list may hide. Turn off for a faster, list-only export. |
| Google Docs, Sheets and Slides as | Office files | Export Google files as .docx/.xlsx/.pptx (Drawings as .png) or as PDF. |
| Ask where to save the ZIP file | off | Shows Chrome's *Save as* dialog. |

### What is exported

| Resource | Result |
| --- | --- |
| Files stored in Google Drive (PDF, Word, images, video, …) | Downloaded with their original file name. |
| Google Docs / Sheets / Slides / Drawings | Exported (Office formats or PDF, see options). |
| Links in the instructions to Drive files or Google Docs | Downloaded too, marked as `description-link` in `metadata.json`. |
| Google Forms, Drive folders, YouTube videos, Google Sites, other websites, Classroom add-ons | Saved as `.url` shortcuts (open in a browser) and listed in the report. They are not files. |
| Files you cannot open in Classroom, or whose owner disabled downloading | Not downloaded; listed in the report with the reason. |
| Your own submitted work, class comments, private comments, grades, other students' work | Not exported. |

Each item folder has:

- `description.txt` – title, type, topic, due date, points, posting date,
  Classroom link, the full instructions/text and where each attachment went.
- `metadata.json` – the same as structured data, with one entry per
  attachment: title, type, original URL, Drive file id, status
  (`downloaded`, `failed` or `link`), saved file path, original file name,
  size, content type and the error for failures.

Class-level files: `class-info.json` (class id, name, section, counts, topics,
options, the list of items and their folders), `class-description.txt`,
`export-report.txt/.json` and `index.html`.

Dates are kept as Classroom displays them (e.g. `Oct 10, 11:59 PM`), because
Classroom does not show years for the current year or time zones.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `https://classroom.google.com/*` | Read the class you are viewing: inject the exporter into the Classroom tab when you open the popup, and open item pages with your session. |
| `https://drive.google.com/*`, `https://drive.usercontent.google.com/*` | Download Drive files (the same download endpoints the Drive *Download* button uses). |
| `https://docs.google.com/*` | Export Google Docs, Sheets, Slides and Drawings (the *File → Download* endpoints). |
| `https://*.googleusercontent.com/*` | Google serves some downloads and exports from these hosts after a redirect. |
| `scripting` | Inject the exporter into the Classroom tab only when you open the popup (nothing runs on pages otherwise). |
| `downloads` | Save the finished ZIP file to your Downloads folder and show it in its folder. |
| `offscreen` | A hidden extension page that downloads the files and builds the ZIP; unlike the service worker it is not stopped while a long export runs. |
| `storage` | Remember your options and the progress of the current export (session storage, cleared when the browser closes). |

The extension does **not** request `tabs`, `cookies`, `webRequest`, `<all_urls>`
or access to any non-Google site. External links are saved as shortcuts
instead of being fetched, so no broad host permission is needed.

## Privacy

- Everything happens locally in your browser. There is no server, analytics or
  telemetry. Classroom content, attachments and the archive never leave your
  computer except as the ZIP saved to your Downloads folder.
- Requests go only to Google, as you, with your existing session. The exporter
  can only see and download what you can already open in Classroom; it does
  not bypass sharing settings, "disable download" settings, sign-in or DRM.
- The archive does not include your e-mail address, other people's comments,
  grades, the class code or Meet links.

## How it works

```text
 popup ──commands──▶ background service worker ──inject / messages──▶ content scripts (Classroom tab)
   ▲                  (job state machine,              ▲                 discovery: Classwork list,
   │                   chrome.storage.session)         │                 Stream, item pages
   │                          │                        └─ progress / results ─┘
   └── storage.onChanged ─────┤
                              ├──snapshot──▶ offscreen document: download engine + ZIP writer
                              │◀─ progress / blob URL ─┘
                              └──▶ chrome.downloads (saves the ZIP)
```

| Component | Files | Responsibility |
| --- | --- | --- |
| Popup | `src/popup/` | Shows the detected class, counts, progress, results and details. Stateless: renders the job stored by the background, so it can be closed and reopened at any time. |
| Background service worker | `src/background/` | Event-driven job state machine (`preparing → discovering → downloading → zipping → saving → complete/failed/cancelled`) persisted in `chrome.storage.session`, so the worker can be suspended between events. Injects content scripts on demand, navigates the tab between discovery steps, detects navigation away and tab closure, manages the offscreen document and saves the ZIP with `chrome.downloads`. |
| Content scripts (discovery) | `src/content/` | All Classroom DOM knowledge: URL model, link classifier, item extractor, Classwork and Stream scanners, item-page reader, class detection. Produces a JSON *snapshot* of the class. |
| Export engine | `src/engine/` | Download planning per resource type, authenticated downloads with retries, file naming and de-duplication, generated text/JSON files, report, and a streaming ZIP writer. Pure ES modules, unit-tested in Node. |
| Offscreen document | `src/offscreen/` | Hosts the engine; holds downloaded files as Blobs and hands the finished archive to the background as an object URL. |
| Protocol | `src/shared/protocol.js` | Message names, phases and defaults shared by every context. |

### Discovery strategy (and why)

Google Classroom is a dynamic single-page app with obfuscated, frequently
changing CSS class names. The exporter therefore **never uses CSS class names**
and relies on, in order of trust:

1. **URLs and ids.** Items carry `data-stream-item-id`; item pages live at
   `/c/<course>/<a|m|sa|mc>/<id>/details` (assignment, material, question) and
   `/c/<course>/p/<id>` (announcement); topics at `/w/<course>/tc/<topic>`.
   Attachments are recognised by their link target (Drive, Docs, YouTube, …).
   Course/item ids may appear in decimal or as base64 of the decimal; both are
   normalised.
2. **ARIA and semantic structure.** `[aria-expanded]` accordion toggles,
   headings, `[data-drive-id]` attachment containers, form controls (comment
   boxes), `role=progressbar` / `aria-busy` loading indicators.
3. **Layout-free heuristics.** An attachment *card* is a resource link with an
   icon/thumbnail or an aria-label; the description is the largest text block
   that is not the title or a card, contains no controls or images and comes
   before the comments.
4. **English UI text, only as a last resort**, e.g. "Due …", "100 points",
   "Class comments", "Your work". Item pages are fetched with `hl=en` so these
   patterns apply regardless of your Classroom language.

Steps:

1. **Classwork list** (`/w/<course>/t/all`): wait until items render (or the
   page settles empty), scroll until no new items appear, map items to topics,
   then expand each collapsed row, wait for its content to settle, extract it
   and collapse it again.
2. **Stream** (`/c/<course>`, optional): scroll to load older posts; extract
   announcements; "new assignment" notices are used to cross-check the
   Classwork list.
3. **Item pages**: each item's own page is read for the complete text and all
   attachments. The first items are used to pick a strategy: a same-origin
   `fetch` with your session (fast, when Classroom server-renders the page),
   else a hidden same-origin frame that waits for Classroom to render it, else
   list-only (with a warning). Results from the list and the item page are
   merged; attachments are united, never dropped.

### Google Classroom behaviours that needed special handling

- **Lazy loading / infinite scroll** on Classwork and Stream: the scanner
  scrolls and watches the DOM (MutationObserver) until the item count stops
  growing and no loading indicator is visible, instead of fixed delays.
- **Accordion rows**: Classwork rows only render instructions and attachments
  after being expanded; rows are re-located by id after every click because
  Classroom re-renders them. If a click opens the item page instead of
  expanding, the scanner goes back and relies on item pages.
- **Truncated lists**: the Classwork list may show only some attachments
  ("+N more") or shortened text; the item page fills the gap.
- **Duplicate and nested DOM**: the same `data-stream-item-id` appears on
  nested widgets (comment areas) and sometimes twice on a page; items are
  de-duplicated by id and only the outermost node is used.
- **Comments and "Your work"**: links in class comments, private comments and
  your own submissions are excluded so only teacher-provided content is
  exported.
- **Multiple Google accounts**: `/u/<n>/` in the Classroom URL selects the
  account; every Drive/Docs download uses the same `authuser` so files are
  fetched as the account that is viewing the class. Link-shared Drive files
  keep their `resourcekey`.
- **Drive's virus-scan warning** for large files: the "Download anyway"
  confirmation link is followed, as a user would click it.
- **Google-native files** cannot be downloaded directly and are exported
  through the Docs/Sheets/Slides export endpoints.
- **HTML instead of a file**: sign-in pages, "you need access" pages and quota
  pages are recognised and reported as such.
- **Navigation during the scan** (the user clicks elsewhere, reloads or closes
  the tab) stops the export with a clear message instead of exporting a partial
  class silently. Once files are downloading the tab is no longer needed.

## Known limitations

- **Built and tested against a simulation of Classroom.** The extraction logic
  follows Classroom's current URL and DOM conventions and is covered by tests
  against several representative page structures, but this repository's tests
  cannot log in to a real Classroom. Please run the [testing
  checklist](#testing-checklist) on a real class and report anything missing
  (the export report lists every item and warning).
- Classroom's UI changes without notice. If Google changes the page structure,
  items may be missed; the exporter reports this ("No classwork was found…",
  "Item pages could not be read…") rather than failing silently. The selectors
  live in `src/content/item-extractor.js`, `classwork-scanner.js` and
  `stream-scanner.js`.
- Metadata parsing (due date, points, posting date) understands English text.
  Item pages are read in English to make this reliable; if item pages cannot be
  read, metadata in other UI languages may be missing (titles, instructions
  and attachments are still exported).
- Dates are exported as displayed by Classroom (no year for the current year,
  no time zone).
- Drive folders, Google Forms, YouTube videos, Google Sites, Classroom add-ons
  and other websites are saved as links, not downloaded.
- Files are downloaded only if you can download them in Classroom. Files whose
  owner disabled downloading, files not shared with you, and Google files too
  large for Google to export appear in the report as failures.
- Your own submissions, comments, rubrics shown only inside Classroom, grades
  and student work (for teachers) are not exported.
- Very large classes: the archive is assembled from Blobs (Chrome keeps large
  ones on disk), and the final ZIP is a single file. ZIP64 is used
  automatically above 4 GB. Exports of many GB need matching free disk space.
- Paths are kept short (≤ 50 characters for class/item folders, ≤ 90 for file
  names) so the archive extracts on Windows; longer names are shortened, and
  the original name is kept in `metadata.json`.
- Only one export runs at a time.

## Troubleshooting

| Message | What to do |
| --- | --- |
| *No Google Classroom class detected* | Open a class on classroom.google.com (not the class list) and click the extension again. |
| *The page is still loading…* | Wait for Classroom to finish loading, then reopen the popup. |
| *Export stopped because the Classroom tab navigated away…* | Keep the tab on the class until the popup leaves the *scanning class* stage, then export again. |
| Many files fail with *Google asked to sign in* | You are signed in to several Google accounts: open the class from the account that has access (the `/u/<n>/` part of the URL) and export again. |
| *Access denied (HTTP 403)* for a file | The file is not shared with you or its owner disabled downloads; open it from Classroom to check. |
| *Download quota exceeded* | Google limits downloads of popular files; export again later. |

## Development

Requirements: Node.js 22+, Python 3 and `unzip` (used by tests to verify
archives), and Chromium for the browser tests (Playwright's Chromium or set
`CHROMIUM_PATH`).

```bash
npm install          # installs playwright-core (test-only dependency)
npm run check        # manifest references, syntax, no remote code / eval
npm test             # unit tests (Node): URL model, link classifier, file names,
                     # ZIP writer (verified with Python zipfile + unzip -t),
                     # downloader error handling/retries, full export engine
npm run test:dom     # browser tests: discovery against the mock Classroom
                     # (lazy loading, accordions, frame fallback, navigation,
                     # empty class) and against fixture page structures
npm run test:e2e     # loads the real unpacked extension in Chromium, maps the
                     # Google hosts to a local HTTPS mock and drives the popup
                     # through scan → export → saved ZIP (needs port 443)
npm run package      # build dist/google-classroom-bulk-exporter-<version>.zip
```

Layout:

```text
manifest.json
icons/                    extension icons (scripts/make-icons.py regenerates them)
src/
  shared/protocol.js      message names, phases, defaults (all contexts)
  background/             service worker: job state machine, tab + offscreen bridges, storage
  content/                classic scripts injected in order (see tab-bridge.js CONTENT_FILES)
    url-model.js          Classroom URL parsing/building, id normalisation
    resource-classifier.js  link → resource type (Drive, Docs, Forms, YouTube, …)
    item-extractor.js     title, type, description, attachments, metadata of one item
    classwork-scanner.js  Classwork list: loading, topics, expansion
    stream-scanner.js     Stream announcements and coursework notices
    detail-loader.js      item pages via fetch or hidden frame
    page-loader.js        waiting for dynamic lists, infinite scroll
    class-info.js         class name/section detection
    discovery.js          steps + merge into the snapshot
    content-main.js       message handling
  engine/                 ES modules run in the offscreen document
  offscreen/              offscreen document
  popup/                  popup UI
tests/
  unit/  dom/  e2e/       test suites (node:test)
  mock/classroom-mock.mjs simulated Classroom/Drive/Docs used by dom and e2e tests
  fixtures/classroom/     page-structure variants for extractor tests
scripts/                  check, package, icon generation
```

Content scripts are plain scripts (not modules) that publish their API on
`globalThis.GCX`; the service worker, offscreen document and popup are ES
modules. The background injects the content scripts with
`chrome.scripting.executeScript` only when the popup is opened on a Classroom
tab.

### When Classroom changes

1. Run **Scan only** on a real class and compare the counts with what
   Classroom shows; check `export-report.txt` warnings.
2. Save the page (DevTools → Elements → copy outer HTML of a Classwork row,
   an expanded row, an item page and a Stream post), remove personal data, add
   it to `tests/fixtures/classroom/` and write a test in
   `tests/dom/extractor-fixtures.test.mjs`.
3. Adjust the heuristics (prefer URLs, ids and ARIA attributes over classes)
   until the fixture passes, and keep the other fixtures passing.

## Testing checklist

Automated (`npm run check && npm test && npm run test:dom && npm run test:e2e`)
covers the mechanics. On a real Google Classroom account, check:

- [ ] Popup on a non-Classroom tab says no class is detected; on the class list it asks to open a class.
- [ ] Popup on a class's Stream and Classwork pages shows the right class name.
- [ ] **Scan only** counts match the number of assignments, materials and questions on the Classwork page (including topics further down the page and items in "No topic").
- [ ] Export from the Stream page: the tab moves to Classwork (and Stream), then returns to where you started.
- [ ] Every item has its own folder in the right type folder; duplicate titles get ` (2)`.
- [ ] `description.txt` contains the full instructions (compare a long one with Classroom); due date, points and topic are right.
- [ ] Attachments: a PDF, a Word file, an image, a Google Doc, Sheet and Slides each download and open; names match Classroom.
- [ ] An item with more attachments than the Classwork row shows exports all of them.
- [ ] A Drive link typed into the instructions is downloaded too.
- [ ] Google Form, YouTube, Drive folder and website attachments appear as `.url` files and in the report.
- [ ] A file you cannot access (or with downloads disabled) is listed under *Failed* with a reason; the export still completes.
- [ ] Comments, private comments and your own submitted files are **not** in the archive.
- [ ] Announcements with attachments are exported (option on) and skipped (option off).
- [ ] With two Google accounts signed in, exporting a class of the second account (`/u/1/`) downloads its files.
- [ ] A large video attachment (Drive "can't scan for viruses" warning) downloads.
- [ ] Turning off network during an export: affected files are retried and then reported as failed; the export completes.
- [ ] Navigating away or closing the tab while *scanning class* stops the export with a message.
- [ ] Closing and reopening the popup during an export shows live progress; **Cancel** stops it.
- [ ] Exporting twice creates `... (1).zip` instead of overwriting.
- [ ] The ZIP opens with Windows Explorer, macOS Finder/Archive Utility and `unzip` on Linux, including non-English file names.
- [ ] Teacher account: drafts/scheduled items are exported and marked in `metadata.json`; student submissions are not downloaded.
