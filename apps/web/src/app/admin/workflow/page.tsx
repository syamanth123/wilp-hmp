import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import Link from 'next/link';
import { SwitchesForm, WorkflowConfigForm } from './workflow-form';
import { LEVEL_TEXT, planRun, tomorrowsRun } from '@/lib/escalation';
import { taxilaSettings } from '@/lib/taxila-publish';
import { formatDueDay } from '@/lib/deadlines';
import type { HandoutStatus } from '@hmp/db';
import { statusLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

const LIFECYCLE: ReadonlyArray<readonly [HandoutStatus, string]> = [
  ['REQUESTED', 'raised by the Instruction Cell'],
  ['ALLOCATED', 'the Programme Committee can confirm or send it back'],
  ['ASSIGNED', 'the faculty member accepts it'],
  ['IN_PROGRESS', 'the faculty member writes and submits'],
  ['SME_REVIEW', 'the subject expert approves or asks for changes'],
  ['SUBMITTED', 'the Programme Committee approves or asks for changes'],
  ['UNDER_REVIEW', 'the Head of Group approves, asks for changes or rejects'],
  ['APPROVED', 'the Instruction Cell publishes it'],
  ['PUBLISHED', 'students can see it on Taxila'],
  ['ARCHIVED', 'kept for the record'],
];

export default async function WorkflowConfigPage() {
  const config = await prisma.workflowConfig.findUniqueOrThrow({ where: { key: 'default' } });
  // H26: before switching escalation on, see what the next morning's run would send with it on.
  const runAt = tomorrowsRun();
  const plan = await planRun(runAt, { escalationOn: true });
  const count = (pred: (l: number) => boolean) => plan.filter((p) => pred(p.level)).length;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Due dates and time allowed</CardTitle>
          <CardDescription>
            Used for &ldquo;My work&rdquo;, the dashboard, the Library, reminders and calendars.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowConfigForm config={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Escalation and auto-publish</CardTitle>
          <CardDescription>The daily run is at 09:00 (India time).</CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchesForm
            escalationOn={config.escalationOn}
            escalationDays={config.escalationDays}
            autoPublish={config.autoPublish}
            taxilaOn={!!taxilaSettings()}
          />
        </CardContent>
      </Card>

      <Card data-testid="run-preview">
        <CardHeader>
          <CardTitle className="text-base">
            What tomorrow&apos;s run would send{config.escalationOn ? '' : ' with escalation on'}
          </CardTitle>
          <CardDescription>
            {formatDueDay(runAt)}, 09:00 — nothing is sent from this page.{' '}
            <strong>{count((l) => l === 0)}</strong> due soon ·{' '}
            <strong>{count((l) => l === 1)}</strong> overdue (to the person) ·{' '}
            <strong>{count((l) => l === 2)}</strong> with a copy to the HOG ·{' '}
            <strong>{count((l) => l === 3)}</strong> with a copy to the Instruction Cell.
            {config.escalationOn ? null : ' With escalation off, only the first two are sent.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {plan.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing is due or overdue tomorrow.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-2 pr-3 font-medium">Handout</th>
                  <th className="py-2 pr-3 font-medium">Step</th>
                  <th className="py-2 pr-3 font-medium">Due</th>
                  <th className="py-2 pr-3 font-medium">Message</th>
                  <th className="py-2 pr-3 font-medium">Who is told</th>
                </tr>
              </thead>
              <tbody>
                {plan.map((p) => (
                  <tr
                    key={p.requestId}
                    className="border-b align-top"
                    data-testid="run-preview-row"
                  >
                    <td className="py-2 pr-3">
                      <Link href={`/ic/requests/${p.requestId}`}>{p.refNo}</Link>
                      <div className="text-muted-foreground text-xs">{p.course}</div>
                    </td>
                    <td className="py-2 pr-3">{p.stageLabel}</td>
                    <td className="py-2 pr-3">
                      {p.dueText}
                      {p.daysOverdue ? (
                        <div className="text-xs font-semibold text-red-700">
                          {p.daysOverdue} days overdue
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{LEVEL_TEXT[p.level]}</td>
                    <td className="py-2 pr-3">{p.told.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How a handout moves</CardTitle>
          <CardDescription>
            From request to archive. The badge on each request shows its step.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {LIFECYCLE.map(([status, note]) => (
              <li key={status}>
                <span className="font-medium">{statusLabel(status)}</span>
                {note ? <span className="text-muted-foreground"> — {note}</span> : null}
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground mt-3 text-sm">
            &ldquo;{statusLabel('REWORK_REQUESTED')}&rdquo; sends the handout back to the faculty
            member to revise and resubmit. &ldquo;{statusLabel('REJECTED')}&rdquo; ends it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
