import { prisma } from '@hmp/db';
import { getAiClient, AiUnconfiguredError } from './client';
import { HandoutDraftSchema, type HandoutDraftData } from './schemas';

export type DraftSource = 'ai' | 'cache' | 'stub';

export interface GenerateHandoutDraftInput {
  /** ID of the Handout row (NOT the request). */
  handoutId: string;
  /** Skip the cache and re-generate. */
  forceRefresh?: boolean;
}

export interface HandoutDraftResult {
  draftId: string;
  structured: HandoutDraftData;
  tiptapJson: unknown;
  model: string;
  source: DraftSource;
  createdAt: Date;
}

const RATE_LIMIT_WINDOW_MS = 5 * 60_000; // 5 min — recently-generated draft is reused.

const SYSTEM_PROMPT = `You draft BITS WILP course handouts.
Given a course code, title, description and optional reference text, return a STRICT JSON object with three sections:

- partA: { courseDescription (1-2 paragraphs), learningOutcomes (3-8 measurable items beginning with action verbs aligned to Bloom's taxonomy), pedagogy (paragraph describing delivery + assessment philosophy), textbooks (1-4 entries — author, title, edition), referenceBooks (1-4 entries) }
- partB: { lecturePlan (8-16 modules; each { module, topics [3-8 short topics], hours }), selfStudy (3-8 short topic prompts) }
- evaluative: { components (3-6 entries; each { name, weightage (0-100 number), schedule (term-week or date placeholder), nature ("open-book" | "closed-book" | "take-home" | "online" | "viva" | "project" | "assignment") }), notes (optional short string) }

Constraints:
- Component weightages must sum to ~100 (within ±2).
- Be concrete, terse, and grounded in the provided course title/description. Do NOT invent unrelated topics.
- Use sentence case for topics. Avoid emoji and markdown formatting in field values.`;

function buildUserPrompt(input: {
  courseCode: string;
  courseTitle: string;
  courseDescription: string;
  programmeName: string;
  semesterName: string;
  previousHandoutText?: string;
}) {
  const parts = [
    `# Course`,
    `${input.courseCode} — ${input.courseTitle}`,
    ``,
    `## Programme / Semester`,
    `${input.programmeName} · ${input.semesterName}`,
    ``,
    `## Course description / syllabus`,
    input.courseDescription || '(none provided — generate a faithful BITS-style draft from the title alone)',
  ];
  if (input.previousHandoutText && input.previousHandoutText.trim()) {
    parts.push('', '## Previous-year handout (reference, may be partial)', input.previousHandoutText.slice(0, 12_000));
  }
  return parts.join('\n');
}

/** Map structured JSON → TipTap doc. Headings + paragraphs + bullet lists. */
export function structuredDraftToTiptap(d: HandoutDraftData): {
  type: 'doc';
  content: Array<Record<string, unknown>>;
} {
  const content: Array<Record<string, unknown>> = [];
  const h = (level: number, text: string) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }],
  });
  const p = (text: string) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  });
  const ul = (items: string[]) => ({
    type: 'bulletList',
    content: items.map((t) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }],
    })),
  });

  // Part A
  content.push(h(1, 'Part A — Course information'));
  content.push(h(2, 'Course description'));
  content.push(p(d.partA.courseDescription));
  content.push(h(2, 'Learning outcomes'));
  content.push(ul(d.partA.learningOutcomes));
  content.push(h(2, 'Pedagogy'));
  content.push(p(d.partA.pedagogy));
  if (d.partA.textbooks.length > 0) {
    content.push(h(2, 'Textbooks'));
    content.push(ul(d.partA.textbooks));
  }
  if (d.partA.referenceBooks.length > 0) {
    content.push(h(2, 'Reference books'));
    content.push(ul(d.partA.referenceBooks));
  }

  // Part B
  content.push(h(1, 'Part B — Lecture-wise plan'));
  for (const [i, mod] of d.partB.lecturePlan.entries()) {
    const hoursSuffix = mod.hours > 0 ? ` (${mod.hours} hr${mod.hours === 1 ? '' : 's'})` : '';
    content.push(h(2, `Module ${i + 1} — ${mod.module}${hoursSuffix}`));
    content.push(ul(mod.topics));
  }
  if (d.partB.selfStudy.length > 0) {
    content.push(h(2, 'Self-study topics'));
    content.push(ul(d.partB.selfStudy));
  }

  // Evaluative
  content.push(h(1, 'Evaluative components'));
  for (const c of d.evaluative.components) {
    const summary = [
      `${c.weightage}% weightage`,
      c.nature ? c.nature : null,
      c.schedule ? c.schedule : null,
    ]
      .filter(Boolean)
      .join(' · ');
    content.push(h(3, c.name));
    content.push(p(summary));
  }
  if (d.evaluative.notes && d.evaluative.notes.trim()) {
    content.push(h(2, 'Notes'));
    content.push(p(d.evaluative.notes));
  }

  return { type: 'doc', content };
}

