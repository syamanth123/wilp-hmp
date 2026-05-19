import { prisma } from '@hmp/db';

export async function StatusTimeline({ requestId }: { requestId: string }) {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { requestId },
        { entity: 'HandoutRequest', entityId: requestId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, email: true } } },
  });

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }

  return (
    <ol className="space-y-3 border-l pl-4">
      {logs.map((log) => {
        const after = (log.after as { status?: string } | null) ?? null;
        return (
          <li key={log.id} className="relative">
            <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary" />
            <div className="text-sm">
              <span className="font-medium">{prettyAction(log.action)}</span>
              {after?.status && <span className="ml-2 text-muted-foreground">→ {after.status}</span>}
            </div>
            <div className="text-xs text-muted-foreground">
              {log.actor?.name ?? 'system'} · {new Date(log.createdAt).toLocaleString()}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function prettyAction(action: string): string {
  if (action.startsWith('handout.transition.')) {
    return action.replace('handout.transition.', '').replace(/_/g, ' ').toLowerCase();
  }
  return action;
}
