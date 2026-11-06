# What changed in HMP v1.4.0 — departments and people

**In one line:** HMP now knows which department everyone and every programme belongs to, and the
Admin and the Instruction Cell manage people in one place, one at a time or from an Excel file. Nobody's workflow changes
yet: requests still go to every HOG and PC as before. That changes in v1.4.1, after the departments
are filled in.

## For Admin

- **Four departments:** MBA / Management, Core Engineering, CSIS, EEE (**Admin → Departments**;
  names can be changed later).
- **Admin → People** replaces the Users tab. It shows everyone with their roles, department, open
  handouts ("3 open handouts · 1 overdue") and status, and can be searched and filtered. One person =
  one email = one department; they can have several roles. Instruction Cell and Admin cover all
  departments.
- **Add / edit a person safely.** Before you remove a role, change a department or switch someone
  off, HMP lists any open handouts that would be left without an owner. You pick who takes each one
  over (or one person for all), and the change and the hand-over are saved together.
- **Changes take effect on the person's next page**, without signing out. Someone switched off is
  signed out and told why.
- **Upload people (CSV or Excel).** Four columns: `email, name, roles, department`. You see every row
  (New / Changed / Unchanged / Error) before anything is saved. Nobody is ever deleted.
- **Suggested departments.** For people with no department yet, HMP looks at the courses they
  taught:
  - **One department** → "Suggested: CSIS (from 5 past courses)". Accept them one by one, or all at
    once with **Accept all suggestions**. Nothing is saved unless you accept it.
  - **Taught in more than one department** → "Needs a decision: 3 CSIS, 2 EEE". HMP doesn't guess;
    type the department yourself.
- **Download the list (Excel):** everyone in the upload format, with a _suggested department_ and a
  _why_ column. Edit it and upload it back.
- **Admin → Departments:**
  - each department's HOG, people and programmes;
  - the department of every HMP programme;
  - the department of every Course Dibba programme (HT15, MB22 …). These feed the suggestions. Each
    has a one-click suggestion from its title (e.g. "MBA (Finance)" → MBA), or **Accept all**.
- **Admin overview → "Departments — what's missing":** people without a department, Dibba
  programmes without a department, programmes without one, and departments without a HOG.

## For the Instruction Cell

- **IC → People, IC → Departments** (new tabs; also **Upload people** and the Excel download): the
  same pages as the Admin's. The IC knows which department each faculty member belongs to, so the IC
  confirms the suggested departments and settles the "Needs a decision" rows.
- **Limits:** the IC can't give or remove the **Admin** role and can't change an **Admin account**
  (it opens read-only). In an upload, a row that would change an Admin account or give the Admin
  role is marked Error; an Admin account's row left as it is passes, so the downloaded list uploads
  back unchanged. Departments are never deleted, by anyone: rename or make inactive.
- **IC overview → "Departments — what's missing"**, with links into IC → People and Departments.
- Everything the IC changes is in the audit log under their name.

## Fill in before v1.4.1

These are for the Admin or the Instruction Cell (IC → People / Departments).

1. **Departments:** accept or correct the Course Dibba programmes' departments (about 15
   minutes), and set the department of each HMP programme.
2. **People:** make sure each department has its Head of Group.
3. **Download the list → Upload people → Accept all suggestions**, then settle the "Needs a decision"
   rows.

## For the deployer

Two additive database changes:

- new tables: `Department`, `RequestAssignee` (empty until v1.4.1), `DibbaProgrammeDepartment`;
- new nullable columns: `User.departmentId`, `User.accessVersion` (default 0), `Programme.departmentId`;
- the four departments are added by the migration itself.

Nothing existing is altered. No new settings.
