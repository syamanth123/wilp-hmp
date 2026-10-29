import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@hmp/ui';
import { UserCreateForm } from './user-form';
import { ToggleActiveButton } from './toggle-active-button';

export const dynamic = 'force-dynamic';

/**
 * ?show=active lists active accounts only — what the admin overview's
 * "Users · Active accounts" card counts. Anything else shows every account.
 */
export default async function UsersPage({ searchParams }: { searchParams?: { show?: string } }) {
  const activeOnly = searchParams?.show === 'active';
  const users = await prisma.user.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { createdAt: 'desc' },
    include: { roles: { include: { role: true } } },
  });
  return (
    <div className="space-y-6">
      <UserCreateForm roles={Object.values(RoleName)} />
      <p className="text-muted-foreground text-sm">
        {activeOnly ? (
          <>
            Showing: <span className="text-foreground font-medium">Active accounts</span> ·{' '}
          </>
        ) : null}
        <span data-testid="list-total">{users.length}</span>{' '}
        {users.length === 1 ? 'account' : 'accounts'}
        {' · '}
        {activeOnly ? (
          <Link href="/admin/users" className="text-primary underline-offset-4 hover:underline">
            Show all
          </Link>
        ) : (
          <Link
            href="/admin/users?show=active"
            className="text-primary underline-offset-4 hover:underline"
          >
            Active only
          </Link>
        )}
      </p>
      <div className="rounded-md border">
        {users.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No accounts to show.</p>
        ) : (
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
                    {u.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <ToggleActiveButton userId={u.id} active={u.active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
