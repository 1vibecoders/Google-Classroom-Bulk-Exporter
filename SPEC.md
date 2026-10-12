PART I OF III — PROJECT CONTEXT, EXISTING SYSTEM AUDIT, ONBOARDING, AND PRODUCT REQUIREMENTS

1\. Your Role and Primary Objective

You are working on an existing academic scheduling ecosystem. Your task is to expand, integrate, and improve what has already been built into a reliable, production-quality academic planning application.

This is not a greenfield project. Before modifying anything, inspect the existing codebase, understand its architecture, identify what is already implemented, and preserve working functionality wherever possible.

The existing ecosystem includes:

An academic scheduler website that manages academic tasks and schedules.

A browser extension that can retrieve and port information from Google Classroom when the user has access to it.

An /academic-schedule skill that provides the existing schedule-generation and import workflow.

A JSON-based schedule import system that allows schedule data to be generated externally and imported into the scheduler.

Existing scheduling data, configuration, UI components, and other project-specific functionality that must be discovered through code inspection.

Your objective is to develop these existing components into a cohesive system with a shared data model, configurable onboarding, reliable academic document processing, AI-assisted planning, and deterministic schedule management.

Do not assume that every component is implemented exactly as described here. Verify the actual implementation before deciding what to change.

Core directive

Inspect first, plan second, implement third.

Do not immediately rewrite the application, replace its framework, discard existing data structures, or create parallel implementations of features that already exist.

After auditing the project:

Identify implemented, partially implemented, missing, and broken functionality.

Determine which components can be extended directly.

Identify integration problems between the extension, website, skill, and JSON workflow.

Produce a concise implementation plan ordered by dependency and risk.

Then proceed with implementation unless a genuine blocker requires clarification.

Do not stop after producing an audit or a proposal. The ultimate objective is a working, integrated application.

If this prompt is being supplied in multiple parts, treat all parts as one specification. Read and reconcile the complete specification before making architectural decisions that could conflict with later requirements.



2\. Existing Project Audit

Before writing code, inspect the repository and all relevant project files.

At minimum, investigate:

The website's framework, routes, components, state management, and persistence layer.

Existing schedule schemas, event models, task models, and date/time handling.

Current schedule-generation logic and any AI integrations.

The browser extension's manifest, permissions, content scripts, background scripts, data extraction logic, and import/export mechanisms.

The /academic-schedule skill, including its instructions, schemas, reference files, and existing scheduling workflow.

Existing JSON import and export formats, validation logic, and compatibility requirements.

Current onboarding or settings pages, if any.

Existing calendar, daily task list, assignment views, study planning, progress tracking, and gamification.

Existing tests, build scripts, linting, type checking, and deployment configuration.

Existing data persistence and any migration strategy.

Current authentication and authorization behavior, if present.

Existing documentation and known limitations.

Inspect the actual implementation rather than relying exclusively on README files or descriptions.

Where the repository includes multiple packages, applications, or related directories, establish how they interact. Do not assume the extension and website share a runtime or can directly share local storage.

Produce an implementation inventory

Organize the findings into four categories:

Working: implemented and sufficiently reliable.

Incomplete: implemented but missing important functionality.

Broken: present but failing, inconsistent, or unreliable.

Missing: required by this specification but not implemented.

For every significant change, identify the affected components and whether the change requires a schema migration, compatibility layer, or update to the skill or extension.

Do not remove an existing capability merely because a new architecture would be easier to implement without it.

Preserve backward compatibility

Existing users may already have schedules, JSON exports, configuration, or imported coursework.

Therefore:

Preserve existing data wherever possible.

Support existing JSON formats when practical.

Introduce explicit versioning and migrations for changed schemas.

Validate legacy imports before transforming them.

Never silently discard unknown fields or user-created data.

Provide actionable errors when a legacy format cannot be imported safely.

Avoid duplicate assignment, event, or course records when importing the same data repeatedly.

Do not perform destructive migrations without an explicit, reversible migration strategy.



3\. Product Vision

The application should function as an academic planning system that understands a student's actual coursework and helps the student organize it into a feasible schedule.

It should not be merely a calendar, a to-do list, or an AI chatbot.

It should maintain a persistent representation of the student's courses, assignments, deadlines, assessments, study materials, availability, preferences, and scheduled work.

The system should help answer questions such as:

What must I complete today?

Which assignments should I begin before their deadlines?

How much time should I reserve for each assignment?

Which upcoming assessments require preparation?

What should I work on during a particular study session?

How should my schedule change when a teacher moves a deadline?

What happens when an unexpected assignment is announced?

Is my current workload feasible given my actual availability?

Which extracted deadlines or scheduling decisions need my confirmation?

The application should reduce the amount of manual schedule maintenance required from the student without taking control away from them.

Product priorities

Implement these priorities in order:

Correctness and reliability: dates, deadlines, time zones, event conflicts, imports, and scheduling constraints must be handled correctly.

Academic usefulness: the system must identify obligations and generate realistic, actionable work sessions.

Automation with oversight: reliable changes should be handled automatically, while ambiguous or consequential changes should be surfaced for review.

Transparency: users should be able to determine where extracted information came from and why a scheduling decision was made.

Usability: the application should make the student's next action obvious without requiring excessive configuration or navigation.

Progress and motivation: provide lightweight progress tracking and rewards without compromising scheduling quality.

Do not prioritize decorative UI, elaborate gamification, or speculative features over a reliable scheduling pipeline.



4\. Required System Components

The final system must preserve and integrate the following components.

A. Scheduler website

The website is the primary interface for viewing, editing, and managing the student's schedule.

It should own the authoritative application-level schedule and persist the user's:

Courses.

Assignments and other academic obligations.

Assessment dates and preparation plans.

Scheduled work sessions.

Fixed events and availability.

Preferences and onboarding configuration.

Review items and unresolved conflicts.

Completion status and progress.

Import history, source provenance, and relevant version history.

Inspect the existing persistence architecture before introducing another database or state store.

If the current application is local-only, evaluate the implications of adding account-based server-side persistence. Do not introduce a backend, authentication provider, or hosting dependency without first understanding the current architecture and the requirements in the remaining specification.

The architecture must support a clean separation between user-specific data and shared application logic. One user's coursework, schedule, documents, or preferences must never leak into another user's account.

B. Browser extension

The existing extension is an important ingestion pathway, not a disposable prototype.

Preserve its current working capabilities and determine how to improve its reliability, extraction, validation, and transfer of Google Classroom data into the scheduler.

The extension must not be treated as a way to bypass school restrictions, authentication controls, or access permissions. It may only retrieve information the user is legitimately able to access.

The extension and website may have different technical constraints. Establish an explicit interface between them rather than relying on undocumented assumptions about shared storage.

C. /academic-schedule skill

The existing skill is part of the workflow and must be audited and updated as necessary.

Its role should remain compatible with the website's data model and JSON import format. It should be able to produce or help produce structured academic schedule data without inventing assignments, dates, class periods, or user preferences.

Inspect the existing skill before changing its instructions. Preserve useful logic, reference materials, and established conventions.

If the skill and website currently use different schemas, establish a canonical schema and provide a deliberate compatibility or conversion layer.

D. JSON import and export

JSON must remain a supported interoperability mechanism.

The system should be able to validate incoming schedule data, explain import failures, detect duplicates, and safely merge or replace data according to an explicit user-selected operation.

Where practical, JSON exports should contain enough version and provenance metadata to support reliable re-importing and migration.

Do not assume that importing JSON should overwrite the entire schedule. The user should be able to distinguish between adding new data, merging updates, and replacing existing data when those operations are supported.

E. Shared canonical data model

All supported ingestion paths must eventually populate the same canonical representation of courses, assignments, assessments, documents, schedule events, and user preferences.

Do not create separate competing definitions of an assignment for the extension, skill, AI pipeline, and website.

An assignment imported through the extension and the same assignment imported through JSON should resolve to one logical record when the available evidence supports that match.

Part II will define the ingestion and AI processing architecture in greater detail.



5\. Mandatory Onboarding and Initial Configuration

Build a proper onboarding flow for first-time users. This is a required product feature, not an optional settings page.

The application must not assume that every student follows the same school schedule, studies for the same amount of time, prefers the same scheduling style, or wants the same level of automation.

The onboarding experience should gather enough information to generate a useful initial schedule without forcing the user to configure every possible preference before using the application.

Use a multi-step wizard with clear progress, sensible defaults, the ability to go back, and the ability to skip genuinely optional questions. Persist progress so that refreshing or leaving the page does not unnecessarily erase completed steps.

5.1 Step One: School schedule and academic structure

Collect or import the information needed to understand the student's academic week.

Potential fields include:

School days.

Class periods and their start/end times.

Course names and the corresponding periods.

Rotating schedules, such as A/B days, if applicable.

School start and end times.

Commute duration and recurring commute times.

Lunch, free periods, study halls, and other recurring blocks.

Holidays, breaks, and exceptional school-day patterns.

Reuse existing schedule information when available instead of asking the user to enter it again.

Support manual entry and JSON import. Where the existing system supports an appropriate import route, offer it as an alternative.

