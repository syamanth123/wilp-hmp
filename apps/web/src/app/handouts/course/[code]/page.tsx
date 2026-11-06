import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent } from '@hmp/ui';
import { Pill, StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/format-date';
import { courseHistory } from '@/lib/handout-history';

export const dynamic = 'force-dynamic';

/**
 * Course history (docs/plans/handout-library.md §3): every handout for one course across
 * semesters, newest first — HMP handouts (within the user's access) and past BITS handouts
 * together, each labelled with its source and status, with "Compare with previous".
 */
export default async function CourseHistoryPage({ params }: { params: { code: string } }) {
  const user = await getSessionUser();
  if (!user) redirect('/api/session-ended'); // signed in, but switched off since (v1.4.0)
  const h = await courseHistory(user, params.code);

  return (
    <div className="space-y-4" data-testid="course-history-page">
      <nav className="text-muted-foreground text-sm">
        <Link href="/handouts" className="underline">
          Handout Library
        </Link>{' '}
        › Course history
      </nav>
      <div>
        <h1 className="font-serif text-2xl font-bold">
          {h.code}
          {h.title ? ` — ${h.title}` : ''}
        </h1>
        <p className="text-muted-foreground text-sm">
          Every handout for this course you may see, newest semester first.
        </p>
      </div>

      {h.entries.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No handouts for this course yet.{' '}
            <Link href={`/handouts?tab=past&q=${encodeURIComponent(h.code)}`} className="underline">
              Search the past BITS handouts
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <ol className="relative space-y-3 border-l pl-5" data-testid="course-timeline">
          {h.entries.map((e, i) => {
            const older = h.entries.slice(i + 1).find((o) => o.structured);
            return (
              <li
                key={`${e.kind}-${e.id}`}
                className="relative"
                data-testid="history-entry"
                data-kind={e.kind}
              >
                <span
                  aria-hidden
                  className="absolute -left-[27px] top-4 h-3 w-3 rounded-full border-2 border-white bg-[var(--bits-navy)]"
                />
                <Card>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.semesterName}</span>
                        {e.kind === 'past' ? (
                          <Pill tone="gray">Past BITS handout</Pill>
                        ) : e.status ? (
                          e.published && e.status !== 'PUBLISHED' ? (
                            <Pill tone="navy">Published</Pill>
                          ) : (
                            <StatusBadge status={e.status} />
                          )
                        ) : null}
                        <span className="text-muted-foreground text-xs">
                          {e.kind === 'hmp' ? 'HMP handout' : 'Imported from the BITS Word file'}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm">
                        {[
                          e.faculty.join(', ') || null,
                          e.refNo,
                          e.publishedAt
                            ? `Published ${formatDate(e.publishedAt)}`
                            : `Updated ${formatDate(e.updatedAt)}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <Link
                        href={e.href}
                        className="bg-background hover:bg-accent rounded-md border px-3 py-1.5 font-medium"
                        data-testid="history-open"
                      >
                        Open
                      </Link>
                      {older && e.structured && (
                        <Link
                          href={`${e.href}?cmp=${older.kind}:${older.id}`}
                          className="rounded-md border px-3 py-1.5 font-medium text-[var(--bits-navy)] hover:bg-[var(--bits-blue-tint)]"
                          data-testid="history-compare"
                        >
                          Compare with previous
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
