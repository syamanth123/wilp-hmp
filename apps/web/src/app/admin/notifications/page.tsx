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
import { channelLabel } from '@/lib/labels';

/** "handout.rework_requested" → "Rework requested". */
function eventName(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
          <CardTitle>Time limits</CardTitle>
          <CardDescription>How many hours each step may take.</CardDescription>
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
          <CardTitle>Send reminders</CardTitle>
          <CardDescription>
            Check every open request now and send due-soon and overdue reminders to the people who
            have it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunSweepPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message templates</CardTitle>
          <CardDescription>
            Read-only. Words in {'{{double braces}}'} are filled in when the message is sent, e.g.
            the request number.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Channels</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-xs">{eventName(t.key)}</TableCell>
                  <TableCell>{t.subject}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {t.channels.map((c) => (
                      <Badge key={c} variant="secondary">
                        {channelLabel(c)}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {t.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Inactive</Badge>
                    )}
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
