import type { HandoutStatus } from '@hmp/db';
// Labels come from one place (the workflow package), shared with workflow
// messages and notifications. Subpath import: no database code comes along.
import { STATUS_LABEL } from '@hmp/workflow/src/labels';

const CONFIG: Record<HandoutStatus, { cls: string; dot?: boolean }> = {
  DRAFT: { cls: 'badge-gray' },
  REQUESTED: { cls: 'badge-navy' },
  ALLOCATED: { cls: 'badge-navy' },
  ASSIGNED: { cls: 'badge-navy' },
  IN_PROGRESS: { cls: 'badge-gold', dot: true },
  SME_REVIEW: { cls: 'badge-gold', dot: true },
  SUBMITTED: { cls: 'badge-gold', dot: true },
  UNDER_REVIEW: { cls: 'badge-gold', dot: true },
  REWORK_REQUESTED: { cls: 'badge-red', dot: true },
  APPROVED: { cls: 'badge-green', dot: true },
  PUBLISHED: { cls: 'badge-navy' },
  ARCHIVED: { cls: 'badge-gray' },
  REJECTED: { cls: 'badge-red' },
};

/** The plain-words label for a status (one source for badges, filters, counts). */
export function statusLabel(status: HandoutStatus): string {
  return STATUS_LABEL[status] ?? status;
}

export function StatusBadge({ status }: { status: HandoutStatus }) {
  const { cls, dot } = CONFIG[status];
  const label = statusLabel(status);
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
      data-status={status}
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