Do not assume that every school has the same number of periods or uses a Monday-through-Friday timetable.

Recurring school events should be represented correctly, including exceptions, holidays, and time zones where relevant.

5.2 Step Two: Availability and personal commitments

Determine when the student can realistically work.

Allow the user to specify:

Regular weekday availability.

Weekend availability.

Recurring extracurricular activities.

Fixed appointments and commitments.

Preferred sleep and wake times, if they want the scheduler to use them.

Periods during which academic work should not be scheduled.

Optional buffers before or after commitments.

One-time exceptions to their usual availability.

Distinguish between unavailable time and merely undesirable time.

For example, a student might prefer not to work after 9 PM but could occasionally make an exception when a deadline requires it. The scheduler must not treat a soft preference as an absolute constraint unless the user explicitly configures it that way.

Do not schedule work during classes, fixed appointments, or other genuinely unavailable intervals.

5.3 Step Three: Workload and study preferences

Ask how the user wants the system to distribute work.

Provide configurable preferences for:

Preferred study-session length.

Minimum and maximum session duration.

Break frequency and duration.

Whether the user prefers short, frequent sessions or fewer, longer sessions.

Maximum desired daily academic workload.

How much time to reserve for homework versus assessment preparation.

How early to begin preparing for tests and major assessments.

How to distribute large assignments across multiple days.

Whether to leave spare capacity for unexpected work.

Whether to prioritize completing work early or use more of the time available before a deadline.

How strongly to avoid late-night sessions or excessive workload on particular days.

Use sensible defaults for unanswered optional questions.

The scheduler should distinguish between the user's preferences and hard constraints. Preferences influence optimization; they must not override deadlines, fixed commitments, or other non-negotiable requirements.

Avoid asking the student to estimate every assignment's duration manually during onboarding. Initial workload estimates should be derived from available assignment information where possible and remain editable afterward.

5.4 Step Four: Automation and review preferences

Let the user configure how much autonomy the application should have.

At minimum, distinguish between:

Automatically accepting high-confidence extracted information.

Reviewing uncertain deadlines or conflicting source information.

Automatically rescheduling flexible work sessions when new obligations arrive.

Protecting user-locked sessions from automatic changes.

Receiving notifications or visible alerts when important changes are detected.

The system should provide a configurable confidence threshold, subject to safe defaults.

High-confidence information may be processed automatically when supported by adequate evidence. Low-confidence or consequential ambiguity should be sent to a review queue.

Do not let a numerical confidence score override clear evidence that a source has been superseded, that two documents conflict, or that a deadline is materially ambiguous.

Automatic rescheduling must not silently change fixed commitments or explicitly locked events.

5.5 Step Five: Data sources and initial import

Help the user connect the academic information they already have.

Provide a clear setup path for whichever of the following are available:

The existing browser extension.

An authorized Google Classroom integration, if supported and permitted.

Existing JSON schedule exports.

Manual document uploads.

Manually entered courses, assignments, or teacher announcements.

Do not require every ingestion method to be configured. A user should be able to start with JSON or manual entry and configure other integrations later.

Explain the practical difference between the available methods and their permissions.

If Google OAuth access is unavailable or blocked by school policy, communicate the limitation accurately and allow other legitimate ingestion paths to remain usable. Do not promise that the extension can overcome an administrator-imposed restriction.

When data is imported, show a concise preview of what will be added or updated before any consequential merge or replacement.

Avoid duplicate records when a user imports the same schedule or coursework more than once.

5.6 Step Six: Initial schedule review

Before the onboarding flow is marked complete, provide a review of the information the application will use.

Show the student:

Their recognized courses and academic structure.

Recurring commitments and available study periods.

Upcoming assignments and deadlines that have been extracted.

Any unresolved conflicts or missing critical information.

The proposed initial schedule or the next steps required to generate it.

Important preferences that will influence automatic scheduling.

Allow the user to correct mistakes without restarting onboarding.

Do not invent missing class periods, assignment dates, or other factual information to make the initial schedule appear complete. Mark unknowns explicitly and ask for clarification when they materially affect scheduling.

After confirmation, persist the onboarding configuration and use it as the initial scheduling profile.

5.7 Progressive configuration after onboarding

Onboarding is not the only place where configuration can happen.

Create or extend a settings interface that lets users modify the same preferences later. Changes should take effect in future scheduling and, where appropriate, trigger a controlled reconciliation of existing flexible work sessions.

Do not make users repeat the onboarding process to change a study preference or add an extracurricular commitment.

When settings change, explain any significant schedule consequences before or after applying them, depending on the operation's impact.

5.8 Onboarding implementation requirements

The onboarding flow must be:

Functional, not a static mockup.

Connected to persistent user-specific configuration.

Validated, with useful error messages.

Resumable after interruption.

Compatible with existing imported data.

Designed for both initial setup and later editing.

Integrated with the actual scheduling engine.

Tested for incomplete answers, invalid times, duplicate events, and conflicting availability.

Do not build a wizard that merely collects preferences without passing them into the actual scheduler.

Avoid asking for information that can already be reliably inferred from imported data. When the system has a probable answer but insufficient confidence, show it for confirmation instead of silently assuming it is correct.



6\. Two Complementary Planning Systems

The product must support two distinct but integrated types of academic planning.

6.1 Assignment-centered daily planning

This is the primary planning layer.

For each assignment, the system should maintain relevant information such as:

Course and assignment title.

Source and provenance.

Due date and time, if known.

Estimated workload.

Completion status.

Priority.

Milestones or subtasks.

Scheduled work sessions.

Relevant teacher instructions or source documents.

Confidence and review status for extracted fields.

The system should determine when work needs to begin and distribute it across available time rather than simply placing every assignment on its due date.

A large assignment due Friday might need several sessions earlier in the week. A short assignment due tomorrow might need only one session today.

Workload estimates must remain estimates, not fabricated facts. Users should be able to edit them.

6.2 Assessment-centered study planning

The secondary planning layer focuses on learning and preparation for tests, quizzes, exams, and other assessments.

Use relevant course materials—such as study guides, notes, handouts, and teacher-provided review materials—to identify the topics and materials the student should independently review.

The system may recommend study activities, for example:

Review the relevant class notes.

Independently attempt practice problems.

Use retrieval practice to recall key concepts.

Review teacher-provided study guides.

Revisit difficult topics in a later session.

Practice a skill using the resources the student already has.

It must not fabricate the contents of unavailable study materials or pretend to know the exact assessment scope when the sources do not establish it.

Study sessions must feed into the same schedule as assignment sessions. They must respect the user's availability, fixed events, workload limits, and existing obligations.

Avoid double-counting time when the same academic task appears in both an assignment plan and an assessment preparation plan.

6.3 Unified schedule

The two planning systems must share one scheduling engine and one calendar.

Do not implement independent assignment and study calendars that can overlap or make contradictory claims about the student's available time.

The scheduler should reconcile both types of work when deciding what fits into a day or week.



7\. Academic Integrity Boundaries

The application is authorized for academic scheduling, time management, and work planning. It is not authorized to complete academic work on the student's behalf.

Treat this as a core product requirement across the website, extension, skill, AI prompts, document-processing pipeline, and any future provider integration.

Permitted behavior

The system may:

Extract assignment instructions and deadlines.

Identify required deliverables from teacher-provided materials.

Estimate workload and recommend when to begin.

Break an assignment into neutral planning milestones.

Recommend when to review notes or practice a skill.

Suggest time allocations and study strategies.

Track progress and completion.

Identify scheduling conflicts and missing information.

Help the student decide when and where to work.

Prohibited behavior

The system must not perform the substantive academic work the student is expected to complete independently.

Examples include:

Solving assigned problems.

Writing an essay or generating its substantive argument.

Producing interpretations, analyses, or evidence for an assigned literary or historical response.

Writing answers to graded questions.

Completing graded assessments.

Generating substantive assignment deliverables under the guise of task decomposition.

A neutral planning milestone such as "develop your own thesis and supporting argument" is acceptable. Generating the thesis and supporting argument for the student is not.

Likewise, "independently attempt the assigned problems" is acceptable; solving those problems is not.

The system may extract and summarize assignment requirements for planning purposes, but it must not turn those requirements into completed academic work.

Enforcement

These boundaries must be encoded into the relevant system instructions and processing logic rather than appearing only in user-facing documentation.

Where an AI provider is replaceable, the same academic integrity requirements must apply to every provider.

If the user requests substantive academic work through a scheduling feature, the application should redirect the request toward planning, time allocation, or independently performed work.



8\. User Experience and Progress Tracking

The product should make it clear what the student should do next.

The core experience should emphasize:

Today's scheduled work.

Upcoming deadlines.

Work that is overdue or at risk.

Assessment preparation.

Available time.

Unresolved extraction or scheduling conflicts.

Progress toward assignment milestones.

Use a lightweight gamification system in the initial release.

Appropriate initial features include:

Progress indicators.

Assignment milestones.

XP or equivalent progress rewards.

Levels.

Basic achievements.

