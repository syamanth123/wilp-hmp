# Disaster Recovery Runbook

For the on-call engineer. Assumes you have AWS Console + CLI access (region
**ap-south-1**, Mumbai) and the production env secrets. Each failure class below
is self-contained: **Detection → Immediate steps → Restore → Verification →
Escalation**. Run the commands as written; don't improvise under pressure.

> Pair with [deployment-runbook.md](./deployment-runbook.md) (env vars, normal
> deploy, monitoring) and [dev-handoff-audit.md](./dev-handoff-audit.md) (system
> architecture).

## Severity + escalation order

| Sev      | Meaning                                                                   | Page                                                                          |
| -------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **SEV1** | Data loss or total outage (DB gone, region down)                          | Immediately: HMP owner → BITS WILP IT lead → AWS Support (Business tier case) |
| **SEV2** | Degraded but serving (one subsystem down: notifications, AI, attachments) | HMP owner; AWS Support if infra-side                                          |
| **SEV3** | Recoverable nuisance (rate-limit fail-open, single failed job)            | Log + handle in business hours                                                |

**Contacts** (fill in before go-live): HMP owner `<name / phone>`; BITS WILP IT
lead `<name / email>`; AWS account + support plan `<id / tier>`. Keep this table
current — a runbook with `<placeholder>` contacts fails at 2 AM.

---

## Failure class 1 — RDS PostgreSQL data loss / corruption (SEV1)

**Detection:** app 500s on DB reads; `/login` fails; CloudWatch RDS `FreeStorageSpace`/`DatabaseConnections` alarms; or a known bad migration / accidental destructive query.

**Immediate steps:**

1. Stop writes — scale the web service to 0 (or put it in maintenance) so corruption doesn't compound.
2. Identify the recovery target time (just **before** the incident).
3. Do NOT delete the existing instance yet — restore to a **new** instance alongside it.

**Restore** (point-in-time, from AWS automated backups):

```
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier hmp-prod \
  --target-db-instance-identifier hmp-prod-restore \
  --restore-time 2026-06-15T08:30:00Z \
  --region ap-south-1
# Wait for status "available":
aws rds wait db-instance-available --db-instance-identifier hmp-prod-restore --region ap-south-1
```

Then repoint `DATABASE_URL` at `hmp-prod-restore` and redeploy web.

**Verification** (prove the restore is at the right point + data is intact):

```sql
-- 1. The latest data predates the incident (NOT the restore time):
SELECT MAX("createdAt") FROM "HandoutRequest";
-- Should match the expected pre-incident timestamp.

-- 2. Critical tables have plausible row counts:
SELECT
  (SELECT COUNT(*) FROM "User" WHERE active = true) AS active_users,
  (SELECT COUNT(*) FROM "HandoutRequest")           AS total_requests,
  (SELECT COUNT(*) FROM "Attachment")               AS total_attachments;

-- 3. Migrations are all applied (no drift):
--    pnpm --filter @hmp/db exec prisma migrate status   → "Database schema is up to date!"
```

Only after verification: cut over DNS/routing, then snapshot + retire the old instance.

**Escalation:** if no automated backup covers the target time (retention exceeded), this is unrecoverable data loss — escalate SEV1 to the HMP owner + BITS WILP IT immediately; the gap is the retention window (raise `BackupRetentionPeriod`).

---

## Failure class 2 — S3 attachment loss / accidental deletion (SEV1/SEV2)

**Detection:** attachment download links 404; `attachment.uploaded` audit rows exist but objects are gone; an accidental `aws s3 rm` or lifecycle misconfiguration.

**Immediate steps:** confirm bucket **versioning is Enabled** (it should be — `setup-s3-lifecycle.ts`); if a delete happened, the prior versions are recoverable.

**Restore** (single object, from a prior version):

```
aws s3api list-object-versions --bucket hmp-handout-attachments \
  --prefix "attachments/<requestId>/<uuid>" --region ap-south-1
# Copy the desired VersionId back over the current key (removes the delete marker):
aws s3api copy-object --bucket hmp-handout-attachments \
  --copy-source "hmp-handout-attachments/<key>?versionId=<VersionId>" \
  --key "<key>" --region ap-south-1
```

