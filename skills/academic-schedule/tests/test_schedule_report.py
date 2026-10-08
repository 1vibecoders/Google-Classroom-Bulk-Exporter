"""schedule_report.py: day loads, section 8.1 remaining work, problems, the update-rule check and the draft summary."""
from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest

from helpers import EXAMPLES, load_script, run_script

R = load_script("schedule_report")
V = load_script("validate_schedule")

with open(os.path.join(EXAMPLES, "complete-schedule.json"), encoding="utf-8") as _handle:
    EXAMPLE = json.load(_handle)


def normalized(data):
    result = V.validate_document(data, today="2026-10-11")
    assert result.ok, result.errors
    return result.doc


def report(data, now, prev=None, start=None, days=0):
    return R.build_report(normalized(data), now, start or now[:10], days, normalized(prev) if prev else None)


def small_doc():
    return {
        "schemaVersion": "1.0",
        "meta": {"generatedAt": "2026-10-12T07:00:00", "timezone": "America/New_York",
                 "generator": {"name": "academic-schedule-skill", "version": "1.0"}},
        "settings": {"maxDailyStudyMinutes": 90},
        "classes": [{"id": "cls-math", "name": "Math"}],
        "assignments": [
            {"id": "math-test-2026-10-16", "classId": "cls-math", "title": "Unit 3 test", "type": "test",
             "assessmentDate": "2026-10-16T09:00:00", "estimatedMinutes": 240},
            {"id": "math-problems-2026-10-13", "classId": "cls-math", "title": "Problems 12-24", "type": "problem_set",
             "due": "2026-10-13", "estimatedMinutes": 45},
        ],
        "events": [{"id": "evt-school", "title": "School", "category": "school", "startTime": "08:00", "endTime": "15:00",
                    "recurrence": {"frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-10-12"}}],
        "availability": [{"id": "avail-afternoon-1600-1700", "label": "Afternoon", "startTime": "16:00", "endTime": "17:00",
                          "recurrence": {"frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-10-12"}}],
        "scheduleBlocks": [
            {"id": "blk-math-problems-2026-10-13-202610120700-1", "assignmentId": "math-problems-2026-10-13",
             "start": "2026-10-12T16:00:00", "end": "2026-10-12T18:00:00"},
            {"id": "blk-math-problems-2026-10-13-202610120700-2", "assignmentId": "math-problems-2026-10-13",
             "start": "2026-10-13T16:00:00", "end": "2026-10-13T16:30:00"},
        ],
    }


class Analysis(unittest.TestCase):
    def test_complete_example_adds_up(self):
        r = report(EXAMPLE, "2026-10-11T19:30:00")
        by_id = {a["id"]: a for a in r["assignments"]}
        essay = by_id["gc-NzAwMDAwMDAwMDAx"]
        self.assertEqual((essay["estimate"], essay["remaining"], essay["scheduled"], essay["unscheduled"]), (240, 210, 210, 0))
        self.assertEqual(by_id["biology-unit-2-test-cells-2026-10-16"]["remaining"], 150)
        self.assertEqual(by_id["gc-NzAwMDAwMDAwMDAz"]["excluded"], "withdrawn")
        self.assertEqual([p for p in r["problems"] if p["kind"] != "busy-overlap"], [])
        self.assertEqual(r["feasibility"], [])
        monday = next(d for d in r["days"] if d["date"] == "2026-10-12")
        self.assertEqual(monday["planned"], 80)
        self.assertEqual(monday["free"], 240)  # no school (exception), fencing 16-18 inside 15:30-21:30
        self.assertIn("Scheduled:\n- 11 work sessions", r["summary"])

    def test_overload_prep_deadlines_and_summary(self):
        r = report(small_doc(), "2026-10-12T07:00:00", days=5)
        monday = r["days"][0]
        self.assertEqual(monday["planned"], 120)
        self.assertEqual(monday["freeAfterNow"], 60)
        self.assertEqual(monday["overload"], 60)
        self.assertTrue(monday["overDailyMax"])
        self.assertEqual(monday["outsideFree"], 60)
        kinds = {p["kind"] for p in r["problems"]}
        self.assertIn("no-prep", kinds)          # the test has no preparation
        self.assertIn("after-due", kinds)        # a date-only due means 00:00 by default
        self.assertIn("long-session", kinds)     # 2 h > maxSessionMinutes 60
        # 45 min of problems + 240 min of test prep, but only 4 x 60 min of free time before the test.
        self.assertEqual(r["feasibility"][-1]["workDue"], 285)
        self.assertEqual(r["feasibility"][-1]["freeTime"], 240)
        self.assertIn("Potential issues:", r["summary"])
        self.assertIn("Monday, Oct 12 has about 2h of work but only 1h of available time.", r["summary"])

    def test_crammed_preparation_and_past_planned(self):
        d = small_doc()
        d["availability"][0]["endTime"] = "21:00"
        d["scheduleBlocks"] = [
            {"id": "blk-a-1", "assignmentId": "math-test-2026-10-16", "start": "2026-10-15T16:00:00", "end": "2026-10-15T17:00:00"},
            {"id": "blk-a-2", "assignmentId": "math-test-2026-10-16", "start": "2026-10-15T17:10:00", "end": "2026-10-15T18:10:00"},
            {"id": "blk-b-1", "assignmentId": "math-problems-2026-10-13", "start": "2026-10-11T16:00:00", "end": "2026-10-11T16:45:00"},
        ]
        r = report(d, "2026-10-12T07:00:00")
        kinds = [p["kind"] for p in r["problems"]]
        self.assertIn("crammed", kinds)
        self.assertIn("past-planned", kinds)
        self.assertIn("unscheduled", kinds)

    def test_no_availability(self):
        d = small_doc()
        d["availability"] = []
        r = report(d, "2026-10-12T07:00:00")
        self.assertIn("no-availability", [p["kind"] for p in r["problems"]])
        self.assertIsNone(r["days"][0]["freeAfterNow"])
        self.assertEqual(r["feasibility"], [])


