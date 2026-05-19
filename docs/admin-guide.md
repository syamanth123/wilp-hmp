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
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` — Mailhog locally, real SMTP in prod
- `CRON_SECRET` — required for `/api/cron/reminders`
- `AI_PROVIDER` (`openai` | `anthropic`) + `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. Empty keys → heuristic-only fallback.
- `S3_ENDPOINT`/`S3_BUCKET`/`S3_ACCESS_KEY`/`S3_SECRET_KEY` — MinIO locally.
