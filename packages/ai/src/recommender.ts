import { prisma, FacultyType, RoleName } from '@hmp/db';
import { getAiClient, AiUnconfiguredError } from './client';
import { embedCourse, embedFaculty, cosine } from './embeddings';

export interface RecommendationCandidate {
  facultyId: string;
  name: string;
  email: string;
  facultyType: FacultyType | null;
  load: number;
  capped: boolean;
  score: number;
  reasons: string[];
}

export interface RecommendationResult {
  candidates: RecommendationCandidate[];
  strategy: 'embedding' | 'heuristic';
  model: string;
  fallbackReason?: string;
  generatedAt: Date;
}

const CAPPED_TYPES = new Set<FacultyType | null>([
  FacultyType.OFF_CAMPUS,
  FacultyType.ADJUNCT,
  FacultyType.GUEST,
]);

interface RecommendInput {
  requestId: string;
  topN?: number;
  forceRefresh?: boolean;
}

/**
 * Returns top-N faculty for a handout request.
 *
 * Strategy:
 *  1. Heuristic score is always computed: course-code-prefix history overlap +
 *     workload balance + facultyType nudge.
 *  2. If embeddings succeed, replace the prefix term with cosine similarity
 *     between course + faculty embeddings.
 *  3. AiUnconfiguredError / any embedding failure → strategy='heuristic',
 *     `fallbackReason` populated.
 *
 * Persists today's result as an `AIRecommendation` row and reuses it
 * (same `requestId`, same UTC day) unless `forceRefresh` is true.
 */
