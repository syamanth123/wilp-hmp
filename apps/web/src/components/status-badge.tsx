import type { HandoutStatus } from '@hmp/db';

const CONFIG: Record<HandoutStatus, { label: string; cls: string; dot?: boolean }> = {
  DRAFT: { label: 'Draft', cls: 'badge-gray' },
  REQUESTED: { label: 'Requested', cls: 'badge-navy' },
  ALLOCATED: { label: 'Allocated', cls: 'badge-navy' },
  ASSIGNED: { label: 'Assigned', cls: 'badge-navy' },
  IN_PROGRESS: { label: 'In Progress', cls: 'badge-gold', dot: true },
  SME_REVIEW: { label: 'SME Review', cls: 'badge-gold', dot: true },
  SUBMITTED: { label: 'Submitted', cls: 'badge-gold', dot: true },
  UNDER_REVIEW: { label: 'Under Review', cls: 'badge-gold', dot: true },
  REWORK_REQUESTED: { label: 'Rework Requested', cls: 'badge-red', dot: true },
  APPROVED: { label: 'Approved', cls: 'badge-green', dot: true },
  PUBLISHED: { label: 'Published', cls: 'badge-navy' },
  ARCHIVED: { label: 'Archived', cls: 'badge-gray' },
  REJECTED: { label: 'Rejected', cls: 'badge-red' },
};

export function StatusBadge({ status }: { status: HandoutStatus }) {
  const { label, cls, dot } = CONFIG[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
      }}
      className={cls}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'currentColor',
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
}
