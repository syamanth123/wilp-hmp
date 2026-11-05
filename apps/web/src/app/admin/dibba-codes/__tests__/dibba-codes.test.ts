import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma, RoleName } from '@hmp/db';

// DB-touching test for Admin → Dibba codes (v1.3.0). Skipped without DATABASE_URL. Seeds its own
// far-future term, a published Dibba with codes QX…, and QX* programmes; all removed in afterAll.

const hasDb = Boolean(process.env.DATABASE_URL);
const YEAR = 7311;
const TAG = '__dibba_codes_test__';

const { session } = vi.hoisted(() => ({ session: { user: null as unknown } }));
vi.mock('@hmp/auth', async () => {
  const rbac = await import('@hmp/auth/src/rbac');
  return { getSessionUser: async () => session.user, requireRole: rbac.requireRole };
});
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { setDibbaCodeAction, uploadDibbaCodesAction } from '../actions';
import {
  loadDibbaCodeRows,
  loadDibbaProgrammeLinks,
  resolveDibbaProgramme,
} from '@/lib/dibba-programme-codes';

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe.skipIf(!hasDb)('Admin → Dibba codes', () => {
  let adminId = '';
  let active = '';
  let inactive = '';

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: `${TAG}@hmp.local` },
      update: {},
      create: { email: `${TAG}@hmp.local`, name: 'Dibba Codes Test Admin' },
    });
    adminId = admin.id;
    const term = await prisma.academicTerm.create({
      data: {
        name: TAG,
        year: YEAR,
        term: 'FIRST',
        startDate: new Date(`${YEAR}-08-01`),
        endDate: new Date(`${YEAR}-12-15`),
      },
    });
    const entry = (programmeCode: string, courseCode: string) => ({
      programmeCode,
      programmeTitle: `${programmeCode} Quixotry programme`,
      slotNo: 1,
      slotDay: 'SAT',
      slotSession: 'FN',
      courseCode,
      courseTitle: 'TEST',
      rawCell: courseCode,
    });
    await prisma.dibbaImport.create({
      data: {
        termId: term.id,
        label: TAG,
        sourceFilename: `${TAG}.docx`,
        sourceFormat: 'docx',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        rowCount: 3,
        uploadedById: admin.id,
        entries: {
          create: [
            entry('QX1/QX2', 'QXA ZC901'),
            entry('QX3', 'QXA ZC902'),
            entry('QXEXACT', 'QXA ZC903'),
          ],
        },
      },
    });
    active = (await prisma.programme.create({ data: { code: 'QX-PROG', name: 'QX quixotry' } })).id;
    inactive = (
      await prisma.programme.create({ data: { code: 'QX-OLD', name: 'QX old', active: false } })
    ).id;
    await prisma.programme.create({ data: { code: 'QXEXACT', name: 'QX exact' } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        action: 'dibba.programme_map.update',
        entityId: { in: ['QX1/QX2', 'QX3', 'QXEXACT'] },
      },
    });
    await prisma.dibbaProgrammeCode.deleteMany({
      where: { code: { in: ['QX1/QX2', 'QX3', 'QXEXACT'] } },
    });
    await prisma.programme.deleteMany({
      where: { code: { in: ['QX-PROG', 'QX-OLD', 'QXEXACT'] } },
    });
    await prisma.dibbaImport.deleteMany({ where: { label: TAG } });
    await prisma.academicTerm.deleteMany({ where: { name: TAG } });
    await prisma.user.deleteMany({ where: { email: `${TAG}@hmp.local` } });
  });

  const asRole = (role: RoleName) => {
    session.user = {
      id: adminId,
      email: `${TAG}@hmp.local`,
      name: 'T',
      roles: [role],
      permissions: [],
    };
  };
  const resolve = async (code: string) =>
    resolveDibbaProgramme(code, await loadDibbaProgrammeLinks()).programme?.code ?? null;

  it('refuses anyone but Admin', async () => {
    asRole(RoleName.INSTRUCTION_CELL);
    await expect(setDibbaCodeAction(form({ code: 'QX3', programmeId: active }))).rejects.toThrow(
      /Forbidden/,
    );
    await expect(
      uploadDibbaCodesAction(form({ csv: 'code,programme_code\nQX3,QX-PROG' })),
    ).rejects.toThrow(/Forbidden/);
  });

  it('unlinked → nothing; exact code match works without a link', async () => {
    expect(await resolve('QX3')).toBeNull();
    expect(await resolve('QXEXACT')).toBe('QXEXACT');
  });

  it('unlinked codes get a suggestion by name; nothing is linked automatically', async () => {
    const rows = await loadDibbaCodeRows();
    const qx3 = rows.find((r) => r.code === 'QX3')!;
    // "QX3 Quixotry programme" looks like "QX quixotry" (QX-PROG, active). A word no other test uses,
    // so programmes other test files create at the same time can't compete for the suggestion.
    expect(qx3.suggestion?.code).toBe('QX-PROG');
    expect(qx3.linkedProgrammeId).toBeNull();
    expect(await resolve('QX3')).toBeNull();
    // A code that already resolves (exact match) gets no suggestion.
    expect(rows.find((r) => r.code === 'QXEXACT')!.suggestion).toBeNull();
  });

  it('links and unlinks one code, audit-logged', async () => {
    asRole(RoleName.ADMIN);
    expect(await setDibbaCodeAction(form({ code: 'QX3', programmeId: active }))).toEqual({
      ok: true,
    });
    expect(await resolve('QX3')).toBe('QX-PROG');
    expect(await setDibbaCodeAction(form({ code: 'QX3', programmeId: '' }))).toEqual({ ok: true });
    expect(await resolve('QX3')).toBeNull();
    const audits = await prisma.auditLog.findMany({
      where: { action: 'dibba.programme_map.update', entityId: 'QX3' },
      orderBy: { createdAt: 'asc' },
      select: { after: true, actorId: true },
    });
    expect(audits.map((a) => (a.after as { programme: string | null }).programme)).toEqual([
      'QX-PROG',
      null,
    ]);
    expect(audits.every((a) => a.actorId === adminId)).toBe(true);
  });

  it('a link to an inactive programme is refused', async () => {
    asRole(RoleName.ADMIN);
    const r = await setDibbaCodeAction(form({ code: 'QX3', programmeId: inactive }));
    expect(r).toEqual({ ok: false, error: "QX-OLD is inactive, so codes can't be linked to it." });
  });

  it('CSV: one bad row saves nothing and names the rows; a clean file saves all', async () => {
    asRole(RoleName.ADMIN);
    const bad = await uploadDibbaCodesAction(
      form({
        csv: 'code,programme_code\nQX1/QX2,QX-PROG\nQX3,QX-OLD\nNOPE,QX-PROG\nQX1/QX2,QX-PROG',
      }),
    );
    expect(bad).toEqual({
      ok: false,
      errors: [
        { line: 3, message: 'QX-OLD is inactive.' },
        { line: 4, message: "NOPE isn't in any published Course Dibba." },
        { line: 5, message: 'QX1/QX2 appears twice in the file.' },
      ],
    });
    expect(await resolve('QX1/QX2')).toBeNull();

    const good = await uploadDibbaCodesAction(
      form({ csv: 'code,programme_code\n# comment\nQX1/QX2,qx-prog\nQX3,QX-PROG' }),
    );
    expect(good).toEqual({ ok: true, changed: 2, rows: 2 });
    expect(await resolve('QX1/QX2')).toBe('QX-PROG');
    // Uploading the same file again changes nothing.
    expect(
      await uploadDibbaCodesAction(
        form({ csv: 'code,programme_code\nQX1/QX2,QX-PROG\nQX3,QX-PROG' }),
      ),
    ).toEqual({ ok: true, changed: 0, rows: 2 });
  });
});
