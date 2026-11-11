import { statusLabel } from '@/lib/labels';
import { formatDateTime } from '@/lib/format-date';
import { requestTimeline } from '@/lib/request-timeline';

export async function StatusTimeline({ requestId }: { requestId: string }) {
  const entries = await requestTimeline(requestId);

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No activity yet.</p>;
  }

  return (
    <ol className="space-y-3 border-l pl-4">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span className="bg-primary absolute -left-[21px] top-1 h-2 w-2 rounded-full" />
          <div className="text-sm">
            <span className="font-medium">{e.sentence}</span>
            {e.status && (
              <span className="text-muted-foreground ml-2">· now {statusLabel(e.status)}</span>
            )}
          </div>
          {e.detail ? (
            <div className="text-sm" data-testid="timeline-detail">
              {e.detail}
            </div>
          ) : null}
          <div className="text-muted-foreground text-xs">
            {e.actorName ?? 'Automatic'} · {formatDateTime(e.at)}
          </div>
        </li>
      ))}
    </ol>
  );
}
