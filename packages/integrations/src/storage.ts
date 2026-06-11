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
  DeleteObjectCommand,
  PutObjectTaggingCommand,
  GetObjectTaggingCommand,
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

/**
 * Deletes an object. Used by the attachment delete flow (Prompt 16). Idempotent
 * on the S3 side — deleting a missing key succeeds.
 */
export async function deleteObject(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Replaces an object's tag set. Used to tag a handout's attachments
 * `archived=true` when the handout is archived, so the bucket lifecycle rule
 * transitions them to Glacier Deep Archive (Prompt 16). PutObjectTagging
 * REPLACES the tag set (not a merge), which is fine — we only set this one tag.
 */
export async function tagObject(
  client: S3Client,
  bucket: string,
  key: string,
  tags: Record<string, string>,
): Promise<void> {
  await client.send(
    new PutObjectTaggingCommand({
      Bucket: bucket,
      Key: key,
      Tagging: { TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) },
    }),
  );
}

/**
 * Reads an object's tag set as a plain `{ key: value }` map. Inverse of
 * `tagObject` — used to verify archive tagging took effect (Prompt 16 tests /
 * ops checks). Returns `{}` for an object with no tags.
 */
export async function getObjectTags(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Record<string, string>> {
  const res = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: key }));
  return Object.fromEntries((res.TagSet ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
}

const DEFAULT_DOWNLOAD_TTL_SECONDS = 24 * 60 * 60; // 24h

/**
 * Mints a fresh presigned GET URL for an existing object key. Used by the IC
 * publish panel to (re)generate the export download link on each render — the
 * presigned URL is ephemeral (TTL-bound) and is regenerated from the durable
 * s3Key rather than persisted, so a link is never stale and survives an
 * endpoint move. Reads the default client + bucket from env.
 */
export async function getPresignedDownloadUrl(
  key: string,
  options?: { bucket?: string; expiresIn?: number; client?: S3Client },
): Promise<string> {
  const client = options?.client ?? getS3Client();
  const bucket = options?.bucket ?? process.env.LMS_EXPORTS_BUCKET ?? 'hmp-lms-exports';
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: options?.expiresIn ?? DEFAULT_DOWNLOAD_TTL_SECONDS,
  });
}