def previous_export():
    prev = copy.deepcopy(EXAMPLE)
    prev["meta"] = {"title": EXAMPLE["meta"]["title"], "generatedAt": "2026-10-12T07:00:00", "timezone": "America/New_York",
                    "generator": {"name": "Academic Scheduler", "version": "1.0.0"}, "exportId": "u-exp-abc12345",
                    "sources": EXAMPLE["meta"]["sources"]}
    return prev


def good_update(prev):
    new = copy.deepcopy(prev)
    new["meta"] = {"title": prev["meta"]["title"], "generatedAt": "2026-10-12T08:00:00", "timezone": "America/New_York",
                   "generator": {"name": "academic-schedule-skill", "version": "1.0"}, "basedOn": "u-exp-abc12345",
                   "sources": [{"kind": "schedule", "label": "schedule.json"}]}
    by_id = {a["id"]: a for a in new["assignments"]}
    by_id["gc-NzAwMDAwMDAwMDAy"]["due"] = "2026-10-14"        # Classroom moved the reading
    new["assignments"].append({"id": "gc-NzAwMDAwMDAwMDEw", "classId": "gc-class-NjI3ODk0MjE0NTQ5", "title": "Act 4 quiz",
                               "type": "quiz", "assessmentDate": "2026-10-20", "estimatedMinutes": 30, "origin": "generated",
                               "source": {"kind": "google_classroom", "id": "NzAwMDAwMDAwMDEw"}})
    new["scheduleBlocks"].append({"id": "blk-gc-NzAwMDAwMDAwMDEw-202610120800-1", "assignmentId": "gc-NzAwMDAwMDAwMDEw",
                                  "start": "2026-10-19T16:30:00", "end": "2026-10-19T17:00:00", "origin": "generated",
                                  "description": "Review Act 4 notes."})
    for b in new["scheduleBlocks"]:
        if b["id"] == "blk-gc-NzAwMDAwMDAwMDAy-202610092000-1":
            b["start"], b["end"] = "2026-10-13T18:30:00", "2026-10-13T19:20:00"
    return new


