"""render_schedule.py: the text view of a schedule for the chat (website semantics, width, ASCII, determinism)."""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import re
import tempfile
import unittest

from helpers import EXAMPLES, SKILL_DIR, WEBSITE, load_script, run_script

RS = load_script("render_schedule")
V = load_script("validate_schedule")
R = load_script("schedule_report")

EXAMPLE_PATH = os.path.join(EXAMPLES, "complete-schedule.json")
with open(EXAMPLE_PATH, encoding="utf-8") as _handle:
    EXAMPLE = json.load(_handle)

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"]


def normalized(data):
    result = V.validate_document(data, today="2026-10-12")
    assert result.ok, result.errors
    return result.doc


def render(data, now="2026-10-12T07:00:00", start=None, end=None, days=7, **kw):
    start = start or now[:10]
    end = end or V.add_days(start, days - 1)
    return RS.render_text(normalized(data), now, start, end, **kw)


def section(text, title):
    """The lines of one section (from its heading rule to the next heading)."""
    out, inside = [], False
    for line in text.splitlines():
        if re.match(r"^(── |-- )", line):
            inside = line[3:].startswith(title)
            continue
        if inside:
            out.append(line)
    return out


def days_of(text):
    """{heading: [lines]} of the 'Day by day' section."""
    days, current = {}, None
    for line in section(text, "Day by day"):
        if line and not line.startswith(" "):
            current = line
            days[current] = []
        elif current is not None and line:
            days[current].append(line)
    return days


def day(text, heading):
    days = days_of(text)
    for key, lines in days.items():
        if key.startswith(heading):
            return lines
    raise AssertionError("no day %r in %s" % (heading, list(days)))


def flat(lines):
    """Lines joined into one string with the wrapping undone (for checks that do not depend on the width)."""
    return re.sub(r"\s+", " ", " ".join(lines.splitlines() if isinstance(lines, str) else lines)).strip()


def recurring(days, start="2026-09-01", **extra):
    rule = {"frequency": "weekly", "daysOfWeek": days, "startDate": start}
    rule.update(extra)
    return rule


def base_doc():
    """A school week like the requirements' example: school 8-3, study time 3:30-9:30 on weekdays."""
    return {
        "schemaVersion": "1.0",
        "meta": {"title": "Test week", "generatedAt": "2026-10-12T07:00:00", "timezone": "America/New_York",
                 "generator": {"name": "academic-schedule-skill", "version": "1.0"}},
        "classes": [{"id": "cls-eng", "name": "English"}, {"id": "cls-math", "name": "Math"}],
        "assignments": [
            {"id": "eng-read-6", "classId": "cls-eng", "title": "Read Chapter 6", "type": "reading",
             "due": "2026-10-14T08:00:00", "estimatedMinutes": 45},
            {"id": "eng-essay", "classId": "cls-eng", "title": "Othello essay", "type": "writing",
             "due": "2026-10-13T23:59:00", "estimatedMinutes": 60},
            {"id": "math-problems", "classId": "cls-math", "title": "Problems 12–24", "type": "problem_set",
             "due": "2026-10-15", "estimatedMinutes": 45},
        ],
        "events": [{"id": "evt-school", "title": "School", "category": "school", "startTime": "08:00", "endTime": "15:00",
                    "recurrence": recurring(WEEKDAYS)}],
        "availability": [{"id": "avl-after-school", "label": "After school", "startTime": "15:30", "endTime": "21:30",
                          "recurrence": recurring(WEEKDAYS)}],
        "scheduleBlocks": [
            {"id": "blk-read", "assignmentId": "eng-read-6", "start": "2026-10-13T16:00:00", "end": "2026-10-13T16:45:00",
             "description": "Read pages 80-104 and note two quotations."},
            {"id": "blk-break", "kind": "break", "title": "Break", "start": "2026-10-13T16:45:00", "end": "2026-10-13T17:00:00"},
            {"id": "blk-math", "assignmentId": "math-problems", "start": "2026-10-13T17:00:00", "end": "2026-10-13T17:45:00",
             "status": "done", "completedAt": "2026-10-13T17:45:00"},
        ],
    }


def write_json(folder, name, data):
    path = os.path.join(folder, name)
    with open(path, "w", encoding="utf-8") as handle:
        if isinstance(data, str):
            handle.write(data)
        else:
            json.dump(data, handle, ensure_ascii=False)
    return path


