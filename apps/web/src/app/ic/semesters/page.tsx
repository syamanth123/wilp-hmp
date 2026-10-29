import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import {
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
  Badge,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { formatDate } from '@/lib/format-date';
import { termLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

function fmt(d: Date | null): string {
  return d ? formatDate(d) : '—';
}

export default async function ICSemestersPage({
  searchParams,
}: {
  searchParams?: { programme?: string };
}) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const programmes = await prisma.programme.findMany({
    where: { active: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  const programmeFilter = searchParams?.programme;
  const semesters = await prisma.semester.findMany({
    where: programmeFilter ? { programmeId: programmeFilter } : undefined,
    orderBy: [{ year: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      year: true,
      term: true,
      examDate: true,
      ec1Deadline: true,
      startDate: true,
      endDate: true,
      programme: { select: { code: true, name: true } },
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Semesters &amp; key dates</CardTitle>
          <CardDescription>
            Update <strong>exam date</strong> and <strong>EC1 deadline</strong> per semester. These
            dates drive the reminders and are sent to Taxila when a handout is published.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="get" className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="programme" className="text-muted-foreground">
              Filter by programme:
            </label>
            <select
              id="programme"
              name="programme"
              defaultValue={programmeFilter ?? ''}
              className="bg-background rounded-md border px-2 py-1 text-sm"
            >
              <option value="">All programmes</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="bg-background hover:bg-accent rounded-md border px-3 py-1 text-sm"
            >
              Apply
            </button>
            {programmeFilter && (
              <Link
                href="/ic/semesters"
                className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1 text-sm"
              >
                Clear
              </Link>
            )}
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Programme</TableHead>
                <TableHead>Semester</TableHead>
                <TableHead>Term</TableHead>
                <TableHead>Exam date</TableHead>
                <TableHead>EC1 deadline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {semesters.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    No semesters found.
                  </TableCell>
                </TableRow>
              ) : (
                semesters.map((s) => {
                  const missing = !s.examDate || !s.ec1Deadline;
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs">
                        {s.programme.code}
                        <div className="text-muted-foreground">{s.programme.name}</div>
                      </TableCell>
                      <TableCell>
                        {s.name} <span className="text-muted-foreground">({s.year})</span>
                      </TableCell>
                      <TableCell className="text-xs">{termLabel(s.term)}</TableCell>
                      <TableCell>{fmt(s.examDate)}</TableCell>
                      <TableCell>{fmt(s.ec1Deadline)}</TableCell>
                      <TableCell>
                        {missing ? (
                          <Badge variant="secondary">Dates missing</Badge>
                        ) : (
                          <Badge variant="success">Complete</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/ic/semesters/${s.id}`}
                          className="text-primary text-sm underline-offset-4 hover:underline"
                        >
                          Edit dates
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
