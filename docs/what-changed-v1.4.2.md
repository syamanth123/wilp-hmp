# What changed in HMP v1.4.2 — due dates, reminders and escalation, My work, and the small automations

**In one line:** every step of a handout now has a due date. Everyone's home page starts with **My work**,
overdue items escalate to the HOG and then the Instruction Cell (once switched on), people can mark
themselves away with a back-up, and the IC can start a whole semester's requests in one go.

**Before switching escalation on:** in **Admin → Workflow**, agree the due-date offsets with the IC, then
look at **What tomorrow's run would send**. Escalation is **off** after the release.

## For everyone

- **My work** at the top of your home page: what needs _you_, soonest due first, with "2 days left" or
  "3 days overdue". If you back up an away colleague, their items show too, marked "for Dr X (away)".
- **My settings** (left menu, under Account):
  - **Away:** "away until …" and, for HOG / PC / SME / IC, a **back-up** with the same role. Meanwhile
    the back-up sees your requests, gets your notices and reminders, and can act for you (recorded "for
    you"). Nothing is moved. Faculty can mark themselves away too; pickers show it.
  - **Email:** each notice at once (as before), or **one email a day at 09:00**. Urgent ones still come at
    once: sent back for changes, overdue, @mentions.
  - **Weekly summary** (HOG and IC): Monday 09:00. You can switch it off.
  - **Calendar:** a private link for Outlook / Google Calendar with your HMP due dates (updates by itself),
    and **Download .ics**. The link is shown once; **Replace link** makes a new one and the old one stops.
- **Request pages:** **Due dates** for every step. The current step is highlighted; finished steps show
  when they were done. The history names people ("HOG: Dr B (CSIS)", "PC: Dr A → Dr C · reason", "for Dr X
  (away)").
- **Comments:** type **@** to mention someone on the request; they get a notice and an email. **Reply**
  under a comment notifies everyone in that thread. The SME now gets comment notices.
- **Email links** open the exact page, also after signing in (the `?…` part is kept). SME links open the
  handout itself.

## For the Instruction Cell

- **Kick off a semester** (tab): every Course Dibba course of the semester without a request, grouped by
  department. Courses that can't start yet show why, with a _Fix_ link: Dibba code not linked, no
  department, no HOG, no HMP semester. Ready courses show their HMP semester, due dates and starting
  content. **Create N requests** sends each to its department's HOG.
- **Dashboard** (tab): per department — not started, in progress, overdue, approved, published, for a
  semester (remembered). Every number opens the Library list. **Workload** per person: open, due this week,
  overdue, away.
- **New request:** a course that already has a request this semester is blocked, with a link to it.
  Existing duplicates are left alone. The HOG picker shows who is away. The last semester you used is
  remembered.
- **Due dates:** change one step's date on a request, with a reason (**Change** on the request page). The
  request's HOG can too.
- **Auto-publish** (IC → Earlier runs, or Admin → Workflow): off by default. When on, a final approval
  publishes to Taxila automatically after a passing check, with the same rules (one
  `Course Handout.pdf`, read-back). Anything else stays Approved, shows in your **My work** as "Auto-publish
  stopped — …" and you are told. Automatic runs appear in Earlier runs.
- **People:**
  - mark someone away, with a back-up, on Edit person;
  - **Undo** a role / department change for 24 hours;
  - **Deactivate…** from the old Users page now goes through Edit person, which hands over their open work
    and removes them as anyone's back-up.
- **"Departments — what's missing"** adds:
  - Dibba codes not linked to an HMP programme (the kick-off can't start their courses);
  - how many courses have no department;
  - people away without a back-up.

## For Heads of Group

- **My department** (tab): the dashboard and workload for your department.
- **Allocate:**
  - **Suggested: Dr X — Course Dibba instructor** (**Use**);
  - **Same team as Sem-II 2025-26** (**Use this team**);
  - away people are marked.
- Copies of escalations: "Dr A's draft is 3 days overdue" (once escalation is on).
- **Keyboard shortcuts** on review pages: **A** goes to Approve (Enter approves), **R** to the comment
  box, **N** next item, **?** the list. Same for PC and SME review.

## For the Admin

- **Admin → Workflow:**
  - due-date offsets (days before the semester starts: 35 / 21 / 17 / 14 / 10 / 7) and the SME review
    time;
  - **Escalation** on / off and after how many days (3; the IC after 6);
  - **Auto-publish**;
  - **What tomorrow's run would send**: a preview, nothing sent.
- **Admin → Notifications → Run the daily run now.**
- **Admin → Background jobs:** a third queue, _Daily run, weekly summary and auto-publish_.

## For the deployer

- **Database:** one additive migration, `20261112100000_workload_deadlines`.
  - Four new tables: `UserPreference`, `RequestDeadline`, `EscalationStep`, `ScheduledRun`.
  - New columns with defaults or empty values: `HandoutRequest.statusChangedAt` (filled from each
    request's history), `Comment.parentId`, `TaxilaPublishRun.auto`, and `WorkflowConfig` settings.
  - Escalation and auto-publish start **off**. Rolling back to v1.4.1.1 with the snapshot is safe.
- **No new server step:**
  - the daily (09:00) and Monday runs start inside `hmp-worker`;
  - each run is recorded once per day / week, so an old reminders timer calling `/api/cron/reminders` does
    no harm.
- **Calendar feed:** `GET /api/calendar/<token>.ics`. The token is a private link: keep the path
  **`/api/calendar/`** out of the web-server access log. `/api/calendar/download` needs a signed-in
  session.
- Release with tag **v1.4.2** and snapshot **`hmp-before-v1-4-2`**.
