#!/usr/bin/env python3
"""Validate schedule files against SCHEDULE_FORMAT.md, version 1.0.

Checks every structural rule ([S]) and every semantic rule ([V]) of
SCHEDULE_FORMAT.md section 13, prints every problem with its location (for
example ``assignments[3].due``) and exits with status 0 when every file is
valid, 1 otherwise. Warnings (section 13.4) never make a file invalid.

The rules, paths and limits are the same as the Academic Scheduler website's
validator (src/lib/validate.ts); both are tested against the shared fixtures
in academic-scheduler/tests/fixtures.

Usage:
    python3 -I validate_schedule.py schedule.json [more.json ...]
        [--json] [--today YYYY-MM-DD] [--generator] [--no-warnings]

  --json         machine-readable output
  --today        the date used for the "more than 5 years away" warning
  --generator    also check the rules for files written by a generator such as
                 the /academic-schedule skill (meta fields, issue IDs, ...);
                 reported as warnings with codes starting with "gen-"
  --no-warnings  print errors only

Python 3.8+ standard library only. The file is only read as data.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import re
import sys
from typing import Any, Callable, Dict, List, Optional, Tuple

SUPPORTED_MAJOR = 1
SUPPORTED_MINOR = 0
SUPPORTED = "%d.%d" % (SUPPORTED_MAJOR, SUPPORTED_MINOR)
MAX_FILE_BYTES = 10 * 1024 * 1024  # the website's import limit
MAX_EXTENSION_DEPTH = 200  # the website cannot store deeper x- values

# Every pattern is used with re.fullmatch (SCHEDULE_FORMAT.md section 3):
# Python's "$" would also match before a trailing newline.
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
DATE_RE = re.compile(r"([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])")
TIME_RE = re.compile(r"([01][0-9]|2[0-3]):[0-5][0-9]")
END_TIME_RE = re.compile(r"(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)")
LDT_RE = re.compile(
    r"([0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01]))T((?:[01][0-9]|2[0-3]):[0-5][0-9])(?::00)?"
)
COLOR_RE = re.compile(r"#[0-9A-Fa-f]{6}")
# JavaScript's whitespace (String.prototype.trim and \s), so that Text is
# trimmed and URLs are checked exactly as the website does it.
JS_WHITESPACE = (
    "\t\n\x0b\x0c\r   "
    + "".join(chr(c) for c in range(0x2000, 0x200B))
    + "    　﻿"
)
URL_RE = re.compile(r"[Hh][Tt][Tt][Pp][Ss]?://[^" + re.escape(JS_WHITESPACE) + r"]+")
SIMPLE_KEY_RE = re.compile(r"[A-Za-z_$][A-Za-z0-9_$-]*")
TZ_NAME_RE = re.compile(r"[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*")

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
ASSIGNMENT_TYPES = [
    "homework", "reading", "writing", "problem_set", "lab", "project", "presentation",
    "quiz", "test", "exam", "study", "other",
]
ASSESSMENT_TYPES = ["quiz", "test", "exam", "presentation"]
WORK_STATUSES = ["not_started", "in_progress", "done", "cancelled"]
BLOCK_STATUSES = ["planned", "done", "skipped"]
PRIORITIES = ["low", "medium", "high", "urgent"]
CONFIDENCES = ["low", "medium", "high"]
EVENT_CATEGORIES = ["school", "class", "activity", "appointment", "work", "personal", "other"]
ISSUE_KINDS = ["ambiguity", "conflict", "missing_information", "workload", "other"]
ISSUE_STATUSES = ["open", "resolved", "dismissed"]
SOURCE_KINDS = ["google_classroom", "syllabus", "calendar", "document", "image", "user", "schedule", "other"]
REFERENCE_KINDS = ["attachment", "link", "reading", "rubric", "template", "other"]
COLLECTIONS = ["classes", "assignments", "tasks", "events", "availability", "scheduleBlocks"]
NEVER_OVERRIDABLE = ["id", "origin", "locked", "overrides", "issues", "source", "sources", "notes", "status", "completedAt"]

DEFAULT_SETTINGS = {
    "weekStartsOn": "monday",
    "dayStartTime": "07:00",
    "dayEndTime": "22:00",
    "defaultDueTime": "00:00",
    "minSessionMinutes": 20,
    "maxSessionMinutes": 60,
    "breakMinutes": 10,
    "maxDailyStudyMinutes": None,
}

OVERRIDABLE_FIELDS = {
    "class": ["name", "teacher", "section", "room", "color", "description", "archived", "topics", "references"],
    "assignment": [
        "title", "classId", "type", "topic", "description", "due", "assessmentDate", "recommendedCompletionDate",
        "estimatedMinutes", "estimateRange", "estimateConfidence", "estimateBasis", "priority", "points", "required",
        "sourceState", "tasks", "references", "dependsOn",
    ],
    "task": [
        "title", "description", "due", "required", "estimatedMinutes", "estimateRange", "dependsOn",
        "recommendedStartDate", "recommendedCompletionDate",
    ],
    "event": [
        "title", "category", "classId", "assignmentId", "date", "endDate", "recurrence", "allDay", "startTime",
        "endTime", "busy", "location",
    ],
    "availability": ["label", "date", "recurrence", "startTime", "endTime"],
    "block": ["start", "end", "assignmentId", "taskId", "title", "kind", "description"],
}


# ---------------------------------------------------------------------------
# Calendar arithmetic on strings (proleptic Gregorian, independent of zones)
# ---------------------------------------------------------------------------

def is_leap(year: int) -> bool:
    if 0 <= year <= 99:
        year += 1900  # as the website (JavaScript Date.UTC) reads years 0-99; only year 0 differs
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year: int, month: int) -> int:
    if month == 2:
        return 29 if is_leap(year) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def is_valid_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    m = DATE_RE.fullmatch(value)
    if not m:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return 1 <= d <= days_in_month(y, mo)


def day_number(date: str) -> int:
    """Days since 1970-01-01 of a YYYY-MM-DD string."""
    y, m, d = int(date[0:4]), int(date[5:7]), int(date[8:10])
    y -= m <= 2
    era = (y if y >= 0 else y - 399) // 400
    yoe = y - era * 400
    doy = (153 * (m + (-3 if m > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146097 + doe - 719468


def date_from_day_number(n: int) -> str:
    z = n + 719468
    era = (z if z >= 0 else z - 146096) // 146097
    doe = z - era * 146097
    yoe = (doe - doe // 1460 + doe // 36524 - doe // 146096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + (3 if mp < 10 else -9)
    y += m <= 2
    return "%04d-%02d-%02d" % (y, m, d)


def add_days(date: str, days: int) -> str:
    return date_from_day_number(day_number(date) + days)


def weekday_of(date: str) -> str:
    """'mon' ... 'sun'. 1970-01-01 was a Thursday."""
    return WEEKDAYS[(day_number(date) + 3) % 7]


def monday_of(date: str) -> str:
    return add_days(date, -((day_number(date) + 3) % 7))


def time_to_minutes(time: str) -> int:
    """'HH:MM' -> minutes since midnight ('24:00' -> 1440)."""
    return int(time[0:2]) * 60 + int(time[3:5])


def is_date_only(value: str) -> bool:
    return DATE_RE.fullmatch(value) is not None


def date_of(value: str) -> str:
    return value[0:10]


def ldt_to_minutes(value: str) -> int:
    """Minutes since 1970-01-01T00:00 of a LocalDateTime (seconds ignored)."""
    return day_number(value[0:10]) * 1440 + time_to_minutes(value[11:16])


def due_moment(due: str, default_due_time: str = "00:00") -> str:
    """A due value as a moment: a Date means default_due_time that day (section 8)."""
    return "%sT%s:00" % (due, default_due_time) if is_date_only(due) else due


def start_of_day_moment(value: str) -> str:
    return "%sT00:00:00" % value if is_date_only(value) else value


def compare_date_values(a: str, b: str) -> int:
    """Rules 21-22: compare dates only when either value has no time."""
    if is_date_only(a) or is_date_only(b):
        da, db = date_of(a), date_of(b)
        return -1 if da < db else (1 if da > db else 0)
    return ldt_to_minutes(a) - ldt_to_minutes(b)


def format_duration(minutes: int) -> str:
    total = max(0, int(round(minutes)))
    h, m = divmod(total, 60)
    if h == 0:
        return "%d m" % m
    if m == 0:
        return "%d h" % h
    return "%d h %d m" % (h, m)


def hhmm(minutes: int) -> str:
    return "%02d:%02d" % divmod(minutes, 60)


def resolve_settings(settings: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = dict(DEFAULT_SETTINGS)
    for key in DEFAULT_SETTINGS:
        if isinstance(settings, dict) and settings.get(key) is not None:
            out[key] = settings[key]
    return out


def occurs_on(rule: Dict[str, Any], date: str) -> bool:
    """Section 10, conditions 1-4."""
    start = rule.get("startDate")
    if not isinstance(start, str) or date < start:
        return False
    end = rule.get("endDate")
    if isinstance(end, str) and date > end:
        return False
    days = rule.get("daysOfWeek") or []
    if weekday_of(date) not in days:
        return False
    if date in (rule.get("exceptDates") or []):
        return False
    interval = rule.get("interval")
    interval = interval if isinstance(interval, int) and not isinstance(interval, bool) and interval > 0 else 1
    weeks = (day_number(monday_of(date)) - day_number(monday_of(start))) // 7
    return weeks % interval == 0


def never_occurs(rule: Dict[str, Any]) -> bool:
    start, end = rule.get("startDate"), rule.get("endDate")
    if not isinstance(start, str) or not isinstance(end, str) or end < start:
        return False
    interval = rule.get("interval")
    interval = interval if isinstance(interval, int) and not isinstance(interval, bool) and interval > 0 else 1
    offsets = sorted({WEEKDAYS.index(d) for d in (rule.get("daysOfWeek") or []) if d in WEEKDAYS})
    if not offsets:
        return False
    except_dates = set(x for x in (rule.get("exceptDates") or []) if isinstance(x, str))
    first, last = day_number(start), day_number(end)
    week = day_number(monday_of(start))
    while week <= last:
        for offset in offsets:
            n = week + offset
            if first <= n <= last and date_from_day_number(n) not in except_dates:
                return False
        week += 7 * interval
    return True


def event_occurs_on(event: Dict[str, Any], date: str) -> bool:
    rule = event.get("recurrence")
    if isinstance(rule, dict):
        return occurs_on(rule, date)
    start = event.get("date")
    if not isinstance(start, str):
        return False
    end = (event.get("endDate") or start) if event.get("allDay") is True else start
    return start <= date <= end


# ---------------------------------------------------------------------------
# Structure descriptions
# ---------------------------------------------------------------------------

class Spec:
    """One object type of the format; `fields` is in canonical order."""

    def __init__(self, name: str, fields: List[Tuple[str, dict]], required: List[str],
                 misplaced: Optional[Dict[str, str]] = None, check: Optional[Callable] = None,
                 item: bool = False):
        self.name = name
        self.fields = dict(fields)
        self.required = required
        self.misplaced = misplaced or {}
        self.check = check
        self.item = item


def _k(kind: str, **kw: Any) -> dict:
    d = {"k": kind}
    d.update(kw)
    return d


ID = _k("id")
DATE = _k("date")
TIME = _k("time")
END_TIME = _k("endTime")
LDT = _k("ldt")
DODT = _k("dodt")
COLOR = _k("color")
URL = _k("url")
BOOL = _k("bool")
MINUTES = _k("int", min=0, max=10000)


def INT(lo: int, hi: int) -> dict:
    return _k("int", min=lo, max=hi)


def TEXT(max_len: int, required: bool = False) -> dict:
    return _k("text", max=max_len, required=required)


def ENUM(values: List[str], hints: Optional[Dict[str, str]] = None) -> dict:
    return _k("enum", values=values, hints=hints or {})


def ARRAY(of: dict, min_items: Optional[int] = None, max_items: Optional[int] = None, unique: bool = False) -> dict:
    return _k("array", of=of, min=min_items, max=max_items, unique=unique)


def OBJECT(spec: Spec) -> dict:
    return _k("object", spec=spec)


STATUS_HINTS = {
    "complete": 'Use "done".', "completed": 'Use "done".', "finished": 'Use "done".',
    "todo": 'Use "not_started".', "not started": 'Use "not_started".', "in progress": 'Use "in_progress".',
    "canceled": 'Use "cancelled".',
}
PLANNER_HINT = {"planner": '"planner" is only allowed on schedule blocks (section 6.1).'}


def _weekday_hints() -> Dict[str, str]:
    full = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    hints = {}
    for i, name in enumerate(full):
        code = WEEKDAYS[i]
        hint = 'Use "%s".' % code
        for variant in (name, name.capitalize(), code.upper(), code.capitalize()):
            hints[variant] = hint
    return hints


# Conditional structure (section 13.1 rules 5-8), run on the raw object.

def _check_date_or_recurrence(raw: dict, path: str, ctx: "Ctx", what: str) -> None:
    has_date, has_rec = "date" in raw, "recurrence" in raw
    if has_date and has_rec:
        ctx.err(child_path(path, "recurrence"), "date-xor-recurrence",
                '%s has either "date" (one day) or "recurrence" (repeating), not both.' % what)
    elif not has_date and not has_rec:
        ctx.err(path, "date-xor-recurrence", '%s needs either "date" (one day) or "recurrence" (repeating).' % what)


def _check_event_shape(raw: dict, path: str, ctx: "Ctx") -> None:
    _check_date_or_recurrence(raw, path, ctx, "An event")
    if raw.get("allDay") is True:
        for key in ("startTime", "endTime"):
            if key in raw:
                ctx.err(child_path(path, key), "all-day-times",
                        'An all-day event has no %s (remove it, or set "allDay" to false).' % key)
        if "endDate" in raw and "date" not in raw:
            ctx.err(child_path(path, "endDate"), "end-date-without-date",
                    '"endDate" requires "date" (a one-time event); a recurrence has its own endDate.')
    else:
        for key in ("startTime", "endTime"):
            if key not in raw:
                ctx.err(child_path(path, key), "required",
                        'Missing "%s": an event that is not all-day needs startTime and endTime.' % key)
        if "endDate" in raw:
            ctx.err(child_path(path, "endDate"), "end-date-not-all-day",
                    '"endDate" is only allowed on a multi-day all-day event ("allDay": true with "date").')


def _check_completed_at(raw: dict, path: str, ctx: "Ctx") -> None:
    if "completedAt" in raw and raw.get("status") != "done":
        ctx.err(child_path(path, "completedAt"), "completed-at-status",
                '"completedAt" is only allowed when "status" is "done".')


def point_estimate(lo: int, hi: int) -> int:
    """The midpoint rounded up to a multiple of 5 (section 8): 60-75 -> 70."""
    return int(math.ceil((lo + hi) / 2.0 / 5.0)) * 5


def _check_work_shape(raw: dict, path: str, ctx: "Ctx") -> None:
    _check_completed_at(raw, path, ctx)
    if "estimateRange" in raw and "estimatedMinutes" not in raw:
        rng = raw.get("estimateRange")
        suggestion = ""
        if isinstance(rng, dict) and _is_int(rng.get("min")) and _is_int(rng.get("max")):
            suggestion = " For %d-%d the point estimate is %d." % (
                rng["min"], rng["max"], point_estimate(int(rng["min"]), int(rng["max"])))
        ctx.err(child_path(path, "estimatedMinutes"), "estimate-range-needs-estimate",
                '"estimateRange" requires "estimatedMinutes" (the point estimate: the midpoint rounded up to a '
                "multiple of 5)." + suggestion)


def _check_block_shape(raw: dict, path: str, ctx: "Ctx") -> None:
    has_assignment = "assignmentId" in raw
    if not has_assignment and "title" not in raw:
        ctx.err(path, "block-needs-assignment-or-title", 'A schedule block needs an "assignmentId" or a "title".')
    if "taskId" in raw and not has_assignment:
        ctx.err(child_path(path, "taskId"), "task-without-assignment",
                '"taskId" requires "assignmentId" (the assignment the task belongs to).')
    if raw.get("kind") == "break":
        if has_assignment:
            ctx.err(child_path(path, "assignmentId"), "break-with-assignment", 'A break block has no "assignmentId".')
        if "title" not in raw:
            ctx.err(child_path(path, "title"), "required", 'A break block needs a "title", e.g. "Break".')
    _check_completed_at(raw, path, ctx)


SOURCE_SPEC = Spec("a source", [
    ("kind", ENUM(SOURCE_KINDS)),
    ("id", TEXT(200)),
    ("url", URL),
    ("path", TEXT(500)),
    ("label", TEXT(200)),
    ("retrievedAt", LDT),
], ["kind"])
SOURCE = OBJECT(SOURCE_SPEC)

ISSUE_FIELDS = [
    ("id", ID),
    ("kind", ENUM(ISSUE_KINDS)),
    ("message", TEXT(1000, True)),
    ("field", TEXT(100)),
    ("status", ENUM(ISSUE_STATUSES)),
    ("date", DATE),
]
ITEM_ISSUE_SPEC = Spec("an issue", ISSUE_FIELDS, ["kind", "message"], misplaced={
    "itemId": '"itemId" is only allowed on root issues (the top-level "issues" array), never in an item\'s '
              "issues (section 13.1 rule 10).",
})
ROOT_ISSUE_SPEC = Spec("an issue", ISSUE_FIELDS + [("itemId", ID)], ["kind", "message"])
ESTIMATE_RANGE_SPEC = Spec("an estimate range", [("min", MINUTES), ("max", MINUTES)], ["min", "max"])
RECURRENCE_SPEC = Spec("a recurrence", [
    ("frequency", ENUM(["weekly"], {"daily": 'Only "weekly" exists in 1.0: use "weekly" with all seven days for "daily".'})),
    ("daysOfWeek", ARRAY(ENUM(WEEKDAYS, _weekday_hints()), 1, 7, True)),
    ("interval", INT(1, 52)),
    ("startDate", DATE),
    ("endDate", DATE),
    ("exceptDates", ARRAY(DATE)),
], ["frequency", "daysOfWeek", "startDate"])
REFERENCE_SPEC = Spec("a reference", [
    ("title", TEXT(300, True)),
    ("url", URL),
    ("path", TEXT(500)),
    ("kind", ENUM(REFERENCE_KINDS)),
    ("required", BOOL),
], ["title"])
REQUESTED_CHANGE_SPEC = Spec("a requested change", [
    ("id", ID),
    ("reason", TEXT(500, True)),
    ("requestedByPerson", BOOL),
], ["id", "reason", "requestedByPerson"])
TOMBSTONE_SPEC = Spec("a deleted-item entry", [
    ("id", ID),
    ("collection", ENUM(COLLECTIONS)),
    ("deletedAt", LDT),
    ("sourceId", TEXT(200)),
    ("title", TEXT(300)),
], ["id", "collection", "deletedAt"])
GENERATOR_SPEC = Spec("a generator", [("name", TEXT(100, True)), ("version", TEXT(50))], ["name"])
META_SPEC = Spec("meta", [
    ("title", TEXT(200)),
    ("generatedAt", LDT),
    ("generator", OBJECT(GENERATOR_SPEC)),
    ("timezone", TEXT(100)),
    ("exportId", ID),
    ("basedOn", ID),
    ("sources", ARRAY(SOURCE)),
    ("requestedChanges", ARRAY(OBJECT(REQUESTED_CHANGE_SPEC))),
], [])
SETTINGS_SPEC = Spec("settings", [
    ("weekStartsOn", ENUM(["monday", "sunday"])),
    ("dayStartTime", TIME),
    ("dayEndTime", END_TIME),
    ("defaultDueTime", TIME),
    ("minSessionMinutes", INT(5, 240)),
    ("maxSessionMinutes", INT(10, 480)),
    ("breakMinutes", INT(0, 120)),
    ("maxDailyStudyMinutes", INT(0, 1440)),
], [])


def _item_spec(name: str, item_type: str, fields: List[Tuple[str, dict]], required: List[str], with_source: bool,
               planner: bool = False, check: Optional[Callable] = None,
               misplaced: Optional[Dict[str, str]] = None) -> Spec:
    head = [
        ("id", ID),
        ("origin", ENUM(["user", "generated", "planner"]) if planner else ENUM(["user", "generated"], PLANNER_HINT)),
        ("locked", BOOL),
        ("overrides", _k("overrides", itemType=name, allowed=OVERRIDABLE_FIELDS[item_type])),
    ]
    if with_source:
        tail = [("source", SOURCE), ("sources", ARRAY(SOURCE, None, 20)), ("issues", ARRAY(OBJECT(ITEM_ISSUE_SPEC)))]
    else:
        tail = [("issues", ARRAY(OBJECT(ITEM_ISSUE_SPEC)))]
    return Spec(name, head + fields + tail, ["id"] + required, misplaced=misplaced, check=check, item=True)


WORK_STATUS = ENUM(WORK_STATUSES, STATUS_HINTS)

CLASS_SPEC = _item_spec("a class", "class", [
    ("name", TEXT(200, True)),
    ("teacher", TEXT(200)),
    ("section", TEXT(200)),
    ("room", TEXT(100)),
    ("color", COLOR),
    ("description", TEXT(5000)),
    ("archived", BOOL),
    ("topics", ARRAY(TEXT(200), None, 200)),
    ("references", ARRAY(OBJECT(REFERENCE_SPEC), None, 200)),
], ["name"], with_source=True)

TASK_SPEC = _item_spec("a task", "task", [
    ("title", TEXT(200, True)),
    ("description", TEXT(5000)),
    ("notes", TEXT(10000)),
    ("estimatedMinutes", MINUTES),
    ("estimateRange", OBJECT(ESTIMATE_RANGE_SPEC)),
    ("status", WORK_STATUS),
    ("completedAt", LDT),
    ("dependsOn", ARRAY(ID, unique=True)),
    ("recommendedStartDate", DATE),
    ("recommendedCompletionDate", DODT),
    ("due", DODT),
    ("required", BOOL),
], ["title"], with_source=False, check=_check_work_shape, misplaced={
    "source": 'Tasks have no "source"; they inherit their assignment\'s (section 6).',
    "sources": 'Tasks have no "sources"; they inherit their assignment\'s (section 6).',
})

ASSIGNMENT_SPEC = _item_spec("an assignment", "assignment", [
    ("title", TEXT(200, True)),
    ("classId", ID),
    ("type", ENUM(ASSIGNMENT_TYPES)),
    ("topic", TEXT(200)),
    ("description", TEXT(20000)),
    ("notes", TEXT(10000)),
    ("due", DODT),
    ("assessmentDate", DODT),
    ("recommendedCompletionDate", DODT),
    ("estimatedMinutes", MINUTES),
    ("estimateRange", OBJECT(ESTIMATE_RANGE_SPEC)),
    ("estimateConfidence", ENUM(CONFIDENCES)),
    ("estimateBasis", TEXT(2000)),
    ("priority", ENUM(PRIORITIES, {"normal": 'Use "medium".'})),
    ("status", WORK_STATUS),
    ("completedAt", LDT),
    ("points", TEXT(100)),
    ("required", BOOL),
    ("sourceState", ENUM(["present", "missing", "withdrawn"])),
    ("tasks", ARRAY(OBJECT(TASK_SPEC))),
    ("references", ARRAY(OBJECT(REFERENCE_SPEC))),
    ("dependsOn", ARRAY(ID, unique=True)),
], ["title"], with_source=True, check=_check_work_shape)

EVENT_SPEC = _item_spec("an event", "event", [
    ("title", TEXT(200, True)),
    ("category", ENUM(EVENT_CATEGORIES)),
    ("classId", ID),
    ("assignmentId", ID),
    ("date", DATE),
    ("endDate", DATE),
    ("recurrence", OBJECT(RECURRENCE_SPEC)),
    ("allDay", BOOL),
    ("startTime", TIME),
    ("endTime", END_TIME),
    ("busy", BOOL),
    ("location", TEXT(200)),
    ("notes", TEXT(10000)),
], ["title"], with_source=True, check=_check_event_shape)

AVAILABILITY_SPEC = _item_spec("a study-time window", "availability", [
    ("label", TEXT(200)),
    ("date", DATE),
    ("recurrence", OBJECT(RECURRENCE_SPEC)),
    ("startTime", TIME),
    ("endTime", END_TIME),
], ["startTime", "endTime"], with_source=True,
    check=lambda raw, path, ctx: _check_date_or_recurrence(raw, path, ctx, "A study-time window"))

BLOCK_SPEC = _item_spec("a schedule block", "block", [
    ("start", LDT),
    ("end", LDT),
    ("assignmentId", ID),
    ("taskId", ID),
    ("title", TEXT(200, True)),
    ("kind", ENUM(["work", "break"])),
    ("status", ENUM(BLOCK_STATUSES, {"complete": 'Use "done".', "completed": 'Use "done".'})),
    ("completedAt", LDT),
    ("description", TEXT(5000)),
    ("notes", TEXT(10000)),
], ["start", "end"], with_source=True, planner=True, check=_check_block_shape)

ROOT_SPEC = Spec("the schedule", [
    ("schemaVersion", ENUM([SUPPORTED])),
    ("meta", OBJECT(META_SPEC)),
    ("settings", OBJECT(SETTINGS_SPEC)),
    ("classes", ARRAY(OBJECT(CLASS_SPEC))),
    ("assignments", ARRAY(OBJECT(ASSIGNMENT_SPEC))),
    ("events", ARRAY(OBJECT(EVENT_SPEC))),
    ("availability", ARRAY(OBJECT(AVAILABILITY_SPEC))),
    ("scheduleBlocks", ARRAY(OBJECT(BLOCK_SPEC))),
    ("issues", ARRAY(OBJECT(ROOT_ISSUE_SPEC))),
    ("deleted", ARRAY(OBJECT(TOMBSTONE_SPEC), None, 5000)),
], ["schemaVersion", "classes", "assignments", "events", "availability", "scheduleBlocks"])

FORMAT_SPECS = {
    "root": ROOT_SPEC, "meta": META_SPEC, "settings": SETTINGS_SPEC, "class": CLASS_SPEC,
    "assignment": ASSIGNMENT_SPEC, "task": TASK_SPEC, "event": EVENT_SPEC, "availability": AVAILABILITY_SPEC,
    "block": BLOCK_SPEC, "issue": ITEM_ISSUE_SPEC, "rootIssue": ROOT_ISSUE_SPEC, "source": SOURCE_SPEC,
    "reference": REFERENCE_SPEC, "recurrence": RECURRENCE_SPEC, "estimateRange": ESTIMATE_RANGE_SPEC,
    "tombstone": TOMBSTONE_SPEC, "requestedChange": REQUESTED_CHANGE_SPEC, "generator": GENERATOR_SPEC,
}


# ---------------------------------------------------------------------------
# Structural walker
# ---------------------------------------------------------------------------

class Ctx:
    def __init__(self) -> None:
        self.errors: List[Dict[str, str]] = []
        self.warnings: List[Dict[str, str]] = []
        self.dates: List[Tuple[str, str]] = []  # (path, date) of every valid date-like value

    def err(self, path: str, code: str, message: str) -> None:
        self.errors.append({"path": path, "code": code, "message": message})

    def warn(self, path: str, code: str, message: str) -> None:
        self.warnings.append({"path": path, "code": code, "message": message})


INVALID = object()


def child_path(path: str, key: str) -> str:
    """The website's path syntax: a.b[0].c, or a["odd key"] for keys that are not identifiers."""
    if SIMPLE_KEY_RE.fullmatch(key):
        return "%s.%s" % (path, key) if path else key
    return "%s[%s]" % (path, json.dumps(key, ensure_ascii=False))


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def js_trim(value: str) -> str:
    return value.strip(JS_WHITESPACE)


