# Plan — v1.4: departments, people, assignment that follows departments, automations, detailed emails

Branch `feature/departments` off `main` @ `41b928b` (v1.3.0). Brief: `local-data/NEXT-STEPS-v1.4.md` (section 0
"keep it simple" overrides the rest: **one person = one email = one department**; roles multi-select; people CSV
has four columns). **Plan first** — this document plus screenshots of the Admin people page and the IC/HOG
assignment screens; nothing else is built until you approve. Same rules: additive migrations only, ci-local
green before push, no merge without your OK, never touch the server.

---

## 0. What exists today (checked in code, main @ 41b928b)

| Area                 | Today                                                                                                                                                                                                                                                                           | Consequence for v1.4                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Departments          | **None.** No programme ↔ person link anywhere.                                                                                                                                                                                                                                  | New `Department`; link programmes and people.               |
| HOG / PC             | **Role pools.** Nobody is "the HOG" of a request: `REQUEST_INITIATED` notifies **all** HOGs, `FACULTY_ALLOCATED` **all** PCs; any HOG/PC can open and act on any request (`request-views.ts` `scopeWhere` returns `{}` for them; detail pages and actions check the role only). | Record who is responsible per request; scope by department. |
| Who is responsible   | Only faculty (`FacultyAssignment`) and SME (`SmeAssignment`). HOG/PC appear only afterwards as `Approval.reviewerId`. **No reassignment** of anything.                                                                                                                          | New `RequestAssignee` (one row per role, history kept).     |
| Roles in the session | Loaded **once at sign-in** into the JWT (30-day default); a role change shows only after signing out; **deactivating doesn't end a live session**.                                                                                                                              | Refresh access on the next request after a change (see B2). |
| Admin → Users        | Create (one role, password), activate/deactivate. **No edit, no role change, no CSV.** `user.update` permission seeded but unused. Email not lower-cased.                                                                                                                       | Edit page, safe role/department edit, bulk upload.          |
| BITS SSO             | Matches an **existing active** user by email (case-insensitive); **never creates** accounts.                                                                                                                                                                                    | Bulk upload is how people get in.                           |
| Pickers              | Faculty: all active FACULTY with "N courses this semester" (cap for off-campus/adjunct/guest). SME: all active SMEs, no load. PC: not picked — any PC confirms.                                                                                                                 | Department-first pickers with load; HOG picks the PC.       |
| Dibba faculty sheet  | Already has a **Department** column — parsed, then dropped.                                                                                                                                                                                                                     | Use it to suggest people's departments.                     |
| Settings             | Only `WorkflowConfig` (SLA hours, off-campus cap).                                                                                                                                                                                                                              | Add the new settings as columns there.                      |
| Deadlines            | No due date on a request; "time in status" uses `updatedAt` (any edit resets the clock); SME_REVIEW has no SLA.                                                                                                                                                                 | Add `statusChangedAt` + per-request stage due dates.        |
| Emails               | `<p>{body}</p><a>Open in HMP</a>`, body not HTML-escaped, templates read-only in Admin, comment and reminder emails hard-coded.                                                                                                                                                 | One layout, detailed events, editable templates (G).        |

## A. Departments

- **`Department`** `{ id, code @unique, name, active, createdAt, updatedAt }` — seeded: `MBA` "MBA / Management",
  `CORE` "Core Engineering", `CSIS` "CSIS", `EEE` "EEE" (names editable).
- **`User.departmentId`** (nullable) — one department per person; IC and Admin leave it empty ("All").
- **`Programme.departmentId`** (nullable) — a programme belongs to one department. _(Brief A suggests a
  `ProgrammeDepartment` table; one column is simpler and enough if no programme spans two departments —
  decision **H1**.)_ A request's department = its offering's programme's department. Dibba codes reach a
  department through the v1.3 Dibba-code → programme links.
- **Admin → Departments**: create / rename / deactivate; link programmes (dropdown per programme); per department:
  HOG, number of PCs / faculty / SMEs, open handouts, overdue.

## B. People — manual and bulk (section 0 wins over B's longer CSV)

- **Admin → People** (replaces Admin → Users): search, filter by role / department / active, columns _Name,
  Email, Roles, Department, Faculty type, Open work, Status_. **Add person** and **Edit** (name, email, roles
  multi-select, department, faculty type, active). Emails stored lower-case. Every change audit-logged
  "before → after".
- **Upload people (CSV or Excel)**, template with exactly `email, name, roles, department` (roles `;`-separated,
  department by code or name; optional `faculty_type`, `active` columns accepted but not required).
  **Preview first**: each row **New / Changed (what) / Unchanged / Error (why)**; nothing saved until **Apply**.
  Upsert by email; never deletes; deactivation only via `active=no`. **Download the current list** in the same
  format (edit in Excel, upload again).
- Rules on save: **one active HOG per department** (a second one asks to confirm replacing — B2), HOG / PC /
  faculty / SME need a department, IC / Admin don't.
