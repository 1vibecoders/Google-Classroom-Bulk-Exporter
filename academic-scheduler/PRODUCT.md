# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

High school students who use Google Classroom. Each uses the site alone, on a laptop and on a phone, to answer "what should I work on now, and what must I finish today?", and to plan homework and test preparation into the time they actually have.

## Product Purpose

Lattice Study turns a student's Google Classroom (assignments, announcements, attached files) into a realistic plan: what is due, how long it takes, and when to do it, including study sessions before tests. Success: the student trusts the plan, finishes work before deadlines, and prepares for tests over several days instead of the night before.

## Positioning

The AI reads everything the class posts, including attached documents and announcements that move a date, and proposes what changed with a quoted source; a fixed-rule planner (not the AI) places the work into the student's real free time and never fakes a feasible plan. Every change can be reviewed and undone.

## Operating Context

- Data arrives three ways: Google Classroom sync (sign-in), the Chrome extension ("Send to …" from the popup), or a schedule file made by the `/academic-schedule` skill.
- The student lives in the Day view (today, next session, done/skip), the Week view, Assignments, Tests (study topics), and Review (what the AI found, what does not fit).
- Works offline as a single HTML file without an account; AI features need sign-in.

## Capabilities and Constraints

- Schedule file format 1.3 (SCHEDULE_FORMAT.md) is the contract with the skill; existing files must keep importing.
- Strict CSP: `default-src 'self'`, fonts and styles only from the site itself (`font-src 'self' data:`), no third-party scripts.
- The single-file build embeds everything; keep it reasonably small.
- Academic integrity: the product plans and describes what to study; it never writes answers.
- Gamification is computed from the schedule (XP, levels, achievements); it must never reward overwork or late nights, and never affects the plan.

## Brand Commitments

- Name: **Lattice Study** (shown as "Lattice" with "Study" set smaller in small caps).
- The Lattice mark, unchanged: an ink-green rounded tile with a cream diagonal lattice (source of truth: `../video/src/components/Icons.tsx` `LatticeMark`; wordmark in `../video/src/components/AppHeader.tsx`).
- Motto: **"Scheduling that understands the assignment."**
- The Chrome extension keeps its current name ("Academic Scheduler") until its next release.

## Evidence on Hand

- Demo video source and end card: `../video/` (Remotion), rendered `demo-vertical (1).mp4`.
- Example schedule: `examples/complete-schedule.json` (English 10, Biology, Othello essay, Unit 2 test).
- No testimonials, user counts or press exist; do not invent them.

## Product Principles

1. The plan must be true: never place work after its deadline or hide what does not fit.
2. The student stays in control: suggestions are reviewable, changes are undoable, their own values are never overwritten silently.
3. Calm over noise: show the next action and what needs attention; everything else one step deeper.
4. Progress is visible and honest: reward real, finished work, not activity.

## Accessibility & Inclusion

Keyboard-operable everywhere (including the timeline), visible focus, labelled controls, readable contrast in light and dark themes, usable at phone width without sideways scrolling, and respect for reduced-motion preferences.