def _js_number(value: Any) -> str:
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    return repr(value) if isinstance(value, float) else str(value)


def show(value: Any) -> str:
    if isinstance(value, str):
        s = value if len(value) <= 60 else value[:57] + "…"
        return json.dumps(s, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _js_number(value)
    if value is None:
        return "null"
    return "an array" if isinstance(value, list) else "an object"


def describe(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, list):
        return "an array"
    if isinstance(value, bool):
        return "%s (a boolean)" % show(value)
    if isinstance(value, str):
        return "a string (%s)" % show(value)
    if isinstance(value, (int, float)):
        return "a number (%s)" % show(value)
    return "an object"


def _type_error(ctx: Ctx, path: str, expected: str, value: Any, hint: str = "") -> object:
    ctx.err(path, "type", "Expected %s, found %s.%s" % (expected, describe(value), (" " + hint) if hint else ""))
    return INVALID


ALIASES = {
    "dueDate": "due", "dueAt": "due", "deadline": "due", "dueTime": "due", "subtasks": "tasks", "steps": "tasks",
    "estimate": "estimatedMinutes", "minutes": "estimatedMinutes", "duration": "estimatedMinutes",
    "estimatedTime": "estimatedMinutes", "class": "classId", "course": "classId", "courseId": "classId",
    "assignment": "assignmentId", "task": "taskId", "blocks": "scheduleBlocks", "sessions": "scheduleBlocks",
    "version": "schemaVersion", "days": "daysOfWeek", "weekdays": "daysOfWeek", "repeat": "recurrence",
    "note": "notes", "name": "title", "title": "name", "start": "startTime", "end": "endTime",
    "startTime": "start", "endTime": "end", "done": "status", "completed": "status", "exceptions": "exceptDates",
}


def _squash(name: str) -> str:
    return re.sub(r"[_\-\s]", "", name.lower())


def _unknown_property_message(key: str, spec: Spec) -> str:
    suggestion = None
    for field in spec.fields:
        if _squash(field) == _squash(key):
            suggestion = field
            break
    if suggestion is None and ALIASES.get(key) in spec.fields:
        suggestion = ALIASES[key]
    base = ('Unknown property %s in %s. Only the fields defined in SCHEDULE_FORMAT.md and "x-..." extension '
            "properties are allowed." % (json.dumps(key, ensure_ascii=False), spec.name))
    return base + (' Did you mean "%s"?' % suggestion if suggestion else "")


def _too_deep(value: Any) -> bool:
    """True if a JSON value is nested more than MAX_EXTENSION_DEPTH levels (iterative)."""
    stack = [(value, 0)]
    while stack:
        v, depth = stack.pop()
        if isinstance(v, (dict, list)):
            if depth > MAX_EXTENSION_DEPTH:
                return True
            children = v.values() if isinstance(v, dict) else v
            stack.extend((c, depth + 1) for c in children)
    return False


def walk_object(raw: Any, spec: Spec, path: str, ctx: Ctx, skip: Optional[str] = None) -> Any:
    if not isinstance(raw, dict):
        return _type_error(ctx, path, "%s (a JSON object)" % spec.name, raw)
    out: Dict[str, Any] = {}
    for key, value in raw.items():
        if key == skip:
            continue
        p = child_path(path, key)
        if key.startswith("x-"):
            if _too_deep(value):
                ctx.err(p, "too-deep", 'This "x-..." value is nested more than %d levels deep; the website cannot '
                                       "store it." % MAX_EXTENSION_DEPTH)
            else:
                out[key] = copy.deepcopy(value)
            continue
        kind = spec.fields.get(key)
        if kind is not None:
            result = walk(value, kind, p, ctx)
            if result is not INVALID:
                out[key] = result
            continue
        if key in spec.misplaced:
            ctx.err(p, "misplaced-property", spec.misplaced[key])
        else:
            ctx.err(p, "unknown-property", _unknown_property_message(key, spec))
    for key in spec.required:
        if key != skip and key not in raw:
            ctx.err(child_path(path, key), "required", 'Missing required field "%s" in %s.' % (key, spec.name))
    if spec.check:
        spec.check(raw, path, ctx)
    return out


def walk(value: Any, kind: dict, path: str, ctx: Ctx) -> Any:
    if value is None:
        ctx.err(path, "null", "null is not allowed. Omit an optional field instead of setting it to null.")
        return INVALID
    k = kind["k"]
    if k == "id":
        if not isinstance(value, str):
            return _type_error(ctx, path, "an ID (a string)", value)
        if not ID_RE.fullmatch(value):
            ctx.err(path, "id-format",
                    '%s is not a valid ID. An ID has 1-100 characters: a letter or digit, then letters, digits, ".", '
                    '"_", ":" or "-" (no spaces or "/"). References use IDs, never names.' % show(value))
        return value  # kept even when malformed so that references to it still resolve
    if k == "date":
        return _walk_date(value, path, ctx)
    if k == "ldt":
        return _walk_ldt(value, path, ctx, False)
    if k == "dodt":
        if isinstance(value, str) and DATE_RE.fullmatch(value):
            return _walk_date(value, path, ctx)
        return _walk_ldt(value, path, ctx, True)
    if k in ("time", "endTime"):
        if not isinstance(value, str):
            return _type_error(ctx, path, 'a time string "HH:MM"', value)
        pattern = TIME_RE if k == "time" else END_TIME_RE
        if not pattern.fullmatch(value):
            if k == "time":
                hint = 'Use the 24-hour clock "HH:MM" from "00:00" to "23:59".'
            else:
                hint = 'Use the 24-hour clock "HH:MM" ("00:00"-"23:59"), or "24:00" for midnight at the end of the day.'
            if k == "time" and value == "24:00":
                hint = ('"24:00" is only allowed as an end time (event or study-time "endTime", settings '
                        '"dayEndTime").')
            elif re.fullmatch(r"[0-9]{1,2}(:[0-9]{2})?\s*[AaPp]\.?[Mm]\.?", value):
                hint = 'Use the 24-hour clock without AM/PM, e.g. "16:00" instead of "4:00 PM".'
            elif re.fullmatch(r"[0-9]:[0-9]{2}", value):
                hint = 'Hours have two digits, e.g. "0%s".' % value
            elif re.fullmatch(r"[0-9]{2}:[0-9]{2}:[0-9]{2}", value):
                hint = 'Times have no seconds: use "HH:MM".'
            ctx.err(path, "time-format", "%s is not a valid time. %s" % (show(value), hint))
            return INVALID
        return value
    if k == "color":
        if not isinstance(value, str):
            return _type_error(ctx, path, 'a color string "#RRGGBB"', value)
        if not COLOR_RE.fullmatch(value):
            ctx.err(path, "color-format",
                    '%s is not a valid color. Use "#RRGGBB" with six hexadecimal digits, e.g. "#2563EB".' % show(value))
            return INVALID
        return value
    if k == "url":
        if not isinstance(value, str):
            return _type_error(ctx, path, "a URL string", value)
        if len(value) > 2000:
            ctx.err(path, "text-length", "This URL is too long: %d characters (at most 2000)." % len(value))
            return INVALID
        if not URL_RE.fullmatch(value):
            ctx.err(path, "url-format",
                    "%s is not allowed: only absolute http:// or https:// URLs (without spaces) can be used." % show(value))
            return INVALID
        return value
    if k == "int":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            hint = ("Write numbers without quotes."
                    if isinstance(value, str) and re.fullmatch(r"\s*-?[0-9]+(\.[0-9]+)?\s*", value) else "")
            return _type_error(ctx, path, "a whole number", value, hint)
        if isinstance(value, float) and (not math.isfinite(value) or not value.is_integer()):
            ctx.err(path, "integer", "%s is not a whole number. Use whole minutes (or a whole number), e.g. 45." % show(value))
            return INVALID
        number = int(value)
        if number < kind["min"] or number > kind["max"]:
            ctx.err(path, "range", "%d is out of range: use a whole number from %d to %d." % (number, kind["min"], kind["max"]))
            return INVALID
        return number
    if k == "bool":
        if not isinstance(value, bool):
            hint = "Write true or false without quotes." if value in ("true", "false") else ""
            return _type_error(ctx, path, "true or false", value, hint)
        return value
    if k == "enum":
        values = kind["values"]
        if not isinstance(value, str):
            return _type_error(ctx, path, "one of %s" % ", ".join('"%s"' % v for v in values), value)
        if value not in values:
            hint = kind["hints"].get(value)
            ctx.err(path, "enum", "%s is not allowed here. %sAllowed values: %s." % (
                show(value), (hint + " ") if hint else "", ", ".join('"%s"' % v for v in values)))
            return INVALID
        return value
    if k == "text":
        if not isinstance(value, str):
            return _type_error(ctx, path, "text (a string)", value)
        if len(value) > kind["max"]:  # code points
            ctx.err(path, "text-length", "Too long: %d characters (at most %d)." % (len(value), kind["max"]))
            return INVALID
        trimmed = js_trim(value)
        if kind["required"]:
            if len(value) == 0:
                ctx.err(path, "text-empty", "Must not be empty.")
                return INVALID
            if not trimmed:
                ctx.err(path, "text-blank", "Must contain at least one character that is not a space.")
                return INVALID
        return trimmed
    if k == "array":
        if not isinstance(value, list):
            return _type_error(ctx, path, "an array ([ ... ])", value)
        if kind["min"] is not None and len(value) < kind["min"]:
            ctx.err(path, "array-size", "Needs at least %d %s." % (kind["min"], "entry" if kind["min"] == 1 else "entries"))
        if kind["max"] is not None and len(value) > kind["max"]:
            ctx.err(path, "array-size", "Too many entries: %d (at most %d)." % (len(value), kind["max"]))
        out = []
        seen: Dict[str, int] = {}
        for i, item in enumerate(value):
            p = "%s[%d]" % (path, i)
            if kind["unique"] and isinstance(item, str):
                if item in seen:
                    ctx.err(p, "unique", "Duplicate entry %s (already at position %d)." % (show(item), seen[item]))
                else:
                    seen[item] = i
            result = walk(item, kind["of"], p, ctx)
            out.append(None if result is INVALID else result)
        return out
    if k == "object":
        return walk_object(value, kind["spec"], path, ctx)
    if k == "overrides":
        if not isinstance(value, list):
            return _type_error(ctx, path, "an array of field names", value)
        names = set()
        out = []
        for i, name in enumerate(value):
            p = "%s[%d]" % (path, i)
            if name is None:
                ctx.err(p, "null", "null is not allowed.")
                continue
            if not isinstance(name, str):
                _type_error(ctx, p, "a field name (a string)", name)
                continue
            if name in names:
                ctx.err(p, "unique", "Duplicate entry %s: each field is listed once." % show(name))
            names.add(name)
            if name not in kind["allowed"] and not name.startswith("x-"):
                if name in NEVER_OVERRIDABLE:
                    message = ('%s can never be listed in "overrides": it is structural or already person-owned '
                               "(section 6.3)." % show(name))
                else:
                    message = '%s cannot be listed in "overrides" of %s. Allowed: %s, or an "x-..." name.' % (
                        show(name), kind["itemType"], ", ".join(kind["allowed"]))
                ctx.err(p, "override-name", message)
            out.append(name)
        return out
    raise ValueError("unknown kind %r" % k)


def _walk_date(value: Any, path: str, ctx: Ctx) -> Any:
    if not isinstance(value, str):
        return _type_error(ctx, path, 'a date string "YYYY-MM-DD"', value)
    if not DATE_RE.fullmatch(value):
        hint = 'Use "YYYY-MM-DD", e.g. "2026-10-16".'
        if LDT_RE.fullmatch(value) or re.match(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T", value):
            hint = 'This field takes a date without a time: "YYYY-MM-DD".'
        elif re.fullmatch(r"[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}", value):
            hint = 'Month and day have two digits, e.g. "2026-02-03".'
        ctx.err(path, "date-format", "%s is not a valid date. %s" % (show(value), hint))
        return INVALID
    if not is_valid_date(value):
        ctx.err(path, "real-date", "%s is not a real calendar date." % show(value))
        return INVALID
    ctx.dates.append((path, value))
    return value


def _walk_ldt(value: Any, path: str, ctx: Ctx, or_date: bool) -> Any:
    expected = ('a date "YYYY-MM-DD" or a date-time "YYYY-MM-DDTHH:MM:SS"' if or_date
                else 'a date-time string "YYYY-MM-DDTHH:MM:SS"')
    if not isinstance(value, str):
        return _type_error(ctx, path, expected, value)
    m = LDT_RE.fullmatch(value)
    if not m:
        hint = ('Use "YYYY-MM-DD", or "YYYY-MM-DDTHH:MM:SS" in local time.' if or_date
                else 'Use "YYYY-MM-DDTHH:MM:SS" in local time, e.g. "2026-10-16T23:59:00".')
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:?[0-9]{2})",
                        value, re.IGNORECASE):
            hint = 'Times are local wall-clock times: remove the "Z" or the UTC offset (section 4).'
        elif re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+", value):
            hint = 'Fractions of a second are not allowed; write ":00" seconds or leave them out.'
        elif re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}", value):
            hint = 'Seconds must be ":00" (the format works in whole minutes).'
        elif re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?", value):
            hint = 'Put a "T" between the date and the time, e.g. "2026-10-16T23:59:00".'
        elif not or_date and DATE_RE.fullmatch(value):
            hint = 'This field needs a time as well, e.g. "2026-10-16T00:00:00".'
        ctx.err(path, "datetime-format", "%s is not a valid %s. %s" % (
            show(value), "date or date-time" if or_date else "date-time", hint))
        return INVALID
    if not is_valid_date(m.group(1)):
        ctx.err(path, "real-date", "%s is not a real calendar date." % show(value))
        return INVALID
    ctx.dates.append((path, m.group(1)))
    return "%sT%s:00" % (m.group(1), m.group(2))


