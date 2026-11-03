import Link from 'next/link';
import type { BitsHandoutV1 } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { HandoutCompareView } from '@/components/handout-compare-view';
import { CHANGE_SIZE_LABEL, compareHandouts } from '@/lib/handout-compare';

export interface CompareOption {
  value: string;
  label: string;
}

/**
 * The viewer's "Compare" card: pick another version (or last year's handout), see the two side by
 * side per section. A plain GET form — the choice lives in the address, like the library filters.
 */
export function ComparePanel({
  action,
  keep,
  options,
  selected,
  before,
  after,
  showUnchanged,
}: {
  /** The viewer's own path. */
  action: string;
  /** Address values to keep (e.g. the version being viewed). */
  keep: Record<string, string>;
  options: CompareOption[];
  selected: string;
  /** The chosen other handout (older side); undefined until one is picked. */
  before?: { label: string; href: string; data: BitsHandoutV1 | null } | null;
  after: { label: string; data: BitsHandoutV1 | null };
  showUnchanged: boolean;
}) {
  const comparison = before?.data && after.data ? compareHandouts(before.data, after.data) : null;
  return (
    <Card data-testid="compare-panel">
      <CardHeader>
        <CardTitle>Compare</CardTitle>
        <CardDescription>
          See what changed, section by section — objectives, books, sessions, evaluation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            There is nothing to compare this handout with yet.
          </p>
        ) : (
          <form method="get" action={action} className="flex flex-wrap items-end gap-2 text-sm">
            {Object.entries(keep).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div>
              <label htmlFor="cmp" className="text-muted-foreground mb-1 block text-xs">
                Compare “{after.label}” with
              </label>
              <select
                id="cmp"
                name="cmp"
                defaultValue={selected}
                className="border-input bg-background h-9 rounded-md border px-2"
                data-testid="compare-select"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex h-9 items-center gap-1 text-xs">
              <input type="checkbox" name="all" value="1" defaultChecked={showUnchanged} /> Show
              unchanged parts
            </label>
            <button
              type="submit"
              className="h-9 rounded-md bg-[var(--bits-navy)] px-3 font-medium text-white"
              data-testid="compare-go"
            >
              Compare
            </button>
          </form>
        )}

        {before === null && (
          <p className="text-muted-foreground text-sm">That handout isn’t available to compare.</p>
        )}
        {before && !comparison && (
          <p className="text-muted-foreground text-sm" data-testid="compare-unavailable">
            Comparison isn’t available for this version — it was written before handouts had
            sections.
          </p>
        )}
        {before && comparison && (
          <div className="space-y-3">
            <p className="text-sm" data-testid="compare-summary">
              <strong>{CHANGE_SIZE_LABEL[comparison.size]}</strong> — {comparison.changedRows} of{' '}
              {comparison.totalRows} items differ from{' '}
              <Link href={before.href} className="underline">
                {before.label}
              </Link>
              .
            </p>
            <HandoutCompareView
              comparison={comparison}
              beforeLabel={before.label}
              afterLabel={after.label}
              showUnchanged={showUnchanged}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
