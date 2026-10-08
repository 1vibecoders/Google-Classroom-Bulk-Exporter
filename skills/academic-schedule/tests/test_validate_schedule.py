"""validate_schedule.py: the shared fixtures, the shipped examples and the points a Python validator must get right."""
from __future__ import annotations

import copy
import glob
import json
import os
import tempfile
import unittest

from helpers import EXAMPLES, FIXTURES, load_script, run_script

V = load_script("validate_schedule")
TODAY = "2026-10-07"

BASE = {
    "schemaVersion": "1.0",
    "meta": {"generatedAt": "2026-10-07T18:00:00", "timezone": "America/New_York",
             "generator": {"name": "academic-schedule-skill", "version": "1.0"}},
    "classes": [{"id": "cls-biology", "name": "Biology", "origin": "generated"}],
    "assignments": [{
        "id": "biology-lab-2026-10-16", "classId": "cls-biology", "title": "Lab report", "type": "lab",
        "due": "2026-10-16T23:59:00", "estimatedMinutes": 90, "estimateRange": {"min": 75, "max": 105},
        "tasks": [{"id": "biology-lab-2026-10-16-t1", "title": "Analyse", "estimatedMinutes": 30},
                  {"id": "biology-lab-2026-10-16-t2", "title": "Write", "estimatedMinutes": 60,
                   "dependsOn": ["biology-lab-2026-10-16-t1"]}],
        "origin": "generated",
    }],
    "events": [{"id": "evt-school", "title": "School", "startTime": "08:00", "endTime": "15:00",
                "recurrence": {"frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-10-05"}}],
    "availability": [{"id": "avail-after-school-1530-2100", "label": "After school", "startTime": "15:30", "endTime": "21:00",
                      "recurrence": {"frequency": "weekly", "daysOfWeek": ["mon", "tue", "wed", "thu", "fri"], "startDate": "2026-10-05"}}],
    "scheduleBlocks": [{"id": "blk-biology-lab-2026-10-16-202610071800-1", "assignmentId": "biology-lab-2026-10-16",
                        "taskId": "biology-lab-2026-10-16-t1", "start": "2026-10-12T16:00:00", "end": "2026-10-12T16:30:00",
                        "description": "Analyse the data."}],
}


def doc(**changes):
    d = copy.deepcopy(BASE)
    for key, value in changes.items():
        d[key] = value
    return d


def paths(result):
    return [e["path"] for e in result.errors]


class SharedFixtures(unittest.TestCase):
    """The same fixtures the website's validator is tested against (schema-parity.test.ts)."""

    def fixture_files(self, kind):
        files = sorted(glob.glob(os.path.join(FIXTURES, kind, "*.json")))
        if not files:
            self.skipTest("shared fixtures not found at %s" % FIXTURES)
        return files

    def test_valid_fixtures_and_examples_are_accepted(self):
        files = self.fixture_files("valid") + sorted(glob.glob(os.path.join(EXAMPLES, "*.json")))
        for path in files:
            with self.subTest(os.path.basename(path)):
                result = V.validate_file(path, today=TODAY)
                self.assertEqual(result.errors, [], path)
                self.assertTrue(result.ok)
                with open(path, encoding="utf-8") as handle:
                    meta = json.load(handle).get("x-fixture", {})
                warning_paths = [w["path"] for w in result.warnings]
                for expected in meta.get("expectedWarningPaths", []):
                    self.assertIn(expected, warning_paths)

    def test_invalid_fixtures_are_rejected_at_the_expected_paths(self):
        for path in self.fixture_files("invalid"):
            with self.subTest(os.path.basename(path)):
                result = V.validate_file(path, today=TODAY)
                self.assertFalse(result.ok)
                self.assertIsNone(result.doc)
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
                meta = data.get("x-fixture", {}) if isinstance(data, dict) else {}
                for expected in meta.get("expectedErrorPaths", [""]):
                    self.assertIn(expected, paths(result), json.dumps(result.errors)[:500])
                for error in result.errors:
                    self.assertGreater(len(error["message"]), 10)