def _check_version(root: dict) -> Tuple[Optional[str], Optional[dict], Optional[dict]]:
    """(version, error that does not stop validation, error that stops it)."""
    if "schemaVersion" not in root:
        return None, None, {"path": "schemaVersion", "code": "version-missing",
                            "message": 'This file has no "schemaVersion", so it is not a schedule file (or it is '
                                       'incomplete). A schedule file starts with "schemaVersion": "%s".' % SUPPORTED}
    value = root["schemaVersion"]
    if not isinstance(value, str):
        if isinstance(value, (int, float)) and not isinstance(value, bool) and value == SUPPORTED_MAJOR + SUPPORTED_MINOR / 10.0:
            return None, {"path": "schemaVersion", "code": "version-type",
                          "message": '"schemaVersion" must be the string "%s" (in quotes), not the number %s.' % (
                              SUPPORTED, SUPPORTED)}, None
        return None, None, {"path": "schemaVersion", "code": "version-type",
                            "message": '"schemaVersion" must be a string such as "%s", but this file has %s.' % (
                                SUPPORTED, describe(value))}
    m = re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", value)
    if not m:
        return value, None, {"path": "schemaVersion", "code": "version-format",
                             "message": '%s is not a schema version. Expected "MAJOR.MINOR"; this validator reads '
                                        'version "%s" files.' % (show(value), SUPPORTED)}
    major, minor = int(m.group(1)), int(m.group(2))
    if major != SUPPORTED_MAJOR:
        return value, None, {"path": "schemaVersion", "code": "version-unsupported",
                             "message": "This file uses schema version %s; this format supports %d.x (up to %s). "
                                        "Write a version %s file." % (value, SUPPORTED_MAJOR, SUPPORTED, SUPPORTED)}
    if minor > SUPPORTED_MINOR:
        return value, None, {"path": "schemaVersion", "code": "version-unsupported",
                             "message": "This file uses schema version %s, but the Academic Scheduler supports up to "
                                        "%s. Write a %s file." % (value, SUPPORTED, SUPPORTED)}
    return value, None, None


