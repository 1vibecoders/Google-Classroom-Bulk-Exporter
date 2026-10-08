"""Test helpers: load the skill's scripts by path and build synthetic Classroom exports and documents."""
from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import subprocess
import sys
import zipfile
from typing import Any, Dict, List, Optional, Sequence

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(SKILL_DIR, "scripts")
REPO = os.path.dirname(os.path.dirname(SKILL_DIR))
WEBSITE = os.path.join(REPO, "academic-scheduler")
FIXTURES = os.path.join(WEBSITE, "tests", "fixtures")
EXAMPLES = os.path.join(WEBSITE, "examples")


def load_script(name: str) -> Any:
    path = os.path.join(SCRIPTS, name + ".py")
    spec = importlib.util.spec_from_file_location("academic_schedule_" + name, path)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = module  # type: ignore[union-attr]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


def run_script(name: str, *args: str, cwd: Optional[str] = None) -> subprocess.CompletedProcess:
    """Run a script the way the skill does: python3 -I <script> ..."""
    return subprocess.run([sys.executable, "-I", os.path.join(SCRIPTS, name + ".py")] + list(args),
                          capture_output=True, text=True, cwd=cwd, timeout=300)


def url_id(decimal: str) -> str:
    return base64.b64encode(decimal.encode("ascii")).decode("ascii").rstrip("=")


# ---------------------------------------------------------------------------
# Office documents and PDFs (minimal but real files)
# ---------------------------------------------------------------------------

def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def make_docx(path: str, paragraphs: Sequence[str], table: Optional[List[List[str]]] = None, words: Optional[int] = None,
              pages: Optional[int] = None) -> None:
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join('<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % _esc(p) for p in paragraphs)
    if table:
        rows = "".join("<w:tr>%s</w:tr>" % "".join("<w:tc><w:p><w:r><w:t>%s</w:t></w:r></w:p></w:tc>" % _esc(c) for c in row)
                       for row in table)
        body += "<w:tbl>%s</w:tbl>" % rows
    document = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="%s"><w:body>%s</w:body></w:document>' % (w, body)
    app = ('<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
           "%s%s</Properties>" % ("<Pages>%d</Pages>" % pages if pages else "", "<Words>%d</Words>" % words if words else ""))
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        zf.writestr("word/document.xml", document)
        zf.writestr("docProps/app.xml", app)


def make_pptx(path: str, slides: Sequence[Sequence[str]]) -> None:
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    p = "http://schemas.openxmlformats.org/presentationml/2006/main"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        for i, texts in enumerate(slides, 1):
            paras = "".join("<a:p><a:r><a:t>%s</a:t></a:r></a:p>" % _esc(t) for t in texts)
            zf.writestr("ppt/slides/slide%d.xml" % i,
                        '<p:sld xmlns:p="%s" xmlns:a="%s"><p:cSld><p:spTree><p:sp><p:txBody>%s</p:txBody></p:sp></p:spTree></p:cSld></p:sld>' % (p, a, paras))


def make_xlsx(path: str, rows: Sequence[Sequence[str]], sheet: str = "Log") -> None:
    s = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    strings: List[str] = []
    xml_rows = []
    for r, row in enumerate(rows, 1):
        cells = []
        for value in row:
            strings.append(value)
            cells.append('<c t="s"><v>%d</v></c>' % (len(strings) - 1))
        xml_rows.append('<row r="%d">%s</row>' % (r, "".join(cells)))
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("xl/workbook.xml", '<workbook xmlns="%s"><sheets><sheet name="%s" sheetId="1"/></sheets></workbook>' % (s, _esc(sheet)))
        zf.writestr("xl/sharedStrings.xml", '<sst xmlns="%s">%s</sst>' % (s, "".join("<si><t>%s</t></si>" % _esc(x) for x in strings)))
        zf.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (s, "".join(xml_rows)))


