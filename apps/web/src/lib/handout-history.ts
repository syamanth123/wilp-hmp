import {
  BitsHandoutSchemaV1,
  Prisma,
  prisma,
  type BitsHandoutV1,
  type HandoutStatus,
} from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import {
  OVERSIGHT_ONLY_STATUSES,
  PAST_HANDOUT_SCOPE,
  PUBLISHED_STATUSES,
  anyLibraryScope,
} from './handout-access';
import { compareHandouts } from './handout-compare';
import {
  asCourseCode,
  statusGroupOf,
  termKey,
  termKeyFromText,
  termRank,
  type LibraryItem,
} from './handout-library';

/**
 * A course's handouts across semesters (docs/plans/handout-library.md §3–§4): the course history
 * page, "compare with last year's handout" in the viewer, and the on-demand "changed vs last year"
 * size for the library filter (decision D4). Everything goes through the library's access rule.
 */

type ScopeUser = Pick<SessionUser, 'id' | 'roles'>;

const parse = (data: unknown): BitsHandoutV1 | null => {
  if (data == null) return null;
  const r = BitsHandoutSchemaV1.safeParse(data);
  return r.success ? r.data : null;
};

const codeWhere = (codes: string[]): Prisma.CourseWhereInput => ({
  OR: [{ bitsCourseNumber: { in: codes } }, { alternateCodes: { hasSome: codes } }],
});
const importCodeWhere = (codes: string[]): Prisma.HandoutImportWhereInput => ({
  OR: [{ bitsCourseNumber: { in: codes } }, { alternateCodes: { hasSome: codes } }],
});

/** "ss zg 653" → "SS ZG653"; anything else upper-cased as typed. */
export function canonicalCode(raw: string): string {
  const s = decodeURIComponent(raw).trim();
  return asCourseCode(s) ?? s.toUpperCase();
}

export interface HistoryEntry {
  kind: 'hmp' | 'past';
  id: string;
  href: string;
  termKey: string | null;
  semesterName: string;
  status: HandoutStatus | null;
  published: boolean;
  publishedAt: Date | null;
  refNo: string | null;
  faculty: string[];
  updatedAt: Date;
  structured: boolean;
}

export interface CourseHistory {
  code: string;
  title: string | null;
  entries: HistoryEntry[];
}