Rewards should reflect meaningful planning and learning behaviors rather than simply maximizing the number of tasks marked complete. Avoid incentives that encourage users to overwork, create unnecessary tasks, or sacrifice sleep to maintain a streak.

More elaborate quests, streak systems, narrative progression, and other advanced gamification can be deferred until the scheduling engine is reliable.

Do not let gamification interfere with the schedule's correctness or overwhelm the primary interface.



9\. Quality Standards for This Phase

As you audit and begin implementing the existing project, follow these standards:

Do not fabricate data. Missing information must remain missing until it is supplied or reliably extracted.

Do not silently discard data. Imports, migrations, and synchronization must preserve relevant information.

Do not create duplicate sources of truth. Use a canonical model and explicit integration boundaries.

Do not confuse preferences with constraints. A preference can influence the schedule; a hard constraint must be enforced.

Do not move protected events automatically. Fixed and user-locked events require protection.

Do not over-automate ambiguous information. Provide provenance and a review mechanism.

Do not call AI unnecessarily. Reuse cached results and avoid reprocessing unchanged documents.

Do not weaken academic integrity safeguards. The system plans academic work; it does not complete it.

Do not break existing workflows. The extension, skill, JSON import/export, and website must remain usable as the project evolves.

Do not substitute a prototype for a working feature. Buttons, forms, import flows, onboarding steps, and schedule controls must perform their intended actions.

Use appropriate automated tests and manual verification. Any new functionality must be connected to the real data flow, not implemented as disconnected UI.



10\. Deliverables for Part I

After inspecting the project and reconciling this specification with the existing implementation, establish:

An accurate inventory of the current website, extension, /academic-schedule skill, and JSON workflows.

A list of existing functionality that must be preserved.

A gap analysis against the requirements above.

A proposed canonical data model and integration boundaries, aligned with the existing architecture.

An onboarding implementation plan, including persistence and how each preference affects scheduling.

A prioritized implementation plan that avoids unnecessary rewrites.

An initial set of tests for onboarding, existing imports, compatibility, data validation, and academic integrity boundaries.

Then begin implementation in the existing project, following the complete specification as additional parts are supplied.

Do not treat this part as the complete project specification. Later parts will define the ingestion and AI processing architecture, incremental synchronization, persistent course knowledge base, confidence-aware reconciliation, scheduling algorithms, automatic rescheduling, provider abstraction, cost controls, and end-to-end acceptance criteria.

When reporting progress, distinguish clearly between functionality that already existed, functionality you modified, and functionality you implemented from scratch. Do not claim that a feature works unless you have verified it.

PART II OF III — DATA ARCHITECTURE, INGESTION, AI PIPELINE, AND AUTOMATED RECONCILIATION

11\. Canonical Data Architecture

Implement a coherent data architecture that integrates the existing scheduler website, browser extension, /academic-schedule skill, and JSON import/export workflow.

Before changing schemas, inspect the models already in use. Extend and migrate existing models where practical instead of creating redundant ones.

The system must distinguish between:

Raw source data: what was imported or extracted from Google Classroom, documents, announcements, manual input, or JSON.

Normalized academic records: canonical courses, assignments, assessments, events, documents, and related entities.

AI-derived interpretations: extracted deadlines, workload estimates, assessment topics, document summaries, and other inferred information.

Scheduling decisions: proposed or committed work sessions, milestones, priorities, and rescheduling changes.

User configuration: availability, scheduling preferences, automation settings, onboarding progress, and locked events.

Audit and synchronization metadata: source versions, synchronization checkpoints, processing status, confidence, and change history.

Do not collapse these into one large JSON object or one undifferentiated database table.

11.1 Recommended entity relationships

Use the existing architecture's conventions, but ensure that the underlying model supports the following conceptual entities.

User and configuration

User or account, if account support exists or is introduced.

User preferences.

Onboarding state.

Availability rules and exceptions.

Integration configuration.

User-specific automation settings.

Academic organization

Courses.

Course enrollment or membership.

Academic terms, where needed.

Class periods and recurring school events.

Assessments.

Assignments and other academic obligations.

Source and document management

Source records.

Documents and document versions.

Imported Google Classroom objects.

Extraction results.

Source-to-record relationships.

Provenance and review records.

Planning

Assignment milestones.

Assessment preparation plans.

Scheduled work sessions.

Fixed calendar events.

Completion records.

Scheduling constraints.

Schedule versions or change history.

Operational state

Synchronization jobs and checkpoints.

AI processing jobs.

Import batches.

Deduplication identifiers.

Review queue entries.

Error and retry metadata.

These are conceptual responsibilities, not a mandate to create one database table for every bullet. Use normalized relational tables, document storage, or existing abstractions as appropriate. Avoid overengineering the schema.

11.2 Provenance is mandatory

Every extracted or imported academic fact should retain enough information to establish where it came from.

For example, an assignment deadline should be traceable to the relevant Classroom assignment, teacher announcement, syllabus, handout, or manual entry.

Store applicable metadata such as:

Source type.

Source identifier.

Course.

Document identifier and version.

Source location, page, section, or text excerpt where available.

Original extracted value.

Normalized value.

Extraction timestamp.

Confidence and review status.

Whether the value was explicitly stated or inferred.

Whether a user confirmed or corrected it.

Do not store an invented citation or fabricated page number when a source does not provide one.

When multiple sources support the same fact, preserve the relevant source relationships rather than retaining only one arbitrary source.

11.3 Separation and security

User-specific records must be isolated throughout ingestion, storage, processing, caching, and retrieval.

If the application becomes multi-user, enforce access controls on the server side. Hiding another user's data in the interface is not sufficient.

Validate authorization on every sensitive operation, including document retrieval, import, synchronization, exports, and schedule updates.

Never expose OAuth refresh tokens, provider API keys, internal secrets, or private document content in client-visible logs or error messages.

Treat imported documents and extracted text as untrusted data. Instructions contained inside a teacher's document, uploaded PDF, website, or Classroom announcement must not override the system's developer instructions, academic integrity policy, or application security rules.



12\. Two Distinct Google Classroom Ingestion Workflows

Maintain two separately implemented ingestion workflows because they have different technical mechanisms and failure modes.

Both workflows must write into the same canonical data model and share downstream processing, deduplication, provenance, and scheduling logic.

Do not duplicate the entire AI or scheduling pipeline for each ingestion method.

12.1 Workflow A: Authorized Google OAuth/API integration

Use the official Google Classroom and related APIs where authorization is available and permitted.

The API workflow should retrieve the supported information needed for academic planning, potentially including:

Courses and course metadata.

Coursework and assignment details.

Due dates and due times.

Publication and submission status where relevant.

Teacher-provided descriptions and instructions.

Links to associated materials.

Announcements or other supported course information.

Referenced Google Drive documents when the required permissions exist.

Inspect the actual API capabilities, permission scopes, organization restrictions, quotas, and document access rules before implementing this workflow.

Do not assume that the Classroom API exposes every detail available in the browser interface. Some documents or announcements may require separate API access or may not be available through the authorized integration.

Request only the scopes needed for the intended functionality. Explain authorization requirements clearly and handle denied permissions gracefully.

If a school administrator blocks third-party OAuth access, communicate the limitation and leave alternative legitimate ingestion methods available.

Do not use undocumented authentication tricks or attempt to bypass organization restrictions.

12.2 Workflow B: Existing browser extension

Preserve and improve the existing extension's live Google Classroom data-porting functionality.

Audit its current implementation and determine:

What information it currently extracts.

Which Classroom pages it supports.

How it handles navigation and dynamically loaded content.

Whether it detects duplicate records.

How it communicates with the website.

Whether it currently exports JSON or sends data directly.

How extraction failures are surfaced.

Whether changes to Classroom's interface could silently break extraction.

Extend the implementation incrementally.

The extension should validate extracted data before transferring it, retain useful source identifiers and URLs, and report extraction limitations rather than inventing missing fields.

Prefer explicit, versioned communication between the extension and website. Depending on the existing design, this may be a validated message protocol, an import file, or an authenticated application endpoint.

If data is sent to a server, authenticate and authorize the operation. Do not expose permanent API credentials inside the extension bundle.

If the extension and website communicate locally, validate message origins and payloads, and avoid accepting arbitrary website messages as trusted application commands.

The extension must not assume that every visible page contains complete course data. It should indicate what was successfully extracted and what may be missing.

12.3 Common downstream interface

Both ingestion workflows should produce validated import batches in the same canonical format.

A conceptual interface could resemble:

interface ImportBatch {

&#x20; schemaVersion: number;

&#x20; sourceType: "classroom\_api" | "browser\_extension" | "json" | "manual";

&#x20; importedAt: string;

&#x20; courses: ImportedCourse\[];

&#x20; assignments: ImportedAssignment\[];

&#x20; documents: ImportedDocument\[];

&#x20; announcements?: ImportedAnnouncement\[];

&#x20; warnings: ImportWarning\[];

}

This is illustrative, not a demand to copy these exact names or fields. Adapt it to the existing project's language and schema.

The common import interface must:

Validate the payload.

Authenticate and authorize the importing user.

Normalize dates, identifiers, text, and source metadata.

