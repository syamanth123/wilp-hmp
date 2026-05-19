import Link from 'next/link';
import { prisma } from '@hmp/db';

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  focusable: false as const,
};

function ActionIcon({ action }: { action: string }) {
  if (action.includes('APPROVE') || action.includes('PUBLISH')) {
    return (
      <svg {...ICON_PROPS}>
        <path d="M5 12l4 4 10-10" />
      </svg>
    );
  }
  if (action.includes('SUBMIT') || action.includes('CREATE')) {
    return (
      <svg {...ICON_PROPS}>
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M4 20h16" />
      </svg>
    );
  }
  if (action.includes('REJECT') || action.includes('REWORK')) {
    return (
      <svg {...ICON_PROPS}>
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    );
  }
  return (
    <svg {...ICON_PROPS}>
      <path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
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

export async function RecentActivity({ userId, limit = 6 }: { userId: string; limit?: number }) {
  const rows = await prisma.auditLog.findMany({
    where: { actorId: userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      createdAt: true,
      requestId: true,
      request: { select: { refNo: true } },
    },
  });

  return (
    <div className="glass-panel rounded-[10px] overflow-hidden">
      <div className="panel-head">
        <h3>Recent activity</h3>
        {rows.length > 0 && (
          <span style={{ fontSize: 12, background: 'var(--bits-blue-tint)', color: 'var(--bits-navy)', border: '1px solid #d8e0f4', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
            {rows.length}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <span className="empty-title">No activity yet</span>
          <span className="empty-hint">Your actions across the portal will appear here.</span>
        </div>
      ) : (
        <div>
          {rows.map((r) => (
            <div key={r.id} className="activity-row">
              <div className="ico-wrap">
                <ActionIcon action={r.action} />
              </div>
              <div className="row-body">
                <div className="row-title">
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.action}</span>
                  {r.request?.refNo && r.requestId && (
                    <>
                      {' '}
                      <Link href={`/ic/requests/${r.requestId}`} style={{ color: 'var(--bits-navy)', textDecoration: 'underline', fontSize: 12 }}>
                        {r.request.refNo}
                      </Link>
                    </>
                  )}
                </div>
                <div className="row-meta">{r.entity}{r.entityId ? ` · ${r.entityId}` : ''}</div>
              </div>
              <span className="row-time">{timeAgo(new Date(r.createdAt))}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
