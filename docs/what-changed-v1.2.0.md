# What changed in HMP v1.2.0 — the Handout Library

**In one line:** every handout — published, in progress, and the old BITS Word handouts — can now
be found, read, compared and downloaded in one place, **Handout Library** in everyone's menu.

## For everyone

- **One list, already filtered for you.** Faculty open on "Needs my action", SMEs on "Waiting for
  my review", HOG/PC on "Needs my action", the Instruction Cell and Admin on "This semester". Other
  common lists are one click away, each with its count.
- **Forgiving search.** "ss zg 653", "SSZG653" or a faculty name all work; suggestions appear as you
  type.
- **Filters that explain themselves.** Every option shows how many courses it would leave; active
  filters show as chips you can remove. A view can be bookmarked, shared, or saved under a name.
- **Course history.** Every handout for a course across semesters on one page, with "Compare with
  previous".
- **Compare.** Any two versions, or this year's handout against last year's, side by side per
  section — added, removed and changed parts marked.
- **Downloads.** Published handouts can now be downloaded by everyone who can see them. Unfinished
  handouts carry a **"DRAFT – not for circulation"** mark, and every download is logged.

## Role by role

- **Faculty:** your own handouts only (plus everything published and the past BITS handouts). "Due
  this week", "Sent back for changes", and "Last year's handout for my courses" are one click away.
- **SME:** the handouts assigned to you; you can now download them while you review.
- **Programme Committee:** can now download handouts under review.
- **HOG / PC:** "Overdue" and "Changed a lot since last year" (worked out when you open it).
- **Instruction Cell / Admin:** "Not started yet" — courses in the published Course Dibba with no
  handout request yet, cross-listed codes counted once ("ENGG ZC232 / ET ZC232"), each with a
  **Create request** button that opens New request already filled in — after a confirmation it
  first adds the course offering (and the course) from the Dibba when HMP doesn't have it yet, in
  the programme's existing semester; "Approved, not yet published"; **Export to Excel** of any
  filtered list.

## Also in this release

- **Dates are typed day first (dd/mm/yyyy)** in every date box — the library filters, Course Dibba
  terms and exam dates, semester dates — whatever language the browser uses, with a calendar to
  pick from. (A browser set to US English used to show mm/dd/yyyy.)

## What did not change

- No workflow step changed; the library only links to the existing pages for the next action.
- Nobody sees more drafts than before: faculty and SMEs still see only their own in-progress work.
- HOG and PC still see every programme (HMP has no programme-per-person link). Limiting them to
  their own programmes would need a programme field on user accounts — a later change if wanted.

## For the deployer

One additive database change (a new `SavedView` table for saved views; nothing existing is
altered). Deploy as in `docs/deploy-new-server.md` §9; after `migrate deploy`, `migrate status`
must say "Database schema is up to date!". No new settings, no new S3 permissions.
