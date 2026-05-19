import { prisma } from '@hmp/db';
import { Badge, Card, CardContent, CardHeader, CardTitle, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { ProgrammeCreateForm } from './programme-form';
import { CourseCreateForm } from './course-form';

export const dynamic = 'force-dynamic';

export default async function ProgrammesPage() {
  const [programmes, courses] = await Promise.all([
    prisma.programme.findMany({ orderBy: { code: 'asc' }, include: { semesters: true } }),
    prisma.course.findMany({ orderBy: { code: 'asc' } }),
  ]);

  return (
    <div className="space-y-6">
      <ProgrammeCreateForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Programmes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Semesters</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programmes.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono">{p.code}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell className="flex flex-wrap gap-1">
                    {p.semesters.map((s) => (
                      <Badge key={s.id} variant="secondary">
                        {s.name}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {p.active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CourseCreateForm />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Courses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono">{c.code}</TableCell>
                  <TableCell>{c.title}</TableCell>
                  <TableCell>{c.credits}</TableCell>
                  <TableCell>
                    {c.active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
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
