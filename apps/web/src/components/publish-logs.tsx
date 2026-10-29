import { prisma } from '@hmp/db';
import { Badge } from '@hmp/ui';
import { formatDateTime } from '@/lib/format-date';

/** One plain line about why a publish failed (never the raw response). */
function failureReason(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { message?: unknown; error?: unknown };
  const text =
    typeof j.message === 'string' ? j.message : typeof j.error === 'string' ? j.error : null;
  if (!text) return null;
  return /[a-z]_[a-z]/.test(text) && !/s/.test(text) ? 'Taxila did not accept the handout.' : text;
}

export async function PublishLogs({ handoutId }: { handoutId: string }) {
  const logs = await prisma.lmsPublishLog.findMany({
    where: { handoutId },
    orderBy: { publishedAt: 'desc' },
  });

  if (logs.length === 0) {
    return <p className="text-muted-foreground text-sm">No publish attempts yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {logs.map((l) => (
        <li key={l.id} className="rounded-md border p-2">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={l.status === 'success' ? 'success' : 'destructive'}>
              {l.status === 'success' ? 'Published' : 'Failed'}
            </Badge>
            <span className="text-muted-foreground text-xs">{formatDateTime(l.publishedAt)}</span>
          </div>
          {l.status !== 'success' && failureReason(l.responseJson) && (
            <p className="text-muted-foreground mt-1 text-xs">{failureReason(l.responseJson)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
