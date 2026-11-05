# What changed in HMP v1.3.0 — publishing into Taxila

**In one line:** the Instruction Cell can now put an approved handout's PDF straight into its Taxila
course — one at a time or many at once — using the same method IT's question-paper system uses.

## For the Instruction Cell

- **Check in Taxila, then Publish.** On an approved handout, HMP fills in the Taxila semester code
  (Sem-I 2026-27 → S1-26), finds the course and its **General › Course Handout** folder, and shows
  the file name — without uploading anything. Publish then makes the PDF, puts it in the folder,
  marks the handout Published and tells the faculty.
- **Clear answers when something is missing:** course not found, several courses match (you pick),
  folder missing, already in Taxila (with "Publish as new version").
- **Bulk publish.** Tick approved handouts in the Handout Library and publish them in one run, with
  "Check all" first, a live list, pause and resume, and an Excel report.
- **Create request now works for Dibba courses** once Admin has linked the Dibba programme codes
  (below).

## For Admin

- **Admin → Dibba codes:** link each Course Dibba programme code (18ET, HT15, MB22 …) to an HMP
  programme, one by one or by CSV.

## For everyone

- **Email never slows a page down.** Notifications are emailed after the page has answered, and a
  slow mail server gives up after 10 seconds.
- **Publish log:** "Export prepared" and "Published (confirmed)" no longer show as a red "Failed";
  Taxila entries show the file and a link to the course.
- The notification bell's live connection now closes cleanly (the "Controller is already closed"
  lines are gone from the server log).

## Before it goes live

Publishing into Taxila stays **off** until IT has given HMP its own token, confirmed the folder name
and the semester code format, and named a test course (`docs/plans/taxila-publish.md` §C). Until
then the ZIP + "Mark as manually published" flow works exactly as before.

## For the deployer

One additive database change (three new tables, one new value; nothing existing altered). New
optional settings: `TAXILA_URL`, `TAXILA_TOKEN`, `TAXILA_HANDOUT_FOLDER`, `SMTP_TIMEOUT_MS` — see
`docs/deploy-new-server.md`. Leave the Taxila ones unset until IT's answers are in.
