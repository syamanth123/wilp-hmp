/**
 * Plain-words labels for the values the database stores as codes. One place,
 * used by every page, so a professor never sees "PROGRAMME_COMMITTEE",
 * "REWORK" or "handout.version.saved". Status labels live with the workflow
 * (@hmp/workflow/src/labels) and are re-exported here.
 *
 * Type-only imports: safe in browser components.
 */
import type {
  ApprovalDecision,
  ApprovalStage,
  FacultyType,
  NotificationChannel,
  RoleName,
} from '@hmp/db';

export { STATUS_LABEL, statusLabel } from '@hmp/workflow/src/labels';

const pick = <K extends string>(
  map: Record<K, string>,
  key: string | null | undefined,
  fallback = '—',
) => (key == null || key === '' ? fallback : (map[key as K] ?? key));

export const ROLE_LABEL: Record<RoleName, string> = {
  ADMIN: 'Administrator',
  INSTRUCTION_CELL: 'Instruction Cell',
  HOG: 'Head of Group',
  PROGRAMME_COMMITTEE: 'Programme Committee',
  FACULTY: 'Faculty',
  SME: 'Subject expert',
};
export const roleLabel = (r: string | null | undefined) => pick(ROLE_LABEL, r);

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  HOG_REVIEW: 'HOG allocation',
  PC_REVIEW: 'Programme Committee review',
  SME_REVIEW: 'Subject expert review',
  HOG_FINAL: 'HOG final approval',
  IC_PUBLISH: 'Publishing',
} as Record<ApprovalStage, string>;
export const stageLabel = (s: string | null | undefined) => pick(STAGE_LABEL, s);

export const DECISION_LABEL: Record<ApprovalDecision, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REWORK: 'Changes requested',
  REJECTED: 'Rejected',
} as Record<ApprovalDecision, string>;
export const decisionLabel = (d: string | null | undefined) => pick(DECISION_LABEL, d);

export const FACULTY_TYPE_LABEL: Record<FacultyType, string> = {
  ON_CAMPUS: 'On-campus',
  OFF_CAMPUS: 'Off-campus',
  ADJUNCT: 'Adjunct',
  GUEST: 'Guest',
} as Record<FacultyType, string>;
export const facultyTypeLabel = (t: string | null | undefined) =>
  pick(FACULTY_TYPE_LABEL, t, 'Not set');

export const TERM_LABEL: Record<string, string> = {
  FIRST: 'Semester 1',
  SECOND: 'Semester 2',
  SUMMER: 'Summer term',
};
export const termLabel = (t: string | null | undefined) => pick(TERM_LABEL, t);

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  IN_PORTAL: 'In-app',
  EMAIL: 'Email',
} as Record<NotificationChannel, string>;
export const channelLabel = (c: string | null | undefined) => pick(CHANNEL_LABEL, c);

export const CORPUS_METHOD_LABEL: Record<string, string> = {
  MAMMOTH_STRUCTURED: 'Read fully',
  TEXT_FALLBACK: 'Partly read (text only)',
  FAILED: 'Could not read',
  SKIPPED_MODULE: 'Skipped: module format',
  SKIPPED_SIZE: 'Skipped: file too large',
  SKIPPED_FORMAT: 'Skipped: not a Word file',
  SKIPPED_NARRATIVE_PROSE: 'Skipped: free-text handout',
};
export const corpusMethodLabel = (m: string | null | undefined) => pick(CORPUS_METHOD_LABEL, m);

/** Workflow events, as recorded in "handout.transition.<EVENT>". */
const EVENT_SENTENCE: Record<string, string> = {
  REQUEST_INITIATED: 'Raised the request',
  FACULTY_ALLOCATED: 'Allocated faculty',
  ASSIGNED: 'Confirmed the allocation',
  ALLOCATION_REJECTED: 'Sent the allocation back to the Head of Group',
  EDIT_STARTED: 'Started writing the handout',
  SUBMITTED: 'Submitted the handout',
  SME_REVIEW_REQUESTED: 'Sent the handout to the subject expert',
  SME_APPROVED: 'Approved the handout (subject expert)',
  SME_REVERTED: 'Asked for changes (subject expert)',
  REVIEW_REWORK: 'Asked for changes',
  REVIEW_APPROVED: 'Approved and forwarded to the Head of Group',
  FINAL_APPROVED: 'Gave final approval',
  FINAL_REJECTED: 'Rejected the handout',
  PUBLISHED: 'Published to Taxila',
  ARCHIVED: 'Archived the handout',
};

