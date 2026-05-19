import { prisma } from '@hmp/db';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const roles = await prisma.role.findMany({
    orderBy: { name: 'asc' },
    include: { permissions: { include: { permission: true } }, users: true },
  });
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>Permissions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.users.length}</TableCell>
              <TableCell className="flex flex-wrap gap-1">
                {r.permissions.map((rp) => (
                  <Badge key={rp.permissionId} variant="outline">
                    {rp.permission.key}
                  </Badge>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
