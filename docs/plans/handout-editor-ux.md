# Handout editor UX — document-style inline editing

Branch `feature/handout-editor-ux` (off `feature/course-dibba`). Goal from the manager: faculty
edit the handout **on a page that looks like the finished handout**, simple enough for anyone,
with Preview as its own button. Nothing about saving, submitting, the workflow or the data
changes.

## 0. Decisions

- **D1 — Same styling as the published handout, no renderer change.** `handout-renderer.ts`
  exports its existing stylesheet as `BITS_HANDOUT_CSS` (the same two strings it already
  inlines). The editor wraps its page in `<div class="bits-handout">` and injects that CSS, so
  fonts, tables, borders and spacing are identical. `renderBitsHandout()` output is
  byte-for-byte unchanged; its snapshot tests stay green.
- **D2 — Edit in place.** Every value on the page is an inline field styled to look like the
  printed text: transparent background, no border. Editability is shown gently:
  - hover → light dashed outline;
  - focus → soft yellow fill (`#fff8d6`) and a solid outline;
  - empty → grey placeholder in the field's own words ("Click to add course title").
    Plain values use auto-growing `<textarea>`/`<input>`; rich text (description, guidelines)
    uses the existing TipTap `RichTextSubEditor`, restyled to blend into the page. Lists
    stored as arrays (course numbers, instructors) are typed as comma-separated text inline.
- **D3 — Tables.** Objectives, outcomes, books, sessions, evaluation: "+ Add row" under each
  table, a small delete icon on row hover, codes (CO1, LO1, T1, R1…) renumbered automatically
  after add/delete. (Sections after Part A — step 2.)
- **D4 — Rules shown where they apply, in plain words.** Weights must total 100% (running
  total beside the evaluation table, green/red); at least one CO and one LO before submit
  (message under the empty table). No top banner except a failed save.
- **D5 — Toolbar.** Sticky: **Save draft · Preview · Submit for review**, an "Unsaved changes"
  dot, "Saved 3:42 PM", and a **More** menu holding AI Draft and Version notes. Disabled
  buttons say why on hover.
- **D6 — Separate Preview.** Full-screen read-only view rendered by the unchanged
  `renderBitsHandout()` ("Exactly what gets published"), with **Back to editing** and
  **Download PDF**. PDF comes from the existing export route, which renders the **last saved
  version**; with unsaved changes the button says "Save first to download".
- **D7 — Rollout.** Step 1 (this gate): letterhead + course-details table in the new style,
  new toolbar and Preview; the remaining sections keep their current forms below a divider so
  the editor stays fully usable. Step 2 (after approval): convert the remaining sections,
  then the polish pass on the other demo pages.

## 1. Step 1 — what is built for review

- `packages/db/src/handout-renderer.ts`: `export const BITS_HANDOUT_CSS` (no output change).
- `structured-editor/document/` — `DocumentPage.tsx` (page frame + CSS), `InlineField.tsx`
  (auto-grow inline text), `HeaderBlock.tsx` (letterhead: institution, division, semester,
  document title read-only as in the request; form number editable), `CourseDetailsBlock.tsx`
  (Course No(s), Course Title, Credit Units, Credit Model + hours, Instructors, Version No,
  Date — the same rows, order and labels as the renderer's course-details table).
- `structured-editor/EditorToolbar.tsx`, `structured-editor/PreviewOverlay.tsx`.
- `StructuredEditor.tsx` wires them in; `PartAMetadata` / `InstitutionalHeader` forms retire.
- Demo data: one IN_PROGRESS assignment for `faculty@hmp.local` pre-filled from an approved
  corpus handout (via the real Start editing path).

## 2. Step 2 — after approval

Convert Course Description, Objectives, Outcomes, Books, Course Plan, Experiential Learning,
Evaluation, Important Links and Guidelines; then the polish list (HOG table pill → icon +
filter, check lists as tables, "No class" grid cell, plain-word badges, "New batch",
`05 Dec 2026` dates, demo-term name, 1366×768 sweep). Update `m10-structured-editor.spec.ts`;
new e2e: edit a CO inline → Preview shows it → Save → reload keeps it. ci-local on the final
commit, push (no merge), before/after screenshots.

## 3. Unchanged

Data model, `BitsHandoutV1`, save/submit actions, workflow transitions, renderer output,
export routes. No migration.