Bucket-level loss: recreate the bucket, then re-run `setup-s3-lifecycle.ts`
(re-enables versioning + lifecycle) and restore objects from cross-region
replication or a snapshot if configured.

**Verification:** the download link resolves (presigned GET returns 200); the DB `Attachment` row's `s3Key` matches the restored object; `verify-backups.ts` shows versioning Enabled.

**Escalation:** SEV1 if many objects/bucket-level; SEV2 if a single object. The DB rows are the source of truth for _what should exist_ — diff `Attachment.s3Key` against the bucket to scope the loss.

---

## Failure class 3 — Authentication outage (SEV1 if total)

**Detection:** all users bounced to `/login`; `/login` itself errors.

**Likely causes + fixes:**

- **`NEXTAUTH_SECRET` / `NEXTAUTH_URL` wrong or missing** → sessions invalid. Restore the correct env values + redeploy. (`trustHost: true` is already set for reverse-proxy/`next start`.)
- **Redis down** → this is NOT an auth outage: rate limiting **fails open** (logins still work; `ratelimit.unavailable` audit rows appear). Fix Redis at SEV2, not SEV1.
- **DB down** → credentials `authorize()` can't read users → see Failure class 1.
- **(Future) SAML IdP unreachable** (Prompt 19, not yet shipped) → document the credentials-fallback toggle when SSO lands.

**Verification:** a known-good user logs in and lands on their role home; session cookie set; protected route loads.

**Escalation:** SEV1 if no one can log in; HMP owner + (if infra) AWS Support.

---

## Failure class 4 — Notification system failure (SEV2/SEV3)

**Detection:** `/admin/queues` shows a stalled queue or the "⚠ Workers may not be running" banner (no heartbeat >5 min); or `Notification.status = FAILED` rows climbing.

**Behavior (already degraded-gracefully — usually no action needed):**

- **Redis/BullMQ down** → the app falls back to **synchronous** notification dispatch (no Redis required); workers are opt-in. No data loss.
- **SMTP down** → `Notification` rows are written with `status = FAILED`; the **in-portal** notification still exists. No data loss; emails are not retried (a stale email is noise — see audit §1 "evaluated-but-not-reconciled").

**Restore:** fix Redis/worker (restart `pnpm workers`) or SMTP credentials. Re-enable `WORKERS_ENABLED` only with a running worker (else jobs queue but never process).

**Verification:** `/admin/queues` heartbeat green; a test transition delivers an in-portal notification.

---

## Failure class 5 — Total region (ap-south-1) failure (SEV1)

**Detection:** AWS Health Dashboard region-wide event; all endpoints unreachable.

**Posture (state explicitly before go-live):**

- **RTO** `<target, e.g. 4h>`, **RPO** `<target, e.g. 1h — bounded by RDS backup frequency + S3 replication lag>`.
- If cross-region RDS read-replica / S3 CRR is configured: promote the replica, repoint `DATABASE_URL`, switch the attachments bucket, cut DNS to a standby in another region.
- If not configured (single-region): recovery waits on AWS region restoration; the RTO is AWS's, not ours — **this is the gap to close** if the business requires multi-region.

**Escalation:** SEV1, AWS Support case, BITS WILP IT — communicate the RTO honestly.

---

## Backup verification cadence

- **Weekly (automated/operator):** `pnpm --filter @hmp/integrations exec tsx scripts/verify-backups.ts` (S3 versioning + lifecycle present) **and** the RDS CLI it prints (`describe-db-instances` → `BackupRetentionPeriod >= 7`, recent `LatestRestorableTime`).
- **Quarterly (restore drill — the real test):** restore the latest backup to a throwaway instance, run the Failure-class-1 verification SQL, confirm row counts + `migrate status`, then delete the instance. A backup you've never restored is a hope, not a backup. Log each drill below.

### Dry-run / drill log

| Date                                | Drill | Result | Run by | Notes |
| ----------------------------------- | ----- | ------ | ------ | ----- |
| _(fill in at each quarterly drill)_ |       |        |        |       |
