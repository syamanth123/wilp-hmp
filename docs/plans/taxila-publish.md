# Plan — v1.3.0: publish handouts into Taxila, Dibba programme codes, email that never holds a page

Branch `feature/taxila-publish` off `main` @ `9a5a833` (v1.2.0). Brief: `local-data/NEXT-STEPS-v1.3.md`. IT's
method: `local-data/taxila_sync_approach.docx` ("QPM to Taxila"). **Plan only — no code until approved.**
Same rules as always: ci-local green before any push, no merge without your OK, never touch the server, no
secrets in git, **no real calls to Taxila from tests or CI** (a fake Moodle server stands in).

This plan **replaces** §B ("Mode C") of `docs/plans/lms-sso.md`. That section was never built and assumed a
standard Moodle function that doesn't exist; IT's document now gives the real method.

---

## 0. What exists today (checked in code)

| Area                   | Today                                                                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publishing             | `publishToLms()` (`packages/integrations/src/taxila.ts`): **Mode A** = generic HTTP POST to `TAXILA_API_URL/handouts` (never used for real); **Mode B** = ZIP to S3, IC uploads it by hand, then "Mark as manually published". IC button: `ic/requests/[id]/publish-panel.tsx` → `publishAction`. |
| Moodle client          | **None.** No code calls a Moodle web service. No fake Moodle exists.                                                                                                                                                                                                                              |
| PDF                    | `buildHandoutDocx()` + `docxToPdf()` are plain functions (Buffer in, Buffer out); asset loading and file naming are private to the download route — need moving into `lib/export`.                                                                                                                |
| Publish log            | `LmsPublishLog` (status string, `mode` enum `HTTP / EXPORT / MANUALLY_CONFIRMED`, `externalRef`, `s3Key`, `responseJson`). **Bug:** `components/publish-logs.tsx` shows EXPORTED and MANUALLY_CONFIRMED as a red "Failed".                                                                        |
| Email                  | nodemailer (`packages/integrations/src/email.ts`) with **no timeouts set** (defaults: ~2 min to connect). Production sends inline (`WORKERS_ENABLED` unset), and `publishAction` **awaits** the emails — a slow mail server holds the IC's page. `sendMail` logs nothing on failure.              |
| Notifications stream   | `api/notifications/stream`: timers are cleared only on `req.signal` abort, which Next 14 doesn't reliably fire; the heartbeat then writes to a closed stream → "Controller is already closed".                                                                                                    |
| Dibba ↔ HMP programmes | Only an exact code match (`lib/dibba-offering.ts` `matchProgramme`). No HMP programme carries a Dibba code, so "Create request" stops at "isn't set up" everywhere.                                                                                                                               |
| Background jobs        | BullMQ exists, but production runs without workers. No pattern for a long job with per-item progress in the database.                                                                                                                                                                             |

---

## A. Dibba programme codes → HMP programmes

- **Table** `DibbaProgrammeCode { id, code @unique, programmeId → Programme, createdAt, updatedAt, updatedById }`.
  `code` is the Dibba string exactly as imported ("18BT/18ET", "HT15", "MB21/HB21"). Additive migration; no change
  to `Programme`.
