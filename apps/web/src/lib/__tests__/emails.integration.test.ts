import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what would be sent (no mail server in tests); the database is real.
const { sendMail } = vi.hoisted(() => ({ sendMail: vi.fn() }));
vi.mock('@hmp/integrations', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  sendMail,
}));

import {
  prisma,
  ApprovalDecision,
  ApprovalStage,
  FacultyType,
  HandoutStatus,
  RoleName,
} from '@hmp/db';
import {
  deliver,
  dispatchTransition,
  dispatchTransitions,
  emailsSettled,
  forgetEmailSettings,
} from '../notifications';
import { sendDigests } from '../daily-run';

// v1.4.3 (§7) — the detailed emails on the real database: a send-back carries the reviewer's full comments,
// an away person's back-up copy says so, a bulk action sends one email per person, the digest keeps each
// item's block, and a failed send is in the audit log. Only this test's own people receive anything (the
// events used never go to "every IC"). Sentinel data removed before and after; skipped without DATABASE_URL.

const hasDb = !!process.env.DATABASE_URL;
const TAG = `mails${process.pid}${Date.now() % 100000}`;
const REF = 'HMP-7453-';
const DAY = 86_400_000;

type Sent = { to: string; subject: string; html: string; text: string; replyTo?: string | null };
const sentTo = (email: string): Sent[] =>
  sendMail.mock.calls.map((c) => c[0] as Sent).filter((m) => m.to === email);

