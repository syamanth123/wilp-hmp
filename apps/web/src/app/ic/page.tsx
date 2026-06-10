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
function EditIcon() {
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
      <path d="M4 20h4l11-11-4-4L4 16v4z" />
    </svg>
  );
}
function BellIcon() {
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
      <path d="M6 8a6 6 0 1112 0c0 5 2 7 2 7H4s2-2 2-7z" />
      <path d="M10 19a2 2 0 004 0" />
    </svg>
  );
}
function FileIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}

const TERM_STEPS = [
  { n: 1, name: 'Request raised', meta: 'IC initiates requests', done: true },
  { n: 2, name: 'Faculty allocated', meta: 'HOG assigns faculty', done: true },
  { n: 3, name: 'Draft submitted', meta: 'Faculty submits', done: false },
  { n: 4, name: 'HOG approved', meta: 'Final review done', done: false },
  { n: 5, name: 'Published to LMS', meta: 'Students can access', done: false },
];

const STATUS_GROUPS = [
  {
    label: 'Open',
    statuses: [HandoutStatus.REQUESTED, HandoutStatus.ALLOCATED, HandoutStatus.ASSIGNED],
  },
  {
    label: 'In progress',
    statuses: [
      HandoutStatus.IN_PROGRESS,
      HandoutStatus.SUBMITTED,
      HandoutStatus.UNDER_REVIEW,
      HandoutStatus.REWORK_REQUESTED,
    ],
  },
  { label: 'Approved', statuses: [HandoutStatus.APPROVED] },
  { label: 'Published', statuses: [HandoutStatus.PUBLISHED] },
];

export default async function ICOverview() {
  const me = await getSessionUser();

  const [grouped, publishQueue, returned] = await Promise.all([
    Promise.all(
      STATUS_GROUPS.map(async (g) => ({
        ...g,
        count: await prisma.handoutRequest.count({ where: { status: { in: g.statuses } } }),
      })),
    ),
    prisma.handoutRequest.findMany({
      where: { status: HandoutStatus.APPROVED },
      take: 5,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        refNo: true,
        status: true,
        offering: { select: { course: { select: { title: true, code: true } } } },
        assignments: {
          where: { active: true },
          take: 1,
          select: { faculty: { select: { name: true } } },
        },
      },
    }),
    prisma.handoutRequest.count({ where: { status: HandoutStatus.REWORK_REQUESTED } }),
  ]);

  const approvedCount = grouped.find((g) => g.label === 'Approved')?.count ?? 0;
  const openCount = grouped.find((g) => g.label === 'Open')?.count ?? 0;

  // Days to term close (static for now)
  const termClose = new Date('2026-05-28');
  const daysLeft = Math.max(0, Math.ceil((termClose.getTime() - Date.now()) / 86400000));

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
            Instruction Cell
          </h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>
            Track submissions, dispatch approved handouts and coordinate term operations.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/ic/requests/bulk-upload" className={buttonVariants({ variant: 'outline' })}>
            Bulk upload
          </Link>
          <Link href="/ic/requests/new" className={buttonVariants()}>
            New request
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Submissions pending"
          value={openCount}
          sub="Across all programmes"
          icon={<ClockIcon />}
        />
        <StatCard
          label="Ready to publish"
          value={approvedCount}
          sub="Awaiting IC dispatch"
          icon={<CheckIcon />}
        />
        <StatCard
          label="Returned to faculty"
          value={returned}
          sub="With review comments"
          icon={<EditIcon />}
        />
        <StatCard
          label="Days to term close"
          value={daysLeft}
          sub="Deadline: May 28, 2026"
          icon={<BellIcon />}
        />
      </div>

      <SlaWidgets role="IC" />

      {/* Two-column panels */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Publish queue */}
        <div className="glass-panel overflow-hidden rounded-[10px]">
          <div className="panel-head">
            <h3>Publish queue</h3>
            {approvedCount > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: '#e7f5ec',
                  color: '#1e6a40',
                  border: '1px solid #c9e5d3',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                {approvedCount} ready
              </span>
            )}
          </div>
          <div>
            {publishQueue.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
                No approved handouts pending.
              </div>
            ) : (
              publishQueue.map((h) => (
                <div key={h.id} className="activity-row">
                  <div
                    className="ico-wrap"
                    style={{ background: 'var(--bits-gold-soft)', color: 'var(--bits-gold)' }}
                  >
                    <FileIcon />
                  </div>
                  <div className="row-body">
                    <div className="row-title">
                      {h.offering.course.title}{' '}
                      <span
                        style={{
                          color: 'var(--muted)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 12,
                          fontWeight: 400,
                        }}
                      >
                        · {h.offering.course.code}
                      </span>
                    </div>
                    <div className="row-meta">
                      {h.assignments[0]?.faculty.name ?? '—'} · {h.refNo}
                    </div>
                  </div>
                  <Link
                    href={`/ic/requests/${h.id}`}
                    className="bits-btn bits-btn-primary text-xs"
                    style={{ fontSize: 12.5, padding: '6px 12px' }}
                  >
                    Publish
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Term timeline */}
        <div className="glass-panel overflow-hidden rounded-[10px]">
          <div className="panel-head">
            <h3>Term timeline</h3>
          </div>
          <div className="panel-body">
            <div className="flex flex-col gap-3">
              {TERM_STEPS.map((step, i) => {
                const current = !step.done && (i === 0 || TERM_STEPS[i - 1]?.done);
                return (
                  <div key={step.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div
                      className={`wf-num ${step.done ? 'done' : current ? 'current' : ''}`}
                      style={{
                        background: step.done
                          ? 'var(--ok)'
                          : current
                            ? 'var(--bits-navy)'
                            : undefined,
                        color: step.done || current ? '#fff' : undefined,
                        borderColor: step.done
                          ? 'var(--ok)'
                          : current
                            ? 'var(--bits-navy)'
                            : undefined,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    >
                      {step.done ? '✓' : step.n}
                    </div>
                    <div>
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: 13.5,
                          color: step.done
                            ? 'var(--ok)'
                            : current
                              ? 'var(--bits-navy)'
                              : 'var(--ink-2)',
                        }}
                      >
                        {step.name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                        {step.meta}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
