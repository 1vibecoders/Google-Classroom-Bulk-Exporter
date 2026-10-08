#!/usr/bin/env python3
"""Check that references/SCHEDULE_FORMAT.md is an exact copy of academic-scheduler/SCHEDULE_FORMAT.md.

The skill ships its own copy of the format so that it works on its own (Claude.ai upload, personal
skill folder). The website's copy is the source of truth. Run this after every change to the
format (the tests and package_skill.py run it too):

    python3 skills/academic-schedule/check_format_copy.py          # exit 0 identical, 1 different, 2 source missing
    python3 skills/academic-schedule/check_format_copy.py --fix    # copy the website's file over the skill's
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys

SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.normpath(os.path.join(SKILL_DIR, "..", "..", "academic-scheduler", "SCHEDULE_FORMAT.md"))
COPY = os.path.join(SKILL_DIR, "references", "SCHEDULE_FORMAT.md")


def status() -> int:
    """0 identical, 1 different or copy missing, 2 source missing."""
    if not os.path.isfile(SOURCE):
        return 2
    if not os.path.isfile(COPY):
        return 1
    with open(SOURCE, "rb") as a, open(COPY, "rb") as b:
        return 0 if a.read() == b.read() else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--fix", action="store_true", help="copy the website's SCHEDULE_FORMAT.md into references/")
    args = parser.parse_args(argv)
    result = status()
    if result == 2:
        print("Source not found: %s (run this inside the repository)." % SOURCE)
        return 2
    if result == 0:
        print("references/SCHEDULE_FORMAT.md is identical to %s." % SOURCE)
        return 0
    if args.fix:
        shutil.copyfile(SOURCE, COPY)
        print("Copied %s -> %s." % (SOURCE, COPY))
        return 0
    print("references/SCHEDULE_FORMAT.md differs from %s. Run with --fix to update the copy." % SOURCE)
    return 1


if __name__ == "__main__":
    sys.exit(main())