Match existing courses and academic records.

Identify additions, updates, deletions, and ambiguous matches.

Persist source information.

Queue only the processing work that is actually required.

Report the result to the user.

Do not trigger full AI analysis simply because an import batch arrived. The system must first determine what changed.



13\. Incremental Synchronization and Change Detection

Implement incremental synchronization wherever the source API or extension provides sufficient information.

The objective is to detect and process changes without repeatedly downloading, extracting, and analyzing everything in every course.

13.1 Initial synchronization

On the first successful synchronization:

Retrieve all supported records the user is authorized to access.

Store stable source identifiers and source metadata.

Download or retrieve accessible associated documents as needed.

Create the initial normalized academic records.

Identify duplicate or conflicting records.

Extract relevant academic information.

Build the initial persistent course knowledge base.

Generate a synchronization report.

Initial synchronization may require substantial work. It must still be resumable and robust against partial failures.

13.2 Subsequent synchronization

On later runs:

Identify newly created source objects.

Detect changes to existing objects.

Detect deleted or inaccessible objects where the source supports reliable detection.

Refresh relevant metadata.

Reprocess only affected documents or records.

Preserve unchanged extraction results.

Update the knowledge base and schedule only when necessary.

Use source-specific change tracking mechanisms.

For example, a Google Drive changes feed may support incremental tracking for the relevant Drive resources. Do not assume that every Google Classroom coursework endpoint supports a universal updatedSince filter or equivalent.

Where an API lacks reliable incremental change detection, use the best supported alternative, such as comparing stable identifiers and content fingerprints, checking selected metadata, or performing periodic reconciliation.

Make this distinction explicit in the implementation.

13.3 Content fingerprints and cached extraction

Use stable hashes or equivalent fingerprints to determine whether document content has changed.

Cache expensive processing results against appropriate identifiers, including:

Source document identity.

Content fingerprint or version.

Extraction method or schema version.

AI provider/model and relevant prompt version, when applicable.

Processing configuration that materially affects the result.

If the content and relevant processing configuration are unchanged, reuse the previous result.

If the document changes, reprocess the changed document and then reconcile only the academic records potentially affected by that change.

Changing a model or extraction prompt may invalidate certain cached results. Make invalidation explicit instead of silently mixing incompatible results.

13.4 Deletions and source disappearance

A missing record is not automatically proof that the teacher deleted it.

Distinguish between:

Explicit deletion reported by the source.

Temporary API failure.

Permission revocation.

A course becoming inaccessible.

A record no longer appearing in a partial extraction.

A genuine deletion confirmed through reliable synchronization.

Do not delete a user's academic record merely because one sync failed.

When a source record is deleted or becomes inaccessible, preserve appropriate history and reconcile its downstream effects safely. Do not silently delete completed work, manually entered notes, or user-created scheduling decisions that have independent value.

13.5 User-triggered sync limits

The application must support at most three user-triggered synchronization operations per rolling 24-hour period.

Implement the limit server-side if a backend exists. A client-side button disablement alone is insufficient.

Requirements:

Count user-initiated synchronization attempts consistently.

Enforce the rolling window rather than resetting the counter at midnight.

Display the number of remaining user-triggered syncs and when another becomes available.

Prevent concurrent clicks from accidentally bypassing the limit.

Distinguish synchronization from AI analysis.

Avoid consuming another sync allowance when the user retries a clearly failed operation, if the operation did not actually begin or was rejected before processing.

Define and document exactly when an operation counts as a sync.

Provide actionable feedback when the limit is reached.

This limit must not prevent the system from performing internal processing on data it has already synchronized.

Scheduled background reconciliation is distinct from user-triggered synchronization. It should be able to process queued changes, reconcile previously imported information, and update affected scheduling records without requiring the user to initiate another sync.

Do not use this distinction to secretly perform unlimited repeated external API polling. Background checking must still respect API quotas, school permissions, and resource budgets.

13.6 Synchronization reliability

Implement:

Resumable jobs.

Idempotent processing.

Retry with bounded backoff for transient failures.

Clear distinction between transient and permanent failures.

Rate-limit handling.

Per-source checkpoints.

Partial-success reporting.

Structured operational logs that avoid exposing private content.

A failure halfway through synchronization must not leave the application in a state where every subsequent run creates duplicates or loses previously valid records.



14\. Persistent Course Knowledge Base

The application must maintain a persistent, per-user knowledge base for each course.

This is a core architectural requirement.

Do not treat every schedule-generation request as an isolated operation that starts by rereading every available document.

The knowledge base should preserve relevant course materials and their derived academic information across sessions and synchronization cycles.

14.1 Supported material types

Where accessible and useful, support:

Course syllabi.

Teacher-provided handouts.

Assignment sheets.

Study guides.

Class notes.

Announcements.

Attached documents.

Relevant uploaded files.

User-entered instructions.

Historical versions of source material when needed for reconciliation.

Support common document formats through appropriate parsers or extraction tools already present in the project. Inspect current dependencies before adding new ones.

Do not assume every PDF contains extractable text. Scanned documents may require OCR, and unsupported or unreadable files must be identified explicitly.

14.2 Knowledge-base contents

For each course, maintain:

Source documents and stable references.

Document metadata and versions.

Extracted text or an appropriate processed representation.

Cached extraction results.

Identified assignments and assessments.

Deadline evidence and conflicting date information.

Relevant teacher instructions.

Assessment topics and preparation references.

Relationships between documents and academic records.

Processing status and errors.

Last successful synchronization and analysis timestamps.

Keep the original source information distinct from derived summaries and interpretations.

The system must be able to explain which materials support a given extracted assignment, deadline, or study recommendation.

14.3 Cross-document reconciliation

Important facts may be distributed across multiple documents.

For example:

A syllabus establishes an initial due date.

A newer teacher announcement changes the deadline.

An assignment sheet specifies the deliverable.

A study guide clarifies the scope of an assessment.

The system must reconcile these sources rather than treating every document as an independent, equally current truth.

When a newer source explicitly supersedes an older one, preserve the historical evidence but use the updated value.

When sources genuinely conflict and the conflict cannot be resolved confidently, create a review item.

Do not simply choose whichever document was processed last.

14.4 Search and retrieval

Use targeted retrieval when the AI needs relevant course context.

For example, generating a study plan for a history assessment should retrieve relevant study guides, class notes, and assessment instructions rather than indiscriminately feeding every document from every course into a single prompt.

Retrieval must respect user and course boundaries.

If the existing architecture supports semantic search or embeddings, evaluate whether they improve retrieval quality enough to justify their cost and complexity. Do not add a vector database merely because this is an AI application.

A combination of metadata filtering, full-text search, and targeted semantic retrieval may be sufficient.

The chosen retrieval method must support source attribution and avoid confusing similarly named assignments across courses.



15\. Unified AI Provider Interface

Implement or extend a provider abstraction so the application's AI functionality does not depend on one permanently hardcoded model.

The initial release should use one default free model or lowest-cost suitable model where a genuinely usable option exists. Do not assume that a model is free, available, sufficiently capable, or appropriate without checking the actual provider configuration.

The architecture must permit switching providers or models later without rewriting the scheduling engine, document-processing pipeline, or user interface.

15.1 Provider responsibilities

Separate provider-specific behavior from application logic.

The interface should account for:

Structured output.

Token and usage accounting when available.

Timeouts.

Retry policies.

Rate limits.

Provider errors.

Model identifiers.

Configuration and secrets.

Output validation.

Capability differences.

Optional provider-specific response metadata.

Keep the provider interface narrow and appropriate to the existing project. Do not build a large speculative abstraction for providers that have no planned use.

15.2 AI task boundaries

AI tasks should have explicit responsibilities, such as:

Extracting academic information from documents.

Interpreting assignment requirements for planning.

Estimating workload when evidence is sufficient.

Reconciling potentially conflicting source information.

Identifying relevant assessment preparation topics.

Proposing neutral work milestones.

Proposing candidate schedule allocations when appropriate.

The deterministic scheduling engine remains responsible for enforcing scheduling constraints.

AI output must never be trusted as valid merely because it is valid JSON.

Validate output against schemas, known source records, date constraints, user configuration, and academic integrity rules before committing changes.

15.3 Future provider flexibility

Keep configuration flexible enough to accommodate a stronger paid model or school-funded API credits in the future.

Do not make the application depend on a particular future funding decision or model release.

The initial implementation does not require multi-model routing. However, the provider abstraction should not make future routing impossible.

Do not require users to install an AI skill, supply their own API key, or connect an external AI account as a prerequisite for the core application unless the existing product already imposes such a requirement.

If the default provider is unavailable, explain the failure clearly. Do not silently substitute an unconfigured provider or send private course data to an unexpected third party.

15.4 Configuration and privacy

Store provider secrets only in appropriate server-side secret storage or secure environment configuration.

Never commit secrets to the repository or embed privileged API keys in browser-delivered code or the extension package.

Document the data sent to the provider, the purpose of each request, and the relevant retention or privacy implications.

Send only the information needed for a specific task.



16\. Structured Extraction and Confidence-Aware Reconciliation