class UpdateRules(unittest.TestCase):
    def test_legitimate_update_has_no_violations(self):
        prev = previous_export()
        new = good_update(prev)
        r = report(new, "2026-10-12T08:00:00", prev=prev)
        self.assertEqual(r["violations"], [])
        changes = r["changes"]
        self.assertEqual([a["id"] for a in changes["assignmentsAdded"]], ["gc-NzAwMDAwMDAwMDEw"])
        updated = {a["id"]: a["details"] for a in changes["assignmentsUpdated"]}
        self.assertEqual(updated["gc-NzAwMDAwMDAwMDAy"], ["due Oct 13 -> Oct 14"])
        self.assertEqual(changes["blocks"]["added"], 1)
        self.assertEqual(changes["blocks"]["moved"], 1)
        self.assertIn("Schedule updated.", r["summary"])
        self.assertIn("- English 10 / Act 4 quiz - Oct 20", r["summary"])

    def test_broken_rules_are_reported(self):
        prev = previous_export()
        new = good_update(prev)
        new["meta"]["exportId"] = "u-exp-zzzzzzzz"
        new["meta"]["basedOn"] = "u-exp-wrong000"
        new["deleted"] = []
        by_id = {a["id"]: a for a in new["assignments"]}
        essay = by_id["gc-NzAwMDAwMDAwMDAx"]
        essay["notes"] = "rewritten"
        essay["status"] = "not_started"
        essay["issues"][0]["status"] = "open"
        by_id["gc-NzAwMDAwMDAwMDAy"]["priority"] = "low"       # overridden by the person
        new["assignments"] = [a for a in new["assignments"] if a["id"] not in ("u-asg-k3j9x2p1", "piano-theory-exam-2026-10-24")]
        new["events"] = [e for e in new["events"] if e.get("assignmentId") != "piano-theory-exam-2026-10-24"]
        new["scheduleBlocks"] = [b for b in new["scheduleBlocks"] if b.get("assignmentId") not in ("u-asg-k3j9x2p1", "piano-theory-exam-2026-10-24")]
        for b in new["scheduleBlocks"]:
            if b["id"] == "blk-gc-NzAwMDAwMDAwMDAx-202610092000-1":   # done: history
                b["description"] = "changed"
            if b["id"] == "blk-gc-NzAwMDAwMDAwMDAx-202610092000-4":   # locked
                b["start"], b["end"] = "2026-10-14T18:00:00", "2026-10-14T19:10:00"
        new["events"][0]["recurrence"]["exceptDates"] = ["2026-11-26"]  # the person's School event, no requested change
        new["classes"].append({"id": "u-cls-newnewne", "name": "Art"})
        r = report(new, "2026-10-12T08:00:00", prev=prev)
        text = "\n".join(r["violations"])
        for expected in ("meta.exportId", "meta.basedOn", "tombstone gc-NzAwMDAwMDAwMDA0", "notes changed",
                         "status went backwards", "issue gc-NzAwMDAwMDAwMDAx:conflict:due:20261016",
                         "overridden field priority", "u-asg-k3j9x2p1", "assignment piano-theory-exam-2026-10-24",
                         "blk-gc-NzAwMDAwMDAwMDAx-202610092000-1", "blk-gc-NzAwMDAwMDAwMDAx-202610092000-4",
                         "u-evt-7k2m9q4d", "u-cls-newnewne", "u-blk-m2c7q9za"):
            self.assertIn(expected, text)

    def test_requested_change_allows_protected_edit(self):
        prev = previous_export()
        new = good_update(prev)
        new["events"][0]["recurrence"]["exceptDates"] = ["2026-10-12", "2026-11-26", "2026-11-27", "2026-11-25"]
        new["meta"]["requestedChanges"] = [{"id": "u-evt-7k2m9q4d", "reason": "School calendar: no school Nov 25.",
                                            "requestedByPerson": False}]
        r = report(new, "2026-10-12T08:00:00", prev=prev)
        self.assertEqual(r["violations"], [])

    def test_check_exit_code_and_json(self):
        prev = previous_export()
        new = good_update(prev)
        bad = copy.deepcopy(new)
        bad["meta"]["exportId"] = "u-exp-zzzzzzzz"
        with tempfile.TemporaryDirectory() as tmp:
            paths = {}
            for name, data in (("prev", prev), ("new", new), ("bad", bad)):
                paths[name] = os.path.join(tmp, name + ".json")
                with open(paths[name], "w", encoding="utf-8") as handle:
                    json.dump(data, handle)
            res = run_script("schedule_report", paths["new"], "--previous", paths["prev"], "--check")
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("UPDATE-RULE CHECK (section 15): 0 violation(s)", res.stdout)
            self.assertIn("DRAFT SUMMARY", res.stdout)
            res = run_script("schedule_report", paths["bad"], "--previous", paths["prev"], "--check")
            self.assertEqual(res.returncode, 1)
            res = run_script("schedule_report", paths["new"], "--json", "--days", "3")
            data = json.loads(res.stdout)
            self.assertEqual(len(data["days"]), 3)
            with open(paths["bad"], "w", encoding="utf-8") as handle:
                handle.write('{"schemaVersion": "1.0"}')
            res = run_script("schedule_report", paths["bad"])
            self.assertEqual(res.returncode, 1)
            self.assertIn("not valid", res.stdout)


if __name__ == "__main__":
    unittest.main()
