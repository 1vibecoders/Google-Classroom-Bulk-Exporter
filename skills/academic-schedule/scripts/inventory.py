#!/usr/bin/env python3
"""Inventory the academic materials given to the /academic-schedule skill.

Given Google Classroom export ZIPs (single class or "Export all classes"),
extracted export folders and loose files (syllabi, calendars, PDFs, DOCX,
images, schedule.json, ...), this script:

  * extracts ZIP files safely into a work directory (no absolute paths, no
    "..", no symbolic links, size and file-count limits; audio/video files are
    listed but not extracted unless --extract-media is given);
  * finds every Classroom class folder (every class-info.json, in both ZIP
    layouts) and every export-manifest.json;
  * lists each class (name, section, teacher, course id, topics, options,
    export time, completeness for "missing" detection) and each item (type,
    title, due/posted text exactly as displayed plus the inferred date, topic,
    points, folder, description excerpt, attachments with sizes);
  * extracts the text of attachments and documents (.docx, .pptx, .xlsx,
    .odt/.odp/.ods, .txt/.md/.csv, .html, .rtf, .ics; .pdf through `pdftotext`
    when it is installed) into <workdir>/text/ so that every word can be read;
  * recognizes schedule.json files and validates them.

It writes <workdir>/inventory.json (structured) and <workdir>/inventory.txt
(readable, complete) and prints a short overview (or everything with --full,
or the JSON with --json).

Nothing from the inputs is ever executed or imported. The only external
program used is `pdftotext`/`pdfinfo` (if installed) to read PDF text.

Usage:
  python3 -I inventory.py INPUT [INPUT ...] [--workdir DIR] [--timezone ZONE]
        [--full | --json] [--extract-media] [--max-total-mb N] [--max-files N]

Python 3.8+ standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html.parser
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from typing import Any, Dict, List, Optional, Tuple

INVENTORY_VERSION = 1
MAX_JSON_BYTES = 50 * 1024 * 1024
MAX_XML_BYTES = 60 * 1024 * 1024
MAX_TEXT_CHARS = 20 * 1000 * 1000
MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024
PDF_TIMEOUT = 120

HERE = os.path.dirname(os.path.abspath(__file__))


def _load_sibling(name: str) -> Any:
    """Load a script next to this one by its path (works with python3 -I, never searches sys.path)."""
    path = os.path.join(HERE, name + ".py")
    spec = importlib.util.spec_from_file_location("academic_schedule_" + name, path)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = module  # type: ignore[union-attr]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


ids = _load_sibling("ids")

MEDIA_EXT = {".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".wmv"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".bmp", ".tif", ".tiff", ".svg"}
TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".tsv", ".text", ".log"}
HTML_EXT = {".html", ".htm", ".xhtml"}
LEGACY_OFFICE = {".doc", ".ppt", ".xls", ".pages", ".key", ".numbers"}
EXPORT_ROOT_FILES = {"class-info.json", "class-description.txt", "export-report.txt", "export-report.json",
                     "index.html", "export-manifest.json"}
TYPE_FOLDERS = {"Assignments": "assignment", "Materials": "material", "Questions": "question",
                "Announcements": "announcement", "Other Coursework": "other"}
ROLE = {"assignment": "work", "question": "work", "other": "work", "material": "reference",
        "announcement": "announcement"}

# Export warnings that mean a list or an item may be incomplete (section 15.6).
INCOMPLETE_RE = re.compile(
    r"incomplete|may be missing|could not be read|could not be recognized|skipped|disappeared|"
    r"no classwork was found|not found on page|stopped loading", re.I)
ANNOUNCEMENT_GAP_RE = re.compile(r"announcement|stream", re.I)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def human_size(n: Optional[int]) -> str:
    if n is None:
        return "?"
    value = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return ("%d %s" % (value, unit)) if unit == "B" else ("%.1f %s" % (value, unit))
        value /= 1024
    return "%d B" % n


def read_json(path: str) -> Tuple[Any, Optional[str]]:
    try:
        if os.path.getsize(path) > MAX_JSON_BYTES:
            return None, "too large to read (%s)" % human_size(os.path.getsize(path))
        with open(path, "rb") as handle:
            return json.loads(handle.read().decode("utf-8-sig")), None
    except (OSError, ValueError, RecursionError) as exc:
        return None, "could not be read as JSON: %s" % exc


def read_text_file(path: str, limit: int = MAX_TEXT_FILE_BYTES) -> str:
    with open(path, "rb") as handle:
        raw = handle.read(limit)
    for encoding in ("utf-8-sig", "utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else ("utf-8-sig",):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("cp1252", errors="replace")


def excerpt(text: Optional[str], limit: int) -> str:
    if not text:
        return ""
    flat = re.sub(r"\s+", " ", text).strip()
    return flat if len(flat) <= limit else flat[: limit - 1].rstrip() + "\u2026"


def safe_name(name: str, limit: int = 80) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" ._") or "file"
    return cleaned[:limit]


def utc_to_local(iso: Optional[str], zone: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(local LocalDateTime 'YYYY-MM-DDTHH:MM:00' or None, note). exportedAt values are UTC ISO strings."""
    if not iso or not isinstance(iso, str):
        return None, None
    text = iso.strip().replace("Z", "+00:00")
    try:
        moment = dt.datetime.fromisoformat(text)
    except ValueError:
        m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?)", iso)
        if not m:
            return None, "unreadable time %r" % iso
        moment = dt.datetime.fromisoformat(m.group(1) + "+00:00")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    if zone:
        try:
            import zoneinfo
            local = moment.astimezone(zoneinfo.ZoneInfo(zone))
            return local.strftime("%Y-%m-%dT%H:%M:00"), None
        except Exception as exc:  # noqa: BLE001
            return None, "time zone %r unknown here (%s)" % (zone, exc)
    return None, "convert from UTC to the person's time zone (pass --timezone)"


def iso_date(value: Optional[str]) -> Optional[dt.date]:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Classroom display dates ("Oct 10, 11:59 PM", "Sep 12", "Tomorrow", ...)
# ---------------------------------------------------------------------------

MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5,
    "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
WEEKDAY_WORDS = r"(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)"
TIME_IN_TEXT = re.compile(r"(?<![0-9])([0-9]{1,2})(?:[:.]([0-9]{2}))?\s*([ap])\.?\s?m\.?(?![a-z])|(?<![0-9])([0-9]{1,2})[:.]([0-9]{2})(?![0-9])", re.I)
YEAR_IN_TEXT = re.compile(r"(?<![0-9])((?:19|20)[0-9]{2})(?![0-9])")
MONTH_DAY = re.compile(r"(?<![a-z])([a-z]{3,9})\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?(?![0-9])", re.I)
DAY_MONTH = re.compile(r"(?<![0-9])([0-9]{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?![a-z])", re.I)
RELATIVE = re.compile(r"(?<![a-z])(today|tomorrow|yesterday)(?![a-z])", re.I)


def infer_year(month: int, day: int, ref: dt.date, past: bool = False) -> Tuple[Optional[dt.date], bool, List[str]]:
    """The year that puts month/day closest to ref (section 14.2); ambiguous when two years are about equally close.

    past=True (posted/edited dates, ref = the export date): the latest such date that is not after the export
    (one day of tolerance for the time-zone difference), since nobody sees a post from the future.
    """
    candidates = []
    for year in (ref.year - 1, ref.year, ref.year + 1):
        try:
            d = dt.date(year, month, day)
        except ValueError:
            continue
        candidates.append((abs((d - ref).days), d))
    if not candidates:
        return None, False, []
    if past:
        earlier = [d for _, d in candidates if d <= ref + dt.timedelta(days=1)]
        if earlier:
            return max(earlier), False, []
    candidates.sort()
    best = candidates[0]
    ambiguous = len(candidates) > 1 and candidates[1][0] - best[0] < 31
    return best[1], ambiguous, [c[1].isoformat() for c in candidates[1:2]] if ambiguous else []


