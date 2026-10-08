"""inventory.py: both export layouts, safe extraction, text extraction and Classroom dates."""
from __future__ import annotations

import datetime as dt
import json
import os
import shutil
import stat
import tempfile
import unittest
import zipfile

from helpers import (EXAMPLES, biology_items, load_script, make_docx, make_pdf, run_script, url_id, write_class_folder,
                     zip_folder)

INV = load_script("inventory")
HAS_PDFTOTEXT = shutil.which("pdftotext") is not None


def _has_tzdata():
    try:
        import zoneinfo
        zoneinfo.ZoneInfo("America/New_York")
        return True
    except Exception:  # noqa: BLE001 - Python < 3.9 or no time-zone database
        return False


HAS_TZDATA = _has_tzdata()


def run_inventory(*inputs, extra=()):
    workdir = tempfile.mkdtemp(prefix="inv-test-")
    os.rmdir(workdir)
    res = run_script("inventory", *inputs, "--workdir", workdir, "--timezone", "America/New_York", *extra)
    with open(os.path.join(workdir, "inventory.json"), encoding="utf-8") as handle:
        data = json.load(handle)
    return res, data, workdir


def item(cls, title):
    return next(i for i in cls["items"] if i["title"] == title)


class ClassroomDates(unittest.TestCase):
    def parse(self, text, ref="2026-10-03", export="2026-10-11", past=False):
        return INV.parse_classroom_date(text, dt.date.fromisoformat(ref), "posted date", dt.date.fromisoformat(export), past)

    def test_due_with_time(self):
        p = self.parse("Oct 10, 11:59 PM")
        self.assertEqual(p["value"], "2026-10-10T23:59:00")
        self.assertEqual(p["year"], "inferred")
        self.assertEqual(self.parse("Due Oct 10, 12:00 AM")["value"], "2026-10-10T00:00:00")
        self.assertEqual(self.parse("Wed, Oct 14, 3:30 PM")["value"], "2026-10-14T15:30:00")

    def test_explicit_year_relative_and_time_only(self):
        self.assertEqual(self.parse("Sep 12, 2025")["value"], "2025-09-12")
        self.assertEqual(self.parse("Sep 12, 2025")["year"], "explicit")
        self.assertEqual(self.parse("Tomorrow, 8:00 AM")["value"], "2026-10-12T08:00:00")
        self.assertEqual(self.parse("11:59 PM")["value"], "2026-10-11T23:59:00")
        self.assertEqual(self.parse("14 Oct")["value"], "2026-10-14")

    def test_year_rollover_and_ambiguity(self):
        self.assertEqual(self.parse("Jan 5", ref="2026-12-18")["value"], "2027-01-05")
        p = self.parse("Apr 2", ref="2026-10-01")
        self.assertTrue(p.get("ambiguous"))
        self.assertTrue(p.get("alternatives"))
        posted = self.parse("Dec 18", ref="2026-10-11", past=True)
        self.assertEqual(posted["value"], "2025-12-18")

    def test_no_due_date_and_unreadable(self):
        self.assertTrue(self.parse("No due date")["none"])
        self.assertIn("note", self.parse("sometime soon"))
        self.assertIsNone(self.parse(None))


