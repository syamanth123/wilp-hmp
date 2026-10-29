import { prisma } from '@hmp/db';
import { actionSentence, statusLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';

export async function StatusTimeline({ requestId }: { requestId: string }) {
  const logs = await prisma.auditLog.findMany({
    where: {
      OR: [{ requestId }, { entity: 'HandoutRequest', entityId: requestId }],
    },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, email: true } } },
  });

  if (logs.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }

  return (
    <ol className="space-y-3 border-l pl-4">
      {logs.map((log) => {
        const after = (log.after as { status?: string } | null) ?? null;
        return (
          <li key={log.id} className="relative">
            <span className="bg-primary absolute -left-[21px] top-1 h-2 w-2 rounded-full" />
            <div className="text-sm">
              <span className="font-medium">{actionSentence(log.action)}</span>
              {after?.status && (
                <span className="text-muted-foreground ml-2">
                  · now {statusLabel(after.status)}
                </span>
              )}
            </div>
            <div className="text-muted-foreground text-xs">
              {log.actor?.name ?? 'Automatic'} · {formatDateTime(log.createdAt)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