Build a structured extraction pipeline that converts unstructured course material into validated academic records.

16.1 Extraction pipeline

For each relevant source:

Retrieve the source content.

Determine whether its content or relevant metadata changed.

Reuse valid cached extraction results where possible.

Extract candidate academic facts when needed.

Validate the structured result.

Attach provenance and field-level confidence.

Compare the result against existing records and other sources.

Identify additions, updates, conflicts, and unresolved ambiguity.

Commit safe changes and queue uncertain ones for review.

Trigger targeted schedule reconciliation when a committed change affects planning.

Keep this process idempotent so repeated processing does not produce duplicate assignments, repeated milestones, or duplicate study sessions.

16.2 Confidence must be field-specific

Do not assign one confidence score to an entire assignment and use it for every field.

For example, the system might identify an assignment title with high confidence while remaining uncertain whether its deadline is Thursday or Friday.

Track confidence separately for materially different fields, including:

Assignment title and identity.

Course association.

Due date and due time.

Workload estimate.

Assessment date.

Assessment scope.

Whether a newer source supersedes an older one.

Where possible, distinguish explicit facts from inferred values.

A missing deadline must not be converted into a high-confidence guess simply because the scheduling engine prefers every assignment to have a due date.

16.3 Review threshold and source reconciliation

Use a configurable confidence threshold with sensible defaults.

High-confidence facts may be committed automatically when they are adequately supported and consistent with source precedence rules.

Low-confidence facts, unresolved conflicts, and consequential ambiguity should be surfaced in a review queue.

However, confidence scores must not replace evidence-based source reconciliation.

Consider:

Whether a source explicitly supersedes another.

Source type and authority.

Publication or modification time, where reliable.

Whether the content refers to the same assignment or assessment.

Whether the relevant source is current and accessible.

Whether the proposed change would materially affect the student's schedule.

A newer source is not automatically authoritative in every circumstance. For example, a new document might repeat an old date without actually changing it.

16.4 Review interface

Provide a usable review interface showing:

The field or record in question.

The proposed normalized value.

The previous value, if any.

The supporting source and relevant excerpt.

Why the system considers the result uncertain or conflicting.

Available actions, such as confirm, edit, reject, or defer.

Review decisions should persist and influence subsequent reconciliation so the same resolved conflict does not repeatedly return without a material change in the evidence.

Do not silently overwrite a user-confirmed deadline with a weaker inference.

If new evidence strongly contradicts a confirmed value, surface the discrepancy instead of discarding either the user decision or the new evidence.



17\. Continuous Reconciliation Without Uncontrolled Rescheduling

The application should continuously reconcile its internal academic records and schedule as new information becomes available.

This is distinct from continuously polling Google Classroom or repeatedly running AI over every stored document.

Reconciliation should operate on detected changes, queued work, or scheduled internal checks.

17.1 What should trigger reconciliation?

Examples include:

A new assignment being imported.

A teacher changing a deadline.

An assessment date being updated.

A relevant course document changing.

A user editing their availability.

A user changing study-session preferences.

A previously unresolved source conflict being resolved.

A scheduled work session being completed or missed.

A user manually changing an assignment's workload estimate.

17.2 Targeted updates

When one assignment changes, determine which parts of the schedule are affected.

Reconcile the relevant assignment and the work sessions that may need to move. Do not regenerate the entire schedule indiscriminately.

Preserve unaffected records and sessions whenever possible.

For example, changing one homework deadline should not rearrange every class period, personal appointment, and unrelated assignment in the user's week.

17.3 Automatic updates with undo

The application should automatically apply safe, high-confidence changes where the configured automation policy permits them.

However:

Fixed events must not be moved automatically.

Explicitly locked work sessions must remain protected.

User-confirmed information must not be silently overwritten by weak inferences.

Significant unresolved conflicts must enter the review queue.

An infeasible schedule must not be presented as if all obligations fit successfully.

Record material changes and provide a practical way to undo them.

An undo operation should restore the relevant prior scheduling state without erasing unrelated work completed since that version.

Maintain enough history to explain why a session moved, what triggered the change, and which constraints or preferences were considered.

17.4 Deterministic scheduling remains authoritative

AI can interpret source material and propose reasonable work plans, but it must not be allowed to violate hard scheduling constraints.

Every proposed change must be validated against the current canonical schedule and user configuration before being committed.

If an automatic update cannot be made feasibly, preserve the current valid schedule and identify the conflict for the user.

Do not fabricate extra availability or silently move a deadline to make the schedule appear feasible.



18\. AI Cost and Processing Efficiency

The system should minimize unnecessary AI calls while preserving academic accuracy.

18.1 Required cost-control mechanisms

Implement, where applicable:

Incremental synchronization.

Content fingerprinting.

Cached document extraction.

Reuse of valid structured extraction results.

Targeted reanalysis of changed sources.

Retrieval of relevant course context rather than entire knowledge bases.

Structured output with explicit schemas.

Deduplication before AI processing.

Bounded retries.

Usage and cost logging where provider information permits.

Separation between external data synchronization and AI analysis.

Do not invoke an AI model merely to perform a deterministic operation such as validating a timestamp, comparing identifiers, checking overlapping events, or sorting deadlines.

18.2 Cache invalidation

Cache invalidation must be deliberate.

A cached result may need to be recomputed when:

The underlying content changes.

The extraction schema changes materially.

The relevant system prompt changes.

The model changes in a way that requires re-evaluation.

The user requests a deliberate reanalysis.

A previous result is invalid or fails validation.

Do not invalidate every cached result because an unrelated course or document changed.

18.3 Processing transparency

Expose useful operational information without overwhelming the student.

Depending on the interface, show:

Last successful synchronization.

Whether processing is pending or complete.

Number of records added or updated.

Documents that failed to process.

Items requiring review.

Remaining user-triggered sync allowance.

Whether an AI analysis was reused from cache or needed a new run, where practical.

Do not display fabricated token counts, estimated dollar savings, or processing statuses unsupported by actual measurements.



19\. Operational Reliability and Observability

The ingestion and AI pipeline must be observable enough to debug without exposing private academic content.

Use structured logs and persistent job status where the architecture supports them.

Track meaningful events such as:

Synchronization started, completed, partially completed, or failed.

Source records added, changed, or removed.

Documents skipped because their content was unchanged.

Extraction results reused from cache.

AI processing failures.

Schema validation failures.

Conflicts requiring review.

Scheduling reconciliation outcomes.

Rate limits and retry exhaustion.

Avoid logging complete document contents, OAuth tokens, API keys, or unnecessary personal information.

Provide useful error messages to users while keeping technical diagnostic details in appropriately protected logs.

Failures must be isolated where possible. One unreadable document should not prevent all other valid coursework from being imported.

Use bounded queues and retries to prevent a failed source from triggering an infinite processing loop.



20\. Required Tests for Part II

Create automated tests for the new and existing integration boundaries.

At minimum, test the following categories.

Import and normalization

Valid and invalid payloads.

Legacy JSON compatibility.

Missing optional fields.

Invalid dates and time zones.

Duplicate courses and assignments.

Repeated import of the same batch.

Unauthorized imports and cross-user isolation.

Synchronization

Initial synchronization.

Incremental updates.

Unchanged source records.

Content fingerprint changes.

Partial failures and retries.

Rate-limit responses.

Permission revocation.

Confirmed deletions versus temporary failures.

Concurrent user-triggered sync attempts.

Rolling 24-hour sync limit.

Background reconciliation without consuming user-triggered sync allowances.

Document processing

Supported document formats.

Unreadable or scanned documents.

Cached extraction reuse.

Targeted reanalysis after changes.

Provenance preservation.

Cross-document deadline conflicts.

Explicit supersession of older information.

Prompt or schema version invalidation.

Confidence and review

Different confidence levels for different fields.

Missing deadlines.

Contradictory source dates.

User-confirmed values.

Repeated processing of an already-resolved conflict.

Review decisions surviving reloads.

AI provider abstraction

Valid structured responses.

Malformed output.

Provider timeout and rate limits.

Output that violates the schema.

Provider configuration errors.

Cache compatibility when model or prompt versions change.

Enforcement of academic integrity requirements.

Reconciliation

New assignments entering the canonical model.

Changed deadlines triggering targeted schedule updates.

Fixed events remaining unchanged.

Locked sessions remaining unchanged.

Undo restoring the appropriate prior state.

Infeasible scheduling changes producing visible conflicts.

Unrelated schedule sessions remaining stable.

Use mocks for external APIs and AI providers in deterministic unit tests. Add integration tests where credentials and test environments are available. Do not claim live Google Classroom or provider integration has been verified when only mocked tests have run.



21\. Deliverables for Part II

After integrating Part II with Part I, the implementation should provide:

A canonical data model shared by all supported ingestion methods.

Separate, maintainable Google Classroom API and browser-extension ingestion workflows.

A validated common import interface that also supports JSON and manual input.

Incremental synchronization with source-aware change detection.

A server-enforced rolling limit of three user-triggered syncs per 24 hours.

A persistent, per-course knowledge base with document versions and provenance.