- **Welcome email** (optional tick): roles, department, "sign in with your BITS ID at …" (no password sent).

## B2. Fixing a wrong role or department, safely

- **Edit roles & department** on a person. Before saving, an **impact check**: removing a role / changing
  department / deactivating lists their open work ("HOG of 6 open requests, 2 overdue") and requires a new owner
  for each (or one for all) **in the same dialog**. Nothing is left without an owner.
- History is never rewritten: past approvals, comments, versions keep the person's name.
- **Undo** the last role/department change within 24 h (one click, audit-logged; refused if work has moved on).
- Guard rails: the last Admin can't remove their own Admin role; making someone the department's new HOG offers
  "move the old HOG's open work to them".
- **Takes effect on the next page** (no sign-out): a `User.accessVersion` counter bumps on every change; the
  session re-reads roles when it changes (and signs the person out if deactivated). Plus an email.
- Bulk upload runs the same impact check in the preview; rows that would orphan work are blocked until a
  `replacement_email` column is filled for them.

## C. Assignment that follows departments (pick a person, never type)

- **`RequestAssignee`** `{ id, requestId, role (HOG|PC|FACULTY|SME), userId, assignedById, assignedAt, endedAt?,
reason? }` — the single answer to "who is responsible now" (current = `endedAt` null). Existing
  `FacultyAssignment` / `SmeAssignment` keep working and are written alongside.
- **IC creates a request → the HOG**: the course's department HOG is **pre-selected**; any other active HOG
  allowed **with a reason**. Only that HOG is notified (no more "all HOGs").
- **HOG allocates → PC, faculty, SME**: their department's people first, then "Show all departments" (marked
  _other dept_). Each name shows **load** — "3 open handouts · 1 overdue" (and the existing off-campus cap). Only
  that PC is notified and can confirm.
- **Reassign** (IC: HOG; HOG: PC, faculty, SME) with a reason; history kept; old and new person notified.
- **Away / back-up**: a person sets "away until <date>, back-up <same-role colleague in the department>"; new
  assignments and reminders go to the back-up meanwhile; pickers show _away until 20 Nov_.
- **Existing requests** (no HOG/PC recorded): a one-off backfill at release assigns the department HOG where the
  department is known; the rest stay visible to all HOGs/PCs until assigned (flagged in data-quality warnings).

## D. Scoping by department (replaces "HOG/PC see all programmes")

- HOG and PC see **their department's** requests **plus any request they are personally assigned to**.
  IC / Admin: everything. Faculty / SME: unchanged.
- One rule, extended in `handout-access.ts` and `request-views.ts` `scopeWhere` — used by dashboards, lists,
  detail pages, actions (HOG/PC actions check scope, not only role), bulk tools (`authorityCheck`), the Library,
  exports, suggestions, schedules, SLA widgets, reminders. Tests: role × department matrix.
- Department filter in the Library and dashboards for IC / Admin.

## E. Extras

- **Department dashboard** (HOG: theirs; IC/Admin: all): not started / in progress / overdue / approved /
  published, and a workload table per person.
- **Escalation**: overdue by N days (setting, default 3) → the assignee, then their HOG, then the IC; daily, in
  the existing reminders run; SME_REVIEW gets an SLA too.
- **"My work" inbox** on every home: items needing _my_ action, by due date.
- **Bulk assign**: IC ticks not-started courses → requests created, each assigned to its department HOG
  (preview first).
- Plain-language trail on each request: "IC A assigned HOG B (CSIS) on 05 Nov 2026".

## F. The 15 small automations

1 Dibba pre-fill + Dibba instructor suggested (CourseInstructor already maps Dibba sheets to users) · 2 "same team
as last semester" · 3 **semester kick-off wizard** (tick courses → requests, HOG per department, deadlines,
last year's handout as start) · 4 **automatic deadlines** per stage from the semester start (settings; editable per
request) · 5 **duplicate guard** on single creation (bulk already has one) · 6 **daily digest** option (urgent
items still instant) · 7 **weekly summary** to HOGs (department) and IC · 8 **deep links** that survive BITS sign-in ·
9 **.ics calendar feed** per person (private token URL) · 10 **@mentions** in comments (and the SME, now left out,
gets comment notices) · 11 **auto-publish** after approval when Taxila is on (off by default) · 12 remembered
semester / department / filters · 13 **handover on deactivation** (uses B2) · 14 **data-quality warnings** with
"Fix" links · 15 **keyboard shortcuts** on review screens (A approve, R send back, N next).

## G. Detailed emails

