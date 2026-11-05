# Admin Guide

The Admin role configures users, academic structure, workflow SLAs, AI metrics, notification templates, and reviews the audit log.

Login: `admin@hmp.local` / `password` in dev. Lands on `/admin`.

## Users (`/admin/users`)

- List/search/paginate.
- Create — name, email, initial password, role assignment.
- Edit — name, email, role assignment, active flag.
- Deactivate — soft delete (sets `active=false`; user can no longer log in).
- Role assignment uses the `Role` table; one user can hold multiple roles.

Every mutation writes an `AuditLog` row.

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
- `TAXILA_URL`, `TAXILA_TOKEN`, `TAXILA_HANDOUT_FOLDER` — publishing into Taxila (v1.3.0); off unless both URL and token are set
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
