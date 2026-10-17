# Acceptance criteria (SPEC.md § 32): evidence

Status as of 2026-10-18. **Met** means an automated test or the shipped code shows it; **Met, not live-verified** means it is tested with mocked services but depends on an outside service that was not exercised end to end; **Partly** names what is missing. Test paths are under `academic-scheduler/` unless noted. All suites pass: website unit 1004, e2e 32 (desktop and phone), lint, typecheck, build; skill 88/89 (the one failure needs `pdfinfo`, not installed on the development machine); extension tests pass in the release workflow.

## A. Existing project preservation

| Criterion | Status | Evidence |
|---|---|---|
| The existing scheduler still runs | Met | `tests/e2e/smoke.spec.ts`, every e2e suite runs against the build |
| The extension keeps its capabilities | Met | root `tests/unit`, `tests/dom`, `tests/e2e` (extension); release workflow v1.1.0 green |
| The `/academic-schedule` skill stays usable and is updated | Met | `skills/academic-schedule/tests`; SKILL.md writes format 1.3 `studyTopics` |
| Existing JSON imports keep working | Met | `tests/fixtures/valid/*` (1.0–1.3) in `schema-parity.test.ts`, `export.test.ts`; skill validator reads the same fixtures |
| Existing schedule data is preserved | Met | `importDiff.test.ts` (person-owned fields, idempotent re-import), `store.test.tsx` (unreadable data backed up) |
| No parallel, disconnected scheduler | Met | one planner (`src/lib/planner.ts`) used by the plan dialog, repair, AI apply and the first schedule |

## B. Onboarding

| Criterion | Status | Evidence |
|---|---|---|
| Configure schedule, availability, preferences, automation | Met | `tests/e2e/onboarding.spec.ts`, `onboarding-dom.test.tsx`; automation switch in Settings |
| Existing imported data is reused | Met | `onboarding.spec.ts` (import during setup), `import.spec.ts` |
| Onboarding can be resumed | Met | `onboarding.spec.ts` ("a reload resumes on the Preferences step") |
| Configuration persists and can be edited later | Met | `settings.spec.ts`, `store.test.tsx` |
| Preferences change the scheduling | Met | `planner.test.ts` (session lengths, breaks, daily limit, due time) |
| Invalid configuration gives useful feedback | Met | `validate.test.ts` (settings rules), `editors.test.ts` |

## C. Ingestion

| Criterion | Status | Evidence |
|---|---|---|
| Extension, API, JSON import and manual entry fill one model | Met, API not live-verified with a school account | `extension-import.spec.ts`, `extensionScan.test.ts`, `server-sync.test.ts` (fake Google API), `import.spec.ts`, `editing.spec.ts`; all go through `mergeBatch` / `importDiff` |
| Repeated imports create no duplicates | Met | `importDiff.test.ts` (importing twice changes nothing), `mergeBatch.test.ts` |
| Source references are retained | Met | `mergeBatch.test.ts`, `aiProposals.test.ts` (sources on applied findings) |
| Partial failures are reported | Met | `server-sync.test.ts` (listings that fail are warned about and left as they were) |
| Nothing is fabricated | Met | validators; AI quotes must occur in the text (`evaluation.test.ts`, `server-ai.test.ts`); unreadable files are not sent to the AI |

## D. Knowledge base and AI

| Criterion | Status | Evidence |
|---|---|---|
| Course documents persist between sessions | Met | `server-sync.test.ts` (documents), `documentsUpload.test.ts` |
| Unchanged documents reuse cached results | Met | `server-ai.test.ts` (estimates once; cache by content hash, task version, model) |
| Changed documents are reanalysed, only them | Met | `server-ai.test.ts` (only the changed item is sent again) |
| Deadlines reconciled across documents | Met | `evaluation.test.ts` (two documents disagree: both kept, sent to Review) |
| Confidence and source evidence are kept | Met | `AiProposal` confidence per field and verbatim excerpt; shown in Review |
| Ambiguous or consequential conflicts go to Review | Met | `aiProposals.test.ts`, `evaluation.test.ts`, `review.spec.ts` |
| Provider changeable by configuration | Met | `server/ai/provider.ts` (`AI_PROVIDER`, Anthropic or Gemini); `server-gemini.test.ts` |
| How well the AI reads (§ 31.3 metrics) | **Measured only on demand** | `npm run eval:ai` (live); offline CI scores the checks with recorded answers |

