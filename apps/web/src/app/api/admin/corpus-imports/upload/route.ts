import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { RoleName } from '@hmp/db';
import { processSingleHandoutFile } from '@hmp/db/src/corpus-import';
import { prisma } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches the attachment-upload ceiling (Prompt 16)
const ALLOWED_EXT = new Set(['.docx', '.doc']);

/**
 * Admin manual corpus upload (Prompt 24). A Route Handler — NOT a server action
 * — because uploads can be large and server actions are globally capped at
 * `serverActions.bodySizeLimit` (5 MB). Admin-only. Routes the file through the
 * SAME pipeline as the directory scan (`processSingleHandoutFile` →
 * `parseFileWithConversion` → `upsertImportRow`); `.doc` auto-converts via
 * LibreOffice. Imports UNAPPROVED — the admin reviews the result then approves
 * via the existing per-row action.
 */
export async function POST(req: Request) {
  // CSRF defense-in-depth (Prompt 20) — same Origin/Host check as the
  // attachments route. Consistency over "admin route, less risk".
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) {
    return Response.json({ error: 'bad_origin' }, { status: 403 });
  }

  // Explicit null/role checks (NOT requireRole, which throws → 500 in a Route
  // Handler) so unauth/wrong-role get clean 401/403 — matches the attachments route.
  const me = await getSessionUser();
  if (!me) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!me.roles.includes(RoleName.ADMIN)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'invalid_multipart' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'no_file' }, { status: 400 });
  }
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return Response.json(
      { error: 'unsupported_format', detail: 'Only .docx or .doc files can be imported.' },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: 'file_too_large', detail: `Max ${MAX_BYTES / (1024 * 1024)} MB.` },
      { status: 413 },
    );
  }

  const work = await mkdtemp(join(tmpdir(), 'hmp-upload-'));
  const tmpPath = join(work, `${randomUUID()}${ext}`);
  try {
    await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));
    const result = await processSingleHandoutFile(prisma, {
      filePath: tmpPath,
      originalName: file.name,
      sizeBytes: file.size,
    });
    await audit({
      actorId: me.id,
      action: 'corpus.import.upload',
      entity: 'HandoutImport',
      entityId: result.importId,
      after: { originalName: file.name, extractionMethod: result.extractionMethod },
    });
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('[corpus-upload] processing failed', { name: file.name, err });
    return Response.json({ error: 'processing_failed' }, { status: 500 });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
