# Course Dibba — Phase 4 plan: term setup (edit, slots & exam dates, instructors)

Spec: [docs/course-dibba-schedule.md](../course-dibba-schedule.md) §3 items 2–3, §4, §6, §8.
Builds on Phase 3 ([phase-3-course-dibba.md](phase-3-course-dibba.md)): the same IC-only
screens, the same action/error contract (D11 there), the same Route-Handler rule for
uploads. Phase 4 adds everything "My Schedule" (Phase 5) needs besides the published
Dibba itself: when each slot meets, when each slot's exams are, and who teaches what.

Wording rule for every screen in this phase: **"Slot"**, **"Class time"**, **"Exam date"**.
Whether SL1–SL8 are class slots, exam slots or both is still unconfirmed with the
Instruction Cell (spec §10.1), so the UI never says "class slot" or "exam slot".

## 0. Decisions

- **D1 — No schema change.** `AcademicTerm`, `SlotTiming`, `SlotExamDate`,
  `CourseInstructor` and the `ExamKind` / `InstructorSource` enums all landed in Phase 1.
  Phase 4 writes rows; it adds no column and no migration.
- **D2 — Routes** (spec §8, plus one term page the spec implies):
  `/ic/dibba/terms/[termId]` (details + edit form),
  `/ic/dibba/terms/[termId]/slots` (class times + exam dates for the 8 slots),
  `/ic/dibba/terms/[termId]/instructors` (faculty-sheet upload, manual add/remove, list).
  `/ic/dibba` term cards link to all three and show instructor / exam-date counts.
- **D3 — Term edit** = `updateAcademicTerm` in the db core: same uniqueness rule as create
  (`name` unique, `(year, term)` unique) with the term itself excluded, one transaction,
  audit `dibba.term.update` with `before`/`after`. Dates stay `YYYY-MM-DD` parsed as local
  midnight (Phase 3 helper). Changing `year`/`term` of a term that already has a PUBLISHED
  import is allowed (it is a label fix, not a data move) but the form says so.
- **D4 — Class times** live on the existing 8 `SlotTiming` rows: `startTime` / `endTime` as
  `HH:MM` (24 h) or empty. Validation: both-or-neither, end after start. Saved as one
  transaction updating only the slots that changed; audit lists those slots. A term that
  somehow lacks its 8 rows (pre-Phase-3 seed) gets them upserted from `STANDARD_SLOTS`.
- **D5 — Exam dates** = `SlotExamDate` per (slot, kind) for `MID_SEM` and `COMPREHENSIVE`
  only (the `MAKEUP` enum value stays unused by the UI). Fields: date (required to keep
  the row), optional start/end time. Empty date = delete the row; otherwise upsert on
  `(termId, slotNo, kind)`. Sanity rule: the date must lie within
  `[term.startDate − 30 days, term.endDate + 60 days]` so a typo'd year is caught.
- **D6 — Faculty-sheet import** is a Route Handler (`POST /api/ic/dibba-terms/[termId]/instructors/upload`,
  same 8 MB cap / extension rule / Origin check as the Dibba upload), accepting the Excel
  workbook (`Sheet3` shape) or a CSV with the same headers. Parsing reuses
  `parseFacultySheet` / `facultyRowsFromRecords`; CSV gets a small in-repo RFC-4180 reader
  (quotes, CRLF, header row) — no new dependency. Persistence = `importFacultySheet`:
  - emails lowercased; matched against **active users by case-insensitive email**;
  - **never creates a user** (creating users stays an ADMIN action);
  - rows with no email → counted as "no email"; unmatched emails → returned as a list
    (email, name, course) and written to the audit row;
  - matched rows become `CourseInstructor { source: DIBBA_SHEET, isLead }`; the import
    **replaces** the term's previous `DIBBA_SHEET` rows in one transaction and leaves
    `MANUAL` rows alone (a MANUAL row for the same course+user wins; the sheet row is
    counted as "already listed manually");
  - a row whose course code does not parse is counted as "no course code".
    The result is shown on the instructors page right after the upload (client state) and
    the page's list reflects the new rows after `router.refresh()`. The summary is not
    persisted as a table (nothing in the spec needs it); re-uploading re-shows it.
- **D7 — Manual add/remove**: `addCourseInstructor(termId, courseCode, email, isLead)` —
  the code must parse to exactly one Dibba code (`findDibbaCourseCodes`), the email must
  belong to an active user, duplicates answer "already listed" (unique
  `(termId, courseCode, userId)`); `removeCourseInstructor(id)` deletes a row of any
  source. Both audit. `HMP_ASSIGNMENT` is never written here: HMP assignments are read live
  from `FacultyAssignment` in Phase 5 (spec §6.1), so there is nothing to copy.