class CompleteExample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        res = run_script("render_schedule", EXAMPLE_PATH)
        assert res.returncode == 0, res.stderr
        cls.text = res.stdout

    def test_header_and_defaults(self):
        lines = self.text.splitlines()
        self.assertEqual(lines[0], "Fall 2026 — Week of Oct 12")
        self.assertEqual(lines[1], "Sun, Oct 11 – Sat, Oct 17, 2026")  # --from = day of meta.generatedAt, 7 days
        self.assertEqual(lines[2], "Generated Sun, Oct 11, 2026, 7:30 PM (America/New_York)")
        self.assertNotIn("Shown as of", self.text)
        for title in ("Week overview", "Day by day", "Assignments", "Open issues (2)"):
            self.assertTrue(any(re.match(r"^── %s ─+$" % re.escape(title), line) for line in lines), title)

    def test_week_overview(self):
        week = section(self.text, "Week overview")
        self.assertEqual(week[0], "Sun Oct 11  free 3h       planned 0m")
        self.assertEqual(week[1], "Mon Oct 12  free 4h       planned 1h 20m")  # no school (exceptDates), fencing 4-6
        self.assertIn("Thu Oct 15  free 5h       planned 2h       Due: Return library books", week)
        self.assertIn("Fri Oct 16  free 6h       planned 0m       Test: Biology / Unit 2 Test: Cells", week)
        self.assertIn("            Due: English 10 / Grammar worksheet 3: Commas (withdrawn by", week)

    def test_day_agendas(self):
        monday = day(self.text, "Monday, October 12")
        self.assertNotIn("School", "\n".join(monday))  # Oct 12 is in the School event's exceptDates
        self.assertEqual(monday[:4], [
            "  3:30 PM             ──── Available until 4:00 PM",
            "  4:00 PM–6:00 PM     Fencing",
            "  6:00 PM             ──── Available until 6:30 PM",
            "  6:30 PM–7:20 PM     English 10 / Read Othello Act 3",
        ])
        self.assertIn("  7:30 PM–8:00 PM     English 10 / Othello Essay — Outline (printed copy due", monday)
        self.assertEqual(monday[-1], "  Free 4h · Planned 1h 20m")
        wednesday = day(self.text, "Wednesday, October 14")
        self.assertIn("  6:15 PM–7:25 PM     English 10 / Othello Essay — Draft   pinned", wednesday)
        self.assertIn("  5:00 PM–6:00 PM     Piano", wednesday)
        thursday = day(self.text, "Thursday, October 15")
        self.assertIn("  Due today: Return library books", thursday)  # date-only due: no time shown
        self.assertIn("  Aim to finish today: English 10 / Othello Essay", thursday)
        self.assertIn("  ! Workload issue about this day: see Open issues below", thursday)
        friday = day(self.text, "Friday, October 16")
        self.assertIn("  Test today: Biology / Unit 2 Test: Cells (9:10 AM)", friday)
        self.assertIn("  Due today: English 10 / Othello Essay (11:59 PM)", friday)
        self.assertTrue(list(days_of(self.text))[0].endswith("(today)"))

    def test_assignments(self):
        lines = section(self.text, "Assignments")
        self.assertEqual(lines[0], "Remaining 9h 5m · scheduled 9h 5m · unscheduled 0m (5 assignments counted)")
        self.assertIn("Later (after Sun, Oct 11)", lines)
        text = "\n".join(lines)
        self.assertIn("  English 10 / Othello Essay\n    Writing · in progress · high priority\n"
                      "    Due Fri, Oct 16, 11:59 PM · aim to finish Thu, Oct 15\n"
                      "    Estimate 4h (3h 30m–4h 30m) · remaining 3h 30m · scheduled 3h 30m\n      unscheduled 0m", text)
        self.assertIn("      ✓ Choose thesis and quotations · done · 30m", lines)
        self.assertIn("    Homework · not started · low priority · withdrawn by teacher · not counted", lines)
        self.assertIn("    Due Thu, Oct 15", lines)  # date-only
        self.assertIn("    Exam Sat, Oct 24, 9:00 AM", lines)
        # Order: deadline first.
        order = [line.strip() for line in lines if line.startswith("  ") and not line.startswith("   ")]
        self.assertEqual(order, ["English 10 / Read Othello Act 3", "English 10 / Grammar worksheet 3: Commas",
                                 "Return library books", "Biology / Unit 2 Test: Cells", "English 10 / Othello Essay",
                                 "Piano theory exam"])

    def test_totals_match_schedule_report(self):
        report = R.build_report(normalized(EXAMPLE), "2026-10-11T19:30:00", "2026-10-11", 7, None)
        for a in report["assignments"]:
            if a["excluded"] is None:
                self.assertIn("remaining %s" % RS.dur(a["remaining"]), self.text)
        remaining = sum(a["remaining"] or 0 for a in report["assignments"] if a["excluded"] is None)
        self.assertIn("Remaining %s ·" % RS.dur(remaining), self.text)

    def test_issues_open_only_and_no_notes(self):
        issues = section(self.text, "Open issues")
        self.assertEqual(issues[0], "- Workload · Doctor appointment (Thu, Oct 15)")
        self.assertIn("- Conflict · Biology / Unit 2 Test: Cells", issues)
        self.assertNotIn("rubric says", self.text)  # the essay's resolved issue
        self.assertNotIn("Ms. Rivera said", self.text)  # notes are person-owned: not shown by default
        res = run_script("render_schedule", EXAMPLE_PATH, "--include-done", "--include-notes", "--view", "issues")
        self.assertIn("── Issues (3) ", res.stdout)
        self.assertIn("- Conflict · resolved · English 10 / Othello Essay", res.stdout)
        res = run_script("render_schedule", EXAMPLE_PATH, "--include-notes", "--view", "assignments")
        self.assertIn("    Your notes: Ms. Rivera said quotations from Act 4 are fine too.", res.stdout)

    def test_done_block_and_sitting_event(self):
        text = render(EXAMPLE, now="2026-10-11T19:30:00", start="2026-10-10", days=1, view="agenda")
        self.assertIn("10:00 AM–10:30 AM English 10 / Othello Essay — Choose thesis and quotations ✓ done",
                      flat(text))
        self.assertIn("  10:00 AM–10:30 AM   English 10 / Othello Essay — Choose thesis and", text.splitlines())
        text = render(EXAMPLE, now="2026-10-11T19:30:00", start="2026-10-24", days=1)
        saturday = day(text, "Saturday, October 24")
        self.assertIn("  9:00 AM–11:00 AM    Piano theory exam · Exam: Piano theory exam", saturday)
        self.assertFalse(any("Exam today" in line for line in saturday))  # shown by its sitting event, not twice
        self.assertIn("Sat Oct 24  free 2h       planned 0m       Exam: Piano theory exam", text.splitlines())

    def test_deterministic(self):
        again = run_script("render_schedule", EXAMPLE_PATH)
        self.assertEqual(again.stdout, self.text)
        inprocess = render(EXAMPLE, now="2026-10-11T19:30:00")
        self.assertEqual(inprocess, self.text)
        shuffled = copy.deepcopy(EXAMPLE)
        for key in ("events", "availability", "scheduleBlocks", "assignments", "classes"):
            shuffled[key].reverse()
        for view in ("week", "agenda", "assignments"):
            self.assertEqual(render(shuffled, now="2026-10-11T19:30:00", view=view),
                             render(EXAMPLE, now="2026-10-11T19:30:00", view=view), view)


