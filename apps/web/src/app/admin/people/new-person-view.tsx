import { prisma, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import type { PeopleBase } from '@/lib/people-access';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { PersonForm } from './person-form';

/** People → Add person (v1.4). No password: they sign in with their BITS ID. */
export async function NewPersonView({ base }: { base: PeopleBase }) {
  const me = await getSessionUser();
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
          base={base}
          canGrantAdmin={!!me?.roles.includes(RoleName.ADMIN)}
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
