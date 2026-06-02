import { describe, it, expect, vi } from 'vitest';
import { HandoutStatus, type Prisma, type BitsHandoutV1 } from '@hmp/db';
import {
  resolveAutoFetchSource,
  stripIdentifiersForCarryForward,
  loadAndResolveAutoFetchSource,
  type RequestLite,
  type PriorVersionCandidate,
  type ImportCandidate,
} from './handout-auto-fetch';

// ---- Test fixtures ----

const seZG501Request: RequestLite = {
  id: 'req-1',
  course: {
    id: 'course-se',
    bitsCourseNumber: 'SE ZG501',
    alternateCodes: [],
    title: 'Software Quality Assurance and Testing',
  },
  semesterName: 'Sem-II 2025-26',
  facultyName: 'Dr. Test Faculty',
};

const csiZC447Request: RequestLite = {
  id: 'req-2',
  course: {
    id: 'course-csi',
    bitsCourseNumber: 'CSI ZC447',
    alternateCodes: ['ES ZC447', 'IS ZC447', 'SS ZC447'],
    title: 'Data Storage Technology and Networks',
  },
  semesterName: 'Sem-II 2025-26',
  facultyName: 'Dr. Cross Listed',
};

function richPrior(courseNumber: string, semester: string): BitsHandoutV1 {
  return {
    schemaVersion: 1,
    metadata: {
      institutionHeader: 'BITS Pilani',
      divisionHeader: 'WILP',
      semester,
      documentTitle: 'Digital Learning Handout',
      formNumber: 'F-IS-7.3',
    },
    partA: {
      courseTitle: 'Prior Course Title',
      courseNumbers: [courseNumber],
      creditModel: { description: '4-1-1' },
      instructors: ['Prof. Last Semester'],
      date: '15/01/2025',
      courseDescription: '<p>Course on storage networks.</p>',
      courseObjectives: [{ code: 'CO1', description: 'Understand storage networks' }],
      textBooks: [{ code: 'T1', citation: 'Storage Networks: The Complete Reference' }],
      referenceBooks: [{ code: 'R1', citation: 'Information Storage and Management' }],
      learningOutcomes: [{ code: 'LO1', description: 'Design SANs' }],
    },
    partB: {
      sessions: [
        {
          sessionNumber: '1',
          topicTitle: 'Intro to SAN',
          subTopics: 'iSCSI; FC',
          references: ['T1 Ch.1'],
        },
        { sessionNumber: '2-3', topicTitle: 'NAS', subTopics: 'NFS; SMB', references: ['T1 Ch.2'] },
      ],
    },
    evaluation: {
      legend: 'EC = Evaluation Component',
      components: [
        {
          ecNumber: 'EC-1',
          subComponents: [
            { name: 'Quiz', type: 'Online', weight: 5, duration: '15m' },
            { name: 'Assignment', type: 'Take-home', weight: 25, duration: '' },
          ],
        },
        {
          ecNumber: 'EC-2',
          subComponents: [{ name: 'Mid-Sem', type: 'Closed', weight: 30, duration: '90m' }],
        },
        {
          ecNumber: 'EC-3',
          subComponents: [{ name: 'Compre', type: 'Open', weight: 40, duration: '180m' }],
        },
      ],
      notes: 'Make-up policy: see student handbook.',
      midSemSyllabus: 'Sessions 1-8',
      compreSyllabus: 'All sessions',
    },
    importantLinks: {
      elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
      elearnPortalNote: '',
      contactSessionsNote: '',
    },
    evaluationGuidelines: '<p>Guidelines.</p>',
  };
}

function priorCandidate(
  courseNumber: string,
  semester: string,
  daysAgo: number,
): PriorVersionCandidate {
  return {
    versionId: `v-${courseNumber}-${semester}`,
    data: richPrior(courseNumber, semester),
    courseBitsNumber: courseNumber,
    semesterName: semester,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
  };
}

// ---- Tier-resolution tests ----

