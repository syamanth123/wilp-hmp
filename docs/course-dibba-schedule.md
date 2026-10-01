# Course Dibba → Faculty Schedule (feature spec)

Status: **proposed** · Target: HMP (`wilp-hmp`) · Author: WILP Ops/Tech · Date: 2026-09-29

This is the source of truth for the "Course Dibba" feature. Claude Code: read this whole
file before touching code, and keep it updated if a decision changes.

---

## 1. The problem in plain words

Every semester the Instruction Cell circulates a **Course Dibba** ("box") — a Word file
(e.g. `1-2025 Course Dibba … 2nd July 2025.doc`, 40+ programme tables) and sometimes an
Excel version (`Course Dibba in Excel as on 03-06-2024.xlsx`). It says, for every
**programme × admit batch**, which **course runs in which slot**:

| Slot | Day / session                                          | Notes      |
| ---- | ------------------------------------------------------ | ---------- |
| SL1  | Saturday forenoon (SAT FN)                             |            |
| SL2  | Saturday afternoon (SAT AN)                            |            |
| SL3  | Sunday forenoon (SUN FN)                               |            |
| SL4  | Sunday afternoon (SUN AN)                              |            |
| SL5  | Friday forenoon (FRI FN)                               |            |
| SL6  | Friday afternoon (FRI AN)                              |            |
| SL7  | Saturday evening (SAT EV — file sometimes writes "EN") |            |
| SL8  | Sunday evening (SUN EV / "EN")                         |            |
| 0    | No slot — dissertation / project (`…628T`, `…425T`)    | Excel only |

Faculty today must dig through a 40-page document to find _their_ courses, and nothing in
HMP knows the slot. HMP already knows **who teaches what** (HOG allocation →
`FacultyAssignment`) but not **when**. This feature joins the two:

> IC uploads the Dibba once → HMP parses it → every faculty member sees a
> **My Schedule** page: each of their courses, its slot (day + session), every
> programme/batch that takes it, student counts, class-time hints, exam dates for that
> slot, and any clashes.

## 2. What the real files look like (measured, not assumed)

Measured with `prototype/parse_dibba.py` on the two files:

**2025 Word Dibba (`.doc`, "As on 02.07.2025")**

- Legacy `.doc` → must convert to `.docx` first. HMP already does this:
  `packages/db/src/corpus-import/ensure-docx.ts` (LibreOffice).
- 51 tables. **Table 0 = index AND the first programme (18BT/18ET)** in one table.
- Programme title is either the first row of the table, or a separate 1×1 table just
  before it (e.g. `PD59 PG Diploma (Finance)`).
- Header row starts with `Admit Batch`, then slot columns.
- Result: **1,077 course-slot rows, 638 unique course codes, 41 programmes, 3 warnings.**
- Cells hold 0–8 courses separated by newlines; formats seen:
  `ET ZC232|ENGINEERING MATERIALS`, `ETZC235|…`, `ES ZG611 : PROCESS…`,
  `1. 504303|IS ZC364|OPERATING SYSTEMS` (ERP course-id prefix), `BTEEZC216 : PROB…`,
  `EEE ZG 571|…` (split digits), `MBA    ZG527|…` (many spaces).
- Cell notes to keep: `(CORE)`, `(core)`, `(BKLG)`, `CORE FOR BACKLOG`, `(not Offered)`,
  `NEW FACULTY REQUIRED`, `(Should not assign IM & SPM to MT12 & MT13 students)`,
  class times like `Sat 8.20`, `Sunday 1.30`, fractions like `(2/2)`.
- Batch cell examples: `1/2025 \n NEW ADM`, `2/2024 \n (178)`, `2/2024 \n 502`,
  `2/2020 (5092) (3rdSem) 3 core + EL (00)`, `2/2023 (5105) (1stSem) 2 Core + 2 EL`.
- **Header inconsistencies are real**: 29EE uses `SAT EN` / `SUN (EN)` without `SLn`;
  HB28 says `SL7(SAT FN)` / `SL8(SAT AN)`; HB59 says `SL8(SAT EN)`. These must be
  flagged to IC, not silently "fixed".

**2024 Excel Dibba (`.xlsx`)**

- Sheet `Course Dibba S1-2024`: one row per programme × batch × course — 937 rows,
  columns `Acad Plan, Degree Programme, Programme, Admit Batch (2|2023), Degree Semester,
Active Student No., Domain, Type (Core/EL/T Course), Exam Slot (0–8), Course ID (ERP),
Subject, Catalog, Descr, Unique Title, Min Units, Remarks`.
- Sheet `Sheet3`: **course → faculty map** (545 rows): `Course Number, dabba (slot),
Course, Department, PSRN/GFID, FACULTY NAME (… (LEAD)), Email, campus, Mobile`.
  526 rows have an email. Campus values: OFF-CAMPUS, GUEST FACULTY, PILANI, HYDERABAD,
  GOA, CMC, Adjunct Faculty (Off-campus).