class RequirementsExampleDay(unittest.TestCase):
    def test_tuesday(self):
        text = render(base_doc(), days=3)
        self.assertEqual(day(text, "Tuesday, October 13"), [
            "  8:00 AM–3:00 PM     School",
            "  3:30 PM             ──── Available until 4:00 PM",
            "  4:00 PM–4:45 PM     English / Read Chapter 6",
            "                        Read pages 80-104 and note two quotations.",
            "  4:45 PM–5:00 PM     Break",
            "  5:00 PM–5:45 PM     Math / Problems 12–24   ✓ done",
            "  5:45 PM             ──── Available until 9:30 PM",
            "  Due today: English / Othello essay (11:59 PM)",
            "  Free 6h · Planned 1h 30m (45m done)",
        ])
        self.assertIn("Tue Oct 13  free 6h       planned 1h 30m   Due: English / Othello essay", text.splitlines())
        self.assertEqual(day(text, "Monday, October 12 (today)")[-1], "  Free 6h · Planned 0m")

    def test_no_descriptions_option(self):
        text = render(base_doc(), days=3, descriptions=False)
        self.assertNotIn("Read pages 80-104", text)


class Recurrence(unittest.TestCase):
    def doc(self):
        doc = base_doc()
        doc["events"] += [
            # Section 10 worked vector 1: interval 2 from a Wednesday, Mondays -> Oct 26, Nov 9 (not Oct 12, Oct 19).
            {"id": "evt-club-a", "title": "Club A", "startTime": "12:00", "endTime": "13:00",
             "recurrence": recurring(["mon"], "2026-10-14", interval=2)},
            # Vector 2 (Sun + Mon from Sunday Oct 11) with an exception and an end date.
            {"id": "evt-club-b", "title": "Club B", "startTime": "13:00", "endTime": "14:00",
             "recurrence": recurring(["sun", "mon"], "2026-10-11", interval=2, exceptDates=["2026-10-25"], endDate="2026-11-03")},
        ]
        return doc

    def test_vectors_exceptions_and_end(self):
        text = render(self.doc(), start="2026-10-11", end="2026-11-10", view="agenda")
        days = days_of(text)
        a = sorted(k for k, v in days.items() if any("Club A" in line for line in v))
        b = sorted(k for k, v in days.items() if any("Club B" in line for line in v))
        self.assertEqual(a, ["Monday, November 9", "Monday, October 26"])
        self.assertEqual(b, ["Monday, November 2", "Monday, October 19", "Sunday, October 11"])
        renderer = RS.Renderer(normalized(self.doc()), "2026-10-12T07:00:00", "2026-10-11", "2026-11-10")
        for n in range(31):  # every day agrees with the validator's own implementation of the rule
            date = V.add_days("2026-10-11", n)
            lines = days.get(renderer.day_long(date)) or days[renderer.day_long(date) + " (today)"]
            for event in self.doc()["events"][1:]:
                self.assertEqual(any(event["title"] in x for x in lines), V.occurs_on(event["recurrence"], date), date)

    def test_school_exceptions_and_end_date(self):
        doc = base_doc()
        doc["events"][0]["recurrence"].update(exceptDates=["2026-10-13"], endDate="2026-10-14")
        text = render(doc, days=4, view="agenda")
        self.assertIn("  8:00 AM–3:00 PM     School", day(text, "Monday"))
        self.assertNotIn("  8:00 AM–3:00 PM     School", day(text, "Tuesday"))
        self.assertIn("  8:00 AM–3:00 PM     School", day(text, "Wednesday"))
        self.assertNotIn("  8:00 AM–3:00 PM     School", day(text, "Thursday"))


