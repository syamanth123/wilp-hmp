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

/** How each publish-log entry reads. Only a real failure is red. */
export function publishLogBadge(
  status: string,
  mode?: string | null,
): {
  label: string;
  variant: 'success' | 'secondary' | 'destructive';
} {
  switch (status) {
    case 'success':
      return {
        label: mode === 'TAXILA_FOLDER' ? 'Published to Taxila' : 'Published',
        variant: 'success',
      };
    case 'MANUALLY_CONFIRMED':
      return { label: 'Published (confirmed)', variant: 'success' };
    case 'EXPORTED':
      return { label: 'Export prepared', variant: 'secondary' };
    default:
      return { label: 'Failed', variant: 'destructive' };
  }
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
            <Badge variant={publishLogBadge(l.status, l.mode).variant}>
              {publishLogBadge(l.status, l.mode).label}
            </Badge>
            <span className="text-muted-foreground text-xs">{formatDateTime(l.publishedAt)}</span>
          </div>
          {l.mode === 'TAXILA_FOLDER' && <TaxilaDetail log={l} />}
          {l.status === 'failed' && l.mode !== 'TAXILA_FOLDER' && failureReason(l.responseJson) && (
            <p className="text-muted-foreground mt-1 text-xs">{failureReason(l.responseJson)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

const STEP: Record<string, string> = {
  search: 'Finding the course',
  folder: 'Finding the folder',
  pdf: 'Making the PDF',
  upload: 'Uploading',
  move: 'Moving into the folder',
  status: 'Marking it published',
};

/** Mode C (v1.3.0): the file and course it went to, or the step that failed. */
function TaxilaDetail({
  log,
}: {
  log: { status: string; externalRef: string | null; responseJson: unknown };
}) {
  const j = (log.responseJson ?? {}) as {
    fileName?: string | null;
    courseFullname?: string;
    semesterCode?: string;
    step?: string;
    message?: string;
  };
  if (log.status === 'success')
    return (
      <p className="text-muted-foreground mt-1 text-xs">
        “{j.fileName}” in{' '}
        {log.externalRef ? (
          <a href={log.externalRef} target="_blank" rel="noreferrer" className="underline">
            {j.courseFullname ?? 'the Taxila course'}
          </a>
        ) : (
          j.courseFullname
        )}{' '}
        ({j.semesterCode})
      </p>
    );
  return (
    <p className="text-muted-foreground mt-1 text-xs">
      {STEP[j.step ?? ''] ?? 'Publishing'}: {j.message}
    </p>
  );
}
