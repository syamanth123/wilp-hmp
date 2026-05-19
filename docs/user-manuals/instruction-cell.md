# Instruction Cell (IC) — User Manual

The Instruction Cell owns the _start_ and _end_ of every handout lifecycle: it initiates the request against a course offering, publishes the approved handout to the LMS, and finally archives it.

## Login

1. Go to `/login`.
2. Sign in with your IC credentials (dev seed: `ic@hmp.local` / `password`).
3. You will land on `/ic` — the IC overview.

## Overview (`/ic`)

The overview shows:

- **Status counts** — number of requests at each lifecycle stage (Requested, Allocated, Assigned, ..., Published, Archived).
- **SLA widgets** — Approved-awaiting-publish counts split into on-track / due-soon / overdue.
- **Recent activity** — your latest audit entries.

## Creating a new request (`/ic/requests/new`)

1. Click **New request**.
2. Cascading dropdown: pick a Programme → Semester → Course offering. Only offerings with no active open request appear.
3. (Optional) Paste a URL to a previous handout for reference.
4. (Optional) Add notes for the HOG.
5. Click **Create request**. The system assigns a sequential `HMP-YYYY-####` reference number and transitions the request to `REQUESTED`. The relevant HOG is notified.

## Browsing requests (`/ic/requests`)

- Filter by status, programme, semester. Search by ref number or course code.
- Click any row to open the request detail.

## Request detail (`/ic/requests/[id]`)

The detail page always shows:

- Header card: ref number, course, programme/semester, current status.
- **Status timeline** — every audited transition.
- **Approvals** — every HOG/PC decision with comments.
- **Faculty assignments** — every assigned faculty + acceptance status.
- **Handout viewer** (once the faculty has started editing) — read-only render of the current version.
- **Version list** — every saved version with author + notes.
- **Comment thread** — request-level comments shared with HOG, PC, and Faculty.

Status-gated cards:

- `APPROVED` → **Publish to LMS** button. Pushes the current version to Taxila (stub), writes an `LmsPublishLog` row + `IC_PUBLISH` approval, transitions to `PUBLISHED`.
- `PUBLISHED` → **Archive handout** button. Requires confirm checkbox; transitions to `ARCHIVED`.
- All states → **Comment thread** with **Post comment**.

## Importing academic data (`/admin/import`)

If you are also given Admin access (recommended for IC leads), upload CSV files:

- `courses.csv` — `code,title,credits,description`
- `programmes_semesters.csv` — `programme_code,programme_name,semester_name,year,term,start_date,end_date,exam_date,ec1_deadline`
- `offerings.csv` — `programme_code,semester_name,course_code,slot_info`

Preview parses + validates the file. **Commit** upserts in a single transaction and writes an `ErpSnapshot`.

## Notifications

Click the bell in the top bar:

- Real-time updates of every request that involves you.
- "Mark all read" zeros the badge.
- Full paginated list at `/notifications`.

Every workflow transition also sends an email (Mailhog locally at `http://localhost:8025`).