- **Admin → "Dibba programme codes"** (new tab; Admin only):
  - one row per distinct `DibbaEntry.programmeCode` in published imports, with the Dibba title ("B.Tech.
    (Engineering Technology)"), the number of courses, and a dropdown of active HMP programmes or "Not mapped";
  - an "Exact code match" note where a code equals an HMP programme code (works without a row);
  - **CSV upload** `code,programme_code` with a template, copying the IC bulk-upload pattern (parse → check every
    row → reject all with a per-row error list, or save all in one transaction; audit `dibba.programme_map.update`
    per changed code).
- **Rules:** mapping to an inactive programme is refused; a mapping row wins over the exact-code match; removing
  a mapping only affects future "Create request" plans (nothing already created changes).
- **Create request** (`planOffering`) uses mapping → else exact match. An unmapped code says: _"Programme code 18ET
  isn't linked to an HMP programme yet — ask Admin (Admin → Dibba programme codes)."_ A mapped code whose
  programme has no semester for the term keeps today's _"Sem-I 2025-26 isn't set up for programme …"_.
- **Library programme filter:** picking "MBA-WILP" also finds not-started courses whose Dibba codes map to it.
- **Tests:** mapped, unmapped, exact-code match, inactive programme refused, CSV reject-all with line numbers,
  non-admin refused.

## B. Publish into Taxila — "Mode C", exactly IT's QPM method

### B1. Moodle client — `packages/integrations/src/taxila-moodle.ts`

The five calls from IT's document, nothing else:

| #   | Call                                                                                                                             | Use                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GET `rest/server.php` `core_course_search_courses` (`criterianame=search`, `criteriavalue=<S1-26>`)                              | all courses of the Taxila semester                                                                                                                      |
| 2   | local match on `fullname`, case-insensitive                                                                                      | normal: contains `S1-26_SSZG653`; merged (several codes): contains the semester **and** a code (see §C Q5)                                              |
| 3   | GET `core_course_get_contents` (`courseid`)                                                                                      | section named exactly **General** → module `modname=folder` named exactly the handout folder → `contextid`, and the folder's file list (for duplicates) |
| 4   | POST multipart `upload.php?token=…`, field `file_1`                                                                              | `response[0].itemid` (draft area)                                                                                                                       |
| 5   | POST `rest/server.php` `local_move_file_from_draft` (`draftitemid, contextid, component=mod_folder, filearea=content, itemid=0`) | success **only** when `status == "success"`                                                                                                             |

- **Settings (env only):** `TAXILA_URL` (`https://taxila-aws.bits-pilani.ac.in/webservice/`, trailing slash kept as
  IT says), `TAXILA_TOKEN`, `TAXILA_HANDOUT_FOLDER` (default `Course Handout`, to be confirmed). Mode C is on when
  both `TAXILA_URL` and `TAXILA_TOKEN` are set; otherwise Mode B (ZIP) stays exactly as today. Mode A is retired
  from the UI (code kept, unused).
- **The token never leaves the client:** `wstoken` goes in the query/body as Moodle requires, and `upload.php` puts
  it in the URL — so every URL, error message, log line and `responseJson` passes through one `redact()` before it
  is stored or printed. Tests assert the token appears nowhere (errors, logs, DB rows, Excel report).
- **Timeouts and retries:** 30 s per call; calls 1, 3 and 4 retry on 5xx/timeouts (3 attempts, 1 s/3 s backoff).
  **Call 5 (move) is never blindly retried** — after a timeout HMP re-reads the folder (call 3); if the file is
  there it counts as success, otherwise it reports "Move failed" without a second copy.
- **Moodle errors** (`{"exception": …, "errorcode": …}` with HTTP 200) are recognised, and a missing function or
  permission turns into a plain message ("Taxila refused: the HMP token can't call local_move_file_from_draft —
  ask IT").
- **Plain-English results, one per step:** "Course S1-26_SSZG653 not found in Taxila" · "More than one Taxila
  course matches — pick one" · "Folder 'Course Handout' not found in General" · "Already in Taxila" · "Upload
  failed" · "Move failed" · "Taxila didn't answer in 30 s".
- **One search per semester code per run** (step 1 is cached for the run), so a bulk publish of 300 courses makes
  one search call, not 300.

### B2. One handout — "Check in Taxila", then "Publish"

On the IC request page (APPROVED handouts), replacing the Mode B panel when Mode C is on:

1. **Taxila semester code** — prefilled from the HMP semester (Sem-I 2026-27 → `S1-26`, Sem-II → `S2-…`), shown in
   an editable box so the IC can correct it.
2. **Check in Taxila** (no upload): shows the matched course (full name + "Open in Taxila" link), the folder found,
   the file name HMP will use, and whether that file is already in the folder. Several matching courses → the IC
   picks one. **Publish is enabled only after a passing check** (and re-checks inside the action).
3. **Publish**: builds the PDF with the existing export (**no DRAFT mark** — APPROVED only), file name
   `SS ZG653 Course Handout Sem-I 2026-27.pdf` (merged courses: codes joined with `_`), uploads, moves, then in one
   transaction: `LmsPublishLog { status: 'success', mode: TAXILA_FOLDER, externalRef: <course URL>, responseJson:
{ courseId, fullname, folder, contextid, filename, semesterCode } }`, status → **PUBLISHED** via the existing
   workflow event, IC_PUBLISH approval, audit. Faculty get the existing "published" email (§D keeps it fast).
4. **Duplicates:** if the file name is already in the folder, no upload — "Already in Taxila", with **Publish as
   new version** (adds " v2", " v3"… to the name).
5. Failures write `LmsPublishLog { status: 'failed', mode: TAXILA_FOLDER, responseJson: { step, message } }` and
   leave the handout APPROVED. The publish log card shows the step and message.

Mode B stays as the fallback when `TAXILA_TOKEN` is unset — the ZIP + "Mark as manually published" flow is
untouched.

### B3. Bulk publish (IC)

- **Library → Published tab → "Approved, not yet published"**: IC/Admin get checkboxes on APPROVED rows and a
  **Bulk publish to Taxila** bar (semester code box, "Check all" first, then "Publish checked").
- **How it runs — recommendation: in the browser, one course at a time, recorded in the database.** Production
  runs without workers, and 300 courses × (PDF ≈ 3–5 s + upload + move) is far longer than one request may take.
  So:
  - new tables `TaxilaPublishRun { id, createdById, semesterCode, status, counts, createdAt, finishedAt }` and
    `TaxilaPublishItem { runId, requestId, status, step, message, fileName, courseFullname, updatedAt }`;
  - the run page calls a server action "publish the next item" repeatedly and shows a live list (published / not
    found / folder missing / already there / failed);
  - closing the tab **pauses** the run; reopening it continues from the next pending item; nothing is published
    twice (each item is re-checked before upload, and APPROVED → PUBLISHED is guarded);
  - **Download as Excel** at any time (one row per course, with the reason).
  - _Alternative:_ a BullMQ job when `WORKERS_ENABLED=true` — not recommended now (workers are retired in
    production); the item table would let us add it later without changing the UI.
- One search call per run (B1), and a small pause between courses so Taxila isn't hammered (configurable,
  default 1 s).

### B4. Tests — never the real Taxila

- **Fake Moodle server** (`packages/integrations/src/testing/fake-moodle.ts`): a tiny HTTP server that speaks the
  five calls with saved-shape responses and can be told to fail at any step. Used by unit tests and by the browser
  tests.
- Unit/integration: each step's success and failure; merged-course matching; several matches; folder not found;
  upload failure; move failure and move timeout (re-read, no second copy); Moodle exception responses; duplicate →
  "Already in Taxila" and "new version"; the token never appears in errors/logs/DB/Excel; bulk run with partial
  failure, pause and resume.
- Browser tests: a new ci-local step **"e2e (Taxila on)"** starts the app with `TAXILA_URL` pointing at the fake
  server (like today's "AI on" step), so the existing Mode B tests (m6a, m6c) keep running unchanged in the main
  e2e step. Covers: check → publish → PUBLISHED; already-there; bulk run of three with one failure + Excel.

## C. Questions for IT (email draft — §C of the brief, plus three more the code needs)

> **Subject: HMP → Taxila handout publishing — five things we need before testing**
>
> Hello,
>
> Thank you for the QPM-to-Taxila document. HMP will publish approved course handouts into Taxila using exactly
> the same method (course search → General → folder → upload.php → local_move_file_from_draft). Before we test,
> could you help with the following:
>
> 1. **A dedicated web-service token for HMP** (not shared with QPM), whose service includes
>    `core_course_search_courses`, `core_course_get_contents` and `local_move_file_from_draft`, with **"Can upload
>    files"** enabled, plus the user/enrolment read functions we use today. Does the token's Moodle user need any
>    role in each course (for example to add files to a folder), or is a site-level permission enough?
> 2. **The folder name** the Instruction Cell should create in the **General** section of each course (we propose
>    "Course Handout"), and whether IC creates it in every course before publishing.
> 3. **The Taxila semester code format** — is Sem-I 2026-27 "S1-26"? What are Sem-II and the Summer term? And could
>    you name **a test course** we may publish into first?
> 4. **Same file name twice:** does `local_move_file_from_draft` replace a file with the same name, or add a second
>    one? (HMP will not upload a duplicate on its own; this is for "publish a new version".)
> 5. **Merged courses:** what does the Taxila full name look like for a course taught under several codes (e.g.
>    MBA ZC417 / PDBA ZC417)? An example full name would let us match it exactly.
>
> And two small ones: is there a **file-size limit** on upload.php for PDFs (ours are 200–800 KB), and how many
> calls per minute are acceptable during a bulk publish (we plan one course search per run and about one course per
> second)?
>
> Thank you,
> HMP team

## D. Email that never holds up a page (now that IT's SMTP is live)

- nodemailer timeouts: **connect 10 s, greeting 10 s, socket 20 s**.
- **Emails are sent after the page has answered:** the in-portal notification row is written as now; the email part
  runs in the background of the server process (not awaited by the action) and records SENT/FAILED on the row.
  The IC's Publish button returns as soon as Taxila and the database are done.
- `sendMail` logs failures without the password or message body (`[email] failed to=… subject=… error=…`), as
  `docs/deploy-new-server.md` already claims it does.
- `.env.production.template`: `WORKERS_ENABLED` comment corrected (production runs without workers); SMTP block
  matches IT's server (host/port/login names, **no password**).
- Test: a fake SMTP server that never answers → the action still returns in under 2 s and the row ends FAILED.

## E. Small fixes carried into v1.3.0

- **Notifications stream** ("Controller is already closed"): one idempotent `cleanup()` called from the stream's
  `cancel()`, from abort, and from the 5-minute cut-off; every write checks `closed` first; the abort check happens
  before the first database query. Unit test with a stream that is cancelled mid-tick.
- **Publish log badges:** EXPORTED → "Export prepared" (grey), MANUALLY_CONFIRMED → "Published (confirmed)"
  (green), TAXILA_FOLDER success → "Published to Taxila" with the course link; only `failed` is red.
- `turbo.json` env pass-through: drop the stale `TAXILA_BASE_URL`/`TAXILA_API_KEY`, add the new names.

## F. Database (one additive migration)

`DibbaProgrammeCode`, `TaxilaPublishRun`, `TaxilaPublishItem`, and `ALTER TYPE "LmsPublishMode" ADD VALUE
'TAXILA_FOLDER'`. Nothing existing is altered — rollback to v1.2.0 needs no restore.

## G. Order of work (one PR, commits in this order)

1. Email timeouts + send-after-response + logging; stream fix; publish-log badges (§D, §E).
2. Dibba programme codes: migration, admin page + CSV, Create request + library filter (§A).
3. Moodle client + fake Moodle + unit tests — no UI yet (§B1, §B4).
4. Single publish: Check in Taxila → Publish, PDF naming, duplicates/new version (§B2).
5. Bulk publish: run tables, Library selection, run page, Excel (§B3).
6. ci-local "e2e (Taxila on)" step + docs (env, deploy guide, IC manual, what-changed v1.3.0).

Screenshots before review: admin mapping page, Check in Taxila (found / folder missing / already there),
publish result, bulk run in progress and finished, Excel report.

## H. Decisions needed from you

1. **Bulk publish runs in the browser, one course at a time, pausable** (recommended) — or a background job?
2. **Semester code default** `Sem-I 2026-27 → S1-26`, `Sem-II 2026-27 → S2-26`; Summer → ask IT. OK to prefill
   and let the IC edit?
3. **Mode A** (generic HTTP) hidden from the UI and left unused — OK?
4. **File name** `SS ZG653 Course Handout Sem-I 2026-27.pdf` — OK, or does the IC want the HMP reference in it?