/** Everything else the audit log records. */
const ACTION_SENTENCE: Record<string, string> = {
  'request.create': 'Raised the request',
  'request.create.bulk': 'Raised requests in bulk',
  'request.allocate.bulk': 'Allocated faculty in bulk',
  'pc_review.bulk': 'Reviewed handouts in bulk',
  'pc_allocation_review.bulk': 'Reviewed allocations in bulk',
  'hog_review.bulk': 'Reviewed handouts in bulk',
  'sme_review.bulk': 'Reviewed handouts in bulk',
  sme_approve: 'Approved the handout (subject expert)',
  'assignment.accepted': 'Accepted the assignment',
  'handout.editing.started': 'Started writing the handout',
  'handout.version.saved': 'Saved a new version',
  'handout.version.converted_to_structured': 'Switched to the new editor',
  'handout.autofetch.reset_to_empty': 'Restarted from a blank handout',
  'handout.manually_confirmed': 'Confirmed it was published on Taxila',
  'handout.export': 'Downloaded the handout',
  'handout.exported': 'Prepared the Taxila file',
  'comment.added': 'Added a comment',
  'attachment.uploaded': 'Uploaded an attachment',
  'attachment.deleted': 'Removed an attachment',
  'semester.create': 'Added a semester',
  'semester.dates.updated': 'Updated semester dates',
  'programme.create': 'Added a programme',
  'course.create': 'Added a course',
  'user.create': 'Added a user',
  'workflow.update': 'Changed the time limits',
  'corpus.import.run': 'Imported past handouts',
  'corpus.import.upload': 'Uploaded a past handout',
  'corpus.import.approve': 'Approved a past handout for reuse',
  'corpus.import.bulk_approve': 'Approved past handouts in bulk',
  'corpus.import.reject': 'Rejected a past handout',
  'corpus.import.delete': 'Removed a past handout',
  'corpus.import.reparse': 'Read a past handout again',
  'dibba.import.upload': 'Uploaded a Course Dibba',
  'dibba.import.publish': 'Published a Course Dibba',
  'dibba.import.discard': 'Discarded a Course Dibba upload',
  'dibba.term.create': 'Created a term',
  'dibba.term.update': 'Updated a term',
  'dibba.term.slots.update': 'Updated class slots',
  'dibba.term.exams.update': 'Updated exam dates',
  'dibba.instructors.import': 'Imported the faculty sheet',
  'dibba.instructor.add': 'Added a faculty member to a course',
  'dibba.instructor.remove': 'Removed a faculty member from a course',
  'reconciliation.success': 'Checked the Taxila publication',
  'reconciliation.failed': 'Taxila publication check failed',
  'ratelimit.unavailable': 'Sign-in protection was briefly unavailable',
  'ai.draft.generated': 'Created an AI draft',
  'ai.draft.generated.structured': 'Created an AI draft',
  'ai.draft.applied': 'Used an AI draft',
  'ai.draft.applied.structured': 'Used an AI draft',
  'ai.quality.generated': 'Ran the AI quality check',
  'ai.recommend.regenerate': 'Refreshed AI suggestions',
  'ai.embeddings.refreshed': 'Refreshed AI matching data',
  'ai.budget.exceeded': 'AI monthly budget exceeded',
};

/** A short sentence for an audit-log action key. Unknown keys get a neutral sentence. */
export function actionSentence(action: string): string {
  if (action.startsWith('handout.transition.')) {
    return EVENT_SENTENCE[action.slice('handout.transition.'.length)] ?? 'Moved the handout on';
  }
  if (action.startsWith('erp.import.')) return 'Imported academic data';
  return ACTION_SENTENCE[action] ?? 'Updated the request';
}

/** "HandoutRequest" etc. in plain words, for the audit log's "Item" column. */
export const ENTITY_LABEL: Record<string, string> = {
  HandoutRequest: 'Handout request',
  Handout: 'Handout',
  HandoutVersion: 'Handout version',
  HandoutImport: 'Past handout',
  Comment: 'Comment',
  Attachment: 'Attachment',
  User: 'User',
  Programme: 'Programme',
  Course: 'Course',
  Semester: 'Semester',
  WorkflowConfig: 'Time limits',
  DibbaImport: 'Course Dibba',
  DibbaTerm: 'Term',
  FacultyAssignment: 'Faculty assignment',
  AIDraftLog: 'AI draft',
  AIQualityReport: 'AI quality report',
  AcademicTerm: 'Term',
  AiUsageLog: 'AI usage',
  CourseInstructor: 'Course faculty',
  Embedding: 'AI matching data',
  ErpSnapshot: 'Academic data import',
  RateLimit: 'Sign-in protection',
  Reconciliation: 'Taxila check',
};
export const entityLabel = (e: string | null | undefined) => pick(ENTITY_LABEL, e);

/** Audit entries written by the system, not by a person (hidden by default). */
export const SYSTEM_ACTIONS = ['ratelimit.unavailable'];
