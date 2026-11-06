# What changed in HMP v1.4.1 — assignment and scoping by department

**In one line:** every request now has its own Head of Group and Programme Committee member, chosen by
department. Only they are told about it, and HOGs and PCs see their own department's handouts.

**Tell the HOGs and PCs before the release:** "from now on you'll see your department's handouts", so a
shorter list isn't a surprise.

## For the Instruction Cell

- **New request:** the course's department HOG is pre-selected, with their load. Another HOG needs a
  reason. If the department has no HOG yet, the page says so and links to People.
- **Change the HOG** of a request, with a reason. Both the old and the new HOG are told.
- **Bulk upload of requests:** each goes to its department's HOG. Rows without a department HOG are errors.
- **Departments → Existing requests without a HOG:** a preview (who gets whom, and what can't be assigned
  and why), then **Give N requests their HOG**. Press it right after the release, once the departments are
  filled in.
- **Choose a different Taxila course** (also for Admin): search Taxila by name (e.g. `CIL_Exp`), pick
  it, remembered for that course and semester. Check in Taxila and bulk runs use it. When several courses
  match, your pick is remembered too.
- **"Departments — what's missing"** also lists HOG / PC people with no department and open requests in a
  programme with no department.
- **Handout Library:** a **Department** filter.

## For Heads of Group

- You see **your department's** requests (plus any where you are the HOG, and requests whose programme
  has no department yet). Another department's request answers "not found".
- **Allocate:** your department's PC, faculty and SME first, with their load; **Show all departments** for
  the rest. You choose the **PC** who confirms. **Change the PC** later, with a reason.
- **Bulk allocate:** an optional `pc_email` column (blank = your department's only PC).
- You are told only about requests where you are the HOG. The **Schedule** shows your department by
  default.
- No department set yet? You see all departments, with a notice.

## For the Programme Committee

- You see **your department's** requests (plus any where you are the PC).
- Only the PC the HOG named confirms an allocation and is told about it.

## Not in this release

Away / back-up, the department dashboard, escalation, "My work", the semester kick-off wizard and the small
automations F1–F5 come in **v1.4.2**; detailed emails in **v1.4.3**.

## For the deployer

One additive database change: a new table `TaxilaCourseChoice`. Nothing existing changes; rolling back to
v1.4.0 is safe. Release as usual with tag **v1.4.1** and snapshot **`hmp-before-v1-4-1`**.
