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
 * Corpus-import admin actions (Prompts 11f-a + 11f-b2). All gated to ADMIN.
 * 11f-a shipped runCorpusImportAction / reParseImportAction /
 * deleteImportAction; 11f-b2 adds the approval workflow:
 *
 *   - countBulkApproveEligibleAction — returns the eligible count + a
 *     sample of course numbers, BEFORE the actual update. The admin UI
 *     uses this for the confirmation dialog.
 *   - bulkApproveEligibleAction — sets approvedForReuse=true on every
 *     row matching the eligibility filter.
 *   - approveImportAction — per-row approve (no eligibility gate).
 *   - rejectImportAction — per-row reject (deletes the row).
 *
 * Eligibility filter (11f-b2 Decision 3 + UX research from Survey C):
 *   extractionMethod = MAMMOTH_STRUCTURED
 *   AND parseWarnings.length <= 1
 *   AND bitsCourseNumber IS NOT NULL
 *   AND approvedForReuse = false
 *
 * The 11f-b1 baseline showed 0 imports met this. Post-11f-b2 parser fix,
 * ~230 of 287 imports become eligible.
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

// =========================================================================
// 11f-b2 — Approval workflow
// =========================================================================

/**
 * Eligibility filter for bulk-approve. Surfaced as both an array `WHERE`
 * clause (for the count + update queries) and a documented shape (audit §1).
 */
const BULK_APPROVE_WHERE = {
  extractionMethod: 'MAMMOTH_STRUCTURED',
  approvedForReuse: false,
  bitsCourseNumber: { not: null },
} as const;

/**
 * Pre-flight count + sample for the bulk-approve confirmation dialog.
 * No mutations. Returns the eligible count and the first 10 course
 * numbers so admins see WHAT they're approving before committing.
 *
 * The `parseWarnings.length <= 1` constraint is enforced in JS rather
 * than Postgres because Prisma's array length filter is awkward and the
 * eligible cohort is small (~230 rows of 287 today). Sufficient.
 */
export async function countBulkApproveEligibleAction() {
  await requireRole(await getSessionUser(), RoleName.ADMIN);
  const candidates = await prisma.handoutImport.findMany({
    where: BULK_APPROVE_WHERE,
    select: { id: true, bitsCourseNumber: true, parseWarnings: true },
    orderBy: { bitsCourseNumber: 'asc' },
  });
  const eligible = candidates.filter((c) => c.parseWarnings.length <= 1);
  return {
    ok: true as const,
    eligibleCount: eligible.length,
    sampleCourseNumbers: eligible
      .slice(0, 10)
      .map((c) => c.bitsCourseNumber)
      .filter(Boolean) as string[],
  };
}

/**
 * Commit the bulk-approve. Sets approvedForReuse + approvedAt + approvedById
 * on every eligible row. Returns the count actually updated; the admin UI
 * compares this to the pre-flight count to detect state-sync drift between
 * the confirmation moment and the action.
 */
export async function bulkApproveEligibleAction() {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const candidates = await prisma.handoutImport.findMany({
    where: BULK_APPROVE_WHERE,
    select: { id: true, parseWarnings: true },
  });
  const eligibleIds = candidates.filter((c) => c.parseWarnings.length <= 1).map((c) => c.id);
  const now = new Date();
  const result = await prisma.handoutImport.updateMany({
    where: { id: { in: eligibleIds } },
    data: { approvedForReuse: true, approvedAt: now, approvedById: me.id },
  });

  await audit({
    actorId: me.id,
    action: 'corpus.import.bulk_approve',
    entity: 'HandoutImport',
    entityId: 'batch',
    after: { approvedCount: result.count, requestedIds: eligibleIds.length },
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true as const, approvedCount: result.count };
}

/**
 * Per-row approve. No eligibility gate — admin can approve imports with
 * any parseWarning count (their judgment overrides the default filter).
 */
export async function approveImportAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: 'Invalid input' };

  const updated = await prisma.handoutImport.update({
    where: { id: parsed.data.id },
    data: { approvedForReuse: true, approvedAt: new Date(), approvedById: me.id },
  });
  await audit({
    actorId: me.id,
    action: 'corpus.import.approve',
    entity: 'HandoutImport',
    entityId: updated.id,
    after: { bitsCourseNumber: updated.bitsCourseNumber },
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true };
}

/**
 * Per-row reject — deletes the HandoutImport row. The source `.docx` file
 * on disk is untouched; a future re-import would recreate the row.
 */
export async function rejectImportAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: 'Invalid input' };

  const existing = await prisma.handoutImport.findUnique({ where: { id: parsed.data.id } });
  if (!existing) return { ok: true };

  await prisma.handoutImport.delete({ where: { id: parsed.data.id } });
  await audit({
    actorId: me.id,
    action: 'corpus.import.reject',
    entity: 'HandoutImport',
    entityId: existing.id,
    before: { sourceFile: existing.sourceFile, bitsCourseNumber: existing.bitsCourseNumber },
  });

  revalidatePath('/admin/corpus-imports');
  return { ok: true };
}
