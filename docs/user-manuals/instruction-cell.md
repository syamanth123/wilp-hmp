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
5. **Head of Group (v1.4.1):** the course's department HOG is pre-selected, with their current load
   ("3 open handouts · 1 overdue"). Choosing another HOG needs a reason. If the department has no HOG
   yet, the page says so ("CSIS has no HOG yet — set one in People") — set one, or pick another
   department's HOG with a reason. A request always has a HOG.
6. Click **Create request**. The system assigns a sequential `HMP-YYYY-####` reference number and
   transitions the request to `REQUESTED`. **Only that HOG** is told.

**Change the HOG** later on the request page (_Head of Group and PC_ → **Change**, with a reason): the old
and the new HOG are both told; the history keeps both names.

**Bulk upload of requests:** each request goes to its department's HOG. A row whose programme has no
department, or whose department has no HOG, is an error in the preview.

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
  - **Publishing into Taxila is set up (v1.3.1):** the Taxila semester code is filled in (Sem-I
    2026-27 → `S1-26`, Sem-II → `S2-26`; type it for Summer). **Check in Taxila** shows the course
    it found (with an _Open in Taxila_ link) and what its **Course Handout** File item in General
    holds — nothing is uploaded. **Publish to Taxila** appears only after a passing check: it makes
    the PDF, uploads it as **`Course Handout.pdf`** (always this name), replacing the file in the
    item, reads the item back to confirm it holds only the new file, then marks the handout
    Published and tells the faculty.
    - _Course not found_ — check the semester code and that the course exists in Taxila.
    - _Several courses match_ — pick the right one.
    - _No Course Handout item_ — in Taxila, add a **File** (not a folder) in General named
      **Course Handout**, with any PDF renamed to `Course Handout.pdf` as the placeholder; then
      check again. Every course needs this once.
    - _Other files in Course Handout_ — **publishing is blocked**. With more than one file, Taxila
      opens the oldest, so students wouldn't see the new handout. The message names each file to
      remove: open Course Handout → Edit settings, delete them, keep only `Course Handout.pdf`,
      save, check again.
    - _Not confirmed_ — the upload went through but the read-back didn't show exactly the new
      `Course Handout.pdf`; the handout stays Approved. Look at the course in Taxila, then publish
      again (it simply replaces the file).
    - The HMP reference, the Taxila course and the file size are recorded in the publish log.
  - **Not set up:** you get a ZIP to upload to Taxila yourself, then **Mark as manually published**.
- `PUBLISHED` → **Archive handout** button. Requires confirm checkbox; transitions to `ARCHIVED`.
- All states → **Comment thread** with **Post comment**.

## Existing requests without a HOG (v1.4.1)

**Departments → Existing requests without a HOG** lists every open request that has no HOG recorded yet: the
HOG each one gets (its department's), and the ones it can't assign with the reason and a _Fix_ link
(programme without a department, department without a HOG). Press **Give N requests their HOG** after the
departments are filled in. It never replaces a HOG already set and can be pressed again after fixing the
rest.

## Choose a different Taxila course (v1.4.1)

Under the result of **Check in Taxila**: **Choose a different Taxila course** → type part of the name (e.g.
`CIL_Exp`) → **Search Taxila** → pick it → **Use this course**. The choice is remembered for this course and
semester: the next check and bulk runs use it. The panel shows who chose it and when, with **Use the
automatic match again**. When several Taxila courses match, the one you pick is remembered the same way.
The Course Handout item rules still apply.

## People and departments (`/ic/people`, `/ic/departments`, v1.4.0)

The IC confirms which department each faculty member belongs to. The pages are the Admin's own,
with two limits: you can't give or remove the **Admin** role, and an **Admin account** opens
read-only.

- **IC overview → "Departments — what's missing"** says what is left to fill in.
- **People → Download the list (Excel)**: everyone, with a _suggested department_ (from the courses
  they taught) and _why_. Upload it back (**People → Upload people**), press **Accept all
  suggestions**, check the preview and **Apply**. Rows marked _Needs a decision_ (taught in more
  than one department, or a Head of Group) need the department typed in the file.
- **People → Edit** on one person: set the department (or **Use it** on the suggestion), roles,
  faculty type. If the change would leave open handouts without an owner, HMP asks who takes them
  over first.
- **Departments**: rename a department or make it inactive (never deleted); set the department of
  each HMP programme and each Course Dibba programme (**Accept all** takes the title suggestions).
- In an upload, a row that would change an Admin account or give the Admin role is marked _Error_;
  an Admin's row left exactly as it is passes.

## Bulk publish to Taxila (v1.3.0, fixed file name since v1.3.1)

Handout Library → **Published** → **Approved, not yet published**: tick the handouts (or _Tick all
approved on this page_), check the Taxila semester code and press **Bulk publish to Taxila**. The run
page works through them one at a time:

- **Check all (no upload)** first shows what would happen to each course.
- **Publish all** publishes everything that's ready. **Pause** stops after the current course;
  closing the page does the same — reopen the run from **Earlier runs** (`/ic/taxila-runs`) and
  press the button again. Nothing is published twice.
- **Try the N problem courses again** after fixing them (e.g. creating a missing Course Handout
  item, or removing an old file from it).
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

## v1.4.2 — due dates, My work, kick-off, away

- **My work** (top of the overview): approved handouts to publish, soonest due first; an automatic publish that
  stopped says why.
- **Kick off a semester** (tab): every Course Dibba course of the semester without a request, grouped by
  department.
  - Courses that can't start yet show the reason and a _Fix_ link.
  - Tick, check the HMP semester, due dates and starting content, then **Create N requests**. Each goes to its
    department's HOG.
- **Dashboard** (tab): not started / in progress / overdue / approved / published per department, and the workload
  per person. Every number opens the Library.
- **Due dates:** each request page shows every step's due date. **Change** sets one, with a reason.
- **New request** refuses a course that already has a request this semester, and links to it.
- **People → a person:**
  - mark them **away**, with a back-up;
  - **Undo** a role / department change within 24 hours;
  - **Deactivate…** hands over their open work first.
- **Earlier runs:** switch **auto-publish** on or off (off by default). Automatic runs are listed there.
- **My settings:** your own away / back-up, daily digest, weekly summary, calendar link.
