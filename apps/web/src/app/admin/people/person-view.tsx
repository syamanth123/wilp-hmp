import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { loadText, openWork } from '@/lib/people';
import { suggestDepartments, suggestionText } from '@/lib/departments';
import { roleLabel } from '@/lib/labels';
import type { PeopleBase } from '@/lib/people-access';
import { PersonForm } from './person-form';
import { lastUndoable } from '@/lib/people-undo';
import { UndoChange } from './undo-change';

/**
 * People → a person: edit details, roles and department (with the impact check). The Instruction
 * Cell sees an Admin account read-only.
 */
export async function PersonView({ base, id }: { base: PeopleBase; id: string }) {
  const me = await getSessionUser();
  const viewerIsAdmin = !!me?.roles.includes(RoleName.ADMIN);
  const [u, departments] = await Promise.all([
    prisma.user.findUnique({
      where: { id },
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
  // v1.4.2: the latest role / department change can be undone for 24 hours (not an Admin account by the IC).
  const undo = await lastUndoable(u.id);
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
          {loadText({
            open: work.length,
            overdue: work.filter((w) => w.overdue).length,
            dueThisWeek: work.filter((w) => w.dueThisWeek).length,
          })}
          . Changes take effect on their next page — no need to sign out.{' '}
          <Link href={`${base}/people`} className="underline">
            Back to People
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {undo && (viewerIsAdmin || !u.roles.some((r) => r.role.name === RoleName.ADMIN)) ? (
          <UndoChange
            userId={u.id}
            auditId={undo.auditId}
            text={`Changed by ${undo.actorName} on ${undo.atText}`}
            changes={undo.changes}
            handedOver={undo.handedOver}
            until={undo.untilText}
          />
        ) : null}
        {!viewerIsAdmin && u.roles.some((r) => r.role.name === RoleName.ADMIN) ? (
          <div className="space-y-2 text-sm" data-testid="person-admin-readonly">
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
              This is an Admin account. Only an Admin can change it.
            </p>
            <p>
              <span className="text-muted-foreground">Email:</span>{' '}
              <span className="font-mono">{u.email}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Roles:</span>{' '}
              {u.roles.map((r) => roleLabel(r.role.name)).join(', ')}
            </p>
            <p>
              <span className="text-muted-foreground">Department:</span>{' '}
              {departments.find((d) => d.id === u.departmentId)?.name ?? 'All'}
            </p>
          </div>
        ) : (
          <PersonForm
            base={base}
            canGrantAdmin={viewerIsAdmin}
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
        )}
      </CardContent>
    </Card>
  );
}
