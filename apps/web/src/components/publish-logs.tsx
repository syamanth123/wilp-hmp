import { prisma } from '@hmp/db';
import { Badge } from '@hmp/ui';

export async function PublishLogs({ handoutId }: { handoutId: string }) {
  const logs = await prisma.lmsPublishLog.findMany({
    where: { handoutId },
    orderBy: { publishedAt: 'desc' },
  });

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No publish attempts yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {logs.map((l) => (
        <li key={l.id} className="rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={l.status === 'success' ? 'success' : 'destructive'}>{l.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {new Date(l.publishedAt).toLocaleString()}
            </span>
          </div>
          {l.responseJson != null && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(l.responseJson, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}
