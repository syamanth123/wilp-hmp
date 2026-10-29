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

function UsersIcon() {
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
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 20c0-2.2 1.3-4.2 3-5" />
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

export default async function HOGOverview() {
  const me = await getSessionUser();
  // Each card counts exactly what its list shows (lib/request-views.ts).
  const CARDS = ['pending-allocation', 'final-approval', 'in-progress', 'approved'] as const;
  const counts = await Promise.all(
    CARDS.map((key) => prisma.handoutRequest.count({ where: viewWhere('HOG', '', key) })),
  );

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
            Head of Group
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>
            Allocate faculty, run review, and finalize approvals.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/hog/requests/bulk-allocate"
            className={buttonVariants({ variant: 'outline' })}
          >
            Bulk allocate
          </Link>
          <Link href="/hog/bulk-review" className={buttonVariants({ variant: 'outline' })}>
            Bulk review
          </Link>
          <Link href="/hog/requests" className={buttonVariants({ variant: 'outline' })}>
            All requests
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Pending allocation"
          value={counts[0] ?? 0}
          sub="Waiting for faculty allocation"
          icon={<UsersIcon />}
          href={viewHref('HOG', 'pending-allocation')}
        />
        <StatCard
          label="Final approval queue"
          value={counts[1] ?? 0}
          sub="Waiting for your sign-off"
          icon={<ClockIcon />}
          href={viewHref('HOG', 'final-approval')}
        />
        <StatCard
          label="In progress"
          value={counts[2] ?? 0}
          sub="With PC, faculty or SME"
          icon={<FlowIcon />}
          href={viewHref('HOG', 'in-progress')}
        />
        <StatCard
          label="Approved / Published"
          value={counts[3] ?? 0}
          sub="All terms"
          icon={<CheckIcon />}
          href={viewHref('HOG', 'approved')}
        />
      </div>

      <SlaWidgets role="HOG" />

      {me && (
        <div className="mt-5">
          <RecentActivity userId={me.id} role="HOG" />
        </div>
      )}
    </div>
  );
}
