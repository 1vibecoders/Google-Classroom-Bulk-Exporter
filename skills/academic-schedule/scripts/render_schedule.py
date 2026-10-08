#!/usr/bin/env python3
"""Show a schedule file as plain text, for pasting into a chat.

Reads a schedule.json (SCHEDULE_FORMAT.md version 1.0), validates it with the
same rules as the website (validate_schedule.py) and prints a deterministic,
monospace view of it:

  * a header: the schedule's title, the days shown, when the file was
    generated and its time zone;
  * a week overview: one line per day with free study time, planned work,
    overload in words, due dates and assessments;
  * day agendas: events, work sessions, breaks and the free time between
    them in time order, done / skipped sessions, conflicts and sessions that
    end after a deadline in words, then the day's deadlines and totals;
  * the assignments: overdue / this week / later / no date, each with its
    dates, status, estimate, remaining / scheduled / unscheduled work
    (section 8.1, computed by schedule_report.py) and its tasks;
  * the open issues and questions.

Everything comes from the validated file, with the website's rules: recurring
events (section 10), free time = availability minus busy events (section 11;
no availability = "study time not provided", no overload), blocks (section
12), date-only values (section 8) and warnings (section 13.4). Paste the
output unchanged inside a ```text block; never edit it by hand.

Usage:
  python3 -I render_schedule.py schedule.json [--from YYYY-MM-DD] [--days N | --to YYYY-MM-DD]
        [--view all|agenda|week|assignments|issues] [--now YYYY-MM-DDTHH:MM] [--width N]
        [--include-done] [--include-notes] [--no-descriptions] [--ascii] [--force]

  --from          first day shown (default: the day of --now)
  --days / --to   how many days, or the last day shown (default: 7 days)
  --view          one part only (default: all parts)
  --now           the reference time (default: the file's meta.generatedAt, else the system clock)
  --width         maximum line length (default 78, 40-200)
  --include-done  also list done / cancelled assignments and resolved / dismissed issues
  --include-notes also show the person's own notes (left out by default)
  --no-descriptions  leave out the "what to do" text of work sessions
  --ascii         ASCII only (no dashes, box lines, check marks or accents)
  --force         show an invalid file anyway: the invalid parts are left out and
                  listed on top (the website would reject the file)

Exit status: 0 = shown; 2 = the file cannot be read or is not valid (nothing
is printed on standard output unless --force), or a bad option.

Python 3.8+ standard library only. The file is only read as data.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import importlib.util
import json
import os
import re
import sys
import textwrap
import unicodedata
from typing import Any, Dict, List, Optional, Sequence, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_sibling(name: str) -> Any:
    path = os.path.join(HERE, name + ".py")
    spec = importlib.util.spec_from_file_location("academic_schedule_" + name, path)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = module  # type: ignore[union-attr]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


# schedule_report.py computes remaining work (section 8.1) and free time exactly as the
# website does; it loads validate_schedule.py, whose date helpers and validator are used too.
R = _load_sibling("schedule_report")
V = R.V

VIEWS = ("all", "agenda", "week", "assignments", "issues")
DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH = 78, 40, 200
DEFAULT_DAYS, MAX_DAYS = 7, 366
MAX_FORCE_BYTES = 50 * 1024 * 1024
MAX_PRUNE_ROUNDS = 200

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]
ASSESSMENT_TYPES = ("quiz", "test", "exam", "presentation")
TYPE_LABELS = {"homework": "Homework", "reading": "Reading", "writing": "Writing", "problem_set": "Problem set",
               "lab": "Lab", "project": "Project", "presentation": "Presentation", "quiz": "Quiz", "test": "Test",
               "exam": "Exam", "study": "Study", "other": "Other"}
STATUS_WORDS = {"not_started": "not started", "in_progress": "in progress", "done": "done", "cancelled": "cancelled"}
ISSUE_KIND_LABELS = {"ambiguity": "Ambiguous", "conflict": "Conflict", "missing_information": "Missing information",
                     "workload": "Workload", "other": "Note"}
PRIORITY_RANK = {"urgent": 0, "high": 1, "medium": 2, "low": 3}
SOURCE_STATE_WORDS = {"withdrawn": "withdrawn by teacher", "missing": "no longer in source"}
ROOT_COLLECTIONS = ("classes", "assignments", "events", "availability", "scheduleBlocks")
# Agenda layout: "  " + time column (17 = "10:00 AM-11:00 AM") + 3 spaces, then the text.
TIME_COL = 20
TEXT_COL = 2 + TIME_COL
# Narrower than this, agenda rows put the time on its own line and the text under it.
NARROW_WIDTH = 60
# Free gaps shorter than this are not listed as "Available" (the website's agenda rule).
MIN_GAP_MINUTES = 15
MARKER_ORDER = {"assessment": 0, "due": 1, "recommended": 2}

# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

ASCII_REPLACEMENTS = {
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "‘": "'", "’": "'", "‚": ",", "‛": "'", "′": "'", "´": "'", "ʼ": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "«": '"', "»": '"',
    "‹": "<", "›": ">", "…": "...", "·": "-", "•": "*", "‣": ">", "●": "*",
    "◦": "o", "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "─": "-", "━": "-",
    "│": "|", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "×": "x", "÷": "/",
    "⁄": "/", "∕": "/", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "±": "+/-",
    "©": "(c)", "®": "(R)", "™": "(TM)", "°": " deg", "€": "EUR", "£": "GBP",
    "¥": "JPY", "¢": "c", "§": "S", "¶": "P", "ß": "ss", "æ": "ae", "Æ": "AE",
    "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ł": "l",
    "Ł": "L", "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D", "ı": "i", "¿": "?",
    "¡": "!", " ": " ",
}

_BACKTICKS = re.compile(r"`{3,}")
_SPACES = re.compile(r"\s+")


def clean(value: Any) -> str:
    """Data text as one safe line: no control or format characters (bidi overrides, zero-width
    characters, ANSI escapes), whitespace collapsed, and no ``` run that could close the chat's
    code fence."""
    out = []
    for ch in str(value):
        category = unicodedata.category(ch)
        if category in ("Zs", "Zl", "Zp") or ch in "\t\n\r\x0b\x0c":
            out.append(" ")
        elif category[0] == "C":  # Cc, Cf, Cs, Co, Cn
            continue
        else:
            out.append(ch)
    text = _SPACES.sub(" ", "".join(out)).strip()
    return _BACKTICKS.sub(lambda m: "'" * len(m.group(0)), text)


def to_ascii(text: str) -> str:
    """Transliterate to printable ASCII (accents dropped, typographic punctuation replaced, '?' otherwise)."""
    if all(ord(ch) < 128 for ch in text):
        return text
    out = []
    for ch in text:
        if ord(ch) < 128:
            out.append(ch)
        elif ch in ASCII_REPLACEMENTS:
            out.append(ASCII_REPLACEMENTS[ch])
        else:
            parts = []
            for c in unicodedata.normalize("NFKD", ch):
                if ord(c) < 128:
                    parts.append(c)
                elif c in ASCII_REPLACEMENTS:
                    parts.append(ASCII_REPLACEMENTS[c])
                elif not unicodedata.combining(c):
                    parts.append("?")
            out.append("".join(parts) or "?")
    return "".join(out)


def text_key(value: str) -> List[Tuple[int, int, str]]:
    """Case- and accent-insensitive natural sort key ('Unit 2' before 'Unit 10')."""
    s = "".join(c for c in unicodedata.normalize("NFKD", value) if not unicodedata.combining(c)).casefold()
    return [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in re.split(r"(\d+)", s) if p]


class Glyphs:
    def __init__(self, ascii_only: bool) -> None:
        self.ascii = ascii_only
        self.range = "-" if ascii_only else "–"   # 4:00 PM-4:45 PM
        self.rule = "-" if ascii_only else "─"    # section rules, "---- Available"
        self.check = "[x]" if ascii_only else "✓"
        self.todo = "[ ]" if ascii_only else "-"
        self.dot = "|" if ascii_only else "·"     # list separator
        self.dash = "-" if ascii_only else "—"    # assignment - task


# ---------------------------------------------------------------------------
# Durations, dates and times
# ---------------------------------------------------------------------------

def dur(minutes: Optional[int]) -> str:
    """'0m', '45m', '2h', '2h 30m'."""
    if minutes is None:
        return "?"
    h, m = divmod(max(0, int(minutes)), 60)
    if h and m:
        return "%dh %dm" % (h, m)
    if h:
        return "%dh" % h
    return "%dm" % m


def weekday_index(date: str) -> int:
    """0 = Monday ... 6 = Sunday (1970-01-01 was a Thursday)."""
    return (V.day_number(date) + 3) % 7


def clock(minutes: int) -> str:
    """'4:30 PM'; 1440 (midnight at the end of the day) is '12:00 AM', as in the website."""
    h = (minutes // 60) % 24
    return "%d:%02d %s" % (h % 12 or 12, minutes % 60, "AM" if h < 12 else "PM")


def clock_of(hhmm: str) -> str:
    return clock(V.time_to_minutes(hhmm))


def time_of(value: str) -> Optional[str]:
    """'HH:MM' of a LocalDateTime, None for a Date."""
    return value[11:16] if len(value) > 10 else None


# ---------------------------------------------------------------------------
# Making an invalid file renderable (--force)
# ---------------------------------------------------------------------------

_PATH_TOKEN = re.compile(r'\.?([A-Za-z_$][A-Za-z0-9_$-]*)|\[([0-9]+)\]|\[("(?:[^"\\]|\\.)*")\]')


def parse_path(path: str) -> Optional[List[Any]]:
    """'assignments[3].tasks[0].due' -> ['assignments', 3, 'tasks', 0, 'due'] (the validator's path syntax)."""
    tokens: List[Any] = []
    pos = 0
    while pos < len(path):
        m = _PATH_TOKEN.match(path, pos)
        if not m or m.end() == pos:
            return None
        if m.group(1) is not None:
            tokens.append(m.group(1))
        elif m.group(2) is not None:
            tokens.append(int(m.group(2)))
        else:
            try:
                tokens.append(json.loads(m.group(3)))
            except ValueError:
                return None
        pos = m.end()
    return tokens


def _locate(root: Any, tokens: List[Any]) -> Tuple[List[Tuple[Any, Any]], bool]:
    """(container, key) pairs along the path as far as it exists, and whether all of it exists."""
    steps: List[Tuple[Any, Any]] = []
    current = root
    for token in tokens:
        if isinstance(token, int):
            if not isinstance(current, list) or token >= len(current):
                return steps, False
        elif not isinstance(current, dict) or token not in current:
            return steps, False
        steps.append((current, token))
        current = current[token]
    return steps, True


def prune_until_valid(data: Dict[str, Any], today: Optional[str]) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, str]]]:
    """Leave out the invalid parts of a parsed file until the rest is valid.

    Each validation error names a path. An existing optional value there is removed; a missing
    required value removes the object that needs it (an array entry is removed from its array);
    a broken root collection becomes empty. Returns the valid, normalized document (or None when
    nothing can be shown) and the errors that were handled this way."""
    work = copy.deepcopy(data)
    handled: List[Dict[str, str]] = []
    for _round in range(MAX_PRUNE_ROUNDS):
        result = V.validate_document(work, today=today)
        if result.ok:
            return result.doc, handled
        dict_deletions: List[Tuple[dict, str]] = []
        list_removals: Dict[int, Tuple[list, set]] = {}
        changed = False
        for error in result.errors:
            tokens = parse_path(error.get("path") or "")
            if not tokens:
                return None, handled + [error]
            if tokens == ["schemaVersion"]:
                if work.get("schemaVersion") != V.SUPPORTED:
                    work["schemaVersion"] = V.SUPPORTED
                    handled.append(error)
                    changed = True
                continue
            if len(tokens) == 1 and tokens[0] in ROOT_COLLECTIONS:
                if work.get(tokens[0]) != []:
                    work[tokens[0]] = []  # a missing or broken collection becomes empty
                    changed = True
                handled.append(error)
                continue
            # The path exists: remove the bad value. Part of it is missing (a required value):
            # remove the deepest object that exists, i.e. the object that needs the value.
            steps, _complete = _locate(work, tokens)
            if not steps:
                return None, handled + [error]
            container, key = steps[-1]
            if len(steps) == 1 and key in ROOT_COLLECTIONS:
                if work.get(key) != []:
                    work[key] = []
                    changed = True
                handled.append(error)
            elif isinstance(key, int):
                list_removals.setdefault(id(container), (container, set()))[1].add(key)
                handled.append(error)
            else:
                dict_deletions.append((container, key))
                handled.append(error)
        for container, key in dict_deletions:
            if key in container:
                del container[key]
                changed = True
        for container, indexes in list_removals.values():
            for index in sorted(indexes, reverse=True):
                if index < len(container):
                    del container[index]
                    changed = True
        if not changed:
            return None, handled
    return None, handled


def load_schedule(path: str, force: bool) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, str]], List[Dict[str, str]]]:
    """(document, validation errors, errors handled by --force). The document is None when it cannot be shown."""
    result = V.validate_file(path)
    if result.ok:
        return result.doc, [], []
    if not force or result.stage in ("json", "root") or any(e.get("code") == "read" for e in result.errors):
        return None, result.errors, []
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_FORCE_BYTES + 1)
        if len(raw) > MAX_FORCE_BYTES:
            return None, result.errors, []
        data = json.loads(raw.decode("utf-8-sig"))
    except (OSError, ValueError, RecursionError):
        return None, result.errors, []
    if not isinstance(data, dict):
        return None, result.errors, []
    doc, handled = prune_until_valid(data, None)
    if doc is None:
        return None, result.errors, []
    return doc, result.errors, handled


# ---------------------------------------------------------------------------
# The view
# ---------------------------------------------------------------------------

class Renderer:
    def __init__(self, doc: Dict[str, Any], now: str, start: str, end: str, width: int = DEFAULT_WIDTH,
                 include_done: bool = False, include_notes: bool = False, descriptions: bool = True,
                 ascii_only: bool = False) -> None:
        self.doc = doc
        self.now = now
        self.now_min = V.ldt_to_minutes(now)
        self.today = now[:10]
        self.year = int(now[:4])
        self.start = start
        self.end = end
        self.width = width
        self.include_done = include_done
        self.include_notes = include_notes
        self.descriptions = descriptions
        self.g = Glyphs(ascii_only)
        self.text_col = TEXT_COL if width >= NARROW_WIDTH else 4
        self.m = R.Model(doc, now)
        self.settings = self.m.settings
        self.progress = {a["id"]: self.m.progress(a) for a in self.m.assignments}
        self.lines: List[str] = []

    # -- output -----------------------------------------------------------------
    def enc(self, text: str) -> str:
        return to_ascii(text) if self.g.ascii else text

    def _wrap(self, text: str, first: str, rest: str) -> List[str]:
        return textwrap.wrap(text, width=self.width, initial_indent=first, subsequent_indent=rest,
                             break_long_words=True, break_on_hyphens=False) or [first.rstrip()]

    def emit(self, text: str = "", indent: int = 0, hang: Optional[int] = None) -> None:
        """One logical line, wrapped to the width; continuation lines are indented by `hang`."""
        text = self.enc(text)
        if not text.strip():
            self.lines.append("")
            return
        self.lines.extend(self._wrap(text, " " * indent, " " * (indent if hang is None else hang)))

    def emit_row(self, left: str, text: str) -> None:
        """An agenda row: the time in a fixed-width column and the text wrapping under itself; below
        NARROW_WIDTH the time gets its own line and the text goes under it."""
        if self.text_col != TEXT_COL:
            self.lines.append("  " + self.enc(left))
            self.lines.extend(self._wrap(self.enc(text), " " * self.text_col, " " * self.text_col))
            return
        prefix = "  " + self.enc(left).ljust(TIME_COL)
        self.lines.extend(self._wrap(self.enc(text), prefix, " " * TEXT_COL))

    def emit_segments(self, segments: Sequence[Tuple[str, str]], indent: int, hang: int) -> None:
        """Segments (separator, text) on as few lines as possible, breaking between segments first."""
        lines: List[str] = []
        current = " " * indent
        for sep, seg in segments:
            seg = self.enc(seg)
            if not current.strip():  # the first segment starts at `indent`, even when it must wrap
                wrapped = self._wrap(seg, current, " " * hang)
                lines.extend(wrapped[:-1])
                current = wrapped[-1]
                continue
            sep = self.enc(sep)
            if len(current) + len(sep) + len(seg) <= self.width:
                current += sep + seg
                continue
            lines.append(current.rstrip())
            if hang + len(seg) <= self.width:
                current = " " * hang + seg
            else:
                wrapped = self._wrap(seg, " " * hang, " " * hang)
                lines.extend(wrapped[:-1])
                current = wrapped[-1]
        if current.strip():
            lines.append(current.rstrip())
        self.lines.extend(lines)

    def heading(self, title: str) -> None:
        if self.lines and self.lines[-1] != "":
            self.lines.append("")
        head = self.enc("%s %s " % (self.g.rule * 2, title))
        self.lines.append(head + self.g.rule * max(0, self.width - len(head)))

    # -- dates ------------------------------------------------------------------
    def year_suffix(self, date: str, always: bool = False) -> str:
        return ", %s" % date[:4] if always or int(date[:4]) != self.year else ""

    def day_long(self, date: str) -> str:
        """'Tuesday, October 13' (with the year when it is not the year of now)."""
        return "%s, %s %d%s" % (WEEKDAY_NAMES[weekday_index(date)], MONTH_NAMES[int(date[5:7]) - 1],
                                int(date[8:10]), self.year_suffix(date))

    def day_short(self, date: str, always_year: bool = False, no_year: bool = False) -> str:
        """'Tue, Oct 13' (with the year when it is not the year of now, or when asked)."""
        return "%s, %s %d%s" % (WEEKDAY_NAMES[weekday_index(date)][:3], MONTH_NAMES[int(date[5:7]) - 1][:3],
                                int(date[8:10]), "" if no_year else self.year_suffix(date, always_year))

    def month_day(self, date: str) -> str:
        """'Oct 13'."""
        return "%s %d%s" % (MONTH_NAMES[int(date[5:7]) - 1][:3], int(date[8:10]), self.year_suffix(date))

    def when(self, value: str, always_year: bool = False) -> str:
        """'Fri, Oct 16, 11:59 PM', or 'Fri, Oct 16' for a date-only value (no time is shown)."""
        text = self.day_short(value[:10], always_year)
        t = time_of(value)
        return "%s, %s" % (text, clock_of(t)) if t else text

    def span(self, start: int, end: int) -> str:
        return "%s%s%s" % (clock(start), self.g.range, clock(end))

    def range_text(self) -> str:
        if self.start == self.end:
            return self.day_short(self.start, True)
        if self.start[:4] == self.end[:4]:  # 'Sun, Oct 11 - Sat, Oct 17, 2026'
            return "%s %s %s" % (self.day_short(self.start, no_year=True), self.g.range, self.day_short(self.end, True))
        return "%s %s %s" % (self.day_short(self.start, True), self.g.range, self.day_short(self.end, True))

    # -- labels -----------------------------------------------------------------
    def class_name(self, a: Optional[Dict[str, Any]]) -> Optional[str]:
        if a is None:
            return None
        c = self.m.classes.get(a.get("classId") or "")
        return clean(c["name"]) if c else None

    def assignment_label(self, a: Dict[str, Any]) -> str:
        """'English 10 / Othello Essay', or the title alone for work without a class."""
        name = self.class_name(a)
        return "%s / %s" % (name, clean(a["title"])) if name else clean(a["title"])

    def task_label(self, a: Dict[str, Any], t: Dict[str, Any]) -> str:
        return "%s %s %s" % (self.assignment_label(a), self.g.dash, clean(t["title"]))

    @staticmethod
    def assessment_label(a: Dict[str, Any]) -> str:
        t = a.get("type")
        return TYPE_LABELS[t] if t in ASSESSMENT_TYPES else "Assessment"

    def block_parts(self, b: Dict[str, Any]) -> Dict[str, Any]:
        """The website's block label: 'Class / work title' (work title = the block's own title, else the
        assignment's, else the task's) and the task title when it is something else."""
        is_break = b.get("kind") == "break"
        a = None if is_break else self.m.by_id.get(b.get("assignmentId") or "")
        task = None
        if a is not None and b.get("taskId"):
            task = next((t for t in R.lst(a.get("tasks")) if t.get("id") == b["taskId"]), None)
        own = clean(b.get("title") or "")
        if is_break:
            work_title = own or "Break"
        else:
            work_title = own or (clean(a["title"]) if a else "") or (clean(task["title"]) if task else "") or "Untitled block"
        name = None if is_break else self.class_name(a)
        label = "%s / %s" % (name, work_title) if name else work_title
        task_title = clean(task["title"]) if task else None
        full = label + (" %s %s" % (self.g.dash, task_title) if task_title and task_title != work_title else "")
        return {"isBreak": is_break, "assignment": a, "task": task, "label": label, "full": full}

    def item_label(self, item_id: Optional[str]) -> Optional[str]:
        """A readable name for any item (tasks included), for issues."""
        if not item_id:
            return None
        if item_id in self.m.classes:
            return "Class %s" % clean(self.m.classes[item_id]["name"])
        if item_id in self.m.by_id:
            return self.assignment_label(self.m.by_id[item_id])
        if item_id in self.m.tasks:
            t, a = self.m.tasks[item_id]
            return self.task_label(a, t)
        for e in self.m.events:
            if e["id"] == item_id:
                return clean(e["title"]) + (" (%s)" % self.day_short(e["date"]) if e.get("date") else "")
        for w in self.m.availability:
            if w["id"] == item_id:
                return "Study time %s" % clean(w.get("label") or "") if w.get("label") else "Study time"
        for b in self.m.blocks:
            if b["id"] == item_id:
                return "%s (%s)" % (self.block_parts(b)["full"], self.when(b["start"]))
        return item_id

    # -- one day (the website's day model, src/lib/calendar.ts) -------------------
    def occurrences(self, date: str) -> List[Dict[str, Any]]:
        out = []
        for e in self.m.events:
            if not V.event_occurs_on(e, date):
                continue
            occ = {"event": e, "busy": e.get("busy") is not False,
                   "assignment": self.m.by_id.get(e.get("assignmentId") or ""), "span": None}
            if e.get("allDay") is True:
                occ.update(allDay=True, start=None, end=None)
                if not isinstance(e.get("recurrence"), dict) and e.get("date") and e.get("endDate") and e["endDate"] > e["date"]:
                    occ["span"] = (e["date"], e["endDate"])
            else:
                s, t = V.time_to_minutes(e["startTime"]), V.time_to_minutes(e["endTime"])
                if t <= s:
                    continue
                occ.update(allDay=False, start=s, end=t)
            out.append(occ)
        return out

    def late_reason(self, end_abs: int, a: Dict[str, Any], task: Optional[Dict[str, Any]]) -> Optional[str]:
        """Why a session ends too late (section 13.4), as the website words it."""
        due_time = self.settings["defaultDueTime"]
        for value, what in ((a.get("due"), "due"), (task.get("due") if task else None, "task")):
            if not value or end_abs <= V.ldt_to_minutes(V.due_moment(value, due_time)):
                continue
            date_only = V.is_date_only(value)
            note = " %s no time given, so it counts as due at %s" % (self.g.dash, clock_of(due_time)) if date_only else ""
            if what == "due":
                return "ends after the due %s (%s%s)" % ("date" if date_only else "time", self.when(value), note)
            return 'ends after the deadline of "%s" (%s%s)' % (clean(task["title"]), self.when(value), note)  # type: ignore[index]
        if a.get("assessmentDate") and end_abs > V.ldt_to_minutes(V.start_of_day_moment(a["assessmentDate"])):
            return "ends after the %s (%s)" % (self.assessment_label(a).lower(), self.when(a["assessmentDate"]))
        return None

    def block_views(self, date: str, occurrences: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        base = V.day_number(date) * 1440
        views = []
        for b in self.m.blocks:
            if b["start"][:10] != date:
                continue
            start_abs, end_abs = V.ldt_to_minutes(b["start"]), V.ldt_to_minutes(b["end"])
            start = start_abs - base
            parts = self.block_parts(b)
            status = b.get("status", "planned")
            late = None
            if not parts["isBreak"] and parts["assignment"] is not None and status != "skipped":
                late = self.late_reason(end_abs, parts["assignment"], parts["task"])
            views.append(dict(parts, block=b, status=status, start=start, end=min(1440, max(end_abs - base, start)),
                              endAbs=end_abs, minutes=max(0, end_abs - start_abs), late=late, conflicts=[]))
        views.sort(key=lambda v: (v["start"], v["end"], v["block"]["id"]))
        busy = [o for o in occurrences if o["busy"]]
        for v in views:
            if v["status"] == "skipped":
                continue  # a skipped session did not happen, so it conflicts with nothing
            s, e = v["start"], max(v["end"], v["start"] + 1)
            names: List[str] = []
            for o in busy:
                os_, oe = (0, 1440) if o["allDay"] else (o["start"], o["end"])
                if s < oe and os_ < e:
                    names.append(clean(o["event"]["title"]))
            for other in views:
                if other is v or other["status"] == "skipped":
                    continue
                if s < max(other["end"], other["start"] + 1) and other["start"] < e:
                    names.append(other["label"])
            v["conflicts"] = list(dict.fromkeys(names))
        return views

    def markers(self, date: str, occurrences: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Due dates, assessments, recommended completion dates and task checkpoints on the day."""
        out = []
        for a in self.m.assignments:
            closed = a.get("status") in ("done", "cancelled")
            for kind, key in (("due", "due"), ("assessment", "assessmentDate"), ("recommended", "recommendedCompletionDate")):
                value = a.get(key)
                if not value or value[:10] != date:
                    continue
                sitting = None
                if kind == "assessment":
                    sitting = next((o for o in occurrences if o["event"].get("assignmentId") == a["id"]), None)
                out.append({"a": a, "task": None, "kind": kind, "time": time_of(value), "closed": closed, "sitting": sitting})
            for t in R.lst(a.get("tasks")):
                if t.get("status") == "cancelled" or not t.get("due") or t["due"][:10] != date:
                    continue
                out.append({"a": a, "task": t, "kind": "due", "time": time_of(t["due"]),
                            "closed": closed or t.get("status") == "done", "sitting": None})
        out.sort(key=lambda mk: (MARKER_ORDER[mk["kind"]], -1 if mk["time"] is None else V.time_to_minutes(mk["time"]),
                                 1 if mk["task"] else 0, mk["a"]["title"], mk["a"]["id"],
                                 mk["task"]["id"] if mk["task"] else ""))
        return out

    def day_issues(self, date: str) -> List[Tuple[Dict[str, Any], Optional[str]]]:
        found = []
        for issue in R.lst(self.doc.get("issues")):
            if issue.get("date") == date:
                found.append((issue, self.item_label(issue.get("itemId"))))
        for collection in ROOT_COLLECTIONS:
            for item in R.lst(self.doc.get(collection)):
                for issue in R.lst(item.get("issues")):
                    if issue.get("date") == date:
                        found.append((issue, self.item_label(item.get("id"))))
        return [x for x in found if self.include_done or x[0].get("status", "open") == "open"]

    def day_model(self, date: str) -> Dict[str, Any]:
        occurrences = self.occurrences(date)
        timed = sorted((o for o in occurrences if not o["allDay"]),
                       key=lambda o: (o["start"], o["end"], o["event"]["title"], o["event"]["id"]))
        defined = bool(self.m.availability)
        free = (self.m.free(date) or []) if defined else []
        blocks = self.block_views(date, occurrences)
        work = [v for v in blocks if not v["isBreak"] and v["status"] != "skipped"]
        planned = sum(v["minutes"] for v in work)
        done = sum(v["minutes"] for v in work if v["status"] == "done")
        free_minutes = R.total(free)
        limit = self.settings["maxDailyStudyMinutes"]
        planner_work = any(v["block"].get("origin", "generated") != "user" and v["block"].get("locked") is not True for v in work)
        return {
            "date": date, "timed": timed, "allDay": [o for o in occurrences if o["allDay"]], "defined": defined,
            "free": free, "freeMinutes": free_minutes, "blocks": blocks, "planned": planned, "done": done,
            "overFree": defined and planned > free_minutes,
            "overMax": defined and limit is not None and planned > limit and planner_work,
            "limit": limit, "markers": self.markers(date, occurrences),
        }

    # -- markers in words ---------------------------------------------------------
    def marker_notes(self, mk: Dict[str, Any]) -> List[str]:
        a, t = mk["a"], mk["task"]
        notes = []
        if t is not None and t.get("status") == "done":
            notes.append("done")
        elif a.get("status") in ("done", "cancelled"):
            notes.append(STATUS_WORDS[a["status"]])
        if a.get("sourceState") in SOURCE_STATE_WORDS:
            notes.append(SOURCE_STATE_WORDS[a["sourceState"]])
        elif a.get("required") is False or (t is not None and t.get("required") is False):
            notes.append("optional")
        return notes

    def marker_head(self, mk: Dict[str, Any]) -> str:
        if mk["kind"] == "due":
            return "Checkpoint due" if mk["task"] else "Due"
        if mk["kind"] == "assessment":
            return self.assessment_label(mk["a"])
        return "Aim to finish"

    def marker_subject(self, mk: Dict[str, Any]) -> str:
        return self.task_label(mk["a"], mk["task"]) if mk["task"] else self.assignment_label(mk["a"])

    def marker_line(self, mk: Dict[str, Any]) -> str:
        """'Due today: English 10 / Othello Essay (11:59 PM)'; a date-only value shows no time."""
        extras = []
        if mk["time"]:
            extras.append(("by " if mk["kind"] == "recommended" else "") + clock_of(mk["time"]))
        extras.extend(self.marker_notes(mk))
        return "%s today: %s%s" % (self.marker_head(mk), self.marker_subject(mk), " (%s)" % "; ".join(extras) if extras else "")

    def marker_short(self, mk: Dict[str, Any]) -> str:
        notes = self.marker_notes(mk)
        return "%s: %s%s" % (self.marker_head(mk), self.marker_subject(mk), " (%s)" % "; ".join(notes) if notes else "")

    # -- parts ------------------------------------------------------------------
    def render_header(self, with_range: bool) -> None:
        meta = self.doc.get("meta") if isinstance(self.doc.get("meta"), dict) else {}
        self.emit(clean(meta.get("title") or "") or "Schedule")
        if with_range:
            self.emit(self.range_text())
        generated = meta.get("generatedAt")
        zone = clean(meta.get("timezone") or "")
        line = "Generated %s" % self.when(generated, True) if generated else "Generation time not recorded"
        self.emit("%s (%s)" % (line, zone or "time zone not recorded"))
        if not generated or V.ldt_to_minutes(generated) != self.now_min:
            self.emit("Shown as of %s" % self.when(self.now, True))

    def dates(self) -> List[str]:
        out, date = [], self.start
        while date <= self.end:
            out.append(date)
            date = V.add_days(date, 1)
        return out

    def render_week(self) -> None:
        self.heading("Week overview")
        if not self.m.availability:
            self.emit("Study time not provided: free time and overload are not shown.", 0, 2)
        for date in self.dates():
            model = self.day_model(date)
            free = dur(model["freeMinutes"]) if model["defined"] else "n/a"
            columns = "%s %s %2d  free %-7s  planned %s" % (
                WEEKDAY_NAMES[weekday_index(date)][:3], MONTH_NAMES[int(date[5:7]) - 1][:3], int(date[8:10]),
                free, dur(model["planned"]))
            segments: List[Tuple[str, str]] = [("", columns)]
            # What follows the columns starts in the same column on every day ("planned" is 7 wide).
            gap = " " * (2 + max(0, 7 - len(dur(model["planned"]))))
            if model["overFree"]:
                segments.append((gap, "! over free time by %s" % dur(model["planned"] - model["freeMinutes"])))
            if model["overMax"]:
                segments.append((gap if len(segments) == 1 else "  ", "! over daily limit by %s" % dur(model["planned"] - model["limit"])))
            items = ["All day: %s%s" % (clean(o["event"]["title"]), "" if o["busy"] else " (not busy)") for o in model["allDay"]]
            items += [self.marker_short(mk) for mk in model["markers"] if mk["kind"] != "recommended"]
            for i, item in enumerate(items):
                segments.append(((gap if len(segments) == 1 else "  ") if i == 0 else " %s " % self.g.dot, item))
            self.emit_segments(segments, 0, 12)

    def render_day(self, date: str, issues_listed: bool) -> None:
        model = self.day_model(date)
        self.emit("%s%s" % (self.day_long(date), " (today)" if date == self.today else ""))
        for o in model["allDay"]:
            span = " (%s%s%s)" % (self.month_day(o["span"][0]), self.g.range, self.month_day(o["span"][1])) if o["span"] else ""
            self.emit_row("All day", self.event_text(o, span))
        entries: List[Tuple[int, int, int, int, str, Any]] = []
        for o in model["timed"]:
            entries.append((o["start"], 0, o["end"], len(entries), "event", o))
        for v in model["blocks"]:
            entries.append((v["start"], 1, v["end"], len(entries), "block", v))
        if model["defined"]:
            used = [(v["start"], max(v["end"], v["start"] + 1)) for v in model["blocks"] if v["status"] != "skipped"]
            for s, e in R.subtract(model["free"], used):
                if e - s >= MIN_GAP_MINUTES:
                    entries.append((s, 2, e, len(entries), "available", None))
        entries.sort(key=lambda x: x[:4])
        if not entries and not model["allDay"]:
            self.emit("Nothing scheduled at a set time.", 2)
        for start, _order, end, _i, kind, item in entries:
            if kind == "event":
                self.emit_row(self.span(start, end), self.event_text(item, ""))
            elif kind == "available":
                self.emit_row(clock(start), "%s Available until %s" % (self.g.rule * 4, clock(end)))
            else:
                self.render_block(item)
        for mk in model["markers"]:
            if mk["sitting"] is None:  # an assessment with a sitting event is shown by that event
                self.emit(self.marker_line(mk), 2, 4)
        for issue, about in self.day_issues(date):
            kind = ISSUE_KIND_LABELS.get(issue.get("kind"), "Note")
            status = "" if issue.get("status", "open") == "open" else " (%s)" % issue["status"]
            if issues_listed:
                self.emit("! %s issue about this day%s: see Open issues below" % (kind, status), 2, 4)
            else:
                self.emit("! %s%s: %s" % (kind, status, clean(issue.get("message") or "")), 2, 4)
        parts = []
        if model["defined"]:
            parts.append("Free %s" % dur(model["freeMinutes"]))
        parts.append("Planned %s%s" % (dur(model["planned"]), " (%s done)" % dur(model["done"]) if model["done"] else ""))
        if not model["defined"]:
            parts.append("study time not provided")
        self.emit_segments([("" if i == 0 else " %s " % self.g.dot, p) for i, p in enumerate(parts)], 2, 4)
        if model["overFree"]:
            self.emit("! Over capacity: %s of work planned but only %s of free study time (%s too much)" % (
                dur(model["planned"]), dur(model["freeMinutes"]), dur(model["planned"] - model["freeMinutes"])), 2, 4)
        if model["overMax"]:
            self.emit("! Above your daily limit: %s planned, limit %s (%s over)" % (
                dur(model["planned"]), dur(model["limit"]), dur(model["planned"] - model["limit"])), 2, 4)

    def event_text(self, o: Dict[str, Any], span: str) -> str:
        e = o["event"]
        text = clean(e["title"]) + span + ("" if o["busy"] else " (not busy)")
        if e.get("location"):
            text += " %s %s" % (self.g.dot, clean(e["location"]))
        if o["assignment"] is not None:
            text += " %s %s: %s" % (self.g.dot, self.assessment_label(o["assignment"]), self.assignment_label(o["assignment"]))
        if self.include_notes and e.get("notes"):
            text += " %s Your notes: %s" % (self.g.dot, clean(e["notes"]))
        return text

    def render_block(self, v: Dict[str, Any]) -> None:
        flags = []
        if v["status"] == "done":
            flags.append("%s done" % self.g.check)
        elif v["status"] == "skipped":
            flags.append("skipped")
        elif not v["isBreak"] and v["endAbs"] <= self.now_min:
            flags.append("past, not marked done")
        if v["block"].get("locked") is True:
            flags.append("pinned")
        text = v["full"] + ("   " + (" %s " % self.g.dot).join(flags) if flags else "")
        self.emit_row(self.span(v["start"], v["end"]), text)
        if v["conflicts"]:
            self.emit("! Conflict: overlaps %s" % ", ".join(v["conflicts"]), self.text_col, self.text_col + 2)
        if v["late"]:
            self.emit("! Late: %s" % v["late"], self.text_col, self.text_col + 2)
        if self.descriptions and v["block"].get("description"):
            self.emit(clean(v["block"]["description"]), self.text_col + 2)
        if self.include_notes and v["block"].get("notes"):
            self.emit("Your notes: %s" % clean(v["block"]["notes"]), self.text_col + 2)

    def render_days(self, issues_listed: bool) -> None:
        self.heading("Day by day")
        for i, date in enumerate(self.dates()):
            if i:
                self.lines.append("")
            self.render_day(date, issues_listed)

    # -- assignments ------------------------------------------------------------------
    def passed(self, value: Optional[str]) -> bool:
        """A date-time has passed once now is later than it; a date-only value once its whole day is over."""
        if not value:
            return False
        moment = value if len(value) > 10 else value + "T23:59:00"
        return self.now_min > V.ldt_to_minutes(moment)

    def assignment_issue_count(self, a: Dict[str, Any]) -> int:
        """Open issues about the assignment: its own, its tasks', its sessions' and sitting events', and root
        issues about any of them (as the website counts them)."""
        related = {a["id"]} | {t["id"] for t in R.lst(a.get("tasks"))}
        holders = [a] + R.lst(a.get("tasks"))
        for b in self.m.blocks_of.get(a["id"], []):
            related.add(b["id"])
            holders.append(b)
        for e in self.m.events:
            if e.get("assignmentId") == a["id"]:
                related.add(e["id"])
                holders.append(e)
        issues = [i for h in holders for i in R.lst(h.get("issues"))]
        issues += [i for i in R.lst(self.doc.get("issues")) if i.get("itemId") in related]
        return sum(1 for i in issues if i.get("status", "open") == "open")

    def render_assignments(self, issues_listed: bool) -> None:
        self.heading("Assignments")
        week_start = V.monday_of(self.today)
        if self.settings.get("weekStartsOn") == "sunday":
            week_start = V.add_days(self.today, -((weekday_index(self.today) + 1) % 7))
        week_end = V.add_days(week_start, 6)
        groups: Dict[str, List[Dict[str, Any]]] = {k: [] for k in ("overdue", "thisWeek", "later", "noDate", "past", "done")}
        totals = {"remaining": 0, "scheduled": 0, "unscheduled": 0, "count": 0, "unestimated": 0}
        for a in self.m.assignments:
            p = self.progress[a["id"]]
            counts = p["excluded"] is None
            dates = sorted(a[k][:10] for k in ("due", "assessmentDate") if a.get(k))
            deadline_date = dates[0] if dates else None
            if a.get("status") in ("done", "cancelled"):
                group = "done"
            elif counts and (self.passed(a.get("due")) or self.passed(a.get("assessmentDate"))):
                group = "overdue"
            elif deadline_date is None:
                group = "noDate"
            elif deadline_date < self.today:
                group = "past"
            elif deadline_date <= week_end:
                group = "thisWeek"
            else:
                group = "later"
            groups[group].append(a)
            if counts:
                totals["count"] += 1
                remaining = p["remaining"]
                totals["remaining"] += remaining or 0
                totals["scheduled"] += p["scheduled"] if remaining is None else min(p["scheduled"], remaining)
                totals["unscheduled"] += p["unscheduled"] or 0
                totals["unestimated"] += 1 if remaining is None else 0
        if not self.m.assignments:
            self.emit("No assignments.")
            return
        summary = [("", "Remaining %s" % dur(totals["remaining"])), (" %s " % self.g.dot, "scheduled %s" % dur(totals["scheduled"])),
                   (" %s " % self.g.dot, "unscheduled %s" % dur(totals["unscheduled"])),
                   (" ", "(%d assignment%s counted)" % (totals["count"], "" if totals["count"] == 1 else "s"))]
        if totals["unestimated"]:
            summary.append((" %s " % self.g.dot, "%d without an estimate" % totals["unestimated"]))
        self.emit_segments(summary, 0, 2)
        labels = {
            "overdue": "Overdue",
            "thisWeek": "This week (through %s)" % self.day_short(week_end),
            "later": "Later (after %s)" % self.day_short(week_end),
            "noDate": "No date",
            "past": "Past, not counted",
            "done": "Done or cancelled",
        }
        for key in ("overdue", "thisWeek", "later", "noDate", "past", "done"):
            rows = groups[key]
            if not rows or (key == "done" and not self.include_done):
                continue
            rows.sort(key=self.row_key)
            if key == "done":
                rows.sort(key=lambda a: -(self.m.deadline(a) if self.m.deadline(a) is not None else -10 ** 12))
            self.lines.append("")
            self.emit(labels[key])
            for a in rows:
                self.render_assignment(a, issues_listed)
        hidden = len(groups["done"])
        if hidden and not self.include_done:
            self.lines.append("")
            self.emit("%d done or cancelled assignment%s not shown." % (hidden, "" if hidden == 1 else "s"))

    def row_key(self, a: Dict[str, Any]) -> Tuple[Any, ...]:
        deadline = self.m.deadline(a)
        return (deadline if deadline is not None else float("inf"), PRIORITY_RANK.get(a.get("priority", "medium"), 2),
                text_key(a["title"]), a["id"])

    def render_assignment(self, a: Dict[str, Any], issues_listed: bool) -> None:
        p = self.progress[a["id"]]
        dot = " %s " % self.g.dot
        self.emit(self.assignment_label(a), 2, 4)
        info = [TYPE_LABELS.get(a.get("type", "homework"), "Other"), STATUS_WORDS[a.get("status", "not_started")]]
        if a.get("priority", "medium") != "medium":
            info.append("urgent" if a["priority"] == "urgent" else "%s priority" % a["priority"])
        if a.get("required") is False:
            info.append("optional")
        if a.get("sourceState") in SOURCE_STATE_WORDS:
            info.append(SOURCE_STATE_WORDS[a["sourceState"]])
        if p["excluded"] in ("optional", "missing", "withdrawn"):
            info.append("not counted")
        self.emit_segments([("" if i == 0 else dot, s) for i, s in enumerate(info)], 4, 6)
        dates = []
        if a.get("due"):
            dates.append("Due %s" % self.when(a["due"]))
        if a.get("assessmentDate"):
            dates.append("%s %s" % (self.assessment_label(a), self.when(a["assessmentDate"])))
        if a.get("recommendedCompletionDate"):
            dates.append("aim to finish %s" % self.when(a["recommendedCompletionDate"]))
        if not a.get("due") and not a.get("assessmentDate"):
            dates.insert(0, "No due date")
        self.emit_segments([("" if i == 0 else dot, s) for i, s in enumerate(dates)], 4, 6)
        estimate = a.get("estimatedMinutes")
        live = [t["estimatedMinutes"] for t in R.lst(a.get("tasks"))
                if t.get("status") != "cancelled" and isinstance(t.get("estimatedMinutes"), int)]
        if estimate is None and live:
            estimate = sum(live)
        if estimate is None:
            work = ["No estimate"]
        else:
            rng = a.get("estimateRange")
            work = ["Estimate %s%s" % (dur(estimate), " (%s%s%s)" % (dur(rng["min"]), self.g.range, dur(rng["max"]))
                                        if isinstance(rng, dict) else "")]
        if p["excluded"] is not None:
            if p["excluded"] not in ("done", "cancelled"):
                work.append("not counted in remaining work")
        elif p["remaining"] is None:
            work.append("remaining unknown")
            work.append("scheduled %s" % dur(p["scheduled"]))
        else:
            work += ["remaining %s" % dur(p["remaining"]), "scheduled %s" % dur(p["scheduled"]),
                     "unscheduled %s" % dur(p["unscheduled"])]
        self.emit_segments([("" if i == 0 else dot, s) for i, s in enumerate(work)], 4, 6)
        count = self.assignment_issue_count(a)
        if count:
            self.emit("! %d open issue%s%s" % (count, "" if count == 1 else "s", " (see Open issues below)" if issues_listed else ""), 4, 6)
        if self.include_notes and a.get("notes"):
            self.emit("Your notes: %s" % clean(a["notes"]), 4, 6)
        tasks = [t for t in R.lst(a.get("tasks")) if self.include_done or t.get("status") != "cancelled"]
        if tasks:
            self.emit("Tasks:", 4)
            for t in tasks:
                mark = self.g.check if t.get("status") == "done" else self.g.todo
                parts = ["%s %s" % (mark, clean(t["title"])), STATUS_WORDS[t.get("status", "not_started")]]
                if isinstance(t.get("estimatedMinutes"), int):
                    parts.append(dur(t["estimatedMinutes"]))
                if t.get("required") is False:
                    parts.append("optional")
                if t.get("due"):
                    parts.append("checkpoint due %s" % self.when(t["due"]))
                if t.get("recommendedCompletionDate"):
                    parts.append("aim to finish %s" % self.when(t["recommendedCompletionDate"]))
                if self.include_notes and t.get("notes"):
                    parts.append("your notes: %s" % clean(t["notes"]))
                self.emit_segments([("" if i == 0 else dot, s) for i, s in enumerate(parts)], 6, 6 + len(mark) + 1)

    # -- issues ---------------------------------------------------------------------
    def issue_entries(self) -> List[Tuple[Dict[str, Any], Optional[str]]]:
        """Root issues, then the issues of every item and task, in file order."""
        out = [(i, self.item_label(i.get("itemId"))) for i in R.lst(self.doc.get("issues"))]
        for collection in ROOT_COLLECTIONS:
            for item in R.lst(self.doc.get(collection)):
                out += [(i, self.item_label(item["id"])) for i in R.lst(item.get("issues"))]
                if collection == "assignments":
                    for t in R.lst(item.get("tasks")):
                        out += [(i, self.item_label(t["id"])) for i in R.lst(t.get("issues"))]
        return out

    def render_issues(self) -> None:
        entries = [e for e in self.issue_entries() if self.include_done or e[0].get("status", "open") == "open"]
        self.heading("%s (%d)" % ("Issues" if self.include_done else "Open issues", len(entries)))
        if not entries:
            self.emit("No open issues.")
            return
        for issue, about in entries:
            head = [ISSUE_KIND_LABELS.get(issue.get("kind"), "Note")]
            if issue.get("status", "open") != "open":
                head.append(issue["status"])
            if about:
                head.append(about)
            if issue.get("date") and self.day_short(issue["date"]) not in (about or ""):
                head.append(self.day_short(issue["date"]))
            self.emit("- " + (" %s " % self.g.dot).join(head), 0, 2)
            self.emit(clean(issue.get("message") or ""), 2)

    # -- everything -------------------------------------------------------------------
    def render(self, view: str = "all", warnings: Sequence[str] = ()) -> str:
        self.lines = []
        for text in warnings:
            self.emit(text, 0, 4 if text.startswith("!   ") else 2)
        if warnings:
            self.lines.append("")
        with_days = view in ("all", "agenda", "week")
        self.render_header(with_days)
        issues_listed = view == "all"
        if view in ("all", "week"):
            self.render_week()
        if view in ("all", "agenda"):
            self.render_days(issues_listed)
        if view in ("all", "assignments"):
            self.render_assignments(issues_listed)
        if view in ("all", "issues"):
            self.render_issues()
        lines = [line.rstrip() for line in self.lines]
        if self.g.ascii:
            lines = [to_ascii(line) for line in lines]
        return "\n".join(lines).rstrip("\n") + "\n"


def force_warnings(handled: List[Dict[str, str]]) -> List[str]:
    """The lines shown above a forced view: what was left out of the invalid file."""
    lines = ["! THIS FILE IS NOT VALID, so the website will not import it. It is shown anyway (forced); "
             "these parts were left out or changed:"]
    seen = []
    for e in handled:
        text = "%s: %s" % (e.get("path") or "(root)", clean(e.get("message") or ""))
        if text not in seen:
            seen.append(text)
    for text in seen[:12]:
        lines.append("!   " + text)
    if len(seen) > 12:
        lines.append("!   ... and %d more" % (len(seen) - 12))
    lines.append("! Fix the file (validate_schedule.py lists every error) before relying on this view.")
    return lines


def render_text(doc: Dict[str, Any], now: str, start: str, end: str, view: str = "all", width: int = DEFAULT_WIDTH,
                include_done: bool = False, include_notes: bool = False, descriptions: bool = True,
                ascii_only: bool = False, warnings: Sequence[str] = ()) -> str:
    """The text view of a validated (normalized) document."""
    return Renderer(doc, now, start, end, width, include_done, include_notes, descriptions, ascii_only).render(view, warnings)


def normalize_now(value: str) -> Optional[str]:
    text = value + ":00" if len(value) == 16 else value
    if not V.LDT_RE.fullmatch(text) or not V.is_valid_date(text[:10]):
        return None
    return text[:16] + ":00"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Show a schedule file as plain text for a chat (paste it in a ```text block).")
    parser.add_argument("schedule", help="the schedule.json file")
    parser.add_argument("--from", dest="start", help="first day shown, YYYY-MM-DD (default: the day of --now)")
    span = parser.add_mutually_exclusive_group()
    span.add_argument("--days", type=int, help="number of days shown (default %d, at most %d)" % (DEFAULT_DAYS, MAX_DAYS))
    span.add_argument("--to", dest="end", help="last day shown, YYYY-MM-DD")
    parser.add_argument("--view", choices=VIEWS, default="all", help="one part only (default: all)")
    parser.add_argument("--now", help="reference time YYYY-MM-DDTHH:MM (default: meta.generatedAt, else the system clock)")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH, help="maximum line length (default %d)" % DEFAULT_WIDTH)
    parser.add_argument("--include-done", action="store_true", help="also list done/cancelled work and resolved/dismissed issues")
    parser.add_argument("--include-notes", action="store_true", help="also show the person's own notes")
    parser.add_argument("--no-descriptions", action="store_true", help="leave out what to do in each work session")
    parser.add_argument("--ascii", action="store_true", help="ASCII characters only")
    parser.add_argument("--force", action="store_true", help="show an invalid file anyway, leaving out the invalid parts")
    args = parser.parse_args(argv)
    if not MIN_WIDTH <= args.width <= MAX_WIDTH:
        parser.error("--width must be between %d and %d" % (MIN_WIDTH, MAX_WIDTH))
    if args.days is not None and not 1 <= args.days <= MAX_DAYS:
        parser.error("--days must be between 1 and %d" % MAX_DAYS)
    now = None
    if args.now:
        now = normalize_now(args.now)
        if now is None:
            parser.error("--now must be YYYY-MM-DDTHH:MM")
    for name, value in (("--from", args.start), ("--to", args.end)):
        if value is not None and not V.is_valid_date(value):
            parser.error("%s must be a date YYYY-MM-DD" % name)

    doc, errors, handled = load_schedule(args.schedule, args.force)
    if doc is None:
        sys.stderr.write("The schedule cannot be shown: %s is not a valid schedule file, and the text view is only made "
                         "from a valid file so that it matches what the website shows.\n" % args.schedule)
        for e in errors[:20]:
            sys.stderr.write("  error %s: %s\n" % (e.get("path") or "(root)", e.get("message")))
        if len(errors) > 20:
            sys.stderr.write("  ... and %d more (validate_schedule.py lists them all)\n" % (len(errors) - 20))
        if not args.force:
            sys.stderr.write("Fix the file and run this again (--force shows the valid parts of an invalid file).\n")
        return 2
    if now is None:
        generated = (doc.get("meta") or {}).get("generatedAt")
        now = normalize_now(generated) if generated else None
        if now is None:
            now = dt.datetime.now().strftime("%Y-%m-%dT%H:%M:00")
    start = args.start or now[:10]
    end = args.end or V.add_days(start, (args.days or DEFAULT_DAYS) - 1)
    if not V.is_valid_date(end):
        parser.error("the days shown must end by 9999-12-31")
    if end < start:
        parser.error("--to must not be before --from")
    if V.day_number(end) - V.day_number(start) + 1 > MAX_DAYS:
        parser.error("at most %d days can be shown" % MAX_DAYS)
    warnings = force_warnings(handled) if errors else []
    sys.stdout.write(render_text(doc, now, start, end, args.view, args.width, args.include_done, args.include_notes,
                                 not args.no_descriptions, args.ascii, warnings))
    return 0


if __name__ == "__main__":
    try:
        # UTF-8 everywhere (a Windows pipe would otherwise use the ANSI code page and garble the
        # dashes and lines); --ascii is the fallback for displays that cannot show them.
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