class Rules(unittest.TestCase):
    def check(self, data, ok=True):
        result = V.validate_document(data, today=TODAY)
        self.assertEqual(result.ok, ok, json.dumps(result.errors)[:800])
        return result

    def test_base_document_is_valid(self):
        self.check(doc())

    def test_full_match_patterns(self):
        d = doc()
        d["assignments"][0]["due"] = "2026-10-16\n"
        self.assertIn("assignments[0].due", paths(self.check(d, ok=False)))
        d = doc()
        d["events"][0]["startTime"] = "08:00\n"
        self.assertIn("events[0].startTime", paths(self.check(d, ok=False)))

    def test_integers(self):
        d = doc()
        d["assignments"][0]["estimatedMinutes"] = 90.0
        self.check(d)
        for bad in (True, "90", 90.5, -1, 10001):
            d = doc()
            d["assignments"][0]["estimatedMinutes"] = bad
            self.assertIn("assignments[0].estimatedMinutes", paths(self.check(d, ok=False)), bad)

    def test_lengths_in_code_points(self):
        d = doc()
        d["assignments"][0]["title"] = "\U0001F600" * 200
        self.check(d)
        d["assignments"][0]["title"] = "\U0001F600" * 201
        self.assertIn("assignments[0].title", paths(self.check(d, ok=False)))

    def test_blank_required_text_and_trimming(self):
        d = doc()
        d["assignments"][0]["title"] = "  　 "
        self.assertIn("assignments[0].title", paths(self.check(d, ok=False)))
        d = doc()
        d["assignments"][0]["title"] = "  Lab report  "
        result = self.check(d)
        self.assertEqual(result.doc["assignments"][0]["title"], "Lab report")

    def test_null_only_inside_extensions(self):
        d = doc()
        d["x-tool"] = {"a": None, "__proto__": [None]}
        self.check(d)
        d = doc()
        d["classes"][0]["teacher"] = None
        self.assertIn("classes[0].teacher", paths(self.check(d, ok=False)))

    def test_real_dates(self):
        for bad in ("2026-02-30", "2027-02-29"):
            d = doc()
            d["assignments"][0]["due"] = bad
            self.assertIn("assignments[0].due", paths(self.check(d, ok=False)))
        d = doc()
        d["assignments"][0]["due"] = "2028-02-29"
        self.check(d)

    def test_local_date_times(self):
        for bad in ("2026-10-16T23:59:00Z", "2026-10-16T23:59:00-04:00", "2026-10-16 23:59", "2026-10-16T23:59:30"):
            d = doc()
            d["assignments"][0]["due"] = bad
            self.assertIn("assignments[0].due", paths(self.check(d, ok=False)), bad)
        d = doc()
        d["scheduleBlocks"][0]["start"] = "2026-10-12T16:00"
        result = self.check(d)
        self.assertEqual(result.doc["scheduleBlocks"][0]["start"], "2026-10-12T16:00:00")

    def test_block_end_rules(self):
        d = doc()
        d["scheduleBlocks"][0]["start"] = "2026-10-12T23:00:00"
        d["scheduleBlocks"][0]["end"] = "2026-10-13T00:00:00"
        self.check(d)
        d["scheduleBlocks"][0]["end"] = "2026-10-13T00:30:00"
        self.assertIn("scheduleBlocks[0].end", paths(self.check(d, ok=False)))
        d["scheduleBlocks"][0]["end"] = "2026-10-12T23:04:00"
        self.assertIn("scheduleBlocks[0].end", paths(self.check(d, ok=False)))

    def test_references_and_ids(self):
        d = doc()
        d["assignments"][0]["classId"] = "English 10"
        self.assertIn("assignments[0].classId", paths(self.check(d, ok=False)))
        d = doc()
        d["events"][0]["id"] = "cls-biology"
        self.assertIn("events[0].id", paths(self.check(d, ok=False)))
        d = doc()
        d["scheduleBlocks"][0]["taskId"] = "nope-t9"
        self.assertIn("scheduleBlocks[0].taskId", paths(self.check(d, ok=False)))
        d = doc(deleted=[{"id": "biology-lab-2026-10-16", "collection": "assignments", "deletedAt": "2026-10-07T10:00:00"}])
        self.assertIn("assignments[0].id", paths(self.check(d, ok=False)))

    def test_dependency_cycle(self):
        d = doc()
        d["assignments"][0]["tasks"][0]["dependsOn"] = ["biology-lab-2026-10-16-t2"]
        self.assertIn("assignments[0].tasks[0].dependsOn", paths(self.check(d, ok=False)))

    def test_date_order_rules(self):
        d = doc()
        d["assignments"][0]["recommendedCompletionDate"] = "2026-10-16"
        self.check(d)  # a Date compares by date only
        d["assignments"][0]["recommendedCompletionDate"] = "2026-10-17"
        self.assertIn("assignments[0].recommendedCompletionDate", paths(self.check(d, ok=False)))
        d = doc()
        d["assignments"][0]["tasks"][0]["due"] = "2026-10-17"
        self.assertIn("assignments[0].tasks[0].due", paths(self.check(d, ok=False)))

    def test_estimate_range(self):
        d = doc()
        d["assignments"][0]["estimatedMinutes"] = 120
        self.assertIn("assignments[0].estimatedMinutes", paths(self.check(d, ok=False)))
        d = doc()
        del d["assignments"][0]["estimatedMinutes"]
        result = self.check(d, ok=False)
        self.assertIn("assignments[0].estimatedMinutes", paths(result))
        self.assertIn("point estimate is 90", result.errors[0]["message"])

    def test_settings_after_defaults(self):
        self.assertIn("settings.dayStartTime", paths(self.check(doc(settings={"dayStartTime": "23:00"}), ok=False)))
        self.assertIn("settings.minSessionMinutes", paths(self.check(doc(settings={"minSessionMinutes": 100}), ok=False)))
        self.check(doc(settings={"dayEndTime": "24:00", "minSessionMinutes": 60, "maxSessionMinutes": 60}))

    def test_unsupported_versions_stop_with_one_error(self):
        for version in ("2.0", "1.3", "one"):
            result = self.check(doc(schemaVersion=version), ok=False)
            self.assertEqual(len(result.errors), 1)
            self.assertEqual(result.errors[0]["path"], "schemaVersion")
        result = self.check(doc(schemaVersion=1.0), ok=False)
        self.assertEqual(paths(result), ["schemaVersion"])
        result = V.validate_document([], today=TODAY)
        self.assertEqual(paths(result), [""])

    def test_unknown_properties_with_suggestion(self):
        d = doc()
        d["assignments"][0]["dueDate"] = "2026-10-16"
        result = self.check(d, ok=False)
        self.assertIn("assignments[0].dueDate", paths(result))
        self.assertIn('Did you mean "due"', result.errors[0]["message"])
        d = doc()
        d["assignments"][0]["odd key"] = 1
        self.assertIn('assignments[0]["odd key"]', paths(self.check(d, ok=False)))

    def test_warnings(self):
        d = doc(settings={"maxSessionMinutes": 20})
        d["scheduleBlocks"][0]["start"] = "2026-10-17T10:00:00"
        d["scheduleBlocks"][0]["end"] = "2026-10-17T11:00:00"
        result = self.check(d)
        codes = {w["code"] for w in result.warnings}
        self.assertIn("block-after-due", codes)
        self.assertIn("session-too-long", codes)