def parse_classroom_date(text: Optional[str], ref: Optional[dt.date], ref_label: str,
                         export_date: Optional[dt.date], past: bool = False) -> Optional[Dict[str, Any]]:
    """Read a date as Classroom displays it. Returns the text plus the interpretation (never authoritative)."""
    if not text or not isinstance(text, str):
        return None
    out: Dict[str, Any] = {"text": text}
    s = text.strip()
    if re.fullmatch(r"no due date", s, re.I):
        out["none"] = True
        return out
    s = re.sub(r"\(?\s*edited:?[^)]*\)?", " ", s, flags=re.I)
    s = re.sub(r"^\s*(due|posted|created|assigned|edited|scheduled(?: for)?)\s*(on\s+)?:?\s*", "", s, flags=re.I)
    rest = s
    time = None
    m = TIME_IN_TEXT.search(rest)
    if m:
        if m.group(3):
            hour, minute = int(m.group(1)), int(m.group(2) or 0)
            if hour > 12 or minute > 59:
                hour = -1
            else:
                hour = hour % 12 + (12 if m.group(3).lower() == "p" else 0)
        else:
            hour, minute = int(m.group(4)), int(m.group(5))
            if hour > 23 or minute > 59:
                hour = -1
        if hour >= 0:
            time = "%02d:%02d" % (hour, minute)
            rest = rest[: m.start()] + " " + rest[m.end():]
    year = None
    m = YEAR_IN_TEXT.search(rest)
    if m:
        year = int(m.group(1))
        rest = rest[: m.start()] + " " + rest[m.end():]
    month = day = None
    relative = None
    m = RELATIVE.search(rest)
    if m:
        relative = m.group(1).lower()
        rest = rest[: m.start()] + " " + rest[m.end():]
    else:
        for pattern, month_group, day_group in ((MONTH_DAY, 1, 2), (DAY_MONTH, 2, 1)):
            m = pattern.search(rest)
            if m and m.group(month_group).lower() in MONTHS:
                month, day = MONTHS[m.group(month_group).lower()], int(m.group(day_group))
                rest = rest[: m.start()] + " " + rest[m.end():]
                break
    leftover = re.sub(WEEKDAY_WORDS + r"\.?", " ", rest, flags=re.I)
    leftover = re.sub(r"[\s,]|\bat\b", "", leftover, flags=re.I)
    if leftover or (month is None and relative is None and time is None):
        out["note"] = "could not read this date; read description.txt and decide"
        return out
    out["time"] = time
    date = None
    if relative:
        if export_date is None:
            out["note"] = "relative date and unknown export date"
            return out
        date = export_date + dt.timedelta(days={"today": 0, "tomorrow": 1, "yesterday": -1}[relative])
        out["year"] = "relative"
        out["basis"] = "%s relative to the export date %s" % (relative, export_date.isoformat())
    elif month is not None:
        if year is not None:
            try:
                date = dt.date(year, month, day)
            except ValueError:
                out["note"] = "not a real date"
                return out
            out["year"] = "explicit"
        elif ref is not None:
            date, ambiguous, alternatives = infer_year(month, day, ref, past)
            if date is None:
                out["note"] = "not a real date"
                return out
            out["year"] = "inferred"
            out["basis"] = ("latest not after the %s %s" if past else "closest to the %s %s") % (ref_label, ref.isoformat())
            if ambiguous:
                out["ambiguous"] = True
                out["alternatives"] = alternatives
        else:
            out["note"] = "no year and nothing to infer it from"
            return out
    else:  # time only: Classroom shows only the time for today
        if export_date is None:
            out["note"] = "time only and unknown export date"
            return out
        date = export_date
        out["year"] = "relative"
        out["basis"] = "time only, so the export date %s" % export_date.isoformat()
    out["date"] = date.isoformat()
    out["value"] = "%sT%s:00" % (out["date"], time) if time else out["date"]
    return out


# ---------------------------------------------------------------------------
# Safe ZIP extraction
# ---------------------------------------------------------------------------

class Limits:
    def __init__(self, max_total_bytes: int, max_files: int, max_file_bytes: int, extract_media: bool) -> None:
        self.max_total_bytes = max_total_bytes
        self.max_files = max_files
        self.max_file_bytes = max_file_bytes
        self.extract_media = extract_media
        self.total_bytes = 0
        self.files = 0


def _inside(path: str, folder: str) -> bool:
    """True if path (after resolving symbolic links) is folder or inside it."""
    real, base = os.path.realpath(path), os.path.realpath(folder)
    return real == base or real.startswith(base + os.sep)


def _zip_member_parts(name: str) -> Optional[List[str]]:
    """Safe relative path parts of a ZIP member name, or None if it must be skipped."""
    name = name.replace("\\", "/")
    if name.startswith("/") or re.match(r"[A-Za-z]:", name):
        return None
    parts = [p for p in name.split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or any("\x00" in p for p in parts):
        return None
    return parts


def looks_like_classroom_zip(path: str) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            return any(n.replace("\\", "/").rsplit("/", 1)[-1] in ("class-info.json", "export-manifest.json")
                       for n in zf.namelist())
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError):
        return False


def safe_extract(zip_path: str, dest: str, limits: Limits) -> Dict[str, Any]:
    """Extract zip_path into dest without ever writing outside dest. Returns notes and skipped members."""
    report: Dict[str, Any] = {"notes": [], "skipped": {}, "files": 0, "bytes": 0}
    os.makedirs(dest, exist_ok=True)
    root = os.path.realpath(dest)
    try:
        zf = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError) as exc:
        report["notes"].append("not a readable ZIP file: %s" % exc)
        return report
    with zf:
        for info in zf.infolist():
            parts = _zip_member_parts(info.filename)
            if parts is None:
                report["notes"].append("skipped unsafe path %r" % info.filename)
                continue
            if not parts:
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode == stat.S_IFLNK:
                report["notes"].append("skipped symbolic link %r" % info.filename)
                continue
            target = os.path.join(root, *parts)
            real_parent = os.path.realpath(os.path.dirname(target))
            if real_parent != root and not real_parent.startswith(root + os.sep):
                report["notes"].append("skipped path outside the folder %r" % info.filename)
                continue
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            rel = "/".join(parts)
            ext = os.path.splitext(parts[-1])[1].lower()
            if info.flag_bits & 0x1:
                report["skipped"][rel] = {"size": info.file_size, "reason": "encrypted"}
                continue
            if ext in MEDIA_EXT and not limits.extract_media:
                report["skipped"][rel] = {"size": info.file_size, "reason": "audio/video not extracted (use --extract-media)"}
                continue
            if info.file_size > limits.max_file_bytes:
                report["skipped"][rel] = {"size": info.file_size, "reason": "larger than the per-file limit"}
                continue
            if info.compress_size and info.file_size > 100 * 1024 * 1024 and info.file_size / info.compress_size > 200:
                report["skipped"][rel] = {"size": info.file_size, "reason": "suspicious compression ratio"}
                continue
            if limits.files + 1 > limits.max_files:
                report["notes"].append("stopped: more than %d files" % limits.max_files)
                break
            if limits.total_bytes + info.file_size > limits.max_total_bytes:
                report["notes"].append("stopped: more than %s in total" % human_size(limits.max_total_bytes))
                break
            os.makedirs(os.path.dirname(target), exist_ok=True)
            written = 0
            try:
                with zf.open(info) as src, open(target, "xb") as dst:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > info.file_size or written > limits.max_file_bytes:
                            raise ValueError("member is larger than its header says")
                        dst.write(chunk)
            except FileExistsError:
                report["notes"].append("duplicate member skipped %r" % info.filename)
                continue
            except (ValueError, zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError, EOFError) as exc:
                report["notes"].append("could not extract %r: %s" % (info.filename, exc))
                try:
                    os.remove(target)
                except OSError:
                    pass
                continue
            limits.files += 1
            limits.total_bytes += written
            report["files"] += 1
            report["bytes"] += written
    return report


