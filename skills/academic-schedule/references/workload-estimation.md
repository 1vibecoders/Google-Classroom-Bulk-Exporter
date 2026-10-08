# Estimating workload from evidence

An estimate is only as good as its evidence. Count what the work actually contains, apply a rate
range, and say what you counted. "Read pages 100–125 and answer questions 1–12" is not "30
minutes": it is 26 pages and 12 questions.

## Contents

1. [Procedure](#1-procedure)
2. [Rates](#2-rates)
3. [Point estimate, range and confidence](#3-point-estimate-range-and-confidence)
4. [Adjusting for the person and the material](#4-adjusting-for-the-person-and-the-material)
5. [When to ask](#5-when-to-ask)
6. [Worked examples](#6-worked-examples)

## 1. Procedure

1. **Use the teacher's estimate** when the instructions or syllabus give one ("about 45 minutes",
   "plan 3 hours for the project"). It wins over everything below; note it in `estimateBasis`.
2. **Count the units** from the instructions and the attachments: pages (and how dense), words to
   write, problems and questions (which numbers exactly), slides, sources, lab parts, stages. Open
   the attachment to count: a "worksheet" may be 6 or 40 items; a reading may be 8 or 40 pages.
   `inventory.py` reports pages, slides and words of documents it can read.
3. **Apply a rate range** per unit (§ 2) and add the parts that instructions require but that are
   easy to forget: planning, revision, formatting and citations, printing, uploading, studying a
   rubric, gathering materials.
4. **Look for similar work** in the same materials (an earlier essay of the same length, last
   week's reading log, a done block in the existing schedule) and keep estimates consistent.
5. **Write the result**: `estimatedMinutes`, `estimateRange {min, max}`, `estimateConfidence`, and
   `estimateBasis` listing the counted evidence and the rates, e.g. *"25 pages of verse at 1.5–2.5
   min/page (40–60 min); 12 short-answer questions at 4–6 min (50–70 min)."*
6. **Tasks**: estimate each task the same way; the assignment's `estimatedMinutes` is the sum of
   its non-cancelled tasks (it may be larger for work not represented as a task).

`estimatedMinutes` is the **total** effort, including work already done. Never lower it to reflect
progress (progress comes from task statuses and done blocks), and do not change an existing
estimate unless the evidence changed.

## 2. Rates

Typical high-school ranges; adjust per § 4. Minutes unless noted.

### Reading

| Material | Rate | Notes |
| --- | --- | --- |
| Novel / narrative prose (~300 words/page) | 1.5–3 per page | Faster for easy fiction. |
| Drama, poetry, Shakespeare, older English | 2.5–4 per page | Verse pages have fewer words but are slower. |
| Textbook (science, history, economics) | 3–6 per page | Dense pages with figures; first exposure. |
| Primary sources, academic articles | 4–8 per page | |
| Annotating or taking notes while reading | + 30–60 % | When the instructions ask for annotations, notes or a reading log. |
| Online article by words | words ÷ 180–250 per minute | + 30 % for annotation. |
| Reading log / response after reading | 10–20 per entry | |

### Questions and exercises

| Kind | Rate |
| --- | --- |
| Multiple choice, fill-in, matching, vocabulary | 1–2 per item |
| Short answer (a sentence or two, text lookup) | 3–6 per question |
| Paragraph answer / constructed response | 10–20 per question |
| Sentence correction / grammar items | 1–2 per item |
| Map, label or diagram tasks | 2–5 per item |

### Problem sets

| Kind | Rate |
| --- | --- |
| Routine practice problems (one or two steps) | 2–5 per problem |
| Multi-step word problems, physics/chemistry problems | 5–12 per problem |
| Proofs, challenge problems, programming exercises | 10–30 per problem |

Count the assigned problems exactly ("1–35 odd" is 18 problems). Add 10–20 minutes for reviewing
the section first when the material is new.

### Writing

| Stage | Rate |
| --- | --- |
| Planning: thesis, choosing quotations, outline | 15–25 % of drafting time (at least 20–30 min for an essay) |
| Drafting analytical or argumentative prose | 400–700 words per hour (≈ 600 for practiced writers on known topics; 300–400 for a difficult new genre or a second language) |
| Drafting a personal/narrative piece | 500–800 words per hour |
| Revision and editing | 25–40 % of drafting time |
| Citations, works cited, formatting (MLA/APA) | 15–30 |
| Research: finding and reading sources | 30–60 per source to find, read and note |
| Short response (150–300 words) | 15–30 total |
| Discussion post (incl. reading the prompt and replies) | 20–40 |

Example: 1,200–1,500 words of analytical writing: thesis and quotations 30, outline 30, drafting
120 (≈ 650 words/hour), revision and MLA 60 → about 240 (range 210–270).

### Labs, projects, presentations

| Work | Rate |
| --- | --- |
| Pre-lab reading and questions | 15–30 |
| Lab report from data collected in class (short) | 60–120 (data and graphs 20–40, writing 40–60, questions) |
| Formal lab report (introduction, methods, discussion) | 2–4 hours |
| Project | Sum the stages; + 15–25 % for coordination in group projects |
| Presentation slides | 8–15 per slide (content and design) |
| Presentation rehearsal | 3 × the talk length + 10 |
| Poster / model / creative product | Ask or use the rubric's components; low confidence without detail |

### Assessment preparation (total, spread over several days)

| Assessment | Typical total |
| --- | --- |
| Quiz (one section or vocabulary) | 30–60 |
| Unit or chapter test | 90–180 (≈ 30–45 per chapter reviewed + practice questions) |
| Cumulative midterm / final, per subject | 4–8 hours over 1–2 weeks |
| Vocabulary list (memorize) | 15–25 per 10 words, in 2–4 short spaced sessions |
| Standardized test (SAT, AP, music theory exam) | Depends on the person's goal: ask; count the practice papers they plan (≈ paper length each + review) |
| Oral exam / presentation of a learned piece | Rehearsal sessions as above |

Use the material the test covers (chapters, units, the review sheet's length) and the person's
current standing if they mention it. Prefer several short sessions to one long one.

### Small items

Forms and permission slips: 5–10. Printing/uploading/submitting: 5–10 (count once when it is a real
step, e.g. "print and bring"). Watching a video: its length + 25 % (notes); unknown length: ask or
use 15–30 with low confidence.

## 3. Point estimate, range and confidence

- Compute the range from the counted units: `min` with the fast end of each rate, `max` with the
  slow end. Round to multiples of 5.
- **Point estimate** = the midpoint rounded **up** to a multiple of 5: ⌈(min + max) / 2 / 5⌉ × 5.
  60–75 → 70; 40–60 → 50; 210–270 → 240. `ids.py estimate MIN MAX` computes it. A teacher's single
  number is used as is (a range is then optional).
- `min ≤ estimatedMinutes ≤ max` must hold (the validator checks it).
- **Confidence:**
  - `high`: explicit counts or a teacher estimate, familiar kind of work.
  - `medium`: counts known but difficulty or length partly estimated (e.g. pages counted, density
    guessed), or a typical-size assumption for a common format.
  - `low`: scope unclear — no attachment, vague instructions ("work on your project"), unknown
    video or reading length, a creative product without a rubric.
- `estimateBasis`: the evidence and the rates, short and concrete. Mention assumptions ("assuming
  the worksheet is 20 items as in Worksheet 2").

## 4. Adjusting for the person and the material

- **The person's own statements** win: "I read slowly", "math takes me forever", "I already started
  the essay" (then update task statuses only if they say what is done; keep the total).
- **History**: in an existing schedule, done blocks versus estimates show the person's pace.
  Adjust future estimates of similar work (and say so in the basis), never past ones.
- **Difficulty**: honors/AP or unfamiliar material → upper half of the range; review of familiar
  material → lower half.
- **Required format**: handwritten work, printed copies, specific citation styles add time.
- **Language**: work in a second language is slower (upper end or above).

## 5. When to ask

Ask the person (and record a `missing_information` issue) when the estimate would otherwise be a
guess **and** it matters for the plan:

- the key attachment failed to download or cannot be read;
- a large item has no stated scope ("research project", "study for the final") and no rubric;
- the person's target matters (standardized tests, optional work they may skip);
- a reading's length is unknown (a book title without pages or chapters).

Otherwise estimate with `low` confidence, make the range wide, and say what would change it.

## 6. Worked examples

**"Read pages 100–125 and answer questions 1–12."** (textbook chapter, short-answer questions)
26 pages × 3–6 = 78–156; 12 questions × 3–6 = 36–72; total 115–230 → too wide to be useful: open the
attachment. The pages have large figures and the questions are recall-level → pages 3–4 (78–104),
questions 3–5 (36–60): **115–165 → 140**, `medium`, basis *"26 textbook pages with many figures at
3–4 min/page; 12 recall questions at 3–5 min."* Split into two sessions (reading, then questions).

**Problem set "p. 214 #1–35 odd, 41, 42"**: 18 routine problems × 2–5 = 36–90 plus 2 word problems
× 6–10 = 12–20 → **50–110 → 80**, `high`.

**Lab report** (data collected in class, rubric attached: data table, two graphs, 5 analysis
questions, 1-page conclusion): data table and graphs 30–45, questions 5 × 6–10 = 30–50, conclusion
(~300 words) 25–40, formatting 10 → **95–145 → 120**, `medium`, tasks: analyse data & graphs,
answer questions, write conclusion.

**Unit test on chapters 3–4** (40 pages, a 30-question review sheet): re-reading notes 2 × 30–45,
review sheet 30 × 1.5–2.5 = 45–75, weak-spot practice 15–30 → **120–195 → 160**, `medium`, spread
over 3–4 days before the test.
