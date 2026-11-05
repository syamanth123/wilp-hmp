import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BitsHandoutSchemaV1, HandoutStatus, RoleName, prisma, resolveHandoutHtml } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@hmp/ui';
import { AccessDenied } from '@/components/access-denied';
import { DownloadMenu } from '@/components/download-menu';
import { HandoutViewer } from '@/components/handout-viewer';
import { Pill, StatusBadge } from '@/components/status-badge';
import { canExportHandout, isDraftDownload } from '@/lib/export/access';
import { formatDate, formatDateTime } from '@/lib/format-date';
import { canViewHandout, seesAllWork } from '@/lib/handout-access';
import { compareTarget, previousHandout } from '@/lib/handout-history';
import { loadWorkflowConfig, slaHoursFor } from '@/lib/sla';
import { dueText } from '@/lib/due-text';
import { ComparePanel, type CompareOption } from '../compare-panel';

export const dynamic = 'force-dynamic';

const S = HandoutStatus;

/** The role's next step on this handout — a link to the page where it is done (no new actions). */
function nextSteps(
  roles: RoleName[],
  status: HandoutStatus,
  id: string,
  own: { faculty: boolean; sme: boolean },
): { label: string; href: string }[] {
  const out: { label: string; href: string }[] = [];
  if (
    own.faculty &&
    ([S.ASSIGNED, S.IN_PROGRESS, S.REWORK_REQUESTED] as HandoutStatus[]).includes(status)
  )
    out.push({ label: 'Open in editor', href: `/faculty/assignments/${id}` });
  if (own.sme && status === S.SME_REVIEW)
    out.push({ label: 'Review this handout', href: `/sme/review/${id}` });
  if (
    roles.includes(RoleName.PROGRAMME_COMMITTEE) &&
    ([S.ALLOCATED, S.SUBMITTED] as HandoutStatus[]).includes(status)
  )
    out.push({
      label: status === S.ALLOCATED ? 'Confirm the allocation' : 'Review this handout',
      href: `/pc/requests/${id}`,
    });
  if (
    roles.includes(RoleName.HOG) &&
    ([S.REQUESTED, S.UNDER_REVIEW] as HandoutStatus[]).includes(status)
  )
    out.push({
      label: status === S.REQUESTED ? 'Allocate' : 'Give final approval',
      href: `/hog/requests/${id}`,
    });
  if (
    (roles.includes(RoleName.INSTRUCTION_CELL) || roles.includes(RoleName.ADMIN)) &&
    status === S.APPROVED
  )
    out.push({ label: 'Publish', href: `/ic/requests/${id}` });
  return out;
}

/**
 * Read-only handout viewer (docs/plans/handout-library.md §4). One access rule with the library:
 * no access → the friendly "You don't have access" page, saying nothing about the handout.
 */
