import { prisma } from '@hmp/db';
import { getPresignedDownloadUrl, getS3Client, tagObject } from '@hmp/integrations';

// Server-only attachment loader (Prompt 16). NOT a server action — it returns
// presigned download URLs, so it's called only from server components (each
// role's detail page already gates handout access via requireRole + the
// relevant assignment check). Exposing it as a client-callable action would
// need its own per-request access gate; loading server-side avoids that.

export const ATTACHMENTS_BUCKET =
  process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';

export interface AttachmentView {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  uploaderId: string;
  uploaderName: string;
  downloadUrl: string;
}

/** Request-scoped attachments with fresh presigned download URLs (minted in parallel). */
export async function loadAttachments(requestId: string): Promise<AttachmentView[]> {
  const rows = await prisma.attachment.findMany({
    where: { requestId },
    include: { uploader: { select: { name: true } } },
    orderBy: { uploadedAt: 'asc' },
  });
  return Promise.all(
    rows.map(async (a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      uploadedAt: a.uploadedAt,
      uploaderId: a.uploaderId,
      uploaderName: a.uploader.name,
      downloadUrl: await getPresignedDownloadUrl(a.s3Key, { bucket: ATTACHMENTS_BUCKET }),
    })),
  );
}

/**
 * Best-effort: tag a request's attachment objects with `archived=true` so the
 * bucket lifecycle policy can transition them to cold storage (see
 * scripts/setup-s3-lifecycle.ts). Called POST-commit after a request is
 * ARCHIVED — NEVER inside the workflow transaction. Workflow transitions must
 * not block on (or be rolled back by) S3 availability, so every failure here is
 * swallowed with a console.warn: an untagged object simply isn't moved to cold
 * storage, which is harmless. The outer try/catch guards the listing query; the
 * per-object try/catch ensures one unreachable object doesn't skip the rest.
 */
export async function tagAttachmentsArchived(requestId: string): Promise<void> {
  try {
    const rows = await prisma.attachment.findMany({
      where: { requestId },
      select: { s3Key: true },
    });
    if (rows.length === 0) return;
    const client = getS3Client();
    for (const { s3Key } of rows) {
      try {
        await tagObject(client, ATTACHMENTS_BUCKET, s3Key, { archived: 'true' });
      } catch (err) {
        console.warn('[attachments] archive tag failed', { requestId, s3Key, err });
      }
    }
  } catch (err) {
    console.warn('[attachments] archive tagging skipped', { requestId, err });
  }
}
