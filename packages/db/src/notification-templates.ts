/**
 * Canonical SME notification template definitions.
 *
 * Single source of truth shared by:
 *   - packages/db/prisma/seed.ts        — upserts these rows into NotificationTemplate
 *   - apps/web/src/lib/notifications.test.ts — token-contract test renders these
 *     bodies/subjects with each notify function's real token supplier and
 *     asserts no residual `{{token}}` survives (catches the class of bug where
 *     a template references a token the supplier never provides)
 *
 * Because both the seed and the test import THIS array, there is zero drift
 * risk: the strings tested are byte-identical to the strings seeded.
 *
 * Token contract (every {{token}} below MUST be supplied by the corresponding
 * supplier in notifications.ts — verified mechanically by the contract test):
 *   refNo, courseCode, courseTitle, actor, topic, reason
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

export const SME_NOTIFICATION_TEMPLATES: readonly NotificationTemplateSeed[] = [
  {
    key: 'handout.sme_nominated',
    subject: 'SME nomination: {{refNo}} — {{courseCode}}',
    body:
      'You have been nominated as Subject Matter Expert for handout {{refNo}} ' +
      '({{courseCode}} – {{courseTitle}}) by {{actor}}. Topic: "{{topic}}". ' +
      'Review the request to accept or decline.',
  },
  {
    key: 'handout.sme_accepted',
    subject: 'SME accepted: {{refNo}}',
    body:
      '{{actor}} accepted your SME nomination for {{refNo}} ({{courseCode}}). ' +
      'They will now review the handout and add advisory input.',
  },
  {
    key: 'handout.sme_declined',
    subject: 'SME declined: {{refNo}}',
    body:
      '{{actor}} declined your SME nomination for {{refNo}} ({{courseCode}}). ' +
      'Reason: "{{reason}}". You can nominate another SME from the request page.',
  },
  {
    key: 'handout.sme_completed',
    subject: 'SME review complete: {{refNo}}',
    body:
      '{{actor}} completed their SME review for {{refNo}} ({{courseCode}}). ' +
      'Their comments are visible on the handout discussion.',
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
