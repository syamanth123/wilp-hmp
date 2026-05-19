import { prisma } from '@hmp/db';
import { getAiClient, AiUnconfiguredError } from './client';
import { QualityReportSchema, type QualityReportData } from './schemas';

export interface QualityReportResult extends QualityReportData {
  reportId: string;
  model: string;
  createdAt: Date;
  cached: boolean;
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 min

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYSTEM_PROMPT = `You audit BITS WILP course handouts.
Given a course description and the handout body, return a strict JSON object with:
- score: overall quality, 0..1
- blooms: distribution over {remember, understand, apply, analyze, evaluate, create}, each 0..1, summing roughly to 1
- coverage: { covered: string[] (syllabus topics present in the handout), missing: string[] (syllabus topics absent), coverageRatio: 0..1 }
- suggestions: short markdown (max 600 words) listing 3-5 concrete improvements

Be specific, terse, and grounded in the provided text. Do not invent topics that aren't in the course description.`;

function buildUserPrompt(courseCode: string, courseTitle: string, courseDescription: string, handoutText: string) {
  return [
    `# Course`,
    `${courseCode} — ${courseTitle}`,
    ``,
    `## Course description / syllabus`,
    courseDescription || '(none provided)',
    ``,
    `## Handout body`,
    handoutText.slice(0, 16_000),
  ].join('\n');
}

export async function runQualityReport(input: {
  handoutVersionId: string;
  /** Skip rate-limit guard. Used by the auto-on-submit path. */
  bypassRateLimit?: boolean;
}): Promise<QualityReportResult> {
  const version = await prisma.handoutVersion.findUnique({
    where: { id: input.handoutVersionId },
    select: {
      id: true,
      versionNo: true,
      contentHtml: true,
      handoutId: true,
      handout: {
        select: {
          id: true,
          request: {
            select: {
              offering: {
                select: { course: { select: { code: true, title: true, description: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!version) throw new Error('handout_version_not_found');
  if (!version.contentHtml || !version.contentHtml.trim()) throw new Error('handout_empty');

  // Cheap rate limit: reuse last report for this handout if produced within RATE_LIMIT_WINDOW_MS.
  if (!input.bypassRateLimit) {
    const recent = await prisma.aIQualityReport.findFirst({
      where: {
        handoutId: version.handoutId,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      return {
        reportId: recent.id,
        score: recent.score,
        blooms: recent.bloomsJson as QualityReportData['blooms'],
        coverage: recent.coverageJson as QualityReportData['coverage'],
        suggestions: recent.suggestions,
        model: recent.model,
        createdAt: recent.createdAt,
        cached: true,
      };
    }
  }

  const client = getAiClient();
  if (client.provider === 'noop') throw new AiUnconfiguredError('quality_check_requires_provider');

  const course = version.handout.request.offering.course;
  const handoutText = htmlToPlainText(version.contentHtml);
  const { data, model } = await client.chatJson({
    schema: QualityReportSchema,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(course.code, course.title, course.description ?? '', handoutText),
    maxTokens: 1500,
  });

  const row = await prisma.aIQualityReport.create({
    data: {
      handoutId: version.handoutId,
      score: data.score,
      bloomsJson: data.blooms,
      coverageJson: data.coverage,
      suggestions: data.suggestions,
      model,
    },
  });

  return {
    reportId: row.id,
    ...data,
    model,
    createdAt: row.createdAt,
    cached: false,
  };
}

export async function latestQualityReport(handoutId: string): Promise<QualityReportResult | null> {
  const row = await prisma.aIQualityReport.findFirst({
    where: { handoutId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  return {
    reportId: row.id,
    score: row.score,
    blooms: row.bloomsJson as QualityReportData['blooms'],
    coverage: row.coverageJson as QualityReportData['coverage'],
    suggestions: row.suggestions,
    model: row.model,
    createdAt: row.createdAt,
    cached: true,
  };
}
