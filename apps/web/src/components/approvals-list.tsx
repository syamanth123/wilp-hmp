import { prisma, ApprovalDecision } from '@hmp/db';
import { Badge } from '@hmp/ui';

const DECISION_VARIANT: Record<ApprovalDecision, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
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
    return <p className="text-sm text-muted-foreground">No approvals yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {approvals.map((a) => (
        <li key={a.id} className="flex items-start justify-between gap-3 border-b pb-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{a.stage.replace(/_/g, ' ')}</span>
              <Badge variant={DECISION_VARIANT[a.decision]}>{a.decision}</Badge>
            </div>
            {a.comments && <p className="mt-1 text-muted-foreground">{a.comments}</p>}
          </div>
          <div className="whitespace-nowrap text-right text-xs text-muted-foreground">
            <div>{a.reviewer.name}</div>
            <div>{new Date(a.createdAt).toLocaleString()}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
