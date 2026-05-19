import { prisma, type Prisma } from '@hmp/db';
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
