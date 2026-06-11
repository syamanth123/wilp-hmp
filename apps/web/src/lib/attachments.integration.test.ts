import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName } from '@hmp/db';
import {
  getS3Client,
  uploadAndPresign,
  deleteObject,
  getPresignedDownloadUrl,
  getObjectTags,
} from '@hmp/integrations';
import { loadAttachments, tagAttachmentsArchived, ATTACHMENTS_BUCKET } from './attachments';

/**
 * Integration test for the Prompt 16 attachment loader + archive tagging. Does a
 * real S3 round-trip against MinIO and writes Attachment rows to Postgres, so it
 * probe-skips unless BOTH are reachable + seeded — same convention as
 * sme-review.test.ts (DB) and m6c-taxila-mode-b.spec.ts (MinIO).
 *
 * Covers: upload → loadAttachments returns a presigned URL whose bytes
 * round-trip → tagAttachmentsArchived sets archived=true on the object →
 * tagAttachmentsArchived is best-effort (a bogus requestId never throws).
 */

const prisma = new PrismaClient();
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';

async function minioReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${S3_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let ready = false;
let offeringId: string | null = null;
let facultyUserId: string | null = null;
const createdRequestIds: string[] = [];
const createdS3Keys: string[] = [];

const PREFIX = `ATT-TEST-${process.pid}-${Date.now()}`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const offering = await prisma.courseOffering.findFirst({ select: { id: true } });
    const faculty = await prisma.user.findFirst({
      where: { roles: { some: { role: { name: RoleName.FACULTY } } } },
      select: { id: true },
    });
    offeringId = offering?.id ?? null;
    facultyUserId = faculty?.id ?? null;
    ready = Boolean(offeringId && facultyUserId && (await minioReachable()));
  } catch {
    ready = false;
  }
  if (!ready) {
    console.warn('[attachments.integration] Postgres or MinIO unreachable/unseeded — skipping.');
  }
});

afterAll(async () => {
  if (ready) {
    const client = getS3Client();
    for (const key of createdS3Keys) {
      try {
        await deleteObject(client, ATTACHMENTS_BUCKET, key);
      } catch {
        /* best-effort cleanup */
      }
    }
    if (createdRequestIds.length) {
      await prisma.attachment.deleteMany({ where: { requestId: { in: createdRequestIds } } });
      await prisma.handoutRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
  }
  await prisma.$disconnect();
});

async function seedRequestWithAttachment(
  body: string,
): Promise<{ requestId: string; s3Key: string }> {
  const n = createdRequestIds.length + 1;
  const request = await prisma.handoutRequest.create({
    data: {
      refNo: `${PREFIX}-${n}`,
      courseOfferingId: offeringId!,
      initiatedById: facultyUserId!,
      status: HandoutStatus.IN_PROGRESS,
    },
    select: { id: true },
  });
  createdRequestIds.push(request.id);

  const s3Key = `attachments/${request.id}/${PREFIX}-${n}.txt`;
  await uploadAndPresign(getS3Client(), {
    bucket: ATTACHMENTS_BUCKET,
    key: s3Key,
    body,
    contentType: 'text/plain',
    expiresIn: 60,
  });
  createdS3Keys.push(s3Key);

  await prisma.attachment.create({
    data: {
      requestId: request.id,
      uploaderId: facultyUserId!,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      size: Buffer.byteLength(body),
      s3Key,
    },
  });
  return { requestId: request.id, s3Key };
}

describe('attachments integration (MinIO + Postgres)', () => {
  it('loadAttachments returns a presigned URL whose bytes round-trip', async () => {
    if (!ready) return;
    const body = 'supplementary-handout-material';
    const { requestId } = await seedRequestWithAttachment(body);

    const views = await loadAttachments(requestId);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ filename: 'notes.txt', mimeType: 'text/plain' });

    const res = await fetch(views[0]!.downloadUrl);
    expect(res.ok).toBe(true);
    expect(await res.text()).toBe(body);
  });

  it('tagAttachmentsArchived sets archived=true on the object', async () => {
    if (!ready) return;
    const { requestId, s3Key } = await seedRequestWithAttachment('to-be-archived');

    await tagAttachmentsArchived(requestId);

    const tags = await getObjectTags(getS3Client(), ATTACHMENTS_BUCKET, s3Key);
    expect(tags.archived).toBe('true');
  });

  it('tagAttachmentsArchived is best-effort — never throws for an unknown request', async () => {
    if (!ready) return;
    await expect(tagAttachmentsArchived('nonexistent-request-id')).resolves.toBeUndefined();
  });

  it('presigned download fails after the object is deleted (delete really removes it)', async () => {
    if (!ready) return;
    const { s3Key } = await seedRequestWithAttachment('ephemeral');
    await deleteObject(getS3Client(), ATTACHMENTS_BUCKET, s3Key);
    const url = await getPresignedDownloadUrl(s3Key, { bucket: ATTACHMENTS_BUCKET, expiresIn: 60 });
    const res = await fetch(url);
    expect(res.ok).toBe(false);
  });
});
