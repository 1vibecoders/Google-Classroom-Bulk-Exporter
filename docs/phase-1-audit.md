# Phase 1 audit (SPEC.md § 2, § 10, § 33 Phase 1)

Audited 2026-10-12 on Windows 11 (Node, Python 3.14, Playwright Chromium 1194).
Labels: **existed** = already in the repo, **modified** = changed in Phase 1, **new** = written in Phase 1.

## 1. Components and how they connect

| Component | Path | Runtime | Persistence |
|---|---|---|---|
| Browser extension (MV3) | `manifest.json`, `src/` | Chrome/Edge 116+ | `chrome.storage` (job state), ZIP in Downloads |
| Academic Scheduler website | `academic-scheduler/` | React 19 + Vite, static (Vercel or one HTML file) | `localStorage` key `academic-scheduler.v1` |
| `/academic-schedule` skill | `skills/academic-schedule/` | Claude + Python 3 scripts | `schedule.json` files |
| Schedule format | `academic-scheduler/SCHEDULE_FORMAT.md`, `schema/schedule-1.1.schema.json` | — | `schemaVersion: "1.0"` |

Data flow today (no shared runtime, no direct messages between parts):

```
Classroom page --extension--> ZIP (export-manifest.json v1, per-class folders)
ZIP + syllabi + calendars --skill (inventory.py)--> Claude --> schedule.json (format 1.0)
schedule.json --website Import (file or paste)--> localStorage
website Export --> schedule.json (meta.exportId) --skill update mode (meta.basedOn)--> schedule.json
```

Integration boundaries (all file based, all versioned):

- **Extension → skill:** the ZIP layout from `src/engine/archive-content.js` and `account-content.js`. Versioned by `export-manifest.json` `formatVersion: 1` (kinds `class` and `account`). The skill reads it in `scripts/inventory.py`; documented in `references/classroom-export.md`.
- **Skill ↔ website:** `SCHEDULE_FORMAT.md` 1.0. The skill keeps an exact copy (`check_format_copy.py` verifies it; identical today). Both sides validate independently: `academic-scheduler/src/lib/validate.ts` (TypeScript) and `scripts/validate_schedule.py` (Python), checked against the same fixtures in `academic-scheduler/tests/fixtures/` and `examples/`.
- **Extension ↔ website:** none. The extension never talks to the website; SPEC § 12.2 asks for an explicit, versioned interface.

## 2. Inventory

### Working (existed)

- **Extension:** single-class and whole-account export to an organized ZIP; Classwork and Stream scanning; detail pages; Drive/Docs downloads with Office or PDF conversion; links saved as `.url`; export report; cancellation and recovery from navigation; collision-free, cross-platform file names; CRX/ZIP packaging; static check.
- **Website:** Day and Week timeline, Assignments, Classes, Commitments, Settings, Import wizard (validate → preview diff → import → undo), Export, deterministic planner ("Plan unscheduled work", earliest deadline first), recurrence, workload/progress, 5 undo snapshots, unreadable data kept under `academic-scheduler.v1.unreadable-backup`.
- **Skill:** 13-step procedure, inventory of exports and documents, validator, schedule report, chat text view (`render_schedule.py`), stable IDs, update mode with tombstones and `requestedChanges`, packaging.
- **Shared format:** origins (`user`/`generated`/`planner`), `locked` and `overrides` protect the person's edits on re-import; tombstones stop re-creating deleted items; `x-` extension fields are kept.

### Incomplete (existed)

- **Onboarding (SPEC § 5):** only a "Getting started" checklist (`views/timeline/GettingStarted.tsx`) and scheduler settings (`Settings`: week start, day start/end, default due time, session/break lengths, daily cap). No mandatory first-run flow, no persisted onboarding profile.
- **Provenance:** `Source` has `kind`/`id`/`url`/`retrievedAt` but no `sourceType` as in SPEC § 12 (`classroom_api` | `browser_extension` | `json` | `manual`); an extension import is only visible as `kind: "google_classroom"`.
- **Deduplication across paths:** IDs and tombstones prevent duplicates within the JSON path; there is no matching between an item from the extension and the same item typed by hand.
- **Scheduling:** the planner proposes blocks inside the person's study windows; no assessment study planner, infeasibility report or minimal-disruption rescheduling (SPEC § 23–26).
- **Review items:** `issues` (ambiguity, conflict, missing information, workload) exist and show in the UI, but there is no review queue or field-level confidence (only an item-level `Confidence`).

### Broken (found in Phase 1, all fixed — see § 4)

