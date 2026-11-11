import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import { currentTermKey, loadAllItems, termLabel, termNames, termRank } from './handout-library';
import { loadPlanInput, planMessage, planOffering } from './dibba-offering';
import { deadlinesFor, formatDueDay, loadDeadlineConfig } from './deadlines';

/**
 * v1.4.2 — semester kick-off wizard (docs/plans/v1.4.2-workload.md §6.1, H25). Every Course Dibba course of
 * the semester that has no request yet, with what creating it would do: the HMP semester, the department
 * and its HOG, the due dates and the starting content. Courses with a problem are listed with a Fix link
 * and can't be ticked — no half-made requests.
 */

export interface KickoffRow {
  key: string;
  codes: string[];
  courseCode: string;
  title: string;
  dibbaProgrammes: string[];
  departmentId: string | null;
  departmentName: string | null;
  hogName: string | null;
  programmeCode: string | null;
  semesterId: string | null;
  semesterName: string | null;
  due: { allocation: string; draft: string; publish: string } | null;
  start: string;
  problem: { text: string; fixHref: string; fixLabel: string } | null;
}

export interface Kickoff {
  term: string | null;
  termText: string;
  terms: { key: string; label: string }[];
  rows: KickoffRow[];
}

export async function loadKickoff(
  user: SessionUser,
  asked: string | null | undefined,
): Promise<Kickoff> {
  const names = await termNames();
  const [items, current, cfg] = await Promise.all([
    loadAllItems(user, names),
    currentTermKey(),
    loadDeadlineConfig(),
  ]);
  const notStarted = items['in-progress'].filter((i) => i.kind === 'not-started' && i.termKey);
  const termKeys = [...new Set(notStarted.map((i) => i.termKey!))].sort(
    (a, b) => termRank(b) - termRank(a),
  );
  const term =
    asked && termKeys.includes(asked)
      ? asked
      : current && termKeys.includes(current)
        ? current
        : (termKeys[0] ?? null);
  const terms = termKeys.map((k) => ({ key: k, label: names.get(k) ?? termLabel(k) }));
  if (!term) return { term: null, termText: 'No semester to start', terms, rows: [] };
  const [yearText, termWord] = term.split('-');
  const year = Number(yearText);

  const [departments, hogs] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({
      where: {
        active: true,
        departmentId: { not: null },
        roles: { some: { role: { name: RoleName.HOG } } },
      },
      select: { name: true, departmentId: true },
    }),
  ]);
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const hogOf = new Map(hogs.map((h) => [h.departmentId!, h.name]));

  const rows: KickoffRow[] = [];
  for (const it of notStarted.filter((i) => i.termKey === term)) {
    const plan = planOffering(await loadPlanInput(it.codes, year, termWord!));
    const row: KickoffRow = {
      key: it.id,
      codes: it.codes,
      courseCode: it.courseCode,
      title: it.courseTitle,
      dibbaProgrammes: it.programmes,
      departmentId: null,
      departmentName: null,
      hogName: null,
      programmeCode: null,
      semesterId: null,
      semesterName: null,
      due: null,
      start: 'Blank',
      problem: null,
    };
    if (plan.kind !== 'ready') {
      row.problem = {
        text: planMessage(plan),
        fixHref:
          plan.kind === 'not-set-up' && plan.noSemester.length
            ? '/ic/semesters'
            : '/admin/dibba-codes',
        fixLabel:
          plan.kind === 'not-set-up' && plan.noSemester.length
            ? 'Add the semester'
            : 'Link the Dibba code',
      };
      rows.push(row);
      continue;
    }
    // The programme whose department is known first.
    const semesters = await prisma.semester.findMany({
      where: { id: { in: plan.choices.map((c) => c.semesterId) } },
      select: {
        id: true,
        name: true,
        startDate: true,
        programme: { select: { code: true, departmentId: true } },
      },
    });
    const sem = semesters.find((s) => s.programme.departmentId) ?? semesters[0];
    if (!sem) {
      row.problem = {
        text: 'No HMP semester for this course.',
        fixHref: '/ic/semesters',
        fixLabel: 'Add the semester',
      };
      rows.push(row);
      continue;
    }
    row.programmeCode = sem.programme.code;
    row.semesterId = sem.id;
    row.semesterName = sem.name;
    row.departmentId = sem.programme.departmentId ?? it.departmentIds[0] ?? null;
    row.departmentName = row.departmentId ? (deptName.get(row.departmentId) ?? null) : null;
    row.hogName = row.departmentId ? (hogOf.get(row.departmentId) ?? null) : null;
    const d = deadlinesFor(
      {
        status: HandoutStatus.REQUESTED,
        stageStartedAt: new Date(),
        semesterStart: sem.startDate,
        manual: {},
      },
      cfg,
    );
    const on = (stage: string) => formatDueDay(d.find((x) => x.stage === stage)!.dueAt);
    row.due = { allocation: on('ALLOCATION'), draft: on('DRAFT'), publish: on('PUBLISH') };
    if (!row.departmentId)
      row.problem = {
        text: `${sem.programme.code} has no department yet.`,
        fixHref: '/ic/departments',
        fixLabel: 'Set the department',
      };
    else if (!row.hogName)
      row.problem = {
        text: `${row.departmentName} has no HOG yet.`,
        fixHref: `/ic/people?department=${row.departmentId}`,
        fixLabel: 'Set one in People',
      };
    rows.push(row);
  }

  // Starting content (what the faculty's editor will start from — already automatic since v1.1).
  const allCodes = [...new Set(rows.flatMap((r) => r.codes))];
  const [prior, imports] = await Promise.all([
    prisma.handoutRequest.findMany({
      where: {
        status: { in: [HandoutStatus.PUBLISHED, HandoutStatus.ARCHIVED] },
        offering: {
          course: {
            OR: [{ bitsCourseNumber: { in: allCodes } }, { alternateCodes: { hasSome: allCodes } }],
          },
        },
      },
      select: {
        offering: {
          select: {
            course: { select: { bitsCourseNumber: true, alternateCodes: true } },
            semester: { select: { name: true, startDate: true } },
          },
        },
      },
      orderBy: { offering: { semester: { startDate: 'desc' } } },
    }),
    prisma.handoutImport.findMany({
      where: {
        approvedForReuse: true,
        OR: [{ bitsCourseNumber: { in: allCodes } }, { alternateCodes: { hasSome: allCodes } }],
      },
      select: { bitsCourseNumber: true, alternateCodes: true },
    }),
  ]);
  for (const r of rows) {
    const p = prior.find((x) =>
      [x.offering.course.bitsCourseNumber, ...x.offering.course.alternateCodes].some((c) =>
        r.codes.includes(c),
      ),
    );
    if (p) r.start = `Last handout: ${p.offering.semester.name}`;
    else if (
      imports.some((x) =>
        [x.bitsCourseNumber, ...x.alternateCodes].some((c) => c && r.codes.includes(c)),
      )
    )
      r.start = 'BITS archive';
  }

  rows.sort(
    (a, b) =>
      (a.departmentName ?? '~').localeCompare(b.departmentName ?? '~') ||
      a.courseCode.localeCompare(b.courseCode),
  );
  return { term, termText: names.get(term) ?? termLabel(term), terms, rows };
}