def make_pdf(path: str, lines: Sequence[str]) -> None:
    """A one-page PDF with real text (Helvetica), readable by pdftotext."""
    content = "BT /F1 12 Tf 72 720 Td 14 TL " + " ".join(
        "(%s) Tj T*" % line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(("%d 0 obj\n%s\nendobj\n" % (i, obj)).encode("latin-1"))
    xref = out.tell()
    out.write(("xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)).encode("latin-1"))
    for off in offsets:
        out.write(("%010d 00000 n \n" % off).encode("latin-1"))
    out.write(("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)).encode("latin-1"))
    with open(path, "wb") as handle:
        handle.write(out.getvalue())


# ---------------------------------------------------------------------------
# Classroom exports (the layout of src/engine/archive-content.js)
# ---------------------------------------------------------------------------

TYPE_FOLDERS = {"assignment": "Assignments", "material": "Materials", "question": "Questions",
                "announcement": "Announcements", "other": "Other Coursework"}


def write_class_folder(folder: str, name: str, section: Optional[str], course_decimal: str, items: List[Dict[str, Any]],
                       exported_at: str = "2026-10-11T22:05:00.000Z", include_announcements: bool = True,
                       warnings: Optional[List[str]] = None, report_warnings: Optional[List[Dict[str, Any]]] = None,
                       topics: Optional[List[str]] = None, manifest: bool = False) -> None:
    """Write one class folder. Each item: {type, title, id (decimal), topic, dueText, postedText, pointsText,
    description, attachments: [{title, file, status, content(bytes)|builder(callable path), ...}]}."""
    os.makedirs(folder, exist_ok=True)
    course = url_id(course_decimal)
    listed = []
    for item in items:
        type_folder = TYPE_FOLDERS[item["type"]]
        rel = "%s/%s" % (type_folder, item.get("folderName") or item["title"].replace(":", " -").replace("/", "-"))
        item_dir = os.path.join(folder, *rel.split("/"))
        os.makedirs(item_dir, exist_ok=True)
        kind_letter = {"assignment": "a", "material": "m", "question": "sa", "other": "a"}.get(item["type"], "p")
        url = ("https://classroom.google.com/u/0/c/%s/p/%s" % (course, url_id(item["id"])) if item["type"] == "announcement"
               else "https://classroom.google.com/u/0/c/%s/%s/%s/details" % (course, kind_letter, url_id(item["id"])))
        attachments = []
        for att in item.get("attachments", []):
            entry = {"title": att["title"], "type": att.get("type", "PDF"), "kind": att.get("kind", "drive-file"),
                     "source": att.get("source", "attachment"), "originalUrl": att.get("url", "https://drive.google.com/file/d/X/view"),
                     "status": att.get("status", "downloaded")}
            if att.get("file"):
                entry["file"] = att["file"]
                path = os.path.join(item_dir, *att["file"].split("/"))
                os.makedirs(os.path.dirname(path), exist_ok=True)
                if "builder" in att:
                    att["builder"](path)
                elif "content" in att:
                    with open(path, "wb") as handle:
                        handle.write(att["content"])
                if entry["status"] == "downloaded" and os.path.exists(path):
                    entry["size"] = os.path.getsize(path)
                    entry["contentType"] = att.get("contentType", "application/octet-stream")
            if entry["status"] == "failed":
                entry["error"] = att.get("error", "Access denied (HTTP 403)")
            if entry["status"] == "link":
                entry["note"] = att.get("note", "saved as a link")
            attachments.append(entry)
        metadata = {
            "schemaVersion": 1, "type": item["type"], "title": item["title"], "topic": item.get("topic"),
            "classroomId": url_id(item["id"]), "classroomUrl": url, "dueText": item.get("dueText"),
            "pointsText": item.get("pointsText"), "postedText": item.get("postedText"), "editedText": item.get("editedText"),
            "statusText": None, "description": item.get("description", ""), "folder": rel, "attachments": attachments,
            "extraction": {"sources": ["detail-page"], "warnings": item.get("warnings", [])},
        }
        with open(os.path.join(item_dir, "metadata.json"), "w", encoding="utf-8") as handle:
            json.dump(metadata, handle, indent=2)
        with open(os.path.join(item_dir, "description.txt"), "w", encoding="utf-8") as handle:
            handle.write("%s\n\nInstructions\n------------\n%s\n" % (item["title"], item.get("description", "")))
        if not item.get("unlisted"):
            listed.append({"type": item["type"], "title": item["title"], "topic": item.get("topic"), "folder": rel,
                           "classroomUrl": url})
    info = {
        "schemaVersion": 1, "exporter": {"name": "Google Classroom Bulk Exporter", "version": "1.2.0"},
        "exportedAt": exported_at,
        "class": {"id": course, "name": name, "section": section, "url": "https://classroom.google.com/u/0/c/%s" % course,
                  "details": ["Room 204"]},
        "counts": {"items": len(items)}, "topics": topics or [],
        "options": {"includeAnnouncements": include_announcements, "readItemPages": True, "googleFilesExportedAs": "office"},
        "discovery": {"itemPageStrategy": "fetch", "warnings": warnings or []},
        "items": listed,
    }
    with open(os.path.join(folder, "class-info.json"), "w", encoding="utf-8") as handle:
        json.dump(info, handle, indent=2)
    with open(os.path.join(folder, "class-description.txt"), "w", encoding="utf-8") as handle:
        handle.write("%s\n\nSection: %s\n" % (name, section or ""))
    report = {"class": {"name": name}, "exportedAt": exported_at, "summary": {"items": len(items)},
              "failures": [], "links": [], "warnings": report_warnings or []}
    with open(os.path.join(folder, "export-report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    with open(os.path.join(folder, "export-report.txt"), "w", encoding="utf-8") as handle:
        handle.write("Export Report\n")
    with open(os.path.join(folder, "index.html"), "w", encoding="utf-8") as handle:
        handle.write("<!doctype html><title>%s</title>" % name)
    if manifest:
        data = {"kind": "class", "formatVersion": 1, "exportedAt": exported_at, "accountIndex": 0,
                "options": info["options"],
                "classes": [{"courseId": course, "name": name, "section": section, "teacher": None, "url": info["class"]["url"],
                             "folder": ".", "status": "exported", "counts": {}}],
                "totals": {}, "extension": {"name": "Google Classroom Bulk Exporter", "version": "1.2.0"}}
        with open(os.path.join(folder, "export-manifest.json"), "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)


def zip_folder(folder: str, zip_path: str, prefix: str = "") -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirs, files in os.walk(folder):
            for name in sorted(files):
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, folder).replace(os.sep, "/")
                zf.write(full, prefix + rel)


def biology_items(tmp_builders: bool = True) -> List[Dict[str, Any]]:
    return [
        {"type": "assignment", "title": "Lab report: osmosis", "id": "700000000101", "topic": "Unit 2: Cells",
         "dueText": "Oct 16, 11:59 PM", "postedText": "Oct 9", "pointsText": "50 points",
         "description": "Write a 2-3 page lab report on the osmosis lab. Include a data table and two graphs.",
         "attachments": [
             {"title": "Lab handout", "type": "Google Docs", "file": "Attachments/Lab handout.docx",
              "builder": lambda p: make_docx(p, ["Osmosis lab", "Answer questions 1-8 in full sentences."],
                                             table=[["Part", "Points"], ["Data table", "10"]], words=120, pages=2)},
             {"title": "Rubric.pdf", "file": "Attachments/Rubric.pdf",
              "builder": lambda p: make_pdf(p, ["Lab report rubric", "Due Friday October 16"])},
             {"title": "Data sheet", "type": "Google Sheets", "file": "Attachments/Data sheet.xlsx",
              "builder": lambda p: make_xlsx(p, [["Trial", "Mass"], ["1", "2.4"]])},
         ]},
        {"type": "material", "title": "Unit 2 slides", "id": "700000000102", "topic": "Unit 2: Cells", "postedText": "Oct 5",
         "description": "Slides from class.",
         "attachments": [{"title": "Cells", "type": "Google Slides", "file": "Attachments/Cells.pptx",
                          "builder": lambda p: make_pptx(p, [["Cell membranes"], ["Transport", "Diffusion"]])},
                         {"title": "Lecture", "type": "Video", "file": "Attachments/lecture.mp4", "content": b"\x00" * 2048}]},
        {"type": "announcement", "title": "Unit 2 test moved", "id": "800000000103", "postedText": "Oct 10",
         "description": "The Unit 2 test is now on Tuesday, Oct 20. Study chapters 3-4."},
        {"type": "question", "title": "Exit ticket", "id": "700000000104", "dueText": "Tomorrow, 8:00 AM", "postedText": "Oct 11",
         "description": "One sentence: what is osmosis?"},
        {"type": "assignment", "title": "Winter break reading", "id": "700000000105", "dueText": "Jan 5", "postedText": "Dec 18",
         "description": "Read chapter 9."},
    ]