class EventsAndAvailability(unittest.TestCase):
    def test_all_day_multi_day_busy_and_not_busy(self):
        doc = base_doc()
        doc["events"] += [
            {"id": "evt-break", "title": "Fall break", "category": "school", "allDay": True, "date": "2026-10-14", "endDate": "2026-10-15"},
            {"id": "evt-spirit", "title": "Spirit week", "allDay": True, "busy": False, "date": "2026-10-12"},
            {"id": "evt-game", "title": "Watch the game", "busy": False, "date": "2026-10-12", "startTime": "18:00",
             "endTime": "20:00", "location": "Gym"},
        ]
        doc["scheduleBlocks"].append({"id": "blk-mon", "assignmentId": "eng-essay", "start": "2026-10-12T18:00:00",
                                      "end": "2026-10-12T19:00:00"})
        text = render(doc, days=5)
        monday = day(text, "Monday")
        self.assertIn("  All day             Spirit week (not busy)", monday)
        self.assertIn("  6:00 PM–8:00 PM     Watch the game (not busy) · Gym", monday)
        self.assertFalse(any("Conflict" in line for line in monday))  # not-busy events never conflict
        self.assertEqual(monday[-1], "  Free 6h · Planned 1h")  # ... and do not reduce free time
        for name in ("Wednesday", "Thursday"):
            lines = day(text, name)
            self.assertIn("  All day             Fall break (Oct 14–Oct 15)", lines)
            self.assertEqual(lines[-1], "  Free 0m · Planned 0m")
            self.assertFalse(any("Available" in line for line in lines))
        week = section(text, "Week overview")
        self.assertIn("Wed Oct 14  free 0m       planned 0m       All day: Fall break", week)
        self.assertEqual(week[week.index("Wed Oct 14  free 0m       planned 0m       All day: Fall break") + 1],
                         "            Due: English / Read Chapter 6")
        self.assertIn("Fri Oct 16  free 6h       planned 0m", week)

    def test_empty_availability(self):
        doc = base_doc()
        doc["availability"] = []
        doc["scheduleBlocks"].append({"id": "blk-long", "assignmentId": "eng-essay", "start": "2026-10-12T15:00:00",
                                      "end": "2026-10-12T23:00:00"})
        text = render(doc, days=2)
        week = section(text, "Week overview")
        self.assertEqual(week[0], "Study time not provided: free time and overload are not shown.")
        self.assertEqual(week[1], "Mon Oct 12  free n/a      planned 8h")
        self.assertNotIn("! over", "\n".join(week))
        monday = day(text, "Monday")
        self.assertEqual(monday[-1], "  Planned 8h · study time not provided")
        self.assertNotIn("Available", text)
        self.assertNotIn("Over capacity", text)

    def test_one_time_window_and_midnight(self):
        doc = base_doc()
        doc["availability"].append({"id": "avl-late", "date": "2026-10-16", "startTime": "22:00", "endTime": "24:00"})
        doc["events"].append({"id": "evt-late", "title": "Late show", "date": "2026-10-17", "startTime": "23:00", "endTime": "24:00"})
        doc["scheduleBlocks"].append({"id": "blk-night", "assignmentId": "math-problems", "start": "2026-10-16T23:00:00",
                                      "end": "2026-10-17T00:00:00"})
        text = render(doc, start="2026-10-16", days=2, view="agenda")
        friday = day(text, "Friday")
        self.assertIn("  11:00 PM–12:00 AM   Math / Problems 12–24", friday)  # ends at 00:00 of the next date
        self.assertIn("  10:00 PM            ──── Available until 11:00 PM", friday)
        self.assertEqual(friday[-1], "  Free 8h · Planned 1h")  # 3:30-9:30 PM and 10 PM-midnight
        self.assertIn("  11:00 PM–12:00 AM   Late show", day(text, "Saturday"))
        self.assertNotIn("Math", "\n".join(day(text, "Saturday")))


