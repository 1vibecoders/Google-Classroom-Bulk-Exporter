#!/usr/bin/env python3
"""ID, slug and estimate helpers for the /academic-schedule skill (SCHEDULE_FORMAT.md sections 8, 14.1, 15.3, 15.8).

Use these instead of deriving IDs by hand, so that every run derives the same
IDs. Remember: derive an ID only when an item is created for the first time;
later runs MATCH the existing item and reuse its ID (section 15.3).

Usage (python3 -I ids.py <command> ...):
  slug TEXT                       slug(TEXT): lowercase ASCII, '-' separated, <= 40 chars
  title-key TEXT                  normalized title for matching (slug without the length limit)
  classroom-id ID                 Classroom id in URL form (decimal -> unpadded base64)
  class-id COURSE_ID              gc-class-<courseId>
  item-id ITEM_ID                 gc-<itemId>
  derived-id ITEM_ID TITLE        gc-<itemId>-<slug(title)> (work announced in a Classroom post)
  document-id CLASS TITLE DATE    <slug(class)>-<slug(title)>-<date|nodate> (items from documents)
  personal-id TITLE DATE          <slug(title)>-<date|nodate> (items without a class)
  class-name-id NAME              cls-<slug(name)>
  event-id TITLE [DATE]           evt-<slug(title)>[-<date>]
  availability-id LABEL START END avail-<slug(label)>-<HHMM>-<HHMM>
  task-id ASSIGNMENT_ID N         <assignmentId>-t<N>
  block-id ASSIGNMENT_OR_TITLE GENERATED_AT N
                                  blk-<assignmentId or slug(title)>-<YYYYMMDDHHMM>-<N>
  issue-id SUBJECT KIND [FIELD [VALUE]]
                                  <itemId>:<kind>:<field>:<value> (a date value loses '-' and ':')
  estimate MIN MAX                point estimate: the midpoint rounded up to a multiple of 5
  free ID TAKEN...                ID, or ID-b, ID-c, ... if ID is in TAKEN

Python 3.8+ standard library only.
"""
from __future__ import annotations

import base64
import math
import re
import sys
import unicodedata
from typing import Iterable, List, Optional

MAX_ID = 100
MAX_ASSIGNMENT_ID = 78
SLUG_MAX = 40
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
DATE_RE = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
DATE_TIME_RE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::[0-9]{2})?)?")


def _ascii(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text))
    return "".join(c for c in decomposed if not unicodedata.combining(c)).encode("ascii", "ignore").decode("ascii")


def title_key(text: str) -> str:
    """Normalized title used for matching (section 15.3): slug without the 40-character limit."""
    s = re.sub(r"[^a-z0-9]+", "-", _ascii(text).lower()).strip("-")
    return s or "item"


def slug(text: str, limit: int = SLUG_MAX) -> str:
    """Section 14.1: remove diacritics, lowercase ASCII, runs of other characters -> '-', trim, <= 40 chars."""
    s = re.sub(r"[^a-z0-9]+", "-", _ascii(text).lower()).strip("-")
    s = s[:limit].rstrip("-")
    return s or "item"


def classroom_id(value: str) -> str:
    """A Classroom course or item id in the form used in Classroom URLs (unpadded base64 of the decimal id)."""
    value = str(value).strip()
    if re.fullmatch(r"[0-9]+", value):
        return base64.b64encode(value.encode("ascii")).decode("ascii").rstrip("=")
    return value


def classroom_decimal(value: str) -> Optional[str]:
    """The decimal form of a Classroom id given in either form, or None."""
    value = str(value).strip()
    if re.fullmatch(r"[0-9]+", value):
        return value
    if re.fullmatch(r"[A-Za-z0-9_-]+", value):
        padded = value.replace("-", "+").replace("_", "/")
        padded += "=" * (-len(padded) % 4)
        try:
            decoded = base64.b64decode(padded).decode("ascii")
        except Exception:  # noqa: BLE001
            return None
        if re.fullmatch(r"[0-9]+", decoded):
            return decoded
    return None


def same_classroom_id(a: str, b: str) -> bool:
    da, db = classroom_decimal(a), classroom_decimal(b)
    return (da or a) == (db or b)


def _fit(prefix: str, parts: List[str], suffix: str, limit: int) -> str:
    """prefix + '-'.join(parts) + suffix, cutting the longest part until it fits in limit."""
    parts = list(parts)
    while True:
        result = prefix + "-".join(p for p in parts if p) + suffix
        if len(result) <= limit:
            return result
        longest = max(range(len(parts)), key=lambda i: len(parts[i]))
        if len(parts[longest]) <= 1:
            return result[:limit].rstrip("-")
        parts[longest] = parts[longest][:-1].rstrip("-")


def class_id(course_id: str) -> str:
    return _fit("gc-class-", [classroom_id(course_id)], "", MAX_ID)


def item_id(classroom_item_id: str) -> str:
    return _fit("gc-", [classroom_id(classroom_item_id)], "", MAX_ASSIGNMENT_ID)


def derived_id(classroom_item_id: str, title: str) -> str:
    return _fit("gc-", [classroom_id(classroom_item_id), slug(title)], "", MAX_ASSIGNMENT_ID)


def _date_part(date: Optional[str]) -> str:
    if not date:
        return "nodate"
    m = DATE_TIME_RE.fullmatch(date)
    return date[:10] if m else "nodate"


