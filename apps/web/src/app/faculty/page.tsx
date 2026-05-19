import Link from 'next/link';
import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import { buttonVariants } from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { SlaWidgets } from '@/components/sla-widgets';
import { RecentActivity } from '@/components/recent-activity';
import { computeFacultySignals } from '@/lib/faculty-signals';

function ProgressCard({ label, value, max, sub, pct }: { label: string; value: number; max?: number; sub: string; pct: number }) {
  return (
    <div className="glass-stat rounded-[10px] p-5">
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 38, letterSpacing: '-0.015em', color: 'var(--bits-navy)', marginBottom: 4 }}>
        {value}{max != null ? <span style={{ fontSize: 20, color: 'var(--muted)', fontWeight: 400 }}>/{max}</span> : null}
      </div>
      <div className="progress-track mb-2">
        <div className="progress-fill" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

export default async function FacultyOverview() {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);

  const baseWhere = { assignments: { some: { facultyId: me.id, active: true } } };

  const [pending, editing, awaiting, done, comments, signals] = await Promise.all([
    prisma.handoutRequest.count({
      where: { status: HandoutStatus.ASSIGNED, assignments: { some: { facultyId: me.id, active: true, acceptedAt: null } } },
    }),
    prisma.handoutRequest.count({
      where: { status: { in: [HandoutStatus.ASSIGNED, HandoutStatus.IN_PROGRESS, HandoutStatus.REWORK_REQUESTED] }, assignments: { some: { facultyId: me.id, active: true, acceptedAt: { not: null } } } },
    }),
    prisma.handoutRequest.count({
      where: { ...baseWhere, status: { in: [HandoutStatus.SUBMITTED, HandoutStatus.UNDER_REVIEW] } },
    }),
    prisma.handoutRequest.count({
      where: { ...baseWhere, status: { in: [HandoutStatus.APPROVED, HandoutStatus.PUBLISHED] } },
    }),
    prisma.comment.findMany({
      where: {
        handout: { request: { assignments: { some: { facultyId: me.id, active: true } } } },
        authorId: { not: me.id },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true, body: true, createdAt: true,
        author: { select: { name: true } },
        handout: { select: { request: { select: { refNo: true, id: true } } } },
      },
    }),
    computeFacultySignals(me.id),
  ]);
  const checklistDoneCount = signals?.items.filter((i) => i.done).length ?? 0;

  const total = pending + editing + awaiting + done;
  const completePct = total > 0 ? Math.round((done / total) * 100) : 0;
  const termClose = new Date('2026-05-28');
  const daysLeft = Math.max(0, Math.ceil((termClose.getTime() - Date.now()) / 86400000));

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.015em', margin: 0 }}>Faculty Dashboard</h1>
          <p style={{ color: 'var(--muted)', marginTop: 4, fontSize: 14 }}>Accept assignments and edit your handouts.</p>
        </div>
        <Link href="/faculty/assignments" className={buttonVariants({ variant: 'outline' })}>
          All assignments
        </Link>
      </div>

      {/* Progress cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <ProgressCard label="Overall completion" value={done} max={total} sub={`${completePct}% of assignments done`} pct={completePct} />
        <ProgressCard label="In-flight" value={editing} sub="Currently editing or rework" pct={total > 0 ? (editing / total) * 100 : 0} />
        <ProgressCard label="Days remaining" value={daysLeft} sub="Deadline: May 28, 2026" pct={Math.max(0, 100 - (daysLeft / 90) * 100)} />
      </div>

      <SlaWidgets role="FACULTY" facultyId={me.id} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
        {/* Reviewer comments */}
        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head">
            <h3>Reviewer comments</h3>
            {comments.length > 0 && (
              <span style={{ fontSize: 12, background: 'var(--bits-gold-soft)', color: '#8b5a07', border: '1px solid #f3dba5', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                {comments.length} new
              </span>
            )}
          </div>
          {comments.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>No reviewer comments yet.</div>
          ) : (
            <div className="panel-body flex flex-col gap-3">
              {comments.map(c => (
                <div key={c.id} style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.55)', borderRadius: 8 }}>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.author?.name ?? 'Reviewer'}</span>
                    <Link href={`/faculty/assignments/${c.handout.request.id}`} style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--bits-navy)', textDecoration: 'none' }}>
                      {c.handout.request.refNo}
                    </Link>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>{c.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Submission checklist */}
        <div className="glass-panel rounded-[10px] overflow-hidden">
          <div className="panel-head">
            <h3>Submission checklist</h3>
            {signals && (
              <Link
                href={`/faculty/assignments/${signals.requestId}`}
                style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--bits-navy)', textDecoration: 'none' }}
              >
                {signals.refNo}
              </Link>
            )}
          </div>
          {!signals ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              No active assignment. Accept one to see your checklist.
            </div>
          ) : (
            <div className="panel-body flex flex-col gap-2">
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                {checklistDoneCount}/{signals.items.length} signals detected on your latest version
              </div>
              {signals.items.map((item, i) => (
                <div
                  key={i}
                  title={!item.done ? item.hint : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.45)', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 7 }}
                >
                  <div
                    aria-hidden="true"
                    style={{ width: 20, height: 20, borderRadius: 4, border: '1.5px solid #d8e0f4', background: '#fff', flexShrink: 0, display: 'grid', placeItems: 'center' }}
                  >
                    {item.done && (
                      <svg aria-hidden="true" focusable="false" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2f8a5b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l4 4 10-10" />
                      </svg>
                    )}
                  </div>
                  <span style={{ fontSize: 13.5, color: item.done ? 'var(--ink-2)' : 'var(--muted)' }}>
                    <span className="sr-only">{item.done ? 'Complete: ' : 'Incomplete: '}</span>
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5">
        <RecentActivity userId={me.id} />
      </div>
    </div>
  );
}
