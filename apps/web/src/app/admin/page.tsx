import Link from 'next/link';
import { prisma } from '@hmp/db';
import type { HandoutStatus } from '@hmp/db';

function StatCard({
  label, value, sub, icon,
}: {
  label: string; value: number | string; sub: string; icon: React.ReactNode;
}) {
  return (
    <div className="glass-stat rounded-[10px] p-[18px_20px]">
      <div className="stat-accent">{icon}</div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 38, letterSpacing: '-0.015em', margin: '8px 0 2px', color: 'var(--bits-navy)' }}>{value}</div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

function UsersIcon() {
  return <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 20c0-2.2 1.3-4.2 3-5"/></svg>;
}
function ProgIcon() {
  return <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l3 9M16 7l-3 9"/></svg>;
}
function FileIcon() {
  return <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>;
}
function ShieldIcon() {
  return <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.3 8.5-8 9-4.7-.5-8-4.5-8-9V6l8-3z"/></svg>;
}
function CheckIcon() {
  return <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4 10-10"/></svg>;
}
function UploadIcon() {
  return <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>;
}
function LogIcon() {
  return <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>;
}
function CpuIcon() {
  return <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></svg>;
}

function timeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const STATUS_LABELS: Partial<Record<HandoutStatus, string>> = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested',
  ALLOCATED: 'Allocated',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  REJECTED: 'Rejected',
};

export default async function AdminOverview() {
  const [users, programmes, courses, requests, audits, recentAudit, byStatus] = await Promise.all([
    prisma.user.count(),
    prisma.programme.count(),
    prisma.course.count(),
    prisma.handoutRequest.count(),
    prisma.auditLog.count(),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, action: true, entity: true, entityId: true, createdAt: true, actor: { select: { name: true, email: true } } },
    }),
    prisma.handoutRequest.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const aiProvider = process.env['AI_PROVIDER'] ?? 'not configured';
  const totalRequests = requests || 1; // avoid div/0

  return (
    <div>
      {/* Page header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.015em', margin: 0 }}>Admin Overview</h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>System health, user management, and configuration.</p>
        </div>
        <Link href="/admin/users" className="bits-btn bits-btn-primary text-sm">Manage users</Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Users" value={users} sub="Active accounts" icon={<UsersIcon />} />
        <StatCard label="Programmes" value={programmes} sub="Configured" icon={<ProgIcon />} />
        <StatCard label="Courses" value={courses} sub="Master catalog" icon={<FileIcon />} />
        <StatCard label="Handout Requests" value={requests} sub="Lifetime" icon={<ShieldIcon />} />
      </div>

      {/* Two-column panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Recent audit activity */}
        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head">
            <h3>Recent audit activity</h3>
            <span style={{ fontSize: 12, background: 'var(--bits-blue-tint)', color: 'var(--bits-navy)', border: '1px solid #d8e0f4', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
              {audits} total
            </span>
          </div>
          <div>
            {recentAudit.map(r => (
              <div key={r.id} className="activity-row">
                <div className="ico-wrap">
                  <LogIcon />
                </div>
                <div className="row-body">
                  <div className="row-title" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{r.action}</div>
                  <div className="row-meta">{r.actor?.name ?? r.actor?.email ?? '—'} · {r.entity}</div>
                </div>
                <span className="row-time">{timeAgo(new Date(r.createdAt))}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By status */}
        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head"><h3>Requests by status</h3></div>
          <div className="panel-body">
            <div className="flex flex-col gap-3">
              {byStatus.map(row => {
                const pct = Math.round((row._count._all / totalRequests) * 100);
                return (
                  <div key={row.status}>
                    <div className="flex justify-between text-sm mb-1">
                      <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{STATUS_LABELS[row.status] ?? row.status}</span>
                      <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{row._count._all}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions + System health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head"><h3>Quick actions</h3></div>
          <div className="panel-body grid grid-cols-2 gap-3">
            <Link href="/admin/users" className="quick-action">
              <span className="qa-icon"><UsersIcon /></span>Manage users
            </Link>
            <Link href="/admin/import" className="quick-action">
              <span className="qa-icon"><UploadIcon /></span>ERP import
            </Link>
            <Link href="/admin/workflow" className="quick-action">
              <span className="qa-icon"><CheckIcon /></span>Workflow config
            </Link>
            <Link href="/admin/ai-metrics" className="quick-action">
              <span className="qa-icon"><CpuIcon /></span>AI metrics
            </Link>
          </div>
        </div>

        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head"><h3>System health</h3></div>
          <div className="panel-body flex flex-col gap-3">
            {[
              { label: 'Node.js', value: process.version },
              { label: 'AI provider', value: aiProvider },
              { label: 'Audit log entries', value: audits.toString() },
              { label: 'Total requests', value: requests.toString() },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{item.label}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--bits-blue-tint)', padding: '2px 8px', borderRadius: 4 }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
