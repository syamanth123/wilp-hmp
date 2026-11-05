import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { loadText, openWork } from '@/lib/people';
import { suggestDepartments, suggestionText } from '@/lib/departments';
import { PersonForm } from '../person-form';

export const dynamic = 'force-dynamic';

/** Admin → People → a person: edit details, roles and department (with the impact check). */
export default async function PersonPage({ params }: { params: { id: string } }) {
  const [u, departments] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        facultyType: true,
        departmentId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
    prisma.department.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  if (!u) notFound();
  const work = (await openWork([u.id])).get(u.id) ?? [];
  // H6: no department yet → what the courses they taught suggest (applied only with "Use it").
  const s = u.departmentId ? undefined : (await suggestDepartments([u.id])).get(u.id);
  const suggestion = s
    ? { departmentId: s.kind === 'one' ? s.departmentId : null, text: suggestionText(s) }
    : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{u.name}</CardTitle>
        <CardDescription>
          {loadText({ open: work.length, overdue: work.filter((w) => w.overdue).length })}. Changes
          take effect on their next page — no need to sign out.{' '}
          <Link href="/admin/people" className="underline">
            Back to People
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PersonForm
          departments={departments}
          suggestion={suggestion}
          person={{
            id: u.id,
            name: u.name,
            email: u.email,
            roles: u.roles.map((r) => r.role.name),
            departmentId: u.departmentId,
            facultyType: u.facultyType,
            active: u.active,
          }}
        />
      </CardContent>
    </Card>
  );
}
