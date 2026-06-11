'use server';

import { revalidatePath } from 'next/cache';
import { prisma, RoleName, HandoutStatus } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { getS3Client, deleteObject } from '@hmp/integrations';
import { audit } from '@/lib/audit';
import { ATTACHMENTS_BUCKET } from '@/lib/attachments';

// Attachments can be deleted only by their uploader, and only while the handout
// is still editable — once it's APPROVED / PUBLISHED / ARCHIVED the record is
// locked.
const LOCKED_STATUSES: HandoutStatus[] = [
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
];

export async function deleteAttachmentAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const id = String(formData.get('attachmentId') ?? '');
  if (!id) return { error: 'Missing attachment id' };

  const att = await prisma.attachment.findUnique({
    where: { id },
    select: {
      id: true,
      s3Key: true,
      uploaderId: true,
      requestId: true,
      filename: true,
      request: { select: { status: true } },
    },
  });
  if (!att) return { error: 'Attachment not found' };
  if (att.uploaderId !== me.id) return { error: 'Only the uploader can delete this attachment' };
  if (LOCKED_STATUSES.includes(att.request.status)) {
    return { error: `Cannot delete attachments once the handout is ${att.request.status}` };
  }

  // Delete the object first; if S3 is unreachable, keep the DB row and ask the
  // user to retry (avoids orphaning the object + a misleading "deleted"). This
  // is a user-initiated delete, so unlike the best-effort archive tagging, we
  // surface the failure rather than swallowing it.
  try {
    await deleteObject(getS3Client(), ATTACHMENTS_BUCKET, att.s3Key);
  } catch (err) {
    console.error('[attachments] S3 delete failed', { id, s3Key: att.s3Key, err });
    return { error: 'Could not remove the file from storage right now — please retry.' };
  }

  await prisma.attachment.delete({ where: { id } });
  await audit({
    actorId: me.id,
    action: 'attachment.deleted',
    entity: 'Attachment',
    entityId: id,
    after: { s3Key: att.s3Key, filename: att.filename, requestId: att.requestId },
    requestId: att.requestId,
  });

  revalidatePath(`/faculty/assignments/${att.requestId}`);
  return { ok: true };
}
