import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BitsHandoutSchemaV1 } from '@hmp/db';

// vi.mock is hoisted to the top of the file — so any objects the mock factory
// closes over must be declared via vi.hoisted() to also be hoisted. Otherwise
// the factory runs before the const initialization and throws ReferenceError.
const { prismaMock, chatJsonMock } = vi.hoisted(() => ({
  prismaMock: {
    handout: { findUnique: vi.fn() },
    aIDraftLog: { findFirst: vi.fn(), create: vi.fn() },
    // Prompt 17: generateStructuredHandoutDraft now records AI usage (best-effort).
    // Stub it so the recording write succeeds and the budget check is a no-op
    // (under-budget aggregate) rather than logging swallowed errors.
    aiUsageLog: {
      create: vi.fn().mockResolvedValue({ id: 'usage-1' }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
    },
  },
  chatJsonMock: vi.fn(),
}));

vi.mock('@hmp/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hmp/db')>();
  return { ...actual, prisma: prismaMock };
});

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>();
  return {
    ...actual,
    getAiClient: () => ({
      provider: process.env.__TEST_AI_PROVIDER ?? 'noop',
      chatModel: 'test-model',
      embedModel: 'test-embed',
      embedText: vi.fn(),
      chatJson: chatJsonMock,
    }),
  };
});

// Import after mocks are wired.
import { generateStructuredHandoutDraft } from './structured-handout-generator';

const handoutRecord = {
  id: 'h-1',
  request: {
    offering: {
      course: {
        code: 'SE ZG501',
        title: 'Software Quality Assurance and Testing',
        description: '',
      },
      semester: { name: 'Sem-I 2025-26', programme: { name: 'M.Tech Software Engineering' } },
    },
  },
};

beforeEach(() => {
  prismaMock.handout.findUnique.mockReset();
  prismaMock.aIDraftLog.findFirst.mockReset();
  prismaMock.aIDraftLog.create.mockReset();
  chatJsonMock.mockReset();
  prismaMock.handout.findUnique.mockResolvedValue(handoutRecord);
  prismaMock.aIDraftLog.findFirst.mockResolvedValue(null);
  prismaMock.aIDraftLog.create.mockImplementation(async ({ data }) => ({
    id: 'draft-1',
    handoutId: data.handoutId,
    source: data.source,
    model: data.model,
    payload: data.payload,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }));
});

afterEach(() => {
  delete process.env.__TEST_AI_PROVIDER;
});

