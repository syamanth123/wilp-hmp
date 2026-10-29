import { prisma } from '@hmp/db';
import { actionSentence, statusLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';

export async function StatusTimeline({ requestId }: { requestId: string }) {
  const allLogs = await prisma.auditLog.findMany({
    where: {
      OR: [{ requestId }, { entity: 'HandoutRequest', entityId: requestId }],
    },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { name: true, email: true } } },
  });

  // One action can write two log rows (the workflow step and the action's own
  // record). Rows saying the same thing within a minute are shown once,
  // keeping the one that carries the new status.
  const statusOf = (l: (typeof allLogs)[number]) =>
    (l.after as { status?: string } | null)?.status ?? null;
  const logs: typeof allLogs = [];
  for (const log of allLogs) {
    const last = logs[logs.length - 1];
    if (
      last &&
      actionSentence(last.action) === actionSentence(log.action) &&
      log.createdAt.getTime() - last.createdAt.getTime() < 60_000
    ) {
      if (!statusOf(last) && statusOf(log)) logs[logs.length - 1] = log;
      continue;
    }
    logs.push(log);
  }

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
