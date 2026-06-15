/**
 * Deployment-time setup (Prompt 16 + 21): configure the attachments bucket —
 * (1) bucket VERSIONING (Prompt 21, accidental-delete recovery for user data),
 * (2) the LIFECYCLE policy that moves archived attachments to cold storage.
 *
 *   pnpm --filter @hmp/integrations exec tsx scripts/setup-s3-lifecycle.ts
 *
 * Reads the same S3_* env contract as the app (see src/storage.ts) plus
 * HANDOUT_ATTACHMENTS_BUCKET (defaults to 'hmp-handout-attachments'). The
 * lifecycle rule targets objects tagged `archived=true` — which the app sets,
 * best-effort, when a handout request is ARCHIVED (lib/attachments.ts →
 * tagAttachmentsArchived; reconciled by the Prompt 21 sweep) — and transitions
 * them to Glacier Deep Archive after 30 days. There is NO expiry: attachments
 * are retained indefinitely, just cheaply.
 *
 * Idempotent — PutBucketVersioning (Enabled) and PutBucketLifecycleConfiguration
 * (REPLACES the whole config) both converge on the same state each run. Run once
 * per environment at deploy time, NOT from app code.
 *
 * NOTE: AWS-S3 operations. MinIO (dev) supports versioning and accepts lifecycle
 * config but does not implement DEEP_ARCHIVE transitions; that's expected — the
 * lifecycle policy is meaningful only against real S3. Versioning works on both.
 * Noncurrent-version expiry is intentionally NOT set here — that's a retention
 * tuning knob documented in the deployment runbook, not a default.
 */

import {
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketVersioningCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { getS3Client, ensureBucket } from '../src/storage';

const BUCKET = process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';
const RULE_ID = 'archive-attachments-to-deep-archive';
const TRANSITION_DAYS = 30;

async function main() {
  const client = getS3Client();
  console.log(`[s3-setup] bucket: ${BUCKET}`);

  // Make sure the bucket exists before we configure it (no-op if it does).
  await ensureBucket(client, BUCKET);

  // (1) Enable versioning — lets an accidentally deleted/overwritten attachment
  // be restored from a prior version (see docs/disaster-recovery.md).
  await client.send(
    new PutBucketVersioningCommand({
      Bucket: BUCKET,
      VersioningConfiguration: { Status: 'Enabled' },
    }),
  );
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: BUCKET }));
  console.log(`[s3-setup] versioning: ${versioning.Status ?? 'Unset'}`);

  // (2) Lifecycle policy.
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: BUCKET,
      LifecycleConfiguration: {
        Rules: [
          {
            ID: RULE_ID,
            Status: 'Enabled',
            // Scope the rule to objects the app tags when a request is archived.
            Filter: { Tag: { Key: 'archived', Value: 'true' } },
            Transitions: [{ Days: TRANSITION_DAYS, StorageClass: 'DEEP_ARCHIVE' }],
            // Deliberately no Expiration — archived handouts are kept forever.
          },
        ],
      },
    }),
  );
  console.log(
    `[lifecycle] installed rule "${RULE_ID}": archived=true → DEEP_ARCHIVE after ${TRANSITION_DAYS} days (no expiry).`,
  );

  // Read it back so the operator sees exactly what's now in effect.
  const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
  console.log('[lifecycle] current configuration:');
  console.log(JSON.stringify(current.Rules ?? [], null, 2));
}

main().catch((err) => {
  console.error('[lifecycle] FAILED:', err);
  process.exit(1);
});
