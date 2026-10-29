import Link from 'next/link';
import { buttonVariants } from '@hmp/ui';
import { statusLabel } from '@/components/status-badge';
import { LIST_PATH, LIST_STATUSES, type ListFilter, type ListRole } from '@/lib/request-views';

/**
 * Filter row shared by the five request lists: a status picker in plain
 * words, the active dashboard view (with a way back to everything), a note
 * when the address carried a filter we couldn't use, and the total — which is
 * the number the matching dashboard card shows.
 */
export function RequestListToolbar({
  role,
  filter,
  total,
  showStatusFilter = true,
}: {
  role: ListRole;
  filter: ListFilter;
  total: number;
  showStatusFilter?: boolean;
}) {
  const path = LIST_PATH[role];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {filter.view ? (
            <>
              Showing: <span className="text-foreground font-medium">{filter.view.label}</span>
              {' · '}
            </>
          ) : null}
          <span data-testid="list-total">{total}</span> {total === 1 ? 'request' : 'requests'}
          {filter.view || filter.status ? (
            <>
              {' · '}
              <Link href={path} className="text-primary underline-offset-4 hover:underline">
                Show all
              </Link>
            </>
          ) : null}
        </p>
        {showStatusFilter && (
          <form className="flex gap-2 text-sm" action={path}>
            <label htmlFor={`${role}-status-filter`} className="sr-only">
              Status
            </label>
            <select
              id={`${role}-status-filter`}
              name="status"
              defaultValue={filter.status ?? ''}
              className="bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">All statuses</option>
              {LIST_STATUSES[role].map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Apply filter
            </button>
          </form>
        )}
      </div>
      {filter.ignored && (
        <p className="text-muted-foreground text-xs" data-testid="filter-ignored">
          The filter in the page address wasn&apos;t recognised, so all requests are shown.
        </p>
      )}
    </div>
  );
}