# ---------------------------------------------------------------------------
# Semantic rules (section 13.1 rule 12 is in the walker; 13.2 and 13.3 here)
# ---------------------------------------------------------------------------

COLLECTION_WORD = {
    "classes": "a class", "assignments": "an assignment", "tasks": "a task", "events": "an event",
    "availability": "a study-time window", "scheduleBlocks": "a schedule block",
}


def _lst(value: Any) -> list:
    return value if isinstance(value, list) else []


def _str(obj: Any, key: str) -> Optional[str]:
    if not isinstance(obj, dict):
        return None
    v = obj.get(key)
    return v if isinstance(v, str) else None


def _num(obj: Any, key: str) -> Optional[int]:
    if not isinstance(obj, dict):
        return None
    v = obj.get(key)
    return v if _is_int(v) else None


def _str_list(obj: Any, key: str) -> List[Optional[str]]:
    if not isinstance(obj, dict) or not isinstance(obj.get(key), list):
        return []
    return [x if isinstance(x, str) else None for x in obj[key]]


def enumerate_items(doc: dict) -> List[dict]:
    """Every item with an id, in document order (tasks right after their assignment)."""
    out = []

    def add(collection: str, path: str, item: Any, assignment_id: Optional[str] = None) -> None:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            out.append({"id": item["id"], "path": path, "collection": collection, "item": item,
                        "assignmentId": assignment_id})

    for i, c in enumerate(_lst(doc.get("classes"))):
        add("classes", "classes[%d]" % i, c)
    for i, a in enumerate(_lst(doc.get("assignments"))):
        add("assignments", "assignments[%d]" % i, a)
        aid = _str(a, "id")
        for j, t in enumerate(_lst(a.get("tasks") if isinstance(a, dict) else None)):
            add("tasks", "assignments[%d].tasks[%d]" % (i, j), t, aid)
    for i, e in enumerate(_lst(doc.get("events"))):
        add("events", "events[%d]" % i, e)
    for i, w in enumerate(_lst(doc.get("availability"))):
        add("availability", "availability[%d]" % i, w)
    for i, b in enumerate(_lst(doc.get("scheduleBlocks"))):
        add("scheduleBlocks", "scheduleBlocks[%d]" % i, b)
    return out