describe('resolveAutoFetchSource — tier picking', () => {
  it('empty candidates → tier "empty" with "Empty template" detail', () => {
    const result = resolveAutoFetchSource(seZG501Request, [], null);
    expect(result.tier).toBe('empty');
    expect(result.sourceDetail).toBe('Empty template');
    // The empty data should still be Zod-valid (blankHandoutForRequest does that),
    // and Part A should reflect the current request context, not blanks.
    expect(result.data.partA.courseTitle).toBe('Software Quality Assurance and Testing');
    expect(result.data.partA.courseNumbers).toEqual(['SE ZG501']);
  });

  it('one prior version, same course → tier "prior-version" with semester+code detail', () => {
    const candidates = [priorCandidate('SE ZG501', 'Sem-I 2024-25', 200)];
    const result = resolveAutoFetchSource(seZG501Request, candidates, null);
    expect(result.tier).toBe('prior-version');
    expect(result.sourceDetail).toBe('Prior version: Sem-I 2024-25 handout for SE ZG501');
    if (result.tier === 'prior-version') {
      expect(result.versionId).toBe('v-SE ZG501-Sem-I 2024-25');
    }
  });

  it('cross-listed prior → tier "prior-version" detail names the PRIOR code, not the current', () => {
    // CSI ZC447's request finds an ES ZC447 prior. The banner must show
    // "for ES ZC447" so faculty sees the cross-listing match explicitly.
    const candidates = [priorCandidate('ES ZC447', 'Sem-I 2024-25', 300)];
    const result = resolveAutoFetchSource(csiZC447Request, candidates, null);
    expect(result.tier).toBe('prior-version');
    expect(result.sourceDetail).toBe('Prior version: Sem-I 2024-25 handout for ES ZC447');
    if (result.tier === 'prior-version') {
      expect(result.versionId).toBe('v-ES ZC447-Sem-I 2024-25');
    }
  });

  it('multiple priors → caller pre-sorted; resolver picks index 0', () => {
    // Caller orders by createdAt desc; resolver trusts that ordering.
    const candidates = [
      priorCandidate('SE ZG501', 'Sem-I 2024-25', 200), // most recent — wins
      priorCandidate('SE ZG501', 'Sem-II 2023-24', 500),
      priorCandidate('SE ZG501', 'Sem-I 2023-24', 700),
    ];
    const result = resolveAutoFetchSource(seZG501Request, candidates, null);
    expect(result.sourceDetail).toContain('Sem-I 2024-25');
  });

  it('prior + import both present → prior wins (Tier 1 beats Tier 2)', () => {
    const candidates = [priorCandidate('SE ZG501', 'Sem-I 2024-25', 200)];
    const importCandidate: ImportCandidate = {
      importId: 'imp-1',
      data: richPrior('SE ZG501', 'archived'),
      originalSemesterName: 'Sem-I 2022-23',
      originalCourseBitsNumber: 'SE ZG501',
    };
    const result = resolveAutoFetchSource(seZG501Request, candidates, importCandidate);
    expect(result.tier).toBe('prior-version');
  });

  it('import only (no prior) → tier "import"', () => {
    const importCandidate: ImportCandidate = {
      importId: 'imp-2',
      data: richPrior('SE ZG501', 'archived'),
      originalSemesterName: 'Sem-I 2022-23',
      originalCourseBitsNumber: 'SE ZG501',
    };
    const result = resolveAutoFetchSource(seZG501Request, [], importCandidate);
    expect(result.tier).toBe('import');
    expect(result.sourceDetail).toBe('Imported corpus handout: Sem-I 2022-23');
    if (result.tier === 'import') {
      expect(result.importId).toBe('imp-2');
    }
  });
});

// ---- Strip-identifiers tests ----

describe('stripIdentifiersForCarryForward', () => {
  it('resets date, instructors, semester, formNumber, courseNumbers', () => {
    const prior = richPrior('SE ZG501', 'Sem-I 2024-25');
    const stripped = stripIdentifiersForCarryForward(prior, csiZC447Request);
    // Reset fields:
    expect(stripped.partA.instructors).toEqual(['Dr. Cross Listed']);
    expect(stripped.metadata.semester).toBe('Sem-II 2025-26');
    expect(stripped.metadata.formNumber).toBe('');
    expect(stripped.partA.courseNumbers).toEqual(['CSI ZC447', 'ES ZC447', 'IS ZC447', 'SS ZC447']);
    // Date is today in dd/mm/yyyy format
    const today = new Date().toLocaleDateString('en-GB');
    expect(stripped.partA.date).toBe(today);
  });

  it('preserves content sections (objectives, books, sessions, evaluation INCLUDING weights)', () => {
    const prior = richPrior('SE ZG501', 'Sem-I 2024-25');
    const stripped = stripIdentifiersForCarryForward(prior, seZG501Request);

    expect(stripped.partA.courseDescription).toBe(prior.partA.courseDescription);
    expect(stripped.partA.courseObjectives).toEqual(prior.partA.courseObjectives);
    expect(stripped.partA.learningOutcomes).toEqual(prior.partA.learningOutcomes);
    expect(stripped.partA.textBooks).toEqual(prior.partA.textBooks);
    expect(stripped.partA.referenceBooks).toEqual(prior.partA.referenceBooks);
    expect(stripped.partB.sessions).toEqual(prior.partB.sessions);
    // Evaluation weights MUST carry forward — faculty reviews and confirms;
    // banner reminds them to adjust if grading policy changed institutionally.
    expect(stripped.evaluation.components).toEqual(prior.evaluation.components);
    expect(stripped.evaluationGuidelines).toBe(prior.evaluationGuidelines);
  });

  it('inherited evaluation weights still sum to 100 (smoke check via the test fixture)', () => {
    const prior = richPrior('SE ZG501', 'Sem-I 2024-25');
    const stripped = stripIdentifiersForCarryForward(prior, seZG501Request);
    const total = stripped.evaluation.components.reduce(
      (s, ec) => s + ec.subComponents.reduce((ss, sc) => ss + sc.weight, 0),
      0,
    );
    expect(total).toBe(100);
  });
});

