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

export const dynamic = 'force-dynamic';

const HEARTBEAT_STALE_MS = 5 * 60 * 1000; // 5 min

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
        ✓ Worker heartbeat {Math.round((Date.now() - view.heartbeatMs!) / 1000)}s ago
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
        ⚠ Workers may not be running
      </div>
      <p className="text-sm" style={{ color: '#7c2d12', margin: '4px 0 0' }}>
        No recent heartbeat for the <strong>{view.name}</strong> queue
        {view.heartbeatMs
          ? ` (last seen ${Math.round((Date.now() - view.heartbeatMs) / 60000)} min ago)`
          : ''}
        . Jobs will queue but not process until a worker is started. See the{' '}
        <Link href="/docs" className="underline underline-offset-2">
          deployment runbook
        </Link>{' '}
        — run <code>pnpm workers</code> alongside the web service.
      </p>
    </div>
  );
}

function QueueCard({ view }: { view: QueueView }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="capitalize">{view.name} queue</CardTitle>
          <ClearCompletedButton queue={view.name} />
        </div>
        <CardDescription>
          <HeartbeatBanner view={view} />
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {view.error ? (
          <p className="text-destructive text-sm">Queue unavailable: {view.error}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">waiting {view.counts.waiting}</Badge>
              <Badge variant="secondary">active {view.counts.active}</Badge>
              <Badge variant="success">completed {view.counts.completed}</Badge>
              <Badge variant={view.counts.failed > 0 ? 'destructive' : 'outline'}>
                failed {view.counts.failed}
              </Badge>
            </div>

            {view.name === 'notifications' && (
              <p className="text-muted-foreground text-xs">
                Per-recipient delivery status (SENT / FAILED) is tracked on the Notification rows,
                not here — this view shows job-level processing only.{' '}
                <Link href="/admin/notifications" className="underline underline-offset-2">
                  View notification delivery →
                </Link>
              </p>
            )}

            {view.failed.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failed jobs.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job ID</TableHead>
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
                        {j.failedAt ? new Date(j.failedAt).toLocaleString() : '—'}
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
          <CardTitle>Queues</CardTitle>
          <CardDescription>Background job queues (BullMQ / Redis).</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Redis is not configured (<code>REDIS_URL</code> unset). Notifications and AI reports run
            synchronously inline; there are no queues to inspect. Set <code>REDIS_URL</code> and run{' '}
            <code>pnpm workers</code> to enable background processing.
          </p>
        </CardContent>
      </Card>
    );
  }

  const [notifications, ai] = await Promise.all([
    loadQueue('notifications', getNotificationsQueue()),
    loadQueue('ai', getAiQueue()),
  ]);

  return (
    <div className="space-y-4">
      <QueueCard view={notifications} />
      <QueueCard view={ai} />
    </div>
  );
}
