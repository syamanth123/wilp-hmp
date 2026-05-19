import { prisma, RoleName } from '@hmp/db';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { UserCreateForm } from './user-form';
import { ToggleActiveButton } from './toggle-active-button';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    include: { roles: { include: { role: true } } },
  });
  return (
    <div className="space-y-6">
      <UserCreateForm roles={Object.values(RoleName)} />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Faculty Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono text-xs">{u.email}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell className="flex flex-wrap gap-1">
                  {u.roles.map((r) => (
                    <Badge key={r.roleId} variant="secondary">
                      {r.role.name}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell>{u.facultyType ?? '—'}</TableCell>
                <TableCell>
                  {u.active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
                </TableCell>
                <TableCell>
                  <ToggleActiveButton userId={u.id} active={u.active} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