Every one was a Windows-only or date-dependent failure in scripts or tests. None affected the extension's or website's behaviour for users, except the skill printing non-Latin text as `\u....` escapes on Windows.

### Missing (SPEC requirements with no implementation)

- Google Classroom API / OAuth ingestion (§ 12.1); the extension has no `identity` permission.
- Extension → website transfer (§ 12.2).
- Incremental sync and change detection beyond re-import diffing (§ 13).
- Persistent course knowledge base / document store (§ 14).
- AI provider interface, structured extraction, confidence-aware reconciliation, cost controls (§ 15–18). The website is deliberately no-AI; AI work happens only in the skill (Claude).
- Gamification (§ 28).
- Authentication: none anywhere; all data stays in the browser or in files.

## 3. Schemas and migration requirements

| Schema | Version | Where | Migration support |
|---|---|---|---|
| Schedule document | `schemaVersion: "1.0"` (`SUPPORTED_MAJOR 1`, `SUPPORTED_MINOR 0`) | `src/model/constants.ts`, `schema/schedule-1.1.schema.json` | Rejects other majors and newer minors with actionable messages (`lib/validate.ts`); no migration code yet (none needed for 1.0). |
| Website saved state | `academic-scheduler.v1` (`{ doc, snapshots }`) | `src/state/persistence.ts` | Re-validated on load; invalid data backed up, never discarded. |
| Website side keys | `academic-scheduler.v1.export-ids`, `academic-scheduler:setup-guide-hidden` | `lib/exportSchedule.ts`, `GettingStarted.tsx` | — |
| Export manifest | `formatVersion: 1` | `src/engine/account-content.js` | Read by `inventory.py`. |

Requirements for Phase 2:

- Any new field (onboarding profile, `sourceType`, field-level confidence) should be added as an optional field in a **1.1** minor version, so 1.0 files keep importing unchanged. Older website builds reject 1.1 files by design, so the skill must keep writing 1.0 unless a 1.1 field is actually used. `SUPPORTED_MINOR`, the JSON Schema, `SCHEDULE_FORMAT.md` (and its skill copy), `validate.ts` and `validate_schedule.py` must change together.
- Onboarding preferences that are per-device (not part of the schedule) can stay in a separate `localStorage` key; preferences that change scheduling belong in `settings`, so the skill sees them.
- A schema change to saved state needs a load-time migration with the old value kept under a backup key, as `loadState` already does for unreadable data.

## 4. Baseline build and test results

Before Phase 1 (Windows, as cloned): extension unit 33/41 passing, extension DOM 0/4 files, extension e2e 0/2 files, website not installed, skill 76/88.

After Phase 1:

| Suite | Command | Result |
|---|---|---|
| Extension static check | `npm run check` | OK, 21 files referenced, 32 checked |
| Extension unit | `npm test` | 42/42 |
| Extension DOM | `npm run test:dom` | 17/17 |
| Extension e2e | `npm run test:e2e` | 9/9 |
| Website typecheck | `npx tsc --noEmit` | 0 errors |
| Website unit | `npx vitest run` | 839/839 (4 runs in a row) |
| Website e2e | `npx playwright test` | 21/21 |
| Website build | `npm run build` | OK, `dist/academic-scheduler.html` 704 KiB |
| Skill | `python -m unittest discover -s skills/academic-schedule/tests` | 88/88 |
| Format copy | `python skills/academic-schedule/check_format_copy.py` | identical |

Windows test prerequisites: `python3` on PATH (the Store alias is not enough), `unzip` and `openssl` (Git for Windows ships both in `C:\Program Files\Git\usr\bin`), and Playwright's Chromium (`npx playwright-core install chromium`, then `CHROMIUM_PATH=%LOCALAPPDATA%\ms-playwright\chromium-1194\chrome-win\chrome.exe`). Branded Chrome/Edge ignore `--load-extension`, so only the DOM tests run with Edge.

Fixes (all **modified**):

- `src/engine/archive-content.js`: item folders with dotted titles numbered as folders (`Unit 2.5 (2)`, not `Unit 2 (2).5`); test added.
- `scripts/lib/extension-bundle.mjs`, `scripts/check.mjs`, `tests/helpers/browser.mjs`: `fileURLToPath` instead of `URL.pathname` (gave `C:\C:\...` on Windows); extension file list made relative with `/` separators.
- `skills/academic-schedule/scripts/{inventory,schedule_report,validate_schedule}.py`: stdout forced to UTF-8 like `render_schedule.py` already was.
- Skill tests: subprocess output decoded as UTF-8; `.ics` fixture written without newline translation; the time-zone warning expectation skipped when Python has no time-zone database (the validator skips that check by design).
- `academic-scheduler/tests/unit/import-dom.test.tsx`: clock pinned to 2026-10-07 like the other DOM tests (the done screen changes on the day the example schedule starts), and file checks awaited instead of a fixed 20 ms.
- `tests/helpers/extension.mjs`: e2e waits until the extension APIs are bound to the service worker.

