# Plan — Handout Library (release v1.2.0)

Branch `feature/handout-library` off `main` (v1.1.0, 733c7ed). Brief: `local-data/NEXT-STEPS-FOR-CLAUDE-CODE.md`
(3 Nov 2026). Rules: plan + one screenshot first; no deploy; no merge without OK; ci-local green before push;
no secrets in git. Plan approved 3 Nov 2026 with the decisions in §10; built as described in §11.

## 0. What the data looks like today (checked in code + the local demo database)

| Source             | Where                                                                                                                                                                 | Notes                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HMP handouts       | `HandoutRequest` (status, refNo, updatedAt) → `CourseOffering` (course × `Semester`) → `Handout` → `HandoutVersion` (`data` = BitsHandoutV1, or legacy `contentHtml`) | One request per course offering. Faculty via `FacultyAssignment` (active), SME via `SmeAssignment` (one per request). Demo DB: 9 requests (2 approved, 1 SME review, 2 requested, 4 in progress), 12 versions, all structured. |
| Published          | status `PUBLISHED`, or an `LmsPublishLog` with status `success` / `EXPORTED` / `MANUALLY_CONFIRMED`                                                                   | Demo DB: 1 log, `failed`. "Published to Taxila on <date>" = the earliest such log; else "Approved — not yet published".                                                                                                        |
| Past BITS handouts | `HandoutImport` with `approvedForReuse = true AND data IS NOT NULL`                                                                                                   | Demo DB: 287 of 418. Course code in `bitsCourseNumber` (+ `alternateCodes`), indexed. No semester, no faculty link — only what the Word file says inside `data`.                                                               |
| Terms              | `Semester` is per programme (year + term); `AcademicTerm` (Course Dibba) is term-wide (year + term)                                                                   | They are joined on `(year, term)`.                                                                                                                                                                                             |
| Schedule           | `DibbaEntry` → `Course` (slot SL1–SL8, day, session, course type)                                                                                                     | 1,077 demo rows.                                                                                                                                                                                                               |

Existing pieces reused, not rebuilt: plain status labels (`@hmp/workflow` labels), `renderBitsHandout()` /
`resolveHandoutHtml()`, the Word/PDF export route, `normalizeDibbaCourseCode()`, the dashboard views in
`lib/request-views.ts` ("needs my action"), deadlines in `lib/sla.ts`, India-time dates, `AccessDenied`.

## 1. Who sees what — one server-side rule

`apps/web/src/lib/handout-access.ts` (pure where-builders + one DB check), used by **every** list, count, facet,
suggestion, export, detail page and download:

- `libraryScope(user, tab)` → `Prisma.HandoutRequestWhereInput`
  - **Published tab** (`APPROVED`, `PUBLISHED`, and `ARCHIVED` under its filter): every role.
  - **In progress tab** (`REQUESTED`…`REWORK_REQUESTED`, `SME_REVIEW`): Admin, IC, HOG, PC → all.
    Faculty → only requests with their **active** `FacultyAssignment`. SME → only requests whose
    `SmeAssignment.smeUserId` is theirs.
  - `DRAFT`, `REJECTED`: Admin, IC, HOG, PC only (see decision D2).
- `pastScope()` → `approvedForReuse = true AND data IS NOT NULL` (every role).
- `canViewHandout(user, requestId)` → `count({ where: { id, OR: [published scope, in-progress scope] } }) > 0`;
  the detail page shows the existing "You don't have access" page otherwise (no hint that it exists).
- Inactive users never get here (login already refuses them).

**HOG and PC see every handout.** HMP records no programme ↔ person link today, so it can't limit them to their
programmes. Kept as "all programmes" for v1.2.0 (decided 3 Nov). **Possible later change:** a programme field on
users (a database change), then `libraryScope` narrows HOG/PC to their programmes.

Tests: a role × status × ownership matrix for `libraryScope` / `canViewHandout` (unit), plus e2e: faculty and SME
can't open someone else's draft by URL, can't see it in lists, counts, suggestions or the Excel export.

## 2. `/handouts` — the Handout Library