- Other sheets (`Slot Wise Offered Courses`, `Course Wise Summary`, `Not Offered`,
  per-department sheets) are derived views — ignore on import.

**Code-format finding (important):** the existing
`normalizeBitsCourseNumber()` (packages/db/src/course-code.ts) **rejects 30 of 937 Excel
rows**: dissertation/project codes with a trailing `T` (`SS ZG628T`, `BITS ZC425T`,
`MBA ZG622T`) and 5-letter prefixes (`POWAB ZC113`). Its tests deliberately reject
`ABCDE ZC100`, so **do not loosen it**. Add a separate `normalizeDibbaCourseCode()` (see §5).

**Faculty coverage finding:** only 491 of the 638 courses in the 2025 Dibba appear in the
2024 faculty sheet. So the old sheet can _seed_ instructors but HMP's own HOG allocation
must be the primary source (§6).

## 3. Scope

In scope (v1)

1. IC uploads a Dibba file (`.doc`, `.docx`, `.xlsx`) for a term → preview with warnings → publish.
2. IC optionally uploads a faculty-course sheet (Excel `Sheet3` shape or CSV).
3. IC sets per-slot timings and per-slot exam dates (mid-sem / comprehensive) for the term.
4. **Faculty → My Schedule** page (read-only, only their own courses).
5. HOG / PC / IC → **Schedule overview**: filter by programme, slot, faculty; coverage gaps; clashes.
6. Notifications: "schedule published" and "your course's slot changed" on re-publish.
7. ICS calendar download for a faculty's weekly slots (nice-to-have, last phase).

Out of scope (v1): editing the Dibba inside HMP, room allocation, student-level data,
auto-generating the Dibba.

## 4. Data model (additive Prisma migration — no existing model changes)

Why new models instead of reusing `Semester`/`CourseOffering`: `Semester` belongs to one
`Programme`, but one Dibba spans all programmes and one course (e.g. `MBA ZC411`) runs for
8 programmes in the same slot. The Dibba is a term-wide document, so it gets term-wide tables.

```prisma
enum DibbaImportStatus { DRAFT PUBLISHED SUPERSEDED }
enum DibbaCourseType  { CORE ELECTIVE PROJECT BACKLOG NOT_OFFERED UNSPECIFIED }
enum ExamKind         { MID_SEM COMPREHENSIVE MAKEUP }
enum InstructorSource { HMP_ASSIGNMENT DIBBA_SHEET MANUAL }

model AcademicTerm {             // "2025-26 Sem 1"
  id         String   @id @default(cuid())
  name       String   @unique
  year       Int
  term       String            // FIRST | SECOND | SUMMER (same vocabulary as Semester.term)
  startDate  DateTime
  endDate    DateTime
  imports    DibbaImport[]
  slots      SlotTiming[]
  examDates  SlotExamDate[]
  instructors CourseInstructor[]
  createdAt  DateTime @default(now())
}

model DibbaImport {              // one uploaded file version
  id            String            @id @default(cuid())
  termId        String
  label         String            // "As on 02.07.2025"
  sourceFilename String
  sourceFormat  String            // doc | docx | xlsx
  status        DibbaImportStatus @default(DRAFT)
  rowCount      Int
  warnings      String[]          @default([])
  uploadedById  String
  publishedAt   DateTime?
  term          AcademicTerm      @relation(fields: [termId], references: [id], onDelete: Cascade)
  entries       DibbaEntry[]
  createdAt     DateTime          @default(now())
  @@index([termId, status])
}

model DibbaEntry {               // one course, in one slot, for one programme-batch
  id              String          @id @default(cuid())
  importId        String
  programmeCode   String          // "HT01", "MB21/HB21", "18BT/18ET"
  programmeTitle  String
  admitBatch      String?         // "2/2024"; null for programme-level backlog rows
  isNewAdmission  Boolean         @default(false)
  isBacklogRow    Boolean         @default(false)
  studentCount    Int?
  slotNo          Int             // 0..8
  slotDay         String?         // SAT | SUN | FRI
  slotSession     String?         // FN | AN | EV
  courseCode      String          // normalizeDibbaCourseCode() output
  courseTitle     String
  courseType      DibbaCourseType @default(UNSPECIFIED)
  erpCourseId     String?
  classTimeHint   String?         // "SAT 8:20"
  remarks         String?
  rawCell         String          // for audit / "why did it parse like this"
  courseId        String?         // best-effort link to Course (by bitsCourseNumber or alternateCodes)
  import          DibbaImport     @relation(fields: [importId], references: [id], onDelete: Cascade)
  @@index([importId, courseCode])
  @@index([importId, programmeCode])
  @@index([courseId])
}

model SlotTiming {               // IC-editable; seeded from the standard map in §1
  id        String @id @default(cuid())
  termId    String
  slotNo    Int
  day       String   // SAT | SUN | FRI
  session   String   // FN | AN | EV
  startTime String?  // "09:00"
  endTime   String?
  term      AcademicTerm @relation(fields: [termId], references: [id], onDelete: Cascade)
  @@unique([termId, slotNo])
}

model SlotExamDate {             // IC enters exam dates per slot
  id        String   @id @default(cuid())
  termId    String
  slotNo    Int
  kind      ExamKind
  date      DateTime
  startTime String?
  endTime   String?
  term      AcademicTerm @relation(fields: [termId], references: [id], onDelete: Cascade)
  @@unique([termId, slotNo, kind])
}

model CourseInstructor {         // who teaches a course in a term (besides HMP assignments)
  id         String           @id @default(cuid())
  termId     String
  courseCode String           // dibba-normalized
  userId     String
  isLead     Boolean          @default(false)
  source     InstructorSource
  term       AcademicTerm     @relation(fields: [termId], references: [id], onDelete: Cascade)
  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([termId, courseCode, userId])
  @@index([userId, termId])
}
```

