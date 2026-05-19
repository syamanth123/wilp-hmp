import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, RoleName } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { SemesterDatesForm } from './form';

export const dynamic = 'force-dynamic';

export default async function SemesterEditPage({ params }: { params: { id: string } }) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const semester = await prisma.semester.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      year: true,
      term: true,
      startDate: true,
      endDate: true,
      examDate: true,
      ec1Deadline: true,
      programme: { select: { code: true, name: true } },
    },
  });
  if (!semester) notFound();

  const toInputDate = (d: Date | null) =>
    d ? new Date(d).toISOString().slice(0, 10) : '';

  return (
    <div className="space-y-4">
      <Link
        href="/ic/semesters"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to semesters
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>
            {semester.programme.code} · {semester.name}
          </CardTitle>
          <CardDescription>
            {semester.programme.name} · {semester.term} · {semester.year}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Term start">{new Date(semester.startDate).toLocaleDateString()}</Field>
          <Field label="Term end">{new Date(semester.endDate).toLocaleDateString()}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exam date &amp; EC1 deadline</CardTitle>
          <CardDescription>
            Used for publish-phase reminders and propagated to LMS sync. Clear a field to remove
            the date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SemesterDatesForm
            semesterId={semester.id}
            examDate={toInputDate(semester.examDate)}
            ec1Deadline={toInputDate(semester.ec1Deadline)}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-muted-foreground text-xs uppercase tracking-wide">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

