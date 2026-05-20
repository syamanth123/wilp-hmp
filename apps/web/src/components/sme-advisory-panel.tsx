import { Badge } from '@hmp/ui';

/**
 * Read-only render of SME nominations advising on a handout, shown on the
 * faculty assignment page. Lists ACCEPTED + COMPLETED nominations only —
 * PENDING means the SME hasn't engaged yet, DECLINED means they're not
 * involved.
 *
 * Faculty cannot interact with nominations from this view; the anchor link
 * scrolls to the existing comment thread on the same page (no separate
 * per-SME comment filtering — faculty want context from all advisors at
 * once, validated by product spec).
 */
export interface AdvisoryNomination {
  id: string;
  topic: string;
  status: 'ACCEPTED' | 'COMPLETED';
  completedAt: Date | null;
  smeUser: { name: string };
}

const STATUS_BADGE_VARIANT = {
  ACCEPTED: 'success',
  COMPLETED: 'outline',
} as const;

export function SmeAdvisoryPanel({
  nominations,
  commentAnchorId,
}: {
  nominations: AdvisoryNomination[];
  commentAnchorId: string;
}) {
  if (nominations.length === 0) return null;
  return (
    <ul className="divide-y rounded-md border">
      {nominations.map((n) => (
        <li key={n.id} className="flex items-start justify-between gap-3 p-3 text-sm">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{n.smeUser.name}</span>
              <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{n.status}</Badge>
              {n.status === 'COMPLETED' && n.completedAt && (
                <span className="text-muted-foreground text-xs">
                  completed {new Date(n.completedAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="mt-1 text-sm">{n.topic}</div>
          </div>
          <a
            href={`#${commentAnchorId}`}
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            View comments
          </a>
        </li>
      ))}
    </ul>
  );
}
