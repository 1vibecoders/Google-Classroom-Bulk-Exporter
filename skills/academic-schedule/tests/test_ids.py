"""ids.py: the derivation rules of SCHEDULE_FORMAT.md section 14.1 and the issue IDs of section 15.8."""
from __future__ import annotations

import unittest

from helpers import load_script, run_script

IDS = load_script("ids")
V = load_script("validate_schedule")


class Ids(unittest.TestCase):
    def test_spec_examples(self):
        self.assertEqual(IDS.classroom_id("627894214549"), "NjI3ODk0MjE0NTQ5")
        self.assertEqual(IDS.classroom_id("NjI3ODk0MjE0NTQ5"), "NjI3ODk0MjE0NTQ5")
        self.assertEqual(IDS.classroom_decimal("NjI3ODk0MjE0NTQ5"), "627894214549")
        self.assertTrue(IDS.same_classroom_id("627894214549", "NjI3ODk0MjE0NTQ5"))
        self.assertEqual(IDS.class_id("627894214549"), "gc-class-NjI3ODk0MjE0NTQ5")
        self.assertEqual(IDS.item_id("NzAwMDAwMDAwMDAx"), "gc-NzAwMDAwMDAwMDAx")
        self.assertEqual(IDS.derived_id("NzAwMDAwMDAwMDA2", "Read chapter 5"), "gc-NzAwMDAwMDAwMDA2-read-chapter-5")
        self.assertEqual(IDS.class_name_id("Biology"), "cls-biology")
        self.assertEqual(IDS.document_id("Biology", "Unit 2 Test: Cells", "2026-10-16T09:10:00"),
                         "biology-unit-2-test-cells-2026-10-16")
        self.assertEqual(IDS.personal_id("Piano theory exam", "2026-10-24"), "piano-theory-exam-2026-10-24")
        self.assertEqual(IDS.personal_id("Reading goal", None), "reading-goal-nodate")
        self.assertEqual(IDS.event_id("Fencing"), "evt-fencing")
        self.assertEqual(IDS.event_id("Piano theory exam", "2026-10-24"), "evt-piano-theory-exam-2026-10-24")
        self.assertEqual(IDS.availability_id("Weekend mornings", "10:00", "13:00"), "avail-weekend-mornings-1000-1300")
        self.assertEqual(IDS.task_id("gc-NzAwMDAwMDAwMDAx", 3), "gc-NzAwMDAwMDAwMDAx-t3")
        self.assertEqual(IDS.block_id("gc-NzAwMDAwMDAwMDAx", "2026-10-09T20:00:00", 3), "blk-gc-NzAwMDAwMDAwMDAx-202610092000-3")
        self.assertEqual(IDS.issue_id("gc-NzAwMDAwMDAwMDAx", "conflict", "due", "2026-10-17T23:59:00"),
                         "gc-NzAwMDAwMDAwMDAx:conflict:due:20261017T2359")
        self.assertEqual(IDS.issue_id("biology-unit-2-test-cells-2026-10-16", "conflict", "assessmentDate", "2026-10-23"),
                         "biology-unit-2-test-cells-2026-10-16:conflict:assessmentDate:20261023")
        self.assertEqual(IDS.point_estimate(60, 75), 70)
        self.assertEqual(IDS.point_estimate(40, 60), 50)

    def test_slug(self):
        self.assertEqual(IDS.slug("Résumé: draft?"), "resume-draft")
        self.assertEqual(IDS.slug("!!!"), "item")
        long = IDS.slug("a" * 39 + " b c d")
        self.assertLessEqual(len(long), 40)
        self.assertFalse(long.endswith("-"))
        self.assertEqual(IDS.title_key("Unit 2 Test - Cells"), IDS.title_key("unit 2 test: cells"))

    def test_lengths_and_collisions(self):
        aid = IDS.document_id("x" * 60, "y" * 60, "2026-10-16")
        self.assertLessEqual(len(aid), 78)
        self.assertTrue(aid.endswith("-2026-10-16"))
        block = IDS.block_id(aid, "2026-10-11T19:30", 1234)
        self.assertLessEqual(len(block), 100)
        long_issue = IDS.issue_id("z" * 99, "conflict", "assessmentDate", "2026-10-23")
        self.assertLessEqual(len(long_issue), 100)
        self.assertTrue(long_issue.endswith(":conflict:assessmentDate:20261023"))
        self.assertEqual(IDS.free_id("evt-fencing", ["evt-fencing"]), "evt-fencing-b")
        self.assertEqual(IDS.free_id("evt-fencing", ["evt-fencing", "evt-fencing-b"]), "evt-fencing-c")
        self.assertLessEqual(len(IDS.free_id("q" * 78, ["q" * 78])), 78)
        self.assertEqual(IDS.next_task_number("a1", ["a1-t1", "a1-t4", "a10-t9", "a1-x"]), 5)
        for value in (aid, block, long_issue):
            self.assertTrue(V.ID_RE.fullmatch(value), value)

    def test_cli(self):
        res = run_script("ids", "classroom-id", "627894214549")
        self.assertEqual(res.stdout.strip(), "NjI3ODk0MjE0NTQ5")
        res = run_script("ids", "estimate", "60", "75")
        self.assertEqual(res.stdout.strip(), "70")
        res = run_script("ids", "nonsense")
        self.assertEqual(res.returncode, 2)


if __name__ == "__main__":
    unittest.main()
