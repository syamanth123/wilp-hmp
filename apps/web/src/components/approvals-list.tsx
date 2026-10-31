import type { ApprovalDecision } from '@hmp/db';
import { prisma } from '@hmp/db';
import { Badge } from '@hmp/ui';
import { decisionLabel, stageLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';

const DECISION_VARIANT: Record<
  ApprovalDecision,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  APPROVED: 'success',
  REWORK: 'warning',
  REJECTED: 'destructive',
};

export async function ApprovalsList({ requestId }: { requestId: string }) {
  const approvals = await prisma.approval.findMany({
    where: { requestId },
    orderBy: { createdAt: 'asc' },
    include: { reviewer: { select: { name: true, email: true } } },
  });

  if (approvals.length === 0) {
    return <p className="text-muted-foreground text-sm">No approvals yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {approvals.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 border-b pb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{stageLabel(a.stage)}</span>
              <Badge variant={DECISION_VARIANT[a.decision]}>{decisionLabel(a.decision)}</Badge>
            </div>
            {a.comments && <p className="text-muted-foreground mt-1">{a.comments}</p>}
          </div>
          <div className="text-muted-foreground whitespace-nowrap text-right text-xs">
            <div>{a.reviewer.name}</div>
            <div>{formatDateTime(a.createdAt)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