class Blocks(unittest.TestCase):
    def test_statuses_past_and_skipped(self):
        doc = base_doc()
        doc["meta"]["generatedAt"] = "2026-10-13T18:30:00"
        doc["scheduleBlocks"] += [
            {"id": "blk-skip", "assignmentId": "eng-essay", "start": "2026-10-13T16:00:00", "end": "2026-10-13T17:00:00", "status": "skipped"},
            {"id": "blk-past", "assignmentId": "eng-essay", "start": "2026-10-13T18:00:00", "end": "2026-10-13T18:20:00"},
            {"id": "blk-own", "title": "Review flashcards", "start": "2026-10-13T19:00:00", "end": "2026-10-13T19:30:00", "origin": "user"},
        ]
        text = render(doc, now="2026-10-13T18:30:00", days=1, view="agenda")
        tuesday = day(text, "Tuesday")
        self.assertIn("  4:00 PM–5:00 PM     English / Othello essay   skipped", tuesday)
        self.assertIn("  6:00 PM–6:20 PM     English / Othello essay   past, not marked done", tuesday)
        self.assertIn("  7:00 PM–7:30 PM     Review flashcards", tuesday)
        # The skipped session neither counts nor conflicts with the reading it overlaps.
        self.assertFalse(any("Conflict" in line for line in tuesday))
        self.assertEqual(tuesday[-1], "  Free 6h · Planned 2h 20m (45m done)")

    def test_conflicts_and_late(self):
        doc = base_doc()
        doc["settings"] = {"defaultDueTime": "00:00"}
        doc["assignments"][2]["due"] = "2026-10-13"  # date-only: due at 00:00, i.e. by the end of Oct 12
        doc["assignments"] += [
            {"id": "bio-quiz", "title": "Cells quiz", "type": "quiz", "assessmentDate": "2026-10-13T09:00:00", "estimatedMinutes": 30},
            {"id": "proj", "title": "Project", "type": "project", "due": "2026-10-20T23:59:00", "estimatedMinutes": 60,
             "tasks": [{"id": "proj-t1", "title": "Outline", "estimatedMinutes": 30, "due": "2026-10-13T12:00:00"},
                       {"id": "proj-t2", "title": "Build", "estimatedMinutes": 30}]},
        ]
        doc["scheduleBlocks"] = [
            {"id": "blk-overlap-school", "assignmentId": "eng-essay", "start": "2026-10-13T14:30:00", "end": "2026-10-13T15:30:00"},
            {"id": "blk-quiz", "assignmentId": "bio-quiz", "start": "2026-10-13T16:00:00", "end": "2026-10-13T16:30:00"},
            {"id": "blk-a", "assignmentId": "math-problems", "start": "2026-10-13T17:00:00", "end": "2026-10-13T18:00:00"},
            {"id": "blk-b", "assignmentId": "proj", "taskId": "proj-t1", "start": "2026-10-13T17:30:00", "end": "2026-10-13T18:30:00"},
        ]
        text = render(doc, days=2, view="agenda")
        tuesday = "\n".join(day(text, "Tuesday"))
        self.assertIn("  2:30 PM–3:30 PM     English / Othello essay\n                      ! Conflict: overlaps School", tuesday)
        self.assertIn("! Late: ends after the quiz (Tue, Oct 13, 9:00 AM)", tuesday)
        self.assertIn("  5:00 PM–6:00 PM     Math / Problems 12–24\n                      ! Conflict: overlaps Project\n"
                      "                      ! Late: ends after the due date (Tue, Oct 13 — no time\n"
                      "                        given, so it counts as due at 12:00 AM)", tuesday)
        self.assertIn("5:30 PM–6:30 PM Project — Outline ! Conflict: overlaps Math / Problems 12–24 "
                      "! Late: ends after the deadline of \"Outline\" (Tue, Oct 13, 12:00 PM)", flat(tuesday))
        self.assertIn("! Conflict: overlaps Project", tuesday)
        self.assertIn("  Quiz today: Cells quiz (9:00 AM)", tuesday)
        self.assertIn("  Checkpoint due today: Project — Outline (12:00 PM)", tuesday)
        self.assertIn("  Due today: Math / Problems 12–24", tuesday)  # date-only: no time
        # With the person's default due time at the end of the day, the date-only due is not missed.
        doc["settings"] = {"defaultDueTime": "23:59"}
        self.assertNotIn("ends after the due date", render(doc, days=2, view="agenda"))

    def test_overload_and_daily_limit(self):
        doc = base_doc()
        doc["settings"] = {"maxDailyStudyMinutes": 60}
        doc["availability"][0]["endTime"] = "17:00"  # 1h 30m of free time
        doc["scheduleBlocks"] = [
            {"id": "blk-1", "assignmentId": "eng-essay", "start": "2026-10-13T15:30:00", "end": "2026-10-13T17:00:00"},
            {"id": "blk-2", "assignmentId": "eng-read-6", "start": "2026-10-13T17:00:00", "end": "2026-10-13T17:45:00"},
            # User blocks alone never trigger the daily-limit warning (section 13.4).
            {"id": "blk-3", "assignmentId": "eng-read-6", "origin": "user", "start": "2026-10-14T15:30:00", "end": "2026-10-14T17:00:00"},
        ]
        text = render(doc, days=3)
        week = section(text, "Week overview")
        self.assertIn("Tue Oct 13  free 1h 30m   planned 2h 15m   ! over free time by 45m", week)
        self.assertIn("            ! over daily limit by 1h 15m  Due: English / Othello essay", week)
        self.assertIn("Wed Oct 14  free 1h 30m   planned 1h 30m   Due: English / Read Chapter 6", week)
        tuesday = day(text, "Tuesday")
        self.assertIn("! Over capacity: 2h 15m of work planned but only 1h 30m of free study time (45m too much)",
                      flat(tuesday))
        self.assertIn("  ! Above your daily limit: 2h 15m planned, limit 1h (1h 15m over)", tuesday)
        self.assertFalse(any("daily limit" in line for line in day(text, "Wednesday")))