Cached extraction and targeted reanalysis.

A configurable AI provider interface.

Structured extraction with field-level confidence and evidence.

A persistent review queue for uncertain or conflicting information.

Targeted automatic reconciliation with protected events, change history, and undo.

Automated tests for the major data, security, synchronization, and AI-processing paths.

Updated documentation describing architecture, configuration, permissions, limitations, and failure handling.

Integrate these capabilities into the existing project rather than leaving them as isolated services or mockups.

Do not create a second scheduler or replace the existing JSON workflow unnecessarily. The canonical model and processing pipeline must support the scheduler already built.

Part III will define the deterministic scheduling algorithm, workload allocation, assignment milestones, assessment study planning, schedule feasibility, user-facing interfaces, lightweight gamification, end-to-end acceptance criteria, and final delivery requirements.

Before implementing any change that conflicts with existing code, reconcile the conflict against all three parts of the specification and preserve the most important established functionality.

PART III OF III — SCHEDULING ENGINE, PLANNING EXPERIENCE, USER INTERFACE, AND ACCEPTANCE CRITERIA

22\. Core Scheduling Architecture

Implement an AI-assisted planning system backed by a deterministic scheduling engine.

The architecture must separate understanding academic work from deciding when that work can actually happen.

The AI should interpret academic materials, identify obligations, estimate workloads, propose neutral milestones, and recommend study activities. The deterministic engine should allocate those activities to actual available time while enforcing constraints.

Do not rely on a language model to generate an entire weekly calendar and assume that its output is valid.

The primary pipeline should be:

Ingest and normalize academic information.

Reconcile source facts and resolve uncertainty.

Create or update canonical assignments and assessments.

Estimate workload and identify required milestones.

Determine available scheduling intervals.

Allocate work using a deterministic scheduling algorithm.

Validate the resulting schedule against all hard constraints.

Commit feasible changes and record the resulting schedule version.

Explain conflicts when a fully feasible schedule cannot be produced.

AI may propose candidate allocations or assist with repair when useful, but every proposal must pass deterministic validation.

22.1 Hard constraints

Hard constraints must never be violated to improve a soft preference.

Examples include:

Fixed class periods.

Existing fixed appointments.

User-locked events and sessions.

Explicitly unavailable intervals.

Valid assignment and assessment deadlines.

No overlapping scheduled events.

Valid event durations.

User-configured absolute work restrictions.

Correct handling of recurring events and exceptions.

A hard constraint must be represented explicitly in the model, not inferred from a label or color in the UI.

If the available time cannot accommodate all required work, the engine must report the infeasibility. It must not invent additional availability, shorten work estimates without justification, or silently move deadlines.

22.2 Soft preferences

Soft preferences should influence schedule quality without invalidating hard constraints.

Examples include:

Preferred session duration.

Preferred study times.

Avoiding late-night work.

Balancing workload across days.

Leaving time for unexpected assignments.

Taking regular breaks.

Distributing assessment preparation across multiple days.

Avoiding excessive context switching.

Keeping sessions for the same assignment reasonably cohesive.

Prioritizing earlier completion when feasible.

Respecting the user's preferred balance between homework and assessment preparation.

Implement these as explicit, configurable optimization preferences where practical.

Do not hardcode one universal definition of an ideal schedule.

22.3 Schedule representation

Every scheduled work session should reference the academic work it serves.

A session should contain, as applicable:

Stable identifier.

User and course association.

Assignment, milestone, or assessment-plan reference.

Start and end time.

Duration.

Short actionable activity description.

Session type.

Status.

Whether the session is fixed, flexible, or user-locked.

Scheduling reason or priority.

Relevant source references.

Creation and modification metadata.

Schedule version or change-history reference.

Adapt the schema to the existing application. Avoid introducing redundant representations of the same session.

Distinguish academic work sessions from fixed calendar events, classes, breaks, and unavailable intervals.



23\. Available-Time Calculation

Before allocating work, calculate when the student can actually work.

Use the user's onboarding configuration and current schedule, including:

Recurring classes.

Commute periods.

Extracurricular activities.

Fixed commitments.

Sleep and unavailable periods, where configured.

Existing appointments.

User-locked sessions.

Breaks and buffers.

One-time exceptions.

School holidays and schedule variations.

Support recurring schedules that vary by weekday or rotation, such as alternating school days, when the source data establishes that structure.

Represent dates and times using a consistent, time-zone-aware model. Handle daylight-saving transitions and recurring events correctly.

23.1 Interval-based allocation

Represent availability as intervals rather than simply counting the number of free hours in a day.

For example, a student with two free hours divided into four 30-minute gaps does not necessarily have two usable hours for a single 90-minute task.

The scheduler should know the difference between:

One continuous 90-minute interval.

Three separate 30-minute intervals.

An interval interrupted by a fixed event.

A preferred but usable late-night interval.

A genuinely unavailable interval.

Do not place a session across a class period or other commitment.

23.2 Buffers and transitions

Allow optional buffers between activities where configured.

Examples include travel time after fencing practice, a transition period after school, or a short break between long study sessions.

Avoid introducing unnecessary gaps that fragment otherwise useful study time.

When the user configures a break policy, distinguish breaks between work sessions from unavailable personal time.

23.3 Daily workload limits

Respect configured daily workload limits as optimization constraints or hard constraints according to the user's settings.

If the user has configured a maximum as an absolute cap, do not exceed it automatically.

If the user has expressed a preference rather than a strict limit, the engine may exceed it when necessary, but should make the trade-off visible.

Do not automatically treat all remaining free time as academic availability.



24\. Assignment Workload Estimation and Allocation

Assignments must be scheduled based on their estimated effort, due dates, priority, and the time available before those deadlines.

The system should not simply place an assignment on its due date or schedule every assignment as one indivisible block.

24.1 Workload estimation

Estimate workload using the best available evidence, including:

Explicit duration estimates provided by the teacher.

The assignment's instructions and required deliverables.

Known assignment type and scope.

The user's own historical estimates and completion times, when available.

User corrections to prior estimates.

Comparable work from the same course, when sufficiently relevant.

Distinguish between explicit estimates, user-provided estimates, and AI-generated estimates.

Do not invent precision. A rough estimate of approximately two hours is preferable to an unsupported estimate of 117 minutes.

Allow the user to edit estimates at any time.

As the system accumulates sufficient personal history, it may improve future estimates using that history. Do not make strong personalization claims when little data is available.

24.2 Large assignments and milestones

Break large assignments into neutral, actionable milestones.

For example, an assignment could be represented as:

Review the assignment instructions.

Gather the required materials.

Plan the work.

Complete an independent work session.

Check the work against the rubric or instructions.

Reserve time for revisions.

Submit the assignment.

These are planning actions, not generated academic answers.

Do not create arbitrary milestones for every trivial assignment. A short homework task may only need one scheduled session.

Milestones should have estimated durations that sum coherently to the assignment's overall estimated workload. If the estimates change, update the allocation without losing completed milestones.

Avoid double-counting the same activity in both an assignment's total workload and a separate study plan.

24.3 Deadline-aware scheduling

Use deadline proximity, workload, priority, available intervals, and estimated completion effort to decide what to schedule first.

The engine should generally:

Begin large assignments early enough to distribute their workload.

Schedule short urgent tasks before their deadlines.

Reserve appropriate preparation time for major assessments.

Avoid leaving all work until the last possible session.

Account for other obligations due in the same period.

Prefer feasible plans that leave reasonable buffer time.

Identify assignments that are already overdue or cannot be completed in time.

Do not rely solely on a simple earliest-deadline-first algorithm. A short task due tomorrow and a major project due in three days may require a different allocation than their deadlines alone imply.

Use a deterministic prioritization strategy with explainable inputs and stable tie-breaking. The same inputs and configuration should produce reproducible results unless the user changes a preference or the algorithm explicitly introduces a documented alternative.

24.4 Splitting work across sessions

Allow assignments to be divided across multiple sessions when appropriate.

Respect:

Minimum session length.

Maximum session length.

Preferred session duration.

Remaining workload.

Available intervals.

Assignment dependencies, where applicable.

Required completion milestones.

Deadline and buffer requirements.

Avoid splitting every task into arbitrary fragments merely to fill calendar gaps.

Some activities may benefit from short sessions, while others require sustained focus.

If a remaining task requires a continuous interval that does not exist, surface the problem rather than silently placing an invalid session.

24.5 Dependencies and completion

Where assignments have meaningful dependencies, do not schedule a dependent milestone before its prerequisite is completed unless the dependency is explicitly optional.

When a user completes a milestone or session:

Update the relevant progress state.

Recalculate remaining workload when appropriate.

Preserve completed work.

Reallocate only the unfinished portion when needed.

Avoid generating duplicate replacement sessions.

Record the change in the schedule history.

Do not assume that marking a calendar session complete proves that the entire assignment is finished.

Assignment completion and session completion should remain distinct concepts.



25\. Assessment Study Planner

Implement the secondary learning-centered planning system as a first-class feature.

Its purpose is to organize preparation for upcoming assessments, not to generate the answers a student is expected to produce.

25.1 Assessment records