def _damaged_collections(doc: dict, raw_root: dict) -> set:
    """Collections whose list of IDs is incomplete because of a structural error."""
    damaged = set()

    def complete(entries: list) -> bool:
        return all(isinstance(x, dict) and isinstance(x.get("id"), str) for x in entries)

    for key in ("classes", "assignments", "events", "availability", "scheduleBlocks"):
        if not isinstance(raw_root.get(key), list) or not complete(_lst(doc.get(key))):
            damaged.add(key)
    if "assignments" in damaged:
        damaged.add("tasks")
    elif isinstance(raw_root.get("assignments"), list):
        normalized = _lst(doc.get("assignments"))
        for i, raw in enumerate(raw_root["assignments"]):
            if isinstance(raw, dict) and "tasks" in raw and not isinstance(raw["tasks"], list):
                damaged.add("tasks")
            norm = normalized[i] if i < len(normalized) else None
            if not complete(_lst(norm.get("tasks") if isinstance(norm, dict) else None)):
                damaged.add("tasks")
    return damaged


def _check_semantics(doc: dict, raw_root: dict, ctx: Ctx) -> None:
    items = enumerate_items(doc)

    # Rule 13: unique item IDs across the whole file.
    by_id: Dict[str, dict] = {}
    for info in items:
        first = by_id.get(info["id"])
        if first:
            ctx.err(info["path"] + ".id", "duplicate-id",
                    'Duplicate ID "%s": %s (%s) already uses it. Every ID must be unique in the whole file, tasks '
                    "included." % (info["id"], first["path"], COLLECTION_WORD[first["collection"]]))
        else:
            by_id[info["id"]] = info

    # Rule 14: tombstones unique, and their IDs are not used by items.
    tombstones: Dict[str, str] = {}
    for i, t in enumerate(_lst(doc.get("deleted"))):
        tid = _str(t, "id")
        if tid is None:
            continue
        if tid in tombstones:
            ctx.err("deleted[%d].id" % i, "duplicate-tombstone",
                    '"%s" is already listed in %s. Each deleted ID is listed once.' % (tid, tombstones[tid]))
        else:
            tombstones[tid] = "deleted[%d]" % i
    for info in items:
        if info["id"] in tombstones:
            ctx.err(info["path"] + ".id", "deleted-id-used",
                    '"%s" is listed in %s as an item the person deleted; no item may use this ID. Leave the item out '
                    "(or remove the tombstone to restore it)." % (info["id"], tombstones[info["id"]]))

    # Rule 15: issue IDs unique among all issues of the file.
    issue_ids: Dict[str, str] = {}

    def check_issue_list(issues: Any, path: str) -> None:
        for i, issue in enumerate(_lst(issues)):
            iid = _str(issue, "id")
            if iid is None:
                continue
            p = "%s[%d]" % (path, i)
            if iid in issue_ids:
                ctx.err(p + ".id", "duplicate-issue-id",
                        'Duplicate issue ID "%s" (already used by %s). Issue IDs are unique among all issues of the '
                        "file." % (iid, issue_ids[iid]))
            else:
                issue_ids[iid] = p

    check_issue_list(doc.get("issues"), "issues")
    for info in items:
        check_issue_list(info["item"].get("issues"), info["path"] + ".issues")

    # Rule 16: requestedChanges IDs unique.
    requested: Dict[str, int] = {}
    meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
    for i, rc in enumerate(_lst(meta.get("requestedChanges"))):
        rid = _str(rc, "id")
        if rid is None:
            continue
        if rid in requested:
            ctx.err("meta.requestedChanges[%d].id" % i, "duplicate-requested-change",
                    '"%s" is already listed in meta.requestedChanges[%d]. List each item once.' % (rid, requested[rid]))
        else:
            requested[rid] = i

    # Rule 17: references resolve. A collection with a structural error cannot
    # prove that an ID is missing, so "does not exist" is not reported for it.
    damaged = _damaged_collections(doc, raw_root)

    def expect_ref(path: str, ref: Optional[str], collection: str, what: str) -> None:
        if ref is None:
            return
        target = by_id.get(ref)
        if target is None:
            if collection not in damaged:
                ctx.err(path, "unknown-reference", '%s "%s" does not exist in this file.' % (what, ref))
        elif target["collection"] != collection:
            ctx.err(path, "wrong-reference", '"%s" is %s (%s), not %s.' % (
                ref, COLLECTION_WORD[target["collection"]], target["path"], COLLECTION_WORD[collection]))

    for i, a in enumerate(_lst(doc.get("assignments"))):
        if not isinstance(a, dict):
            continue
        path = "assignments[%d]" % i
        aid = _str(a, "id")
        expect_ref(path + ".classId", _str(a, "classId"), "classes", "Class")
        for j, dep in enumerate(_str_list(a, "dependsOn")):
            if dep is None:
                continue
            if dep == aid:
                ctx.err("%s.dependsOn[%d]" % (path, j), "depends-on-self", "An assignment cannot depend on itself.")
            else:
                expect_ref("%s.dependsOn[%d]" % (path, j), dep, "assignments", "Assignment")
        tasks = _lst(a.get("tasks"))
        task_ids = set(t["id"] for t in tasks if isinstance(t, dict) and isinstance(t.get("id"), str))
        tasks_complete = all(isinstance(t, dict) and isinstance(t.get("id"), str) for t in tasks)
        for j, t in enumerate(tasks):
            if not isinstance(t, dict):
                continue
            tid = _str(t, "id")
            for k, dep in enumerate(_str_list(t, "dependsOn")):
                if dep is None:
                    continue
                p = "%s.tasks[%d].dependsOn[%d]" % (path, j, k)
                if dep == tid:
                    ctx.err(p, "depends-on-self", "A task cannot depend on itself.")
                elif dep not in task_ids:
                    target = by_id.get(dep)
                    if target is None and not tasks_complete:
                        continue
                    ctx.err(p, "task-dependency-outside",
                            '"%s" is not a task of this assignment (%s). Tasks can only depend on tasks of the same '
                            "assignment." % (dep, target["path"]) if target else
                            'Task "%s" does not exist in this assignment.' % dep)
    for i, e in enumerate(_lst(doc.get("events"))):
        if not isinstance(e, dict):
            continue
        expect_ref("events[%d].classId" % i, _str(e, "classId"), "classes", "Class")
        expect_ref("events[%d].assignmentId" % i, _str(e, "assignmentId"), "assignments", "Assignment")
    for i, b in enumerate(_lst(doc.get("scheduleBlocks"))):
        if not isinstance(b, dict):
            continue
        assignment_id = _str(b, "assignmentId")
        expect_ref("scheduleBlocks[%d].assignmentId" % i, assignment_id, "assignments", "Assignment")
        task_id = _str(b, "taskId")
        if task_id is None or assignment_id is None:
            continue
        assignment = by_id.get(assignment_id)
        if assignment is None or assignment["collection"] != "assignments":
            continue  # already reported
        task = by_id.get(task_id)
        p = "scheduleBlocks[%d].taskId" % i
        if task is None:
            if "tasks" not in damaged:
                ctx.err(p, "unknown-reference", 'Task "%s" does not exist in this file.' % task_id)
        elif task["collection"] != "tasks":
            ctx.err(p, "wrong-reference", '"%s" is %s (%s), not a task.' % (
                task_id, COLLECTION_WORD[task["collection"]], task["path"]))
        elif task["assignmentId"] != assignment_id:
            ctx.err(p, "task-of-other-assignment",
                    'Task "%s" belongs to assignment "%s", not to "%s" (this block\'s assignmentId).' % (
                        task_id, task["assignmentId"], assignment_id))
    for i, issue in enumerate(_lst(doc.get("issues"))):
        item_id = _str(issue, "itemId")
        if item_id is not None and item_id not in by_id and not damaged:
            ctx.err("issues[%d].itemId" % i, "unknown-reference",
                    'Item "%s" does not exist in this file (itemId must name an existing item of any collection, '
                    "tasks included)." % item_id)

    # Rule 18: no dependency cycles.
    assignments = _lst(doc.get("assignments"))
    assignment_ids = set(a["id"] for a in assignments if isinstance(a, dict) and isinstance(a.get("id"), str))
    _report_cycles(ctx, [(_str(a, "id"), "assignments[%d]" % i, _str_list(a, "dependsOn"))
                         for i, a in enumerate(assignments)], assignment_ids, "assignments")
    for i, a in enumerate(assignments):
        if not isinstance(a, dict):
            continue
        tasks = _lst(a.get("tasks"))
        ids = set(t["id"] for t in tasks if isinstance(t, dict) and isinstance(t.get("id"), str))
        _report_cycles(ctx, [(_str(t, "id"), "assignments[%d].tasks[%d]" % (i, j), _str_list(t, "dependsOn"))
                             for j, t in enumerate(tasks)], ids, "tasks")

    # Rule 19: blocks last >= 5 minutes, on their start date or ending at the next midnight.
    for i, b in enumerate(_lst(doc.get("scheduleBlocks"))):
        start, end = _str(b, "start"), _str(b, "end")
        if start is None or end is None:
            continue
        p = "scheduleBlocks[%d].end" % i
        minutes = ldt_to_minutes(end) - ldt_to_minutes(start)
        start_date, end_date = date_of(start), date_of(end)
        same_day = start_date == end_date
        next_midnight = day_number(end_date) == day_number(start_date) + 1 and end[11:16] == "00:00"
        if minutes <= 0:
            ctx.err(p, "block-end-before-start", "The block ends (%s) before or when it starts (%s)." % (end, start))
        elif not same_day and not next_midnight:
            ctx.err(p, "block-crosses-midnight",
                    "A block must end on the date it starts (%s) or at 00:00 of the next date (midnight). Split work "
                    "that crosses midnight into two blocks." % start_date)
        elif minutes < 5:
            ctx.err(p, "block-too-short", "The block lasts %d minute%s; a block lasts at least 5 minutes." % (
                minutes, "" if minutes == 1 else "s"))

    # Rule 20: end times after start times; end dates not before start dates.
    def check_times(obj: Any, path: str, what: str) -> None:
        st, et = _str(obj, "startTime"), _str(obj, "endTime")
        if st is not None and et is not None and time_to_minutes(et) <= time_to_minutes(st):
            ctx.err(path + ".endTime", "end-time-before-start",
                    'endTime (%s) must be later than startTime (%s). %s cannot cross midnight; use "24:00" for '
                    "midnight at the end of the day." % (et, st, what))
        rec = obj.get("recurrence") if isinstance(obj, dict) else None
        if isinstance(rec, dict):
            sd, ed = _str(rec, "startDate"), _str(rec, "endDate")
            if sd is not None and ed is not None and ed < sd:
                ctx.err(path + ".recurrence.endDate", "end-date-before-start",
                        "The recurrence endDate (%s) is before its startDate (%s)." % (ed, sd))

    for i, e in enumerate(_lst(doc.get("events"))):
        if not isinstance(e, dict):
            continue
        check_times(e, "events[%d]" % i, "Events")
        d, ed = _str(e, "date"), _str(e, "endDate")
        if d is not None and ed is not None and ed < d:
            ctx.err("events[%d].endDate" % i, "end-date-before-start", "endDate (%s) is before date (%s)." % (ed, d))
    for i, w in enumerate(_lst(doc.get("availability"))):
        if isinstance(w, dict):
            check_times(w, "availability[%d]" % i, "Study-time windows")

    # Rules 21-23: date order and estimates.
    for i, a in enumerate(_lst(doc.get("assignments"))):
        if not isinstance(a, dict):
            continue
        path = "assignments[%d]" % i
        due, assessment, rcd = _str(a, "due"), _str(a, "assessmentDate"), _str(a, "recommendedCompletionDate")
        if rcd is not None:
            if due is not None:
                if compare_date_values(rcd, due) > 0:
                    ctx.err(path + ".recommendedCompletionDate", "date-order",
                            "recommendedCompletionDate (%s) is later than due (%s); it is a target before the "
                            "deadline." % (rcd, due))
            elif assessment is not None and compare_date_values(rcd, assessment) > 0:
                ctx.err(path + ".recommendedCompletionDate", "date-order",
                        "recommendedCompletionDate (%s) is later than assessmentDate (%s); it is a target before the "
                        "assessment." % (rcd, assessment))
        _check_estimate(a, path, ctx)
        for j, t in enumerate(_lst(a.get("tasks"))):
            if not isinstance(t, dict):
                continue
            tp = "%s.tasks[%d]" % (path, j)
            _check_estimate(t, tp, ctx)
            start, done, task_due = _str(t, "recommendedStartDate"), _str(t, "recommendedCompletionDate"), _str(t, "due")
            if start is not None and done is not None and compare_date_values(start, done) > 0:
                ctx.err(tp + ".recommendedStartDate", "date-order",
                        "recommendedStartDate (%s) is later than recommendedCompletionDate (%s)." % (start, done))
            if done is not None and task_due is not None and compare_date_values(done, task_due) > 0:
                ctx.err(tp + ".recommendedCompletionDate", "date-order",
                        "recommendedCompletionDate (%s) is later than the task's due (%s)." % (done, task_due))
            if start is not None and task_due is not None and compare_date_values(start, task_due) > 0:
                ctx.err(tp + ".recommendedStartDate", "date-order",
                        "recommendedStartDate (%s) is later than the task's due (%s)." % (start, task_due))
            task_due_too_late = task_due is not None and due is not None and compare_date_values(task_due, due) > 0
            if task_due_too_late:
                ctx.err(tp + ".due", "task-due-after-assignment-due",
                        "The task's due (%s) is later than the assignment's due (%s)." % (task_due, due))
            limits = [x for x in (due, assessment) if x is not None]
            if limits:
                if len(limits) == 2:
                    limit_text = "both the assignment's due (%s) and its assessmentDate (%s)" % (due, assessment)
                elif due is not None:
                    limit_text = "the assignment's due (%s)" % due
                else:
                    limit_text = "the assignment's assessmentDate (%s)" % assessment
                for key, value in (("recommendedStartDate", start), ("recommendedCompletionDate", done), ("due", task_due)):
                    if value is None or (key == "due" and task_due_too_late):
                        continue
                    if all(compare_date_values(value, limit) > 0 for limit in limits):
                        ctx.err("%s.%s" % (tp, key), "task-after-assignment",
                                "The task's %s (%s) is later than %s." % (key, value, limit_text))

    # Rule 24: settings, after defaults are applied.
    raw_settings = raw_root.get("settings")
    settings = doc.get("settings")
    if isinstance(raw_settings, dict) and isinstance(settings, dict):
        def usable(key: str) -> bool:
            return key not in raw_settings or key in settings

        resolved = resolve_settings(settings)
        if usable("dayStartTime") and usable("dayEndTime") and \
                time_to_minutes(resolved["dayEndTime"]) <= time_to_minutes(resolved["dayStartTime"]):
            ctx.err("settings.dayEndTime" if "dayEndTime" in settings else "settings.dayStartTime", "settings-day-times",
                    "dayEndTime (%s%s) must be later than dayStartTime (%s%s)." % (
                        resolved["dayEndTime"], "" if "dayEndTime" in settings else ", the default",
                        resolved["dayStartTime"], "" if "dayStartTime" in settings else ", the default"))
        if usable("minSessionMinutes") and usable("maxSessionMinutes") and \
                resolved["maxSessionMinutes"] < resolved["minSessionMinutes"]:
            ctx.err("settings.maxSessionMinutes" if "maxSessionMinutes" in settings else "settings.minSessionMinutes",
                    "settings-session-length",
                    "maxSessionMinutes (%s%s) must be at least minSessionMinutes (%s%s)." % (
                        resolved["maxSessionMinutes"], "" if "maxSessionMinutes" in settings else ", the default",
                        resolved["minSessionMinutes"], "" if "minSessionMinutes" in settings else ", the default"))