In every role's menu as **Handout Library**. Tabs: **Published** · **In progress** (faculty and SME: **My
handouts**) · **Past BITS handouts**. Each tab shows its count (same number as the list).

**Quick views** (chips above the list; the role's default is active with zero clicks):

| Role     | Opens on                      | Other quick views                                                                             |
| -------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| Faculty  | My handouts — needs my action | Due this week · Sent back for changes · Published (mine) · Last year's handout for my courses |
| SME      | Waiting for my review         | Reviewed by me · Published                                                                    |
| HOG / PC | Needs my action               | Overdue · Sent back for changes · Approved, not yet published · Changed a lot since last year |
| IC       | This semester — all           | Not started yet · Overdue · Approved, not yet published · Published this week                 |
| Admin    | This semester — all           | as IC + Past BITS handouts awaiting approval (links to Admin → Corpus imports)                |

"Needs my action" = the role's action views in `lib/request-views.ts` (the dashboard cards), one shared function.
"Not started yet" = Course Dibba courses of the current term with no HMP request in a semester of that
(year, term). "Overdue / due in N days" = `lib/sla.ts`.

**Filter panel** (left; a "Filters" button under 1024 px): search · semester/term (default current) · programme ·
discipline · status (plain words, colour dots) · people (faculty, SME, assigned by — not for faculty/SME) · dates
(deadline, last updated, published) · schedule from the Dibba (slot, day/session, course type) · source · published
to Taxila · review history (sent back ≥ N; changed vs last year).

**Search** forgives typing: the query is also run through `normalizeDibbaCourseCode()`, so "ss zg 653", "SSZG653"
and "SS ZG653" find the same course; titles and names ignore case and accents. Suggestions (courses + people)
after 2 characters, 300 ms debounce, from `/api/handouts/suggest` inside the user's scope. "/" focuses search.

**Behaviour:** facet counts beside every option, computed inside the scope (zero-count options greyed); active
filters as removable chips + Clear all; no Apply button; everything in the URL (bookmark / share — the receiver
still sees only their own scope); sort (last updated · deadline · course code · status · semester); plain empty
states with a next step; 25 courses per page.

**Grouped by course:** one row per course = its latest handout (status pill, semester, faculty, SME, last updated,
deadline or "Published to Taxila on …") + "N older versions/semesters" linking to the course history.

**How the list is computed (no N+1, counts always equal lists):** one query fetches the slim rows the user may
see for the tab + filters (id, course, status, dates, people ids — no handout content); grouping, facet counts,
quick-view counts, sort and the page slice are done on that one result; a second query loads display fields for
the 25 rows on the page. Target < 500 ms at 1,000 handouts — proved by a seeded 1,000-row fixture test. Past
handouts: same shape over `HandoutImport` (slim select, no `data`). Indexes only if the fixture test needs them.

**Excel export** (IC, HOG, PC, Admin): the filtered list only — course, semester, status, faculty, SME, deadline,
last updated, published date; no handout content; same scope. Uses the spreadsheet library already used by the
Course Dibba import.

**Saved views:** "Save this view" with a name, listed under the quick views; new table
`SavedView (id, userId, name, query, createdAt)` — **additive migration only**. The last-used view is remembered
in a cookie (see D3).

## 3. `/handouts/course/[code]` — course history

Every handout for one course, newest first: HMP handouts (all semesters, scoped as above) and past BITS handouts
together, each labelled with source, semester and status, with "Compare with previous". Code matched through
`Course.bitsCourseNumber` / `alternateCodes` and `HandoutImport.bitsCourseNumber` / `alternateCodes`. Linked from
library rows, the Course Dibba schedule rows and the faculty "Start from last year's handout" panel.

## 4. `/handouts/[id]` and `/handouts/past/[id]` — viewer

- Renders with `renderBitsHandout()` (identical to Preview and the published output); legacy HTML-only versions
  through the existing sanitised path.
- Header: course, semester, status, faculty, SME, reference, deadline, published date.
- **Version history** (who / when / notes) with "View this version" (HMP only).
- **Compare** any two versions, or with last year's past BITS handout: side by side per section (objectives,
  learning outcomes, books, sessions, evaluation, …), added / removed / changed highlighted. New pure module
  `lib/handout-compare.ts` on BitsHandoutV1; it also gives a change size (small / medium / large) for the
  "changed vs last year" filter. Legacy HTML versions: "Comparison isn't available for this version".
