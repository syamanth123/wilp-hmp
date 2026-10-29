// Type-only import: this file is safe to use in browser components.
import type { HandoutStatus } from '@hmp/db';

/**
 * Plain-words name of every handout status: the one source for status
 * badges, list filters, dashboards, notifications and workflow messages.
 * Each says where the handout is and who has it next.
 */
export const STATUS_LABEL: Record<HandoutStatus, string> = {
  DRAFT: 'Draft',
  REQUESTED: 'Requested – waiting for HOG',
  ALLOCATED: 'Allocated – waiting for PC',
  ASSIGNED: 'Assigned – waiting for faculty',
  IN_PROGRESS: 'Being written',
  SME_REVIEW: 'With subject expert for review',
  SUBMITTED: 'Submitted – waiting for PC',
  UNDER_REVIEW: 'With HOG for final approval',
  REWORK_REQUESTED: 'Changes requested',
  APPROVED: 'Approved – ready to publish',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
  REJECTED: 'Rejected',
};

export function statusLabel(status: HandoutStatus | string): string {
  return STATUS_LABEL[status as HandoutStatus] ?? status;
}

/** What to tell someone whose action no longer applies because the handout moved on. */
export function movedOnMessage(status: HandoutStatus | string): string {
  return `This handout has already moved on (it is now "${statusLabel(status)}"). Refresh the page.`;
}
