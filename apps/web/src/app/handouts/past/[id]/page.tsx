import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BitsHandoutSchemaV1, prisma, resolveHandoutHtml } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@hmp/ui';
import { AccessDenied } from '@/components/access-denied';
import { HandoutViewer } from '@/components/handout-viewer';
import { withPlainPlaceholders } from '@/lib/importer-placeholder';
import { Pill } from '@/components/status-badge';
import { formatDate } from '@/lib/format-date';
import { PAST_HANDOUT_SCOPE } from '@/lib/handout-access';
import { compareTarget, previousHandout } from '@/lib/handout-history';
import { termKeyFromText } from '@/lib/handout-library';
import { ComparePanel, type CompareOption } from '../../compare-panel';

export const dynamic = 'force-dynamic';

/**
 * A past BITS handout (an approved corpus import) in the library viewer: same renderer, a source
 * badge, Word/PDF download, and compare — no version history (imports have none).
 */
export default async function PastHandoutPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const row = await prisma.handoutImport.findFirst({
    where: { AND: [{ id: params.id }, PAST_HANDOUT_SCOPE] },
    select: {
      id: true,
      bitsCourseNumber: true,
      alternateCodes: true,
      data: true,
      importedAt: true,
      approvedAt: true,
    },
  });
  const parsed = row ? BitsHandoutSchemaV1.safeParse(row.data) : null;
  if (!row || !parsed?.success) {
    return <AccessDenied reason="This handout isn’t available to your account." />;
  }
  // Old-file gaps read "Not found in the old handout file", not the importer's marker.
  const h = withPlainPlaceholders(parsed.data);
  const code = row.bitsCourseNumber ?? h.partA.courseNumbers[0] ?? '—';
  const codes = [code, ...row.alternateCodes];
  const prev = await previousHandout(codes, termKeyFromText(h.metadata.semester), row.id);
  const cmp = searchParams.cmp ?? '';
  const options: CompareOption[] = prev
    ? [{ value: 'last-year', label: `The handout before (${prev.label})` }]
    : [];
  let before = cmp === 'last-year' ? prev : cmp ? await compareTarget(user, cmp) : undefined;
  if (cmp && cmp !== 'last-year' && before && !options.some((o) => o.value === cmp))
    options.push({ value: cmp, label: before.label });
  if (before && before.href === `/handouts/past/${row.id}`) before = null;

  const base = `/api/handouts/past/${row.id}/export`;
  return (
    <div className="space-y-4" data-testid="past-viewer-page">
      <nav className="text-muted-foreground text-sm">
        <Link href="/handouts?tab=past" className="underline">
          Handout Library
        </Link>{' '}
        ›{' '}
        <Link href={`/handouts/course/${encodeURIComponent(code)}`} className="underline">
          {code}
        </Link>
      </nav>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="font-serif text-2xl">
              {code} — {h.partA.courseTitle}
            </CardTitle>
            <p className="mt-2">
              <Pill tone="gray" testId="past-badge">
                Past BITS handout (imported {formatDate(row.approvedAt ?? row.importedAt)})
              </Pill>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/handouts/course/${encodeURIComponent(code)}`}
              className="bg-background hover:bg-accent rounded-md border px-3 py-1.5 text-sm font-medium"
            >
              Course history
            </Link>
            <details className="relative" data-testid="download-menu">
              <summary className="bg-background hover:bg-accent inline-flex cursor-pointer list-none items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium">
                Download{' '}
                <span aria-hidden className="text-muted-foreground text-xs">
                  ▾
                </span>
              </summary>
              <div className="bg-popover absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-md border shadow-md">
                <a
                  href={`${base}/docx`}
                  download
                  className="hover:bg-accent block px-3 py-2 text-sm"
                >
                  Word (.docx)
                </a>
                <a
                  href={`${base}/pdf`}
                  download
                  className="hover:bg-accent block border-t px-3 py-2 text-sm"
                >
                  PDF
                </a>
              </div>
            </details>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Semester</dt>
              <dd>{h.metadata.semester || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Instructors</dt>
              <dd>{h.partA.instructors.join(', ') || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Course numbers
              </dt>
              <dd>{h.partA.courseNumbers.join(', ')}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <ComparePanel
        action={`/handouts/past/${row.id}`}
        keep={{}}
        options={options}
        selected={cmp || options[0]?.value || ''}
        before={before}
        after={{ label: `This handout (${h.metadata.semester || 'past'})`, data: h }}
        showUnchanged={searchParams.all === '1'}
      />

      {!cmp && (
        <Card>
          <CardHeader>
            <CardTitle>Handout</CardTitle>
          </CardHeader>
          <CardContent>
            <HandoutViewer
              html={resolveHandoutHtml(
                { data: h, contentHtml: null },
                { logoSrc: '/bits-header.png' },
              )}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
