import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { PersonForm } from '../person-form';

export const dynamic = 'force-dynamic';

/** Admin → People → Add person (v1.4). No password: they sign in with their BITS ID. */
export default async function NewPersonPage() {
  const departments = await prisma.department.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a person</CardTitle>
        <CardDescription>
          They sign in with their BITS ID — the email must be their BITS email. Nothing to set up on
          their side.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PersonForm
          departments={departments}
          person={{
            name: '',
            email: '',
            roles: [],
            departmentId: null,
            facultyType: null,
            active: true,
          }}
        />
      </CardContent>
    </Card>
  );
}
