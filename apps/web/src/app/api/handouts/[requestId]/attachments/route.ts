import { prisma, RoleName, HandoutStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { getS3Client, uploadAndPresign } from '@hmp/integrations';
import { audit } from '@/lib/audit';
import { validateAttachment } from '@/lib/attachment-validation';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ATTACHMENTS_BUCKET = process.env.HANDOUT_ATTACHMENTS_BUCKET ?? 'hmp-handout-attachments';
const UPLOADABLE_STATUSES: HandoutStatus[] = [
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
];

/**
 * Attachment upload (Prompt 16). A Route Handler — NOT a server action —
 * because uploads can be up to 50 MB and server actions are globally capped at
 * `serverActions.bodySizeLimit` (5 MB); raising that would widen the body cap
 * for every action. Only the assigned faculty may upload, and only while the
 * handout is editable (IN_PROGRESS / REWORK_REQUESTED).
 */
export async function POST(req: Request, { params }: { params: { requestId: string } }) {
  // CSRF defense-in-depth (Prompt 20): reject a cross-origin POST. The session
  // cookie is SameSite=Lax (NextAuth default) so a cross-site POST wouldn't
  // carry it anyway; this is a belt-and-suspenders Origin/Host check. No token
  // machinery needed for a single authenticated Route Handler.
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ error: 'bad_origin' }, { status: 403 });
  }

  const me = await getSessionUser();
  if (!me) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!me.roles.includes(RoleName.FACULTY)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  // Per-user upload throttle (Prompt 20). Fail-open if Redis is down.
  const rl = await rateLimit(
    `upload:${me.id}`,
    RATE_LIMITS.upload.limit,
    RATE_LIMITS.upload.windowSec,
  );
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const { requestId } = params;
  const request = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true },
  });
  if (!request) return Response.json({ error: 'request_not_found' }, { status: 404 });

  // Must be the assigned faculty for this request.
  const assigned = await prisma.facultyAssignment.findFirst({
    where: { requestId, facultyId: me.id, active: true },
    select: { id: true },
  });
  if (!assigned) return Response.json({ error: 'forbidden' }, { status: 403 });

  if (!UPLOADABLE_STATUSES.includes(request.status)) {
    return Response.json(
      { error: 'not_editable', message: `Cannot attach files in status ${request.status}` },
      { status: 409 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return Response.json({ error: 'no_file' }, { status: 400 });
  }

  // Server-side validation (authoritative — the client checks too, for UX).
  const v = validateAttachment({ mimeType: file.type, size: file.size });
  if (!v.ok) return Response.json({ error: v.code, message: v.message }, { status: 400 });

  const s3Key = `attachments/${requestId}/${crypto.randomUUID()}`;
  const body = Buffer.from(await file.arrayBuffer());
  try {
    // uploadAndPresign ensures the bucket + PUTs the object. We discard the
    // returned presigned URL — download links are minted on demand by the list
    // action from the durable s3Key.
    await uploadAndPresign(getS3Client(), {
      bucket: ATTACHMENTS_BUCKET,
      key: s3Key,
      body,
      contentType: file.type,
      expiresIn: 60,
    });
  } catch (err) {
    console.error('[attachments] upload to S3 failed', { requestId, s3Key, err });
    return Response.json({ error: 'storage_unavailable' }, { status: 502 });
  }

  const created = await prisma.attachment.create({
    data: {
      requestId,
      uploaderId: me.id,
      filename: file.name || 'upload',
      mimeType: file.type,
      size: file.size,
      s3Key,
    },
    select: { id: true, filename: true, mimeType: true, size: true, uploadedAt: true },
  });

  await audit({
    actorId: me.id,
    action: 'attachment.uploaded',
    entity: 'Attachment',
    entityId: created.id,
    after: {
      s3Key,
      filename: created.filename,
      size: created.size,
      mimeType: created.mimeType,
      requestId,
    },
    requestId,
  });

  return Response.json({ attachment: created }, { status: 201 });
}
