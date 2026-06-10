import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName } from '@hmp/db';
import { bulkAllocate, type BulkActor } from '../bulk-allocate';

/**
 * Integration test for the Prompt 14 bulk-allocation pipeline. Drives the real
 * resolution + `transition(FACULTY_ALLOCATED)` against Postgres. Probe-skips if
 * the DB is unreachable (same convention as bulk-create.test.ts).
 *
 * Stable graph in beforeAll (programme + two semesters); each test mints its own
 * REQUESTED requests (and any pre-existing load) and tears them down in
 * afterEach, so the per-semester cap arithmetic is deterministic.
 */

const prisma = new PrismaClient();
const TAG = `BULKALLOC-${process.pid}-${Date.now()}`;

let dbReady = false;
let cap = 3;
let actor: BulkActor;
let onCampusEmail = '';
let cappedEmail = '';
let smeEmail = '';
let nonFacultyEmail = '';
let cappedFacultyId = '';

const ids: { prog?: string; semA?: string; semB?: string } = {};
const courseIds: string[] = [];
const offeringIds: string[] = [];
const requestIds: string[] = [];
let courseSeq = 0;

async function mkOffering(semesterId: string): Promise<string> {
  courseSeq += 1;
  const n = `BA ZG${900 + courseSeq}`;
  const course = await prisma.course.create({
    data: { bitsCourseNumber: n, code: `${TAG}-${courseSeq}`, title: `${TAG} ${n}` },
  });
  courseIds.push(course.id);
  const off = await prisma.courseOffering.create({ data: { courseId: course.id, semesterId } });
  offeringIds.push(off.id);
  return off.id;
}

/** A request at the given status with its own offering. */
async function mkRequest(
  semesterId: string,
  status: HandoutStatus,
): Promise<{ id: string; refNo: string }> {
  const offeringId = await mkOffering(semesterId);
  const refNo = `${TAG}-R${requestIds.length + 1}`;
  const req = await prisma.handoutRequest.create({
    data: { refNo, courseOfferingId: offeringId, initiatedById: actor.id, status },
    select: { id: true, refNo: true },
  });
  requestIds.push(req.id);
  return req;
}

/** Pre-existing active load: an ALLOCATED request + active FacultyAssignment. */
async function mkLoad(facultyId: string, semesterId: string): Promise<void> {
  const r = await mkRequest(semesterId, HandoutStatus.ALLOCATED);
  await prisma.facultyAssignment.create({
    data: { requestId: r.id, facultyId, facultyType: 'OFF_CAMPUS', active: true },
  });
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [hog, onc, capped, sme] = await Promise.all([
      prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: RoleName.HOG } } } },
        select: { id: true, name: true, email: true },
      }),
      prisma.user.findUniqueOrThrow({
        where: { email: 'faculty@hmp.local' },
        select: { email: true },
      }),
      prisma.user.findUniqueOrThrow({
        where: { email: 'faculty.off@hmp.local' },
        select: { id: true, email: true },
      }),
      prisma.user.findUniqueOrThrow({ where: { email: 'sme@hmp.local' }, select: { email: true } }),
    ]);
    actor = { id: hog.id, name: hog.name, roles: [RoleName.HOG] };
    onCampusEmail = onc.email;
    cappedEmail = capped.email;
    cappedFacultyId = capped.id;
    smeEmail = sme.email;
    nonFacultyEmail = hog.email; // exists, but not a FACULTY / SME user
    cap =
      (await prisma.workflowConfig.findUnique({ where: { key: 'default' } }))
        ?.offCampusMaxCourses ?? 3;

    const prog = await prisma.programme.create({ data: { code: `${TAG}-P`, name: `${TAG} Prog` } });
    const mkSem = (name: string) =>
      prisma.semester.create({
        data: {
          programmeId: prog.id,
          name,
          year: 2099,
          term: 'FIRST',
          startDate: new Date('2099-01-01'),
          endDate: new Date('2099-06-01'),
        },
      });
    const semA = await mkSem(`${TAG}-SemA`);
    const semB = await mkSem(`${TAG}-SemB`);
    Object.assign(ids, { prog: prog.id, semA: semA.id, semB: semB.id });
    dbReady = true;
  } catch (err) {
    dbReady = false;
    console.warn('[bulk-allocate.test] Postgres unreachable or unseeded — probe-skipping.', err);
  }
});