export default async function HandoutViewerPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!(await canViewHandout(user, params.id))) {
    return <AccessDenied reason="This handout isn’t available to your account." />;
  }

  const request = await prisma.handoutRequest.findUniqueOrThrow({
    where: { id: params.id },
    select: {
      id: true,
      refNo: true,
      status: true,
      updatedAt: true,
      offering: {
        select: {
          course: { select: { bitsCourseNumber: true, alternateCodes: true, title: true } },
          semester: {
            select: { name: true, year: true, term: true, programme: { select: { code: true } } },
          },
        },
      },
      assignments: {
        where: { active: true },
        select: { facultyId: true, faculty: { select: { name: true } } },
      },
      smeAssignment: { select: { smeUserId: true, smeUser: { select: { name: true } } } },
      handout: {
        select: {
          id: true,
          currentVersion: { select: { versionNo: true } },
          versions: {
            orderBy: { versionNo: 'desc' },
            select: {
              versionNo: true,
              createdAt: true,
              notes: true,
              author: { select: { name: true } },
            },
          },
          publishLogs: {
            where: { status: { in: ['success', 'EXPORTED', 'MANUALLY_CONFIRMED'] } },
            orderBy: { publishedAt: 'asc' },
            take: 1,
            select: { status: true, publishedAt: true },
          },
        },
      },
    },
  });

  const course = request.offering.course;
  const sem = request.offering.semester;
  const own = {
    faculty: request.assignments.some((a) => a.facultyId === user.id),
    sme: request.smeAssignment?.smeUserId === user.id,
  };
  // Earlier versions of someone else's handout are drafts: only the people who could see it in
  // progress (oversight roles, its faculty, its SME) get the version history.
  const seesHistory = seesAllWork(user) || own.faculty || own.sme;
  const versions = seesHistory ? (request.handout?.versions ?? []) : [];
  const currentNo = request.handout?.currentVersion?.versionNo ?? null;
  const wanted = Number(searchParams.v);
  const shownNo = seesHistory && versions.some((v) => v.versionNo === wanted) ? wanted : currentNo;
  const shown =
    request.handout && shownNo !== null
      ? await prisma.handoutVersion.findUnique({
          where: { handoutId_versionNo: { handoutId: request.handout.id, versionNo: shownNo } },
          select: { data: true, contentHtml: true },
        })
      : null;
  const shownData = shown?.data ? BitsHandoutSchemaV1.safeParse(shown.data) : null;
  const afterData = shownData?.success ? shownData.data : null;

  const log = request.handout?.publishLogs[0];
  const published = request.status === S.PUBLISHED || !!log;
  const cfg = await loadWorkflowConfig();
  const sla = slaHoursFor(cfg, request.status);
  const due = sla == null ? null : new Date(request.updatedAt.getTime() + sla * 3_600_000);
  const canDownload = canExportHandout({
    roles: user.roles,
    status: request.status,
    isOwnerFaculty: own.faculty,
    isAssignedSme: own.sme,
  });
  const steps = nextSteps(user.roles, request.status, request.id, own);

  // Compare: another version, last year's handout, or any handout from the course history.
  const codes = [course.bitsCourseNumber, ...course.alternateCodes];
  const termKeyOf = `${sem.year}-${sem.term}`;
  const prev = await previousHandout(codes, termKeyOf, request.id);
  const cmp = searchParams.cmp ?? '';
  const options: CompareOption[] = [
    ...(prev ? [{ value: 'last-year', label: `Last year’s handout (${prev.label})` }] : []),
    ...versions
      .filter((v) => v.versionNo !== shownNo)
      .map((v) => ({ value: `v${v.versionNo}`, label: `Version ${v.versionNo}` })),
  ];
  let before: { label: string; href: string; data: typeof afterData } | null | undefined;
  if (cmp === 'last-year') before = prev;
  else if (/^v\d+$/.test(cmp) && seesHistory) {
    const n = Number(cmp.slice(1));
    const ver = request.handout
      ? await prisma.handoutVersion.findUnique({
          where: { handoutId_versionNo: { handoutId: request.handout.id, versionNo: n } },
          select: { data: true },
        })
      : null;
    const p = ver?.data ? BitsHandoutSchemaV1.safeParse(ver.data) : null;
    before = ver
      ? {
          label: `Version ${n}`,
          href: `/handouts/${request.id}?v=${n}`,
          data: p?.success ? p.data : null,
        }
      : null;
  } else if (cmp) {
    before = await compareTarget(user, cmp);
    if (before && !options.some((o) => o.value === cmp))
      options.push({ value: cmp, label: before.label });
  }

  const meta: [string, React.ReactNode][] = [
    ['Semester', `${sem.name} · ${sem.programme.code}`],
    ['Status', <StatusBadge key="s" status={request.status} />],
    ['Faculty', request.assignments.map((a) => a.faculty.name).join(', ') || 'Not assigned yet'],
    ['Subject expert', request.smeAssignment?.smeUser.name ?? '—'],
    ['Reference', request.refNo],
    [
      published || request.status === S.APPROVED ? 'Published' : 'Due',
      published
        ? `${log?.status === 'EXPORTED' ? 'Export downloaded' : 'Published to Taxila'} on ${formatDate(log?.publishedAt ?? request.updatedAt)}`
        : request.status === S.APPROVED
          ? 'Approved — not yet published'
          : due
            ? dueText(due).text
            : '—',
    ],
  ];

  return (
    <div className="space-y-4" data-testid="handout-viewer-page">
      <nav className="text-muted-foreground text-sm">
        <Link href="/handouts" className="underline">
          Handout Library
        </Link>{' '}
        ›{' '}
        <Link
          href={`/handouts/course/${encodeURIComponent(course.bitsCourseNumber)}`}
          className="underline"
        >
          {course.bitsCourseNumber}
        </Link>
      </nav>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-2xl">
              {course.bitsCourseNumber} — {course.title}
            </CardTitle>
            {shownNo !== null && shownNo !== currentNo && (
              <p className="mt-1 text-sm font-medium text-amber-800" data-testid="old-version-note">
                You are looking at version {shownNo}, not the latest.{' '}
                <Link href={`/handouts/${request.id}`} className="underline">
                  See the latest
                </Link>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {steps.map((s) => (
              <Link
                key={s.href + s.label}
                href={s.href}
                className="rounded-md bg-[var(--bits-navy)] px-3 py-1.5 text-sm font-medium text-white"
                data-testid="next-step"
              >
                {s.label}
              </Link>
            ))}
            <Link
              href={`/handouts/course/${encodeURIComponent(course.bitsCourseNumber)}`}
              className="bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Course history
            </Link>
            {canDownload && afterData && <DownloadMenu requestId={request.id} />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {meta.map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground text-xs uppercase tracking-wide">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {canDownload && isDraftDownload(request.status) && (
            <p className="text-muted-foreground text-xs" data-testid="draft-download-note">
              Downloads of a handout that isn’t approved yet are marked “DRAFT – not for
              circulation”. Every download is recorded.
            </p>
          )}
        </CardContent>
      </Card>

      <ComparePanel
        action={`/handouts/${request.id}`}
        keep={shownNo !== null && shownNo !== currentNo ? { v: String(shownNo) } : {}}
        options={options}
        selected={cmp || options[0]?.value || ''}
        before={before}
        after={{ label: shownNo !== null ? `Version ${shownNo}` : 'This handout', data: afterData }}
        showUnchanged={searchParams.all === '1'}
      />

      {!cmp && (
        <Card>
          <CardHeader>
            <CardTitle>Handout{shownNo !== null ? ` (version ${shownNo})` : ''}</CardTitle>
          </CardHeader>
          <CardContent>
            <HandoutViewer
              html={shown ? resolveHandoutHtml(shown, { logoSrc: '/bits-header.png' }) : null}
              empty="Nothing has been written for this handout yet."
            />
          </CardContent>
        </Card>
      )}

      {seesHistory && versions.length > 0 && (
        <Card data-testid="version-history">
          <CardHeader>
            <CardTitle>Version history</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Saved by</th>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.versionNo} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {v.versionNo}
                      {v.versionNo === currentNo && (
                        <Pill tone="navy" className="ml-2">
                          Latest
                        </Pill>
                      )}
                    </td>
                    <td className="px-4 py-2">{v.author.name}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {formatDateTime(v.createdAt)}
                    </td>
                    <td className="px-4 py-2">{v.notes ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {v.versionNo === shownNo && !cmp ? (
                        <span className="text-muted-foreground text-xs">Showing</span>
                      ) : (
                        <Link
                          href={`/handouts/${request.id}?v=${v.versionNo}`}
                          className="underline"
                          data-testid="view-version"
                        >
                          View this version
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