- **D8 — Access**: every page and action is `requireRole(…, INSTRUCTION_CELL)` (ADMIN
  bypasses, as in Phase 3). No faculty-facing screen in this phase.
- **D9 — Errors**: the db core throws `DibbaError` (`not_found`, `term_exists`, plus new
  `invalid_input` for a parse/validation failure and `user_not_found` / `already_listed`
  for instructors); `dibbaErrorMessage` maps each to one sentence.
- **D10 — Counts on the preview page**: the instructors page shows, per course code in the
  term's PUBLISHED import, how many instructors it has, so "uncovered" courses are visible
  to IC already (Phase 6 formalises the list for HOG/PC).

## 1. Screens

### `/ic/dibba/terms/[termId]` — term details + edit

Header card: name, year/term, dates, counts (imports by status, slots with a class time,
exam dates entered, instructors). `EditTermForm` (testids `dibba-term-edit-form`, inputs
`#edit-term-name|year|term|start|end`, `dibba-term-edit-submit|error|done`). Links to the
slots and instructors pages; back link to `/ic/dibba`.

### `/ic/dibba/terms/[termId]/slots` — class times + exam dates

One table, 8 rows (slot 1–8): Slot · Day/session (read-only, from `SlotTiming`) ·
Class time start/end · Mid-sem exam date (+ start/end) · Comprehensive exam date (+ start/end).
Two forms, each with its own save button, so a timing typo cannot block exam dates:
`SlotTimingsForm` (`dibba-slot-timings-form/submit/error/done`, inputs
`#slot-{n}-start`, `#slot-{n}-end`) and `ExamDatesForm` (`dibba-exam-dates-form/submit/error/done`,
inputs `#exam-{n}-{mid|compre}-date|start|end`).

### `/ic/dibba/terms/[termId]/instructors` — who teaches what

- Upload card: file input (`.xlsx`, `.csv`), `FacultySheetUploadForm`
  (`dibba-faculty-upload-form`, `dibba-faculty-file-input`, `dibba-faculty-upload-submit`,
  `dibba-faculty-upload-result[data-state]`) → result panel: rows, matched, created,
  already-manual, no-email, no-course-code, and the unmatched list
  (`dibba-faculty-unmatched` with one `<li>` per email).
- Manual add card: course code + email + lead checkbox (`dibba-instructor-add-form`,
  `#instructor-code`, `#instructor-email`, `#instructor-lead`, `dibba-instructor-add-submit|error|done`).
- List card: grouped by course code (sorted), each row = name, email, Lead badge, source
  badge (Sheet / Manual), Remove button (`dibba-instructor-remove-{id}`); courses from the
  PUBLISHED import with zero instructors appear in an "Uncovered in the published Dibba"
  list (`dibba-uncovered-courses`).

## 2. Code pieces

packages/db (server-only sub-barrel `@hmp/db/src/dibba-import`, no top-barrel exports):

- `dibba-import/csv.ts` — `parseCsv(text): Array<Record<string, string>>` (RFC-4180 quotes,
  CRLF, BOM stripped, header row). Pure.
- `dibba-import/term-setup.ts` — `updateAcademicTerm`, `updateSlotTimings`,
  `upsertSlotExamDates`, `importFacultySheet`, `addCourseInstructor`,
  `removeCourseInstructor`, `EXAM_KINDS_EDITABLE = ['MID_SEM','COMPREHENSIVE']`, and the
  pure helpers `validateClassTime(start, end)`, `examDateWindow(term)`.
- `dibba-import/import-action.ts` — `DibbaErrorCode` gains `invalid_input`,
  `user_not_found`, `already_listed`.

apps/web:

- `app/ic/dibba/terms/[termId]/{page.tsx, actions.ts, edit-term-form.tsx}`
- `app/ic/dibba/terms/[termId]/slots/{page.tsx, actions.ts, slot-timings-form.tsx, exam-dates-form.tsx, schemas.ts}`
- `app/ic/dibba/terms/[termId]/instructors/{page.tsx, actions.ts, upload-form.tsx, add-form.tsx, instructor-list.tsx}`
- `app/api/ic/dibba-terms/[termId]/instructors/upload/route.ts` (+ `__tests__/route.test.ts`)
- `app/ic/dibba/upload-validation.ts` gains `validateFacultySheetUpload` (`.xlsx`, `.csv`).
- `app/ic/dibba/errors.ts` — the three new codes.
- `app/ic/dibba/page.tsx` — per-term links + counts.

