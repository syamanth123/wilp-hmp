import Link from 'next/link';
import { RoleName } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  isRedisConfigured,
  getNotificationsQueue,
  getAiQueue,
  readHeartbeat,
  type Queue,
} from '@hmp/queue';
import { FailedJobActions, ClearCompletedButton } from './queue-actions';
import { aiFeaturesEnabled } from '@/lib/features';
import { formatDateTime } from '@/lib/format-date';
import { within } from '@/lib/within';

export const dynamic = 'force-dynamic';

const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 min
const QUEUE_READ_LIMIT_MS = 2000;

interface QueueView {
  name: 'notifications' | 'ai';
  counts: { waiting: number; active: number; completed: number; failed: number };
  failed: { id: string; reason: string; attempts: number; failedAt: number | null }[];
  heartbeatMs: number | null;
  error: string | null;
}

async function loadQueue(name: 'notifications' | 'ai', queue: Queue): Promise<QueueView> {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    const failedJobs = await queue.getJobs(['failed'], 0, 49);
    const failed = failedJobs.map((j) => ({
      id: String(j.id),
      reason: (j.failedReason ?? '').slice(0, 200),
      attempts: j.attemptsMade,
      failedAt: j.finishedOn ?? null,
    }));
    const heartbeatMs = await readHeartbeat(name);
    return {
      name,
      counts: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
      },
      failed,
      heartbeatMs,
      error: null,
    };
  } catch (err) {
    return {
      name,
      counts: { waiting: 0, active: 0, completed: 0, failed: 0 },
      failed: [],
      heartbeatMs: null,
      error: (err as Error).message,
    };
  }
}

function HeartbeatBanner({ view }: { view: QueueView }) {
  const stale = view.heartbeatMs == null || Date.now() - view.heartbeatMs > HEARTBEAT_STALE_MS;
  if (!stale) {
    return (
      <p className="text-xs text-emerald-600">
        ✓ Background processor running (checked{' '}
        {Math.round((Date.now() - view.heartbeatMs!) / 1000)}s ago)
      </p>
    );
  }
  return (
    <div
      role="alert"
      style={{
        background: '#fff7ed',
        border: '1px solid #fdba74',
        borderLeft: '4px solid #ea580c',
        borderRadius: 8,
        padding: '10px 12px',
      }}
    >
      <div style={{ fontWeight: 700, color: '#9a3412', fontSize: 14 }}>
        ⚠ The background processor seems to have stopped
      </div>
      <p className="text-sm" style={{ color: '#7c2d12', margin: '4px 0 0' }}>
        Nothing has been picked up from this list recently
        {view.heartbeatMs
          ? ` (last activity ${Math.round((Date.now() - view.heartbeatMs) / 60000)} min ago)`
          : ''}
        . Waiting jobs will be sent once IT restarts the background processor.
      </p>
    </div>
  );
}

function QueueCard({ view }: { view: QueueView }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{view.name === 'ai' ? 'AI reports' : 'Emails and alerts'}</CardTitle>
          <ClearCompletedButton queue={view.name} />
        </div>
        <CardDescription>
          <HeartbeatBanner view={view} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.error ? (
          <p className="text-destructive text-sm">
            Couldn&apos;t read the background jobs right now. Refresh the page in a minute.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">Waiting {view.counts.waiting}</Badge>
              <Badge variant="secondary">Running {view.counts.active}</Badge>
              <Badge variant="success">Done {view.counts.completed}</Badge>
              <Badge variant={view.counts.failed > 0 ? 'destructive' : 'outline'}>
                Failed {view.counts.failed}
              </Badge>
            </div>

            {view.name === 'notifications' && (
              <p className="text-muted-foreground text-xs">
                To see whether each person got a message, open{' '}
                <Link href="/admin/notifications" className="underline underline-offset-2">
                  Notifications →
                </Link>
              </p>
            )}

            {view.failed.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failed jobs.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Failed</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.failed.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="font-mono text-xs">{j.id}</TableCell>
                      <TableCell className="max-w-sm text-xs">{j.reason || '—'}</TableCell>
                      <TableCell className="text-xs">{j.attempts}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {j.failedAt ? formatDateTime(j.failedAt) : '—'}
                      </TableCell>
                      <TableCell>
                        <FailedJobActions queue={view.name} jobId={j.id} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminQueuesPage() {
  requireRole(await getSessionUser(), RoleName.ADMIN);

  if (!isRedisConfigured()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Background jobs</CardTitle>
          <CardDescription>Emails waiting to be sent in the background.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Background processing is off on this server, so emails are sent straight away.
            There&apos;s nothing to show here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // The AI queue is shown only with AI_FEATURES_ENABLED=true.
  const aiEnabled = aiFeaturesEnabled();
  // Redis that is configured but not running makes queue reads wait forever
  // for a connection; stop waiting after 2 seconds and say so.
  const loaded = await within(
    () =>
      Promise.all([
        loadQueue('notifications', getNotificationsQueue()),
        aiEnabled ? loadQueue('ai', getAiQueue()) : Promise.resolve(null),
      ]),
    QUEUE_READ_LIMIT_MS,
  );
  if (!loaded.ok || loaded.value[0].error) {
    return (
      <Card data-testid="background-jobs-unavailable">
        <CardHeader>
          <CardTitle>Background jobs</CardTitle>
          <CardDescription>Emails waiting to be sent in the background.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">Background jobs are not running on this server.</p>
          <p className="text-muted-foreground mt-1 text-sm">
            The background service didn&apos;t answer, so nothing can be shown here. Ask IT to check
            that it is running.
          </p>
        </CardContent>
      </Card>
    );
  }
  const [notifications, ai] = loaded.value;

  return (
    <div className="space-y-4">
      <QueueCard view={notifications} />
      {ai && <QueueCard view={ai} />}
    </div>
  );
}
