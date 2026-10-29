import { prisma } from '@hmp/db';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { roleLabel } from '@/lib/labels';

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
          {roles.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground">
                No roles set up yet.
              </TableCell>
            </TableRow>
          )}
          {roles.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{roleLabel(r.name)}</TableCell>
              <TableCell>{r.users.length}</TableCell>
              <TableCell className="flex flex-wrap gap-1">
                {r.permissions.map((rp) => (
                  <Badge key={rp.permissionId} variant="outline">
                    {rp.permission.label || rp.permission.key}
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