(Add the `CourseInstructor[]` back-relation on `User`.)

## 5. Parsing rules (port of `prototype/parse_dibba.py`)

Location: `packages/db/src/dibba-import/` — mirrors `corpus-import/`, same reason: it uses
mammoth (Node-only) so it must **not** be re-exported from the `@hmp/db` barrel (see the NOTE
in `packages/db/src/index.ts`). The parser is pure (bytes/path in → rows + warnings out);
conversion and DB writes live in the server action.

1. **Format**: `.doc` → `ensureDocxFormat()`; `.docx` → `mammoth.convertToHtml` and walk
   `<table>` like `corpus-import/parser.ts` does. Merged cells matter here (programme
   title rows span all columns): verify on the real fixture how mammoth represents them;
   if column positions drift, read `word/document.xml` directly via `adm-zip` (already a dependency); `.xlsx` → `exceljs` (new dependency — nothing in the repo reads xlsx today).
2. **Programme**: last non-empty single-cell row/table seen before a header row.
   `programmeCode` = leading code(s): `^([A-Z]{2}\s?\d{2}|\d{2}[A-Z]{2})(/…)*`, spaces removed
   (`HT 31` → `HT31`, `HB28 MBA (…)` → `HB28`, `18BT/18ET B.Tech.` → `18BT/18ET`).
3. **Header**: first cell starts with `Admit Batch`. For each slot column: take `SLn` if
   present; take day (SAT/SUN/FRI) and session (FN/AN/EV, treat `EN` as `EV`).
   - no `SLn` → derive from the standard map (§1); if that fails, use column index + warning.
   - `SLn` disagrees with the standard map → keep `SLn` and day/session **as written**, add a warning.
4. **Batch cell**: `([12])\s*/\s*(20\d\d)` → `admitBatch`. `NEW ADM` → `isNewAdmission`.
   `backlog` → `isBacklogRow`. Student count = last bracketed number `(178)`, else a number
   alone on a line; `(00)` → 0; **ignore 50xx/51xx** (ERP term codes like `(5092)`);
   ignore numbers followed by words (`4 Core`, `2 EL`).
5. **Course cell**: find every code with
   `\b([A-Z]{2,5})\s*(Z\s*[CG])\s*(\d)\s*(\d)\s*(\d)(\d?)(T?)\b` (case-insensitive) — this
   tolerates joined, spaced and split-digit forms. Canonical = `PREFIX Z[CG]digits[T]`.
   Title = text after the code up to the next code/newline, stripped of `|`, `:`, `(...)`.
   Type: `not offered` → NOT_OFFERED; `backlog|bklg` → BACKLOG; `…T` code → PROJECT;
   `core` → CORE; Excel `EL` → ELECTIVE; else UNSPECIFIED.
   Class-time hint: `(Sat|Sun|Fri)(urday|day)?\s*\d{1,2}[.:]\d{2}`.
   A non-empty cell with no code → warning (never drop silently).
6. **Excel**: read `Course Dibba S1-…` by header name (not column letter — `Course No.`
   is a `CONCATENATE` formula; build the code from `Subject`+`Catalog`). `Admit Batch`
   uses `|` → convert to `/`. `Exam Slot` is the slot number.
7. **`normalizeDibbaCourseCode()`**: new function next to `normalizeBitsCourseNumber` in
   `packages/db/src/course-code.ts`, accepts 2–5 letter prefix and optional `T`. Linking to
   `Course`: try `bitsCourseNumber`, then `alternateCodes`; if no match, `courseId = null`
   and list it in the preview as "not in HMP catalogue".