## 5. Preserve list (must keep working)

ZIP layout and `export-manifest.json` v1; schedule format 1.0 import of every existing file; `origin`/`locked`/`overrides` protection on re-import; tombstones; `x-` fields round-trip; undo snapshots; unreadable-data backup; skill update mode via `meta.exportId`/`basedOn`; `check_format_copy.py` parity; the single-file HTML build.

## 6. Prioritized next steps (Phase 2, needs decisions)

1. Format 1.1: optional `sourceType` on `Source`, onboarding profile in `settings`, migration path and tests on both validators.
2. Onboarding flow writing to that profile, connected to the planner.
3. Extension → website: export a schedule-ready JSON (or the existing ZIP via the skill) rather than shared storage, per SPEC § 12.2.

Decisions by the project owner (2026-10-12): the website does **not** stay AI-free; a backend with sign-in is acceptable; the mandatory onboarding answers are **available study time** and a **brief description of commitments** (everything else optional).

## 7. Phase 2 progress (2026-10-12)

**New:**
- Schedule format **1.1**: one optional field, `settings.commitmentsDescription` (≤ 2000 characters). Writers write `1.1` only when it is present; a file that says `1.0` but uses it is rejected with an error naming the field. Both validators, `schema/schedule-1.1.schema.json` (renamed from 1.0; also accepts 1.0 files), `SCHEDULE_FORMAT.md` and its skill copy, the fixtures and the example changed together.
- Onboarding wizard (`#/welcome`, `src/views/OnboardingView.tsx`): study time (required) → commitments (required description, optional calendar commitments) → preferences (the existing settings form) → classes and data → review → finish. Each answer is saved in the schedule right away and the current step in `localStorage`, so the wizard resumes after a reload. Until both answers exist, every page except Import and Settings shows the wizard.
- Settings: a "Your commitments" card to edit the description later.

**Modified:**
- Import: the description is pre-ticked when the current schedule has none (§ 16.6), so importing a skill file can complete onboarding.
- `/academic-schedule` skill: reads the description as the person's own statement, copies it unchanged.

**Not done yet:** the deterministic planner does not read the free-text description; it only avoids commitments entered as events. Turning the description into events is a job for the AI provider (Phase 4) or the skill. Automation and review preferences (SPEC § 5.4) wait for the review queue. Duplicate or conflicting availability windows get no new checks; busy events inside study time were already subtracted.

**Tests:** website unit 856/856, website e2e 22/22 (new `onboarding.spec.ts`; tests that build from an empty schedule call `skipOnboarding`), skill 89/89, extension check, unit, DOM and e2e unchanged and passing.

## 8. Phase 3 progress (2026-10-12): Google Classroom API sync

Owner decision: Vercel Functions for the backend, Google sign-in. Details for users and deployers: `academic-scheduler/README.md` → "Google Classroom sync".

**New:**
- Backend in `academic-scheduler/api/` (thin Vercel entry files) and `academic-scheduler/server/`: Google sign-in (authorization code + PKCE + state, server-side), database sessions (hashed ids, HttpOnly/Secure/SameSite=Lax cookies), Google refresh tokens AES-256-GCM encrypted, same-origin checks on every request that changes something, structured logs without content, account export and deletion (revokes Google access, cascades).
- Postgres schema (Neon in production, PGlite in tests): `users`, `sessions`, `sync_runs`, `source_records` — the first part of the per-course knowledge base (normalized Classroom data, content fingerprints, present/missing/inaccessible, first/last seen).
- Sync: active courses + published coursework, read-only scopes; change detection by stable id + fingerprint (no "changed since" filter exists for coursework); disappearance only after a complete course listing; inaccessible or unlisted courses leave their items alone; bounded retries for rate limits and server errors; per-course upserts so a failed run never duplicates or loses records.
- Allowance: 3 counted syncs per rolling 24 h, enforced in one transaction that locks the user's row (simultaneous clicks start one sync); attempts that fail before Google answered are not counted.
- Common import batch (`src/model/importBatch.ts`, SPEC § 12.3) and `src/lib/sync/mergeBatch.ts`: the batch is merged onto the current schedule and goes through the existing import preview. IDs follow SCHEDULE_FORMAT § 14.1, so API, extension and skill items match; only Classroom-owned fields change; deleted items are not brought back; "withdrawn" stays.
- UI: "Google Classroom sync" card in Settings and in the setup's "Classes and data" step; CSP `connect-src` changed from `'none'` to `'self'`.

