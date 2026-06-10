import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName } from '@hmp/db';
import { bulkCreateHandouts, type BulkActor } from '../bulk-create';

/**
 * Integration test for the Prompt 13 bulk-create pipeline. Drives the real
 * resolution + `transition()` against Postgres, so it needs a reachable DB +
 * an IC user. Probe-skips otherwise (same convention as sme-review.test.ts).
 *
 * Builds an isolated sentinel graph — two programmes (to prove programme-FIRST
 * semester resolution), a semester under programme A, two courses WITH
 * offerings (sequential-refNo + multi-row cases) and one course WITHOUT an
 * offering — so the dedup + resolution cases are deterministic regardless of
 * what else is in the dev DB. All sentinel rows are torn down in afterAll.
 */

const prisma = new PrismaClient();
const TAG = `BULK-${process.pid}-${Date.now()}`;

let dbReady = false;
let actor: BulkActor;
// Sentinel identifiers used to build CSV rows.
const PA = `${TAG}-PA`; // programme A (has the semester + offerings)
const PB = `${TAG}-PB`; // programme B (NO such semester — programme-first proof)
const SEM = `${TAG}-SemA`;
const C1 = `BLK ZG901`;
const C2 = `BLK ZG902`;
const C3 = `BLK ZG903`; // course with NO offering

const ids: {
  progA?: string;
  progB?: string;
  sem?: string;
  c1?: string;
  c2?: string;
  c3?: string;
  off1?: string;
  off2?: string;
} = {};
const createdRequestIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ic = await prisma.user.findFirst({
      where: { roles: { some: { role: { name: RoleName.INSTRUCTION_CELL } } } },
      select: { id: true, name: true },
    });
    if (!ic) throw new Error('no IC user');
    actor = { id: ic.id, name: ic.name, roles: [RoleName.INSTRUCTION_CELL] };

    const progA = await prisma.programme.create({ data: { code: PA, name: `${TAG} Programme A` } });
    const progB = await prisma.programme.create({ data: { code: PB, name: `${TAG} Programme B` } });
    const sem = await prisma.semester.create({
      data: {
        programmeId: progA.id,
        name: SEM,
        year: 2099,
        term: 'FIRST',
        startDate: new Date('2099-01-01'),
        endDate: new Date('2099-06-01'),
      },
    });
    const mkCourse = (n: string) =>
      prisma.course.create({ data: { bitsCourseNumber: n, code: n, title: `${TAG} ${n}` } });
    const c1 = await mkCourse(C1);
    const c2 = await mkCourse(C2);
    const c3 = await mkCourse(C3);
    const off1 = await prisma.courseOffering.create({
      data: { courseId: c1.id, semesterId: sem.id },
    });
    const off2 = await prisma.courseOffering.create({
      data: { courseId: c2.id, semesterId: sem.id },
    });
    Object.assign(ids, {
      progA: progA.id,
      progB: progB.id,
      sem: sem.id,
      c1: c1.id,
      c2: c2.id,
      c3: c3.id,
      off1: off1.id,
      off2: off2.id,
    });
    dbReady = true;
  } catch (err) {
    dbReady = false;
    console.warn('[bulk-create.test] Postgres unreachable or unseeded — probe-skipping.', err);
  }
});

afterEach(async () => {
  if (!dbReady) return;
  for (const id of createdRequestIds) {
    // Notification rows reference the request via meta.requestId (no FK), so
    // they must be cleaned explicitly — the notify path fires inline here.
    await prisma.notification.deleteMany({ where: { meta: { path: ['requestId'], equals: id } } });
    await prisma.auditLog.deleteMany({ where: { requestId: id } });
    await prisma.approval.deleteMany({ where: { requestId: id } });
    await prisma.handoutRequest.delete({ where: { id } }).catch(() => {});
  }
  createdRequestIds.length = 0;
});

afterAll(async () => {
  if (dbReady) {
    // Order matters: offerings → courses + semester → programmes (FK Restrict).
    await prisma.courseOffering.deleteMany({ where: { id: { in: [ids.off1!, ids.off2!] } } });
    await prisma.course.deleteMany({ where: { id: { in: [ids.c1!, ids.c2!, ids.c3!] } } });
    await prisma.semester.deleteMany({ where: { id: ids.sem! } });
    await prisma.programme.deleteMany({ where: { id: { in: [ids.progA!, ids.progB!] } } });
  }
  await prisma.$disconnect();
});

// Track + assert helper: run the pipeline, record any created requests for cleanup.
async function run(csv: string) {
  const r = await bulkCreateHandouts(csv, actor);
  if (r.status === 'success' || r.status === 'partial') {
    const created = await prisma.handoutRequest.findMany({
      where: { refNo: { in: r.refNos } },
      select: { id: true },
    });
    createdRequestIds.push(...created.map((c) => c.id));
  }
  return r;
}