8. **Golden numbers** (tests must assert these on the real fixture):
   2025 doc → 1,077 rows, 638 unique codes, 41 programmes, exactly 3 header warnings
   (HB28 ×2, HB59 ×1). 2024 xlsx → 937 rows; faculty sheet → 545 rows, 526 with email.

## 6. Who teaches what — resolution logic

For faculty **F** and term **T**, "my courses" = union of:

1. **HMP assignments** (authoritative): active `FacultyAssignment` for F whose
   `request.offering.course` → codes = `bitsCourseNumber ∪ alternateCodes`.
2. **`CourseInstructor`** rows for (T, F) — from the faculty sheet import (matched by
   `User.email`, lowercase) or added manually by IC/HOG.

Then join the **published** `DibbaImport` for T: `DibbaEntry.courseCode ∈ codes`.

Group for display: **course** (merge cross-listed equivalents — e.g. `AAOC ZC111` and
`SS ZC111` are the same course; use `Course.alternateCodes`, else same normalized title)
→ **slot** → list of programme-batch rows with student counts; total students per course.

Faculty sheet import rules: strip `(LEAD)` from the name → `isLead = true`; unmatched
emails are **reported, not auto-created** as users (creating users stays an ADMIN action).

## 7. Derived checks (shown to IC/HOG, and to the faculty member for their own rows)

- **Clash**: same faculty, same slot, two _different_ courses (after merging equivalents).
  On the 2025 Dibba × 2024 faculty sheet this finds **27 clashes across 26 faculty** — so it is worth building.
- **Uncovered course**: in the Dibba, no instructor from either source.
- **Off-campus load**: reuse `WorkflowConfig.offCampusMaxCourses` — count distinct courses.
- **Slot drift**: `CourseOffering.slotInfo` (already in schema) disagrees with the Dibba slot.
- **Not in catalogue**: Dibba code with `courseId = null`.
- **Header warnings** from §5.3 until IC acknowledges them.

## 8. Screens

| Route                                  | Role    | What it shows                                                           |
| -------------------------------------- | ------- | ----------------------------------------------------------------------- |
| `/ic/dibba`                            | IC      | Terms, imports (draft/published), upload button                         |
| `/ic/dibba/[importId]`                 | IC      | Preview: counts, warnings, unknown codes, programme tables; **Publish** |
| `/ic/dibba/terms/[termId]/slots`       | IC      | Slot timings + exam dates per slot                                      |
| `/ic/dibba/terms/[termId]/instructors` | IC      | Upload faculty sheet; unmatched emails                                  |
| `/faculty/schedule`                    | FACULTY | **My Schedule** — week grid (Fri/Sat/Sun × FN/AN/EV) + course cards     |
| `/hog/schedule`, `/pc/schedule`        | HOG, PC | Overview with filters + coverage/clash lists                            |
| `/api/faculty/schedule.ics`            | FACULTY | iCalendar feed of own slots (phase 6)                                   |

Faculty dashboard (`apps/web/src/app/faculty/page.tsx`) has a **hard-coded
`termClose = new Date('2026-05-28')`** — replace it with the active `AcademicTerm.endDate`
and add a "Next class/exam" card from the schedule.

## 9. Security & conventions (follow the repo, don't invent)

- Mutations = server actions in `actions.ts` beside the page; guard with
  `requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL)` (ADMIN bypasses).
- Faculty queries **always** filter by `me.id` — never accept a faculty id from the URL.
- Every import/publish writes `audit()` (`apps/web/src/lib/audit.ts`).
- Notifications via `apps/web/src/lib/notifications.ts`; add templates in
  `packages/db/src/notification-templates.ts` (`schedule.published`, `schedule.slot_changed`).
- Upload size/type validation like `apps/web/src/lib/attachment-validation.ts`.
- Migrations: `pnpm --filter @hmp/db exec prisma migrate dev --name add_course_dibba`.
- Tests: Vitest unit tests beside code; one Playwright spec
  `apps/web/e2e/dibba-schedule.spec.ts` (IC uploads → publishes → faculty sees schedule).
- The fixture files contain faculty emails/phone numbers: commit only the trimmed
  fixtures in `packages/db/src/__fixtures__/dibba/` (no mobile numbers).

## 10. Open questions (decide before Phase 4)

1. Are SL1–SL8 the **class** slots, the **exam** slots, or both? The Excel column says
   "Exam Slot"; the Word headers name weekdays. v1 treats them as one slot with separate
   `SlotTiming` (class) and `SlotExamDate` (exam) — confirm with the Instruction Cell.
2. What do fractions like `(2/2)`, `(6/7)` mean? Stored in `rawCell` until confirmed.
3. Should faculty see _other_ faculty on a shared course (co-instructors)? Default: yes, names only.