class Parsing(unittest.TestCase):
    def test_bom_nan_duplicates_and_size(self):
        text = json.dumps(BASE)
        self.assertTrue(V.parse_schedule_bytes(("﻿" + text).encode("utf-8"), today=TODAY).ok)
        self.assertFalse(V.parse_schedule_text(text.replace('"estimatedMinutes": 90', '"estimatedMinutes": NaN'), today=TODAY).ok)
        bad = V.parse_schedule_text('{"schemaVersion": "1.0", "classes": [,]}')
        self.assertIn("line 1", bad.errors[0]["message"])
        dup = V.parse_schedule_text(text[:-1] + ', "classes": []}', today=TODAY)
        self.assertTrue(any(w["code"] == "duplicate-key" for w in dup.warnings))
        big = V.parse_schedule_bytes(b" " * (V.MAX_FILE_BYTES + 1))
        self.assertEqual(big.errors[0]["code"], "too-large")
        self.assertFalse(V.parse_schedule_bytes(b"\xff\xfe{}").ok)

    def test_deep_extension_values(self):
        value = []
        for _ in range(250):
            value = [value]
        d = doc()
        d["x-deep"] = value
        self.assertIn("x-deep", paths(V.validate_document(d, today=TODAY)))


class CommandLine(unittest.TestCase):
    def write(self, folder, name, data):
        path = os.path.join(folder, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(data if isinstance(data, str) else json.dumps(data))
        return path

    def test_exit_codes_and_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            good = self.write(tmp, "good.json", BASE)
            bad_doc = doc()
            bad_doc["assignments"][0]["due"] = "Oct 16"
            bad = self.write(tmp, "bad.json", bad_doc)
            res = run_script("validate_schedule", good, "--today", TODAY)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            self.assertIn("valid", res.stdout)
            res = run_script("validate_schedule", good, bad, "--today", TODAY)
            self.assertEqual(res.returncode, 1)
            self.assertIn("assignments[0].due", res.stdout)
            res = run_script("validate_schedule", bad, "--json")
            payload = json.loads(res.stdout)
            self.assertFalse(payload["valid"])
            self.assertEqual(payload["files"][0]["errors"][0]["path"], "assignments[0].due")
            res = run_script("validate_schedule", os.path.join(tmp, "missing.json"))
            self.assertEqual(res.returncode, 1)

    def test_generator_checks(self):
        d = doc()
        d["meta"]["exportId"] = "u-exp-abcdefgh"
        d["issues"] = [{"kind": "workload", "message": "Thursday is tight."}]
        d["assignments"][0]["estimatedMinutes"] = 80
        result = V.validate_document(d, today=TODAY, generator=True)
        codes = {w["code"] for w in result.warnings}
        self.assertTrue(result.ok)
        self.assertIn("gen-export-id", codes)
        self.assertIn("gen-issue-id", codes)
        self.assertIn("gen-point-estimate", codes)


if __name__ == "__main__":
    unittest.main()
