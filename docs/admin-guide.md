# Admin Guide

The Admin role configures users, academic structure, workflow SLAs, AI metrics, notification templates, and reviews the audit log.

Login: `admin@hmp.local` / `password` in dev. Lands on `/admin`.

## People (`/admin/people`, v1.4.0)

The Instruction Cell has the same page at `/ic/people` (and Upload, the Excel download and
Departments at `/ic/departments`), with two limits: the IC can't give or remove the Admin role and
can't change an Admin account (it opens read-only; in an upload such rows are errors). Every change
is audit-logged with the person who made it.

One person = one BITS email = one department, with any mix of roles. HOG, PC, faculty and SME
need a department; Instruction Cell and Admin cover all departments. Each department has one HOG.

- **List:** roles, department, open handouts ("3 open handouts · 1 overdue") and status. Search, and
  filter by role, department (including _No department_) and status.
- **Add / Edit person.** If a change would leave open handouts without an owner (a role removed, the
  department changed, or the person switched off), Save first lists them. Pick who takes each one
  over (or one person for all), then **Hand over and save**: the change and the hand-over are saved
  together. The last Admin can't lose the Admin role.
- **Changes take effect on the person's next page** (re-read within 5 seconds), without signing out.
  Someone switched off lands on the sign-in page with "Your Handout Portal account is switched off".
- **Upload people** (CSV or Excel): `email, name, roles, department`.
  - Roles are `ADMIN, IC, HOG, PC, FACULTY, SME`, separated by `;`. Column names may be in any case;
    extra columns are ignored.
  - The preview marks every row New / Changed / Unchanged / Error. Apply saves all rows or none, and
    never deletes anyone.
  - A row that would take a role or department away from someone with open handouts is an Error:
    use Edit for that, so the hand-over happens.
- **Suggested departments (H6).** A person with no department yet can be left blank in the file. The
  preview shows the department the courses they taught point to (Dibba instructor rows and HMP
  allocations; each programme's department comes from Admin → Departments).
  - Accept them one by one, or with **Accept all suggestions**. Nothing is saved unless you accept.
  - Someone who taught in more than one department gets **Needs a decision** and no suggestion.
  - A HOG's department is always chosen by hand.
- **Download the list (Excel):** the upload format plus _suggested department_ and _why_ columns
  (information only). The department column offers the codes as a dropdown.
- **Password sign-in accounts** (`/admin/users`, linked from People): create password logins where
  BITS sign-in isn't used.

Every change writes an `AuditLog` row.

## Departments (`/admin/departments`, v1.4.0)

- **Departments:** add, rename, switch off (only once nobody active is in it). There is no delete. Shows each one's HOG
  (or "No HOG yet"), its number of people and its programmes.
- **HMP programmes:** pick each programme's department (saved at once). A request belongs to its
  programme's department.
- **Course Dibba programmes:** each Dibba code takes the department of the HMP programme it is
  linked to (Admin → Dibba codes). Otherwise, pick it here. A code with no department shows a
  suggestion from its title ("MBA (Finance)" → MBA, "VLSI" → EEE, "Software" → CSIS, other
  M.Tech/B.Tech → Core Engineering): click it, or **Accept all N suggestions**. Nothing is set
  automatically.
- The Admin overview's **Departments — what's missing** panel lists what is still empty.

## Roles (`/admin/roles`)

Read-only view of all roles and their permission matrix. Permissions are seeded; editing the matrix is a future enhancement.

## Programmes & courses (`/admin/programmes`)

- CRUD Programmes, Semesters, Courses.
- For bulk loads, prefer the CSV importer.

## Dibba programme codes (`/admin/dibba-codes`, v1.3.0)

The Course Dibba names programmes by batch code (18BT/18ET, HT15, MB22 …). Link each one to an HMP
programme so that **Create request** (Handout Library → Not started yet) knows which semester to add a
course to. Pick the programme in the row's dropdown (saved at once), or upload a CSV
`code,programme_code` (template on the page; one bad row saves nothing and the rows to fix are
listed). A Dibba code that equals an HMP programme code — or one part of it, e.g. 18ET in 18BT/18ET —
works without a link. Inactive programmes can't be linked. Every change is in the audit log.
Unlinked rows show **Looks like … — Link to …** when an HMP programme has a similar name (same degree
and a shared subject word); it is only a suggestion — nothing is linked until you click it.

## CSV import (`/admin/import`)

Three importers, each Zod-validated:

- `courses.csv` → `code,title,credits,description`
- `programmes_semesters.csv` → `programme_code,programme_name,semester_name,year,term,start_date,end_date,exam_date,ec1_deadline`
- `offerings.csv` → `programme_code,semester_name,course_code,slot_info`

Preview → commit. Commit is atomic per file and creates an `ErpSnapshot` row for traceability. Any invalid row rejects the whole file.

## Workflow configuration (`/admin/workflow`)

- Edit SLAs (hours): `hogReviewSla`, `pcReviewSla`, `facultySubmitSla`, `hogFinalSla`.
- Edit `offCampusMaxCourses` (default 3 — the cap for off-campus/adjunct/guest faculty per semester).
- Read-only state diagram of the lifecycle.

## Notifications (`/admin/notifications`)

- Read-only list of seeded `NotificationTemplate`s (`handout.requested`, `handout.allocated`, `handout.assigned`, `handout.submitted`, `handout.rework`, `handout.approved`, `handout.published`).
- Current SLAs from Workflow Config.
- **Run reminder sweep now** — manually triggers `/api/cron/reminders` with the configured `CRON_SECRET` from the server. Returns `{ scanned, dueSoon, overdue, notified }`.

## AI metrics (`/admin/ai-metrics`)

- **Provider status** — current `AI_PROVIDER`, whether each API key is set, last error.
- **Usage table** — last 14 days of `AIRecommendation` + `AIQualityReport` counts.
- **Embedding corpus** — counts per `ownerType + model`.
- **Re-embed all** — triggers `ensureCorpusEmbeddings()` to pre-warm the table after switching providers.

## Audit log (`/admin/audit`)

Paginated read-only viewer of every audited action. Filters by actor, action, target. Every workflow transition, admin mutation, CSV import, publish, archive, comment, and AI generation writes an entry.

## Environment

The portal reads its config from `.env` (see `.env.example`). Key vars:

- `DATABASE_URL`
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` — Mailhog locally, real SMTP in prod (`SMTP_TIMEOUT_MS`, default 10000)
- `TAXILA_URL`, `TAXILA_TOKEN` — publishing into Taxila (v1.3.0; each course's "Course Handout" File item, file `Course Handout.pdf`, since v1.3.1); off unless both are set
- `CRON_SECRET` — required for `/api/cron/reminders`
- `AI_PROVIDER` (`openai` | `anthropic`) + `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Empty keys → heuristic-only fallback.
- `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` — MinIO locally.

## Handout Library (`/handouts`, v1.2.0)

Every role has **Handout Library** in its menu — see
[user-manuals/handout-library.md](user-manuals/handout-library.md). Admin-specific: the quick view
"Past BITS handouts awaiting approval" opens Admin → Corpus imports (only approved imports appear
in the library); every download (`handout.export`, `handout.past_export`) and Excel export
(`library.export`) is in the audit log. Saved views live in the `SavedView` table (one row per
person and name).