/** Every handout for one course that this user may see, newest semester first. */
export async function courseHistory(user: ScopeUser, rawCode: string): Promise<CourseHistory> {
  const code = canonicalCode(rawCode);
  const course = await prisma.course.findFirst({
    where: codeWhere([code]),
    select: { title: true, bitsCourseNumber: true, alternateCodes: true },
  });
  const codes = course ? [course.bitsCourseNumber, ...course.alternateCodes] : [code];
  const [requests, imports] = await Promise.all([
    prisma.handoutRequest.findMany({
      where: {
        AND: [
          anyLibraryScope(user),
          { status: { notIn: OVERSIGHT_ONLY_STATUSES } },
          { offering: { course: codeWhere(codes) } },
        ],
      },
      select: {
        id: true,
        refNo: true,
        status: true,
        updatedAt: true,
        offering: { select: { semester: { select: { name: true, year: true, term: true } } } },
        assignments: { where: { active: true }, select: { faculty: { select: { name: true } } } },
        handout: {
          select: {
            currentVersion: { select: { data: true } },
            publishLogs: {
              where: { status: { in: ['success', 'EXPORTED', 'MANUALLY_CONFIRMED'] } },
              select: { publishedAt: true },
              orderBy: { publishedAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    }),
    prisma.$queryRaw<
      { id: string; sem: string | null; title: string | null; inst: string | null; at: Date }[]
    >(Prisma.sql`
      SELECT id, data->'metadata'->>'semester' AS sem, data->'partA'->>'courseTitle' AS title,
             data->'partA'->'instructors'->>0 AS inst, COALESCE("approvedAt", "importedAt") AS at
      FROM "HandoutImport"
      WHERE "approvedForReuse" = true AND data IS NOT NULL AND data <> 'null'::jsonb
        AND ("bitsCourseNumber" IN (${Prisma.join(codes)}) OR "alternateCodes" && ${codes}::text[])`),
  ]);
  void PAST_HANDOUT_SCOPE; // same rule as the SQL above

  const entries: HistoryEntry[] = [
    ...requests.map((r): HistoryEntry => {
      const log = r.handout?.publishLogs[0];
      const published = statusGroupOf(r.status, !!log) === 'published';
      const sem = r.offering.semester;
      return {
        kind: 'hmp',
        id: r.id,
        href: `/handouts/${r.id}`,
        termKey: termKey(sem.year, sem.term),
        semesterName: sem.name,
        status: r.status,
        published,
        publishedAt: published ? (log?.publishedAt ?? r.updatedAt) : null,
        refNo: r.refNo,
        faculty: r.assignments.map((a) => a.faculty.name),
        updatedAt: r.updatedAt,
        structured: parse(r.handout?.currentVersion?.data) !== null,
      };
    }),
    ...imports.map(
      (i): HistoryEntry => ({
        kind: 'past',
        id: i.id,
        href: `/handouts/past/${i.id}`,
        termKey: termKeyFromText(i.sem),
        semesterName: i.sem ?? 'Semester not stated',
        status: null,
        published: true,
        publishedAt: null,
        refNo: null,
        faculty: i.inst ? [i.inst] : [],
        updatedAt: i.at,
        structured: true,
      }),
    ),
  ].sort(
    (a, b) =>
      termRank(b.termKey) - termRank(a.termKey) ||
      (a.kind === b.kind ? 0 : a.kind === 'hmp' ? -1 : 1) ||
      b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  return {
    code: course?.bitsCourseNumber ?? code,
    title: course?.title ?? imports[0]?.title ?? null,
    entries,
  };
}

export interface PreviousHandout {
  label: string;
  href: string;
  data: BitsHandoutV1;
}

interface Candidate {
  kind: 'hmp' | 'past';
  id: string;
  codes: string[];
  rank: number;
  at: number;
  label: string;
  data: unknown;
}

/** Published HMP handouts and past BITS handouts for these codes — everyone may see both. */
async function candidatesFor(codes: string[]): Promise<Candidate[]> {
  if (codes.length === 0) return [];
  const [hmp, past] = await Promise.all([
    prisma.handoutRequest.findMany({
      where: { status: { in: PUBLISHED_STATUSES }, offering: { course: codeWhere(codes) } },
      select: {
        id: true,
        updatedAt: true,
        offering: {
          select: {
            course: { select: { bitsCourseNumber: true, alternateCodes: true } },
            semester: { select: { name: true, year: true, term: true } },
          },
        },
        handout: { select: { currentVersion: { select: { data: true } } } },
      },
    }),
    prisma.handoutImport.findMany({
      where: { AND: [PAST_HANDOUT_SCOPE, importCodeWhere(codes)] },
      select: {
        id: true,
        bitsCourseNumber: true,
        alternateCodes: true,
        data: true,
        approvedAt: true,
        importedAt: true,
      },
    }),
  ]);
  return [
    ...hmp.map((r) => ({
      kind: 'hmp' as const,
      id: r.id,
      codes: [r.offering.course.bitsCourseNumber, ...r.offering.course.alternateCodes],
      rank: termRank(termKey(r.offering.semester.year, r.offering.semester.term)),
      at: r.updatedAt.getTime(),
      label: `HMP handout, ${r.offering.semester.name}`,
      data: r.handout?.currentVersion?.data,
    })),
    ...past.map((i) => {
      const sem = (i.data as { metadata?: { semester?: string } } | null)?.metadata?.semester;
      return {
        kind: 'past' as const,
        id: i.id,
        codes: [i.bitsCourseNumber ?? '', ...i.alternateCodes].filter(Boolean),
        rank: termRank(termKeyFromText(sem)),
        at: (i.approvedAt ?? i.importedAt).getTime(),
        label: `Past BITS handout${sem ? `, ${sem}` : ''}`,
        data: i.data,
      };
    }),
  ];
}

/**
 * "Last year's handout": the latest published HMP handout from an EARLIER semester; failing that,
 * the latest past BITS handout from this semester or before (or with no semester stated).
 */
function pickPrevious(
  cands: Candidate[],
  codes: string[],
  rank: number,
  selfId?: string,
): Candidate | null {
  const mine = cands.filter((c) => c.id !== selfId && c.codes.some((x) => codes.includes(x)));
  const best = (xs: Candidate[]) =>
    xs.sort((a, b) => b.rank - a.rank || b.at - a.at).find((c) => parse(c.data) !== null) ?? null;
  return (
    best(mine.filter((c) => c.kind === 'hmp' && c.rank < rank)) ??
    best(mine.filter((c) => c.kind === 'past' && c.rank <= rank))
  );
}

export async function previousHandout(
  codes: string[],
  forTermKey: string | null,
  selfId?: string,
): Promise<PreviousHandout | null> {
  const rank = forTermKey ? termRank(forTermKey) : Number.MAX_SAFE_INTEGER;
  const c = pickPrevious(await candidatesFor(codes), codes, rank, selfId);
  if (!c) return null;
  return {
    label: c.label,
    href: c.kind === 'hmp' ? `/handouts/${c.id}` : `/handouts/past/${c.id}`,
    data: parse(c.data)!,
  };
}

/** Decision D4: fills `changeSize` for these HMP items — three queries, compared in memory. */
export async function attachChangeSizes(items: LibraryItem[]): Promise<void> {
  const hmp = items.filter((i) => i.kind === 'hmp');
  if (hmp.length === 0) return;
  const [current, cands] = await Promise.all([
    prisma.handout.findMany({
      where: { requestId: { in: hmp.map((i) => i.id) } },
      select: { requestId: true, currentVersion: { select: { data: true } } },
    }),
    candidatesFor([...new Set(hmp.flatMap((i) => i.codes))]),
  ]);
  const data = new Map(current.map((h) => [h.requestId, h.currentVersion?.data]));
  for (const it of hmp) {
    const now = parse(data.get(it.id));
    const prev = now ? pickPrevious(cands, it.codes, termRank(it.termKey), it.id) : null;
    it.changeSize = now && prev ? compareHandouts(parse(prev.data)!, now).size : null;
  }
}

export interface CompareTarget {
  label: string;
  href: string;
  /** null = the other handout has no structured content (legacy) — comparison not available. */
  data: BitsHandoutV1 | null;
}

/**
 * "hmp:<requestId>" or "past:<importId>" → that handout's current content, through the same
 * access rules as opening it (no access → null, as if it didn't exist).
 */
export async function compareTarget(user: ScopeUser, ref: string): Promise<CompareTarget | null> {
  const [kind, id] = ref.split(':');
  if (!id || !/^[\w-]{1,40}$/.test(id)) return null;
  if (kind === 'hmp') {
    const r = await prisma.handoutRequest.findFirst({
      where: { AND: [{ id }, anyLibraryScope(user)] },
      select: {
        offering: { select: { semester: { select: { name: true } } } },
        handout: { select: { currentVersion: { select: { data: true } } } },
      },
    });
    if (!r) return null;
    return {
      label: `HMP handout, ${r.offering.semester.name}`,
      href: `/handouts/${id}`,
      data: parse(r.handout?.currentVersion?.data),
    };
  }
  if (kind === 'past') {
    const i = await prisma.handoutImport.findFirst({
      where: { AND: [{ id }, PAST_HANDOUT_SCOPE] },
      select: { data: true },
    });
    if (!i) return null;
    const data = parse(i.data);
    return {
      label: `Past BITS handout${data ? `, ${data.metadata.semester}` : ''}`,
      href: `/handouts/past/${id}`,
      data,
    };
  }
  return null;
}
