import { createHash } from 'node:crypto';
import { prisma, RoleName, type AiOperation } from '@hmp/db';
import { getAiClient } from './client';
import { recordAiUsage } from './usage';

/**
 * Cost-tracking label for an embedding call (Prompt 17). The SAME `embedText`
 * call is labeled by what TRIGGERED it — `FACULTY_RECOMMENDATION` when a
 * recommendation run drives the embedding, `EMBEDDING` for the admin corpus
 * refresh — so the dashboard's by-operation breakdown reflects which feature
 * cost what, not that both were technically `embedText`. Recorded on a real
 * call only (a sourceHash cache hit makes no API call), success only (embedding
 * failures self-heal into the recommender's heuristic fallback).
 */
export interface EmbedUsage {
  actorId?: string | null;
  operation: AiOperation;
}

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function sha1(input: string): string {
  return createHash('sha1').update(input).digest('hex');
}

async function loadOrCreate(
  ownerType: 'Course' | 'User',
  ownerId: string,
  sourceText: string,
  usage?: EmbedUsage,
): Promise<{ vector: number[]; model: string } | null> {
  if (!sourceText.trim()) return null;
  const client = getAiClient();
  if (client.provider === 'noop') return null;

  const hash = sha1(sourceText);
  const existing = await prisma.embedding.findUnique({
    where: { ownerType_ownerId_model: { ownerType, ownerId, model: client.embedModel } },
  });
  if (existing && existing.sourceHash === hash) {
    return { vector: existing.vector as number[], model: existing.model };
  }

  const startedAt = Date.now();
  const { vector, model, tokens } = await client.embedText(sourceText);
  if (usage) {
    await recordAiUsage({
      actorId: usage.actorId ?? null,
      handoutId: null,
      operation: usage.operation,
      provider: client.provider,
      model,
      tokens: tokens ?? { in: 0, out: 0 },
      durationMs: Date.now() - startedAt,
      succeeded: true,
    });
  }
  await prisma.embedding.upsert({
    where: { ownerType_ownerId_model: { ownerType, ownerId, model } },
    create: { ownerType, ownerId, model, vector, sourceHash: hash },
    update: { vector, sourceHash: hash },
  });
  return { vector, model };
}

export async function embedCourse(courseId: string, usage?: EmbedUsage) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, code: true, title: true, description: true },
  });
  if (!course) return null;
  const text = [course.code, course.title, course.description ?? ''].filter(Boolean).join('\n');
  return loadOrCreate('Course', course.id, text, usage);
}

export async function embedFaculty(facultyId: string, usage?: EmbedUsage) {
  const faculty = await prisma.user.findUnique({
    where: { id: facultyId },
    select: {
      id: true,
      name: true,
      active: true,
      facultyType: true,
      assignments: {
        where: { active: true },
        select: {
          request: {
            select: {
              offering: {
                select: {
                  course: { select: { code: true, title: true, description: true } },
                },
              },
            },
          },
        },
        take: 50,
      },
    },
  });
  if (!faculty) return null;
  // Inactive faculty must not enter the recommendation corpus. Also drop any
  // stale embedding row that may have been written while they were active.
  if (!faculty.active) {
    const client = getAiClient();
    if (client.provider !== 'noop') {
      await prisma.embedding.deleteMany({
        where: { ownerType: 'User', ownerId: faculty.id },
      });
    }
    return null;
  }
  const courseTexts = new Set<string>();
  for (const a of faculty.assignments) {
    const c = a.request.offering.course;
    courseTexts.add([c.code, c.title, c.description ?? ''].filter(Boolean).join(' '));
  }
  const text = [faculty.name, faculty.facultyType ?? '', Array.from(courseTexts).join('\n')]
    .filter(Boolean)
    .join('\n');
  return loadOrCreate('User', faculty.id, text, usage);
}

export async function ensureCorpusEmbeddings(usage?: EmbedUsage): Promise<{
  courses: number;
  faculty: number;
  skipped: number;
}> {
  const client = getAiClient();
  if (client.provider === 'noop') {
    return { courses: 0, faculty: 0, skipped: 0 };
  }

  const [courses, faculty] = await Promise.all([
    prisma.course.findMany({ where: { active: true }, select: { id: true } }),
    prisma.user.findMany({
      where: { active: true, roles: { some: { role: { name: RoleName.FACULTY } } } },
      select: { id: true },
    }),
  ]);

  let cDone = 0;
  let fDone = 0;
  let skipped = 0;
  for (const c of courses) {
    try {
      const r = await embedCourse(c.id, usage);
      if (r) cDone += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  for (const f of faculty) {
    try {
      const r = await embedFaculty(f.id, usage);
      if (r) fDone += 1;
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { courses: cDone, faculty: fDone, skipped };
}
