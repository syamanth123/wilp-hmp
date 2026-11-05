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

- `APPROVED` → **Publish to LMS**. Two ways, depending on the server:
  - **Publishing into Taxila is set up (v1.3.0):** the Taxila semester code is filled in (Sem-I
    2026-27 → `S1-26`, Sem-II → `S2-26`; type it for Summer). **Check in Taxila** shows the course
    it found (with an _Open in Taxila_ link), the folder (_General › Course Handout_) and the file
    name — nothing is uploaded. **Publish to Taxila** appears only after a passing check: it makes
    the PDF, puts it in the folder, marks the handout Published and tells the faculty.
    - _Course not found_ — check the semester code and that the course exists in Taxila.
    - _Several courses match_ — pick the right one.
    - _Folder missing_ — create a folder named **Course Handout** in the course's General section,
      then check again.
    - _Already in Taxila_ — nothing is uploaded; **Publish as new version** adds " v2" to the name.
    - File names: `SS ZG653 Course Handout Sem-I 2026-27.pdf`; courses with several codes join them
      with " \_ ". The HMP reference and the Taxila course are recorded in the publish log.
  - **Not set up:** you get a ZIP to upload to Taxila yourself, then **Mark as manually published**.
- `PUBLISHED` → **Archive handout** button. Requires confirm checkbox; transitions to `ARCHIVED`.
- All states → **Comment thread** with **Post comment**.

## Bulk publish to Taxila (v1.3.0)

Handout Library → **Published** → **Approved, not yet published**: tick the handouts (or _Tick all
approved on this page_), check the Taxila semester code and press **Bulk publish to Taxila**. The run
page works through them one at a time:

- **Check all (no upload)** first shows what would happen to each course.
- **Publish all** publishes everything that's ready. **Pause** stops after the current course;
  closing the page does the same — reopen the run from **Earlier runs** (`/ic/taxila-runs`) and
  press the button again. Nothing is published twice.
- **Try the N problem courses again** after fixing them (e.g. creating a missing folder).
- **Download as Excel**: one row per course with its result and reason.
- When the last course is done the page says **Finished: 2 published, 1 needs attention** (for
  example), and the person who started the run gets the same summary in HMP and by email.
- With no Taxila settings on the server, none of this appears: the IC keeps the ZIP export.

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

## Handout Library (`/handouts`)

Find, read, compare and download handouts — published, in progress and past BITS handouts — from
**Handout Library** in the menu. See [handout-library.md](handout-library.md).
