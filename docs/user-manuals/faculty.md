# Faculty — User Manual

Faculty accept assignments, edit handouts in a rich text editor, save versions, submit for review, and address rework comments.

## Login

Sign in at `/login` (dev seed: `faculty@hmp.local` / `password`). Lands on `/faculty`.

## Overview (`/faculty`)

- **Pending acceptance** — assignments where you haven't clicked Accept yet.
- **Editing** — handouts in `ASSIGNED` (accepted), `IN_PROGRESS`, or `REWORK_REQUESTED`.
- **Awaiting review** — `SUBMITTED` / `UNDER_REVIEW`.
- **Done** — `APPROVED` / `PUBLISHED`.
- **SLA widgets** — facultySubmitSla split for your in-flight handouts.

## Accept an assignment

1. Go to `/faculty/assignments`. New rows have an **Accept** button on the detail page.
2. Open the detail page (`/faculty/assignments/[id]`). Click **Accept assignment**.
3. The system sets `acceptedAt` on your `FacultyAssignment`. The **Start editing** button appears.

## Start editing

Click **Start editing**:

- Transitions status `ASSIGNED → IN_PROGRESS`.
- Lazily creates `HandoutVersion(versionNo=1)` from the `Standard Handout` template.
- Loads the TipTap editor with the template body.

## Edit + save versions

The editor is TipTap with StarterKit + headings (levels 1–3).

- **Autosave on blur** writes a new version silently.
- **Save version** button writes a new version with an optional note. Status stays `IN_PROGRESS`.
- Each save appends a `HandoutVersion` row and updates `Handout.currentVersionId`.

The **Version list** below the editor shows every saved version with author + notes + timestamp. Click **Compare** to view a server-rendered line-based diff between any two versions.

## Submit for review

Click **Submit for review**:

- Saves the current draft as a new version.
- Transitions status to `SUBMITTED`.
- Notifies all PC members.
- Auto-triggers an AI quality check (best-effort) on the new version.

The editor becomes read-only.

## Handle rework

If the PC requests rework:

- Status becomes `REWORK_REQUESTED`.
- The editor reopens.
- The PC's comment appears in **Approvals list**.
- After addressing, click **Resubmit**. Status → `SUBMITTED` again.

## AI Quality check

The **Quality panel** on your detail page shows the latest report (if any) for the current version:

- Overall score (0–1).
- Bloom's taxonomy distribution bars.
- Covered vs missing syllabus topics.
- Markdown improvement suggestions.

Click **Run quality check** to refresh. Rate-limited to one call per minute per version.

## Comments

The **Comment thread** at the bottom of every detail page is shared with IC/HOG/PC. Use it for clarifications and PC feedback loops.

## Notifications

Bell + email + SLA reminders. `/notifications` for the full list.