// ---- DB wrapper: query shape ----

function mockTx(findManyImpl: (...args: unknown[]) => Promise<unknown[]>) {
  const findMany = vi.fn(findManyImpl);
  const tx = {
    handoutVersion: { findMany },
  } as unknown as Prisma.TransactionClient;
  return { tx, findMany };
}

describe('loadAndResolveAutoFetchSource — query shape', () => {
  it('builds a single merged handout clause (status filter + nested course match)', async () => {
    // Regression guard for the duplicate-`handout:`-key trap. If two
    // `handout:` keys were used in the where clause, the second would
    // silently overwrite the first and drafts-in-progress would leak in.
    const { tx, findMany } = mockTx(async () => []);
    await loadAndResolveAutoFetchSource(tx, seZG501Request);

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]![0]! as {
      where: {
        handout: {
          status: { in: HandoutStatus[] };
          request: { offering: { course: { OR: unknown[] } } };
        };
      };
    };
    // The merged shape — one handout: key with BOTH the status filter AND
    // the request.offering.course.OR nested clause.
    expect(args.where.handout.status.in).toEqual([HandoutStatus.PUBLISHED, HandoutStatus.ARCHIVED]);
    expect(args.where.handout.request.offering.course.OR).toBeDefined();
    expect(Array.isArray(args.where.handout.request.offering.course.OR)).toBe(true);
  });

  it('symmetric overlap: query OR matches by bitsCourseNumber IN OR alternateCodes hasSome', async () => {
    const { tx, findMany } = mockTx(async () => []);
    await loadAndResolveAutoFetchSource(tx, csiZC447Request);

    const args = findMany.mock.calls[0]![0]! as {
      where: {
        handout: {
          request: {
            offering: {
              course: {
                OR: [
                  { bitsCourseNumber: { in: string[] } },
                  { alternateCodes: { hasSome: string[] } },
                ];
              };
            };
          };
        };
      };
    };
    const or = args.where.handout.request.offering.course.OR;
    const currentCodes = ['CSI ZC447', 'ES ZC447', 'IS ZC447', 'SS ZC447'];
    expect(or[0]!.bitsCourseNumber.in).toEqual(currentCodes);
    expect(or[1]!.alternateCodes.hasSome).toEqual(currentCodes);
  });

  it('falls through to "empty" when findMany returns no rows', async () => {
    const { tx } = mockTx(async () => []);
    const result = await loadAndResolveAutoFetchSource(tx, seZG501Request);
    expect(result.tier).toBe('empty');
  });

  it('skips rows whose data fails Zod parsing (defensive against pre-11a legacy rows)', async () => {
    const { tx } = mockTx(async () => [
      {
        id: 'v-broken',
        data: { schemaVersion: 1, partA: { courseTitle: 'incomplete' } }, // missing required fields
        createdAt: new Date(),
        handout: {
          request: {
            offering: {
              course: { bitsCourseNumber: 'SE ZG501' },
              semester: { name: 'Sem-I 2023-24' },
            },
          },
        },
      },
    ]);
    const result = await loadAndResolveAutoFetchSource(tx, seZG501Request);
    // The broken row was skipped — no usable candidates remain → empty.
    expect(result.tier).toBe('empty');
  });

  it('picks the most-recent valid row from the findMany result', async () => {
    const validPrior = richPrior('SE ZG501', 'Sem-I 2024-25');
    const { tx } = mockTx(async () => [
      {
        id: 'v-good',
        data: validPrior,
        createdAt: new Date('2025-06-01'),
        handout: {
          request: {
            offering: {
              course: { bitsCourseNumber: 'SE ZG501' },
              semester: { name: 'Sem-I 2024-25' },
            },
          },
        },
      },
    ]);
    const result = await loadAndResolveAutoFetchSource(tx, seZG501Request);
    expect(result.tier).toBe('prior-version');
    expect(result.sourceDetail).toBe('Prior version: Sem-I 2024-25 handout for SE ZG501');
  });
});