class Assignments(unittest.TestCase):
    def doc(self):
        doc = base_doc()
        doc["meta"]["generatedAt"] = "2026-10-14T12:00:00"
        doc["assignments"] = [
            {"id": "late-hw", "title": "Late homework", "due": "2026-10-13T23:59:00", "estimatedMinutes": 30},
            {"id": "week-test", "classId": "cls-math", "title": "Unit 3 test", "type": "test", "assessmentDate": "2026-10-16",
             "estimatedMinutes": 90, "estimateRange": {"min": 60, "max": 120}, "priority": "urgent",
             "recommendedCompletionDate": "2026-10-15"},
            {"id": "later-essay", "classId": "cls-eng", "title": "Essay", "type": "writing", "due": "2026-10-23", "estimatedMinutes": 120,
             "status": "in_progress",
             "tasks": [{"id": "later-essay-t1", "title": "Outline", "estimatedMinutes": 30, "status": "done", "completedAt": "2026-10-13T20:00:00"},
                       {"id": "later-essay-t2", "title": "Draft", "estimatedMinutes": 60, "due": "2026-10-20"},
                       {"id": "later-essay-t3", "title": "Poster", "estimatedMinutes": 30, "status": "cancelled"}]},
            {"id": "undated", "title": "Read for fun", "type": "reading", "required": False},
            {"id": "gone", "classId": "cls-eng", "title": "Old worksheet", "due": "2026-10-09", "estimatedMinutes": 20, "sourceState": "missing"},
            {"id": "finished", "title": "Finished lab", "type": "lab", "due": "2026-10-15", "status": "done", "completedAt": "2026-10-12T20:00:00"},
        ]
        doc["scheduleBlocks"] = [
            {"id": "blk-t2", "assignmentId": "later-essay", "taskId": "later-essay-t2", "start": "2026-10-15T16:00:00", "end": "2026-10-15T16:40:00"},
        ]
        doc["issues"] = [{"id": "q-essay", "kind": "ambiguity", "itemId": "later-essay-t2", "message": "Is the draft due Oct 20?"}]
        return doc

    def test_groups_order_and_progress(self):
        text = render(self.doc(), now="2026-10-14T12:00:00", view="assignments")
        lines = section(text, "Assignments")
        groups = [line for line in lines if line and not line.startswith(" ")]
        self.assertEqual(groups, [
            "Remaining 3h 30m · scheduled 40m · unscheduled 2h 50m (3 assignments counted)",
            "Overdue", "This week (through Sun, Oct 18)", "Later (after Sun, Oct 18)", "No date", "Past, not counted",
            "1 done or cancelled assignment not shown.",
        ])
        body = "\n".join(lines)
        self.assertIn("Overdue\n  Late homework\n    Homework · not started\n    Due Tue, Oct 13, 11:59 PM", body)
        self.assertIn("Math / Unit 3 test Test · not started · urgent Test Fri, Oct 16 · aim to finish Thu, Oct 15 "
                      "Estimate 1h 30m (1h–2h) · remaining 1h 30m · scheduled 0m unscheduled 1h 30m", flat(body))
        # Section 8.1: 0 (done) + 60 + 0 (cancelled) + max(0, 120 - 90 - 0) = 90.
        self.assertIn("    Estimate 2h · remaining 1h 30m · scheduled 40m · unscheduled 50m", body)
        self.assertIn("    ! 1 open issue\n    Tasks:\n      ✓ Outline · done · 30m\n"
                      "      - Draft · not started · 1h · checkpoint due Tue, Oct 20", body)
        self.assertNotIn("Poster", body)  # cancelled task hidden
        self.assertIn("  Read for fun\n    Reading · not started · optional · not counted\n    No due date\n"
                      "    No estimate", body)
        self.assertIn("  English / Old worksheet\n    Homework · not started · no longer in source · not counted", body)
        self.assertNotIn("Finished lab", body)
        progress = R.Model(normalized(self.doc()), "2026-10-14T12:00:00").progress(
            next(a for a in normalized(self.doc())["assignments"] if a["id"] == "later-essay"))
        self.assertEqual((progress["remaining"], progress["scheduled"], progress["unscheduled"]), (90, 40, 50))

    def test_include_done_and_week_start(self):
        doc = self.doc()
        text = render(doc, now="2026-10-14T12:00:00", view="assignments", include_done=True)
        self.assertIn("Done or cancelled\n  Finished lab\n    Lab · done", text)
        self.assertIn("Poster · cancelled", text)
        doc["settings"] = {"weekStartsOn": "sunday"}
        text = render(doc, now="2026-10-14T12:00:00", view="assignments")
        self.assertIn("This week (through Sat, Oct 17)", text)


