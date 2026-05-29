import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { RequestForm, type OfferingOption } from './request-form';

export default async function NewRequestPage() {
  // Filter out offerings whose Course was deactivated (e.g. the pre-Prompt-11b
  // invented codes the seed marks `active: false`). Matches the active-filter
  // convention already used in faculty-load / recommender / embeddings /
  // notifications. Admin views intentionally do NOT filter.
  const offerings = await prisma.courseOffering.findMany({
    where: { course: { active: true } },
    include: { course: true, semester: { include: { programme: true } } },
    orderBy: [{ semester: { name: 'asc' } }, { course: { code: 'asc' } }],
  });

  const options: OfferingOption[] = offerings.map((o) => ({
    id: o.id,
    courseCode: o.course.code,
    courseTitle: o.course.title,
    programmeCode: o.semester.programme.code,
    programmeName: o.semester.programme.name,
    semesterName: o.semester.name,
    slotInfo: o.slotInfo,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>New handout request</CardTitle>
        <CardDescription>
          Pick the course offering. The request will be created in DRAFT and immediately moved to
          REQUESTED.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No course offerings yet. Ask an admin to import offerings under{' '}
            <code>/admin/import</code>.
          </p>
        ) : (
          <RequestForm offerings={options} />
        )}
      </CardContent>
    </Card>
  );
}
