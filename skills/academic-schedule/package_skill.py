#!/usr/bin/env python3
"""Build the /academic-schedule skill as a ZIP for uploading to Claude.ai (or copying elsewhere).

    python3 skills/academic-schedule/package_skill.py [--output dist/academic-schedule-skill.zip]

The ZIP contains one top folder, academic-schedule/, with SKILL.md, references/ and scripts/
(tests, caches and these maintenance scripts are left out). Before packaging it checks the
SKILL.md frontmatter (name and description limits of Claude.ai) and that
references/SCHEDULE_FORMAT.md is identical to the website's academic-scheduler/SCHEDULE_FORMAT.md.
The archive is deterministic: the same files give a byte-identical ZIP.
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import re
import sys
import zipfile
from typing import List, Tuple

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_NAME = "academic-schedule"
INCLUDE_DIRS = ("references", "scripts")
EXCLUDE_NAMES = {"__pycache__", ".DS_Store"}
EXCLUDE_SUFFIXES = (".pyc", ".pyo")
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def read_frontmatter(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        raise ValueError("SKILL.md has no YAML frontmatter")
    fields = {}
    for line in m.group(1).splitlines():
        if ":" in line and not line.startswith(" "):
            key, value = line.split(":", 1)
            fields[key.strip()] = value.strip()
    return fields


def check_frontmatter(fields: dict) -> List[str]:
    """Problems with the frontmatter (Claude.ai: name <= 64 chars [a-z0-9-], no 'anthropic'/'claude';
    description <= 1024 chars, no XML tags)."""
    problems = []
    name = fields.get("name", "")
    if name != SKILL_NAME:
        problems.append("name must be %r, found %r" % (SKILL_NAME, name))
    if not re.fullmatch(r"[a-z0-9-]{1,64}", name) or "anthropic" in name or "claude" in name:
        problems.append("name must be 1-64 lowercase letters, digits or hyphens, without 'anthropic'/'claude'")
    description = fields.get("description", "")
    if not description:
        problems.append("description is missing")
    if len(description) > 1024:
        problems.append("description is %d characters (at most 1024)" % len(description))
    if re.search(r"[<>]", description):
        problems.append("description must not contain XML tags")
    return problems


def collect() -> List[Tuple[str, str]]:
    """(absolute path, path inside the ZIP) for every file to package, sorted."""
    files = [(os.path.join(SKILL_DIR, "SKILL.md"), "%s/SKILL.md" % SKILL_NAME)]
    for folder in INCLUDE_DIRS:
        base = os.path.join(SKILL_DIR, folder)
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDE_NAMES)
            for name in sorted(filenames):
                if name in EXCLUDE_NAMES or name.endswith(EXCLUDE_SUFFIXES):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, SKILL_DIR).replace(os.sep, "/")
                files.append((full, "%s/%s" % (SKILL_NAME, rel)))
    return sorted(files, key=lambda x: x[1])


def build(output: str) -> List[str]:
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    names = []
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        for full, arcname in collect():
            info = zipfile.ZipInfo(arcname, date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o100644 << 16)
            with open(full, "rb") as handle:
                zf.writestr(info, handle.read())
            names.append(arcname)
    return names


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Package the /academic-schedule skill as a ZIP.")
    parser.add_argument("--output", default=os.path.join("dist", "academic-schedule-skill.zip"),
                        help="where to write the ZIP (default: dist/academic-schedule-skill.zip in the current folder)")
    parser.add_argument("--skip-format-check", action="store_true",
                        help="package even if references/SCHEDULE_FORMAT.md differs from the website's copy")
    args = parser.parse_args(argv)
    problems = check_frontmatter(read_frontmatter(os.path.join(SKILL_DIR, "SKILL.md")))
    if problems:
        for p in problems:
            print("SKILL.md: %s" % p)
        return 1
    spec = importlib.util.spec_from_file_location("check_format_copy", os.path.join(SKILL_DIR, "check_format_copy.py"))
    check_format_copy = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(check_format_copy)  # type: ignore[union-attr]
    copy_status = check_format_copy.status()
    if copy_status == 1 and not args.skip_format_check:
        print("references/SCHEDULE_FORMAT.md differs from academic-scheduler/SCHEDULE_FORMAT.md; "
              "run check_format_copy.py --fix first.")
        return 1
    if copy_status == 2:
        print("note: academic-scheduler/SCHEDULE_FORMAT.md not found; packaging the bundled copy as is.")
    names = build(args.output)
    print("Wrote %s (%d files):" % (os.path.abspath(args.output), len(names)))
    for name in names:
        print("  " + name)
    print("Upload it in Claude.ai: Settings > Capabilities > Skills > Upload skill.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