# ---------------------------------------------------------------------------
# Text extraction (data only: XML without DTDs, HTML parsed as text)
# ---------------------------------------------------------------------------

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _xml(zf: zipfile.ZipFile, name: str) -> Optional[ET.Element]:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_XML_BYTES:
        raise ValueError("%s is too large" % name)
    data = zf.read(info)
    if b"<!DOCTYPE" in data or b"<!ENTITY" in data:
        raise ValueError("%s contains a DTD; not parsed" % name)
    return ET.fromstring(data)


def _docx_paragraph(p: ET.Element) -> str:
    parts = []
    for el in p.iter():
        if el.tag == W + "t" and el.text:
            parts.append(el.text)
        elif el.tag == W + "tab":
            parts.append("\t")
        elif el.tag in (W + "br", W + "cr"):
            parts.append("\n")
    text = "".join(parts)
    if p.find("./%spPr/%snumPr" % (W, W)) is not None:
        text = "- " + text
    return text


def _docx_block(el: ET.Element, lines: List[str]) -> None:
    for child in el:
        if child.tag == W + "p":
            lines.append(_docx_paragraph(child))
        elif child.tag == W + "tbl":
            for row in child.iter(W + "tr"):
                cells = []
                for cell in row.findall(W + "tc"):
                    cells.append(" ".join(_docx_paragraph(p) for p in cell.iter(W + "p")).strip())
                lines.append(" | ".join(cells))
            lines.append("")
        else:
            _docx_block(child, lines)


def extract_docx(path: str) -> Tuple[str, Dict[str, Any]]:
    info: Dict[str, Any] = {}
    with zipfile.ZipFile(path) as zf:
        doc = _xml(zf, "word/document.xml")
        if doc is None:
            raise ValueError("no word/document.xml")
        lines: List[str] = []
        body = doc.find(W + "body")
        _docx_block(body if body is not None else doc, lines)
        for part, label in (("word/footnotes.xml", "Footnotes"), ("word/endnotes.xml", "Endnotes")):
            notes = _xml(zf, part)
            if notes is not None:
                texts = [_docx_paragraph(p) for p in notes.iter(W + "p")]
                texts = [t for t in texts if t.strip()]
                if texts:
                    lines += ["", "[%s]" % label] + texts
        app = _xml(zf, "docProps/app.xml")
        if app is not None:
            for el in app:
                tag = el.tag.split("}")[-1]
                if tag in ("Pages", "Words", "Characters") and (el.text or "").strip().isdigit():
                    info[tag.lower()] = int(el.text.strip())
    return "\n".join(lines), info


def _slide_text(root: ET.Element) -> List[str]:
    out = []
    for p in root.iter(A + "p"):
        text = "".join(t.text or "" for t in p.iter(A + "t"))
        if text.strip():
            out.append(text)
    return out