def _check_estimate(obj: dict, path: str, ctx: Ctx) -> None:
    rng = obj.get("estimateRange")
    if not isinstance(rng, dict):
        return
    lo, hi = _num(rng, "min"), _num(rng, "max")
    if lo is None or hi is None:
        return
    if lo > hi:
        ctx.err(path + ".estimateRange", "estimate-range-order",
                "estimateRange.min (%d) is greater than estimateRange.max (%d)." % (lo, hi))
        return
    estimate = _num(obj, "estimatedMinutes")
    if estimate is not None and (estimate < lo or estimate > hi):
        ctx.err(path + ".estimatedMinutes", "estimate-outside-range",
                "estimatedMinutes (%d) is outside its estimateRange (%d-%d)." % (estimate, lo, hi))


def _report_cycles(ctx: Ctx, nodes: List[Tuple[Optional[str], str, List[Optional[str]]]], known: set, what: str) -> None:
    """Rule 18: report each dependency cycle once (Tarjan's algorithm, iterative)."""
    path_of: Dict[str, str] = {}
    edges: Dict[str, List[str]] = {}
    order: List[str] = []
    for node_id, path, deps in nodes:
        if node_id is None or node_id in path_of:
            continue
        path_of[node_id] = path
        order.append(node_id)
        edges[node_id] = [d for d in deps if d is not None and d != node_id and d in known]
    index: Dict[str, int] = {}
    low: Dict[str, int] = {}
    on_stack = set()
    stack: List[str] = []
    counter = 0
    components: List[List[str]] = []
    for root in order:
        if root in index:
            continue
        frames: List[List[Any]] = []

        def visit(node: str) -> None:
            nonlocal counter
            index[node] = low[node] = counter
            counter += 1
            stack.append(node)
            on_stack.add(node)
            frames.append([node, 0])

        visit(root)
        while frames:
            frame = frames[-1]
            succ = edges.get(frame[0], [])
            if frame[1] < len(succ):
                w = succ[frame[1]]
                frame[1] += 1
                if w not in index:
                    visit(w)
                elif w in on_stack:
                    low[frame[0]] = min(low[frame[0]], index[w])
                continue
            frames.pop()
            if frames:
                parent = frames[-1][0]
                low[parent] = min(low[parent], low[frame[0]])
            if low[frame[0]] == index[frame[0]]:
                component = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    component.append(w)
                    if w == frame[0]:
                        break
                if len(component) > 1:
                    components.append(component)
    position = {node_id: i for i, node_id in enumerate(order)}
    for component in components:
        component.sort(key=lambda x: position[x])
        names = ", ".join('"%s"' % x for x in component)
        ctx.err(path_of[component[0]] + ".dependsOn", "dependency-cycle",
                'These %s depend on each other in a cycle: %s. "dependsOn" must not form a cycle.' % (what, names))


