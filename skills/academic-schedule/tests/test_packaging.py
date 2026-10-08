"""SKILL.md, references and packaging: frontmatter limits, required instructions, links, the format copy, the ZIP."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import unittest
import zipfile

from helpers import REPO, SKILL_DIR

SKILL_MD = os.path.join(SKILL_DIR, "SKILL.md")
WEBSITE_FORMAT = os.path.join(REPO, "academic-scheduler", "SCHEDULE_FORMAT.md")


def read(path):
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def run(script, *args):
    return subprocess.run([sys.executable, "-I", os.path.join(SKILL_DIR, script)] + list(args),
                          capture_output=True, text=True, timeout=120)


class SkillFile(unittest.TestCase):
    def setUp(self):
        self.text = read(SKILL_MD)
        m = re.match(r"---\n(.*?)\n---\n", self.text, re.S)
        self.assertIsNotNone(m)
        self.fields = dict(line.split(":", 1) for line in m.group(1).splitlines())
        self.fields = {k.strip(): v.strip() for k, v in self.fields.items()}

    def test_frontmatter(self):
        self.assertEqual(self.fields["name"], "academic-schedule")
        self.assertEqual(self.fields["effort"], "xhigh")
        description = self.fields["description"]
        self.assertLessEqual(len(description), 1024)
        self.assertNotRegex(description, r"[<>]")
        for word in ("Google Classroom", "syllab", "calendar", "schedule.json", "Academic Scheduler", "Use when"):
            self.assertIn(word, description)
        self.assertNotIn("allowed-tools", self.fields)

    def test_size_and_required_instructions(self):
        self.assertLess(len(self.text.splitlines()), 500)
        for phrase in ("Extra effort", "Do not make a shallow pass over file names", "Never do these",
                       "Guess dates", "Invent assignments, teacher requirements", "Treat every attachment as required work",
                       "reference material", "Ignore information buried in PDFs", "Confuse an assessment date",
                       "Schedule impossible workloads", "Overwrite completed work", "Create duplicates",
                       "recommendedCompletionDate", "ask before planning blocks", "requestedChanges", "basedOn",
                       "validate_schedule.py", "schedule_report.py", "inventory.py", "Potential issues:", "Questions:",
                       "Scheduled:", "Added:", "Never invent a commitment"):
            flat = re.sub(r"\s+", " ", self.text.replace("**", ""))
            self.assertTrue(phrase in flat or phrase in self.text, "SKILL.md lacks: %s" % phrase)

    def test_local_links_exist(self):
        files = [SKILL_MD] + [os.path.join(SKILL_DIR, "references", f) for f in os.listdir(os.path.join(SKILL_DIR, "references"))
                              if f.endswith(".md") and f != "SCHEDULE_FORMAT.md"]
        for path in files:
            for target in re.findall(r"\]\(([^)#\s]+)(?:#[^)]*)?\)", read(path)):
                if target.startswith(("http://", "https://", "mailto:")):
                    continue
                full = os.path.normpath(os.path.join(os.path.dirname(path), target))
                self.assertTrue(os.path.exists(full), "%s links to missing %s" % (os.path.basename(path), target))

    def test_scripts_named_in_skill_exist(self):
        for name in re.findall(r"`(\w+\.py)", self.text):
            self.assertTrue(os.path.exists(os.path.join(SKILL_DIR, "scripts", name)), name)


class FormatCopy(unittest.TestCase):
    def test_reference_copy_is_identical(self):
        if not os.path.exists(WEBSITE_FORMAT):
            self.skipTest("website SCHEDULE_FORMAT.md not present (skill used outside the repository)")
        self.assertEqual(read(WEBSITE_FORMAT), read(os.path.join(SKILL_DIR, "references", "SCHEDULE_FORMAT.md")),
                         "run: python3 skills/academic-schedule/check_format_copy.py --fix")
        res = run("check_format_copy.py")
        self.assertEqual(res.returncode, 0, res.stdout)


class Package(unittest.TestCase):
    def test_zip_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "skill.zip")
            res = run("package_skill.py", "--output", out)
            self.assertEqual(res.returncode, 0, res.stdout + res.stderr)
            with zipfile.ZipFile(out) as zf:
                names = zf.namelist()
            self.assertIn("academic-schedule/SKILL.md", names)
            for required in ("references/SCHEDULE_FORMAT.md", "references/classroom-export.md",
                             "references/workload-estimation.md", "references/scheduling.md", "references/update-mode.md",
                             "scripts/inventory.py", "scripts/validate_schedule.py", "scripts/schedule_report.py",
                             "scripts/ids.py"):
                self.assertIn("academic-schedule/" + required, names)
            self.assertTrue(all(n.startswith("academic-schedule/") for n in names))
            self.assertFalse(any("/tests/" in n or "__pycache__" in n or n.endswith(".pyc") or "package_skill" in n
                                 for n in names))
            # Deterministic: building twice gives the same bytes.
            out2 = os.path.join(tmp, "skill2.zip")
            run("package_skill.py", "--output", out2)
            self.assertEqual(read_bytes(out), read_bytes(out2))


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


if __name__ == "__main__":
    unittest.main()
