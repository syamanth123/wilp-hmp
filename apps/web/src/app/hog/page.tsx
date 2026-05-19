import Link from 'next/link';
import { prisma, HandoutStatus } from '@hmp/db';
import { buttonVariants } from '@hmp/ui';
import { getSessionUser } from '@hmp/auth';
import { SlaWidgets } from '@/components/sla-widgets';
import { RecentActivity } from '@/components/recent-activity';

function StatCard({ label, value, sub, icon }: { label: string; value: number | string; sub: string; icon: React.ReactNode }) {
  return (
    <div className="glass-stat rounded-[10px] p-[18px_20px]">
      <div className="stat-accent">{icon}</div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 38, letterSpacing: '-0.015em', margin: '8px 0 2px', color: 'var(--bits-navy)' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function UsersIcon()  { return <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 20c0-2.2 1.3-4.2 3-5"/></svg>; }
function ClockIcon()  { return <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>; }
function CheckIcon()  { return <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10"/></svg>; }
function FlowIcon()   { return <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l3 9M16 7l-3 9"/></svg>; }

const GROUPS = [
  { label: 'Pending allocation',   statuses: [HandoutStatus.REQUESTED],                                                                                      description: 'Awaiting faculty allocation.' },
  { label: 'Final approval queue', statuses: [HandoutStatus.UNDER_REVIEW],                                                                                    description: 'PC approved, HOG sign-off pending.' },
  { label: 'In progress',          statuses: [HandoutStatus.ALLOCATED, HandoutStatus.ASSIGNED, HandoutStatus.IN_PROGRESS, HandoutStatus.SUBMITTED, HandoutStatus.REWORK_REQUESTED], description: 'PC + Faculty working.' },
  { label: 'Approved',             statuses: [HandoutStatus.APPROVED, HandoutStatus.PUBLISHED],                                                               description: 'Approved this term.' },
];

export default async function HOGOverview() {
  const me = await getSessionUser();
  const counts = await Promise.all(
    GROUPS.map(async (g) => ({
      ...g,
      count: await prisma.handoutRequest.count({ where: { status: { in: g.statuses } } }),
    })),
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.015em', margin: 0 }}>Head of Group</h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>Allocate faculty, run review, and finalize approvals.</p>
        </div>
        <Link href="/hog/requests" className={buttonVariants({ variant: 'outline' })}>
          All requests
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Pending allocation"   value={counts[0]?.count ?? 0} sub="Awaiting faculty allocation" icon={<UsersIcon />} />
        <StatCard label="Final approval queue" value={counts[1]?.count ?? 0} sub="HOG sign-off pending"        icon={<ClockIcon />} />
        <StatCard label="In progress"          value={counts[2]?.count ?? 0} sub="Faculty + PC working"        icon={<FlowIcon />} />
        <StatCard label="Approved / Published" value={counts[3]?.count ?? 0} sub="Done this term"              icon={<CheckIcon />} />
      </div>

      <SlaWidgets role="HOG" />

      {me && <div className="mt-5"><RecentActivity userId={me.id} /></div>}
    </div>
  );
}
