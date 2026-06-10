import Link from 'next/link';
import { prisma, HandoutStatus } from '@hmp/db';
import { buttonVariants } from '@hmp/ui';
import { getSessionUser } from '@hmp/auth';
import { SlaWidgets } from '@/components/sla-widgets';
import { RecentActivity } from '@/components/recent-activity';

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="glass-stat rounded-[10px] p-[18px_20px]">
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
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
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

const GROUPS = [
  { label: 'Awaiting assignment', statuses: [HandoutStatus.ALLOCATED] },
  { label: 'Awaiting review', statuses: [HandoutStatus.SUBMITTED] },
  {
    label: 'In progress',
    statuses: [HandoutStatus.ASSIGNED, HandoutStatus.IN_PROGRESS, HandoutStatus.REWORK_REQUESTED],
  },
  {
    label: 'Forwarded / Done',
    statuses: [HandoutStatus.UNDER_REVIEW, HandoutStatus.APPROVED, HandoutStatus.PUBLISHED],
  },
];

export default async function PCOverview() {
  const me = await getSessionUser();

  const [counts, programmes] = await Promise.all([
    Promise.all(
      GROUPS.map(async (g) => ({
        ...g,
        count: await prisma.handoutRequest.count({ where: { status: { in: g.statuses } } }),
      })),
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
            Confirm assignments and run the review loop.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pc/bulk-review" className={buttonVariants({ variant: 'outline' })}>
            Bulk review
          </Link>
          <Link href="/pc/requests" className={buttonVariants({ variant: 'outline' })}>
            All requests
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Awaiting assignment"
          value={counts[0]?.count ?? 0}
          sub="HOG allocated"
          icon={<ClockIcon />}
        />
        <StatCard
          label="Awaiting review"
          value={counts[1]?.count ?? 0}
          sub="Faculty submitted"
          icon={<BookIcon />}
        />
        <StatCard
          label="In progress"
          value={counts[2]?.count ?? 0}
          sub="Faculty working"
          icon={<FlowIcon />}
        />
        <StatCard
          label="Forwarded / Done"
          value={counts[3]?.count ?? 0}
          sub="Passed PC this term"
          icon={<CheckIcon />}
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
          <RecentActivity userId={me.id} />
        </div>
      )}
    </div>
  );
}
