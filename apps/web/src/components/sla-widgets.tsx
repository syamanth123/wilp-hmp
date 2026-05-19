import { HandoutStatus } from '@hmp/db';
import { countSlaBucketsForStatuses } from '@/lib/sla';

type Role = 'IC' | 'HOG' | 'PC' | 'FACULTY';

interface Bucket {
  label: string;
  statuses: HandoutStatus[];
}

const BUCKETS_BY_ROLE: Record<Role, Bucket[]> = {
  HOG: [
    { label: 'Awaiting allocation', statuses: [HandoutStatus.REQUESTED] },
    { label: 'Final approval queue', statuses: [HandoutStatus.UNDER_REVIEW] },
  ],
  PC: [
    { label: 'Awaiting assignment confirm', statuses: [HandoutStatus.ALLOCATED] },
    { label: 'Submitted for review', statuses: [HandoutStatus.SUBMITTED] },
  ],
  IC: [
    { label: 'Awaiting publish', statuses: [HandoutStatus.APPROVED] },
  ],
  FACULTY: [
    {
      label: 'My assignments in flight',
      statuses: [HandoutStatus.ASSIGNED, HandoutStatus.IN_PROGRESS, HandoutStatus.REWORK_REQUESTED],
    },
  ],
};

type Tone = 'danger' | 'warn' | 'ok';

function statusTone(overdue: number, dueSoon: number): Tone {
  if (overdue > 0) return 'danger';
  if (dueSoon > 0) return 'warn';
  return 'ok';
}

function toneVar(tone: Tone): string {
  return tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--ok)';
}

function statusLabel(tone: Tone): string {
  return tone === 'danger' ? 'Overdue items present' : tone === 'warn' ? 'Items due soon' : 'On track';
}

function StatusIcon({ tone }: { tone: Tone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  if (tone === 'danger') {
    return (
      <svg {...common}>
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg {...common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

export async function SlaWidgets({ role, facultyId }: { role: Role; facultyId?: string }) {
  const buckets = BUCKETS_BY_ROLE[role];
  const data = await Promise.all(
    buckets.map(async (b) => ({
      ...b,
      counts: await countSlaBucketsForStatuses(b.statuses),
    })),
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {data.map((d) => {
        const tone = statusTone(d.counts.overdue, d.counts.dueSoon);
        const col = toneVar(tone);
        return (
          <div
            key={d.label}
            className="glass-stat p-5"
            style={{ borderLeft: `3px solid ${col}` }}
          >
            <div className="flex items-center justify-between" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600 }}>
              <span>{d.label}</span>
              <span style={{ color: col, display: 'inline-flex' }}>
                <StatusIcon tone={tone} />
              </span>
              <span className="sr-only">{statusLabel(tone)}</span>
            </div>
            <div className="stat-value" style={{ fontSize: 38, margin: '8px 0 4px' }}>
              {d.counts.total}
            </div>
            <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
              <span style={{ color: 'var(--warn)' }}>{d.counts.dueSoon} due soon</span>
              <span style={{ color: 'var(--danger)' }}>{d.counts.overdue} overdue</span>
            </div>
          </div>
        );
      })}
      {role === 'FACULTY' && facultyId && null}
    </div>
  );
}
