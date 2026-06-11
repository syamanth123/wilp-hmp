/**
 * Deployment smoke test (Prompt 16): a bounded, end-to-end check that the
 * handout-attachments bucket is wired up correctly. Run AFTER setup-s3-lifecycle.ts.
 *
 *   pnpm --filter @hmp/integrations exec tsx scripts/smoke-test-s3.ts
 *
 * Reads the S3_* env contract (see src/storage.ts) + HANDOUT_ATTACHMENTS_BUCKET.
 * It performs a fixed sequence (no loops, no polling) and cleans up after
 * itself:
 *   1. bucket reachable / creatable (ensureBucket)
 *   2. upload a tiny probe object (uploadAndPresign)
 *   3. mint a presigned GET URL and fetch it — verify the bytes round-trip
 *   4. lifecycle policy present (GetBucketLifecycleConfiguration) — WARN if not
 *   5. delete the probe object
 * Exits 0 on success, non-zero on the first hard failure. Step 4 is advisory
 * (a missing policy warns but doesn't fail) so the smoke test is usable against
 * dev MinIO, which doesn't implement DEEP_ARCHIVE.
 */

import { GetBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3';
import {
  getS3Client,
  ensureBucket,
  uploadAndPresign,
  getPresignedDownloadUrl,
  deleteObject,
} from '../src/storage';

const BUCKET = process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';
const PROBE_KEY = 'attachments/_smoke/probe.txt';
const PROBE_BODY = 'hmp-attachments-smoke-test';

async function main() {
  const client = getS3Client();
  console.log(`[smoke] bucket: ${BUCKET}`);

  // 1. reachable / creatable
  await ensureBucket(client, BUCKET);
  console.log('[smoke] 1/5 bucket reachable ✓');

  // 2. upload
  await uploadAndPresign(client, {
    bucket: BUCKET,
    key: PROBE_KEY,
    body: PROBE_BODY,
    contentType: 'text/plain',
    expiresIn: 60,
  });
  console.log('[smoke] 2/5 upload ✓');

  // 3. presigned download + verify bytes
  const url = await getPresignedDownloadUrl(PROBE_KEY, { bucket: BUCKET, expiresIn: 60, client });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`presigned GET returned ${res.status}`);
  const text = await res.text();
  if (text !== PROBE_BODY) {
    throw new Error(`presigned GET body mismatch: got ${JSON.stringify(text)}`);
  }
  console.log('[smoke] 3/5 presigned download round-trips ✓');

  // 4. lifecycle present (advisory)
  try {
    const lc = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
    const rules = lc.Rules ?? [];
    if (rules.length === 0) {
      console.warn('[smoke] 4/5 lifecycle present ⚠ no rules — run setup-s3-lifecycle.ts');
    } else {
      console.log(`[smoke] 4/5 lifecycle present ✓ (${rules.length} rule(s))`);
    }
  } catch (err) {
    console.warn(
      '[smoke] 4/5 lifecycle present ⚠ could not read (expected on MinIO, or not yet configured):',
      (err as { name?: string })?.name ?? err,
    );
  }

  // 5. cleanup
  await deleteObject(client, BUCKET, PROBE_KEY);
  console.log('[smoke] 5/5 cleanup ✓');

  console.log('[smoke] PASS');
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err);
  process.exit(1);
});