describe.skipIf(!hasDb)('v1.4.3 detailed emails (real DB)', () => {
  const ids: Record<string, string> = {};
  const emailOf = (who: string) => `${who}.${TAG}@hmp.local`;

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
    await prisma.courseOffering.deleteMany({ where: { course: { code: { startsWith: 'MLS ' } } } });
    await prisma.course.deleteMany({ where: { code: { startsWith: 'MLS ' } } });
    await prisma.semester.deleteMany({ where: { programme: { code: { startsWith: 'MLS-' } } } });
    await prisma.programme.deleteMany({ where: { code: { startsWith: 'MLS-' } } });
    const users = await prisma.user.findMany({
      where: { email: { contains: '.mails' } },
      select: { id: true, email: true },
    });
    const userIds = users.map((u) => u.id);
    const rows = await prisma.notification.findMany({
      where: { userId: { in: userIds } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { entityId: { in: [...userIds, ...rows.map((r) => r.id)] } },
        ],
      },
    });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.department.deleteMany({ where: { code: { startsWith: 'MLS' } } });
  }

  const person = async (who: string, roles: RoleName[], departmentId: string | null) => {
    const rs = await Promise.all(
      roles.map((name) => prisma.role.upsert({ where: { name }, update: {}, create: { name } })),
    );
    return prisma.user.create({
      data: {
        email: emailOf(who),
        name: `MLS ${who}`,
        departmentId,
        roles: { create: rs.map((r) => ({ roleId: r.id })) },
      },
    });
  };

  let n = 0;
  const request = async (status: HandoutStatus) => {
    n += 1;
    const course = await prisma.course.create({
      data: { code: `MLS ZG${n}`, bitsCourseNumber: `MLS ZG${n}`, title: `MLS course ${n}` },
    });
    const off = await prisma.courseOffering.create({
      data: { courseId: course.id, semesterId: ids.sem! },
    });
    const req = await prisma.handoutRequest.create({
      data: {
        refNo: `${REF}${String(n).padStart(4, '0')}`,
        courseOfferingId: off.id,
        initiatedById: ids.ic!,
        status,
        statusChangedAt: new Date(),
      },
    });
    await prisma.requestAssignee.create({
      data: { requestId: req.id, role: RoleName.HOG, userId: ids.hog!, assignedById: ids.ic! },
    });
    await prisma.handout.create({ data: { requestId: req.id, status } });
    return req.id;
  };

  beforeAll(async () => {
    await removeTestData();
    const d = await prisma.department.create({ data: { code: 'MLSA', name: 'MLS Dept' } });
    ids.dept = d.id;
    ids.hog = (await person('hog', [RoleName.HOG], d.id)).id;
    ids.hog2 = (await person('hog2', [RoleName.HOG], d.id)).id;
    ids.ic = (await person('ic', [RoleName.INSTRUCTION_CELL], null)).id;
    ids.pc = (await person('pc', [RoleName.PROGRAMME_COMMITTEE], d.id)).id;
    ids.fac = (await person('fac', [RoleName.FACULTY], d.id)).id;
    const prog = await prisma.programme.create({
      data: {
        code: 'MLS-A',
        name: 'MLS programme',
        departmentId: d.id,
        semesters: {
          create: {
            name: 'Sem-I 2099-00',
            year: 2099,
            term: 'FIRST',
            startDate: new Date(Date.now() + 40 * DAY),
            endDate: new Date(Date.now() + 160 * DAY),
          },
        },
      },
      include: { semesters: true },
    });
    ids.sem = prog.semesters[0]!.id;
  });

  afterAll(async () => {
    await removeTestData();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    sendMail.mockReset().mockResolvedValue({ ok: true, id: 'm' });
    forgetEmailSettings();
  });

  it('sent back: the faculty’s email has the reviewer’s full comments, the course and their own page', async () => {
    const id = await request(HandoutStatus.REWORK_REQUESTED);
    await prisma.facultyAssignment.create({
      data: { requestId: id, facultyId: ids.fac!, facultyType: FacultyType.ON_CAMPUS },
    });
    await prisma.approval.create({
      data: {
        requestId: id,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.REWORK,
        reviewerId: ids.pc!,
        comments: 'Line one of the comments.\nLine two: use the 2021 edition.',
        decidedAt: new Date(),
      },
    });
    await dispatchTransition({
      requestId: id,
      event: 'REVIEW_REWORK',
      actor: { id: ids.pc!, name: 'MLS pc' },
    });
    await emailsSettled();
    const [m] = sentTo(emailOf('fac'));
    expect(m).toBeDefined();
    expect(m!.subject).toMatch(
      /^\[HMP\] Changes needed: MLS ZG\d+ MLS course \d+ \(Sem-I 2099-00\) — due /,
    );
    expect(m!.text).toContain('Line two: use the 2021 edition.');
    expect(m!.text).toContain('MLS pc (the Programme Committee)');
    expect(m!.html).toContain(`/faculty/assignments/${id}`);
    expect(m!.text).toContain('HANDOUT DETAILS');
    // The bell keeps its one line.
    const bell = await prisma.notification.findFirst({
      where: { userId: ids.fac!, channel: 'IN_PORTAL', meta: { path: ['requestId'], equals: id } },
    });
    expect(bell?.subject).not.toContain('[HMP]');
  });

  it('an away HOG’s back-up gets a copy that says so', async () => {
    await prisma.userPreference.create({
      data: {
        userId: ids.hog!,
        awayFrom: new Date(Date.now() - DAY),
        awayUntil: new Date(Date.now() + 5 * DAY),
        backupUserId: ids.hog2!,
      },
    });
    try {
      const id = await request(HandoutStatus.REQUESTED);
      await dispatchTransition({
        requestId: id,
        event: 'REQUEST_INITIATED',
        actor: { id: ids.ic!, name: 'MLS ic' },
      });
      await emailsSettled();
      const [copy] = sentTo(emailOf('hog2'));
      expect(copy?.text).toContain('You get this as MLS hog’s back-up while they are away.');
      expect(sentTo(emailOf('hog'))).toHaveLength(1);
    } finally {
      await prisma.userPreference.deleteMany({ where: { userId: ids.hog! } });
    }
  });

  it('H31: a bulk action sends the HOG one email for all requests (the bell: one each)', async () => {
    const a = await request(HandoutStatus.REQUESTED);
    const b = await request(HandoutStatus.REQUESTED);
    const actor = { id: ids.ic!, name: 'MLS ic' };
    await dispatchTransitions([
      { requestId: a, event: 'REQUEST_INITIATED', actor },
      { requestId: b, event: 'REQUEST_INITIATED', actor },
    ]);
    await emailsSettled();
    const mails = sentTo(emailOf('hog'));
    expect(mails).toHaveLength(1);
    expect(mails[0]!.subject).toBe('[HMP] Action needed: 2 requests from MLS ic');
    expect(mails[0]!.text).toContain('ACTION NEEDED (2)');
    const bells = await prisma.notification.count({
      where: {
        userId: ids.hog!,
        channel: 'IN_PORTAL',
        OR: [a, b].map((id) => ({ meta: { path: ['requestId'], equals: id } })),
      },
    });
    expect(bells).toBe(2);
  });

  it('the daily digest keeps each held email’s block and puts "Action needed" first', async () => {
    await prisma.userPreference.create({ data: { userId: ids.hog!, emailMode: 'DIGEST' } });
    try {
      const id = await request(HandoutStatus.REQUESTED);
      await dispatchTransition({
        requestId: id,
        event: 'REQUEST_INITIATED',
        actor: { id: ids.ic!, name: 'MLS ic' },
      });
      await emailsSettled();
      expect(sentTo(emailOf('hog'))).toHaveLength(0);
      const held = await prisma.notification.findFirst({
        where: { userId: ids.hog!, channel: 'EMAIL', status: 'PENDING' },
      });
      expect((held?.meta as { digestItem?: { action: boolean } }).digestItem?.action).toBe(true);
      await sendDigests();
      const [d] = sentTo(emailOf('hog'));
      expect(d?.subject).toBe('[HMP] Your daily summary: 1 needs you, 1 update');
      expect(d?.text).toContain('ACTION NEEDED (1)');
      expect(d?.text).toMatch(/Action needed: allocate MLS ZG\d+/);
    } finally {
      await prisma.userPreference.deleteMany({ where: { userId: ids.hog! } });
    }
  });

  it('H32: a failed email is FAILED with its reason and in the audit log; reply-to comes from Settings', async () => {
    const cfg = await prisma.workflowConfig.findUnique({
      where: { key: 'default' },
      select: { emailReplyTo: true },
    });
    if (cfg)
      await prisma.workflowConfig.update({
        where: { key: 'default' },
        data: { emailReplyTo: 'ic-desk@x.test' },
      });
    try {
      sendMail.mockResolvedValue({ ok: false, error: 'Mailbox unavailable' });
      await deliver({
        userId: ids.fac!,
        email: emailOf('fac'),
        role: RoleName.FACULTY,
        subject: 'A notice',
        body: 'Something happened.',
        link: '/',
        channels: ['EMAIL'],
        metaKind: 'test.mails',
        urgent: true,
      });
      await emailsSettled();
      const row = await prisma.notification.findFirst({
        where: { userId: ids.fac!, meta: { path: ['kind'], equals: 'test.mails' } },
      });
      expect(row?.status).toBe('FAILED');
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'email.failed', entityId: row!.id },
      });
      expect(audit?.after).toMatchObject({ to: emailOf('fac'), error: 'Mailbox unavailable' });
      if (cfg) expect(sendMail.mock.calls[0]![0].replyTo).toBe('ic-desk@x.test');
    } finally {
      if (cfg)
        await prisma.workflowConfig.update({
          where: { key: 'default' },
          data: { emailReplyTo: cfg.emailReplyTo },
        });
      forgetEmailSettings();
    }
  });
});