export async function recommendFaculty(input: RecommendInput): Promise<RecommendationResult> {
  const topN = input.topN ?? 5;

  // Reuse today's cached row unless forceRefresh.
  if (!input.forceRefresh) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const cached = await prisma.aIRecommendation.findFirst({
      where: { requestId: input.requestId, kind: 'faculty', createdAt: { gte: startOfDay } },
      orderBy: { createdAt: 'desc' },
    });
    if (cached) {
      const payload = cached.payload as unknown as RecommendationResult;
      return { ...payload, generatedAt: cached.createdAt };
    }
  }

  const request = await prisma.handoutRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      offering: {
        select: {
          semesterId: true,
          course: { select: { id: true, code: true, title: true, description: true } },
        },
      },
    },
  });
  if (!request) throw new Error('request_not_found');

  const cfg = await prisma.workflowConfig.findUnique({ where: { key: 'default' } });
  const cap = cfg?.offCampusMaxCourses ?? 3;

  const faculty = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: RoleName.FACULTY } } } },
    select: {
      id: true,
      name: true,
      email: true,
      facultyType: true,
    },
  });
  const ids = faculty.map((f) => f.id);

  const [loads, history] = await Promise.all([
    prisma.facultyAssignment.groupBy({
      by: ['facultyId'],
      where: {
        active: true,
        facultyId: { in: ids },
        request: { offering: { semesterId: request.offering.semesterId } },
      },
      _count: { _all: true },
    }),
    prisma.facultyAssignment.findMany({
      where: { facultyId: { in: ids } },
      select: {
        facultyId: true,
        request: {
          select: {
            offering: {
              select: { course: { select: { code: true } } },
            },
          },
        },
      },
    }),
  ]);

  const loadMap = new Map(loads.map((l) => [l.facultyId, l._count._all]));
  const historyByFaculty = new Map<string, string[]>();
  for (const h of history) {
    const list = historyByFaculty.get(h.facultyId) ?? [];
    list.push(h.request.offering.course.code);
    historyByFaculty.set(h.facultyId, list);
  }

  const targetCode = request.offering.course.code;
  const targetPrefix = targetCode.split(/[-_/\s]/)[0]?.toUpperCase() ?? '';

  // ── Heuristic scoring (always computed) ──────────────────────────────
  function heuristicScore(facultyId: string, facultyType: FacultyType | null) {
    const past = historyByFaculty.get(facultyId) ?? [];
    const sharedPrefix = past.filter((c) => c.toUpperCase().startsWith(targetPrefix)).length;
    const sharedTerm = Math.min(1, sharedPrefix / 3); // saturates at 3 shared courses
    const depthTerm = Math.min(1, past.length / 10);
    const load = loadMap.get(facultyId) ?? 0;
    const loadTerm = Math.max(0, 1 - load / cap);
    const typeNudge = facultyType === FacultyType.ON_CAMPUS ? 0.05 : 0;
    const score = 0.5 * sharedTerm + 0.3 * depthTerm + 0.2 * loadTerm + typeNudge;
    const reasons: string[] = [];
    if (sharedPrefix > 0)
      reasons.push(`${sharedPrefix} prior assignment(s) sharing prefix ${targetPrefix}`);
    if (past.length > 0) reasons.push(`${past.length} total prior assignments`);
    reasons.push(`Semester load ${load}/${cap}`);
    if (facultyType) reasons.push(`Type: ${facultyType.toLowerCase().replace('_', '-')}`);
    return { score: Math.min(1, score), reasons };
  }

  // ── Try embedding strategy ───────────────────────────────────────────
  let strategy: 'embedding' | 'heuristic' = 'heuristic';
  let fallbackReason: string | undefined;
  let courseVec: number[] | null = null;
  const facultyVecs = new Map<string, number[]>();
  const client = getAiClient();
  let model = `heuristic-v1`;

  if (client.provider !== 'noop') {
    try {
      const cr = await embedCourse(request.offering.course.id);
      if (!cr) throw new AiUnconfiguredError('course_text_empty');
      courseVec = cr.vector;
      model = cr.model;
      for (const f of faculty) {
        try {
          const fr = await embedFaculty(f.id);
          if (fr) facultyVecs.set(f.id, fr.vector);
        } catch {
          // Per-faculty embed failure is non-fatal; we'll score them heuristically.
        }
      }
      strategy = 'embedding';
    } catch (err) {
      strategy = 'heuristic';
      fallbackReason =
        err instanceof AiUnconfiguredError ? err.reason : err instanceof Error ? err.message : 'embedding_failed';
    }
  } else {
    fallbackReason = 'ai_provider_unconfigured';
  }

  // ── Build candidates ─────────────────────────────────────────────────
  const candidates: RecommendationCandidate[] = faculty.map((f) => {
    const h = heuristicScore(f.id, f.facultyType);
    let score = h.score;
    const reasons = [...h.reasons];

    if (strategy === 'embedding' && courseVec) {
      const fv = facultyVecs.get(f.id);
      if (fv && fv.length === courseVec.length) {
        const sim = cosine(courseVec, fv);
        // Replace `sharedTerm` (50% weight) with cosine similarity.
        // Keep depthTerm + loadTerm + typeNudge contributions from heuristic for stability.
        const load = loadMap.get(f.id) ?? 0;
        const loadTerm = Math.max(0, 1 - load / cap);
        const past = historyByFaculty.get(f.id) ?? [];
        const depthTerm = Math.min(1, past.length / 10);
        const typeNudge = f.facultyType === FacultyType.ON_CAMPUS ? 0.05 : 0;
        score = Math.min(1, 0.5 * sim + 0.3 * depthTerm + 0.2 * loadTerm + typeNudge);
        reasons.unshift(`Embedding similarity ${sim.toFixed(2)}`);
      } else {
        reasons.push('No embedding (insufficient history)');
      }
    }

    const load = loadMap.get(f.id) ?? 0;
    const capped = CAPPED_TYPES.has(f.facultyType) && load >= cap;
    return {
      facultyId: f.id,
      name: f.name,
      email: f.email,
      facultyType: f.facultyType,
      load,
      capped,
      score,
      reasons: reasons.slice(0, 3),
    };
  });

  candidates.sort((a, b) => {
    if (a.capped !== b.capped) return a.capped ? 1 : -1;
    return b.score - a.score;
  });

  const top = candidates.slice(0, topN);
  const result: RecommendationResult = {
    candidates: top,
    strategy,
    model,
    fallbackReason,
    generatedAt: new Date(),
  };

  await prisma.aIRecommendation.create({
    data: {
      requestId: input.requestId,
      kind: 'faculty',
      model,
      payload: result as unknown as object,
    },
  });

  return result;
}

export async function clearTodayRecommendations(requestId: string) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  await prisma.aIRecommendation.deleteMany({
    where: { requestId, kind: 'faculty', createdAt: { gte: startOfDay } },
  });
}
