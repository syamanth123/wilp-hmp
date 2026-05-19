import { prisma } from '@hmp/db';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { loadWorkflowConfig } from '@/lib/sla';
import { RunSweepPanel } from './run-sweep-panel';

export const dynamic = 'force-dynamic';

export default async function NotificationsConfigPage() {
  const [templates, cfg] = await Promise.all([
    prisma.notificationTemplate.findMany({ orderBy: { key: 'asc' } }),
    loadWorkflowConfig(),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>SLA configuration</CardTitle>
          <CardDescription>Read-only summary of the active SLA window per stage.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <div className="text-muted-foreground">HOG review</div>
              <div className="text-2xl font-semibold">{cfg.hogReviewSla}h</div>
            </div>
            <div>
              <div className="text-muted-foreground">PC review</div>
              <div className="text-2xl font-semibold">{cfg.pcReviewSla}h</div>
            </div>
            <div>
              <div className="text-muted-foreground">Faculty submit</div>
              <div className="text-2xl font-semibold">{cfg.facultySubmitSla}h</div>
            </div>
            <div>
              <div className="text-muted-foreground">HOG final</div>
              <div className="text-2xl font-semibold">{cfg.hogFinalSla}h</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reminder sweep</CardTitle>
          <CardDescription>
            Manually scan active requests and emit due-soon / overdue notifications. Schedule the
            same endpoint (<code className="font-mono text-xs">POST /api/cron/reminders</code>) via
            Railway/Vercel cron with the <code className="font-mono text-xs">CRON_SECRET</code>{' '}
            bearer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunSweepPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Templates</CardTitle>
          <CardDescription>Read-only. Tokens like {'{{refNo}}'} are substituted at send time.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell>{t.subject}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {t.channels.map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {t.active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
