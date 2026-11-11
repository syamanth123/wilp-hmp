import { redirect } from 'next/navigation';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { loadKickoff } from '@/lib/kickoff';
import { rememberChoice, rememberedChoice } from '@/lib/preferences';
import { KickoffList } from './kickoff-list';

export const dynamic = 'force-dynamic';

/** v1.4.2 — IC → Kick off a semester (docs/plans/v1.4.2-workload.md §6.1). */
export default async function KickoffPage({ searchParams }: { searchParams: { term?: string } }) {
  const me = await getSessionUser();
  if (!me) redirect('/api/session-ended');
  const asked = searchParams.term ?? (await rememberedChoice(me.id, 'kickoffTerm'));
  const k = await loadKickoff(me, asked);
  if (searchParams.term && k.term === searchParams.term)
    await rememberChoice(me.id, 'kickoffTerm', k.term);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle>Kick off a semester</CardTitle>
            <CardDescription>
              Every Course Dibba course of the semester that has no request yet. Tick, check, and
              create them in one go — each goes to its department&apos;s HOG with its due dates. The
              faculty&apos;s editor starts from the last handout when there is one.
            </CardDescription>
          </div>
          <form method="get" action="/ic/kick-off" className="flex items-center gap-2 text-sm">
            <label htmlFor="ko-term">Semester</label>
            <select
              id="ko-term"
              name="term"
              defaultValue={k.term ?? ''}
              className="rounded-md border bg-white px-2 py-1.5"
            >
              {k.terms.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border bg-white px-3 py-1.5">
              Show
            </button>
          </form>
        </div>
      </CardHeader>
      <CardContent>
        {k.term && k.rows.length ? (
          <KickoffList term={k.term} termText={k.termText} rows={k.rows} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Every scheduled course of {k.termText} already has a request.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
