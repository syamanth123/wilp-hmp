import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { WorkflowConfigForm } from './workflow-form';

export const dynamic = 'force-dynamic';

export default async function WorkflowConfigPage() {
  const config = await prisma.workflowConfig.findUniqueOrThrow({ where: { key: 'default' } });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Workflow & Approval Matrix</CardTitle>
          <CardDescription>SLA timelines (hours) and approval matrix for handout lifecycle.</CardDescription>
        </CardHeader>
        <CardContent>
          <WorkflowConfigForm config={config} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle States</CardTitle>
          <CardDescription>Reference — defined in `@hmp/workflow`.</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
{`DRAFT → REQUESTED → ALLOCATED → ASSIGNED → IN_PROGRESS → SUBMITTED
                                       ↘ REWORK_REQUESTED ↗
SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED → ARCHIVED
                       ↘ REJECTED`}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