describe('bulkCreateHandouts (Prompt 13)', () => {
  it('creates N requests at REQUESTED with sequential refNos (all valid)', async () => {
    if (!dbReady) return;
    const csv = `programme_code,course_code,semester
${PA},${C1},${SEM}
${PA},${C2},${SEM}`;
    const r = await run(csv);
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    expect(r.created).toBe(2);
    expect(r.refNos).toHaveLength(2);
    // Sequential: the two refNos differ by 1 in their trailing counter.
    const nums = r.refNos
      .map((x) => parseInt(x.slice(x.lastIndexOf('-') + 1), 10))
      .sort((a, b) => a - b);
    expect(nums[1]! - nums[0]!).toBe(1);
    const created = await prisma.handoutRequest.findMany({
      where: { refNo: { in: r.refNos } },
      select: { id: true, status: true },
    });
    expect(created.every((x) => x.status === HandoutStatus.REQUESTED)).toBe(true);

    // Notification side-effect (Risk 7): REQUEST_INITIATED fired notifyTransition
    // per row (handout.requested). In-portal rows are written inline (Redis
    // down → dispatchOrEnqueue runs synchronously), assertable without Mailhog.
    let notifs = 0;
    for (const c of created) {
      notifs += await prisma.notification.count({
        where: { meta: { path: ['requestId'], equals: c.id } },
      });
    }
    expect(notifs).toBeGreaterThan(0);
  });

  it('writes one request.create.bulk audit per row, sharing a bulkSessionId', async () => {
    if (!dbReady) return;
    const csv = `programme_code,course_code,semester
${PA},${C1},${SEM}
${PA},${C2},${SEM}`;
    const r = await run(csv);
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    const created = await prisma.handoutRequest.findMany({
      where: { refNo: { in: r.refNos } },
      select: { id: true },
    });
    const audits = await prisma.auditLog.findMany({
      where: { requestId: { in: created.map((c) => c.id) }, action: 'request.create.bulk' },
      select: { after: true },
    });
    expect(audits).toHaveLength(2);
    const sessionIds = new Set(
      audits.map((a) => (a.after as { bulkSessionId?: string }).bulkSessionId),
    );
    expect(sessionIds.size).toBe(1);
    expect([...sessionIds][0]).toBeTruthy();
  });

  it('rejects unknown programme — no writes', async () => {
    if (!dbReady) return;
    const before = await prisma.handoutRequest.count();
    const r = await run(`programme_code,course_code,semester\nNOPE-${TAG},${C1},${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('programme_not_found');
    expect(await prisma.handoutRequest.count()).toBe(before);
  });

  it('rejects unknown course', async () => {
    if (!dbReady) return;
    const r = await run(`programme_code,course_code,semester\n${PA},ZZ ZG999,${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('course_not_found');
  });

  it('proves programme-FIRST resolution: a semester that exists only under another programme fails', async () => {
    if (!dbReady) return;
    // SEM exists under programme A only. Asking for it under programme B must
    // fail (a name-only global lookup would wrongly find it).
    const r = await run(`programme_code,course_code,semester\n${PB},${C1},${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('semester_not_found');
  });

  it('rejects a course with no offering in the semester', async () => {
    if (!dbReady) return;
    const r = await run(`programme_code,course_code,semester\n${PA},${C3},${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('no_course_offering_for_programme_course_pair');
  });

  it('rejects a duplicate active request (reports the existing refNo)', async () => {
    if (!dbReady) return;
    const first = await run(`programme_code,course_code,semester\n${PA},${C1},${SEM}`);
    expect(first.status).toBe('success');
    const r = await run(`programme_code,course_code,semester\n${PA},${C1},${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('duplicate_active_request_exists');
    if (first.status === 'success') expect(r.errors[0]!.message).toContain(first.refNos[0]!);
  });

  it('rejects two file rows resolving to the same offering (with both line numbers)', async () => {
    if (!dbReady) return;
    const r = await run(
      `programme_code,course_code,semester\n${PA},${C1},${SEM}\n${PA},${C1},${SEM}`,
    );
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('duplicate_row_in_file');
    expect(r.errors[0]!.message).toMatch(/Row 3 duplicates row 2/);
  });

  it('is atomic: a mix of valid + invalid rows creates nothing', async () => {
    if (!dbReady) return;
    const before = await prisma.handoutRequest.count();
    const r = await run(`programme_code,course_code,semester
${PA},${C1},${SEM}
${PA},ZZ ZG999,${SEM}`);
    expect(r.status).toBe('rejected');
    expect(await prisma.handoutRequest.count()).toBe(before);
  });

  it('empty (header-only) input succeeds with zero created', async () => {
    if (!dbReady) return;
    const r = await run(`programme_code,course_code,semester`);
    expect(r.status).toBe('success');
    if (r.status !== 'success') return;
    expect(r.created).toBe(0);
  });

  it('rejects a malformed CSV (missing required column) as invalid_csv_format', async () => {
    if (!dbReady) return;
    const r = await run(`programme_code,semester\n${PA},${SEM}`);
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.errors[0]!.code).toBe('invalid_csv_format');
    expect(r.rejectedCsv).toContain('_error_code');
  });
});
