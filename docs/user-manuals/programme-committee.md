# Programme Committee (PC) — User Manual

The Programme Committee confirms allocated assignments and runs the review/rework loop on submitted handouts.

## Login

Sign in at `/login` (dev seed: `pc@hmp.local` / `password`). Lands on `/pc`.

## Your department (v1.4.1)

You see **your department's** requests, plus any request where you are the PC, and requests whose programme
has no department yet. Only the PC the HOG named confirms an allocation (and is told about it). If your
department isn't set, you see all departments and a notice says so.

## Overview (`/pc`)

- **Allocated** — requests in `ALLOCATED` awaiting your confirmation.
- **Submitted reviews** — requests in `SUBMITTED` awaiting your review.
- **SLA widgets** — pcReviewSla split into on-track / due-soon / overdue.

## Confirm assignment (`/pc/requests/[id]` when status is `ALLOCATED`)

1. Open the request. Review the HOG's faculty selection in **Faculty assignments**.
2. Click **Confirm assignment**. Status transitions `ASSIGNED`; `Approval(PC_REVIEW, APPROVED)` written. Faculty is notified.

## Review submission (`/pc/requests/[id]` when status is `SUBMITTED`)

1. Read the latest handout version in **Handout viewer**.
2. Compare against the previous version with **Version diff** (latest two by default; pick any pair via the version list).
3. Open the **AI quality report card** — Bloom's distribution, covered/missing syllabus topics, improvement suggestions. Click **Run check** to refresh.
4. Use the **Comment thread** to discuss inline with IC/HOG/Faculty.
5. Then either:
   - **Approve forward** → `REVIEW_APPROVED`, status → `UNDER_REVIEW`. HOG is notified.
   - **Request rework** → `REVIEW_REWORK`, status → `REWORK_REQUESTED`. Comment required. Faculty is notified.

## Reading-only states

After approval the request moves to HOG. You can still open it to see the final approval + publish log; review actions are disabled.

## Notifications

Bell + email + SLA reminders, same as every other role. Full list at `/notifications`.

## Handout Library (`/handouts`)

Find, read, compare and download handouts — published, in progress and past BITS handouts — from
**Handout Library** in the menu. See [handout-library.md](handout-library.md).

## v1.4.2 — due dates, My work, away

- **My work** (top of the overview): allocations to confirm and handouts to review, soonest due first.
- **Away:** in **My settings**, set the dates and a back-up PC. They confirm and review for you meanwhile.
- **Keyboard shortcuts** on the review page: **A** (then Enter) approve, **R** comment, **N** next, **?** help.