One BITS-branded HTML + plain-text layout; subject "[HMP] Action needed: review SS ZG653 … — due 12 Dec 2026";
summary line; what to do and by when; big button (deep link); handout box; people box; event-specific detail
(reviewer's full comments, what changed between versions, Taxila link, reason for reassignment, …); last 3–5
timeline steps; footer (why you got it, instant/digest preference, help contact, reply-to = IC mailbox setting).
Never passwords, tokens or handout content. Each reader sees only what their role may see. **Admin →
Notifications**: edit each template, preview with a real request, send a test to yourself. Every send/failure
audit-logged. (Comment and reminder emails move onto templates too.)

## Database (additive only)

New: `Department`, `RequestAssignee`, `UserPreference` (email mode, remembered filters, away-until, back-up),
`RequestDeadline` (request, stage, dueAt, set by), `CalendarToken`. New nullable columns: `User.departmentId`,
`User.accessVersion` (default 0), `Programme.departmentId`, `HandoutRequest.statusChangedAt`, new
`WorkflowConfig` settings (escalation days, deadline offsets, auto-publish, reply-to). Nothing existing changed
or removed; the old pools keep working for requests without assignees.

## How it ships — three PRs (decision H2)

| PR         | Contents                                                                                                                                   | Why first                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **v1.4.0** | A, B, B2 (departments, people manual + bulk, safe edit, roles refresh), department tagging of programmes, data-quality warnings (F14)      | Data must exist before anything can be scoped; the IC can tag people and programmes while 1.4.1 is built. |
| **v1.4.1** | C, D, E (assignees, department pickers + load, reassign, away/back-up, scoping, dashboards, escalation, My work, bulk assign) + F1–F5, F13 | The behaviour change, released once departments are filled in.                                            |
| **v1.4.2** | G emails + F6–F12, F15                                                                                                                     | Emails/digests/calendar/shortcuts build on the assignee data.                                             |

Each PR: plan section → screenshots → build → ci-local → your OK → merge → tag.

## Screenshots (this step)

Built as working first versions on this branch (dev data, four seeded departments):

1. **Admin → People** — list with department, roles, load; _Add person_; _Edit roles & department_ with the
   impact check.
2. **Admin → People → Upload** — preview with New / Changed / Unchanged / Error rows.
3. **IC → New request** — department HOG pre-selected, "other HOG" needs a reason.
4. **HOG → Allocate** — PC / faculty / SME pickers, own department first with load, "Show all departments".

Taken on a local production build against the dev database (read-only: the impact check and the upload preview
only check; no request was created or allocated). Files in `C:\work\review-shots\departments\`:

| File                                        | Shows                                                                         |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `01-admin-people-list.png`                  | People list (249 people) and the "236 have no department" warning             |
| `01b-admin-people-search-demo-accounts.png` | The 13 demo accounts: roles, department ("All" for IC/Admin), open work       |
| `02-admin-people-no-department-filter.png`  | "Show them" — people with a department role but no department                 |
| `03-admin-person-add.png`                   | Add person: name, BITS email, roles (multi-select), department, faculty type  |
| `04-admin-person-edit.png`                  | Edit person                                                                   |
| `05-admin-person-impact-check.png`          | Deactivating a faculty with an open, overdue handout → pick who takes it over |
| `06-admin-people-upload-preview.png`        | Upload preview: 1 new, 2 changed, 4 errors (second HOG, no department, …)     |
| `07-ic-new-request-hog-preselected.png`     | New request: CSIS course → CSIS HOG pre-selected with load                    |
| `08-ic-new-request-other-hog-reason.png`    | Another department's HOG chosen → reason required                             |
| `09-hog-allocate-department-first.png`      | Allocate: CSIS faculty / SME / PC only, PC pre-selected, load per person      |
| `10-hog-allocate-show-all-departments.png`  | "Show all departments": everyone else, marked _other dept_ / _no department_  |

**What the screenshots showed:** the dev database (like the server) has ~236 imported faculty with no
department. Until they are filled in, they sit behind "Show all departments" (search still finds them). Filling
them is one round-trip: _Download the list_ → fill the `department` column in Excel → _Upload people_ (H6).

## H. Decisions needed

1. **H1 — one department per programme** (a column on Programme) instead of a programme ↔ department table?
   Recommended: yes (simpler; a cross-listed course still gets one department through its offering's programme).
2. **H2 — ship as three PRs** v1.4.0 / v1.4.1 / v1.4.2 (above) instead of one big v1.4.0? Recommended: yes.
3. **H3 — departments: 4** (MBA/Management, Core Engineering, CSIS, EEE) — still to be confirmed with your sir.
4. **H4 — existing requests at release**: assign the department HOG automatically where known (recommended), or
   leave all existing requests visible to every HOG/PC until someone assigns them?
5. **H5 — people CSV columns**: exactly `email, name, roles, department` (+ optional `faculty_type`, `active`)?
6. **H6 — filling departments for the ~236 existing faculty**: the IC/Admin does it with Download → Excel →
   Upload after v1.4.0 is released (recommended), or we pre-fill a guess from each faculty's past courses'
   programmes for them to check in the upload preview?
7. **H7 — the IC/HOG pickers built for these screenshots (section C)** ship in v1.4.1 as planned — together with
   "only that HOG/PC is notified" and the department scoping — so v1.4.0 stays data-only (recommended); or ship
   the pickers already in v1.4.0 (for a programme with no department everyone is shown; once a programme is
   tagged, people without a department move behind "Show all departments")?