## E. Scheduling

| Criterion | Status | Evidence |
|---|---|---|
| No overlapping events | Met | `evaluation.test.ts` (no conflicts in a planned week), `planner.test.ts`, `repair.test.ts` |
| Fixed events and locked sessions protected | Met | `repair.test.ts`, `planner.test.ts`, manual move confirmation (`timeline-dom.test.tsx`) |
| Work spread over feasible intervals | Met | `planner.test.ts` |
| Large work gets steps and early planning | Met | `planner.test.ts` (tasks, spreading), `aiProposals.test.ts` (AI steps become tasks) |
| Test preparation shares time with homework | Met | `evaluation.test.ts`, `planner.test.ts` |
| Hard constraints beat preferences | Met | `planner.test.ts`, `repair.test.ts` |
| Infeasible plans are reported | Met | `evaluation.test.ts` (past deadline, not enough time), Review "Could not be planned in time" |

## F. Automatic updates

| Criterion | Status | Evidence |
|---|---|---|
| New work and changed deadlines trigger targeted reconciliation | Met | `repair.test.ts`; repair runs on import and AI apply |
| Unrelated sessions stay | Met | `evaluation.test.ts` (disruption 0 after an unrelated due change) |
| Completed work preserved | Met | `repair.test.ts` (done and past sessions never move) |
| Material automatic changes have a reason | Met | undo history records what moved and why (`repair.test.ts` changes) |
| Undo restores the previous state | Met, whole-schedule | `reducer.test.ts`; a later unrelated change is undone too (known limit) |
| Unresolved conflicts are shown | Met | Review "Your schedule", Day card, `review.spec.ts` |

## G. Cost controls

| Criterion | Status | Evidence |
|---|---|---|
| 3 user syncs per rolling 24 h | Met | `server-sync.test.ts` |
| Background processing separate | Met, cron not live-verified | `server-ai.test.ts` (cron route with secret) |
| Cached analysis reused | Met | `server-ai.test.ts` |
| No AI for ordinary scheduling | Met | the planner and repair are deterministic code; no AI call in `src/lib` |
| Usage and failures observable without content | Met | Settings AI usage card; server logs carry ids and counts only |

## H. User experience

| Criterion | Status | Evidence |
|---|---|---|
| The daily planner shows the next action | Met | Day "Now / Next up" card |
| The week reflects real availability | Met | `timeline.spec.ts`, `calendar.test.ts` |
| Assignments and assessments: separate, integrated views | Met | Assignments, Tests (`tests-view.spec.ts`) |
| Review items and infeasible conflicts visible | Met | `review.spec.ts`, Review "Your schedule" |
| Progress and gamification persist correctly | Met | computed from the schedule (`progress.test.ts`), so it persists with it |
| Core workflows work beyond mockups | Met | e2e suites on desktop and phone |

## I. Reliability and security

| Criterion | Status | Evidence |
|---|---|---|
| Schema validation and authorization enforced | Met | validators; every route checks the session and the origin (`server-sync.test.ts`, `server-ai.test.ts`) |
| Cross-user access prevented | Met | `server-ai.test.ts` ("never shows one person another person's documents, AI findings or data") |
| Failures do not corrupt schedules | Met | `server-sync.test.ts` (per-course writes), `store.test.tsx` (backup of unreadable data), import validation before commit |
| Tests cover scheduling and ingestion | Met | see above |
| Build, types, lint and tests pass | Met | `npm run build`, `typecheck`, `lint` (ESLint, added 2026-10-18), `test`, `test:e2e` |

## Not verified against the real services

- Google Classroom and Drive with a real school account (schools may block access or `drive.readonly`).
- How accurately the real AI reads the evaluation set: run `npm run eval:ai` with a key.
- The Vercel daily job (`/api/cron/analyze`) firing on schedule.
- A very large extension send end to end, and the AI account's rate-limit tier.