afterEach(async () => {
  if (!dbReady) return;
  for (const id of requestIds) {
    await prisma.notification.deleteMany({ where: { meta: { path: ['requestId'], equals: id } } });
    await prisma.auditLog.deleteMany({ where: { requestId: id } });
    // HandoutRequest delete cascades FacultyAssignment / Approval / SmeAssignment.
    await prisma.handoutRequest.delete({ where: { id } }).catch(() => {});
  }
  requestIds.length = 0;
  await prisma.courseOffering.deleteMany({ where: { id: { in: offeringIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  offeringIds.length = 0;
  courseIds.length = 0;
});

afterAll(async () => {
  if (dbReady) {
    await prisma.semester.deleteMany({ where: { id: { in: [ids.semA!, ids.semB!] } } });
    await prisma.programme.deleteMany({ where: { id: ids.prog! } });
  }
  await prisma.$disconnect();
});

const csvOf = (rows: string[]) =>
  ['request_reference,faculty_emails,sme_email', ...rows].join('\n');

describe('bulkAllocate (Prompt 14)', () => {
  it('allocates valid rows → ALLOCATED + assignments + audit + notification', async () => {
    if (!dbReady) return;
    const r1 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const r2 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(
      csvOf([
        `${r1.refNo},${onCampusEmail},${smeEmail}`,
        `${r2.refNo},${onCampusEmail},${smeEmail}`,
      ]),
      actor,
    );
    expect(res.status).toBe('success');
    if (res.status !== 'success') return;
    expect(res.allocated).toBe(2);

    const status = await prisma.handoutRequest.findUnique({
      where: { refNo: r1.refNo },
      select: { id: true, status: true },
    });
    expect(status?.status).toBe(HandoutStatus.ALLOCATED);
    const fa = await prisma.facultyAssignment.count({ where: { requestId: status!.id } });
    const sa = await prisma.smeAssignment.count({ where: { requestId: status!.id } });
    expect(fa).toBe(1);
    expect(sa).toBe(1);
    const audit = await prisma.auditLog.findFirst({
      where: { requestId: status!.id, action: 'request.allocate.bulk' },
      select: { after: true },
    });
    expect((audit?.after as { bulkSessionId?: string })?.bulkSessionId).toBeTruthy();
    const notif = await prisma.notification.count({
      where: { meta: { path: ['requestId'], equals: status!.id } },
    });
    expect(notif).toBeGreaterThan(0);
  });

  it('shares one bulkSessionId across all rows', async () => {
    if (!dbReady) return;
    const r1 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const r2 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(
      csvOf([
        `${r1.refNo},${onCampusEmail},${smeEmail}`,
        `${r2.refNo},${onCampusEmail},${smeEmail}`,
      ]),
      actor,
    );
    expect(res.status).toBe('success');
    const audits = await prisma.auditLog.findMany({
      where: { requestId: { in: requestIds }, action: 'request.allocate.bulk' },
      select: { after: true },
    });
    const sessions = new Set(
      audits.map((a) => (a.after as { bulkSessionId?: string }).bulkSessionId),
    );
    expect(audits.length).toBe(2);
    expect(sessions.size).toBe(1);
  });

  it('rejects unknown refNo', async () => {
    if (!dbReady) return;
    const res = await bulkAllocate(csvOf([`NOPE-${TAG},${onCampusEmail},${smeEmail}`]), actor);
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.errors[0]!.code).toBe('request_not_found');
  });

  it('rejects a request that is not REQUESTED (with current status)', async () => {
    if (!dbReady) return;
    const r = await mkRequest(ids.semA!, HandoutStatus.ALLOCATED);
    const res = await bulkAllocate(csvOf([`${r.refNo},${onCampusEmail},${smeEmail}`]), actor);
    expect(res.status).toBe('rejected');
    if (res.status !== 'rejected') return;
    expect(res.errors[0]!.code).toBe('request_not_allocatable');
    expect(res.errors[0]!.message).toContain('ALLOCATED');
  });

  it('rejects unknown faculty + faculty without FACULTY role', async () => {
    if (!dbReady) return;
    const r1 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const a = await bulkAllocate(csvOf([`${r1.refNo},ghost@nowhere.local,${smeEmail}`]), actor);
    expect(a.status === 'rejected' && a.errors[0]!.code).toBe('faculty_not_found');
    const r2 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const b = await bulkAllocate(csvOf([`${r2.refNo},${nonFacultyEmail},${smeEmail}`]), actor);
    expect(b.status === 'rejected' && b.errors[0]!.code).toBe('faculty_role_invalid');
  });

  it('rejects empty faculty list + unknown/invalid SME', async () => {
    if (!dbReady) return;
    const r1 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const empty = await bulkAllocate(csvOf([`${r1.refNo},",",${smeEmail}`]), actor);
    expect(empty.status === 'rejected' && empty.errors[0]!.code).toBe('faculty_emails_empty');
    const r2 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const noSme = await bulkAllocate(
      csvOf([`${r2.refNo},${onCampusEmail},ghost@nowhere.local`]),
      actor,
    );
    expect(noSme.status === 'rejected' && noSme.errors[0]!.code).toBe('sme_not_found');
    const r3 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const badSme = await bulkAllocate(
      csvOf([`${r3.refNo},${onCampusEmail},${nonFacultyEmail}`]),
      actor,
    );
    expect(badSme.status === 'rejected' && badSme.errors[0]!.code).toBe('sme_role_invalid');
  });

  it('rejects the same refNo appearing twice (both line numbers)', async () => {
    if (!dbReady) return;
    const r = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(
      csvOf([`${r.refNo},${onCampusEmail},${smeEmail}`, `${r.refNo},${onCampusEmail},${smeEmail}`]),
      actor,
    );
    expect(res.status).toBe('rejected');
    if (res.status !== 'rejected') return;
    expect(res.errors[0]!.code).toBe('duplicate_row_in_file');
    expect(res.errors[0]!.message).toMatch(/Row 3 duplicates row 2/);
  });

  it('off-campus cap: a row that pushes a capped faculty past the per-semester cap is rejected', async () => {
    if (!dbReady) return;
    // Seed existing load = cap in semA, then one more row → cap+1 > cap.
    for (let k = 0; k < cap; k++) await mkLoad(cappedFacultyId, ids.semA!);
    const r = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(csvOf([`${r.refNo},${cappedEmail},${smeEmail}`]), actor);
    expect(res.status).toBe('rejected');
    if (res.status !== 'rejected') return;
    expect(res.errors[0]!.code).toBe('off_campus_cap_exceeded');
    expect(res.errors[0]!.message).toContain(`cap: ${cap}`);
  });

  it('cross-semester non-accumulation: per-semester counting lets the same capped faculty allocate in two semesters', async () => {
    if (!dbReady) return;
    // (cap-1) existing in EACH semester. Global counting would see 2*(cap-1)
    // and reject; per-semester counting sees cap-1 per semester → both pass.
    for (let k = 0; k < cap - 1; k++) await mkLoad(cappedFacultyId, ids.semA!);
    for (let k = 0; k < cap - 1; k++) await mkLoad(cappedFacultyId, ids.semB!);
    const rA = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const rB = await mkRequest(ids.semB!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(
      csvOf([`${rA.refNo},${cappedEmail},${smeEmail}`, `${rB.refNo},${cappedEmail},${smeEmail}`]),
      actor,
    );
    expect(res.status).toBe('success');
    if (res.status === 'success') expect(res.allocated).toBe(2);
  });

  it('is atomic: a mix of valid + invalid rows allocates nothing', async () => {
    if (!dbReady) return;
    const r1 = await mkRequest(ids.semA!, HandoutStatus.REQUESTED);
    const res = await bulkAllocate(
      csvOf([
        `${r1.refNo},${onCampusEmail},${smeEmail}`,
        `NOPE-${TAG},${onCampusEmail},${smeEmail}`,
      ]),
      actor,
    );
    expect(res.status).toBe('rejected');
    const after = await prisma.handoutRequest.findUnique({
      where: { refNo: r1.refNo },
      select: { status: true },
    });
    expect(after?.status).toBe(HandoutStatus.REQUESTED); // untouched
  });

  it('empty (header-only) input succeeds with zero allocated', async () => {
    if (!dbReady) return;
    const res = await bulkAllocate('request_reference,faculty_emails,sme_email', actor);
    expect(res.status).toBe('success');
    if (res.status === 'success') expect(res.allocated).toBe(0);
  });
});