# ---------------------------------------------------------------------------
# Warnings (section 13.4)
# ---------------------------------------------------------------------------

_TZ_CACHE: Dict[str, Any] = {}


def is_known_time_zone(name: str) -> Optional[bool]:
    """True/False, or None when this Python has no time-zone database to check against."""
    if not TZ_NAME_RE.fullmatch(name):
        return False
    if "names" not in _TZ_CACHE:
        try:
            import zoneinfo  # Python 3.9+
            names = zoneinfo.available_timezones()
        except Exception:  # noqa: BLE001 - no zoneinfo or no tzdata
            names = set()
        _TZ_CACHE["names"] = names
        _TZ_CACHE["lower"] = {n.lower() for n in names}
    if not _TZ_CACHE["names"]:
        return None
    if name in _TZ_CACHE["names"] or name.lower() in _TZ_CACHE["lower"] or name.upper() == "UTC":
        return True
    try:  # links such as "US/Eastern" are not always listed
        import zoneinfo
        zoneinfo.ZoneInfo(name)
        return True
    except Exception:  # noqa: BLE001
        return False


def _collect_warnings(doc: dict, ctx: Ctx, today: str) -> None:
    settings = resolve_settings(doc.get("settings") if isinstance(doc.get("settings"), dict) else None)
    assignments_by_id: Dict[str, dict] = {}
    tasks_by_id: Dict[str, dict] = {}
    for a in _lst(doc.get("assignments")):
        aid = _str(a, "id")
        if aid is None:
            continue
        assignments_by_id.setdefault(aid, a)
        for t in _lst(a.get("tasks")):
            tid = _str(t, "id")
            if tid is not None:
                tasks_by_id.setdefault(tid, t)

    blocks = []
    for i, b in enumerate(_lst(doc.get("scheduleBlocks"))):
        start, end = _str(b, "start"), _str(b, "end")
        if start is None or end is None:
            continue
        start_abs, end_abs = ldt_to_minutes(start), ldt_to_minutes(end)
        date = date_of(start)
        day_start = day_number(date) * 1440
        if end_abs <= start_abs or end_abs - day_start > 1440:
            continue  # invalid; already an error
        assignment_id = _str(b, "assignmentId")
        assignment = assignments_by_id.get(assignment_id) if assignment_id is not None else None
        origin = _str(b, "origin") or "generated"
        status = _str(b, "status") or "planned"
        blocks.append({
            "index": i, "path": "scheduleBlocks[%d]" % i, "date": date,
            "start": start_abs - day_start, "end": end_abs - day_start, "status": status,
            "work": (_str(b, "kind") or "work") == "work",
            "planLike": origin != "user" and b.get("locked") is not True,
            "label": _str(b, "title") or _str(assignment, "title") or assignment_id or "block",
        })
        if status != "planned":
            continue  # done/skipped blocks are history
        if assignment is not None:
            due = _str(assignment, "due")
            if due is not None and end_abs > ldt_to_minutes(due_moment(due, settings["defaultDueTime"])):
                ctx.warn("scheduleBlocks[%d].end" % i, "block-after-due", 'This block ends after "%s" is due (%s%s).' % (
                    _str(assignment, "title") or assignment_id, due,
                    ", planned as %s that day" % settings["defaultDueTime"] if is_date_only(due) else ""))
            assessment = _str(assignment, "assessmentDate")
            if assessment is not None and end_abs > ldt_to_minutes(start_of_day_moment(assessment)):
                ctx.warn("scheduleBlocks[%d].end" % i, "block-after-assessment",
                         'This preparation block ends after the assessment "%s" (%s%s).' % (
                             _str(assignment, "title") or assignment_id, assessment,
                             ", i.e. 00:00 that day" if is_date_only(assessment) else ""))
        task_id = _str(b, "taskId")
        task = tasks_by_id.get(task_id) if task_id is not None else None
        task_due = _str(task, "due")
        if task_due is not None and end_abs > ldt_to_minutes(due_moment(task_due, settings["defaultDueTime"])):
            ctx.warn("scheduleBlocks[%d].end" % i, "block-after-task-due", 'This block ends after its task "%s" is due (%s%s).' % (
                _str(task, "title") or task_id, task_due,
                ", planned as %s that day" % settings["defaultDueTime"] if is_date_only(task_due) else ""))

    # Overlaps: blocks with blocks, blocks with busy events (skipped blocks did not happen).
    by_date: Dict[str, List[dict]] = {}
    for block in blocks:
        if block["status"] != "skipped":
            by_date.setdefault(block["date"], []).append(block)
    busy_events = [(e, i) for i, e in enumerate(_lst(doc.get("events"))) if isinstance(e, dict) and e.get("busy") is not False]
    for date, day in by_date.items():
        ordered = sorted(day, key=lambda x: (x["start"], x["index"]))
        active: List[dict] = []
        for block in ordered:
            active = [o for o in active if o["end"] > block["start"]]
            for other in active:
                first, second = (other, block) if other["index"] < block["index"] else (block, other)
                ctx.warn(second["path"], "block-overlap", 'Overlaps %s ("%s", %s-%s) on %s.' % (
                    first["path"], first["label"], hhmm(first["start"]), hhmm(first["end"]), date))
            active.append(block)
        for e, i in busy_events:
            if not event_occurs_on(e, date):
                continue
            all_day = e.get("allDay") is True
            st, et = _str(e, "startTime"), _str(e, "endTime")
            if not all_day and (st is None or et is None):
                continue
            ev_start = 0 if all_day else time_to_minutes(st)
            ev_end = 1440 if all_day else time_to_minutes(et)
            for block in ordered:
                if block["start"] < ev_end and block["end"] > ev_start:
                    ctx.warn(block["path"], "block-overlaps-event", 'Overlaps the busy event "%s" (%s) on %s.' % (
                        _str(e, "title") or "events[%d]" % i, "all day" if all_day else "%s-%s" % (st, et), date))

    # Session settings: generated/planner, unlocked, planned work blocks only.
    for block in blocks:
        if not block["work"] or not block["planLike"] or block["status"] != "planned":
            continue
        length = block["end"] - block["start"]
        if length < settings["minSessionMinutes"]:
            ctx.warn(block["path"], "session-too-short", "This planned session lasts %s, less than minSessionMinutes (%d)." % (
                format_duration(length), settings["minSessionMinutes"]))
        elif length > settings["maxSessionMinutes"]:
            ctx.warn(block["path"], "session-too-long", "This planned session lasts %s, more than maxSessionMinutes (%d)." % (
                format_duration(length), settings["maxSessionMinutes"]))
    limit = settings["maxDailyStudyMinutes"]
    if limit is not None:
        totals: Dict[str, dict] = {}
        for block in blocks:
            if not block["work"] or block["status"] == "skipped":
                continue
            entry = totals.setdefault(block["date"], {"minutes": 0, "first": None})
            entry["minutes"] += block["end"] - block["start"]
            if block["planLike"] and block["status"] == "planned" and entry["first"] is None:
                entry["first"] = block
        for date, entry in totals.items():
            if entry["minutes"] > limit and entry["first"] is not None:
                ctx.warn(entry["first"]["path"], "daily-limit",
                         "%s has %s of scheduled work, more than maxDailyStudyMinutes (%s)." % (
                             date, format_duration(entry["minutes"]), format_duration(limit)))

    # Recurrences that never occur.
    for name in ("events", "availability"):
        for i, obj in enumerate(_lst(doc.get(name))):
            rec = obj.get("recurrence") if isinstance(obj, dict) else None
            if isinstance(rec, dict) and never_occurs(rec):
                ctx.warn("%s[%d].recurrence" % (name, i), "recurrence-never-occurs",
                         "This recurrence never occurs (no matching day between startDate and endDate that is not an "
                         "exception).")

    # Dates more than 5 years away from today.
    year, rest = int(today[0:4]), today[4:]
    lower, upper = "%04d%s" % (year - 5, rest), "%04d%s" % (year + 5, rest)
    for path, date in ctx.dates:
        if date < lower or date > upper:
            ctx.warn(path, "far-date", "%s is more than 5 years from today (%s). Check the year." % (date, today))

    # overrides on user items (ignored).
    for info in enumerate_items(doc):
        overrides = info["item"].get("overrides")
        if _str(info["item"], "origin") == "user" and isinstance(overrides, list) and overrides:
            ctx.warn(info["path"] + ".overrides", "overrides-on-user-item",
                     '"overrides" has no effect on an item the person created (origin "user"); it is ignored.')

    # meta.timezone must be an IANA name.
    meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
    tz = _str(meta, "timezone")
    if tz is not None and is_known_time_zone(tz) is False:
        ctx.warn("meta.timezone", "unknown-timezone",
                 '%s is not a known IANA time-zone name (for example "America/New_York").' % show(tz))


