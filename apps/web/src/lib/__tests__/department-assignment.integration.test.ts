import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import { applyHogBackfill, previewHogBackfill } from '../hog-backfill';
import { changeHogOrPc } from '../request-handover';
import { emailsSettled, notifyTransition } from '../notifications';
import { requestVisibleTo } from '../request-scope';

// v1.4.1 — department HOG backfill (H4), change HOG, "only that HOG is told", and the scope check, on
// the real database with its own sentinel department / people / programme (removed afterwards).
// DB-touching; skipped without DATABASE_URL.

const hasDb = !!process.env.DATABASE_URL;
const TAG = `dassign${process.pid}${Date.now() % 100000}`;
const REF = `HMP-7451-`;

describe.skipIf(!hasDb)('v1.4.1 department assignment (real DB)', () => {
  const ids: Record<string, string> = {};

  async function removeTestData() {
    const reqs = await prisma.handoutRequest.findMany({
      where: { refNo: { startsWith: REF } },
      select: { id: true },
    });
    const reqIds = reqs.map((r) => r.id);
    await prisma.notification.deleteMany({
      where: { OR: reqIds.map((id) => ({ meta: { path: ['requestId'], equals: id } })) },
    });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ requestId: { in: reqIds } }, { entityId: { in: reqIds } }] },
    });
    await prisma.handoutRequest.deleteMany({ where: { id: { in: reqIds } } });
    await prisma.courseOffering.deleteMany({ where: { course: { code: { startsWith: 'DAS ' } } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: 'DAS ' } } });
    await prisma.semester.deleteMany({ where: { programme: { code: { startsWith: 'DAS-' } } } });
    await prisma.programme.deleteMany({ where: { code: { startsWith: 'DAS-' } } });
    const users = await prisma.user.findMany({
      where: { email: { contains: `.${TAG}@` } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.department.deleteMany({ where: { code: { startsWith: 'DAS' } } });
  }

  const person = async (who: string, role: RoleName, departmentId: string | null) => {
    const r = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    return prisma.user.create({
      data: {
        email: `${who}.${TAG}@hmp.local`,
        name: `DAS ${who}`,
        departmentId,
        roles: { create: { roleId: r.id } },
      },
    });
  };

  beforeAll(async () => {
    await removeTestData();
    const a = await prisma.department.create({ data: { code: 'DASA', name: 'DAS Dept A' } });
    const b = await prisma.department.create({ data: { code: 'DASB', name: 'DAS Dept B' } });
    const c = await prisma.department.create({
      data: { code: 'DASC', name: 'DAS Dept C (no HOG)' },
    });
    Object.assign(ids, { a: a.id, b: b.id, c: c.id });
    ids.hogA = (await person('hoga', RoleName.HOG, a.id)).id;
    ids.hogB = (await person('hogb', RoleName.HOG, b.id)).id;
    ids.ic = (await person('ic', RoleName.INSTRUCTION_CELL, null)).id;
    const mk = async (code: string, departmentId: string | null, n: number) => {
      const prog = await prisma.programme.create({
        data: {
          code: `DAS-${code}`,
          name: `DAS ${code}`,
          departmentId,
          semesters: {
            create: {
              name: 'Sem-I 2099-00',
              year: 2099,
              term: 'FIRST',
              startDate: new Date('2099-08-01'),
              endDate: new Date('2099-12-01'),
            },
          },
        },
        include: { semesters: true },
      });
      const course = await prisma.course.create({
        data: { code: `DAS ZG${n}`, bitsCourseNumber: `DAS ZG${n}`, title: `DAS course ${n}` },
      });
      const off = await prisma.courseOffering.create({
        data: { courseId: course.id, semesterId: prog.semesters[0]!.id },
      });
      const req = await prisma.handoutRequest.create({
        data: {
          refNo: `${REF}${String(n).padStart(4, '0')}`,
          courseOfferingId: off.id,
          initiatedById: ids.ic!,
          status: HandoutStatus.REQUESTED,
        },
      });
      return req.id;
    };
    ids.reqA = await mk('A', a.id, 1);
    ids.reqUnknown = await mk('U', null, 2);
    ids.reqNoHog = await mk('C', c.id, 3);
  });

  afterAll(async () => {
    await emailsSettled();
    await removeTestData();
  });

  const only = () => [ids.reqA!, ids.reqUnknown!, ids.reqNoHog!];

  it('H4 preview: who gets whom, and what can’t be assigned and why', async () => {
    const p = await previewHogBackfill(only());
    expect(p.assign).toEqual([expect.objectContaining({ requestId: ids.reqA, hogId: ids.hogA })]);
    expect(p.skipped.map((s) => [s.requestId, s.reason])).toEqual([
      [ids.reqUnknown, 'department-unknown'],
      [ids.reqNoHog, 'no-hog'],
    ]);
  });

  it('scope: HOG B can’t see A’s request; everyone sees the department-unknown one', async () => {
    const hogB = { id: ids.hogB!, roles: [RoleName.HOG], departmentId: ids.b! };
    const hogA = { id: ids.hogA!, roles: [RoleName.HOG], departmentId: ids.a! };
    expect(await requestVisibleTo(hogA, ids.reqA)).toBe(true);
    expect(await requestVisibleTo(hogB, ids.reqA)).toBe(false);
    expect(await requestVisibleTo(hogB, ids.reqUnknown)).toBe(true);
    expect(await requestVisibleTo({ ...hogB, departmentId: null }, ids.reqA)).toBe(true); // H9
  });

  it('before a HOG is recorded, the department’s HOG is told — not the other department’s', async () => {
    await notifyTransition({
      requestId: ids.reqA!,
      event: 'REQUEST_INITIATED',
      actor: { id: ids.ic!, name: 'DAS ic' },
    });
    const told = await prisma.notification.findMany({
      where: { meta: { path: ['requestId'], equals: ids.reqA } },
      select: { userId: true },
    });
    const userIds = new Set(told.map((n) => n.userId));
    expect(userIds.has(ids.hogA!)).toBe(true);
    expect(userIds.has(ids.hogB!)).toBe(false);
  });

  it('H4 apply: writes the HOG once; running again changes nothing', async () => {
    expect(await applyHogBackfill(ids.ic!, only())).toEqual({ assigned: 1, skipped: 2 });
    const rows = () =>
      prisma.requestAssignee.findMany({
        where: { requestId: ids.reqA, role: RoleName.HOG },
        select: { userId: true, endedAt: true },
      });
    expect(await rows()).toEqual([{ userId: ids.hogA, endedAt: null }]);
    expect(await applyHogBackfill(ids.ic!, only())).toEqual({ assigned: 0, skipped: 2 });
    expect(await rows()).toHaveLength(1);
    expect(
      await prisma.auditLog.count({ where: { requestId: ids.reqA, action: 'request.assign-hog' } }),
    ).toBe(1);
  });

  it('change HOG with a reason: history kept, both told, the new HOG now sees it', async () => {
    const before = await prisma.notification.count({ where: { userId: ids.hogB } });
    expect(
      (
        await changeHogOrPc({
          requestId: ids.reqA!,
          role: 'HOG',
          toUserId: ids.hogB!,
          reason: 'x',
          actor: { id: ids.ic!, name: 'DAS ic' },
        })
      ).ok,
    ).toBe(false); // a reason is required
    const r = await changeHogOrPc({
      requestId: ids.reqA!,
      role: 'HOG',
      toUserId: ids.hogB!,
      reason: 'HOG A is on leave',
      actor: { id: ids.ic!, name: 'DAS ic' },
    });
    expect(r).toEqual({ ok: true });
    const rows = await prisma.requestAssignee.findMany({
      where: { requestId: ids.reqA, role: RoleName.HOG },
      orderBy: { assignedAt: 'asc' },
      select: { userId: true, endedAt: true, reason: true },
    });
    expect(rows.map((x) => [x.userId, x.endedAt === null])).toEqual([
      [ids.hogA, false],
      [ids.hogB, true],
    ]);
    expect(rows[1]!.reason).toBe('HOG A is on leave');
    // The notification rows are written at once; the emails go out in the background.
    expect(await prisma.notification.count({ where: { userId: ids.hogB } })).toBeGreaterThan(
      before,
    );
    expect(
      await prisma.notification.count({
        where: { userId: ids.hogA, meta: { path: ['kind'], equals: 'request.reassign' } },
      }),
    ).toBeGreaterThan(0);
    const hogB = { id: ids.hogB!, roles: [RoleName.HOG], departmentId: ids.b! };
    expect(await requestVisibleTo(hogB, ids.reqA)).toBe(true); // personally on it now
  });
});