An assessment record should support, as applicable:

Course.

Assessment title or type.

Date and time.

Known scope or topics.

Relevant study guides and source documents.

Confidence and provenance for extracted information.

User-confirmed topics.

Preparation sessions.

Progress and completion status.

If the assessment date or scope is uncertain, preserve that uncertainty.

Do not automatically infer a test date from a document's upload date or treat every topic mentioned during a unit as confirmed assessment content.

25.2 Identifying preparation topics

Use the persistent course knowledge base to retrieve relevant materials.

The AI may identify topics explicitly included in a teacher-provided study guide or supported by available class materials.

For each proposed topic, retain source references where possible.

Distinguish between:

Explicitly listed assessment topics.

Topics supported by relevant course materials.

Potentially relevant topics inferred by the system.

Unknown assessment scope.

If the system cannot establish what will be assessed, communicate the limitation and ask the student to confirm the scope when necessary.

25.3 Distributed preparation

Avoid placing all preparation in one session immediately before an assessment.

Use a configurable preparation window and distribute sessions across available days.

Consider:

Time until the assessment.

Amount and difficulty of material.

The user's preferred study-session length.

Competing assignment deadlines.

Existing preparation progress.

User feedback about difficult topics.

The availability of appropriate practice resources.

A reasonable plan might distribute initial review, independent practice, and later retrieval practice across separate sessions.

Do not enforce a universal spacing formula regardless of the available time. The plan must remain feasible.

25.4 Adaptive preparation

The user should be able to mark topics as:

Not started.

In progress.

Needs more review.

Comfortable or completed.

Use these signals to adjust future preparation sessions when useful.

If a student reports difficulty with one topic, prioritize additional review of that topic when time permits.

Do not automatically assume mastery merely because a session was completed.

Avoid making the system a graded knowledge assessment unless such a feature is explicitly requested and remains within the application's permitted academic planning scope.

25.5 Integration with assignments

Assessment preparation and assignment work must compete for the same finite pool of available time.

The scheduler must not allocate two hours of homework and two hours of assessment study into the same one-hour interval.

If an assessment conflicts with a large assignment deadline, the engine should consider the relative urgency, workload, user preferences, and remaining time, then make the trade-off visible.

Both types of work must appear in the same daily schedule, weekly calendar, progress views, and workload calculations.



26\. Scheduling Reconciliation, Missed Sessions, and Conflicts

The scheduler must adapt to real life without continually destabilizing the user's calendar.

26.1 When a session is missed

If a work session passes without being marked complete, do not automatically assume the work was completed.

Depending on the existing UX, ask the user whether they:

Completed the work.

Completed part of it.

Need to reschedule it.

No longer need the session.

If the application can safely infer that the session was missed based on its status, mark it for follow-up rather than silently deleting it.

When rescheduling is appropriate, allocate only the remaining work and respect the original deadline.

26.2 When the workload becomes infeasible

A schedule can become infeasible when:

A teacher moves a deadline earlier.

Several assignments arrive simultaneously.

A user loses available time.

An assignment takes longer than estimated.

An assessment is moved.

A fixed commitment conflicts with previously planned work.

When this happens:

Recalculate the affected work.

Preserve fixed events and locked sessions.

Identify the remaining required work.

Determine what can feasibly fit before each deadline.

Identify conflicts that cannot be resolved automatically.

Show the user which obligations are at risk and why.

Offer actionable choices where user input is needed.

Do not disguise infeasibility by scheduling work after its deadline and presenting the result as a valid plan.

If work is already overdue, the schedule may include catch-up sessions, but the overdue status must remain explicit.

26.3 Change impact and minimal disruption

When reconciling the schedule, prefer the smallest change that restores feasibility and improves the plan.

For example, changing one flexible homework session is preferable to moving multiple unrelated sessions when both options satisfy the constraints equally well.

Protect user-locked sessions, completed sessions, fixed commitments, and user-confirmed data.

When the engine cannot preserve all existing preferences, explain the material trade-off.

26.4 Schedule versioning and undo

Record meaningful scheduling changes with sufficient information to reconstruct the relevant prior state.

Each change should capture, as applicable:

What changed.

Previous and new values.

Triggering event.

Timestamp.

Affected assignments and sessions.

Relevant constraint or preference.

Whether the change was automatic or user initiated.

Provide an undo mechanism for automatic changes.

Undo must be scoped carefully. It must not erase unrelated user actions or completed work that occurred after the original change.

If the current architecture cannot support safe undo through full snapshots, implement an equivalent versioned change log or reversible operation model.



27\. Calendar and Daily Planner Interface

Extend the existing website instead of creating a disconnected interface.

Use its current design system, routing conventions, components, and persistence patterns wherever appropriate.

27.1 Daily planner

The daily planner should answer: What should I work on now, and what must I finish today?

Show:

Scheduled academic sessions.

Fixed events that explain availability.

Upcoming and overdue obligations.

Session duration and task association.

Assignment and assessment progress.

Relevant warnings and conflicts.

A clear next action.

Controls to start, complete, skip, edit, or reschedule work as appropriate.

Keep the primary task description actionable and concise.

For example, show "Review the biology study guide for 25 minutes" rather than a generic "Study biology" when the available source material supports the more specific instruction.

Do not invent specific study activities that depend on unavailable materials.

27.2 Weekly calendar

Provide an overview of the user's week, including academic work, classes, fixed commitments, and available time.

The calendar must display sessions at their actual scheduled times and make conflicts understandable.

Users should be able to inspect the reason for a scheduled session and navigate to the associated assignment or assessment.

Support appropriate editing and locking controls without allowing direct UI actions to bypass hard scheduling constraints.

If users manually move a flexible session, validate the change against availability and other sessions before saving it.

27.3 Assignment management

Provide an assignment view that supports:

Filtering by course.

Sorting by deadline and priority.

Overdue, upcoming, completed, and unresolved states.

Workload estimates.

Milestone progress.

Source references.

Deadline correction.

Manual additions and edits.

Links to scheduled work sessions.

Avoid making the user navigate through multiple screens just to correct a mistaken due date.

27.4 Assessment preparation view

Provide a view of upcoming assessments, preparation status, and relevant study sessions.

Users should be able to inspect the sources behind identified topics, update their understanding of what needs review, and correct incorrect assessment dates or scope.

The study plan should remain editable.

27.5 Review and conflict interface

Integrate the review queue defined in Part II into the normal application workflow.

Do not hide unresolved deadlines or infeasible scheduling problems in logs or a settings submenu.

Distinguish clearly between:

Information requiring confirmation.

Schedule changes that have already been applied.

Changes that could not be applied.

Warnings that do not currently block scheduling.

The student should be able to understand what requires action without reading technical diagnostics.

27.6 Responsive behavior and accessibility

Ensure the existing application remains usable across supported screen sizes.

Use semantic controls, keyboard-accessible interactions, readable contrast, clear focus states, and meaningful labels.

Avoid introducing visual complexity that makes the calendar or task list harder to use.

Do not redesign unrelated sections of the application without a clear functional reason.



28\. Lightweight Gamification

Implement the initial gamification scope without compromising the core scheduler.

The initial release may include:

XP or a comparable progress metric.

Levels.

Basic achievements.

Assignment milestone completion.

Progress indicators.

Meaningful study and planning milestones.

28.1 Reward meaningful behavior

Reward behaviors that support effective planning and learning, such as:

Completing planned work.

Making progress on large assignments.

Preparing for assessments in advance.

Maintaining a manageable and realistic schedule.

Following through on review sessions.

Do not award disproportionate rewards for creating large numbers of trivial tasks or marking sessions complete without meaningful progress.

Avoid incentives that encourage unhealthy overwork, unnecessary late-night study, or sacrificing rest.

28.2 Persistence and integrity

Gamification state must persist and remain consistent across refreshes and supported devices.

Prevent duplicate rewards when an event is processed more than once.

If an operation is undone, define an appropriate, consistent policy for the associated reward. Avoid deleting unrelated progress.

Do not let gamification state influence the correctness of deadlines, scheduling constraints, or academic records.

28.3 Scope control

Do not implement an elaborate quest system, competitive leaderboard, narrative progression system, or complex streak mechanics in the initial release unless those features already exist and can be preserved without delaying core reliability.

The purpose of initial gamification is to make progress visible and reinforce useful habits, not to become a separate product.



29\. Performance, Reliability, and User Feedback

The application should remain responsive as the number of courses, documents, assignments, and schedule events increases.

29.1 Performance

Avoid repeatedly loading or analyzing every course document for ordinary calendar navigation.

Reuse cached normalized records and extraction results.

Paginate or filter large collections where necessary.

Keep expensive AI processing out of synchronous UI operations where the existing architecture supports background jobs.

Avoid unnecessary database queries and repeated full-schedule regeneration.

Reconcile affected assignments and sessions instead of recomputing unrelated work.

Show progress for operations that take meaningful time.

Do not optimize prematurely with unnecessary infrastructure. Measure actual bottlenecks and preserve maintainability.

29.2 Clear operation states

Long-running operations should have explicit states such as:

Not started.

Queued.

