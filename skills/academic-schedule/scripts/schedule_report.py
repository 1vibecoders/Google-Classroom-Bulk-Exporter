#!/usr/bin/env python3
"""Check a schedule file the way a careful planner would, and help write the summary.

Given a schedule (and optionally the schedule it was made from), prints:

  * per day: free study time (availability minus busy events), planned and
    done work, overload against free time and against maxDailyStudyMinutes,
    work planned outside free time, deadlines and assessments;
  * per assignment: total estimate, remaining, scheduled and unscheduled
    minutes exactly as SCHEDULE_FORMAT.md section 8.1 defines them;
  * a deadline feasibility check (earliest deadline first against free time);
  * problems: assessments without preparation or with all preparation on one
    day, blocks after deadlines, dependency order, past blocks still planned,
    session lengths and breaks of generated blocks, overlaps;
  * with --previous: what changed (added / updated / removed assignments,
    due-date and estimate changes, blocks added / moved / removed, settings)
    and an update-rule check (SCHEDULE_FORMAT.md section 15: protected items,
    person-owned fields, history, tombstones, basedOn, ...);
  * a draft of the human summary (Added / Updated / Scheduled / Potential
    issues / Questions).

Usage:
  python3 -I schedule_report.py schedule.json [--previous old.json]
        [--now YYYY-MM-DDTHH:MM] [--from YYYY-MM-DD] [--days N] [--json] [--check]

  --now       the reference time (default: the file's meta.generatedAt, else the system clock)
  --check     exit with status 1 when the file is invalid or breaks an update rule

Python 3.8+ standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_sibling(name: str) -> Any:
    path = os.path.join(HERE, name + ".py")
    spec = importlib.util.spec_from_file_location("academic_schedule_" + name, path)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = module  # type: ignore[union-attr]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


V = _load_sibling("validate_schedule")
IDS = _load_sibling("ids")

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
ASSESSMENT_TYPES = ("quiz", "test", "exam", "presentation")
STATUS_RANK = {"not_started": 0, "in_progress": 1, "done": 2}


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def dur(minutes: Optional[int]) -> str:
    if minutes is None:
        return "?"
    minutes = int(minutes)
    sign = "-" if minutes < 0 else ""
    h, m = divmod(abs(minutes), 60)
    if h and m:
        return "%s%dh %02dm" % (sign, h, m)
    if h:
        return "%s%dh" % (sign, h)
    return "%s%dm" % (sign, m)


def day_label(date: str, long: bool = False) -> str:
    wd = (V.day_number(date) + 3) % 7
    month, day = int(date[5:7]), int(date[8:10])
    if long:
        return "%s, %s %d" % (WEEKDAY_NAMES[wd], MONTH_NAMES[month - 1], day)
    return "%s %s %d" % (WEEKDAY_NAMES[wd][:3], MONTH_NAMES[month - 1], day)


def time12(hm: str) -> str:
    h, m = int(hm[0:2]), int(hm[3:5])
    suffix = "AM" if h < 12 else "PM"
    h = h % 12 or 12
    return "%d:%02d %s" % (h, m, suffix)


def when(value: Optional[str]) -> str:
    """'Oct 16, 11:59 PM' or 'Oct 16'."""
    if not value:
        return "no date"
    month, day = int(value[5:7]), int(value[8:10])
    text = "%s %d" % (MONTH_NAMES[month - 1], day)
    if len(value) > 10:
        text += ", " + time12(value[11:16])
    return text


# ---------------------------------------------------------------------------
# Schedule model helpers
# ---------------------------------------------------------------------------

def lst(value: Any) -> list:
    return [x for x in value if isinstance(x, dict)] if isinstance(value, list) else []


def block_minutes(b: Dict[str, Any]) -> int:
    try:
        return max(0, V.ldt_to_minutes(b["end"]) - V.ldt_to_minutes(b["start"]))
    except (KeyError, TypeError, ValueError):
        return 0


def is_work(b: Dict[str, Any]) -> bool:
    return b.get("kind", "work") == "work"


def b_status(b: Dict[str, Any]) -> str:
    return b.get("status", "planned")


def protected(item: Dict[str, Any]) -> bool:
    return item.get("origin", "generated") == "user" or item.get("locked") is True


def merge(intervals: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    out: List[Tuple[int, int]] = []
    for start, end in sorted(i for i in intervals if i[1] > i[0]):
        if out and start <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], end))
        else:
            out.append((start, end))
    return out


def subtract(base: List[Tuple[int, int]], remove: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    result = merge(base)
    for rs, re_ in merge(remove):
        nxt = []
        for s, e in result:
            if re_ <= s or rs >= e:
                nxt.append((s, e))
                continue
            if rs > s:
                nxt.append((s, rs))
            if re_ < e:
                nxt.append((re_, e))
        result = nxt
    return result


def total(intervals: List[Tuple[int, int]]) -> int:
    return sum(e - s for s, e in intervals)


def overlap(intervals: List[Tuple[int, int]], start: int, end: int) -> int:
    return sum(max(0, min(e, end) - max(s, start)) for s, e in intervals)


class Model:
    """Read-only views of a validated (normalized) schedule document."""

    def __init__(self, doc: Dict[str, Any], now: str) -> None:
        self.doc = doc
        self.now = now
        self.now_min = V.ldt_to_minutes(now)
        self.settings = V.resolve_settings(doc.get("settings"))
        self.classes = {c["id"]: c for c in lst(doc.get("classes"))}
        self.assignments = lst(doc.get("assignments"))
        self.by_id = {a["id"]: a for a in self.assignments}
        self.tasks: Dict[str, Tuple[Dict[str, Any], Dict[str, Any]]] = {}
        for a in self.assignments:
            for t in lst(a.get("tasks")):
                self.tasks[t["id"]] = (t, a)
        self.events = lst(doc.get("events"))
        self.availability = lst(doc.get("availability"))
        self.blocks = lst(doc.get("scheduleBlocks"))
        self.blocks_of: Dict[str, List[Dict[str, Any]]] = {}
        for b in self.blocks:
            if b.get("assignmentId"):
                self.blocks_of.setdefault(b["assignmentId"], []).append(b)
        for blocks in self.blocks_of.values():
            blocks.sort(key=lambda b: b["start"])

    # -- labels ---------------------------------------------------------------
    def class_name(self, a: Dict[str, Any]) -> str:
        c = self.classes.get(a.get("classId") or "")
        return c["name"] if c else "-"

    def label(self, a: Dict[str, Any]) -> str:
        c = self.classes.get(a.get("classId") or "")
        return "%s / %s" % (c["name"], a["title"]) if c else a["title"]

    def block_label(self, b: Dict[str, Any]) -> str:
        if b.get("assignmentId") in self.by_id:
            text = self.label(self.by_id[b["assignmentId"]])
            if b.get("taskId") in self.tasks:
                text += " - " + self.tasks[b["taskId"]][0]["title"]
            return text
        return b.get("title") or b["id"]

    # -- deadlines --------------------------------------------------------------
    def due_moment(self, value: str) -> int:
        return V.ldt_to_minutes(V.due_moment(value, self.settings["defaultDueTime"]))

    def deadline(self, a: Dict[str, Any]) -> Optional[int]:
        """The earlier of due (date-only -> defaultDueTime) and assessmentDate (date-only -> 00:00)."""
        moments = []
        if a.get("due"):
            moments.append(self.due_moment(a["due"]))
        if a.get("assessmentDate"):
            moments.append(V.ldt_to_minutes(V.start_of_day_moment(a["assessmentDate"])))
        return min(moments) if moments else None

    # -- remaining work (section 8.1) ----------------------------------------------
    def exclusion(self, a: Dict[str, Any]) -> Optional[str]:
        status = a.get("status", "not_started")
        if status in ("done", "cancelled"):
            return status
        blocks = self.blocks_of.get(a["id"], [])
        if a.get("required") is False and not any(is_work(b) and b_status(b) == "planned" for b in blocks):
            return "optional"
        if a.get("sourceState", "present") in ("missing", "withdrawn") and status != "in_progress":
            return a.get("sourceState")
        return None

    def progress(self, a: Dict[str, Any]) -> Dict[str, Any]:
        blocks = [b for b in self.blocks_of.get(a["id"], []) if is_work(b)]
        done = [b for b in blocks if b_status(b) == "done"]
        scheduled = sum(block_minutes(b) for b in blocks
                        if b_status(b) == "planned" and V.ldt_to_minutes(b["end"]) > self.now_min)
        tasks = lst(a.get("tasks"))
        reason = self.exclusion(a)
        estimate = a.get("estimatedMinutes")
        if reason is not None:
            remaining: Optional[int] = 0
        elif any(isinstance(t.get("estimatedMinutes"), int) for t in tasks):
            task_remaining = 0
            for t in tasks:
                own = [b for b in blocks if b.get("taskId") == t["id"]]
                if t.get("status") in ("done", "cancelled"):
                    continue
                if t.get("required") is False and not any(b_status(b) == "planned" for b in own):
                    continue
                if not isinstance(t.get("estimatedMinutes"), int):
                    continue
                task_remaining += max(0, t["estimatedMinutes"] - sum(block_minutes(b) for b in own if b_status(b) == "done"))
            live_sum = sum(t.get("estimatedMinutes", 0) for t in tasks
                           if t.get("status") != "cancelled" and isinstance(t.get("estimatedMinutes"), int))
            untasked_done = sum(block_minutes(b) for b in done if not b.get("taskId"))
            remaining = task_remaining + max(0, (estimate or 0) - live_sum - untasked_done)
        elif estimate is None:
            remaining = None
        else:
            remaining = max(0, estimate - sum(block_minutes(b) for b in done))
        return {
            "estimate": estimate, "remaining": remaining, "scheduled": scheduled,
            "unscheduled": None if remaining is None else max(0, remaining - scheduled),
            "done": sum(block_minutes(b) for b in done), "excluded": reason,
            "plannedDays": sorted({b["start"][:10] for b in blocks
                                   if b_status(b) == "planned" and V.ldt_to_minutes(b["end"]) > self.now_min}),
            "sessions": sum(1 for b in blocks if b_status(b) == "planned" and V.ldt_to_minutes(b["end"]) > self.now_min),
        }

    # -- free time (section 11) --------------------------------------------------------
    def busy(self, date: str) -> List[Tuple[int, int]]:
        out = []
        for e in self.events:
            if e.get("busy") is False or not V.event_occurs_on(e, date):
                continue
            if e.get("allDay") is True:
                out.append((0, 1440))
            elif e.get("startTime") and e.get("endTime"):
                out.append((V.time_to_minutes(e["startTime"]), V.time_to_minutes(e["endTime"])))
        return merge(out)

    def free(self, date: str) -> Optional[List[Tuple[int, int]]]:
        if not self.availability:
            return None
        windows = []
        for w in self.availability:
            applies = V.occurs_on(w["recurrence"], date) if isinstance(w.get("recurrence"), dict) else w.get("date") == date
            if applies:
                windows.append((V.time_to_minutes(w["startTime"]), V.time_to_minutes(w["endTime"])))
        return subtract(merge(windows), self.busy(date))

    def free_after_now(self, date: str) -> Optional[List[Tuple[int, int]]]:
        free = self.free(date)
        if free is None:
            return None
        day_start = V.day_number(date) * 1440
        cut = self.now_min - day_start
        if cut <= 0:
            return free
        return subtract(free, [(0, min(1440, cut))])


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

def analyze_days(m: Model, start: str, end: str) -> List[Dict[str, Any]]:
    days = []
    limit = m.settings["maxDailyStudyMinutes"]
    date = start
    while date <= end:
        day_start = V.day_number(date) * 1440
        free_all = m.free(date)
        free_now = m.free_after_now(date)
        blocks = [b for b in m.blocks if b["start"][:10] == date and is_work(b) and b_status(b) != "skipped"]
        planned = [b for b in blocks if b_status(b) == "planned"]
        planned_future = [b for b in planned if V.ldt_to_minutes(b["end"]) > m.now_min]
        planned_min = sum(block_minutes(b) for b in planned_future)
        done_min = sum(block_minutes(b) for b in blocks if b_status(b) == "done")
        notes: List[str] = []
        outside = 0
        if free_all is not None:
            for b in planned_future:
                s, e = V.ldt_to_minutes(b["start"]) - day_start, V.ldt_to_minutes(b["end"]) - day_start
                outside += (e - s) - overlap(free_all, s, e)
        capacity = total(free_now) if free_now is not None else None
        overload = None
        if capacity is not None and planned_min > capacity:
            overload = planned_min - capacity
            notes.append("OVERLOADED: %s planned, %s free" % (dur(planned_min), dur(capacity)))
        if limit is not None and planned_min + done_min > limit:
            notes.append("over the daily maximum (%s)" % dur(limit))
        if outside > 0:
            notes.append("%s planned outside free study time" % dur(outside))
        markers = []
        for a in m.assignments:
            if a.get("due") and a["due"][:10] == date:
                markers.append("due %s%s: %s" % (time12(a["due"][11:16]) if len(a["due"]) > 10 else "(no time)",
                                                 "" if m.exclusion(a) is None else " [%s]" % m.exclusion(a), m.label(a)))
            if a.get("assessmentDate") and a["assessmentDate"][:10] == date:
                markers.append("%s%s: %s" % ((a.get("type") or "assessment").upper(),
                                             " " + time12(a["assessmentDate"][11:16]) if len(a["assessmentDate"]) > 10 else "",
                                             m.label(a)))
        days.append({
            "date": date, "free": total(free_all) if free_all is not None else None, "freeAfterNow": capacity,
            "planned": planned_min, "done": done_min, "sessions": len(planned_future), "outsideFree": outside,
            "overload": overload, "overDailyMax": limit is not None and planned_min + done_min > limit,
            "markers": markers, "notes": notes,
        })
        date = V.add_days(date, 1)
    return days


def feasibility(m: Model, progress: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Earliest deadline first: is the free time before each deadline enough for the work due by then?"""
    if not m.availability:
        return []
    limit = m.settings["maxDailyStudyMinutes"]
    work = []
    for a in m.assignments:
        p = progress[a["id"]]
        deadline = m.deadline(a)
        if p["excluded"] is None and p["remaining"] and deadline is not None and deadline > m.now_min:
            work.append((deadline, p["remaining"], a))
    work.sort(key=lambda x: x[0])
    findings = []
    cumulative = 0
    for deadline, remaining, a in work:
        cumulative += remaining
        capacity = 0
        date = m.now[:10]
        end_date = V.date_from_day_number(deadline // 1440)
        while date <= end_date:
            day_start = V.day_number(date) * 1440
            free = m.free_after_now(date) or []
            if date == end_date:
                free = subtract(free, [(deadline - day_start, 1440)])
            day = total(free)
            capacity += min(day, limit) if limit is not None else day
            date = V.add_days(date, 1)
        if cumulative > capacity:
            findings.append({"assignment": a["id"], "label": m.label(a), "deadline": V.date_from_day_number(deadline // 1440),
                             "workDue": cumulative, "freeTime": capacity})
    return findings


def find_problems(m: Model, progress: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    problems: List[Dict[str, Any]] = []

    def add(kind: str, message: str, ref: Optional[str] = None) -> None:
        problems.append({"kind": kind, "message": message, "id": ref})

    s = m.settings
    for a in m.assignments:
        p = progress[a["id"]]
        if p["excluded"] is not None:
            continue
        deadline = m.deadline(a)
        if p["remaining"] is None:
            add("no-estimate", "%s has no estimate, so its remaining work is unknown." % m.label(a), a["id"])
        elif p["unscheduled"]:
            add("unscheduled", "%s: %s of %s remaining work is not scheduled." % (
                m.label(a), dur(p["unscheduled"]), dur(p["remaining"])), a["id"])
        if deadline is not None and deadline <= m.now_min and (p["remaining"] or 0) > 0:
            add("overdue", "%s: the deadline has passed but %s of work remains." % (m.label(a), dur(p["remaining"])), a["id"])
        if a.get("type") in ASSESSMENT_TYPES and a.get("assessmentDate"):
            start = V.ldt_to_minutes(V.start_of_day_moment(a["assessmentDate"]))
            if start > m.now_min and (p["remaining"] is None or p["remaining"] > 0):
                prep = [b for b in m.blocks_of.get(a["id"], []) if is_work(b) and b_status(b) == "planned"
                        and V.ldt_to_minutes(b["end"]) > m.now_min and V.ldt_to_minutes(b["end"]) <= start]
                if not prep:
                    add("no-prep", "%s on %s has no preparation sessions before it." % (m.label(a), when(a["assessmentDate"])), a["id"])
                else:
                    days = {b["start"][:10] for b in prep}
                    days_available = (start // 1440) - (m.now_min // 1440)
                    if len(days) == 1 and (p["remaining"] or 0) >= 60 and days_available >= 2:
                        add("crammed", "%s: all %s of preparation is on %s; spread it over several days." % (
                            m.label(a), dur(sum(block_minutes(b) for b in prep)), day_label(next(iter(days)))), a["id"])
        elif a.get("type") in ("writing", "project") and (p["remaining"] or 0) >= 120 and len(p["plannedDays"]) == 1:
            if deadline is not None and (deadline // 1440) - (m.now_min // 1440) >= 2:
                add("crammed", "%s: %s of work is all on %s; split it over several days." % (
                    m.label(a), dur(p["remaining"]), day_label(p["plannedDays"][0])), a["id"])
    for b in m.blocks:
        if not is_work(b) or b_status(b) != "planned":
            continue
        end = V.ldt_to_minutes(b["end"])
        a = m.by_id.get(b.get("assignmentId") or "")
        label = m.block_label(b)
        if end <= m.now_min:
            add("past-planned", "%s on %s has passed but is still planned: ask whether it was done." % (
                label, when(b["start"])), b["id"])
            continue
        if a is not None:
            if a.get("due") and end > m.due_moment(a["due"]):
                add("after-due", "%s (%s) ends after the due time %s." % (label, when(b["start"]), when(a["due"])), b["id"])
            if a.get("assessmentDate") and end > V.ldt_to_minutes(V.start_of_day_moment(a["assessmentDate"])):
                add("after-assessment", "%s (%s) ends after the assessment %s." % (label, when(b["start"]), when(a["assessmentDate"])), b["id"])
            if a.get("recommendedCompletionDate"):
                rcd = a["recommendedCompletionDate"]
                limit = V.ldt_to_minutes(rcd) if len(rcd) > 10 else V.ldt_to_minutes(rcd + "T23:59:00") + 1
                if end > limit:
                    add("after-target", "%s (%s) is after the recommended completion date %s." % (label, when(b["start"]), when(rcd)), b["id"])
            for dep in a.get("dependsOn") or []:
                dep_blocks = [x for x in m.blocks_of.get(dep, []) if is_work(x) and b_status(x) == "planned"]
                dep_a = m.by_id.get(dep)
                if dep_a and dep_a.get("status") not in ("done", "cancelled") and dep_blocks:
                    last_end = max(V.ldt_to_minutes(x["end"]) for x in dep_blocks)
                    if V.ldt_to_minutes(b["start"]) < last_end:
                        add("order", "%s (%s) starts before the work it depends on (%s) is finished." % (
                            label, when(b["start"]), m.label(dep_a)), b["id"])
                        break
        task_entry = m.tasks.get(b.get("taskId") or "")
        if task_entry:
            task, parent = task_entry
            if task.get("due") and end > m.due_moment(task["due"]):
                add("after-task-due", "%s (%s) ends after the task's checkpoint %s." % (label, when(b["start"]), when(task["due"])), b["id"])
            for dep in task.get("dependsOn") or []:
                dep_entry = m.tasks.get(dep)
                if not dep_entry or dep_entry[0].get("status") in ("done", "cancelled"):
                    continue
                dep_blocks = [x for x in m.blocks_of.get(parent["id"], []) if x.get("taskId") == dep and b_status(x) == "planned"]
                if dep_blocks and V.ldt_to_minutes(b["start"]) < max(V.ldt_to_minutes(x["end"]) for x in dep_blocks):
                    add("order", "%s (%s) starts before task \"%s\" is finished." % (label, when(b["start"]), dep_entry[0]["title"]), b["id"])
                    break
    # Session lengths and breaks of generated / planner blocks.
    generated = sorted((b for b in m.blocks if is_work(b) and b_status(b) == "planned" and not protected(b)
                        and V.ldt_to_minutes(b["end"]) > m.now_min), key=lambda b: b["start"])
    for b in generated:
        length = block_minutes(b)
        if length < s["minSessionMinutes"]:
            add("short-session", "%s (%s) lasts %s, shorter than minSessionMinutes %s." % (
                m.block_label(b), when(b["start"]), dur(length), dur(s["minSessionMinutes"])), b["id"])
        elif length > s["maxSessionMinutes"]:
            add("long-session", "%s (%s) lasts %s, longer than maxSessionMinutes %s." % (
                m.block_label(b), when(b["start"]), dur(length), dur(s["maxSessionMinutes"])), b["id"])
    all_work = sorted((b for b in m.blocks if is_work(b) and b_status(b) != "skipped"), key=lambda b: b["start"])
    for prev, cur in zip(all_work, all_work[1:]):
        if prev["start"][:10] != cur["start"][:10] or (protected(prev) and protected(cur)):
            continue
        gap = V.ldt_to_minutes(cur["start"]) - V.ldt_to_minutes(prev["end"])
        if gap < 0:
            add("overlap", "%s (%s) overlaps %s." % (m.block_label(cur), when(cur["start"]), m.block_label(prev)), cur["id"])
        elif gap < s["breakMinutes"] and V.ldt_to_minutes(cur["end"]) > m.now_min:
            add("no-break", "%s (%s) follows %s with a %s break (breakMinutes %s)." % (
                m.block_label(cur), when(cur["start"]), m.block_label(prev), dur(gap), dur(s["breakMinutes"])), cur["id"])
    for b in m.blocks:
        if not is_work(b) or b_status(b) != "planned" or V.ldt_to_minutes(b["end"]) <= m.now_min:
            continue
        date = b["start"][:10]
        day_start = V.day_number(date) * 1440
        s0, e0 = V.ldt_to_minutes(b["start"]) - day_start, V.ldt_to_minutes(b["end"]) - day_start
        if overlap(m.busy(date), s0, e0) > 0:
            add("busy-overlap", "%s (%s) overlaps a busy commitment." % (m.block_label(b), when(b["start"])), b["id"])
    if not m.availability:
        add("no-availability", "The schedule has no study time (availability is empty): free time and overloads cannot "
                               "be checked. Ask the person when they can study before planning (section 11).")
    return problems


# ---------------------------------------------------------------------------
# Comparison with the previous schedule
# ---------------------------------------------------------------------------

DEFAULTS = {
    "classes": {"origin": "generated", "locked": False, "archived": False},
    "assignments": {"origin": "generated", "locked": False, "type": "homework", "priority": "medium",
                    "status": "not_started", "required": True, "sourceState": "present"},
    "tasks": {"origin": "generated", "locked": False, "status": "not_started", "required": True},
    "events": {"origin": "generated", "locked": False, "category": "other", "allDay": False, "busy": True},
    "availability": {"origin": "generated", "locked": False},
    "scheduleBlocks": {"origin": "generated", "locked": False, "kind": "work", "status": "planned"},
}


def canon(value: Any, collection: Optional[str] = None) -> Any:
    """Normalize for comparison (section 16.5): defaults filled, empty arrays dropped, keys sorted."""
    if isinstance(value, dict):
        out = {}
        defaults = DEFAULTS.get(collection or "", {})
        for key, default in defaults.items():
            out[key] = default
        for key, v in value.items():
            if isinstance(v, list) and not v:
                continue
            if key == "tasks":
                out[key] = [canon(t, "tasks") for t in v]
            elif key == "issues":
                out[key] = [dict(canon(i), status=i.get("status", "open")) if isinstance(i, dict) else i for i in v]
            elif key == "references":
                out[key] = [dict({"kind": "attachment", "required": False}, **canon(r)) if isinstance(r, dict) else r for r in v]
            elif key == "recurrence" and isinstance(v, dict):
                out[key] = dict({"interval": 1}, **canon(v))
            else:
                out[key] = canon(v)
        return out
    if isinstance(value, list):
        return [canon(v) for v in value]
    return value


def items_of(doc: Dict[str, Any]) -> Dict[str, Dict[str, Tuple[Dict[str, Any], Optional[str]]]]:
    """collection -> id -> (item, parent assignment id for tasks)."""
    out: Dict[str, Dict[str, Tuple[Dict[str, Any], Optional[str]]]] = {k: {} for k in DEFAULTS}
    for key in ("classes", "events", "availability", "scheduleBlocks"):
        for item in lst(doc.get(key)):
            if isinstance(item.get("id"), str):
                out[key][item["id"]] = (item, None)
    for a in lst(doc.get("assignments")):
        if isinstance(a.get("id"), str):
            out["assignments"][a["id"]] = (a, None)
            for t in lst(a.get("tasks")):
                if isinstance(t.get("id"), str):
                    out["tasks"][t["id"]] = (t, a["id"])
    return out


def all_issues(doc: Dict[str, Any]) -> Dict[str, Tuple[Dict[str, Any], str]]:
    found: Dict[str, Tuple[Dict[str, Any], str]] = {}
    for issue in lst(doc.get("issues")):
        if isinstance(issue.get("id"), str):
            found[issue["id"]] = (issue, "root")
    for collection, entries in items_of(doc).items():
        for item_id, (item, _parent) in entries.items():
            for issue in lst(item.get("issues")):
                if isinstance(issue.get("id"), str):
                    found[issue["id"]] = (issue, item_id)
    return found


def compare(prev: Dict[str, Any], new: Dict[str, Any], now: str) -> Dict[str, Any]:
    now_min = V.ldt_to_minutes(now)
    P, N = items_of(prev), items_of(new)
    meta_new = new.get("meta") if isinstance(new.get("meta"), dict) else {}
    meta_prev = prev.get("meta") if isinstance(prev.get("meta"), dict) else {}
    requested = {rc.get("id") for rc in lst(meta_new.get("requestedChanges"))}
    new_tombs = {t.get("id"): t for t in lst(new.get("deleted"))}
    prev_tombs = {t.get("id"): t for t in lst(prev.get("deleted"))}
    violations: List[str] = []
    warnings: List[str] = []
    changes: Dict[str, Any] = {"added": {}, "removed": {}, "changed": {}}

    def v(msg: str) -> None:
        violations.append(msg)

    def w(msg: str) -> None:
        warnings.append(msg)

    # Meta (section 15.1).
    if "exportId" in meta_new:
        v("meta.exportId is written; generators MUST NOT write it (set meta.basedOn instead).")
    expected = meta_prev.get("exportId") or meta_prev.get("basedOn")
    if expected and meta_new.get("basedOn") != expected:
        v("meta.basedOn is %r but must be %r (the input's exportId, or its basedOn)." % (meta_new.get("basedOn"), expected))
    if meta_prev.get("requestedChanges") and canon(meta_prev.get("requestedChanges")) == canon(meta_new.get("requestedChanges")):
        w("meta.requestedChanges equals the input's; it must list only this run's changes.")
    if canon(prev.get("settings") or {}) != canon(new.get("settings") or {}):
        w("settings changed: allowed only when the person asked in this request; describe each change in the summary "
          "and tell them to tick it in the import preview.")
    # Tombstones.
    for tid, tomb in prev_tombs.items():
        if tid not in new_tombs:
            v("tombstone %s (deleted %s) was dropped; copy `deleted` unchanged." % (tid, tomb.get("title") or ""))
        elif canon(new_tombs[tid]) != canon(tomb):
            v("tombstone %s was changed; copy `deleted` unchanged." % tid)
    # Resolved / dismissed issues.
    prev_issues, new_issues = all_issues(prev), all_issues(new)
    for iid, (issue, owner) in prev_issues.items():
        if issue.get("status") in ("resolved", "dismissed"):
            item_gone = owner != "root" and not any(owner in N[c] for c in N)
            root_target_gone = owner == "root" and issue.get("itemId") and not any(issue["itemId"] in N[c] for c in N)
            if item_gone or root_target_gone:
                continue
            if iid not in new_issues or new_issues[iid][0].get("status") != issue.get("status"):
                v("issue %s was %s by the person; keep it unchanged and do not raise it again." % (iid, issue["status"]))

    for collection in DEFAULTS:
        prev_items, new_items = P[collection], N[collection]
        added = [i for i in new_items if i not in prev_items]
        removed = [i for i in prev_items if i not in new_items]
        changed = []
        for item_id in added:
            item, parent = new_items[item_id]
            if item_id.startswith("u-"):
                v("%s %s: new ID starts with 'u-' (reserved for the website)." % (collection, item_id))
            if item.get("origin") == "planner":
                v("%s %s: generators never create planner items." % (collection, item_id))
            if item.get("origin") == "user":
                w("%s %s: a new item with origin 'user'; items a generator creates are 'generated'." % (collection, item_id))
            if item.get("notes"):
                v("%s %s: generators never write notes on new items (use description)." % (collection, item_id))
            source_ids = {s.get("id") for s in [item.get("source")] + lst(item.get("sources")) if isinstance(s, dict) and s.get("id")}
            for tomb in prev_tombs.values():
                if tomb.get("collection") == collection and (tomb.get("id") == item_id or (tomb.get("sourceId") and tomb.get("sourceId") in source_ids)):
                    v("%s %s re-creates %s, which the person deleted (tombstone %s)." % (collection, item_id, item.get("title") or item.get("name") or "", tomb.get("id")))
        for item_id in removed:
            item, parent = prev_items[item_id]
            title = item.get("title") or item.get("name") or item.get("label") or item_id
            if item_id in requested:
                continue
            if collection == "scheduleBlocks":
                ok = (not protected(item) and b_status(item) == "planned" and V.ldt_to_minutes(item["start"]) >= now_min
                      and not item.get("notes"))
                if not ok:
                    v("block %s (%s, %s) was removed, but only unlocked future planned generated/planner blocks without "
                      "notes may be removed." % (item_id, title, item.get("start")))
                continue
            if protected(item):
                v("%s %s (%s) is protected (user or locked) and was removed without a requested change." % (collection, item_id, title))
                continue
            if collection == "tasks":
                parent_item = P["assignments"].get(parent or "", (None, None))[0]
                referenced = any(b.get("taskId") == item_id for b, _ in N["scheduleBlocks"].values())
                if item.get("status") == "done" or referenced or (parent_item and protected(parent_item)):
                    v("task %s (%s) was removed; a done, referenced or protected task must stay (cancel it instead)." % (item_id, title))
                continue
            if item_id in new_tombs:
                w("%s %s (%s) was removed with a tombstone: only when the person asked for it." % (collection, item_id, title))
            elif collection == "assignments":
                v("assignment %s (%s) was removed; generators never delete assignments (set sourceState instead)." % (item_id, title))
            else:
                w("%s %s (%s) was removed: only when the person asked; add a tombstone." % (collection, item_id, title))
        for item_id in [i for i in new_items if i in prev_items]:
            old, old_parent = prev_items[item_id]
            cur, cur_parent = new_items[item_id]
            title = cur.get("title") or cur.get("name") or cur.get("label") or item_id
            if collection == "tasks" and old_parent != cur_parent:
                v("task %s moved from %s to %s; tasks never change assignment." % (item_id, old_parent, cur_parent))
            if canon(old, collection) == canon(cur, collection):
                continue
            fields = sorted(k for k in set(old) | set(cur) if canon(old.get(k)) != canon(cur.get(k))
                            and not (k in DEFAULTS[collection] and old.get(k, DEFAULTS[collection][k]) == cur.get(k, DEFAULTS[collection][k]))
                            and not (k in ("tasks", "issues", "references", "dependsOn", "overrides", "sources", "topics", "exceptDates")
                                     and not old.get(k) and not cur.get(k)))
            if collection == "assignments":
                fields = [f for f in fields if f != "tasks" or _tasks_differ_outside_tasks(old, cur)]
            if not fields:
                continue
            changed.append((item_id, fields))
            old_origin, new_origin = old.get("origin", "generated"), cur.get("origin", "generated")
            if old_origin != new_origin:
                v("%s %s: origin changed from %s to %s; origin never changes." % (collection, item_id, old_origin, new_origin))
            parent_protected = False
            if collection == "tasks":
                parent_old = P["assignments"].get(old_parent or "", (None, None))[0]
                parent_protected = bool(parent_old and protected(parent_old))
            if (protected(old) or parent_protected) and item_id not in requested and \
                    not (collection == "tasks" and old_parent in requested):
                v("%s %s (%s) is protected but changed (%s) without a requested change." % (collection, item_id, title, ", ".join(fields)))
                continue
            if (old.get("notes") or "") != (cur.get("notes") or ""):
                v("%s %s: notes changed; notes belong to the person." % (collection, item_id))
            if bool(old.get("locked")) != bool(cur.get("locked")):
                v("%s %s: locked changed; it belongs to the person." % (collection, item_id))
            if canon(old.get("overrides") or []) != canon(cur.get("overrides") or []):
                v("%s %s: overrides changed; copy it unchanged." % (collection, item_id))
            for name in old.get("overrides") or []:
                if canon(old.get(name)) != canon(cur.get(name)):
                    v("%s %s: overridden field %s changed (%r -> %r); keep the person's value and add a conflict issue." % (
                        collection, item_id, name, old.get(name), cur.get(name)))
            for key in old:
                if key.startswith("x-") and key not in cur:
                    v("%s %s: extension property %s was dropped." % (collection, item_id, key))
            if collection in ("assignments", "tasks"):
                os_, ns = old.get("status", "not_started"), cur.get("status", "not_started")
                if os_ == "cancelled" and ns != "cancelled":
                    v("%s %s: status changed from cancelled (the person's decision) to %s." % (collection, item_id, ns))
                elif ns == "cancelled" and os_ != "cancelled":
                    if collection == "assignments":
                        w("assignment %s: set to cancelled; only when the person asked in this request." % item_id)
                elif STATUS_RANK.get(ns, 0) < STATUS_RANK.get(os_, 0):
                    v("%s %s: status went backwards (%s -> %s)." % (collection, item_id, os_, ns))
                if os_ == "done" and old.get("completedAt") != cur.get("completedAt"):
                    v("%s %s: completedAt of done work changed." % (collection, item_id))
                oe, ne = old.get("estimatedMinutes"), cur.get("estimatedMinutes")
                if isinstance(oe, int) and isinstance(ne, int) and ne < oe:
                    w("%s %s: estimatedMinutes lowered %s -> %s; never lower it to reflect progress (only on new evidence)." % (
                        collection, item_id, oe, ne))
            if collection == "scheduleBlocks":
                status = b_status(old)
                if status in ("done", "skipped"):
                    v("block %s is %s (history) but changed (%s)." % (item_id, status, ", ".join(fields)))
                elif V.ldt_to_minutes(old["start"]) < now_min:
                    allowed = {"status", "completedAt"}
                    if set(fields) - allowed or b_status(cur) not in ("planned", "done", "skipped"):
                        v("block %s is past or in progress; only its status may change (to done/skipped), but %s changed." % (
                            item_id, ", ".join(sorted(set(fields) - allowed))))
                if old.get("notes") and not cur.get("notes"):
                    v("block %s lost its notes." % item_id)
        changes["added"][collection] = added
        changes["removed"][collection] = removed
        changes["changed"][collection] = changed

    # Possible duplicates among new assignments (section 15.3 rule 3).
    for item_id in changes["added"]["assignments"]:
        cur = N["assignments"][item_id][0]
        for old_id, (old, _p) in P["assignments"].items():
            if old_id == item_id or old.get("classId") != cur.get("classId"):
                continue
            fam_old = old.get("type", "homework") in ASSESSMENT_TYPES
            fam_new = cur.get("type", "homework") in ASSESSMENT_TYPES
            if fam_old != fam_new or IDS.title_key(old.get("title", "")) != IDS.title_key(cur.get("title", "")):
                continue
            d_old = old.get("due") or old.get("assessmentDate")
            d_new = cur.get("due") or cur.get("assessmentDate")
            if (d_old is None) != (d_new is None):
                continue
            if d_old and abs(V.day_number(d_old[:10]) - V.day_number(d_new[:10])) >= 7:
                continue
            w("assignment %s looks like a duplicate of %s (%s): match before creating (section 15.3)." % (item_id, old_id, old.get("title")))
    return {"violations": violations, "warnings": warnings, "changes": changes, "P": P, "N": N}


def _tasks_differ_outside_tasks(old: Dict[str, Any], cur: Dict[str, Any]) -> bool:
    """Task edits are reported per task; the assignment's own 'tasks' field counts only for added/removed/reordered tasks."""
    return [t.get("id") for t in lst(old.get("tasks"))] != [t.get("id") for t in lst(cur.get("tasks"))]


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

def build_report(doc: Dict[str, Any], now: str, start: str, days: int, prev: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    m = Model(doc, now)
    progress = {a["id"]: m.progress(a) for a in m.assignments}
    last = start
    for b in m.blocks:
        if b_status(b) == "planned" and b["start"][:10] > last:
            last = b["start"][:10]
    for a in m.assignments:
        for key in ("due", "assessmentDate"):
            if a.get(key) and a[key][:10] > last and m.exclusion(a) is None:
                last = a[key][:10]
    end = min(V.add_days(start, days - 1), last) if days else min(last, V.add_days(start, 41))
    end = max(end, start)
    report: Dict[str, Any] = {
        "now": now,
        "range": [start, end],
        "settings": m.settings,
        "days": analyze_days(m, start, end),
        "assignments": [],
        "feasibility": feasibility(m, progress),
        "problems": find_problems(m, progress),
    }
    for a in sorted(m.assignments, key=lambda x: (m.deadline(x) or 10 ** 12, x["title"])):
        p = progress[a["id"]]
        report["assignments"].append(dict(p, id=a["id"], label=m.label(a), type=a.get("type", "homework"),
                                          due=a.get("due"), assessmentDate=a.get("assessmentDate"),
                                          status=a.get("status", "not_started"), sourceState=a.get("sourceState", "present")))
    if prev is not None:
        cmp = compare(prev, doc, now)
        report["violations"] = cmp["violations"]
        report["updateWarnings"] = cmp["warnings"]
        report["changes"] = summarize_changes(cmp, prev, doc, m)
    report["summary"] = draft_summary(report, m, prev is not None)
    return report


def summarize_changes(cmp: Dict[str, Any], prev: Dict[str, Any], doc: Dict[str, Any], m: Model) -> Dict[str, Any]:
    P, N = cmp["P"], cmp["N"]
    ch = cmp["changes"]
    out: Dict[str, Any] = {"assignmentsAdded": [], "assignmentsRemoved": [], "assignmentsUpdated": [], "other": []}
    for item_id in ch["added"]["assignments"]:
        a = N["assignments"][item_id][0]
        out["assignmentsAdded"].append({"id": item_id, "label": m.label(a), "date": a.get("due") or a.get("assessmentDate"),
                                        "kind": "assessment" if a.get("assessmentDate") and not a.get("due") else "due"})
    for item_id in ch["removed"]["assignments"]:
        a = P["assignments"][item_id][0]
        out["assignmentsRemoved"].append({"id": item_id, "title": a.get("title")})
    interesting = ("due", "assessmentDate", "recommendedCompletionDate", "estimatedMinutes", "status", "sourceState",
                   "title", "priority", "type", "required", "classId", "description", "tasks", "points", "topic", "references")
    for item_id, fields in ch["changed"]["assignments"]:
        old, cur = P["assignments"][item_id][0], N["assignments"][item_id][0]
        details = []
        for f in fields:
            if f in ("due", "assessmentDate", "recommendedCompletionDate"):
                details.append("%s %s -> %s" % (f, when(old.get(f)), when(cur.get(f))))
            elif f == "estimatedMinutes":
                details.append("estimate %s -> %s" % (dur(old.get(f)), dur(cur.get(f))))
            elif f in ("status", "sourceState", "priority", "type", "required", "title"):
                details.append("%s %s -> %s" % (f, old.get(f), cur.get(f)))
            elif f == "tasks":
                details.append("tasks %d -> %d" % (len(lst(old.get("tasks"))), len(lst(cur.get("tasks")))))
            elif f in interesting:
                details.append(f)
            elif f not in ("issues",):
                details.append(f)
        task_changes = [tid for tid, _ in ch["changed"]["tasks"] if N["tasks"][tid][1] == item_id]
        if task_changes:
            details.append("%d task(s) changed" % len(task_changes))
        if details:
            out["assignmentsUpdated"].append({"id": item_id, "label": m.label(cur), "details": details})
    for collection in ("classes", "events", "availability"):
        for item_id in ch["added"][collection]:
            item = N[collection][item_id][0]
            out["other"].append("added %s: %s" % (collection[:-1] if collection != "classes" else "class",
                                                  item.get("title") or item.get("name") or item.get("label") or item_id))
        for item_id in ch["removed"][collection]:
            item = P[collection][item_id][0]
            out["other"].append("removed %s: %s" % (collection, item.get("title") or item.get("name") or item.get("label") or item_id))
        for item_id, fields in ch["changed"][collection]:
            item = N[collection][item_id][0]
            out["other"].append("changed %s %s: %s" % (collection, item.get("title") or item.get("name") or item.get("label") or item_id,
                                                       ", ".join(fields)))
    added_blocks = [N["scheduleBlocks"][i][0] for i in ch["added"]["scheduleBlocks"]]
    removed_blocks = [P["scheduleBlocks"][i][0] for i in ch["removed"]["scheduleBlocks"]]
    moved = [i for i, f in ch["changed"]["scheduleBlocks"] if "start" in f or "end" in f]
    out["blocks"] = {
        "added": len(added_blocks), "addedMinutes": sum(block_minutes(b) for b in added_blocks if is_work(b)),
        "removed": len(removed_blocks), "removedMinutes": sum(block_minutes(b) for b in removed_blocks if is_work(b)),
        "moved": len(moved), "statusChanged": sum(1 for i, f in ch["changed"]["scheduleBlocks"] if "status" in f),
    }
    prev_issue_ids = set(all_issues(prev))
    out["newIssues"] = [dict(issue, owner=owner) for iid, (issue, owner) in all_issues(doc).items()
                        if iid not in prev_issue_ids and issue.get("status", "open") == "open"]
    return out


def draft_summary(report: Dict[str, Any], m: Model, update: bool) -> str:
    lines = ["Schedule updated." if update else "Schedule created."]
    changes = report.get("changes")
    if changes:
        added = changes["assignmentsAdded"]
        if added:
            lines.append("Added:")
            for a in added:
                lines.append("- %s%s" % (a["label"], " - " + when(a["date"]) if a.get("date") else ""))
        if changes["assignmentsUpdated"]:
            lines.append("Updated:")
            for a in changes["assignmentsUpdated"]:
                lines.append("- %s: %s" % (a["label"], "; ".join(a["details"])))
        if changes["other"]:
            lines.append("Other changes:")
            for text in changes["other"]:
                lines.append("- " + text)
    else:
        work = [a for a in m.assignments if m.exclusion(a) is None]
        if work:
            lines.append("Added:")
            for a in sorted(work, key=lambda x: (m.deadline(x) or 10 ** 12, x["title"])):
                date = a.get("due") or a.get("assessmentDate")
                lines.append("- %s%s" % (m.label(a), " - " + when(date) if date else ""))
    future = [b for b in m.blocks if is_work(b) and b_status(b) == "planned" and V.ldt_to_minutes(b["end"]) > m.now_min]
    lines.append("Scheduled:")
    lines.append("- %d work session%s" % (len(future), "" if len(future) == 1 else "s"))
    lines.append("- %s total" % dur(sum(block_minutes(b) for b in future)))
    if changes:
        bl = changes["blocks"]
        lines.append("- this run: %d added (%s), %d moved, %d removed" % (bl["added"], dur(bl["addedMinutes"]), bl["moved"], bl["removed"]))
    issues = []
    for d in report["days"]:
        if d["overload"]:
            issues.append("%s has about %s of work but only %s of available time." % (
                day_label(d["date"], True), dur(d["planned"]), dur(d["freeAfterNow"])))
        elif d["overDailyMax"]:
            issues.append("%s exceeds your daily maximum of %s." % (day_label(d["date"], True), dur(m.settings["maxDailyStudyMinutes"])))
    for f in report["feasibility"]:
        issues.append("By %s there is %s of work due but only %s of free study time." % (
            day_label(f["deadline"], True), dur(f["workDue"]), dur(f["freeTime"])))
    for p in report["problems"]:
        if p["kind"] in ("unscheduled", "no-prep", "overdue", "after-due", "after-assessment", "no-availability", "crammed"):
            issues.append(p["message"])
    if issues:
        lines.append("Potential issues:" if len(issues) > 1 else "Potential issue:")
        for text in issues[:12]:
            lines.append("- " + text)
        if len(issues) > 12:
            lines.append("- ... and %d more (see the report)" % (len(issues) - 12))
    questions = []
    for issue in lst(m.doc.get("issues")) + [i for a in m.assignments for i in lst(a.get("issues"))]:
        if issue.get("status", "open") == "open" and issue.get("kind") in ("ambiguity", "missing_information", "conflict"):
            questions.append(issue.get("message", ""))
    if questions:
        lines.append("Questions:")
        for q in questions[:10]:
            lines.append("- " + q)
    return "\n".join(lines)


def render(report: Dict[str, Any], doc: Dict[str, Any]) -> str:
    out: List[str] = []
    meta = doc.get("meta") or {}
    out.append("SCHEDULE REPORT  %s" % (meta.get("title") or ""))
    out.append("Generated %s (%s) by %s; %s" % (meta.get("generatedAt"), meta.get("timezone"),
                                               (meta.get("generator") or {}).get("name"),
                                               "basedOn %s" % meta["basedOn"] if meta.get("basedOn") else "no basedOn (a fresh file)"))
    out.append("Now: %s   Days shown: %s to %s" % (report["now"], report["range"][0], report["range"][1]))
    s = report["settings"]
    out.append("Settings: sessions %s-%s, break %s, daily max %s, date-only due = %s" % (
        dur(s["minSessionMinutes"]), dur(s["maxSessionMinutes"]), dur(s["breakMinutes"]),
        dur(s["maxDailyStudyMinutes"]) if s["maxDailyStudyMinutes"] is not None else "none", s["defaultDueTime"]))
    out.append("")
    out.append("DAYS                 free(after now)  planned  done  sessions  notes")
    for d in report["days"]:
        free = "n/a" if d["freeAfterNow"] is None else dur(d["freeAfterNow"])
        out.append("  %-14s %15s %8s %5s %9s  %s" % (day_label(d["date"]) + " " + d["date"][:4], free, dur(d["planned"]) if d["planned"] else "-",
                                                     dur(d["done"]) if d["done"] else "-", d["sessions"] or "-", "; ".join(d["notes"])))
        for marker in d["markers"]:
            out.append("  %14s   %s" % ("", marker))
    out.append("")
    out.append("ASSIGNMENTS (section 8.1)        estimate remaining scheduled unscheduled  sessions/days")
    for a in report["assignments"]:
        date = a.get("assessmentDate") if a.get("assessmentDate") and not a.get("due") else a.get("due")
        if a["excluded"]:
            out.append("  - %s [%s] (%s): not counted (%s)" % (a["label"], a["id"], when(date), a["excluded"]))
            continue
        out.append("  - %s [%s] %s %s: %s / %s / %s / %s  %d/%d%s" % (
            a["label"], a["id"], a["type"], when(date), dur(a["estimate"]), dur(a["remaining"]), dur(a["scheduled"]),
            dur(a["unscheduled"]), a["sessions"], len(a["plannedDays"]),
            "  <- UNSCHEDULED WORK" if a["unscheduled"] else ""))
    if report["feasibility"]:
        out.append("")
        out.append("FEASIBILITY (earliest deadline first)")
        for f in report["feasibility"]:
            out.append("  - by %s: %s of work due (cumulative) but %s of free time -> not possible as is" % (
                f["deadline"], dur(f["workDue"]), dur(f["freeTime"])))
    out.append("")
    out.append("PROBLEMS (%d)" % len(report["problems"]))
    for p in report["problems"]:
        out.append("  - [%s] %s" % (p["kind"], p["message"]))
    if "changes" in report:
        c = report["changes"]
        out.append("")
        out.append("CHANGES SINCE THE PREVIOUS SCHEDULE")
        for a in c["assignmentsAdded"]:
            out.append("  + %s (%s %s)" % (a["label"], a["kind"], when(a.get("date"))))
        for a in c["assignmentsUpdated"]:
            out.append("  ~ %s: %s" % (a["label"], "; ".join(a["details"])))
        for a in c["assignmentsRemoved"]:
            out.append("  - %s [%s]" % (a["title"], a["id"]))
        for text in c["other"]:
            out.append("  * " + text)
        bl = c["blocks"]
        out.append("  Blocks: %d added (%s), %d removed (%s), %d moved, %d status changes" % (
            bl["added"], dur(bl["addedMinutes"]), bl["removed"], dur(bl["removedMinutes"]), bl["moved"], bl["statusChanged"]))
        if c["newIssues"]:
            out.append("  New open issues: %d" % len(c["newIssues"]))
        out.append("")
        out.append("UPDATE-RULE CHECK (section 15): %d violation(s), %d warning(s)" % (
            len(report["violations"]), len(report["updateWarnings"])))
        for text in report["violations"]:
            out.append("  VIOLATION: " + text)
        for text in report["updateWarnings"]:
            out.append("  check: " + text)
    out.append("")
    out.append("DRAFT SUMMARY (edit before giving it to the person)")
    out.append(report["summary"])
    return "\n".join(out) + "\n"


def load(path: str) -> Tuple[Optional[Dict[str, Any]], Any]:
    result = V.validate_file(path)
    if result.ok:
        return result.doc, result
    return None, result


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Report on a schedule file (and compare it with the previous one).")
    parser.add_argument("schedule")
    parser.add_argument("--previous", help="the schedule.json this file was made from (update mode)")
    parser.add_argument("--now", help="reference time YYYY-MM-DDTHH:MM (default: meta.generatedAt, else now)")
    parser.add_argument("--from", dest="start", help="first day to show (default: the day of --now)")
    parser.add_argument("--days", type=int, default=0, help="number of days to show (default: up to the last deadline, max 42)")
    parser.add_argument("--json", action="store_true", help="print JSON")
    parser.add_argument("--check", action="store_true", help="exit 1 if the file is invalid or breaks an update rule")
    args = parser.parse_args(argv)
    doc, result = load(args.schedule)
    if doc is None:
        sys.stdout.write("The schedule is not valid; fix these errors first (validate_schedule.py lists them all):\n")
        for e in result.errors[:30]:
            sys.stdout.write("  error %s: %s\n" % (e["path"] or "(root)", e["message"]))
        return 1
    prev = None
    if args.previous:
        prev, _result = load(args.previous)
        if prev is None:
            try:
                with open(args.previous, "rb") as handle:
                    prev = json.loads(handle.read().decode("utf-8-sig"))
                sys.stderr.write("note: the previous schedule is not valid; comparing anyway.\n")
            except (OSError, ValueError):
                sys.stderr.write("error: cannot read the previous schedule.\n")
                return 1
            if not isinstance(prev, dict):
                sys.stderr.write("error: the previous schedule is not a JSON object.\n")
                return 1
    meta = doc.get("meta") or {}
    now = args.now or meta.get("generatedAt") or dt.datetime.now().strftime("%Y-%m-%dT%H:%M:00")
    if len(now) == 16:
        now += ":00"
    if not V.LDT_RE.fullmatch(now) or not V.is_valid_date(now[:10]):
        parser.error("--now must be YYYY-MM-DDTHH:MM")
    start = args.start or now[:10]
    if not V.is_valid_date(start):
        parser.error("--from must be YYYY-MM-DD")
    report = build_report(doc, now, start, args.days, prev)
    if args.json:
        sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    else:
        sys.stdout.write(render(report, doc))
    if args.check and report.get("violations"):
        return 1
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="backslashreplace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