## 3. Upload handler contract — `POST /api/ic/dibba-terms/[termId]/instructors/upload`

Same order of checks as the Phase 3 upload: Origin (403) → session (401) → role (403) →
rate limit `dibba-upload:${me.id}` (429) → multipart `file` (400) → extension `.xlsx|.csv`
(415) / empty (400) / > 8 MB (413) → term exists (404) → parse (422 `parse_failed`,
`no_rows`, `too_many_rows` > 5,000) → `importFacultySheet` → audit
`dibba.instructors.import` → 200
`{ ok, totalRows, matched, created, alreadyManual, noEmail, noCourseCode, unmatched: [{ email, name, courseCode }] }`.
The response lists unmatched emails in full (IC needs them to chase accounts); it is
never cached (`dynamic = 'force-dynamic'` on the page, no GET).

## 4. When Phase 4 touches the database

| Operation            | Writes                                                        | Transaction | Audit                      |
| -------------------- | ------------------------------------------------------------- | ----------- | -------------------------- |
| Edit term            | `AcademicTerm` update                                         | yes         | `dibba.term.update`        |
| Save class times     | `SlotTiming` update per changed slot (upsert if missing)      | yes         | `dibba.term.slots.update`  |
| Save exam dates      | `SlotExamDate` upsert / delete per (slot, kind)               | yes         | `dibba.term.exams.update`  |
| Faculty sheet import | delete term's `DIBBA_SHEET` rows → createMany (chunks of 500) | yes         | `dibba.instructors.import` |
| Add instructor       | `CourseInstructor` create (MANUAL)                            | no (single) | `dibba.instructor.add`     |
| Remove instructor    | `CourseInstructor` delete                                     | no (single) | `dibba.instructor.remove`  |

Audit rows are written with `tx.auditLog.create` inside the transactions (Phase 3 rule:
`audit()` uses the global client).

## 5. Tests

- `packages/db/src/__tests__/dibba-csv.test.ts` — quotes, embedded commas/newlines, CRLF,
  BOM, header trimming; `facultyRowsFromRecords(parseCsv(x))` equals the xlsx reader's rows
  for the committed trimmed fixture (single-vs-batch consistency rule from Phase 2).
- `packages/db/src/__tests__/dibba-term-setup.test.ts` — integration against local
  Postgres with per-run sentinels (pattern of `corpus-import-action.test.ts`): term update
  uniqueness incl. self-exclusion; class-time validation + partial update; exam-date upsert,
  delete-on-empty, window rule; sheet import: match by case-insensitive email, never creates
  users, replaces DIBBA_SHEET rows, keeps MANUAL rows, reports unmatched / no-email /
  no-code; add duplicate → `already_listed`; remove.
- `apps/web/src/app/ic/dibba/terms/[termId]/slots/schemas.test.ts` — zod schemas for the
  two forms (HH:MM, both-or-neither, date window).
- `apps/web/src/app/api/ic/dibba-terms/[termId]/instructors/upload/__tests__/route.test.ts`
  — 403/401/403/429/400/415/413/404/422/200 with mocks, happy path on a small CSV body.
- `apps/web/e2e/ic-dibba.spec.ts` — third test: open the term page → edit the end date →
  set slot 1 class time 09:00–12:00 and a mid-sem date → add `faculty@hmp.local` as a manual
  instructor for a code from the published Dibba → see it listed → remove it.

## 6. Commits

1. `docs(plans): Phase 4 plan` + `feat(db): CSV reader + term-setup core (term update, class
times, exam dates, faculty-sheet import, manual instructors) + tests`
2. `feat(web): /ic/dibba/terms/[termId] + /slots — term edit, class times, exam dates`
3. `feat(web): /ic/dibba/terms/[termId]/instructors — faculty-sheet upload handler, manual
add/remove, uncovered courses`
4. `test(e2e): term setup flow in ic-dibba.spec.ts; docs`

The stage's final commit gets the full ci-local run (both jobs) before it is pushed.

## 7. Out of scope here (later phases)

Faculty "My Schedule" (Phase 5), HOG/PC overview and the formal check lists (Phase 6),
notifications and ICS (spec §3.6–7), the dev-only demo-data loader (built with Phase 5,
where "rich schedule" and "clash" can be computed).
