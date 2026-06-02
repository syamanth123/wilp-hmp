'use server';

import { revalidatePath } from 'next/cache';
import { prisma, RoleName, Prisma } from '@hmp/db';
// Corpus-import is a sub-barrel kept off the top @hmp/db path so mammoth's
// Node-only deps don't leak into the Next.js client bundle. Server-only.
import { runCorpusImport, parseDocxFile } from '@hmp/db/src/corpus-import';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { existsSync, statSync } from 'node:fs';
import { z } from 'zod';

/**
 * Corpus-import admin actions (Prompt 11f-a). All gated to ADMIN. The
 * approval workflow (approve / reject / bulk-approve) lands in 11f-b; this
 * file ships the import + re-parse + delete operations only.
 */

const runSchema = z.object({
  corpusPath: z.string().min(1),
  limit: z.coerce.number().int().positive().optional(),
});

/**
 * Run the corpus import against a directory on the server filesystem.
 * Admin-only. Returns the `ImportSummary` so the client can render counts;
 * `revalidatePath` updates the list view.
 */
export async function runCorpusImportAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = runSchema.safeParse({
    corpusPath: formData.get('corpusPath'),
    limit: formData.get('limit') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  if (!existsSync(parsed.data.corpusPath)) {
    return { error: `Corpus path does not exist on the server: ${parsed.data.corpusPath}` };
  }
  const st = statSync(parsed.data.corpusPath);
  if (!st.isDirectory()) {
    return { error: `Corpus path is not a directory: ${parsed.data.corpusPath}` };
  }

  const summary = await runCorpusImport(prisma, parsed.data.corpusPath, {
    limit: parsed.data.limit,
  });

  await audit({
    actorId: me.id,
    action: 'corpus.import.run',
    entity: 'HandoutImport',
    entityId: 'batch',
    after: summary as unknown as Record<string, unknown>,
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true, summary };
}

const idSchema = z.object({ id: z.string().cuid() });

/**
 * Re-parse a single HandoutImport row. Reads the original file (if it still
 * exists at the recorded path), runs the parser fresh, updates the row.
 * Useful when the parser improves or the source file changed.
 */
export async function reParseImportAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: 'Invalid input' };

  const existing = await prisma.handoutImport.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { error: 'Import not found' };

  if (!existsSync(existing.sourceFile)) {
    return { error: `Source file no longer at recorded path: ${existing.sourceFile}` };
  }

  const result = await parseDocxFile(existing.sourceFile);
  const st = statSync(existing.sourceFile);
  await prisma.handoutImport.update({
    where: { id: existing.id },
    data: {
      sourceFileBytes: st.size,
      sourceModifiedAt: st.mtime,
      bitsCourseNumber: result.bitsCourseNumber,
      alternateCodes: result.alternateCodes,
      data: result.data ? (result.data as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      parseWarnings: result.warnings,
      parseErrors: result.errors,
      extractionMethod: result.extractionMethod,
    },
  });

  await audit({
    actorId: me.id,
    action: 'corpus.import.reparse',
    entity: 'HandoutImport',
    entityId: existing.id,
    after: { extractionMethod: result.extractionMethod },
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true };
}

/**
 * Delete a single HandoutImport row. Used to clean up bad data or remove
 * imports from files that no longer exist on disk.
 */
export async function deleteImportAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: 'Invalid input' };

  const existing = await prisma.handoutImport.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { ok: true }; // already gone

  await prisma.handoutImport.delete({ where: { id: parsed.data.id } });
  await audit({
    actorId: me.id,
    action: 'corpus.import.delete',
    entity: 'HandoutImport',
    entityId: existing.id,
    before: { sourceFile: existing.sourceFile, bitsCourseNumber: existing.bitsCourseNumber },
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true };
}