def extract_pptx(path: str) -> Tuple[str, Dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        slides = sorted((int(m.group(1)), n) for n in names for m in [re.fullmatch(r"ppt/slides/slide([0-9]+)\.xml", n)] if m)
        lines: List[str] = []
        for number, name in slides:
            lines.append("--- Slide %d ---" % number)
            root = _xml(zf, name)
            lines += _slide_text(root) if root is not None else []
            notes = _xml(zf, "ppt/notesSlides/notesSlide%d.xml" % number)
            if notes is not None:
                note_lines = [t for t in _slide_text(notes) if not re.fullmatch(r"[0-9]+", t.strip())]
                if note_lines:
                    lines.append("[Speaker notes] " + " ".join(note_lines))
    return "\n".join(lines), {"slides": len(slides)}


def extract_xlsx(path: str) -> Tuple[str, Dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        shared: List[str] = []
        sst = _xml(zf, "xl/sharedStrings.xml")
        if sst is not None:
            for si in sst.findall(S + "si"):
                shared.append("".join(t.text or "" for t in si.iter(S + "t")))
        workbook = _xml(zf, "xl/workbook.xml")
        sheet_names = [s.get("name") or "" for s in workbook.iter(S + "sheet")] if workbook is not None else []
        files = sorted((int(m.group(1)), n) for n in zf.namelist()
                       for m in [re.fullmatch(r"xl/worksheets/sheet([0-9]+)\.xml", n)] if m)
        lines: List[str] = []
        for index, (number, name) in enumerate(files):
            label = sheet_names[index] if index < len(sheet_names) else "Sheet %d" % number
            lines.append("--- Sheet: %s ---" % label)
            root = _xml(zf, name)
            if root is None:
                continue
            for row_count, row in enumerate(root.iter(S + "row")):
                if row_count >= 2000:
                    lines.append("... (more rows)")
                    break
                values = []
                for c in row.findall(S + "c"):
                    t = c.get("t")
                    v = c.find(S + "v")
                    if t == "s" and v is not None and (v.text or "").isdigit() and int(v.text) < len(shared):
                        values.append(shared[int(v.text)])
                    elif t == "inlineStr":
                        values.append("".join(x.text or "" for x in c.iter(S + "t")))
                    elif v is not None and v.text is not None:
                        values.append(v.text)
                if any(x.strip() for x in values):
                    lines.append("\t".join(values))
    return "\n".join(lines), {"sheets": len(files)}


def extract_odf(path: str) -> Tuple[str, Dict[str, Any]]:
    with zipfile.ZipFile(path) as zf:
        root = _xml(zf, "content.xml")
        if root is None:
            raise ValueError("no content.xml")
        lines = []
        for el in root.iter():
            local = el.tag.split("}")[-1]
            if local in ("p", "h"):
                text = "".join(el.itertext())
                if text.strip():
                    lines.append(text)
    return "\n".join(lines), {}


class _HTMLText(html.parser.HTMLParser):
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article", "ul", "ol"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("script", "style", "noscript", "template"):
            self.skip += 1
        elif tag in self.BLOCK:
            self.parts.append("\n")
        elif tag in ("td", "th"):
            self.parts.append(" | ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "template"):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def extract_html(path: str) -> Tuple[str, Dict[str, Any]]:
    parser = _HTMLText()
    parser.feed(read_text_file(path))
    parser.close()
    text = re.sub(r"[ \t]+", " ", "".join(parser.parts))
    return re.sub(r"\n\s*\n+", "\n\n", text).strip(), {}


def extract_rtf(path: str) -> Tuple[str, Dict[str, Any]]:
    raw = read_text_file(path)
    text = re.sub(r"\{\\\*[^{}]*\}", "", raw)
    text = re.sub(r"\\par[d]?\b", "\n", text)
    text = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: bytes.fromhex(m.group(1)).decode("cp1252", "replace"), text)
    text = re.sub(r"\\[a-zA-Z]+-?[0-9]* ?", "", text)
    text = text.replace("{", "").replace("}", "")
    return text.strip(), {"note": "RTF text approximated"}


def _ics_unfold(text: str) -> List[str]:
    lines: List[str] = []
    for line in text.splitlines():
        if line[:1] in (" ", "\t") and lines:
            lines[-1] += line[1:]
        else:
            lines.append(line)
    return lines


def extract_ics(path: str) -> Tuple[str, Dict[str, Any]]:
    events: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    for line in _ics_unfold(read_text_file(path)):
        if line.upper() == "BEGIN:VEVENT":
            current = {}
        elif line.upper() == "END:VEVENT":
            if current is not None:
                events.append(current)
            current = None
        elif current is not None and ":" in line:
            key, value = line.split(":", 1)
            name = key.split(";", 1)[0].upper()
            if name in ("SUMMARY", "DTSTART", "DTEND", "RRULE", "LOCATION", "DESCRIPTION", "EXDATE", "STATUS"):
                current[name] = (current.get(name, "") + ("," if name == "EXDATE" and name in current else "") + value)[:2000]
                if key.upper().startswith(("DTSTART;", "DTEND;")) and "TZID=" in key.upper():
                    current[name + "_TZID"] = key.split("TZID=", 1)[1].split(";")[0]
    lines = ["%d calendar events" % len(events)]
    for e in events:
        lines.append(" | ".join("%s: %s" % (k, v.replace("\\n", " ").replace("\\,", ",")) for k, v in e.items()))
    return "\n".join(lines), {"events": len(events), "eventList": events[:300]}


def extract_pdf(path: str, text_path: str) -> Tuple[Optional[str], Dict[str, Any]]:
    info: Dict[str, Any] = {}
    pdfinfo = shutil.which("pdfinfo")
    if pdfinfo:
        try:
            res = subprocess.run([pdfinfo, path], capture_output=True, timeout=PDF_TIMEOUT, check=False)
            m = re.search(rb"^Pages:\s+([0-9]+)", res.stdout, re.M)
            if m:
                info["pages"] = int(m.group(1))
        except (OSError, subprocess.SubprocessError):
            pass
    tool = shutil.which("pdftotext")
    if not tool:
        info["note"] = "pdftotext is not installed: read this PDF directly (or install poppler-utils)"
        return None, info
    try:
        res = subprocess.run([tool, "-layout", "-enc", "UTF-8", "-q", path, text_path],
                             capture_output=True, timeout=PDF_TIMEOUT, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        info["note"] = "pdftotext failed (%s): read this PDF directly" % exc
        return None, info
    if res.returncode != 0 or not os.path.exists(text_path):
        info["note"] = "pdftotext could not read it (exit %d): read this PDF directly" % res.returncode
        return None, info
    text = read_text_file(text_path)
    os.remove(text_path)
    pages = info.get("pages") or max(1, text.count("\f"))
    if len(text.strip()) < 40 * pages:
        info["note"] = "little or no text: probably scanned or handwritten; look at the PDF pages directly"
    return text, info


def classify(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return "pdf"
    if ext in (".docx", ".docm", ".dotx"):
        return "docx"
    if ext in (".pptx", ".pptm"):
        return "pptx"
    if ext in (".xlsx", ".xlsm"):
        return "xlsx"
    if ext in (".odt", ".odp", ".ods"):
        return "odf"
    if ext in TEXT_EXT:
        return "text"
    if ext in HTML_EXT:
        return "html"
    if ext == ".rtf":
        return "rtf"
    if ext in (".ics", ".ical", ".ifb"):
        return "calendar"
    if ext == ".json":
        return "json"
    if ext == ".url":
        return "link"
    if ext in IMAGE_EXT:
        return "image"
    if ext in MEDIA_EXT:
        return "media"
    if ext == ".zip":
        return "zip"
    if ext in LEGACY_OFFICE:
        return "legacy-office"
    return "other"


class TextStore:
    """Writes extracted text into <workdir>/text/ and remembers the files."""

    def __init__(self, workdir: str) -> None:
        self.dir = os.path.join(workdir, "text")
        os.makedirs(self.dir, exist_ok=True)
        self.count = 0

    def extract(self, path: str, label: str) -> Dict[str, Any]:
        kind = classify(path)
        result: Dict[str, Any] = {"kind": kind}
        self.count += 1
        target = os.path.join(self.dir, "%04d-%s.txt" % (self.count, safe_name(os.path.basename(path))))
        text: Optional[str] = None
        try:
            if kind == "pdf":
                text, info = extract_pdf(path, target + ".tmp")
                result.update(info)
            elif kind == "docx":
                text, info = extract_docx(path)
                result.update(info)
            elif kind == "pptx":
                text, info = extract_pptx(path)
                result.update(info)
            elif kind == "xlsx":
                text, info = extract_xlsx(path)
                result.update(info)
            elif kind == "odf":
                text, info = extract_odf(path)
            elif kind == "text":
                text = read_text_file(path)
            elif kind == "html":
                text, info = extract_html(path)
            elif kind == "rtf":
                text, info = extract_rtf(path)
                result.update(info)
            elif kind == "calendar":
                text, info = extract_ics(path)
                result.update(info)
            elif kind == "link":
                raw = read_text_file(path, 64 * 1024)
                m = re.search(r"^URL=(.+)$", raw, re.M)
                result["url"] = m.group(1).strip() if m else None
                result["note"] = "a link, not a file; the target is not downloaded"
            elif kind == "image":
                result["note"] = "image: look at it directly (photos of whiteboards, planners and schedules matter)"
            elif kind == "media":
                result["note"] = "audio/video: cannot be read; rely on the title and the item's instructions"
            elif kind == "legacy-office":
                result["note"] = "old Office/iWork format: try reading it directly; ask for a PDF if it matters"
            elif kind == "zip":
                result["note"] = "a ZIP inside the inputs; run inventory.py on it if it may be relevant"
            elif kind == "json":
                pass  # handled by the caller (schedule files)
            else:
                result["note"] = "unknown type: open it directly if it may be relevant"
        except (ValueError, zipfile.BadZipFile, ET.ParseError, OSError, KeyError, RuntimeError, NotImplementedError) as exc:
            result["note"] = "text could not be extracted (%s): open it directly" % exc
            text = None
        if text is not None:
            text = text[:MAX_TEXT_CHARS]
            result["textChars"] = len(text)
            result["words"] = result.get("words") or len(text.split())
            if text.strip():
                with open(target, "w", encoding="utf-8") as handle:
                    handle.write("# Text extracted from: %s\n\n" % label)
                    handle.write(text)
                result["textFile"] = target
            elif "note" not in result:
                result["note"] = "no text found: open it directly"
        return result


# ---------------------------------------------------------------------------
# Classroom exports
# ---------------------------------------------------------------------------

def _warning_messages(values: Any) -> List[str]:
    out = []
    for w in values if isinstance(values, list) else []:
        if isinstance(w, str):
            out.append(w)
        elif isinstance(w, dict) and isinstance(w.get("message"), str):
            title = w.get("itemTitle")
            out.append(("%s: %s" % (title, w["message"])) if title else w["message"])
    return out


class Inventory:
    def __init__(self, workdir: str, zone: Optional[str], limits: Limits, excerpt_chars: int) -> None:
        self.workdir = workdir
        self.zone = zone
        self.limits = limits
        self.excerpt_chars = excerpt_chars
        self.text = TextStore(workdir)
        self.inputs: List[Dict[str, Any]] = []
        self.roots: List[Tuple[str, str]] = []  # (absolute root, label)
        self.skipped_members: Dict[str, Dict[str, Any]] = {}  # absolute would-be path -> info
        self.exports: List[Dict[str, Any]] = []
        self.classes: List[Dict[str, Any]] = []
        self.documents: List[Dict[str, Any]] = []
        self.schedules: List[Dict[str, Any]] = []
        self.problems: List[str] = []
        self.claimed: set = set()

    # -- inputs ------------------------------------------------------------
    def add_input(self, path: str) -> None:
        entry: Dict[str, Any] = {"path": path}
        self.inputs.append(entry)
        if not os.path.exists(path):
            entry["kind"] = "missing"
            self.problems.append("Input not found: %s" % path)
            return
        if os.path.isdir(path):
            entry["kind"] = "folder"
            self.roots.append((os.path.abspath(path), os.path.basename(os.path.abspath(path))))
            return
        if classify(path) in ("zip", "other") and zipfile.is_zipfile(path):  # not .docx/.pptx/.xlsx/...
            entry["kind"] = "zip"
            dest = os.path.join(self.workdir, "extracted", "%02d-%s" % (len(self.inputs), safe_name(
                os.path.splitext(os.path.basename(path))[0], 60)))
            report = safe_extract(path, dest, self.limits)
            entry.update({"extractedTo": dest, "files": report["files"], "bytes": report["bytes"],
                          "notes": report["notes"]})
            for rel, info in report["skipped"].items():
                self.skipped_members[os.path.join(dest, *rel.split("/"))] = info
            if report["skipped"]:
                entry["notExtracted"] = len(report["skipped"])
            self.roots.append((dest, os.path.basename(path)))
            self._extract_nested_exports(dest, entry)
            return
        entry["kind"] = "file"
        self.roots.append((os.path.abspath(path), os.path.basename(path)))

    def _extract_nested_exports(self, folder: str, entry: Dict[str, Any]) -> None:
        """A ZIP that contains Classroom export ZIPs (one level) is unpacked too."""
        for dirpath, _dirnames, filenames in os.walk(folder):
            for name in filenames:
                full = os.path.join(dirpath, name)
                if name.lower().endswith(".zip") and looks_like_classroom_zip(full):
                    dest = os.path.splitext(full)[0] + " (extracted)"
                    report = safe_extract(full, dest, self.limits)
                    entry.setdefault("nested", []).append({"zip": full, "extractedTo": dest, "notes": report["notes"]})
                    for rel, info in report["skipped"].items():
                        self.skipped_members[os.path.join(dest, *rel.split("/"))] = info
                    self.claimed.add(os.path.realpath(full))

    # -- scanning ------------------------------------------------------------
    def _walk(self, root: str) -> List[str]:
        if os.path.isfile(root):
            return [root]
        files = []
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not os.path.islink(os.path.join(dirpath, d)))
            for name in sorted(filenames):
                full = os.path.join(dirpath, name)
                if not os.path.islink(full):
                    files.append(full)
        return files

    def scan(self) -> None:
        all_files: List[Tuple[str, str, str]] = []  # (file, root, root label)
        for root, label in self.roots:
            for f in self._walk(root):
                all_files.append((f, root, label))
        manifests = [(f, root, label) for f, root, label in all_files if os.path.basename(f) == "export-manifest.json"]
        class_infos = [(f, root, label) for f, root, label in all_files if os.path.basename(f) == "class-info.json"]
        manifest_by_dir: Dict[str, Dict[str, Any]] = {}
        for f, root, label in manifests:
            data, error = read_json(f)
            folder = os.path.dirname(f)
            record: Dict[str, Any] = {"manifest": f, "folder": folder, "input": label}
            if error or not isinstance(data, dict):
                record["error"] = error or "not an object"
            else:
                record.update({"kind": data.get("kind"), "exportedAt": data.get("exportedAt"),
                               "accountIndex": data.get("accountIndex"), "options": data.get("options"),
                               "totals": data.get("totals"), "classes": data.get("classes") or []})
                local, note = utc_to_local(data.get("exportedAt"), self.zone)
                record["exportedAtLocal"] = local
                if note:
                    record["exportedAtNote"] = note
            manifest_by_dir[folder] = record
            self.exports.append(record)
            self.claimed.add(os.path.realpath(f))
            if record.get("kind") == "account":
                for name in ("index.html", "export-report.txt"):
                    self.claimed.add(os.path.realpath(os.path.join(folder, name)))
        seen_folders = set()
        for f, root, label in class_infos:
            folder = os.path.dirname(f)
            seen_folders.add(os.path.realpath(folder))
            self.classes.append(self._read_class(folder, root, label, manifest_by_dir))
        # Classes an account manifest lists that have no class-info.json (failed or incomplete).
        for record in self.exports:
            if record.get("kind") != "account":
                continue
            for entry in record.get("classes", []):
                if not isinstance(entry, dict):
                    continue
                folder = entry.get("folder")
                path = os.path.join(record["folder"], folder) if isinstance(folder, str) and folder else None
                if path and os.path.realpath(path) in seen_folders:
                    continue
                self.classes.append(self._manifest_only_class(entry, record, path))
        claimed_dirs = [os.path.realpath(c["folder"]) + os.sep for c in self.classes if c.get("folder")]
        for f, root, label in all_files:
            real = os.path.realpath(f)
            if real in self.claimed or any(real.startswith(d) for d in claimed_dirs):
                continue
            self._read_document(f, root, label)
        for path, info in self.skipped_members.items():
            real = os.path.realpath(os.path.dirname(path))
            if any((real + os.sep).startswith(d) for d in claimed_dirs):
                continue
            self.documents.append({"path": path, "name": os.path.basename(path), "kind": classify(path),
                                   "size": info.get("size"), "note": "not extracted: %s" % info.get("reason")})

    def _manifest_for(self, folder: str, manifest_by_dir: Dict[str, Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        own = manifest_by_dir.get(folder)
        if own and own.get("kind") == "class":
            entry = next((c for c in own.get("classes", []) if isinstance(c, dict)), None)
            return own, entry
        parent = manifest_by_dir.get(os.path.dirname(folder))
        if parent and parent.get("kind") == "account":
            name = os.path.basename(folder)
            entry = next((c for c in parent.get("classes", []) if isinstance(c, dict) and c.get("folder") == name), None)
            return parent, entry
        return own, None

    def _manifest_only_class(self, entry: Dict[str, Any], record: Dict[str, Any], path: Optional[str]) -> Dict[str, Any]:
        course = entry.get("courseId")
        cls: Dict[str, Any] = {
            "name": entry.get("name"), "section": entry.get("section"), "teacher": entry.get("teacher"),
            "courseId": ids.classroom_id(course) if course else None,
            "suggestedClassId": ids.class_id(course) if course else None,
            "url": entry.get("url"), "folder": path if path and os.path.isdir(path) else None,
            "exportKind": "account", "manifest": record["manifest"], "status": entry.get("status"),
            "error": entry.get("error"), "exported": False, "items": [],
            "missingDetection": {"usable": False, "coversAnnouncements": False,
                                 "reasons": ["the class has no class-info.json (status %s%s)" % (
                                     entry.get("status"), ": " + entry["error"] if entry.get("error") else "")]},
        }
        if cls["folder"]:
            cls["note"] = "folder exists but class-info.json is missing: inspect the folder manually"
        else:
            cls["note"] = "not exported: ask the person to export this class on its own if it matters"
        return cls

    def _read_class(self, folder: str, root: str, label: str, manifest_by_dir: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        info, error = read_json(os.path.join(folder, "class-info.json"))
        info = info if isinstance(info, dict) else {}
        klass = info.get("class") if isinstance(info.get("class"), dict) else {}
        manifest, entry = self._manifest_for(folder, manifest_by_dir)
        course = klass.get("id") or (entry or {}).get("courseId")
        exported_at = info.get("exportedAt") or (manifest or {}).get("exportedAt")
        local, note = utc_to_local(exported_at, self.zone)
        export_day = iso_date(local) or iso_date(exported_at)
        report, report_error = read_json(os.path.join(folder, "export-report.json"))
        report = report if isinstance(report, dict) else {}
        description_path = os.path.join(folder, "class-description.txt")
        cls: Dict[str, Any] = {
            "name": klass.get("name") or (entry or {}).get("name"),
            "section": klass.get("section") or (entry or {}).get("section"),
            "teacher": (entry or {}).get("teacher"),
            "courseId": ids.classroom_id(course) if course else None,
            "suggestedClassId": ids.class_id(course) if course else None,
            "url": klass.get("url") or (entry or {}).get("url"),
            "details": klass.get("details") or [],
            "folder": folder,
            "input": label,
            "relativeFolder": os.path.relpath(folder, root) if os.path.isdir(root) else folder,
            "exportKind": (manifest or {}).get("kind") or ("account" if os.path.dirname(folder) in manifest_by_dir else "class"),
            "manifest": (manifest or {}).get("manifest"),
            "status": (entry or {}).get("status"),
            "error": (entry or {}).get("error"),
            "exported": True,
            "exportedAt": exported_at,
            "exportedAtLocal": local,
            "exporter": info.get("exporter"),
            "options": info.get("options") or (manifest or {}).get("options") or {},
            "topics": info.get("topics") or [],
            "counts": info.get("counts") or {},
            "classDescription": read_text_file(description_path) if os.path.exists(description_path) else None,
            "warnings": _warning_messages((info.get("discovery") or {}).get("warnings")) if isinstance(info.get("discovery"), dict) else [],
            "reportWarnings": _warning_messages(report.get("warnings")),
            "failedFiles": len(report.get("failures") or []) if isinstance(report.get("failures"), list) else None,
            "items": [],
        }
        if note:
            cls["exportedAtNote"] = note
        if error:
            cls["problems"] = ["class-info.json %s" % error]
        if report_error and not os.path.exists(os.path.join(folder, "export-report.json")):
            report_error = "is missing"
        listed = info.get("items") if isinstance(info.get("items"), list) else []
        seen = set()
        for listed_item in listed:
            if not isinstance(listed_item, dict) or not isinstance(listed_item.get("folder"), str):
                continue
            parts = _zip_member_parts(listed_item["folder"])
            if not parts:
                continue
            item_dir = os.path.join(folder, *parts)
            if not _inside(item_dir, folder):
                cls.setdefault("problems", []).append("item folder outside the class folder skipped: %s" % listed_item["folder"])
                continue
            seen.add(os.path.realpath(item_dir))
            cls["items"].append(self._read_item(item_dir, folder, root, listed_item, export_day))
        for type_folder, item_type in TYPE_FOLDERS.items():
            base = os.path.join(folder, type_folder)
            if not os.path.isdir(base):
                continue
            for name in sorted(os.listdir(base)):
                item_dir = os.path.join(base, name)
                if os.path.isdir(item_dir) and not os.path.islink(item_dir) and _inside(item_dir, folder) \
                        and os.path.realpath(item_dir) not in seen \
                        and os.path.exists(os.path.join(item_dir, "metadata.json")):
                    item = self._read_item(item_dir, folder, root, {"type": item_type, "folder": "%s/%s" % (type_folder, name)}, export_day)
                    item.setdefault("notes", []).append("not listed in class-info.json")
                    cls["items"].append(item)
        cls["missingDetection"] = self._missing_detection(cls, report_error)
        # Files in the class folder that belong to no item.
        known = {os.path.realpath(os.path.join(folder, n)) for n in EXPORT_ROOT_FILES}
        for dirpath, dirnames, filenames in os.walk(folder):
            dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
            for name in filenames:
                full = os.path.realpath(os.path.join(dirpath, name))
                if full in known or any(full.startswith(os.path.realpath(i["path"]) + os.sep) for i in cls["items"]):
                    continue
                cls.setdefault("otherFiles", []).append(os.path.join(dirpath, name))
        return cls

    def _missing_detection(self, cls: Dict[str, Any], report_error: Optional[str]) -> Dict[str, Any]:
        reasons = []
        if report_error:
            reasons.append("export-report.json %s" % report_error)
        if cls.get("exportKind") == "account":
            status, error = cls.get("status"), cls.get("error")
            if status not in ("exported", "partial") or (status == "partial" and error):
                reasons.append("manifest status %s%s" % (status, ": " + error if error else ""))
        incomplete = [w for w in cls.get("warnings", []) + cls.get("reportWarnings", []) if INCOMPLETE_RE.search(w)]
        reasons += ["export warning: %s" % w for w in incomplete]
        covers = bool((cls.get("options") or {}).get("includeAnnouncements")) and not any(
            ANNOUNCEMENT_GAP_RE.search(w) for w in incomplete)
        return {"usable": not reasons, "coversAnnouncements": covers and not reasons, "reasons": reasons}

    def _read_item(self, item_dir: str, class_folder: str, root: str, listed: Dict[str, Any], export_day: Optional[dt.date]) -> Dict[str, Any]:
        meta, error = read_json(os.path.join(item_dir, "metadata.json"))
        meta = meta if isinstance(meta, dict) else {}
        item_type = meta.get("type") or listed.get("type") or "other"
        title = meta.get("title") or listed.get("title")
        classroom_item = meta.get("classroomId")
        if not classroom_item and isinstance(meta.get("classroomUrl") or listed.get("classroomUrl"), str):
            m = re.search(r"/(?:a|m|sa|mc|q|c|p)/([A-Za-z0-9_-]+)(?:/details)?/?$", meta.get("classroomUrl") or listed.get("classroomUrl"))
            classroom_item = m.group(1) if m else None
        description = meta.get("description") if isinstance(meta.get("description"), str) else None
        desc_txt = os.path.join(item_dir, "description.txt")
        posted = parse_classroom_date(meta.get("postedText"), export_day, "export date", export_day, past=True)
        posted_day = iso_date(posted.get("date")) if posted else None
        due = parse_classroom_date(meta.get("dueText"), posted_day or export_day,
                                   "posted date" if posted_day else "export date", export_day)
        edited = parse_classroom_date(meta.get("editedText"), export_day, "export date", export_day, past=True)
        rel_root = root if os.path.isdir(root) else os.path.dirname(root)
        item: Dict[str, Any] = {
            "type": item_type,
            "role": ROLE.get(item_type, "work"),
            "title": title,
            "topic": meta.get("topic", listed.get("topic")),
            "classroomId": ids.classroom_id(classroom_item) if classroom_item else None,
            "suggestedId": ids.item_id(classroom_item) if classroom_item and item_type != "announcement" else None,
            "classroomUrl": meta.get("classroomUrl") or listed.get("classroomUrl"),
            "dueText": meta.get("dueText"),
            "pointsText": meta.get("pointsText"),
            "postedText": meta.get("postedText"),
            "editedText": meta.get("editedText"),
            "statusText": meta.get("statusText"),
            "due": due,
            "posted": posted,
            "edited": edited,
            "folder": listed.get("folder") or os.path.relpath(item_dir, class_folder),
            "path": item_dir,
            "sourcePath": os.path.relpath(os.path.join(item_dir, "metadata.json"), rel_root).replace(os.sep, "/"),
            "descriptionFile": desc_txt if os.path.exists(desc_txt) else None,
            "descriptionChars": len(description or ""),
            "descriptionExcerpt": excerpt(description, self.excerpt_chars),
            "extractionWarnings": [w for w in ((meta.get("extraction") or {}).get("warnings") or []) if isinstance(w, str)]
            if isinstance(meta.get("extraction"), dict) else [],
            "attachments": [],
        }
        if error:
            item["problems"] = ["metadata.json %s" % error]
        if not os.path.isdir(item_dir):
            item.setdefault("problems", []).append("item folder is missing")
        listed_files = set()
        for a in meta.get("attachments") or []:
            if not isinstance(a, dict):
                continue
            att: Dict[str, Any] = {k: a.get(k) for k in ("title", "type", "kind", "source", "status", "file",
                                                         "originalFilename", "contentType", "originalUrl", "note",
                                                         "error", "exportedAs") if a.get(k) is not None}
            att["size"] = a.get("size")
            rel = a.get("file")
            parts = _zip_member_parts(rel) if isinstance(rel, str) else None
            if parts and not _inside(os.path.join(item_dir, *parts), item_dir):
                att["note"] = "path outside the item folder; not read"
                parts = None
            if parts:
                full = os.path.join(item_dir, *parts)
                att["path"] = full
                listed_files.add(os.path.realpath(full))
                if os.path.isfile(full):
                    att["size"] = os.path.getsize(full)
                    if a.get("status") == "downloaded":
                        att.update(self.text.extract(full, "%s / %s" % (title, os.path.basename(full))))
                elif full in self.skipped_members:
                    att["size"] = att.get("size") or self.skipped_members[full].get("size")
                    att["note"] = "not extracted: %s" % self.skipped_members[full].get("reason")
                elif a.get("status") == "downloaded":
                    att["note"] = "file listed but not found in the folder"
            item["attachments"].append(att)
        attachments_dir = os.path.join(item_dir, "Attachments")
        if os.path.isdir(attachments_dir):
            for name in sorted(os.listdir(attachments_dir)):
                full = os.path.join(attachments_dir, name)
                if os.path.isfile(full) and not os.path.islink(full) and os.path.realpath(full) not in listed_files:
                    att = {"title": name, "status": "unlisted", "file": "Attachments/" + name, "path": full,
                           "size": os.path.getsize(full)}
                    att.update(self.text.extract(full, "%s / %s" % (title, name)))
                    item["attachments"].append(att)
        return item

    # -- loose documents -------------------------------------------------------
    def _read_document(self, path: str, root: str, label: str) -> None:
        kind = classify(path)
        rel = os.path.relpath(path, root) if os.path.isdir(root) else os.path.basename(path)
        doc: Dict[str, Any] = {"path": path, "name": os.path.basename(path), "relativePath": rel, "input": label,
                               "kind": kind, "size": os.path.getsize(path)}
        if kind == "json":
            data, error = read_json(path)
            if isinstance(data, dict) and "schemaVersion" in data and "scheduleBlocks" in data:
                self.schedules.append(self._read_schedule(path, data))
                return
            doc.update(self.text.extract(path, rel) if not error else {"note": error})
            if not error:
                text_path = os.path.join(self.text.dir, "%04d-%s.txt" % (self.text.count, safe_name(os.path.basename(path))))
                with open(text_path, "w", encoding="utf-8") as handle:
                    handle.write(read_text_file(path))
                doc["textFile"] = text_path
        else:
            doc.update(self.text.extract(path, rel))
        self.documents.append(doc)

    def _read_schedule(self, path: str, data: Dict[str, Any]) -> Dict[str, Any]:
        record: Dict[str, Any] = {"path": path}
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        for key in ("title", "generatedAt", "timezone", "exportId", "basedOn"):
            if key in meta:
                record[key] = meta[key]
        if isinstance(meta.get("generator"), dict):
            record["generator"] = meta["generator"].get("name")
        record["schemaVersion"] = data.get("schemaVersion")
        record["counts"] = {k: len(data[k]) for k in ("classes", "assignments", "events", "availability", "scheduleBlocks",
                                                      "issues", "deleted") if isinstance(data.get(k), list)}
        try:
            validator = _load_sibling("validate_schedule")
            result = validator.validate_file(path)
            record["valid"] = result.ok
            record["errors"] = len(result.errors)
            record["firstErrors"] = ["%s: %s" % (e["path"] or "(root)", e["message"]) for e in result.errors[:5]]
        except Exception as exc:  # noqa: BLE001 - informative only
            record["valid"] = None
            record["note"] = "validator failed: %s" % exc
        return record

    # -- output ----------------------------------------------------------------
    def to_json(self) -> Dict[str, Any]:
        now = dt.datetime.now()
        return {
            "inventoryVersion": INVENTORY_VERSION,
            "createdAt": now.strftime("%Y-%m-%dT%H:%M:00"),
            "timezone": self.zone,
            "workdir": self.workdir,
            "pdftotext": bool(shutil.which("pdftotext")),
            "inputs": self.inputs,
            "exports": self.exports,
            "classes": self.classes,
            "documents": self.documents,
            "schedules": self.schedules,
            "problems": self.problems,
            "totals": self.totals(),
        }

    def totals(self) -> Dict[str, Any]:
        items = [i for c in self.classes for i in c.get("items", [])]
        attachments = [a for i in items for a in i.get("attachments", [])]
        readable = attachments + self.documents
        return {
            "classes": len(self.classes),
            "classesNotExported": sum(1 for c in self.classes if not c.get("exported")),
            "items": len(items),
            "byType": {t: sum(1 for i in items if i.get("type") == t) for t in ("assignment", "question", "material", "announcement", "other")},
            "itemsWithDescription": sum(1 for i in items if i.get("descriptionChars")),
            "attachments": len(attachments),
            "attachmentsFailed": sum(1 for a in attachments if a.get("status") == "failed"),
            "links": sum(1 for a in attachments if a.get("status") == "link"),
            "documents": len(self.documents),
            "textFiles": sum(1 for d in readable if d.get("textFile")),
            "readDirectly": sum(1 for d in readable if not d.get("textFile") and d.get("kind") in ("pdf", "image", "legacy-office", "other")
                                and d.get("status", "downloaded") in ("downloaded", "unlisted")),
            "schedules": len(self.schedules),
        }


# ---------------------------------------------------------------------------
# Readable report
# ---------------------------------------------------------------------------

def _date_line(label: str, parsed: Optional[Dict[str, Any]]) -> Optional[str]:
    if not parsed:
        return None
    if parsed.get("none"):
        return "%s: none (\"%s\")" % (label, parsed["text"])
    if "value" not in parsed:
        return "%s: \"%s\" (%s)" % (label, parsed["text"], parsed.get("note", "unread"))
    extra = ""
    if parsed.get("year") == "inferred":
        extra = "; year inferred, %s" % parsed.get("basis")
    elif parsed.get("year") == "relative":
        extra = "; %s" % parsed.get("basis")
    if parsed.get("ambiguous"):
        extra += "; AMBIGUOUS year (also possible: %s)" % ", ".join(parsed.get("alternatives", []))
    if label == "Due" and not parsed.get("time"):
        extra += "; no time shown"
    return "%s: \"%s\" -> %s%s" % (label, parsed["text"], parsed["value"], extra)


def _short(path: str, workdir: str) -> str:
    """A path relative to the work folder when it is inside it."""
    rel = os.path.relpath(path, workdir)
    return path if rel.startswith("..") else rel


def _attachment_line(a: Dict[str, Any], workdir: str) -> str:
    bits = [a.get("title") or a.get("file") or "?"]
    meta = []
    if a.get("type"):
        meta.append(a["type"])
    if a.get("source") and a.get("source") != "attachment":
        meta.append(a["source"])
    if a.get("size") is not None:
        meta.append(human_size(a.get("size")))
    for key, word in (("pages", "pages"), ("slides", "slides"), ("words", "words"), ("events", "events")):
        if a.get(key):
            meta.append("%s %s" % (a[key], word))
    if meta:
        bits.append("(%s)" % ", ".join(str(m) for m in meta))
    status = a.get("status")
    if status == "failed":
        bits.append("NOT DOWNLOADED: %s" % (a.get("error") or "?"))
    elif status == "link":
        bits.append("LINK %s" % (a.get("originalUrl") or ""))
    if a.get("textFile"):
        bits.append("-> text: %s" % _short(a["textFile"], workdir))
    elif a.get("file") and status in ("downloaded", "unlisted"):
        bits.append("-> open: %s" % a["file"])
    if a.get("note"):
        bits.append("[%s]" % a["note"])
    return " ".join(bits)


def render_text(inv: Dict[str, Any], full: bool) -> str:
    lines: List[str] = []
    t = inv["totals"]
    lines.append("ACADEMIC MATERIALS INVENTORY")
    lines.append("Work folder: %s (paths below are relative to it)" % inv["workdir"])
    lines.append("Full report: inventory.txt   Structured data: inventory.json   Extracted text: text/")
    lines.append("")
    lines.append("Totals: %d classes (%d not exported), %d items (%s), %d with instructions, %d attachments "
                 "(%d not downloaded, %d links), %d other documents, %d text files, %d files to look at directly, "
                 "%d schedule files." % (
                     t["classes"], t["classesNotExported"], t["items"],
                     ", ".join("%d %s" % (n, k) for k, n in t["byType"].items() if n),
                     t["itemsWithDescription"], t["attachments"], t["attachmentsFailed"], t["links"],
                     t["documents"], t["textFiles"], t["readDirectly"], t["schedules"]))
    if not inv["pdftotext"]:
        lines.append("pdftotext is not installed: PDFs must be read directly.")
    for p in inv["problems"]:
        lines.append("PROBLEM: %s" % p)
    for entry in inv["inputs"]:
        for note in entry.get("notes", []):
            lines.append("Input %s: %s" % (os.path.basename(entry["path"]), note))
    for record in inv["exports"]:
        lines.append("")
        lines.append("Export manifest: %s (kind %s, exported %s UTC%s)" % (
            _short(record["manifest"], inv["workdir"]), record.get("kind"), record.get("exportedAt"),
            ", local %s" % record["exportedAtLocal"] if record.get("exportedAtLocal") else ""))
        if record.get("options"):
            lines.append("  Options: %s" % json.dumps(record["options"]))
    for cls in inv["classes"]:
        lines.append("")
        lines.append("=" * 78)
        title = "%s%s" % (cls.get("name") or "(unnamed class)", " - " + cls["section"] if cls.get("section") else "")
        lines.append("CLASS %s" % title)
        lines.append("  Course id: %s  -> class ID for a new class: %s" % (cls.get("courseId"), cls.get("suggestedClassId")))
        if cls.get("teacher"):
            lines.append("  Teacher (class card): %s" % cls["teacher"])
        for d in cls.get("details") or []:
            lines.append("  %s" % d)
        if cls.get("url"):
            lines.append("  URL: %s" % cls["url"])
        if not cls.get("exported"):
            lines.append("  NOT EXPORTED (status %s%s). %s" % (cls.get("status"), ": " + cls["error"] if cls.get("error") else "", cls.get("note", "")))
            continue
        lines.append("  Folder: %s" % _short(cls["folder"], inv["workdir"]))
        lines.append("  Export: %s archive%s, exportedAt %s UTC%s" % (
            cls.get("exportKind"), ", status " + cls["status"] if cls.get("status") else "", cls.get("exportedAt"),
            " = %s local (use as source.retrievedAt)" % cls["exportedAtLocal"] if cls.get("exportedAtLocal")
            else " (%s)" % cls.get("exportedAtNote", "")))
        opts = cls.get("options") or {}
        lines.append("  Options: announcements %s, item pages read %s, Google files as %s" % (
            "included" if opts.get("includeAnnouncements") else "NOT included",
            "yes" if opts.get("readItemPages") else "NO (instructions may be shortened)", opts.get("googleFilesExportedAs")))
        md = cls.get("missingDetection") or {}
        lines.append("  Complete enough to mark vanished items missing (section 15.6): %s%s" % (
            "yes" if md.get("usable") else "NO", "" if md.get("usable") else " - " + "; ".join(md.get("reasons", []))))
        if cls.get("topics"):
            lines.append("  Topics: %s" % "; ".join(str(x) for x in cls["topics"]))
        for w in cls.get("warnings", []):
            lines.append("  Export warning: %s" % w)
        for p in cls.get("problems", []):
            lines.append("  PROBLEM: %s" % p)
        counts: Dict[str, int] = {}
        for i in cls["items"]:
            counts[i["type"]] = counts.get(i["type"], 0) + 1
        lines.append("  Items: %d (%s)" % (len(cls["items"]), ", ".join("%d %s" % (n, k) for k, n in sorted(counts.items()))))
        if not full:
            continue
        for item in cls["items"]:
            lines.append("")
            head = "  [%s] %s" % ((item.get("type") or "?").upper(), item.get("title"))
            if item.get("role") == "reference":
                head += "   (material: reference, not work unless it says so)"
            elif item.get("role") == "announcement":
                head += "   (announcement: read for announced work, dates, cancellations)"
            lines.append(head)
            ident = []
            if item.get("classroomId"):
                ident.append("Classroom id %s" % item["classroomId"])
            if item.get("suggestedId"):
                ident.append("new-item ID %s" % item["suggestedId"])
            elif item.get("classroomId"):
                ident.append("work it announces: gc-%s-<slug(title)>" % item["classroomId"])
            if item.get("topic"):
                ident.append("topic: %s" % item["topic"])
            if ident:
                lines.append("    " + "; ".join(ident))
            for line in (_date_line("Due", item.get("due")), _date_line("Posted", item.get("posted")),
                         _date_line("Edited", item.get("edited"))):
                if line:
                    lines.append("    " + line)
            if item.get("pointsText"):
                lines.append("    Points: %s" % item["pointsText"])
            if item.get("statusText"):
                lines.append("    Status: %s" % item["statusText"])
            lines.append("    Item folder: %s" % _short(item.get("path") or "", inv["workdir"]))
            if item.get("descriptionFile"):
                lines.append("    Read: description.txt (%d characters of instructions)" % item.get("descriptionChars", 0))
            if item.get("descriptionExcerpt"):
                lines.append("    Starts: %s" % item["descriptionExcerpt"])
            for att in item.get("attachments", []):
                lines.append("    - " + _attachment_line(att, inv["workdir"]))
            for w in item.get("extractionWarnings", []):
                lines.append("    Export note: %s" % w)
            for note in item.get("notes", []) + item.get("problems", []):
                lines.append("    NOTE: %s" % note)
        for f in cls.get("otherFiles", []):
            lines.append("  Other file in the class folder: %s" % _short(f, inv["workdir"]))
    if inv["documents"]:
        lines.append("")
        lines.append("=" * 78)
        lines.append("OTHER DOCUMENTS (%d)" % len(inv["documents"]))
        for d in inv["documents"]:
            lines.append("  - %s [%s, %s]%s%s" % (
                d.get("relativePath") or d["path"], d.get("kind"), human_size(d.get("size")),
                " -> text: %s" % _short(d["textFile"], inv["workdir"]) if d.get("textFile") else " -> open: %s" % _short(d["path"], inv["workdir"]),
                " [%s]" % d["note"] if d.get("note") else ""))
    if inv["schedules"]:
        lines.append("")
        lines.append("=" * 78)
        lines.append("EXISTING SCHEDULE FILES (update mode, SCHEDULE_FORMAT.md section 15)")
        for s in inv["schedules"]:
            lines.append("  - %s: %s; exportId %s, basedOn %s, generatedAt %s, timezone %s, %s" % (
                s["path"], "valid" if s.get("valid") else "INVALID (%s errors)" % s.get("errors"),
                s.get("exportId"), s.get("basedOn"), s.get("generatedAt"), s.get("timezone"),
                ", ".join("%d %s" % (n, k) for k, n in s.get("counts", {}).items())))
            for e in s.get("firstErrors", []):
                lines.append("      error %s" % e)
    lines.append("")
    if full:
        lines.append("Next: read every description file and every text file listed above, look at every PDF/image")
        lines.append("marked 'open' directly, and read the other documents in full before planning.")
    else:
        lines.append("Next: read the full report (%s) item by item, then every description and text file it lists."
                     % os.path.join(inv["workdir"], "inventory.txt"))
    return "\n".join(lines) + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Inventory Classroom exports and other academic materials.")
    parser.add_argument("inputs", nargs="+", help="ZIP files, folders and other files")
    parser.add_argument("--workdir", help="where to extract and write results (default: a new temporary folder)")
    parser.add_argument("--timezone", help="the person's IANA time zone, e.g. America/New_York (for local export times)")
    parser.add_argument("--full", action="store_true", help="print the complete report instead of the overview")
    parser.add_argument("--json", action="store_true", help="print the JSON inventory")
    parser.add_argument("--extract-media", action="store_true", help="also extract audio and video files")
    parser.add_argument("--max-total-mb", type=int, default=4096, help="limit of extracted data (default 4096 MB)")
    parser.add_argument("--max-files", type=int, default=50000, help="limit of extracted files (default 50000)")
    parser.add_argument("--max-file-mb", type=int, default=1024, help="limit per extracted file (default 1024 MB)")
    parser.add_argument("--excerpt", type=int, default=240, help="characters of each description in the report")
    args = parser.parse_args(argv)
    if args.workdir:
        workdir = os.path.abspath(args.workdir)
        if os.path.exists(workdir) and os.listdir(workdir):
            parser.error("--workdir %s is not empty; give a new or empty folder" % workdir)
        os.makedirs(workdir, exist_ok=True)
    else:
        workdir = tempfile.mkdtemp(prefix="academic-schedule-")
    limits = Limits(args.max_total_mb * 1024 * 1024, args.max_files, args.max_file_mb * 1024 * 1024, args.extract_media)
    inventory = Inventory(workdir, args.timezone, limits, args.excerpt)
    for path in args.inputs:
        inventory.add_input(path)
    inventory.scan()
    data = inventory.to_json()
    with open(os.path.join(workdir, "inventory.json"), "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    full_text = render_text(data, full=True)
    with open(os.path.join(workdir, "inventory.txt"), "w", encoding="utf-8") as handle:
        handle.write(full_text)
    if args.json:
        sys.stdout.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    else:
        sys.stdout.write(full_text if args.full else render_text(data, full=False))
    return 1 if data["problems"] else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(errors="backslashreplace")  # type: ignore[attr-defined]
    except (AttributeError, ValueError):
        pass
    sys.exit(main())
