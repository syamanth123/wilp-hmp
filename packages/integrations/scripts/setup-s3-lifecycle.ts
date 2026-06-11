/**
 * Deployment-time setup (Prompt 16): install the bucket lifecycle policy that
 * moves archived handout attachments to cold storage.
 *
 *   pnpm --filter @hmp/integrations exec tsx scripts/setup-s3-lifecycle.ts
 *
 * Reads the same S3_* env contract as the app (see src/storage.ts) plus
 * HANDOUT_ATTACHMENTS_BUCKET (defaults to 'hmp-handout-attachments'). The rule
 * targets objects tagged `archived=true` — which the app sets, best-effort,
 * when a handout request is ARCHIVED (lib/attachments.ts → tagAttachmentsArchived)
 * — and transitions them to Glacier Deep Archive after 30 days. There is NO
 * expiry: attachments are retained indefinitely, just cheaply.
 *
 * Idempotent — PutBucketLifecycleConfiguration REPLACES the whole config, so
 * re-running installs exactly this one rule each time. Run once per environment
 * at deploy time, NOT from app code.
 *
 * NOTE: this is an AWS-S3 operation. MinIO (dev) accepts lifecycle config but
 * does not implement DEEP_ARCHIVE transitions; that's expected — the policy is
 * meaningful only against real S3, so don't run this against the dev MinIO.
 */

import {
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import { getS3Client, ensureBucket } from '../src/storage';

const BUCKET = process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';
const RULE_ID = 'archive-attachments-to-deep-archive';
const TRANSITION_DAYS = 30;

async function main() {
  const client = getS3Client();
  console.log(`[lifecycle] bucket: ${BUCKET}`);

  // Make sure the bucket exists before we configure it (no-op if it does).
  await ensureBucket(client, BUCKET);

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
