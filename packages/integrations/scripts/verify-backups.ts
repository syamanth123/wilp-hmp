/**
 * Backup verification (Prompt 21). Run by an operator to confirm the recovery
 * posture is actually in place — backups present, versioning on, lifecycle set.
 *
 *   pnpm --filter @hmp/integrations exec tsx scripts/verify-backups.ts
 *
 * S3 checks run in code (we already have @aws-sdk/client-s3). RDS automated
 * backups are AWS-managed and verified via the AWS CLI — this script prints the
 * exact command rather than pulling in @aws-sdk/client-rds for one deploy-time
 * check. See docs/disaster-recovery.md for the full procedure + restore drill.
 *
 * Dry-runnable against dev MinIO (versioning + lifecycle checks work there;
 * lifecycle's DEEP_ARCHIVE transition is AWS-only but its presence is checked).
 * Exits non-zero if any S3 check FAILS (a WARN does not fail the run).
 */

import {
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import { getS3Client } from '../src/storage';

const BUCKET = process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';

async function main() {
  const client = getS3Client();
  let failed = false;
  console.log(`[verify-backups] attachments bucket: ${BUCKET}\n`);

  // 1. S3 versioning must be Enabled (accidental-delete recovery).
  try {
    const v = await client.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
    if (v.Status === 'Enabled') {
      console.log('[verify-backups] ✓ S3 versioning: Enabled');
    } else {
      console.error(
        `[verify-backups] ✗ S3 versioning: ${v.Status ?? 'Unset'} — run setup-s3-lifecycle.ts`,
      );
      failed = true;
    }
  } catch (err) {
    console.error(
      '[verify-backups] ✗ S3 versioning check failed:',
      (err as { name?: string })?.name ?? err,
    );
    failed = true;
  }

  // 2. Lifecycle policy must include the archive rule.
  try {
    const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
    const hasArchiveRule = (lc.Rules ?? []).some(
      (r) =>
        r.Status === 'Enabled' &&
        (r.Transitions ?? []).some((t) => t.StorageClass === 'DEEP_ARCHIVE'),
    );
    if (hasArchiveRule) {
      console.log('[verify-backups] ✓ S3 lifecycle: archive→DEEP_ARCHIVE rule present');
    } else {
      console.warn(
        '[verify-backups] ⚠ S3 lifecycle: no DEEP_ARCHIVE rule (expected on MinIO; run setup-s3-lifecycle.ts on AWS)',
      );
    }
  } catch {
    console.warn('[verify-backups] ⚠ S3 lifecycle: none configured (run setup-s3-lifecycle.ts)');
  }

  // 3. RDS automated backups — AWS-managed; verified via CLI (not SDK here).
  console.log('\n[verify-backups] RDS backups — run this AWS CLI command manually:');
  console.log(
    '  aws rds describe-db-instances \\\n' +
      "    --query 'DBInstances[*].[DBInstanceIdentifier,LatestRestorableTime,BackupRetentionPeriod]' \\\n" +
      '    --output table',
  );
  console.log('  Expect: BackupRetentionPeriod >= 7 and a recent LatestRestorableTime.');
  console.log('  Full restore drill + verification SQL: docs/disaster-recovery.md\n');

  if (failed) {
    console.error('[verify-backups] FAIL — one or more S3 checks failed.');
    process.exit(1);
  }
  console.log('[verify-backups] S3 checks passed.');
}

main().catch((err) => {
  console.error('[verify-backups] FAILED:', err);
  process.exit(1);
});