/** Friendly stub draft used when the AI provider is unconfigured. */
function buildStubDraft(course: { code: string; title: string; description: string | null }): HandoutDraftData {
  const desc =
    course.description?.trim() ||
    `${course.title} is a foundational course offered under BITS WILP. This draft is a template stub — connect an AI provider to generate a real outline grounded in the course syllabus.`;
  return {
    partA: {
      courseDescription: desc,
      learningOutcomes: [
        'Explain the foundational concepts of the course.',
        'Apply key techniques to representative problems.',
        'Analyse trade-offs in solution approaches.',
        'Evaluate outcomes against established criteria.',
      ],
      pedagogy:
        'A blend of recorded lectures, live mentor sessions, hands-on labs and graded assignments. Assessment is continuous with one comprehensive examination.',
      textbooks: ['Primary textbook — author, title, latest edition (placeholder)'],
      referenceBooks: ['Reference text — author, title (placeholder)'],
    },
    partB: {
      lecturePlan: [
        { module: 'Introduction and scope', topics: ['Course overview', 'Learning outcomes', 'Resource map'], hours: 2 },
        { module: 'Core concepts I', topics: ['Foundational ideas', 'Worked examples', 'Practice problems'], hours: 3 },
        { module: 'Core concepts II', topics: ['Advanced ideas', 'Case study', 'Discussion'], hours: 3 },
        { module: 'Applications and synthesis', topics: ['Cross-topic problems', 'Project briefing', 'Review'], hours: 2 },
      ],
      selfStudy: ['Read chapter summaries', 'Solve end-of-chapter problems', 'Watch supplementary videos'],
    },
    evaluative: {
      components: [
        { name: 'Assignment 1', weightage: 15, schedule: 'Week 4', nature: 'take-home' },
        { name: 'Mid-semester exam', weightage: 30, schedule: 'Week 8', nature: 'closed-book' },
        { name: 'Assignment 2', weightage: 15, schedule: 'Week 12', nature: 'take-home' },
        { name: 'Comprehensive exam', weightage: 40, schedule: 'End of term', nature: 'closed-book' },
      ],
      notes: 'Weightages and schedule are placeholder values — confirm against the official evaluation plan.',
    },
  };
}

/**
 * Generates a full handout draft (Part A + Part B + Evaluative) for the given handout.
 *
 * Returns a friendly stub when the AI provider is unconfigured so the Preview UI
 * still renders something usable for demo/dev.
 *
 * Reuses any draft for the same handoutId newer than RATE_LIMIT_WINDOW_MS unless
 * `forceRefresh` is true.
 */
export async function generateHandoutDraft(
  input: GenerateHandoutDraftInput,
): Promise<HandoutDraftResult> {
  const handout = await prisma.handout.findUnique({
    where: { id: input.handoutId },
    select: {
      id: true,
      request: {
        select: {
          previousHandoutUrl: true,
          offering: {
            select: {
              course: { select: { code: true, title: true, description: true } },
              semester: {
                select: { name: true, programme: { select: { name: true } } },
              },
            },
          },
        },
      },
      currentVersion: { select: { contentHtml: true } },
    },
  });
  if (!handout) throw new Error('handout_not_found');

  // Cache: reuse a recent draft unless forceRefresh.
  if (!input.forceRefresh) {
    const recent = await prisma.aIDraftLog.findFirst({
      where: {
        handoutId: handout.id,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const payload = recent.payload as { structured: HandoutDraftData; tiptapJson: unknown };
      return {
        draftId: recent.id,
        structured: payload.structured,
        tiptapJson: payload.tiptapJson,
        model: recent.model,
        source: 'cache',
        createdAt: recent.createdAt,
      };
    }
  }

  const course = handout.request.offering.course;
  const programmeName = handout.request.offering.semester.programme.name;
  const semesterName = handout.request.offering.semester.name;
  // Prior handout text: use current saved version if any (e.g. rework cycles refining a draft).
  const previousHandoutText = handout.currentVersion?.contentHtml ?? undefined;

  const client = getAiClient();

  // ── Stub fallback when AI provider is not configured ─────────────────
  if (client.provider === 'noop') {
    const structured = buildStubDraft(course);
    const tiptapJson = structuredDraftToTiptap(structured);
    const row = await prisma.aIDraftLog.create({
      data: {
        handoutId: handout.id,
        source: 'stub',
        model: 'stub-template-v1',
        payload: { structured, tiptapJson } as never,
      },
    });
    return {
      draftId: row.id,
      structured,
      tiptapJson,
      model: 'stub-template-v1',
      source: 'stub',
      createdAt: row.createdAt,
    };
  }

  // ── Real AI generation ───────────────────────────────────────────────
  const chatResult = await client.chatJson({
    schema: HandoutDraftSchema,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({
      courseCode: course.code,
      courseTitle: course.title,
      courseDescription: course.description ?? '',
      programmeName,
      semesterName,
      previousHandoutText: previousHandoutText
        ? previousHandoutText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 8000)
        : undefined,
    }),
    maxTokens: 3500,
  });
  // Zod returns the parsed output (with defaults applied) but the inferred T from
  // ZodSchema<input> drops the defaults — cast back to the canonical output shape.
  const data = chatResult.data as HandoutDraftData;
  const model = chatResult.model;

  const tiptapJson = structuredDraftToTiptap(data);
  const row = await prisma.aIDraftLog.create({
    data: {
      handoutId: handout.id,
      source: 'ai',
      model,
      payload: { structured: data, tiptapJson } as never,
    },
  });

  return {
    draftId: row.id,
    structured: data,
    tiptapJson,
    model,
    source: 'ai',
    createdAt: row.createdAt,
  };
}

export { AiUnconfiguredError };