- **Download Word / PDF** through the existing export route, behind the rule in D1; every download writes an
  audit row (who, which handout, format).
- Buttons only for the role's next step, linking to existing pages (faculty "Open in editor" on their own
  in-progress handout, IC "Publish" on approved, …). No new workflow actions.
- Past BITS handout: same viewer, badge "Past BITS handout (imported <date>)", no version history.

## 5. Plain language and quality bar

Plain status words from the shared label map, "05 Dec 2026" India time, works at 1366×768 and on a phone,
keyboard-reachable filters with labels, AI stays hidden, no new S3 permissions. Audit-log entries get their
plain sentence (the labels test enforces it).

## 6. Tests

Unit: access matrix; quick views per role return the right items; URL ↔ filter round-trip; counts = list length;
facet counts respect scope; search normalisation; compare engine (sections, sizes, legacy); export rows = visible
rows; 1,000-row timing. E2E per role: right tabs and default view; faculty/SME can't open another's draft by URL
or download it; compare works; tab counts match lists (added to the dashboard-count spec).

## 7. Order of work

1. Access module + matrix tests. 2. Slim-row query, grouping, facets, quick views (+ tests, 1,000-row fixture).
2. Library page UI (tabs, chips, filter panel, URL state, pagination, empty states). 4. Course history.
3. Viewer + version history + compare engine. 6. Downloads (D1) + audit. 7. Saved views (migration) + export +
   suggestions. 8. Menu entries + links from Dibba / faculty panel. 9. e2e, manuals, "what changed", ci-local,
   PR. Also: fold the Phase B change (6c uses `migrate status`, `PRISMA_HIDE_UPDATE_MESSAGE=1`) into
   `docs/deploy-new-server.md`, and add the two v1.1.0 flaky tests to the flake tracker.

## 8. Decisions needed

- **D1 — Downloads.** Today's export rule is narrower than the library: PC and SME can't download anything,
  faculty only their own submitted handouts, IC/HOG/Admin only approved or published ones. **Recommended:**
  anyone may download a handout they can see in **Published** (approved / published), and in-progress downloads
  stay as today plus PC and the assigned SME (reviewers need the file). Every download is audited.
- **D2 — Drafts that never started / rejected requests** (`DRAFT`, `REJECTED`): **recommended** visible to
  Admin, IC, HOG, PC only, under the status filter, never by default.
- **D3 — "Remember my last view"**: **recommended** a cookie (per browser, no database write on every page
  view). A database copy would follow the person across devices but writes on every visit.
- **D4 — "Changed a lot since last year"**: computed on demand from the stored handouts (no new columns). Fine
  for hundreds of handouts; if it is slow at 1,000 it gets a cached change-size column (one more additive
  migration). **Recommended:** on demand now, cache only if the timing test asks for it.

## 9. Screenshot (this step)

The main page is built far enough to show real demo data: tabs with counts, role default quick view, search and
the first filters (semester, programme, status, source), grouped-by-course rows, pagination. Everything else in
§2–§4 comes after the plan is approved.

## 10. Decisions (approved 3 Nov 2026)

- **D1 Downloads — agreed, plus a draft mark.** Published tab (approved / published / archived): everyone who can
  see it. In progress: today's rule (faculty on it, after first submission) plus the Programme Committee and the
  assigned SME. Draft / rejected: nobody. Every download outside the Published tab is marked **"DRAFT – not for
  circulation"** — a red header line on every page (Word and PDF) and a diagonal mark behind the text (PDF).
  Every download is audited (it already was: `handout.export`; past handouts: `handout.past_export`).
- **D2 — agreed.** Draft / rejected: Admin, IC, HOG, PC only, through the status filter, never by default. The
  same applies to "Not started" (scheduled courses with no request): its own quick view or the status filter.
- **D3 — agreed, a cookie,** written only when the view changes (`hmp_lib_last`, path `/handouts`, holds
  `<userId>|<address>`; ignored for anyone else on the same browser).
