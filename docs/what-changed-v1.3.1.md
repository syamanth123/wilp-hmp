# What changed in HMP v1.3.1 — one fixed file in Taxila

**In one line:** HMP now publishes every handout into its course's **Course Handout** File item as
**`Course Handout.pdf`**, so students always open the latest handout. Release this instead of
v1.3.0.

## Why

Tested on the real Taxila (CIL_Exp, 6 Nov 2026): when a File item holds several files, Taxila opens
the oldest one, and a file HMP replaces or adds is never made the item's main file. The only sure
way is an item holding exactly one file, which every publish replaces.

## For the Instruction Cell

- **Check in Taxila** now looks for the **Course Handout File item** in the course's General
  section (not a folder) and shows what it holds.
- **Publish** always uploads **`Course Handout.pdf`**, replacing the one there, then reads the item
  back: only when it holds exactly the new file is the handout marked Published.
- **Every course needs its Course Handout item once.** In Taxila: General → add a **File** named
  "Course Handout", with any PDF renamed to `Course Handout.pdf` as the placeholder. Check in
  Taxila tells you which courses are missing it.
- **Any other file in the item blocks publishing**, with a message naming the file to remove —
  otherwise students would still see the old file.
- **"Publish as new version" is gone** (there is only ever one file).
- In a bulk run, "Already in Taxila" is gone; "No Course Handout item" and "Other files in Course
  Handout" are listed as needing attention.
- **Backlog and Tentative courses are never picked.** Taxila keeps shells like "Additive
  Manufacturing Process (S1-26_DMZG631)Backlog" beside the regular course; HMP now ignores them,
  so the regular course is found instead of "several courses match".

## For the deployer

No database change. `TAXILA_HANDOUT_FOLDER` is no longer read (it can stay in the settings file).
Release steps as for v1.3.0, with the tag **v1.3.1** and the snapshot **`hmp-before-v1-3-1`**.