class SingleClassFolder(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="inv-single-")
        cls.folder = os.path.join(cls.tmp, "Biology - Period 2")
        write_class_folder(cls.folder, "Biology", "Period 2", "627894214549", biology_items(), topics=["Unit 2: Cells"],
                           manifest=True)
        # An attachment file that metadata.json does not list.
        with open(os.path.join(cls.folder, "Assignments", "Lab report - osmosis", "Attachments", "notes.txt"), "w") as handle:
            handle.write("Bring goggles on Monday.")
        cls.res, cls.data, cls.workdir = run_inventory(cls.folder)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        shutil.rmtree(cls.workdir, ignore_errors=True)

    def test_class_and_ids(self):
        self.assertEqual(self.res.returncode, 0, self.res.stderr)
        self.assertEqual(len(self.data["classes"]), 1)
        cls = self.data["classes"][0]
        self.assertEqual(cls["name"], "Biology")
        self.assertEqual(cls["courseId"], "NjI3ODk0MjE0NTQ5")
        self.assertEqual(cls["suggestedClassId"], "gc-class-NjI3ODk0MjE0NTQ5")
        self.assertEqual(cls["exportKind"], "class")
        self.assertEqual(cls["topics"], ["Unit 2: Cells"])
        if HAS_TZDATA:
            self.assertEqual(cls["exportedAtLocal"], "2026-10-11T18:05:00")
        self.assertTrue(cls["missingDetection"]["usable"])
        self.assertTrue(cls["missingDetection"]["coversAnnouncements"])

    def test_items_roles_and_dates(self):
        cls = self.data["classes"][0]
        lab = item(cls, "Lab report: osmosis")
        self.assertEqual(lab["role"], "work")
        self.assertEqual(lab["suggestedId"], "gc-" + url_id("700000000101"))
        self.assertEqual(lab["due"]["value"], "2026-10-16T23:59:00")
        self.assertEqual(lab["posted"]["value"], "2026-10-09")
        self.assertTrue(lab["sourcePath"].endswith("Assignments/Lab report - osmosis/metadata.json"))
        self.assertEqual(item(cls, "Unit 2 slides")["role"], "reference")
        announcement = item(cls, "Unit 2 test moved")
        self.assertEqual(announcement["role"], "announcement")
        self.assertIsNone(announcement["suggestedId"])
        self.assertEqual(item(cls, "Exit ticket")["due"]["value"], "2026-10-12T08:00:00")
        winter = item(cls, "Winter break reading")
        self.assertEqual(winter["posted"]["value"], "2025-12-18")
        self.assertEqual(winter["due"]["value"], "2026-01-05")

    def test_attachment_text(self):
        lab = item(self.data["classes"][0], "Lab report: osmosis")
        by_title = {a["title"]: a for a in lab["attachments"]}
        handout = by_title["Lab handout"]
        self.assertEqual(handout["kind"], "docx")
        self.assertEqual(handout["words"], 120)
        self.assertEqual(handout["pages"], 2)
        with open(handout["textFile"], encoding="utf-8") as handle:
            text = handle.read()
        self.assertIn("Answer questions 1-8", text)
        self.assertIn("Data table | 10", text)
        sheet = by_title["Data sheet"]
        with open(sheet["textFile"], encoding="utf-8") as handle:
            self.assertIn("Trial\tMass", handle.read())
        self.assertEqual(by_title["notes.txt"]["status"], "unlisted")
        rubric = by_title["Rubric.pdf"]
        if HAS_PDFTOTEXT:
            with open(rubric["textFile"], encoding="utf-8") as handle:
                self.assertIn("Lab report rubric", handle.read())
            self.assertEqual(rubric["pages"], 1)
        else:
            self.assertIn("read this PDF directly", rubric["note"])
        slides = item(self.data["classes"][0], "Unit 2 slides")
        pptx = next(a for a in slides["attachments"] if a["title"] == "Cells")
        self.assertEqual(pptx["slides"], 2)
        with open(pptx["textFile"], encoding="utf-8") as handle:
            self.assertIn("Diffusion", handle.read())

    def test_reports(self):
        self.assertIn("CLASS Biology - Period 2", self.res.stdout)
        with open(os.path.join(self.workdir, "inventory.txt"), encoding="utf-8") as handle:
            full = handle.read()
        self.assertIn('Due: "Oct 16, 11:59 PM" -> 2026-10-16T23:59:00', full)
        self.assertIn("(material: reference, not work unless it says so)", full)
        self.assertIn("work it announces: gc-%s-<slug(title)>" % url_id("800000000103"), full)


