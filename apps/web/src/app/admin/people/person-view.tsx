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
import { WelcomeButton } from './welcome-button';
import { AwayForm, EndAwayButton } from '@/app/settings/forms';
import { BACKUP_ROLES, backupCandidates, isAway } from '@/lib/away';
import { formatDueDay } from '@/lib/deadlines';
import { formatDateTime } from '@/lib/format-date';
import { endAwayForAction, setAwayForAction } from './actions';

/**
 * People → a person: edit details, roles and department (with the impact check). The Instruction
 * Cell sees an Admin account read-only.
 */
export async function PersonView({
  base,
  id,
  leaving = false,
  undone = false,
}: {
  base: PeopleBase;
  id: string;
  /** v1.4.2 (F13): opened from "Deactivate…" — Active starts unticked; Save shows their open work to hand over. */
  leaving?: boolean;
  /** v1.4.2: just undone (the page reopened after Undo). */
  undone?: boolean;
}) {
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
        accessVersion: true,
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
  const welcomeSent = await prisma.auditLog.findFirst({
    where: { action: 'user.welcome', entity: 'User', entityId: u.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  // v1.4.2 (§4): the IC / Admin can mark the person away, with a back-up.
  const roleNames = u.roles.map((r) => r.role.name);
  const [pref, backupOptions] = await Promise.all([
    prisma.userPreference.findUnique({
      where: { userId: u.id },
      select: {
        awayFrom: true,
        awayUntil: true,
        backupUserId: true,
        backupUser: { select: { name: true } },
      },
    }),
    backupCandidates({ id: u.id, roles: roleNames, departmentId: u.departmentId }),
  ]);
  const isoIst = (d: Date | null | undefined) =>
    d ? new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) : '';
  const canEditAway = u.active && (viewerIsAdmin || !roleNames.includes(RoleName.ADMIN));
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
        {undone && !undo ? (
          <p
            className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            role="status"
            data-testid="undo-done"
          >
            Undone. Their menu changes on their next page.
          </p>
        ) : null}
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
        {leaving && u.active ? (
          <p
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            data-testid="person-leaving"
          >
            <strong>Deactivating {u.name}.</strong> Active is unticked below. Press{' '}
            <strong>Save</strong>: HMP lists their open work and asks who takes each item over, then
            switches the account off and ends their session. They are also removed as anyone&apos;s
            back-up.
          </p>
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
            key={u.accessVersion}
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
              active: leaving ? false : u.active,
            }}
          />
        )}
        {canEditAway ? (
          <div className="mt-6 space-y-3 border-t pt-4" data-testid="person-away">
            <h3 className="text-sm font-semibold">Away</h3>
            {isAway(pref) && pref?.awayUntil ? (
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Away until <strong>{formatDueDay(pref.awayUntil)}</strong>
                  {pref.backupUser ? ` · back-up ${pref.backupUser.name}` : ''}.
                </span>
                <EndAwayButton end={endAwayForAction.bind(null, u.id)} label="Back now" />
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                On leave? Set the dates and who looks after their requests meanwhile. They can do
                this themselves in My settings.
              </p>
            )}
            <AwayForm
              from={isoIst(pref?.awayFrom)}
              until={isoIst(pref?.awayUntil)}
              backupId={pref?.backupUserId ?? ''}
              options={backupOptions}
              needsBackup={roleNames.some((r) => BACKUP_ROLES.includes(r))}
              save={setAwayForAction.bind(null, u.id)}
              personName={u.name}
            />
          </div>
        ) : null}
        {u.active && (viewerIsAdmin || !u.roles.some((r) => r.role.name === RoleName.ADMIN)) ? (
          <div className="mt-6 space-y-2 border-t pt-4" data-testid="person-welcome-card">
            <h3 className="text-sm font-semibold">Welcome email</h3>
            <WelcomeButton
              userId={u.id}
              lastSent={welcomeSent ? formatDateTime(welcomeSent.createdAt) : null}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
