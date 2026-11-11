# What changed in HMP v1.4.3 — detailed, complete emails

**In one line:** every email HMP sends now explains the situation and what to do, so people can act without
opening HMP first. The Admin can change the wording, preview any email with a real request, send a test and
see every email in a log.

**After the release:** in **Admin → Notifications → Settings**, enter the **reply-to address** (the
Instruction Cell mailbox) and the **help contact**. Until then, emails say "Please do not reply", which is
safe.

## For everyone

Every email has the same parts:

- a subject with the course and semester ("Action needed: review SS ZG653 Software Testing (Sem-I 2026-27)
  — due 16 Nov 2026");
- a one-line summary;
- **what you need to do and by when** (days left or overdue), or "No action needed — for your information";
- a big button to the exact page;
- **what happened**:
  - the reviewer's full comments when work is sent back;
  - which sections changed since the last reviewed version;
  - the Taxila course link and the PDF once published;
- the handout's details: course, semester, programme, department, reference, status, version, Course Dibba
  slot and exam date;
- the people on the request, with the Instructor-in-Charge first;
- the last few steps.

The footer says why you got it and links to My settings. Every email also has a plain-text version and reads
well on a phone. No email contains a password or the handout's content.

- **Replies in a comment thread you're in** now come by email too. @mentions already did. Plain new comments
  stay in the bell.
- **A back-up's copy** says "You get this as Dr X's back-up while they are away".
- **The daily digest** shows each item as a compact block: "Action needed" first, soonest due first, then
  "For information".

## For the Instruction Cell and HOGs

- **Bulk actions send one email per person.** Kick-off, bulk upload, bulk allocate and bulk review now send
  each person one email listing all their requests, instead of one email per request. The bell still shows
  one notice per request.
- **The weekly summary** uses the same layout, with each department's numbers and its most overdue requests.

## For the Admin and the IC (people)

- **Welcome email:**
  - sent when someone is added on **Add person** (ticked by default);
  - for a **People upload**, the box starts **unticked**; when ticked it says "Sends a welcome email to N
    people";
  - **Edit person → Send welcome email** sends it later, or again.
  - It says how to sign in: with the BITS ID when BITS sign-in is set up on the server, otherwise that the
    Admin gives the password. It never contains a password.
- **Roles or department changed:** the person gets an email with old → new and what appears or goes in their
  menu, also after an **Undo**. Changes made by an upload don't send one.

## For the Admin

**Admin → Notifications** has three tabs.

- **Emails:**
  - every email, with who gets it;
  - **Edit** changes the subject, summary and "what to do", using the placeholders shown beside the fields.
    An unknown placeholder is refused when you save;
  - **Back to the original wording** restores the built-in text;
  - a **preview with a real request** shows exactly what would be sent;
  - **Send a test to me** sends it to your own address.
- **Email log:** every email of the last 90 days, shown as Sent, Failed (with the reason) or Waiting for the
  digest. You can filter and search it. Failures and test emails are also in the audit log.
- **Settings:** reply-to address and help contact.

The old "Time limits" card is gone; due dates are in Admin → Workflow.

## For the deployer

- **Database:** one additive migration, `20261113100000_detailed_emails`. It adds:
  - four new empty columns on `NotificationTemplate` (an Admin's wording edits);
  - `emailReplyTo` and `emailHelp` on `WorkflowConfig`;
  - one index on `Notification`.

  Rolling back to v1.4.2 with the snapshot is safe.

- **No new server step and no new settings.** Emails are sent from `SMTP_FROM` as before. Links and the logo
  use `APP_BASE_URL`; the logo `/email-logo.png` is 14 KB and public.
- Release with tag **v1.4.3** and snapshot **`hmp-before-v1-4-3`**.
