import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import {
  DEADLINE_SELECT,
  currentDeadline,
  deadlineInput,
  loadDeadlineConfig,
  formatDueDay,
} from '../deadlines';
import { planRun } from '../escalation';
import { claimRun, sendReminders } from '../daily-run';
import { requestVisibleTo } from '../request-scope';
import { actingFor } from '../backup-access';
import { loadMyWork } from '../my-work';
import { existingRequests } from '../duplicate-guard';
import { savePerson } from '../people-save';
import { lastUndoable, undoPersonChange } from '../people-undo';
import { dispatchComment, emailsSettled } from '../notifications';
import { autoPublish } from '../auto-publish';

// v1.4.2 — due dates, the daily run (once per step), back-up access, undo, duplicate guard, @mentions, on
// the real database with its own sentinel department / people / programme (removed before and after).
// The daily run here is limited to this test's requests (planRun / sendReminders `only`), so it never
// reminds anyone else. DB-touching; skipped without DATABASE_URL.

const hasDb = !!process.env.DATABASE_URL;
const TAG = `wload${process.pid}${Date.now() % 100000}`;
const REF = 'HMP-7452-';
const DAY = 86_400_000;

describe.skipIf(!hasDb)('v1.4.2 workload (real DB)', () => {
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
    await prisma.taxilaPublishItem.deleteMany({ where: { requestId: { in: reqIds } } });
    await prisma.handoutRequest.deleteMany({ where: { id: { in: reqIds } } });
    await prisma.courseOffering.deleteMany({ where: { course: { code: { startsWith: 'WLD ' } } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: 'WLD ' } } });
    await prisma.semester.deleteMany({ where: { programme: { code: { startsWith: 'WLD-' } } } });
    await prisma.programme.deleteMany({ where: { code: { startsWith: 'WLD-' } } });
    const users = await prisma.user.findMany({
      where: { email: { contains: '.wload' } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] },
    });
    await prisma.taxilaPublishRun.deleteMany({ where: { createdById: { in: userIds } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.department.deleteMany({ where: { code: { startsWith: 'WLD' } } });
    await prisma.scheduledRun.deleteMany({ where: { job: { startsWith: 'test-wload' } } });
  }

  const person = async (who: string, roles: RoleName[], departmentId: string | null) => {
    // The CI test database has the schema but no seed: create the roles when missing.
    const rs = await Promise.all(
      roles.map((name) => prisma.role.upsert({ where: { name }, update: {}, create: { name } })),
    );
    return prisma.user.create({
      data: {
        email: `${who}.${TAG}@hmp.local`,
        name: `WLD ${who}`,
        departmentId,
        roles: { create: rs.map((r) => ({ roleId: r.id })) },
      },
    });
  };

  beforeAll(async () => {
    await removeTestData();
    const a = await prisma.department.create({ data: { code: 'WLDA', name: 'WLD Dept A' } });
    const b = await prisma.department.create({ data: { code: 'WLDB', name: 'WLD Dept B' } });
    Object.assign(ids, { a: a.id, b: b.id });
    ids.hogA = (await person('hoga', [RoleName.HOG], a.id)).id;
    ids.hogB = (await person('hogb', [RoleName.HOG], b.id)).id;
    ids.ic = (await person('ic', [RoleName.INSTRUCTION_CELL], null)).id;
    ids.fac = (await person('fac', [RoleName.FACULTY], a.id)).id;
    // Semester started 10 days ago: every planned date is in the past, so the late-start rule decides.
    const start = new Date(Date.now() - 10 * DAY);
    const prog = await prisma.programme.create({
      data: {
        code: 'WLD-A',
        name: 'WLD programme',
        departmentId: a.id,
        semesters: {
          create: {
            name: 'Sem-I 2099-00',
            year: 2099,
            term: 'FIRST',
            startDate: start,
            endDate: new Date(Date.now() + 90 * DAY),
          },
        },
      },
      include: { semesters: true },
    });
    const mk = async (n: number, status: HandoutStatus, startedDaysAgo: number) => {
      const course = await prisma.course.create({
        data: { code: `WLD ZG${n}`, bitsCourseNumber: `WLD ZG${n}`, title: `WLD course ${n}` },
      });
      const off = await prisma.courseOffering.create({
        data: { courseId: course.id, semesterId: prog.semesters[0]!.id },
      });
      const req = await prisma.handoutRequest.create({
        data: {
          refNo: `${REF}${String(n).padStart(4, '0')}`,
          courseOfferingId: off.id,
          initiatedById: ids.ic!,
          status,
          statusChangedAt: new Date(Date.now() - startedDaysAgo * DAY),
        },
      });
      return { id: req.id, offeringId: off.id };
    };
    // Waiting for allocation for 10 days: 3 days allowed → 7 days overdue.
    const r1 = await mk(1, HandoutStatus.REQUESTED, 10);
    ids.req = r1.id;
    ids.off = r1.offeringId;
    await prisma.requestAssignee.create({
      data: { requestId: r1.id, role: RoleName.HOG, userId: ids.hogA!, assignedById: ids.ic! },
    });
    await prisma.handout.create({ data: { requestId: r1.id, status: HandoutStatus.REQUESTED } });
  });

  afterAll(async () => {
    await Promise.race([emailsSettled(), new Promise((r) => setTimeout(r, 3_000))]);
    await removeTestData();
  }, 30_000);

  it('due date: late start gets the stage SLA from when it began; a hand-changed date wins', async () => {
    const cfg = await loadDeadlineConfig();
    const row = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: ids.req },
      select: DEADLINE_SELECT,
    });
    const due = currentDeadline(deadlineInput(row), cfg)!;
    expect(due.stage).toBe('ALLOCATION');
    expect(formatDueDay(due.dueAt)).toBe(
      formatDueDay(new Date(Date.now() - 10 * DAY + cfg.hogReviewSla * 3_600_000)),
    );
    await prisma.requestDeadline.create({
      data: {
        requestId: ids.req!,
        stage: 'ALLOCATION',
        dueAt: new Date(Date.now() + 5 * DAY),
        reason: 'test',
        setById: ids.ic!,
      },
    });
    const row2 = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: ids.req },
      select: DEADLINE_SELECT,
    });
    expect(currentDeadline(deadlineInput(row2), cfg)!.source).toBe('manual');
    await prisma.requestDeadline.deleteMany({ where: { requestId: ids.req } });
  });

  it('escalation plan: with escalation on, 7 days overdue on the HOG’s own step copies the IC', async () => {
    const plan = await planRun(new Date(), {
      escalationOn: true,
      escalationDays: 3,
      only: [ids.req!],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      level: 2,
      holderRole: 'HOG',
      holderIds: [ids.hogA],
      toIc: true,
    });
    const off = await planRun(new Date(), { escalationOn: false, only: [ids.req!] });
    expect(off[0]?.level).toBe(1);
  });

  it('the daily run sends each step once', async () => {
    const first = await sendReminders(new Date(), { only: [ids.req!] });
    expect(first.steps).toBe(1);
    expect(first.notified).toBeGreaterThan(0);
    const again = await sendReminders(new Date(), { only: [ids.req!] });
    expect(again.steps).toBe(0);
    const n = await prisma.notification.count({
      where: { userId: ids.hogA, meta: { path: ['kind'], equals: 'deadline.reminder' } },
    });
    expect(n).toBe(2); // one in HMP + one email, from the first run only
  });

  it('a scheduled run is claimed once per period', async () => {
    expect(await claimRun(`test-wload-${TAG}`, '2099-01-01')).toBeTruthy();
    expect(await claimRun(`test-wload-${TAG}`, '2099-01-01')).toBeNull();
  });

  it('away: the back-up reaches the request, acts "for" the away HOG, and sees it in My work', async () => {
    const hogB = { id: ids.hogB!, roles: [RoleName.HOG], departmentId: ids.b! };
    expect(await requestVisibleTo(hogB, ids.req)).toBe(false);
    await prisma.userPreference.create({
      data: {
        userId: ids.hogA!,
        awayUntil: new Date(Date.now() + 3 * DAY),
        backupUserId: ids.hogB!,
      },
    });
    expect(await requestVisibleTo(hogB, ids.req)).toBe(true);
    expect(await actingFor(hogB, ids.req!)).toEqual({ id: ids.hogA, name: 'WLD hoga' });
    const work = await loadMyWork(hogB);
    expect(work.find((w) => w.requestId === ids.req)).toMatchObject({
      forName: 'WLD hoga',
      role: 'HOG',
    });
    // Back from leave: the access ends.
    await prisma.userPreference.update({
      where: { userId: ids.hogA! },
      data: { awayUntil: new Date(Date.now() - 2 * DAY) },
    });
    expect(await requestVisibleTo(hogB, ids.req)).toBe(false);
  });

  it('duplicate guard: the offering already has a request', async () => {
    expect((await existingRequests([ids.off!])).get(ids.off!)?.refNo).toBe(`${REF}0001`);
  });

  it('undo: the latest role change can be undone once', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ids.fac } });
    const saved = await savePerson(ids.ic!, {
      id: ids.fac,
      name: before.name,
      email: before.email,
      roles: [RoleName.FACULTY, RoleName.SME],
      departmentId: ids.a!,
      facultyType: null,
      active: true,
    });
    expect(saved.ok).toBe(true);
    const u = await lastUndoable(ids.fac!);
    expect(u?.changes[0]).toMatch(/Roles: Faculty → Faculty, (Subject expert|SME)/);
    expect(await undoPersonChange({ id: ids.ic!, isAdmin: true }, ids.fac!, u!.auditId)).toEqual({
      ok: true,
    });
    const roles = await prisma.userRole.findMany({
      where: { userId: ids.fac },
      select: { role: { select: { name: true } } },
    });
    expect(roles.map((r) => r.role.name)).toEqual([RoleName.FACULTY]);
    expect(await lastUndoable(ids.fac!)).toBeNull();
  });

  it('@mention: the person mentioned gets an urgent notice; others a plain one', async () => {
    const handout = await prisma.handout.findUniqueOrThrow({ where: { requestId: ids.req } });
    const c = await prisma.comment.create({
      data: { handoutId: handout.id, authorId: ids.ic!, body: 'Please look, @WLD hoga.' },
    });
    await dispatchComment({
      requestId: ids.req!,
      commentId: c.id,
      actor: { id: ids.ic!, name: 'WLD ic' },
    });
    const mention = await prisma.notification.findMany({
      where: { userId: ids.hogA, meta: { path: ['kind'], equals: 'comment.mention' } },
    });
    expect(mention.map((m) => m.channel).sort()).toEqual(['EMAIL', 'IN_PORTAL']);
    await prisma.comment.delete({ where: { id: c.id } });
  });

  it('auto-publish is off by default', async () => {
    expect((await autoPublish(ids.req!)).status).toBe('off');
  });
});
