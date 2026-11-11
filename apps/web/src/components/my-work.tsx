import Link from 'next/link';
import { getSessionUser } from '@hmp/auth';
import { loadMyWork, type WorkItem } from '@/lib/my-work';

/**
 * v1.4.2 — "My work" at the top of every home page: what needs this person's action, soonest due first
 * (docs/plans/v1.4.2-workload.md §3).
 */

const ROLE_TAG: Record<WorkItem['role'], string> = {
  HOG: 'HOG',
  PC: 'PC',
  FACULTY: 'Faculty',
  SME: 'SME',
  IC: 'IC',
};

const TONE_CLASS: Record<NonNullable<WorkItem['tone']>, string> = {
  overdue: 'text-red-700 font-semibold',
  soon: 'text-amber-800 font-semibold',
  ok: 'text-muted-foreground',
};

function Row({ i, multiRole }: { i: WorkItem; multiRole: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5" data-testid="my-work-item">
      <div className="min-w-0 flex-1">
        <Link href={i.href} className="font-medium no-underline hover:underline">
          {i.todo}: {i.courseCode} {i.courseTitle}
        </Link>
        <div className="text-muted-foreground text-xs">
          {i.refNo} · {i.semester}
          {multiRole ? <> · as {ROLE_TAG[i.role]}</> : null}
          {i.forName ? (
            <span
              className="ml-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-900"
              data-testid="my-work-for"
            >
              for {i.forName} (away)
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right text-sm">
        {i.dueLabel ? (
          <>
            <div>due {i.dueLabel}</div>
            <div className={TONE_CLASS[i.tone ?? 'ok']}>{i.dueText}</div>
          </>
        ) : (
          <span className="text-muted-foreground">no due date</span>
        )}
      </div>
    </li>
  );
}

export async function MyWork({ limit = 8 }: { limit?: number }) {
  const me = await getSessionUser();
  if (!me) return null;
  const items = await loadMyWork(me);
  const multiRole = new Set(items.map((i) => i.role)).size > 1;
  const shown = items.slice(0, limit);
  const overdue = items.filter((i) => i.tone === 'overdue').length;

  return (
    <section
      className="glass-panel mb-6 rounded-[10px] p-5"
      data-testid="my-work"
      aria-labelledby="my-work-title"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="my-work-title"
          style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 20, margin: 0 }}
        >
          My work
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {items.length === 0
              ? ''
              : `${items.length} item${items.length === 1 ? '' : 's'}${overdue ? ` · ${overdue} overdue` : ''}`}
          </span>
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="my-work-empty">
          Nothing needs you right now.
        </p>
      ) : (
        <>
          <ul className="divide-border divide-y">
            {shown.map((i) => (
              <Row key={`${i.requestId}:${i.role}`} i={i} multiRole={multiRole} />
            ))}
          </ul>
          {items.length > limit ? (
            <details className="mt-1 text-sm">
              <summary className="text-muted-foreground cursor-pointer">
                {items.length - limit} more
              </summary>
              <ul className="divide-border divide-y">
                {items.slice(limit).map((i) => (
                  <Row key={`${i.requestId}:${i.role}`} i={i} multiRole={multiRole} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