class IssuesAndText(unittest.TestCase):
    def doc(self):
        doc = base_doc()
        doc["assignments"][0]["issues"] = [{"id": "a:1", "kind": "missing_information", "message": "Which edition?"},
                                           {"id": "a:2", "kind": "conflict", "status": "dismissed", "message": "Old conflict"}]
        doc["scheduleBlocks"][0]["issues"] = [{"id": "b:1", "kind": "other", "message": "Block note"}]
        doc["issues"] = [{"id": "workload:2026-10-13", "kind": "workload", "date": "2026-10-13", "message": "Tuesday is tight."},
                         {"id": "root", "kind": "ambiguity", "message": "Which time zone?"}]
        return doc

    def test_issue_list_and_day_issues(self):
        text = render(self.doc(), days=2)
        issues = section(text, "Open issues")
        self.assertEqual(issues, [
            "- Workload · Tue, Oct 13", "  Tuesday is tight.",
            "- Ambiguous", "  Which time zone?",
            "- Missing information · English / Read Chapter 6", "  Which edition?",
            "- Note · English / Read Chapter 6 (Tue, Oct 13, 4:00 PM)", "  Block note",
        ])
        self.assertIn("  ! Workload issue about this day: see Open issues below", day(text, "Tuesday"))
        agenda = render(self.doc(), days=2, view="agenda")
        self.assertIn("  ! Workload: Tuesday is tight.", day(agenda, "Tuesday"))
        self.assertNotIn("Old conflict", text)
        self.assertIn("- Conflict · dismissed · English / Read Chapter 6",
                      render(self.doc(), view="issues", include_done=True))
        self.assertIn("No open issues.", render(base_doc(), view="issues"))

    def test_hostile_text_is_neutralized(self):
        doc = base_doc()
        doc["assignments"][1]["title"] = "Essay ```\n# not a heading‮​\x1b[31m"
        doc["scheduleBlocks"][0]["description"] = "Line one\n\n```text\nLine two\twith tab"
        text = render(doc, days=2)
        self.assertNotIn("```", text)
        for bad in ("‮", "​", "\x1b", "\t"):
            self.assertNotIn(bad, text)
        self.assertIn("English / Essay ''' # not a heading[31m", text)
        self.assertIn("Line one '''text Line two with tab", text)

    def test_ascii_width_and_long_words(self):
        doc = base_doc()
        doc["meta"]["title"] = "Été 2026 — Ünïcödé 😀 数学 ½ ‘quotes’ “double” …"
        doc["classes"][0]["name"] = "Français avancé"
        doc["assignments"][0]["title"] = "Lire « Les Misérables » – chapitre 6 → résumé " + "x" * 150
        doc["events"][0]["location"] = "https://example.com/" + "a" * 120
        doc["issues"] = [{"id": "i", "kind": "other", "message": "Très long " * 40}]
        for width in (40, 52, 78, 120):
            for ascii_only in (False, True):
                text = render(doc, days=7, width=width, ascii_only=ascii_only, include_done=True)
                for line in text.splitlines():
                    self.assertLessEqual(len(line), width, (width, line))
                if ascii_only:
                    self.assertTrue(all(ord(ch) < 128 for ch in text), [ch for ch in text if ord(ch) >= 128][:5])
        text = render(doc, days=2, ascii_only=True)
        self.assertIn("Ete 2026 - Unicode ? ?? 1/2 'quotes' \"double\" ...", text)
        self.assertIn("  5:00 PM-5:45 PM     Math / Problems 12-24   [x] done", text)
        self.assertIn("  3:30 PM             ---- Available until 4:00 PM", text)
        self.assertIn("-- Week overview ---", text)
        self.assertIn("Free 6h | Planned 1h 30m (45m done)", text)