Running.

Completed.

Completed with warnings.

Failed.

Awaiting user review.

Provide useful recovery options for failures.

Do not display a successful import or synchronization message before the corresponding operation has actually succeeded.

29.3 Avoid destructive ambiguity

Before operations that may replace data or significantly alter the schedule, make the consequences clear.

For example, distinguish between merging an imported schedule and replacing the current schedule.

Preserve the user's existing work when an operation fails halfway through.



30\. Security, Privacy, and Data Handling

The application may process sensitive academic records, private teacher communications, personal schedules, and account credentials. Treat these as private user data.

Implement appropriate protections consistent with the actual deployment architecture.

At minimum:

Enforce user-specific authorization on server-side operations.

Validate all imported payloads.

Keep provider secrets out of client bundles.

Use secure authentication and session handling where applicable.

Avoid logging unnecessary document content.

Validate extension-to-website communication.

Protect against malicious or malformed document content.

Keep AI instructions separate from untrusted source text.

Do not execute code or follow embedded instructions extracted from academic documents.

Avoid sending unrelated courses or documents to AI providers.

Document relevant third-party data processing.

Support appropriate deletion and export of user data.

If account deletion or document deletion is supported, ensure that dependent cached data, derived records, and references are handled consistently.

Do not claim compliance with a privacy or security standard without verifying that the implementation meets its requirements.



31\. Testing Strategy and Evaluation Dataset

Testing must evaluate not only whether the website renders but also whether the academic scheduling system produces correct results.

31.1 Unit tests

Test the scheduling engine independently from the UI and AI provider.

Cover:

Availability interval calculation.

Recurring events and exceptions.

Time-zone and daylight-saving behavior.

Hard-constraint enforcement.

Overlap detection.

Session splitting.

Daily workload limits.

Deadline prioritization.

Assignment milestone allocation.

Assessment preparation distribution.

Completion and remaining-work calculations.

Infeasible schedules.

Locked and fixed events.

Minimal-disruption reconciliation.

Undo and version restoration.

31.2 Integration tests

Test the full flow from source ingestion to the final schedule.

Examples include:

A new Classroom assignment becomes a canonical assignment.

A document reveals a deadline that was previously unknown.

A newer announcement changes a due date.

An imported assessment creates a preparation plan.

A user changes availability and the flexible sessions are reconciled.

A user corrects a deadline and the correction persists.

A synchronization failure does not corrupt the schedule.

A repeated import does not create duplicate assignments.

A completed session is not recreated as unfinished work.

Use mocked providers for deterministic automated testing. Test real external integrations separately where credentials and permissions are available.

31.3 Representative academic test set

Build a small, privacy-conscious evaluation dataset based on representative document structures, including cases such as:

A syllabus with several deadlines.

A teacher announcement that changes a due date.

An assignment with no explicit due time.

An assignment described only in a document attachment.

A study guide listing assessment topics.

Two documents with conflicting dates.

An ambiguous assignment title.

A document containing no academic deadlines.

A scanned or unreadable PDF.

An assignment with a deadline already in the past.

A schedule with insufficient available time.

Use synthetic or appropriately sanitized examples where possible.

Measure:

Assignment extraction precision and recall.

Deadline accuracy.

Course association accuracy.

Source attribution quality.

Duplicate-record rate.

Conflict detection quality.

Frequency of unnecessary AI calls.

Scheduling feasibility.

Hard-constraint violations.

Schedule disruption after unrelated changes.

Do not rely only on subjective inspection or one successful demonstration.

31.4 Academic integrity tests

Test that prompts and application workflows remain within the permitted planning scope.

Verify that the system can create neutral work milestones and study recommendations without generating substantive assignment answers.

Test that untrusted document instructions cannot override the system's academic integrity requirements or security constraints.



32\. End-to-End Acceptance Criteria

The application is not complete merely because all the pages exist. The following behaviors must work together.

A. Existing project preservation

The existing scheduler still runs.

The existing extension retains its working capabilities.

The /academic-schedule skill remains usable and is updated where necessary.

Existing JSON imports continue to work or receive a documented, tested migration path.

Existing schedule data is preserved.

No parallel, disconnected scheduler is introduced.

B. Onboarding

A new user can configure their school schedule, availability, study preferences, and automation behavior.

Existing imported data is reused where possible.

The onboarding flow can be resumed.

Configuration persists and can be edited later.

Preferences materially influence the scheduling engine.

Invalid or contradictory configuration produces useful feedback.

C. Ingestion

The extension, authorized API integration where available, JSON import, and manual entry all populate the canonical model.

Repeated imports do not create duplicates.

Source references are retained.

Partial failures are reported.

Unsupported or inaccessible information is not fabricated.

D. Knowledge base and AI

Course documents persist between sessions.

Unchanged documents reuse cached extraction results.

Changed documents trigger targeted reanalysis.

Deadlines can be reconciled across multiple documents.

Field-level confidence and source evidence are retained.

Ambiguous or consequential conflicts appear in a review queue.

The provider can be changed through configuration without rewriting core scheduling logic.

E. Scheduling

No two scheduled events overlap unless an explicitly supported event model permits it.

Fixed events and locked sessions remain protected.

Work is distributed across feasible available intervals.

Large assignments receive appropriate milestones and advance planning.

Assessment preparation shares the same available time as homework.

Hard constraints always take precedence over soft preferences.

Infeasible schedules are identified rather than misrepresented as valid.

F. Automatic updates

New assignments and changed deadlines trigger targeted reconciliation.

Unrelated sessions remain stable when possible.

Completed work is preserved.

Material automatic changes have a traceable reason.

Undo restores the appropriate previous state.

Unresolved conflicts are presented to the user.

G. Cost controls

User-triggered syncs are limited to three per rolling 24-hour period.

Background processing is separate from user-triggered synchronization.

Cached analysis is reused when valid.

AI is not used for ordinary deterministic scheduling operations.

Usage and failures are observable without exposing private source content.

H. User experience

The daily planner clearly identifies the next action.

The weekly calendar reflects actual availability.

Assignments and assessments have separate but integrated planning views.

Review items and infeasible scheduling conflicts are visible.

Progress indicators and lightweight gamification persist correctly.

Core workflows work beyond static mockups.

I. Reliability and security

Schema validation and authorization are enforced.

Cross-user data access is prevented.

Failures do not corrupt existing schedules.

Automated tests cover the critical scheduling and ingestion paths.

Build, type checking, linting, and applicable test suites pass.

Any acceptance criterion that depends on an external service, unavailable school permission, or missing credential must be identified explicitly and tested to the extent possible. Do not label an untested external integration as fully verified.



33\. Implementation Order

Follow a dependency-aware implementation sequence.

The exact order may be adjusted after auditing the existing repository, but preserve the underlying priorities.

Phase 1: Stabilize and audit

Complete the project inventory from Part I.

Establish baseline build and test results.

Identify existing data schemas and migration requirements.

Document integration boundaries.

Fix existing regressions that would block subsequent work.

Phase 2: Canonical data and onboarding

Establish or extend the shared data model.

Preserve existing import compatibility.

Implement persistent onboarding configuration.

Connect configuration to actual scheduler behavior.

Add tests for migrations and onboarding persistence.

Phase 3: Ingestion and knowledge base

Improve the extension workflow.

Implement or extend authorized API ingestion where possible.

Unify JSON, manual, extension, and API imports.

Add incremental synchronization.

Build persistent course document storage and extraction caching.

Add provenance and review handling.

Phase 4: AI processing and reconciliation

Implement or extend the provider interface.

Add structured extraction and field-level confidence.

Implement cross-document reconciliation.

Add the review queue.

Implement targeted background reconciliation and cost controls.

Phase 5: Deterministic scheduling

Calculate real available intervals.

Enforce hard constraints.

Allocate assignment workloads and milestones.

Integrate assessment preparation.

Add infeasibility detection.

Implement minimal-disruption rescheduling and undo.

Phase 6: Planning UI and progress

Improve the daily planner.

Improve the weekly calendar.

Integrate assignment and assessment views.

Expose review items and conflicts.

Add lightweight gamification.

Ensure responsive and accessible interactions.

Phase 7: Verification and release readiness

Run the full automated test suite.

Perform representative end-to-end scenarios.

Validate existing JSON compatibility.

Test error recovery and synchronization limits.

Verify academic integrity boundaries.

Document setup, permissions, provider configuration, limitations, and known issues.

Do not postpone basic data integrity or scheduling correctness in favor of UI polish.



34\. Engineering Requirements

Throughout implementation:

Follow the existing project's language, conventions, framework, and architecture unless there is a documented reason to change them.

Prefer focused, reviewable changes over unnecessary rewrites.

Avoid duplicate business logic between the website, extension, and skill.

Keep AI output behind validation boundaries.

Make deterministic scheduling logic testable

Draft a 3-bullet micro-plan outlining the exact file targets and dependencies before executing any code modifications.



Execute the target architecture modifications. Apply a strict YAGNI ladder constraint before writing any fresh lines of code, lean heavily on native platform capabilities, and deliver the final code updates immediately with zero conversational filler.

