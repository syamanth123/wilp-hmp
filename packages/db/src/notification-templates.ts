/**
 * Canonical notification template definitions.
 *
 * Single source of truth shared by:
 *   - packages/db/prisma/seed.ts        — upserts these rows into NotificationTemplate
 *   - apps/web/src/lib/notifications.test.ts — token-contract test renders these
 *     bodies/subjects with each notify function's real token supplier and
 *     asserts no residual `{{token}}` survives (catches the class of bug where
 *     a template references a token the supplier never provides)
 *
 * Because both the seed and the test import THESE arrays, there is zero drift
 * risk: the strings tested are byte-identical to the strings seeded.
 *
 * NOTE: `{{link}}` is intentionally NOT used in any body. `deliver()` appends a
 * per-recipient "Open in HMP" anchor to every email and stores the link column
 * for in-portal, so a body link token would be redundant — and would render a
 * non-clickable relative path (linkFor returns `/pc/requests/ID`, not an
 * absolute URL). See docs/dev-handoff-audit.md §5 (relative-link known gap).
 */
export interface NotificationTemplateSeed {
  key: string;
  subject: string;
  body: string;
}

/**
 * Prompt 12-b — SME APPROVAL-GATE templates. The SME is an approval gate
 * between faculty submit and PC review; these fire on the workflow transitions
 * (they route through notifyTransition, not a bespoke notify function). Token
 * contract: refNo, course, actor (supplied by notifyTransition's token builder
 * — see notifications.ts dispatchTransition).
 *
 * Recipient routing (computeRecipients, notifications.ts):
 *   sme_review_requested → the assigned SME + IC
 *   sme_approved         → faculty + IC + PC  (PC inherits the "work arrived"
 *                          ping from the now-dormant handout.submitted; async
 *                          workflows can't rely on dashboard polling — do not
 *                          drop PC here without reviewing that contract)
 *   sme_reverted         → faculty + IC
 */
export const SME_APPROVAL_TEMPLATES: readonly NotificationTemplateSeed[] = [
  {
    key: 'handout.sme_review_requested',
    subject: 'SME review requested: {{refNo}}',
    body:
      '{{actor}} submitted {{refNo}} ({{course}}) for your SME review. ' +
      'Approve or request changes from your review queue.',
  },
  {
    key: 'handout.sme_approved',
    subject: 'SME approved: {{refNo}}',
    body: 'The SME approved {{refNo}} ({{course}}). It has moved to PC review.',
  },
  {
    key: 'handout.sme_reverted',
    subject: 'SME requested changes: {{refNo}}',
    body:
      'The SME sent {{refNo}} ({{course}}) back for changes. ' +
      'See the comment on the handout and resubmit.',
  },
] as const;

/**
 * Taxila publish templates (Prompt 9b). Same shared-constant pattern as the
 * SME set: imported by both seed.ts and the token-contract test. Token
 * contract: refNo, courseCode, actor.
 *
 * `publish_export_ready` fires in Mode B when the export ZIP is generated but
 * the request is NOT yet published (it stays APPROVED until the IC confirms a
 * manual upload). `manually_published` fires when the IC confirms — kept
 * DISTINCT from the workflow's automatic `handout.published` because the
 * wording signals *how* the publish happened (a human uploaded the ZIP), which
 * is the audit breadcrumb for "PUBLISHED but Taxila has no automated record".
 */
export const PUBLISH_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  {
    key: 'handout.publish_export_ready',
    subject: 'Export ready for manual upload: {{refNo}}',
    body:
      'The handout {{refNo}} ({{courseCode}}) has been exported as a downloadable ' +
      'package. Download it from HMP, upload to Taxila manually, then mark it as ' +
      'published in HMP. Exported by {{actor}}.',
  },
  {
    key: 'handout.manually_published',
    subject: 'Manually published: {{refNo}}',
    body:
      '{{actor}} confirmed manual publication of {{refNo}} ({{courseCode}}) to ' +
      'Taxila. The request is now in PUBLISHED state.',
  },
] as const;