**Not done yet (next Phase 3 slices):** Drive document download, text extraction and the document part of the knowledge base (Drive needs a restricted scope and Google verification), background reconciliation, a stale "running" sync (server crash) blocks new syncs for 10 minutes and stays counted.

**Later in Phase 3 (2026-10-12):**
- Sync also reads course descriptions, topics, materials, the newest 20 announcements and the person's turned-in state (3 more read-only scopes). Schedule format 1.2: class `announcements`.
- Extension → website (SPEC § 12.2): the popup's **Send to Academic Scheduler** opens the website (optional host permission for that one origin) and an injected script posts the class scans with `window.postMessage` until the page answers with a receipt (protocol `academic-scheduler/extension-import` v1, `src/background/scheduler-bridge.js`). The website validates every field (`src/lib/sync/extensionScan.ts`), reads Classroom's display dates like the skill (`classroomDates.ts`) and turns the scans into the same import batch.
- One import path: the API sync and the extension both go through `src/views/import/fromBatch.ts` (merge, validate, import preview); schedule files go through the same preview.
- Provenance and review: items keep a `source` labelled by workflow (API or extension scan); an unclear due date becomes an `ambiguity` / `missing_information` issue on the item (§ 14.2), which follows the source until the person resolves or dismisses it.
- Known gap: a source that moves a due date before the item's planned task dates makes the merged file invalid, so that whole sync or scan is refused (nothing changes) instead of flagging the conflict.

**Not verified:** the deployment itself — it needs a Google Cloud OAuth client and a Neon database in the owner's accounts. The Neon driver path is typed but untested against a live database; the same SQL runs on PGlite in the tests.

**Tests:** website unit 877/877 (new `server-sync.test.ts` on PGlite with a fake Google API, `mergeBatch.test.ts`), website e2e 25/25 (new `classroom-sync.spec.ts` with a mocked backend).

## 9. Phase 4 (2026-10-12): AI reading and reconciliation

- Provider interface `server/ai/provider.ts` (one call: structured output against a JSON schema, usage, typed errors); Anthropic implementation `server/ai/anthropic.ts` (forced tool call, timeout, bounded retries). Off unless `ANTHROPIC_API_KEY` is set; default model `claude-haiku-4-5-20251001` (`AI_MODEL` overrides).
- Task `server/ai/extract.ts`: per class, new or changed announcements and coursework instructions → due changes of known work, announced assessments, stated estimates. Integrity and prompt-injection rules in the instructions; the output is checked (verbatim quote must occur in the source, known ids, real plausible dates, bounded minutes) and invalid findings are dropped and counted.
- `server/analysis.ts`: cache per source keyed by a hash of the analyzed text + task version + model (`ai_extractions`), at most 20 calls per person per rolling 24 h and 8 per run, usage per run (`ai_runs`), decisions (`ai_reviews`) hide decided proposals (deferred ones return after a week). Daily background job `GET /api/cron/analyze` (Vercel Cron, `CRON_SECRET`).
- Website: `src/lib/ai/proposals.ts` decides deterministically: automatic only for sure, stated findings that fill a gap; person-owned values, Classroom's own due dates and disagreeing texts go to Review; applying by the person adds the field to `overrides`; every result is validated as a whole schedule. Review page (`#/review`) with quote, current/proposed value, reasons, Apply/Edit/Reject/Later; Settings card with automation switch, last run (read vs reused), pending count and budget; analysis runs after each sync.
- Course documents (added after Phase 4): attached Drive files are read by the sync with the optional `drive.readonly` scope (server/documents.ts; Drive modifiedTime/md5Checksum decide re-downloads) and by the extension (protocol version 2 sends the files; the website reads them with src/lib/documents/text.ts). They are stored as `source_records` of kind `document` and analyzed like announcements (first 20,000 characters, with the assignment they are attached to). Signed-out extension users keep them in IndexedDB, without AI.
- Not done: schedule reconciliation after a committed change (Phase 5, the deterministic planner); signed-out extension users get no AI reading (the AI runs on server data); a document no longer attached to anything is not marked missing.