- **D4 — agreed, on demand.** If the 1,000-handout timing test goes over 500 ms, ask before adding a stored value.
- **HOG/PC scope — keep "all programmes".** Possible later change: a programme field on users (a database change).

Fixes asked for from the screenshot: search placeholder "Search course, title or person" (hint kept); semester
default "Current semester (<real name>)"; a sortable **Due** column (Overdue in red, "Due in 3 days"); the IC
quick views from the brief (Not started yet, Overdue, Approved not yet published) with counts — every role checked
against the brief's table; **Export to Excel** and **Save this view** top right of the list (export: IC/HOG/PC/
Admin).

## 11. As built (v1.2.0)

**Quick views are per role, not per tab** (the brief's table), shown on every tab; each opens its own tab. The
first is the role's landing view. A bare `/handouts` opens the last view (D3) or the default; a tab link without
a view shows that tab for the current semester. Tab and chip counts are the course counts of exactly the list
the link opens (same filters carried; for a chip, status and semester come from the view). **A tab's count and
link never include a quick view or a status pick** (review, 5 Nov), so the number stays put while the person
moves between views; not-started courses are hidden by default and so count only inside "Not started yet".

**Cross-listed courses (review, 5 Nov):** in "Not started yet", Dibba codes with the same title in the same slot
(slot × day × session) of one semester are one row ("ENGG ZC232 / ET ZC232 / PE ZC234"), counted once; projects
and dissertations (course type PROJECT) are never merged. A request for any code in the group covers it. Catalogue
codes lead, then alphabetical. On the demo Dibba this takes the IC's count from 630 to 404. Titles: the catalogue
title when the code is in the catalogue, else the Dibba title in title case with acronyms kept
(`lib/course-title.ts`). Not-started rows show "—" for Updated and Due, and IC/Admin get **Create request**
(`/ic/requests/new?courses=…&term=…`, which pre-selects the matching course offering or says none is loaded).

**Dates (review, 5 Nov):** every date box in the app is `components/date-field.tsx` — dd/mm/yyyy typed (also
accepts "05 Nov 2026" and YYYY-MM-DD) plus a small calendar, independent of the browser locale; forms still
receive YYYY-MM-DD. Date filter chips read "Due from 05 Nov 2026".

**Status filter = the brief's plain groups:** Not started · Being allocated · Being written · With subject expert
· With reviewer (PC/HOG) · Sent back for changes · Approved – not yet published · Published · Archived (+ Draft
and Rejected for oversight), each with a colour dot. "Approved + sent to Taxila" counts as Published.
**Source** is the tab (HMP tabs vs Past BITS handouts), so there is no separate source filter.

**Due** = when the current step's workflow time limit runs out (`lib/sla.ts`: last status change + the hours in
Workflow Config) — the same rule the dashboard's overdue widgets use. **"Allocated by"** = the HOG who made the
allocation (recorded on the SME assignment). Past BITS handouts get a semester from the text in the file
("First Semester 2025-2026"), so the semester filter works on that tab too.

**Version history is for the people who could see the handout in progress** (oversight roles, its faculty, its
SME). Others see the published handout and can compare it with last year's, but not its earlier draft versions.

**"Last year's handout"** = the latest published HMP handout for the course from an earlier semester; failing
that, the latest past BITS handout from this semester or earlier.

**Timing (1,000 handouts, `handout-library.perf.integration.test.ts`, local):** default list 91 ms, search +
filters 162 ms, "changed vs last year" computed on demand for ~800 handouts 247 ms — all under 500 ms, so no
stored value (D4) and no new indexes.

**Database:** one additive migration, `20261103120000_add_saved_view` (new `SavedView` table; nothing existing
altered).

Files: `lib/handout-access.ts` (scope), `lib/handout-library.ts` (list maths, quick views, filters, facets),
`lib/handout-library-load.ts`, `lib/handout-history.ts` (course history, last year's handout, change sizes),
`lib/handout-compare.ts` + `components/handout-compare-view.tsx`, `lib/export/access.ts` (D1),
`lib/export/build-docx.ts` (draft mark), `app/handouts/**`, `app/api/handouts/{suggest,library/export,past}`.