class AccountZip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="inv-account-")
        top = os.path.join(cls.tmp, "build", "Google Classroom Export - 2026-10-11")
        write_class_folder(os.path.join(top, "Biology - Period 2"), "Biology", "Period 2", "627894214549", biology_items())
        write_class_folder(os.path.join(top, "English 10"), "English 10", None, "627894214550",
                           [{"type": "assignment", "title": "Othello essay", "id": "700000000201", "dueText": "Oct 16, 11:59 PM",
                             "postedText": "Oct 1", "description": "1,200-1,500 words."}],
                           include_announcements=False,
                           warnings=["Stopped loading the Classwork list after many attempts; it may be incomplete."])
        manifest = {
            "kind": "account", "formatVersion": 1, "exportedAt": "2026-10-11T22:05:00.000Z", "accountIndex": 0,
            "options": {"includeAnnouncements": True, "readItemPages": True, "googleFilesExportedAs": "office"},
            "classes": [
                {"courseId": url_id("627894214549"), "name": "Biology", "section": "Period 2", "teacher": "Mr. Chen",
                 "url": "https://classroom.google.com/c/x", "folder": "Biology - Period 2", "status": "exported", "counts": {}},
                {"courseId": url_id("627894214550"), "name": "English 10", "section": None, "teacher": "Ms. Rivera",
                 "url": "https://classroom.google.com/c/y", "folder": "English 10", "status": "partial", "counts": {}},
                {"courseId": url_id("627894214551"), "name": "Chemistry", "section": None, "teacher": None,
                 "url": "https://classroom.google.com/c/z", "folder": None, "status": "failed", "counts": None,
                 "error": "The class page did not load."},
            ],
            "totals": {}, "extension": {"name": "Google Classroom Bulk Exporter", "version": "1.2.0"},
        }
        with open(os.path.join(top, "export-manifest.json"), "w", encoding="utf-8") as handle:
            json.dump(manifest, handle)
        for name in ("index.html", "export-report.txt"):
            with open(os.path.join(top, name), "w") as handle:
                handle.write("x")
        cls.zip_path = os.path.join(cls.tmp, "All classes - 2026-10-11.zip")
        zip_folder(os.path.join(cls.tmp, "build"), cls.zip_path)
        # A loose syllabus, a calendar, a photo and an existing schedule next to the ZIP.
        cls.syllabus = os.path.join(cls.tmp, "Biology syllabus.docx")
        make_docx(cls.syllabus, ["Biology syllabus", "Midterm - October 21"])
        cls.calendar = os.path.join(cls.tmp, "school.ics")
        with open(cls.calendar, "w") as handle:
            handle.write("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:No school - Indigenous Peoples'\r\n  Day\r\n"
                         "DTSTART;VALUE=DATE:20261012\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
        cls.photo = os.path.join(cls.tmp, "whiteboard.jpg")
        with open(cls.photo, "wb") as handle:
            handle.write(b"\xff\xd8\xff\xe0fakejpeg")
        cls.schedule = os.path.join(cls.tmp, "schedule.json")
        shutil.copy(os.path.join(EXAMPLES, "complete-schedule.json"), cls.schedule)
        cls.res, cls.data, cls.workdir = run_inventory(cls.zip_path, cls.syllabus, cls.calendar, cls.photo, cls.schedule)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)
        shutil.rmtree(cls.workdir, ignore_errors=True)

    def test_classes_from_account_layout(self):
        self.assertEqual(self.res.returncode, 0, self.res.stdout + self.res.stderr)
        names = sorted(c["name"] for c in self.data["classes"])
        self.assertEqual(names, ["Biology", "Chemistry", "English 10"])
        bio = next(c for c in self.data["classes"] if c["name"] == "Biology")
        self.assertEqual(bio["exportKind"], "account")
        self.assertEqual(bio["teacher"], "Mr. Chen")
        self.assertEqual(bio["status"], "exported")
        self.assertTrue(bio["missingDetection"]["usable"])
        self.assertEqual(len(bio["items"]), 5)
        english = next(c for c in self.data["classes"] if c["name"] == "English 10")
        self.assertFalse(english["missingDetection"]["usable"])
        self.assertFalse(english["missingDetection"]["coversAnnouncements"])
        chemistry = next(c for c in self.data["classes"] if c["name"] == "Chemistry")
        self.assertFalse(chemistry["exported"])
        self.assertEqual(chemistry["status"], "failed")
        self.assertEqual(self.data["exports"][0]["kind"], "account")

    def test_media_not_extracted_but_listed(self):
        bio = next(c for c in self.data["classes"] if c["name"] == "Biology")
        lecture = next(a for a in item(bio, "Unit 2 slides")["attachments"] if a["title"] == "Lecture")
        self.assertIn("not extracted", lecture["note"])
        self.assertEqual(lecture["size"], 2048)
        self.assertFalse(os.path.exists(lecture["path"]))

    def test_loose_documents_and_schedule(self):
        kinds = {d["name"]: d for d in self.data["documents"]}
        self.assertEqual(kinds["Biology syllabus.docx"]["kind"], "docx")
        with open(kinds["Biology syllabus.docx"]["textFile"], encoding="utf-8") as handle:
            self.assertIn("Midterm - October 21", handle.read())
        self.assertEqual(kinds["school.ics"]["events"], 1)
        self.assertIn("Indigenous Peoples' Day", kinds["school.ics"]["eventList"][0]["SUMMARY"])
        self.assertIn("look at it directly", kinds["whiteboard.jpg"]["note"])
        self.assertNotIn("export-manifest.json", kinds)
        self.assertEqual(len(self.data["schedules"]), 1)
        schedule = self.data["schedules"][0]
        self.assertTrue(schedule["valid"])
        self.assertEqual(schedule["basedOn"], "u-exp-h7w2c9qe")


