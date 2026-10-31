import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { WorkflowConfigForm } from './workflow-form';
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
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workflow & Approval Matrix</CardTitle>
          <CardDescription>
            SLA timelines (hours) and approval matrix for handout lifecycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowConfigForm config={config} />
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
