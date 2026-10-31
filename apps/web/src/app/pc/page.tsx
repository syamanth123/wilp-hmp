import Link from 'next/link';
import { prisma } from '@hmp/db';
import { buttonVariants } from '@hmp/ui';
import { getSessionUser } from '@hmp/auth';
import { SlaWidgets } from '@/components/sla-widgets';
import { RecentActivity } from '@/components/recent-activity';
import { viewHref, viewWhere } from '@/lib/request-views';

function StatCard({
  label,
  value,
  sub,
  icon,
  href,
}: {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
  /** The list this number counts. Card and list use the same query. */
  href?: string;
}) {
  const body = (
    <div className="glass-stat h-full rounded-[10px] p-[18px_20px]">
      <div className="stat-accent">{icon}</div>
      <div
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontWeight: 600,
          fontSize: 38,
          letterSpacing: '-0.015em',
          margin: '8px 0 2px',
          color: 'var(--bits-navy)',
        }}
      >
        <span data-testid="stat-value">{value}</span>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
  return href ? (
    <Link href={href} data-testid="stat-card" className="block no-underline hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function FlowIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8 7l3 9M16 7l-3 9" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2V5z" />
      <path d="M4 17h14" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export default async function PCOverview() {
  const me = await getSessionUser();

  const [counts, programmes] = await Promise.all([
    // Each card counts exactly what its list shows (lib/request-views.ts).
    Promise.all(
      (['awaiting-confirmation', 'awaiting-review', 'in-progress', 'forwarded'] as const).map(
        (key) => prisma.handoutRequest.count({ where: viewWhere('PC', '', key) }),
      ),
    ),
    prisma.programme.findMany({
      select: { id: true, code: true, name: true, active: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const statusColor = (active: boolean) =>
    active
      ? { color: '#1e6a40', bg: '#e7f5ec', border: '#c9e5d3' }
      : { color: '#8b5a07', bg: '#fef3e0', border: '#f3dba5' };

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 600,
              fontSize: 30,
              letterSpacing: '-0.015em',
              margin: 0,
            }}
          >
            Programme Committee
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>
            Confirm allocations and review submitted handouts.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pc/bulk" className={buttonVariants({ variant: 'outline' })}>
            Bulk tools
          </Link>
          <Link href="/pc/requests" className={buttonVariants({ variant: 'outline' })}>
            All requests
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Allocations to confirm"
          value={counts[0] ?? 0}
          sub="Allocated by the Head of Group"
          icon={<ClockIcon />}
          href={viewHref('PC', 'awaiting-confirmation')}
        />
        <StatCard
          label="Handouts to review"
          value={counts[1] ?? 0}
          sub="Approved by the SME"
          icon={<BookIcon />}
          href={viewHref('PC', 'awaiting-review')}
        />
        <StatCard
          label="In progress"
          value={counts[2] ?? 0}
          sub="With faculty or SME"
          icon={<FlowIcon />}
          href={viewHref('PC', 'in-progress')}
        />
        <StatCard
          label="Forwarded / Done"
          value={counts[3] ?? 0}
          sub="Passed PC, all terms"
          icon={<CheckIcon />}
          href={viewHref('PC', 'forwarded')}
        />
      </div>

      <SlaWidgets role="PC" />

      {/* Programme structure table */}
      <div className="glass-panel mt-5 overflow-hidden rounded-[10px]">
        <div className="panel-head">
          <h3>Programme structure</h3>
        </div>
        <div style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'rgba(238,242,251,0.7)' }}>
                {['Code', 'Programme', 'Status'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left',
                      padding: '10px 16px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: 'var(--ink-2)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {programmes.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    style={{ padding: '14px 16px', color: 'var(--muted)', fontSize: 13 }}
                  >
                    No programmes yet. The administrator adds them.
                  </td>
                </tr>
              )}
              {programmes.map((p) => {
                const sc = statusColor(p.active);
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td
                      style={{
                        padding: '11px 16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        color: 'var(--ink-2)',
                      }}
                    >
                      {p.code}
                    </td>
                    <td style={{ padding: '11px 16px', fontWeight: 600, fontSize: 13.5 }}>
                      {p.name}
                    </td>
                    <td style={{ padding: '11px 16px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 600,
                          background: sc.bg,
                          color: sc.color,
                          border: `1px solid ${sc.border}`,
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: 'currentColor',
                          }}
                        />
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {me && (
        <div className="mt-5">
          <RecentActivity userId={me.id} role="PC" />
        </div>
      )}
    </div>
  );
}
