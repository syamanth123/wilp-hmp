import Link from 'next/link';
import { prisma, NotificationChannel, NotificationStatus, type Prisma } from '@hmp/db';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { RunSweepPanel } from './run-sweep-panel';
import { EmailEditor } from './email-editor';
import { EmailSettingsForm } from './email-settings-form';
import { CATALOGUE, CATALOGUE_BY_KEY, PLACEHOLDERS, loadWordingEdits } from '@/lib/email/catalogue';
import { loadEmailSettings } from '@/lib/email/context';
import { previewRequests } from '@/lib/email/preview';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

type Tab = 'emails' | 'log' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'emails', label: 'Emails' },
  { id: 'log', label: 'Email log' },
  { id: 'settings', label: 'Settings' },
];

const LOG_DAYS = 90;
const LOG_ROWS = 200;

function Tabs({ tab }: { tab: Tab }) {
  return (
    <nav className="flex gap-1 border-b" aria-label="Notifications">
      {TABS.map((t) => (
        <Link
          key={t.id}
          href={`/admin/notifications?tab=${t.id}`}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            t.id === tab
              ? 'border-primary font-semibold'
              : 'text-muted-foreground hover:text-foreground border-transparent'
          }`}
          aria-current={t.id === tab ? 'page' : undefined}
          data-testid={`tab-${t.id}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

async function EmailsTab({ edit }: { edit: string | null }) {
  const edits = await loadWordingEdits();
  const entry = edit ? CATALOGUE_BY_KEY.get(edit) : null;
  const requests = entry ? await previewRequests() : [];
  const ed = entry ? edits.get(entry.key) : undefined;
  return (
    <div className="space-y-4">
      {entry ? (
        <Card>
          <CardContent className="pt-6">
            <EmailEditor
              key={entry.key}
              emailKey={entry.key}
              label={entry.label}
              to={entry.to}
              needsRequest={entry.request}
              original={{ subject: entry.subject, summary: entry.summary, action: entry.action }}
              current={{
                subject: ed?.subject ?? entry.subject,
                summary: ed?.summary ?? entry.summary,
                action: ed?.action || entry.action,
              }}
              edited={
                ed?.editedAt
                  ? `${formatDateTime(ed.editedAt)}${ed.editedBy ? ` by ${ed.editedBy}` : ''}`
                  : null
              }
              placeholders={entry.tokens.map((t) => ({ name: t, text: PLACEHOLDERS[t] ?? '' }))}
              requests={requests}
            />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Emails</CardTitle>
          <CardDescription>
            Every email HMP sends, in one layout: a summary, what to do and by when, a button, what
            happened, the handout’s details, the people and the recent steps. You can change the
            subject, summary and “what to do” of each; <strong>Edit</strong> also shows it with a
            real request and sends you a test.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table data-testid="email-list">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {CATALOGUE.map((c) => {
                const e = edits.get(c.key);
                return (
                  <TableRow key={c.key} className={c.key === edit ? 'bg-muted/50' : undefined}>
                    <TableCell className="text-sm font-medium">{c.label}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{c.to}</TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{e?.subject ?? c.subject}</span>
                      {e ? (
                        <Badge variant="secondary" className="ml-2">
                          Edited
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/notifications?tab=emails&edit=${encodeURIComponent(c.key)}`}
                        className="text-sm underline"
                        data-testid={`edit-${c.key}`}
                      >
                        Edit
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-muted-foreground mt-3 text-xs">
            Also sent, with fixed wording: the daily digest, the weekly summary and the one email
            per person after a bulk action (kick-off, bulk upload, bulk allocate, bulk review).
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Daily run</CardTitle>
          <CardDescription>
            Every day at 09:00 HMP sends due-soon and overdue reminders (and escalation, when
            switched on in{' '}
            <Link href="/admin/workflow" className="underline">
              Admin → Workflow
            </Link>
            , where the due dates are set) and the daily digests. Run it now:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RunSweepPanel />
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_WORD: Record<
  string,
  { text: string; variant: 'success' | 'destructive' | 'secondary' }
> = {
  SENT: { text: 'Sent', variant: 'success' },
  FAILED: { text: 'Failed', variant: 'destructive' },
  PENDING: { text: 'Waiting', variant: 'secondary' },
};

async function LogTab({ status, q }: { status: string | null; q: string }) {
  const since = new Date(Date.now() - LOG_DAYS * 86_400_000);
  const where: Prisma.NotificationWhereInput = {
    channel: NotificationChannel.EMAIL,
    createdAt: { gte: since },
    ...(status === 'failed'
      ? { status: NotificationStatus.FAILED }
      : status === 'waiting'
        ? { status: NotificationStatus.PENDING }
        : {}),
    ...(q
      ? {
          OR: [
            { subject: { contains: q, mode: 'insensitive' } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { name: { contains: q, mode: 'insensitive' } } },
            { meta: { path: ['refNo'], string_contains: q } },
          ],
        }
      : {}),
  };
  const [rows, total, failed] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: LOG_ROWS,
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        sentAt: true,
        meta: true,
        user: { select: { name: true, email: true } },
      },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: {
        channel: NotificationChannel.EMAIL,
        createdAt: { gte: since },
        status: NotificationStatus.FAILED,
      },
    }),
  ]);
  const filter = (s: string | null, label: string) => (
    <Link
      href={`/admin/notifications?tab=log${s ? `&status=${s}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
      className={`rounded-md border px-2 py-1 text-sm ${status === s ? 'bg-muted font-semibold' : ''}`}
      data-testid={`log-filter-${s ?? 'all'}`}
    >
      {label}
    </Link>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email log</CardTitle>
        <CardDescription>
          Every email of the last {LOG_DAYS} days: sent, failed (with the reason) or waiting for the
          daily digest. {failed ? `${failed} failed.` : 'None failed.'} Failures and test emails are
          also in the audit log.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {filter(null, 'All')}
          {filter('failed', 'Failed')}
          {filter('waiting', 'Waiting for the digest')}
          <form action="/admin/notifications" className="ml-auto flex gap-2">
            <input type="hidden" name="tab" value="log" />
            {status ? <input type="hidden" name="status" value={status} /> : null}
            <input
              name="q"
              defaultValue={q}
              placeholder="Person, subject or HMP reference"
              className="bg-background h-8 w-64 rounded-md border px-2 text-sm"
              data-testid="log-search"
            />
            <button type="submit" className="h-8 rounded-md border px-3 text-sm">
              Search
            </button>
          </form>
        </div>
        <Table data-testid="email-log">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No emails{status || q ? ' match' : ' yet'}.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((r) => {
              const meta = (r.meta ?? {}) as { error?: string; digest?: boolean; kind?: string };
              const s = STATUS_WORD[r.status] ?? STATUS_WORD.PENDING!;
              return (
                <TableRow key={r.id} data-testid="email-log-row">
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {r.user.name}
                    <div className="text-muted-foreground text-xs">{r.user.email}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.subject}</TableCell>
                  <TableCell className="text-sm">
                    <Badge variant={s.variant}>
                      {r.status === 'PENDING' && meta.digest ? 'Waiting for the digest' : s.text}
                    </Badge>
                    {r.status === 'FAILED' && meta.error ? (
                      <div className="mt-1 max-w-xs text-xs text-red-700">{meta.error}</div>
                    ) : null}
                    {r.sentAt && r.status === 'SENT' ? (
                      <div className="text-muted-foreground text-xs">
                        {formatDateTime(r.sentAt)}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {total > rows.length ? (
          <p className="text-muted-foreground text-xs">
            Showing the newest {rows.length} of {total}. Search to narrow it down.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

async function SettingsTab() {
  const s = await loadEmailSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>
          Emails are sent from the server’s mail address. These two lines go in every email’s
          footer.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmailSettingsForm replyTo={s.replyTo ?? ''} help={s.help ?? ''} />
      </CardContent>
    </Card>
  );
}

export default async function NotificationsConfigPage({
  searchParams,
}: {
  searchParams: { tab?: string; edit?: string; status?: string; q?: string };
}) {
  const tab: Tab =
    searchParams.tab === 'log' || searchParams.tab === 'settings' ? searchParams.tab : 'emails';
  return (
    <div className="space-y-4">
      <Tabs tab={tab} />
      {tab === 'emails' ? <EmailsTab edit={searchParams.edit ?? null} /> : null}
      {tab === 'log' ? (
        <LogTab
          status={
            searchParams.status === 'failed' || searchParams.status === 'waiting'
              ? searchParams.status
              : null
          }
          q={(searchParams.q ?? '').trim().slice(0, 100)}
        />
      ) : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </div>
  );
}
