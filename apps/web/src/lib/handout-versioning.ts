import { prisma, Prisma, type BitsHandoutV1, renderBitsHandout } from '@hmp/db';
import { generateHTML } from '@tiptap/html';
import { TIPTAP_EXTENSIONS } from './tiptap-extensions';

const STANDARD_TEMPLATE_NAME = 'Standard Handout';

export interface VersionSummary {
  versionNo: number;
  authorName: string;
  createdAt: Date;
  notes: string | null;
}

export function renderTiptapToHtml(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  return generateHTML(json as Record<string, unknown>, TIPTAP_EXTENSIONS);
}

export function extractTiptapText(json: unknown): string {
  if (!json || typeof json !== 'object') return '';
  const out: string[] = [];
  const visit = (node: any) => {
    if (!node) return;
    if (typeof node.text === 'string') out.push(node.text);
    if (Array.isArray(node.content)) {
      for (const c of node.content) visit(c);
      if (['paragraph', 'heading', 'listItem', 'blockquote'].includes(node.type)) {
        out.push('\n');
      }
    }
  };
  visit(json);
  return out
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function loadHandoutForFaculty(requestId: string, facultyId: string) {
  const request = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    include: {
      offering: { include: { course: true, semester: { include: { programme: true } } } },
      initiator: { select: { name: true, email: true } },
      handout: {
        include: {
          currentVersion: {
            include: { author: { select: { name: true, email: true } } },
          },
        },
      },
      assignments: {
        where: { facultyId, active: true },
        take: 1,
      },
    },
  });
  if (!request) return null;
  const assignment = request.assignments[0];
  if (!assignment) return null;
  return { request, assignment };
}

export async function listVersions(handoutId: string): Promise<VersionSummary[]> {
  const rows = await prisma.handoutVersion.findMany({
    where: { handoutId },
    orderBy: { versionNo: 'asc' },
    include: { author: { select: { name: true } } },
  });
  return rows.map((v) => ({
    versionNo: v.versionNo,
    authorName: v.author.name,
    createdAt: v.createdAt,
    notes: v.notes,
  }));
}

export async function createInitialVersion(
  tx: Prisma.TransactionClient,
  handoutId: string,
  authorId: string,
) {
  const template = await tx.template.findUnique({ where: { name: STANDARD_TEMPLATE_NAME } });
  const contentJson = (template?.contentJson as Prisma.JsonValue) ?? {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
  const contentHtml = renderTiptapToHtml(contentJson);
  const version = await tx.handoutVersion.create({
    data: {
      handoutId,
      versionNo: 1,
      contentJson: contentJson as Prisma.InputJsonValue,
      contentHtml,
      authorId,
      notes: 'Initial version from template.',
    },
  });
  await tx.handout.update({
    where: { id: handoutId },
    data: { currentVersionId: version.id, templateId: template?.id ?? null },
  });
  return version;
}

/**
 * Initial-version creator for the Prompt 11e auto-fetch flow. Writes
 * `BitsHandoutV1` into `data` and the BITS-rendered HTML into `contentHtml`,
 * same shape as `appendStructuredVersion` but with a hard-coded versionNo of
 * 1 and a free notes slot for the cascade tier (e.g. "Auto-fetch (prior
 * version): Sem-II 2024-25 handout for SE ZG501"). The notes string is
 * informational only — the banner reads its source detail from the URL
 * search param set by `startEditingAction`, not from this column.
 *
 * Replaces `createInitialVersion` (the legacy TipTap template path) as the
 * default for new handouts. The legacy path is left in place for any code
 * still calling it directly; in practice 11e makes the only caller go
 * through here.
 */
export async function createInitialStructuredVersion(
  tx: Prisma.TransactionClient,
  handoutId: string,
  authorId: string,
  data: BitsHandoutV1,
  sourceLabel: string,
) {
  const contentHtml = renderBitsHandout(data);
  const version = await tx.handoutVersion.create({
    data: {
      handoutId,
      versionNo: 1,
      data: data as unknown as Prisma.InputJsonValue,
      contentJson: Prisma.JsonNull,
      contentHtml,
      authorId,
      notes: sourceLabel,
    },
  });
  await tx.handout.update({
    where: { id: handoutId },
    data: { currentVersionId: version.id },
  });
  return version;
}

export async function appendVersion(
  tx: Prisma.TransactionClient,
  handoutId: string,
  authorId: string,
  contentJson: Prisma.InputJsonValue,
  notes?: string | null,
) {
  const last = await tx.handoutVersion.findFirst({
    where: { handoutId },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });
  const nextNo = (last?.versionNo ?? 0) + 1;
  const contentHtml = renderTiptapToHtml(contentJson);
  const version = await tx.handoutVersion.create({
    data: {
      handoutId,
      versionNo: nextNo,
      contentJson,
      contentHtml,
      authorId,
      notes: notes ?? null,
    },
  });
  await tx.handout.update({
    where: { id: handoutId },
    data: { currentVersionId: version.id },
  });
  return version;
}

/**
 * Append a STRUCTURED HandoutVersion (Prompt 11d). Persists `data` as the
 * canonical JSON column and writes `contentHtml` rendered via the BITS
 * renderer (11c) so legacy consumers reading contentHtml continue to work.
 *
 * Derived-column invariant (see docs/dev-handoff-audit.md §1): every write
 * to `HandoutVersion.data` via this helper re-renders contentHtml in the
 * same transaction. Direct DB updates to `data` without re-rendering create
 * staleness — if a future data migration touches `data`, it MUST also
 * re-render contentHtml.
 *
 * `contentJson` is set to JsonNull on structured versions (the TipTap path
 * is unused for structured handouts; `data` is the source of truth).
 */
export async function appendStructuredVersion(
  tx: Prisma.TransactionClient,
  handoutId: string,
  authorId: string,
  data: BitsHandoutV1,
  notes?: string | null,
) {
  const last = await tx.handoutVersion.findFirst({
    where: { handoutId },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true },
  });
  const nextNo = (last?.versionNo ?? 0) + 1;
  const contentHtml = renderBitsHandout(data);
  const version = await tx.handoutVersion.create({
    data: {
      handoutId,
      versionNo: nextNo,
      data: data as unknown as Prisma.InputJsonValue,
      contentJson: Prisma.JsonNull,
      contentHtml,
      authorId,
      notes: notes ?? null,
    },
  });
  await tx.handout.update({
    where: { id: handoutId },
    data: { currentVersionId: version.id },
  });
  return version;
}
