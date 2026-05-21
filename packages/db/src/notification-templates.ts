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
