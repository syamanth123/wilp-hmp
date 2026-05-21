// S3-compatible object storage (MinIO in dev, real S3 in prod).
//
// First use of the AWS SDK in the codebase. Introduced for Taxila Mode B
// (LMS export ZIPs); Prompt 11 (file attachments) will reuse this client.
//
// Env contract (canonical names — aligned across .env.example,
// docker-compose.yml, and ci.yml in this PR):
//   S3_ENDPOINT        e.g. http://localhost:9000  (MinIO) — omit for real AWS
//   S3_REGION          defaults to us-east-1
//   S3_ACCESS_KEY      access key id
//   S3_SECRET_KEY      secret access key
//
// `forcePathStyle: true` is required for MinIO (it doesn't do virtual-hosted
// bucket subdomains). It's harmless against real S3.

import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let cachedClient: S3Client | null = null;

/**
 * Returns a process-wide S3 client configured from env. Memoized so we don't
 * rebuild the client (and its connection pool) on every call. Pass
 * `fresh: true` in tests that need a clean client per case.
 */
export function getS3Client(fresh = false): S3Client {
  if (cachedClient && !fresh) return cachedClient;
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    // endpoint is only set for MinIO / S3-compatible stores; real AWS uses the
    // region default when S3_ENDPOINT is unset.
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
  });
  if (!fresh) cachedClient = client;
  return client;
}

/**
 * Ensures a bucket exists, creating it if absent. Idempotent. HeadBucket is a
 * cheap existence probe; any error (404 / NoSuchBucket / 403-as-missing on some
 * MinIO versions) falls through to CreateBucket, which itself tolerates an
 * already-owned bucket.
 */
export async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch {
    // not present (or not reachable as present) — try to create
  }
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (err) {
    // Tolerate the races/idempotency cases where the bucket now exists.
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') return;
    throw err;
  }
}

export interface UploadAndPresignInput {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
  /** Presigned GET URL validity, in seconds. */
  expiresIn: number;
}

/**
 * Ensures the bucket, uploads the object, and returns a presigned GET URL.
 * Used by Taxila Mode B to hand the IC a time-boxed download link for the
 * export ZIP.
 */
export async function uploadAndPresign(
  client: S3Client,
  input: UploadAndPresignInput,
): Promise<string> {
  await ensureBucket(client, input.bucket);
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
  return getSignedUrl(client, new GetObjectCommand({ Bucket: input.bucket, Key: input.key }), {
    expiresIn: input.expiresIn,
  });
}
