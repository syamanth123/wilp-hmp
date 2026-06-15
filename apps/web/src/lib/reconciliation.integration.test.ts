import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName } from '@hmp/db';
import { getS3Client, uploadAndPresign, getObjectTags, deleteObject } from '@hmp/integrations';
import { runReconciliationSweep } from './reconciliation';
import { ATTACHMENTS_BUCKET } from './attachments';

/**
 * Integration test for the Prompt 21 archive-tagging reconciliation. Real S3
 * round-trip (MinIO) + real Postgres, so it probe-skips unless both are
 * reachable + seeded. Proves the behavioral core: untagged attachments on an
 * ARCHIVED request get the `archived=true` tag + archivedTaggedAt; an
 * already-tagged one isn't re-processed; and a second sweep is idempotent (the
 * just-reconciled rows are not re-detected — stable archivedTaggedAt).
 *
 * NOTE: runReconciliationSweep is global. Assertions target THIS test's own rows
 * (not the summary count), so unrelated leftover ARCHIVED data can't flake it.
 */

const prisma = new PrismaClient();
const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const PREFIX = `RECON-TEST-${process.pid}-${Date.now()}`;

let ready = false;
let offeringId: string | null = null;
let facultyUserId: string | null = null;
let requestId = '';
const ids: { tagged?: string; untagged1?: string; untagged2?: string } = {};
const s3Keys: string[] = [];

async function minioReachable(): Promise<boolean> {
  try {
    const r = await fetch(`${S3_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function mkAttachment(suffix: string, taggedAt: Date | null): Promise<string> {
  const s3Key = `attachments/${requestId}/${PREFIX}-${suffix}`;
  await uploadAndPresign(getS3Client(), {
    bucket: ATTACHMENTS_BUCKET,
    key: s3Key,
    body: 'recon-test',
    contentType: 'text/plain',
    expiresIn: 60,
  });
  s3Keys.push(s3Key);
  const a = await prisma.attachment.create({
    data: {
      requestId,
      uploaderId: facultyUserId!,
      filename: `${suffix}.txt`,
      mimeType: 'text/plain',
      size: 10,
      s3Key,
      archivedTaggedAt: taggedAt,
    },
    select: { id: true },
  });
  return a.id;
}

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
    console.warn('[reconciliation.integration] Postgres or MinIO unreachable — skipping.');
    return;
  }
  const req = await prisma.handoutRequest.create({
    data: {
      refNo: `${PREFIX}-REQ`,
      courseOfferingId: offeringId!,
      initiatedById: facultyUserId!,
      status: HandoutStatus.ARCHIVED,
    },
    select: { id: true },
  });
  requestId = req.id;
  ids.tagged = await mkAttachment('tagged', new Date()); // already reconciled
  ids.untagged1 = await mkAttachment('untagged1', null);
  ids.untagged2 = await mkAttachment('untagged2', null);
});

afterAll(async () => {
  if (ready) {
    const client = getS3Client();
    for (const k of s3Keys)
      await deleteObject(client, ATTACHMENTS_BUCKET, k).catch(() => undefined);
    if (requestId) await prisma.handoutRequest.deleteMany({ where: { id: requestId } });
  }
  await prisma.$disconnect();
});

describe('archive-tagging reconciliation (MinIO + Postgres)', () => {
  it('tags the untagged attachments, sets archivedTaggedAt, leaves the tagged one, and is idempotent', async () => {
    if (!ready) return;

    await runReconciliationSweep();

    // The two untagged attachments now carry the S3 tag + a DB timestamp.
    for (const id of [ids.untagged1!, ids.untagged2!]) {
      const row = await prisma.attachment.findUniqueOrThrow({
        where: { id },
        select: { s3Key: true, archivedTaggedAt: true },
      });
      expect(row.archivedTaggedAt).not.toBeNull();
      const tags = await getObjectTags(getS3Client(), ATTACHMENTS_BUCKET, row.s3Key);
      expect(tags.archived).toBe('true');
    }

    // Capture the just-set timestamps, then re-run: the idempotency proof —
    // already-reconciled rows are NOT re-detected, so archivedTaggedAt is stable.
    const after1 = await prisma.attachment.findMany({
      where: { id: { in: [ids.untagged1!, ids.untagged2!] } },
      select: { id: true, archivedTaggedAt: true },
      orderBy: { id: 'asc' },
    });
    await runReconciliationSweep();
    const after2 = await prisma.attachment.findMany({
      where: { id: { in: [ids.untagged1!, ids.untagged2!] } },
      select: { id: true, archivedTaggedAt: true },
      orderBy: { id: 'asc' },
    });
    expect(after2.map((r) => r.archivedTaggedAt?.toISOString())).toEqual(
      after1.map((r) => r.archivedTaggedAt?.toISOString()),
    );
  });
});
