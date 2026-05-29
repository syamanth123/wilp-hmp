import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@hmp/db';
import { createRequestWithRefNo } from '../ref-no';

// DB-touching integration test. Skipped when DATABASE_URL is unset (e.g. on
// devs without a local Postgres). CI sets it explicitly.
const hasDb = Boolean(process.env.DATABASE_URL);

// Use a far-future year so we don't collide with any real refNos in the
// dev/CI database. Cleaned up in afterAll.
const TEST_YEAR = 9999;
const TEST_PREFIX = `HMP-${TEST_YEAR}-`;
const TEST_SEED_TAG = '__refno_concurrent_test__';
// Canonical-form fake code that survives the post-Prompt-11b schema. Passes
// normalizeBitsCourseNumber (TST is a 3-letter prefix; ZC + 3 digits).
const TEST_BITS_COURSE = 'TST ZC000';

describe.skipIf(!hasDb)('createRequestWithRefNo — concurrent', () => {
  let offeringId: string;
  let userId: string;

  beforeAll(async () => {
    // Use upsert-ish create-if-missing with deterministic codes so reruns are safe.
    const programme = await prisma.programme.upsert({
      where: { code: `${TEST_SEED_TAG}-prog` },
      update: {},
      create: { code: `${TEST_SEED_TAG}-prog`, name: 'Concurrent Test Programme' },
    });
    const semester = await prisma.semester.upsert({
      where: { programmeId_name: { programmeId: programme.id, name: 'Concurrent-Test-Sem' } },
      update: {},
      create: {
        programmeId: programme.id,
        name: 'Concurrent-Test-Sem',
        year: TEST_YEAR,
        term: 'FIRST',
        startDate: new Date(`${TEST_YEAR}-01-01`),
        endDate: new Date(`${TEST_YEAR}-06-30`),
      },
    });
    const course = await prisma.course.upsert({
      where: { bitsCourseNumber: TEST_BITS_COURSE },
      update: {},
      create: {
        bitsCourseNumber: TEST_BITS_COURSE,
        code: TEST_BITS_COURSE,
        title: 'Concurrent Test Course',
        credits: 3,
      },
    });
    const offering = await prisma.courseOffering.upsert({
      where: { courseId_semesterId: { courseId: course.id, semesterId: semester.id } },
      update: {},
      create: { courseId: course.id, semesterId: semester.id },
    });
    offeringId = offering.id;

    const user = await prisma.user.upsert({
      where: { email: `${TEST_SEED_TAG}@hmp.local` },
      update: {},
      create: { email: `${TEST_SEED_TAG}@hmp.local`, name: 'Concurrent Test User' },
    });
    userId = user.id;

    // Wipe any stale rows from a previous run in the test year.
    await prisma.handoutRequest.deleteMany({
      where: { refNo: { startsWith: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    await prisma.handoutRequest.deleteMany({
      where: { refNo: { startsWith: TEST_PREFIX } },
    });
    await prisma.courseOffering
      .deleteMany({ where: { course: { bitsCourseNumber: TEST_BITS_COURSE } } })
      .catch(() => {});
    await prisma.course
      .deleteMany({ where: { bitsCourseNumber: TEST_BITS_COURSE } })
      .catch(() => {});
    await prisma.semester.deleteMany({ where: { name: 'Concurrent-Test-Sem' } }).catch(() => {});
    await prisma.programme.deleteMany({ where: { code: `${TEST_SEED_TAG}-prog` } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: `${TEST_SEED_TAG}@hmp.local` } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('10 concurrent creates produce 10 unique sequential refNos with no gaps', async () => {
    const N = 10;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        createRequestWithRefNo({
          courseOfferingId: offeringId,
          initiatedById: userId,
          notes: null,
          previousHandoutUrl: null,
          year: TEST_YEAR,
        }),
      ),
    );

    expect(results).toHaveLength(N);

    const refNos = results.map((r) => r.refNo).sort();
    const unique = new Set(refNos);
    expect(unique.size).toBe(N);

    // Every refNo must match the format and be in [1..N].
    const seqs = refNos.map((rn) => {
      expect(rn).toMatch(/^HMP-9999-\d{4}$/);
      return parseInt(rn.slice(TEST_PREFIX.length), 10);
    });
    seqs.sort((a, b) => a - b);
    // Sequential — no gaps. (Sequence may not start at 1 if a prior test run
    // left rows behind and beforeAll's delete failed, but the seqs MUST be
    // contiguous within this batch.)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]! - seqs[i - 1]!).toBe(1);
    }
  });
});
