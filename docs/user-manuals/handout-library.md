# Handout Library — User Manual (all roles)

One place to find, read, compare and download every handout you may see: **published**, **in
progress**, and **past BITS handouts** (the old Word files the administrator approved for reuse).
Open it from **Handout Library** in the menu, or go to `/handouts`.

## What you see

| You are                  | Published | In progress                                    | Past BITS handouts |
| ------------------------ | --------- | ---------------------------------------------- | ------------------ |
| Admin, Instruction Cell  | all       | all                                            | all                |
| HOG, Programme Committee | all       | all (HMP has no programme-per-person link yet) | all                |
| Faculty                  | all       | **only your own** (tab is called My handouts)  | all                |
| Subject expert (SME)     | all       | **only the ones assigned to you**              | all                |

Someone else's draft never shows up for faculty or SMEs — not in a list, a count, a search
suggestion, an Excel file or a download. Opening one by its link shows "You don't have access".

Drafts that were never started and rejected requests are only for Admin, IC, HOG and PC, and only
when picked in the **Status** filter.

## The page opens on your list

| Role     | Opens on              | Other quick views (one click)                                                                 |
| -------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Faculty  | Needs my action       | Due this week · Sent back for changes · Published (mine) · Last year's handout for my courses |
| SME      | Waiting for my review | Reviewed by me · Published (mine)                                                             |
| HOG / PC | Needs my action       | Overdue · Sent back for changes · Approved, not yet published · Changed a lot since last year |
| IC       | This semester         | Not started yet · Overdue · Approved, not yet published · Published this week                 |
| Admin    | This semester         | as IC, plus Past BITS handouts awaiting approval (opens Admin → Corpus imports)               |

Every quick view and tab shows how many courses it holds; the number is always the length of the
list it opens. A tab's number counts everything in that tab under your search and filters, so it
stays the same while you move between quick views. "Needs my action" is the same rule as the cards
on your dashboard.

**Not started yet** lists the courses in the published Course Dibba schedule that have no handout
request for that semester. Cross-listed codes — the same title taught in the same Dibba slot — are
one row, shown as "ENGG ZC232 / ET ZC232 / PE ZC234", and count once; a request for any one of the
codes takes the course off the list. Rows whose codes have **different course numbers** (e.g. "PE
ZC234" next to "ET ZC232") show "Different course numbers — check" to IC and Admin. Updated and Due
show "—" (nothing has happened yet). Course titles typed in capitals in the Dibba are shown in title
case ("IoT in Manufacturing"), or as the course catalogue has them.

**Create request** (IC and Admin, on each not-started row):

- If the course is already offered that semester, New request opens with it filled in.
- If not, HMP first asks: _"This will add ET ZC232 / ENGG ZC232 to Sem-I 2025-26 (18ET) and open a
  new request."_ It lists every code the request will cover, warns about different course numbers,
  and lets you pick the programme when several are set up. Only after **Add and continue** does it
  add the course offering — and the course, if none of its codes is in the course catalogue — then
  opens New request filled in. Existing courses and offerings are never changed, and what was added
  is recorded in the audit log.
- The semester must already exist for that programme in HMP (Admin → Programmes). If it doesn't,
  you see e.g. _"Sem-I 2025-26 isn't set up for programme 18ET yet — ask Admin to add it"_ and
  nothing is added. A Dibba programme ("18BT/18ET") matches the HMP programme whose code is the
  whole code or one part of it (18BT or 18ET).
- Project and dissertation codes (ending in T) can't be added to the catalogue this way; Admin adds
  them.

The page remembers the view you used last (in this browser). "Back to …" under the title returns to
your default.

## Search and filters

- **Search** (press `/` to jump there): course code, title, faculty, SME or HMP reference.
  "ss zg 653", "SSZG653" and "SS ZG653" all find SS ZG653; names ignore capitals and accents.
  Suggestions appear after two letters — pick a course, or (IC/HOG/PC/Admin) a person to filter by.
- **Filters** (left; a **Filters** button on small screens): semester (starts on the current one),
  programme, discipline, status, people (IC/HOG/PC/Admin), dates (deadline, last updated,
  published), schedule from the Course Dibba (slot, day, session, course type), published to
  Taxila, sent back for changes, changed vs last year.
- Every option shows its count; options with nothing are greyed. Results change as you pick — there
  is no Apply button.
- **Dates** are typed day first, **dd/mm/yyyy** (e.g. 05/11/2026), whatever language your browser
  uses — or pick one from the calendar button. A typed date applies when you press Enter or leave
  the box. The same date boxes are used on the Course Dibba and semester pages.
- Active filters show as chips above the list; ✕ removes one, **Clear all** removes them all.
- The address holds everything, so you can bookmark a view or send it to a colleague (they still
  only see what their own role allows).
- **Save this view** (top right of the list) keeps it under a name, e.g. "MBA overdue". Saved views
  appear under the quick views; ✕ removes one. Only you see your saved views.
- **Export to Excel** (IC, HOG, PC, Admin; top right): the filtered list, one row per handout —
  course, semester, status, faculty, SME, due date, last updated, published date. No handout
  content.
- Sort by clicking a column heading: course code, status, due date, last updated.

The list shows **one row per course** (its latest handout); "N more for this course" opens the
course history. The **Due** column shows "Overdue by 2 days" in red, "Due in 3 days", and so on —
worked out from the workflow time limits in Admin → Workflow Config.

## Course history (`/handouts/course/<code>`)

Every handout for one course, newest semester first — HMP handouts and past BITS handouts together,
each labelled with where it came from and its status. **Compare with previous** opens the two side
by side. Also linked from the Course Dibba schedule (click a course code) and from the faculty
"Start from last year's handout" panel.

## Reading a handout (`/handouts/<id>`)

- The handout exactly as Preview and the published file show it.
- At the top: course, semester, status, faculty, SME, reference, due or published date — and the
  button for **your** next step (e.g. faculty **Open in editor**, IC **Publish**), which opens the
  usual page for it.
- **Version history** (who saved it, when, notes) with **View this version** — for the people who
  could see it while it was being written (IC/HOG/PC/Admin, its faculty, its SME).
- **Compare** another version, or last year's handout: section by section, added (green),
  removed (red, struck through) and changed words marked. Handouts written before the sectioned
  editor say "Comparison isn't available".
- In a past BITS handout (viewer, compare and download), parts the old Word file didn't have read
  **"Not found in the old handout file"**.

## Downloading

**Download → Word or PDF**.

- Anything in the **Published** tab: everyone who can see it.
- In progress: the faculty member on it (after their first submission), the Programme Committee,
  and the assigned SME.
- Any download of a handout that isn't in the Published tab is marked **"DRAFT – not for
  circulation"** (a red line at the top of every page; the PDF also has a large diagonal mark).
- Every download is recorded in the audit log (who, which handout, which format).
- Past BITS handouts can be downloaded by everyone.