class SafeExtraction(unittest.TestCase):
    def test_unsafe_members_are_skipped(self):
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, "evil.zip")
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("../escape.txt", "x")
                zf.writestr("/abs.txt", "x")
                zf.writestr("C:/windows.txt", "x")
                zf.writestr("ok/..\\..\\back.txt", "x")
                link = zipfile.ZipInfo("ok/link")
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                zf.writestr(link, "/etc/passwd")
                zf.writestr("ok/fine.txt", "fine")
            dest = os.path.join(tmp, "out")
            limits = INV.Limits(10 * 1024 * 1024, 100, 1024 * 1024, False)
            report = INV.safe_extract(zip_path, dest, limits)
            self.assertTrue(os.path.exists(os.path.join(dest, "ok", "fine.txt")))
            self.assertFalse(os.path.lexists(os.path.join(dest, "ok", "link")))
            self.assertFalse(os.path.exists(os.path.join(tmp, "escape.txt")))
            written = [os.path.join(dp, f) for dp, _d, fs in os.walk(tmp) for f in fs]
            self.assertTrue(all(p.startswith(dest) or p == zip_path for p in written), written)
            self.assertGreaterEqual(len(report["notes"]), 4)

    def test_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            zip_path = os.path.join(tmp, "many.zip")
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for i in range(5):
                    zf.writestr("f%d.txt" % i, "x" * 1000)
            report = INV.safe_extract(zip_path, os.path.join(tmp, "a"), INV.Limits(10 ** 9, 3, 10 ** 9, False))
            self.assertEqual(report["files"], 3)
            report = INV.safe_extract(zip_path, os.path.join(tmp, "b"), INV.Limits(10 ** 9, 100, 500, False))
            self.assertEqual(report["files"], 0)
            self.assertEqual(len(report["skipped"]), 5)

    def test_folder_paths_cannot_escape_the_class_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            secret_dir = os.path.join(tmp, "outside")
            os.makedirs(secret_dir)
            with open(os.path.join(secret_dir, "metadata.json"), "w") as handle:
                json.dump({"type": "assignment", "title": "SECRET", "description": "secret"}, handle)
            with open(os.path.join(tmp, "secret.txt"), "w") as handle:
                handle.write("secret text")
            folder = os.path.join(tmp, "Class")
            write_class_folder(folder, "Class", None, "1", [
                {"type": "assignment", "title": "Real", "id": "2", "description": "ok",
                 "attachments": [{"title": "escape", "file": "../../../secret.txt", "status": "downloaded"}]}])
            os.symlink(secret_dir, os.path.join(folder, "Assignments", "Linked"))
            with open(os.path.join(folder, "class-info.json"), encoding="utf-8") as handle:
                info = json.load(handle)
            info["items"].append({"type": "assignment", "title": "Linked", "folder": "Assignments/Linked"})
            with open(os.path.join(folder, "class-info.json"), "w", encoding="utf-8") as handle:
                json.dump(info, handle)
            res, data, workdir = run_inventory(folder)
            try:
                titles = [i["title"] for i in data["classes"][0]["items"]]
                self.assertEqual(titles, ["Real"])
                escape = data["classes"][0]["items"][0]["attachments"][0]
                self.assertNotIn("textFile", escape)
                self.assertNotIn("path", escape)
                self.assertNotIn("secret text", res.stdout)
            finally:
                shutil.rmtree(workdir, ignore_errors=True)

    def test_xml_with_dtd_is_not_parsed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bomb.docx")
            with zipfile.ZipFile(path, "w") as zf:
                zf.writestr("word/document.xml", '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')
            store = INV.TextStore(tmp)
            result = store.extract(path, "bomb")
            self.assertIn("DTD", result["note"])
            self.assertNotIn("textFile", result)


class CommandLine(unittest.TestCase):
    def test_workdir_must_be_empty_and_missing_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "x"), "w") as handle:
                handle.write("x")
            res = run_script("inventory", tmp, "--workdir", tmp)
            self.assertEqual(res.returncode, 2)
            work = os.path.join(tmp, "work")
            res = run_script("inventory", os.path.join(tmp, "nope.zip"), "--workdir", work)
            self.assertEqual(res.returncode, 1)
            self.assertIn("Input not found", res.stdout)

    def test_pdf_document(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = os.path.join(tmp, "calendar.pdf")
            make_pdf(pdf, ["Exam calendar", "Biology final: June 10"])
            work = os.path.join(tmp, "work")
            res = run_script("inventory", pdf, "--workdir", work, "--json")
            data = json.loads(res.stdout)
            doc = data["documents"][0]
            if HAS_PDFTOTEXT:
                with open(doc["textFile"], encoding="utf-8") as handle:
                    self.assertIn("Biology final: June 10", handle.read())
            else:
                self.assertIn("read this PDF directly", doc["note"])


if __name__ == "__main__":
    unittest.main()