describe('generateStructuredHandoutDraft — stub path (AI unconfigured)', () => {
  beforeEach(() => {
    process.env.__TEST_AI_PROVIDER = 'noop';
  });

  it('returns a Zod-valid BitsHandoutV1 with source="stub"', async () => {
    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(result.source).toBe('stub');
    expect(result.model).toBe('stub-structured-v1');
    const parsed = BitsHandoutSchemaV1.safeParse(result.data);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(
      true,
    );
  });

  it('pre-populates Part A with the course context', async () => {
    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(result.data.partA.courseTitle).toBe('Software Quality Assurance and Testing');
    expect(result.data.partA.courseNumbers).toEqual(['SE ZG501']);
    expect(result.data.metadata.semester).toBe('Sem-I 2025-26');
  });

  it('persists the stub draft to AIDraftLog with payload.data', async () => {
    await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(prismaMock.aIDraftLog.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.aIDraftLog.create.mock.calls[0]![0];
    expect(createArgs.data.handoutId).toBe('h-1');
    expect(createArgs.data.source).toBe('stub');
    expect(createArgs.data.payload.data.partA.courseTitle).toBe(
      'Software Quality Assurance and Testing',
    );
  });

  it('the stub satisfies the schema sum-to-100 BITS convention (UI-only but a useful smoke test)', async () => {
    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    const totalWeight = result.data.evaluation.components.reduce(
      (s, c) => s + c.subComponents.reduce((ss, sc) => ss + sc.weight, 0),
      0,
    );
    expect(totalWeight).toBe(100);
  });
});

describe('generateStructuredHandoutDraft — AI happy path (mocked chatJson returns valid data)', () => {
  beforeEach(() => {
    process.env.__TEST_AI_PROVIDER = 'openai';
  });

  it('returns the model-provided BitsHandoutV1 with source="ai"', async () => {
    const goodData = {
      schemaVersion: 1 as const,
      metadata: {
        institutionHeader: 'BITS Pilani',
        divisionHeader: 'WILP',
        semester: 'Sem-I 2025-26',
        documentTitle: 'Digital Learning Handout',
        formNumber: '',
      },
      partA: {
        courseTitle: 'SQA',
        courseNumbers: ['SE ZG501'],
        creditModel: { description: '3-1-1' },
        instructors: ['Dr. Test'],
        date: '6 Jan 2026',
        courseDescription: '<p>SQA</p>',
        courseObjectives: [{ code: 'CO1', description: 'X' }],
        textBooks: [{ code: 'T1', citation: 'Y' }],
        referenceBooks: [],
        learningOutcomes: [{ code: 'LO1', description: 'Z' }],
      },
      partB: {
        sessions: [
          { sessionNumber: '1', topicTitle: 'Intro', subTopics: 'a; b', references: ['T1'] },
        ],
      },
      evaluation: {
        legend: 'EC = Evaluation Component',
        components: [
          {
            ecNumber: 'EC-1',
            subComponents: [{ name: 'Final', type: 'Closed', weight: 100, duration: '2h' }],
          },
        ],
        notes: '',
        midSemSyllabus: '',
        compreSyllabus: '',
      },
      importantLinks: {
        elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
        elearnPortalNote: '',
        contactSessionsNote: '',
      },
      evaluationGuidelines: '<p>g</p>',
    };
    chatJsonMock.mockResolvedValue({
      data: goodData,
      tokens: { in: 10, out: 200 },
      model: 'gpt-test',
    });

    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(result.source).toBe('ai');
    expect(result.model).toBe('gpt-test');
    expect(result.data.partA.courseTitle).toBe('SQA');
  });
});

describe('generateStructuredHandoutDraft — AI failure paths (mocked)', () => {
  beforeEach(() => {
    process.env.__TEST_AI_PROVIDER = 'openai';
  });

  it('propagates errors from chatJson (malformed JSON / Zod-invalid) for the action layer to surface', async () => {
    chatJsonMock.mockRejectedValue(new Error('partA.courseObjectives.0.code: Invalid'));
    await expect(generateStructuredHandoutDraft({ handoutId: 'h-1' })).rejects.toThrow(
      /partA\.courseObjectives\.0\.code/,
    );
  });

  it('throws when the handout cannot be loaded', async () => {
    prismaMock.handout.findUnique.mockResolvedValue(null);
    await expect(generateStructuredHandoutDraft({ handoutId: 'missing' })).rejects.toThrow(
      /handout_not_found/,
    );
  });

  it('reuses the cached draft when one exists with structured `payload.data` (within rate-limit window)', async () => {
    const cachedData = { schemaVersion: 1, partA: { courseTitle: 'cached' } } as unknown;
    prismaMock.aIDraftLog.findFirst.mockResolvedValue({
      id: 'cached-1',
      handoutId: 'h-1',
      source: 'ai',
      model: 'cached-model',
      payload: { data: cachedData },
      createdAt: new Date(),
    });

    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(result.source).toBe('cache');
    expect(result.draftId).toBe('cached-1');
    expect(chatJsonMock).not.toHaveBeenCalled();
  });

  it('SKIPS the cache when the cached draft has only legacy `payload.tiptapJson` (no structured data)', async () => {
    prismaMock.aIDraftLog.findFirst.mockResolvedValue({
      id: 'tip-1',
      handoutId: 'h-1',
      source: 'ai',
      model: 'legacy-model',
      payload: { tiptapJson: { type: 'doc' } }, // no .data
      createdAt: new Date(),
    });
    chatJsonMock.mockResolvedValue({
      data: {
        schemaVersion: 1 as const,
        metadata: {
          institutionHeader: 'BITS',
          divisionHeader: 'W',
          semester: 'S',
          documentTitle: 'D',
          formNumber: '',
        },
        partA: {
          courseTitle: 'X',
          courseNumbers: ['Y ZC100'],
          creditModel: { description: '3-1-1' },
          instructors: ['Z'],
          date: '1 Jan 2026',
          courseDescription: '<p>x</p>',
          courseObjectives: [{ code: 'CO1', description: 'x' }],
          textBooks: [{ code: 'T1', citation: 'y' }],
          referenceBooks: [],
          learningOutcomes: [{ code: 'LO1', description: 'z' }],
        },
        partB: {
          sessions: [{ sessionNumber: '1', topicTitle: 't', subTopics: '', references: [] }],
        },
        evaluation: {
          legend: 'L',
          components: [
            {
              ecNumber: 'EC-1',
              subComponents: [{ name: 'F', type: 'C', weight: 100, duration: '2h' }],
            },
          ],
          notes: '',
          midSemSyllabus: '',
          compreSyllabus: '',
        },
        importantLinks: {
          elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
          elearnPortalNote: '',
          contactSessionsNote: '',
        },
        evaluationGuidelines: '<p>g</p>',
      },
      tokens: { in: 1, out: 1 },
      model: 'fresh-model',
    });
    const result = await generateStructuredHandoutDraft({ handoutId: 'h-1' });
    expect(result.source).toBe('ai');
    expect(result.model).toBe('fresh-model');
    expect(chatJsonMock).toHaveBeenCalledTimes(1);
  });
});
