import { redirect } from 'next/navigation';
import { RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { getPreference } from '@/lib/preferences';
import { BACKUP_ROLES, backupCandidates, isAway } from '@/lib/away';
import { formatDueDay } from '@/lib/deadlines';
import { AwayForm, CalendarLink, EmailForm, EndAwayButton } from './forms';

export const dynamic = 'force-dynamic';

/** "2026-11-20" in India time, for the date fields. */
const isoIst = (d: Date | null | undefined) =>
  d ? new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) : '';

/** v1.4.2 — My settings: away / back-up, emails, calendar (docs/plans/v1.4.2-workload.md §4, §7). */
export default async function SettingsPage() {
  const me = await getSessionUser();
  if (!me) redirect('/api/session-ended');
  const [pref, options] = await Promise.all([getPreference(me.id), backupCandidates(me)]);
  const away = isAway(pref);
  const needsBackup = me.roles.some((r) => BACKUP_ROLES.includes(r));
  const showSummary =
    me.roles.includes(RoleName.HOG) || me.roles.includes(RoleName.INSTRUCTION_CELL);

  return (
    <div className="mx-auto max-w-3xl space-y-5" data-testid="settings-page">
      <div>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 28, margin: 0 }}>
          My settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{me.email}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Away</CardTitle>
          <CardDescription>
            {away && pref?.awayUntil ? (
              <span className="inline-flex flex-wrap items-center gap-2" data-testid="away-now">
                <span>
                  You are shown as <strong>away until {formatDueDay(pref.awayUntil)}</strong>
                  {pref.backupUser ? (
                    <>
                      {' '}
                      · back-up <strong>{pref.backupUser.name}</strong>
                    </>
                  ) : null}
                  .
                </span>
                <EndAwayButton />
              </span>
            ) : pref?.awayUntil && pref.awayFrom && pref.awayFrom > new Date() ? (
              <>
                Planned: away {formatDueDay(pref.awayFrom)} – {formatDueDay(pref.awayUntil)}
                {pref.backupUser ? `, back-up ${pref.backupUser.name}` : ''}.
              </>
            ) : (
              'On leave or travelling? Say until when, and who looks after your requests meanwhile.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AwayForm
            from={isoIst(pref?.awayFrom)}
            until={isoIst(pref?.awayUntil)}
            backupId={pref?.backupUserId ?? ''}
            options={options}
            needsBackup={needsBackup}
          />
          {!needsBackup ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Your Head of Group sees that you are away when allocating, and can hand a handout to
              someone else if it can&apos;t wait.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailForm
            emailMode={pref?.emailMode ?? 'INSTANT'}
            weeklySummary={pref?.weeklySummary ?? true}
            showSummary={showSummary}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add my HMP deadlines to my calendar</CardTitle>
          <CardDescription>
            A private link for Outlook or Google Calendar that keeps itself up to date: each handout
            you work on, its step and due date — nothing from the handout itself. Treat it like a
            password; you can replace it at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CalendarLink
            madeOn={pref?.calendarTokenAt ? formatDueDay(pref.calendarTokenAt) : null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
