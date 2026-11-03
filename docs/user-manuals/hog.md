# HOG (Head of Group) — User Manual

The HOG allocates faculty to incoming requests (enforcing the off-campus/adjunct/guest cap) and gives the final approval before publish.

## Login

Sign in at `/login` (dev seed: `hog@hmp.local` / `password`). Lands on `/hog`.

## Overview (`/hog`)

- **Pending allocation** — requests in `REQUESTED` waiting for you.
- **Pending final approval** — requests in `UNDER_REVIEW` waiting for you.
- **SLA widgets** — on-track / due-soon / overdue split for your queue, using `hogReviewSla` and `hogFinalSla` from Workflow Config.
- **Recent activity** — your audit feed.

## Allocating faculty (`/hog/requests/[id]` when status is `REQUESTED`)

1. Open a request from `/hog/requests`.
2. The **AI suggestions** section ranks the top-5 faculty by score with rationale bullets and current semester load. When AI keys are unset, the section shows a yellow `Heuristic-only` badge — the scoring still works.
3. Click **Add to selection** on each suggested faculty, or use the manual checkbox list below.
4. Off-campus / adjunct / guest faculty already at the `offCampusMaxCourses` cap (default 3 per semester) are greyed out — selecting them returns `WorkflowError("off_campus_cap_exceeded")` and rolls back.
5. Click **Allocate**. The system creates `FacultyAssignment` rows + `Approval(HOG_REVIEW, APPROVED)` + status transition `FACULTY_ALLOCATED` atomically. PC and the allocated faculty are notified.

The **Regenerate** button clears today's cached `AIRecommendation` row and re-runs the recommender.

## Final approval (`/hog/requests/[id]` when status is `UNDER_REVIEW`)

After the PC approves a submission the request lands in your queue.

- **Approve** → `FINAL_APPROVED`, status → `APPROVED`. IC + faculty are notified.
- **Reject** → `FINAL_REJECTED`, status → `REJECTED`. Comment required.
- **Request rework** → `REVIEW_REWORK`, status → `REWORK_REQUESTED`. Comment required. Faculty is notified.

## Reviewing the handout

Whenever a handout exists you can read:

- **Handout viewer** — current version's HTML render.
- **Version list + diff** — compare latest two versions side-by-side.
- **AI quality report card** — Bloom's distribution, syllabus coverage, suggestions. Click **Run check** to refresh.
- **Approvals list** — every prior PC/HOG decision with comments.
- **Comment thread** — request-level discussion shared with IC/PC/Faculty.

## SLA reminders

If a request sits in your queue past 75% of the configured SLA you get a `due_soon` notification; past 100% you get an `overdue` reminder. Admin can manually trigger the sweep on `/admin/notifications`.

## Notifications

The bell in the top bar shows real-time updates. Full list at `/notifications`. Emails go to Mailhog locally.

## Handout Library (`/handouts`)

Find, read, compare and download handouts — published, in progress and past BITS handouts — from
**Handout Library** in the menu. See [handout-library.md](handout-library.md).