def _generator_checks(doc: dict, ctx: Ctx) -> None:
    """Rules for files written by a generator (sections 4, 14, 15). Reported as warnings."""
    meta = doc.get("meta") if isinstance(doc.get("meta"), dict) else {}
    for key, why in (("generator", "every writer records itself (section 5 Meta)"),
                     ("generatedAt", 'the reference "now" (sections 4, 15.1)'),
                     ("timezone", "generators MUST write it (section 4)")):
        if key not in meta:
            ctx.warn("meta." + key, "gen-meta-missing", "meta.%s is missing: %s." % (key, why))
    if "exportId" in meta:
        ctx.warn("meta.exportId", "gen-export-id",
                 "Generators MUST NOT write meta.exportId; set meta.basedOn to the input schedule's exportId instead "
                 "(section 15.1).")
    items = enumerate_items(doc)
    by_id = {info["id"]: info for info in items}

    def issues_without_id(issues: Any, path: str) -> None:
        for i, issue in enumerate(_lst(issues)):
            if isinstance(issue, dict) and "id" not in issue:
                ctx.warn("%s[%d]" % (path, i), "gen-issue-id", "Generators MUST give every issue an id (section 15.8).")

    issues_without_id(doc.get("issues"), "issues")
    for info in items:
        issues_without_id(info["item"].get("issues"), info["path"] + ".issues")
        origin = info["item"].get("origin", "generated")
        if origin == "generated" and info["id"].startswith("u-"):
            ctx.warn(info["path"] + ".id", "gen-u-prefix",
                     'IDs starting with "u-" are reserved for the website; a generated item needs a derived ID '
                     "(section 14.1).")
        rng = info["item"].get("estimateRange")
        est = info["item"].get("estimatedMinutes")
        if isinstance(rng, dict) and _is_int(rng.get("min")) and _is_int(rng.get("max")) and _is_int(est):
            expected = point_estimate(rng["min"], rng["max"])
            if est != expected and rng["min"] <= rng["max"]:
                ctx.warn(info["path"] + ".estimatedMinutes", "gen-point-estimate",
                         "estimatedMinutes %d differs from the midpoint rule (%d for %d-%d); fine only if it is a "
                         "kept or teacher-given estimate (section 8)." % (est, expected, rng["min"], rng["max"]))
    for i, rc in enumerate(_lst(meta.get("requestedChanges"))):
        rid = _str(rc, "id")
        info = by_id.get(rid) if rid else None
        if info is not None:
            item = info["item"]
            if item.get("origin", "generated") != "user" and item.get("locked") is not True and \
                    not _inside_protected_assignment(info, by_id):
                ctx.warn("meta.requestedChanges[%d].id" % i, "gen-requested-change-unprotected",
                         '"%s" is not a protected item (origin "user" or locked); requestedChanges lists only changes '
                         "to protected items (section 15.9)." % rid)


def _inside_protected_assignment(info: dict, by_id: Dict[str, dict]) -> bool:
    if info["collection"] != "tasks" or not info["assignmentId"]:
        return False
    parent = by_id.get(info["assignmentId"])
    if not parent:
        return False
    item = parent["item"]
    return item.get("origin", "generated") == "user" or item.get("locked") is True


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class ValidationResult:
    def __init__(self, ok: bool, errors: List[dict], warnings: List[dict], doc: Optional[dict] = None,
                 schema_version: Optional[str] = None, stage: str = "content") -> None:
        self.ok = ok
        self.errors = errors
        self.warnings = warnings
        self.doc = doc
        self.schema_version = schema_version
        self.stage = stage

    def to_json(self) -> dict:
        return {"valid": self.ok, "stage": self.stage, "schemaVersion": self.schema_version,
                "errors": self.errors, "warnings": self.warnings}


def _today_local() -> str:
    import datetime
    return datetime.date.today().isoformat()


def validate_document(data: Any, today: Optional[str] = None, generator: bool = False) -> ValidationResult:
    """Validate a parsed JSON value. Returns every problem, each with a path."""
    ctx = Ctx()
    if not isinstance(data, dict):
        return ValidationResult(False, [{"path": "", "code": "root-type",
                                         "message": 'A schedule file must contain one JSON object ({ "schemaVersion": '
                                                    '"1.0", ... }), but this contains %s.' % describe(data)}],
                                [], stage="root")
    version, version_error, stop = _check_version(data)
    if stop:
        return ValidationResult(False, [stop], [], schema_version=version, stage="version")
    if version_error:
        ctx.errors.append(version_error)
    normalized = walk_object(data, ROOT_SPEC, "", ctx, skip="schemaVersion")
    doc = {"schemaVersion": SUPPORTED}
    if normalized is not INVALID:
        doc.update(normalized)
    _check_semantics(doc, data, ctx)
    _collect_warnings(doc, ctx, today if today and is_valid_date(today) else _today_local())
    if generator:
        _generator_checks(doc, ctx)
    ok = not ctx.errors
    return ValidationResult(ok, ctx.errors, ctx.warnings, doc if ok else None, version, "content")


def parse_schedule_bytes(raw: bytes, today: Optional[str] = None, generator: bool = False) -> ValidationResult:
    """Decode (UTF-8, optional BOM), parse and validate file contents."""
    if len(raw) > MAX_FILE_BYTES:
        return ValidationResult(False, [{"path": "", "code": "too-large",
                                         "message": "This file is larger than 10 MB (%.1f MB); the website accepts "
                                                    "schedule files up to 10 MB." % (len(raw) / 1048576.0)}],
                                [], stage="size")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        return ValidationResult(False, [{"path": "", "code": "encoding",
                                         "message": "The file is not UTF-8 text (byte %d). Save it as UTF-8." % exc.start}],
                                [], stage="json")
    return parse_schedule_text(text, today=today, generator=generator)


def parse_schedule_text(text: str, today: Optional[str] = None, generator: bool = False) -> ValidationResult:
    if text.startswith("﻿"):
        text = text[1:]
    if not text.strip():
        return ValidationResult(False, [{"path": "", "code": "empty",
                                         "message": 'The file is empty. A schedule file is one JSON object that starts '
                                                    'with { "schemaVersion": "1.0", ... }.'}], [], stage="json")
    duplicates: List[str] = []

    def pairs_hook(pairs: List[Tuple[str, Any]]) -> dict:
        out: Dict[str, Any] = {}
        for key, value in pairs:
            if key in out:
                duplicates.append(key)
            out[key] = value  # like JSON.parse: the last value wins
        return out

    def reject_constant(name: str) -> Any:
        raise ValueError("%s is not a JSON value" % name)

    try:
        data = json.loads(text, object_pairs_hook=pairs_hook, parse_constant=reject_constant)
    except json.JSONDecodeError as exc:
        return ValidationResult(False, [{"path": "", "code": "json-syntax",
                                         "message": "This is not valid JSON: %s (line %d, column %d)." % (
                                             exc.msg, exc.lineno, exc.colno)}], [], stage="json")
    except RecursionError:
        return ValidationResult(False, [{"path": "", "code": "json-syntax",
                                         "message": "This JSON is nested too deeply to read."}], [], stage="json")
    except ValueError as exc:
        return ValidationResult(False, [{"path": "", "code": "json-syntax",
                                         "message": "This is not valid JSON: %s." % exc}], [], stage="json")
    result = validate_document(data, today=today, generator=generator)
    for key in sorted(set(duplicates)):
        result.warnings.append({"path": "", "code": "duplicate-key",
                                "message": "The property name %s appears twice in one object; only the last value "
                                           "counts. Remove the duplicate." % json.dumps(key, ensure_ascii=False)})
    return result


def validate_file(path: str, today: Optional[str] = None, generator: bool = False) -> ValidationResult:
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_FILE_BYTES + 1)
    except OSError as exc:
        return ValidationResult(False, [{"path": "", "code": "read", "message": "Cannot read the file: %s" % exc}],
                                [], stage="size")
    return parse_schedule_bytes(raw, today=today, generator=generator)


def _print_result(name: str, result: ValidationResult, show_warnings: bool, out: Any) -> None:
    status = "valid" if result.ok else "INVALID"
    out.write("%s: %s - %d error%s, %d warning%s\n" % (
        name, status, len(result.errors), "" if len(result.errors) == 1 else "s",
        len(result.warnings), "" if len(result.warnings) == 1 else "s"))
    for e in result.errors:
        out.write("  error    %s: %s\n" % (e["path"] or "(root)", e["message"]))
    if show_warnings:
        for w in result.warnings:
            out.write("  warning  %s: %s\n" % (w["path"] or "(root)", w["message"]))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Validate schedule files against SCHEDULE_FORMAT.md 1.0.")
    parser.add_argument("files", nargs="+", help="schedule JSON files")
    parser.add_argument("--json", action="store_true", help="print the results as JSON")
    parser.add_argument("--today", help="today's date (YYYY-MM-DD) for the 5-year warning; default: the system date")
    parser.add_argument("--generator", action="store_true",
                        help="also check the rules for files written by a generator (warnings with gen- codes)")
    parser.add_argument("--no-warnings", action="store_true", help="print errors only")
    args = parser.parse_args(argv)
    if args.today and not is_valid_date(args.today):
        parser.error("--today must be a date YYYY-MM-DD")
    results = [(f, validate_file(f, today=args.today, generator=args.generator)) for f in args.files]
    all_ok = all(r.ok for _, r in results)
    out = sys.stdout
    if args.json:
        payload = {"valid": all_ok, "files": [dict(file=f, **r.to_json()) for f, r in results]}
        if args.no_warnings:
            for entry in payload["files"]:
                entry["warnings"] = []
        out.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    else:
        for f, r in results:
            _print_result(f, r, not args.no_warnings, out)
    return 0 if all_ok else 1


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="backslashreplace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