def document_id(class_short_name: str, title: str, date: Optional[str]) -> str:
    return _fit("", [slug(class_short_name), slug(title)], "-" + _date_part(date), MAX_ASSIGNMENT_ID)


def personal_id(title: str, date: Optional[str]) -> str:
    return _fit("", [slug(title)], "-" + _date_part(date), MAX_ASSIGNMENT_ID)


def class_name_id(name: str) -> str:
    return "cls-" + slug(name)


def event_id(title: str, date: Optional[str] = None) -> str:
    return "evt-" + slug(title) + ("-" + _date_part(date) if date else "")


def availability_id(label: str, start: str, end: str) -> str:
    return "avail-%s-%s-%s" % (slug(label), start.replace(":", ""), end.replace(":", ""))


def task_id(assignment_id: str, n: int) -> str:
    return "%s-t%d" % (assignment_id, n)


def next_task_number(assignment_id: str, existing_ids: Iterable[str]) -> int:
    """N greater than every number used by a task of the assignment (tombstones included)."""
    pattern = re.compile(re.escape(assignment_id) + r"-t([0-9]+)")
    used = [int(m.group(1)) for m in (pattern.fullmatch(x) for x in existing_ids) if m]
    return max(used, default=0) + 1


def block_id(assignment_or_title: str, generated_at: str, n: int) -> str:
    """generated_at is the run's meta.generatedAt (LocalDateTime); assignment_or_title an assignment ID or a title."""
    m = DATE_TIME_RE.fullmatch(generated_at)
    if not m or m.group(4) is None:
        raise ValueError("generated_at must be a LocalDateTime such as 2026-10-11T19:30:00")
    stamp = "".join(m.group(i) for i in range(1, 6))
    middle = assignment_or_title if ID_RE.fullmatch(assignment_or_title) else slug(assignment_or_title)
    return _fit("blk-", [middle], "-%s-%d" % (stamp, n), MAX_ID)


def issue_value(value: str) -> str:
    """A date or date-time is written without '-' and ':' (20261017, 20261017T2359); anything else as slug(value)."""
    m = DATE_TIME_RE.fullmatch(value.strip())
    if m:
        return "".join(m.group(i) for i in range(1, 4)) + ("T%s%s" % (m.group(4), m.group(5)) if m.group(4) else "")
    return slug(value)


def issue_id(subject: str, kind: str, field: Optional[str] = None, value: Optional[str] = None) -> str:
    """Section 15.8: <itemId>:<kind>[:<field>][:<value>]; a day: <kind>:<date>; the schedule: <kind>:<slug(subject)>."""
    tail = ":" + kind
    if field:
        tail += ":" + field
    if value:
        tail += ":" + issue_value(value)
    if len(subject) + len(tail) > MAX_ID:
        subject = subject[: MAX_ID - len(tail)]
    return subject + tail


def point_estimate(lo: int, hi: int) -> int:
    """Section 8: the midpoint rounded up to a multiple of 5 (60-75 -> 70; 40-60 -> 50)."""
    return int(math.ceil((lo + hi) / 2.0 / 5.0)) * 5


def free_id(candidate: str, taken: Iterable[str], limit: int = MAX_ASSIGNMENT_ID) -> str:
    """The candidate, or candidate-b, -c, ... (cut so that it stays within limit) when it is taken."""
    taken = set(taken)
    if candidate not in taken:
        return candidate
    letters = "bcdefghijklmnopqrstuvwxyz"
    for i in range(10000):
        suffix = "-" + (letters[i] if i < len(letters) else "%s%d" % (letters[i % len(letters)], i // len(letters)))
        base = candidate[: max(1, limit - len(suffix))].rstrip("-")
        result = base + suffix
        if result not in taken:
            return result
    raise ValueError("no free id")


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    cmd, rest = args[0], args[1:]
    try:
        if cmd == "slug":
            out = slug(" ".join(rest))
        elif cmd == "title-key":
            out = title_key(" ".join(rest))
        elif cmd == "classroom-id":
            out = classroom_id(rest[0])
        elif cmd == "class-id":
            out = class_id(rest[0])
        elif cmd == "item-id":
            out = item_id(rest[0])
        elif cmd == "derived-id":
            out = derived_id(rest[0], " ".join(rest[1:]))
        elif cmd == "document-id":
            out = document_id(rest[0], rest[1], rest[2] if len(rest) > 2 else None)
        elif cmd == "personal-id":
            out = personal_id(rest[0], rest[1] if len(rest) > 1 else None)
        elif cmd == "class-name-id":
            out = class_name_id(" ".join(rest))
        elif cmd == "event-id":
            out = event_id(rest[0], rest[1] if len(rest) > 1 else None)
        elif cmd == "availability-id":
            out = availability_id(rest[0], rest[1], rest[2])
        elif cmd == "task-id":
            out = task_id(rest[0], int(rest[1]))
        elif cmd == "block-id":
            out = block_id(rest[0], rest[1], int(rest[2]))
        elif cmd == "issue-id":
            out = issue_id(rest[0], rest[1], rest[2] if len(rest) > 2 else None, rest[3] if len(rest) > 3 else None)
        elif cmd == "estimate":
            out = str(point_estimate(int(rest[0]), int(rest[1])))
        elif cmd == "free":
            out = free_id(rest[0], rest[1:])
        else:
            print("Unknown command %r. Run with --help." % cmd, file=sys.stderr)
            return 2
    except (IndexError, ValueError) as exc:
        print("Error: %s. Run with --help." % (exc or "missing argument"), file=sys.stderr)
        return 2
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
