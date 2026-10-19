# Course Dibba — Phase 5 plan: faculty "My Schedule" (+ Phase 6 overview sketch)

Spec: [docs/course-dibba-schedule.md](../course-dibba-schedule.md) §6 (who teaches what),
§7 (derived checks), §8 (screens). Builds on Phases 3–4: a PUBLISHED `DibbaImport` per
term, `SlotTiming` class times, `SlotExamDate` exam dates, `CourseInstructor` rows.

Wording stays neutral ("Slot", "Class time", "Exam date") — spec §10.1 is still open.

## 0. Decisions

- **D1 — One loader, keyed by the session user.** `loadFacultySchedule(prisma, { userId, now })`
  in a new server-only sub-barrel `packages/db/src/dibba-schedule/` (Prisma reads only; the
  pure grouping/clash/next-event functions sit beside it and are unit-tested). The page
  calls it with `me.id` from `requireRole(…, FACULTY)` and never reads a user id from the
  URL (spec §9). The integration test proves user B cannot see user A's courses.
- **D2 — Active term.** `pickActiveTerm(terms, now)`: among terms that have a PUBLISHED
  import, the one whose `[startDate, endDate]` contains today; else the next upcoming; else
  the most recently ended. No published term → the page says so. The same helper replaces
  the hard-coded `termClose` on the faculty and IC dashboards (`AcademicTerm.endDate`).
- **D3 — "My courses" = union of two sources (spec §6):**
  1. active `FacultyAssignment` rows for me whose request is not REJECTED/ARCHIVED and whose
     `offering.semester` has the active term's `(year, term)` → the course's
     `bitsCourseNumber ∪ alternateCodes`;
  2. `CourseInstructor` rows for (term, me) → `courseCode`.
     Codes are compared in Dibba-normalized form. Then `DibbaEntry` rows of the PUBLISHED import
     whose `courseCode` is in that set.
- **D4 — Equivalent codes merge into one course card.** Group key = the catalogue course
  (`bitsCourseNumber`) when the code is a `bitsCourseNumber` or one of a course's
  `alternateCodes`; otherwise the title normalized (lower-case, collapsed whitespace, no
  punctuation). So `AAOC ZC111` and `SS ZC111` (alternates of one course) are one card and
  never a clash with each other.
- **D5 — Clash** = same faculty, same slot (`slotNo ≥ 1`), two different course groups.
  Shown as a badge on each card involved and on the grid cell. Slot 0 rows (project /
  dissertation) never clash and sit in a separate "No slot" list.
- **D6 — Grid** = rows FRI / SAT / SUN × columns FN / AN / EV from `STANDARD_SLOTS`; FRI/EV is
  not a slot and renders empty. A cell shows the slot label, its class time (if set) and the
  course codes in it. Cards list, per slot, the programme-batch rows with student counts and
  the course total, the slot's exam dates, the class-time hint from the Dibba if the term
  has no class time, and co-instructors (names + Lead) from both sources — names only.
- **D7 — "Next class / next exam" card** on `/faculty` (and the schedule page): next class =
  the earliest upcoming weekday occurrence of one of my slots (with its class time), next
  exam = the earliest `SlotExamDate ≥ today` among my slots. Pure `nextEvents(schedule, now)`.
- **D8 — No notifications, no ICS** in this phase (spec §3.6–7 stay later).

## 1. Screens

- `/faculty/schedule` (tab "My Schedule"): term header; next class / next exam; the week
  grid (`faculty-schedule-grid`, cells `faculty-schedule-cell-{DAY}-{SESSION}`); course cards
  (`faculty-schedule-course-{groupKey}` with `data-clash`); clash list
  (`faculty-schedule-clashes`); "No slot" list; empty state (`faculty-schedule-empty`) when
  the term has no published import or I have no courses in it.
- `/faculty` dashboard: "Days remaining" from the active term's end date; new card
  "Next class / next exam" (`faculty-next-events`).
- `/ic` dashboard: the same end-date source (no other change).

## 2. Code pieces

- `packages/db/src/dibba-schedule/index.ts` — types (`FacultySchedule`, `ScheduleCourse`,
  `ScheduleSlot`, `Clash`, `NextEvents`), `pickActiveTerm`, `groupKeyFor`, `buildSchedule`
  (pure, from entries + instructors + catalogue + slots + exam dates), `findClashes`,
  `nextEvents`, `normalizeTitleKey`.
- `packages/db/src/dibba-schedule/load.ts` — `loadActiveTerm(prisma, now)`,
  `loadFacultySchedule(prisma, { userId, now })` (one query per table, then `buildSchedule`).
- `apps/web/src/app/faculty/schedule/page.tsx` (+ `week-grid.tsx`, `course-card.tsx`),
  `apps/web/src/app/faculty/layout.tsx` (tab), `apps/web/src/app/faculty/page.tsx`,
  `apps/web/src/app/ic/page.tsx`.

## 3. Tests

- `packages/db/src/__tests__/dibba-schedule.test.ts` (pure): alternate-code merge, title
  merge, clash vs no-clash, slot 0 excluded, `pickActiveTerm` ordering, `nextEvents`
  (weekday rollover, exam ordering).
- `packages/db/src/__tests__/dibba-schedule-load.test.ts` (integration, sentinels): user A
  with one assignment-sourced and one instructor-sourced course sees both; user B sees
  neither; an unpublished (DRAFT) import yields nothing; a SUPERSEDED import is ignored.
- `apps/web/e2e/faculty-schedule.spec.ts`: IC creates a term and publishes the committed
  Dibba, adds `faculty@hmp.local` to a code from it; faculty sees the card and the grid
  cell; `faculty2@hmp.local` sees the empty state.

## 4. Commits

1. `feat(db): dibba-schedule — active term, course resolution, grouping, clashes, next events (+ tests)`
2. `feat(web): /faculty/schedule — week grid, course cards, clashes; dashboards use the active term`
3. `test(e2e): faculty sees only their own schedule`

## 5. Phase 6 sketch (Stage E — overview for HOG / PC)

`loadTermOverview(prisma, termId)` → `/hog/schedule` and `/pc/schedule` (same page module,
different `requireRole`), term selector, filters (programme, slot, faculty), and the lists
from spec §7: clashes (every faculty, from the same `findClashes`), uncovered courses (no
instructor from either source), off-campus load (users with `facultyType = OFF_CAMPUS`
teaching more distinct courses than `WorkflowConfig.offCampusMaxCourses`), slot drift
(`CourseOffering.slotInfo` of the matching semester disagrees with the Dibba slot),
not-in-catalogue (`DibbaEntry.courseId IS NULL`). Notifications only if trivially quick.

## 6. Demo data (dev-only loader, built in Stage E)

`packages/db/prisma/seed-dibba-demo.ts` (`assertDevOnly()` first, never in production):
loads `local-data/course-dibba-2025-s1.doc` (via LibreOffice) or the committed `.docx`
fixture as a PUBLISHED import for the dev term, reads the 2024 workbook's `Sheet3`, creates
LOCAL faculty users for its emails (FACULTY role, password `password`), imports the sheet
through `importFacultySheet`, enters sample class times and exam dates, and prints three
emails with rich schedules (one with a clash).