class Cli(unittest.TestCase):
    def test_views_range_now_and_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_json(tmp, "schedule.json", base_doc())
            res = run_script("render_schedule", path, "--view", "week", "--from", "2026-10-13", "--to", "2026-10-14")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn("Tue, Oct 13 – Wed, Oct 14, 2026", res.stdout)
            self.assertEqual(len(section(res.stdout, "Week overview")), 2)
            self.assertNotIn("Day by day", res.stdout)
            self.assertNotIn("Assignments", res.stdout)
            res = run_script("render_schedule", path, "--view", "agenda", "--days", "1", "--now", "2026-10-13T09:00")
            self.assertIn("Shown as of Tue, Oct 13, 2026, 9:00 AM", res.stdout)
            self.assertEqual(list(days_of(res.stdout)), ["Tuesday, October 13 (today)"])
            res = run_script("render_schedule", path, "--view", "assignments")
            self.assertNotIn("Oct 12 –", res.stdout)  # no day range for the assignment list
            self.assertIn("── Assignments", res.stdout)
            res = run_script("render_schedule", path, "--ascii")
            self.assertTrue(res.stdout.isascii() and len(res.stdout.splitlines()) > 10)
            for bad in (["--width", "20"], ["--days", "0"], ["--now", "2026-10-13"], ["--from", "2026-02-30"],
                        ["--from", "2026-10-14", "--to", "2026-10-13"], ["--days", "3", "--to", "2026-10-20"],
                        ["--view", "month"]):
                res = run_script("render_schedule", path, *bad)
                self.assertEqual(res.returncode, 2, bad)
                self.assertEqual(res.stdout, "", bad)

    def test_no_generated_at_uses_clock(self):
        doc = base_doc()
        del doc["meta"]["generatedAt"]
        del doc["meta"]["title"]
        with tempfile.TemporaryDirectory() as tmp:
            res = run_script("render_schedule", write_json(tmp, "s.json", doc), "--view", "week")
            self.assertEqual(res.returncode, 0, res.stderr)
            lines = res.stdout.splitlines()
            self.assertEqual(lines[0], "Schedule")
            self.assertIn("Generation time not recorded (America/New_York)", lines)

    def test_invalid_file(self):
        doc = base_doc()
        doc["assignments"][0]["due"] = "2026-02-30"
        doc["scheduleBlocks"].append({"id": "blk-ghost", "assignmentId": "no-such-assignment", "start": "2026-10-13T19:00:00",
                                      "end": "2026-10-13T19:30:00"})
        with tempfile.TemporaryDirectory() as tmp:
            path = write_json(tmp, "bad.json", doc)
            res = run_script("render_schedule", path)
            self.assertEqual(res.returncode, 2)
            self.assertEqual(res.stdout, "")
            self.assertIn("not a valid schedule file", res.stderr)
            self.assertIn("assignments[0].due", res.stderr)
            self.assertIn("scheduleBlocks[3].assignmentId", res.stderr)
            res = run_script("render_schedule", path, "--force")
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertTrue(res.stdout.startswith("! THIS FILE IS NOT VALID, so the website will not import it."))
            self.assertIn("!   assignments[0].due:", res.stdout)
            self.assertIn("  4:00 PM–4:45 PM     English / Read Chapter 6", res.stdout)  # the valid parts are shown
            self.assertIn("No date\n  English / Read Chapter 6", res.stdout)  # its invalid due was left out
            self.assertNotIn("7:00 PM–7:30 PM", res.stdout)  # the block without a valid assignment was left out
            for text in ("{not json", "[1, 2]", ""):
                res = run_script("render_schedule", write_json(tmp, "broken.json", text), "--force")
                self.assertEqual(res.returncode, 2, text)
                self.assertEqual(res.stdout, "")
            res = run_script("render_schedule", os.path.join(tmp, "missing.json"))
            self.assertEqual(res.returncode, 2)
            self.assertIn("Cannot read the file", res.stderr)

    def test_force_repairs_structure(self):
        doc = base_doc()
        doc["schemaVersion"] = 1.0
        doc["classes"] = "English"
        doc["events"][0]["recurrence"]["daysOfWeek"] = ["Monday"]
        doc["assignments"][1]["tasks"] = [{"id": "t", "estimatedMinutes": 10}]  # a task without a title
        result = RS.prune_until_valid(doc, "2026-10-12")
        self.assertIsNotNone(result[0])
        self.assertEqual(result[0]["classes"], [])
        self.assertEqual(result[0]["assignments"][1].get("tasks", []), [])
        self.assertGreaterEqual(len(result[1]), 4)
        self.assertEqual(RS.parse_path('assignments[3].tasks[0]["odd key"]'), ["assignments", 3, "tasks", 0, "odd key"])


class SkillInstructions(unittest.TestCase):
    def test_skill_md_wires_the_text_view(self):
        with open(os.path.join(SKILL_DIR, "SKILL.md"), encoding="utf-8") as handle:
            text = handle.read()
        frontmatter = re.match(r"---\n(.*?)\n---\n", text, re.S).group(1)
        self.assertIn('argument-hint: "[text] [what to plan: files, notes, or \'update\']"', frontmatter.splitlines())
        for key in ("name: academic-schedule", "effort: xhigh"):
            self.assertIn(key, frontmatter.splitlines())
        self.assertLessEqual(len(text.splitlines()), 320)
        flat_text = re.sub(r"\s+", " ", text)
        for phrase in ("## Showing the schedule in the chat", "render_schedule.py", "verbatim", "```text", "```json",
                       "Never hand-write", "Want to see the full schedule here? Ask for the text view.",
                       "Paste the file's text instead", "The JSON file stays the source of truth"):
            self.assertIn(phrase, flat_text)

    def test_packaged(self):
        spec = importlib.util.spec_from_file_location("package_skill", os.path.join(SKILL_DIR, "package_skill.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertIn("academic-schedule/scripts/render_schedule.py", [arc for _full, arc in module.collect()])
        self.assertEqual(module.check_frontmatter(module.read_frontmatter(os.path.join(SKILL_DIR, "SKILL.md"))), [])


class Documentation(unittest.TestCase):
    def test_schedule_skill_example_is_real_output(self):
        path = os.path.join(WEBSITE, "SCHEDULE_SKILL.md")
        if not os.path.exists(path):
            self.skipTest("academic-scheduler/SCHEDULE_SKILL.md not present (skill used outside the repository)")
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        part = text.split("## Seeing the schedule in the chat", 1)[1].split("\n## ", 1)[0]
        blocks = re.findall(r"```text\n(.*?\n)```", part, re.S)
        week = run_script("render_schedule", EXAMPLE_PATH, "--from", "2026-10-12", "--days", "3", "--view", "week")
        agenda = run_script("render_schedule", EXAMPLE_PATH, "--from", "2026-10-13", "--days", "1", "--view", "agenda")
        self.assertEqual(blocks, [week.stdout, agenda.stdout])


if __name__ == "__main__":
    unittest.main()
