import { describe, it, expect } from 'vitest';
import { SME_APPROVAL_TEMPLATES, PUBLISH_NOTIFICATION_TEMPLATES } from '@hmp/db';
import {
  renderTemplate,
  EVENT_TEMPLATE_KEY,
  publishNotificationTokens,
  type PublishTokenArgs,
} from './notifications';

describe('renderTemplate', () => {
  it('substitutes simple tokens', () => {
    expect(renderTemplate('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });
  it('handles multiple tokens', () => {
    expect(
      renderTemplate('{{refNo}} for {{course}} in {{programme}}', {
        refNo: 'HMP-2026-0001',
        course: 'SE-ZG501',
        programme: 'MTECH-SE',
      }),
    ).toBe('HMP-2026-0001 for SE-ZG501 in MTECH-SE');
  });
  it('leaves unknown tokens as-is', () => {
    expect(renderTemplate('Hi {{unknown}}', { name: 'x' })).toBe('Hi {{unknown}}');
  });
  it('handles repeated tokens', () => {
    expect(renderTemplate('{{x}} and {{x}}', { x: 'one' })).toBe('one and one');
  });
  it('returns input unchanged when no tokens present', () => {
    expect(renderTemplate('plain text', { x: 'one' })).toBe('plain text');
  });
});

/**
 * Token-contract guard. Each seeded notification template is rendered with the
 * EXACT token set its notify function supplies; the result must contain no
 * residual `{{token}}`. This catches the class of bug where a template
 * references a token the supplier never provides (which renderTemplate would
 * otherwise leave as a literal `{{courseCode}}` in a real email).
 *
 * Table-driven: adding a future template is a one-line row. The template
 * strings come from the shared template constants in @hmp/db, the same source
 * seed.ts upserts — so there is zero drift between what's tested and what's
 * seeded.
 */
describe('notification template token contract', () => {
  // Prompt 12-b: the SME approval templates route through the transition path
  // (dispatchTransition in notifications.ts), so they render against that
  // builder's token set: refNo, course, programme, semester, actor. This
  // sample mirrors those keys — if an SME approval template references a token
  // dispatchTransition doesn't supply, the contract test below catches it.
  const transitionSample: Record<string, string> = {
    refNo: 'HMP-9999-0001',
    course: 'SE-ZG501 — Software Architecture',
    programme: 'MTECH-SE',
    semester: 'First Semester 2026',
    actor: 'Dr. Priya Chandra',
  };
  const publishSample: PublishTokenArgs = {
    refNo: 'HMP-9999-0002',
    courseCode: 'SE-ZG502',
    courseTitle: 'Object-Oriented Analysis',
    actorName: 'IC Officer',
  };

  // All seeded template families that have a notify-function token supplier.
  // Adding a future template is a one-line row here; the coverage check below
  // then forces it to be present in its constant.
  const ALL_TEMPLATES = [...SME_APPROVAL_TEMPLATES, ...PUBLISH_NOTIFICATION_TEMPLATES];
  const CONTRACT: Array<[string, () => Record<string, string>]> = [
    ['handout.sme_review_requested', () => transitionSample],
    ['handout.sme_approved', () => transitionSample],
    ['handout.sme_reverted', () => transitionSample],
    ['handout.publish_export_ready', () => publishNotificationTokens(publishSample)],
    ['handout.manually_published', () => publishNotificationTokens(publishSample)],
  ];

  for (const [key, supplier] of CONTRACT) {
    it(`template ${key} renders subject + body with no residual tokens`, () => {
      const tpl = ALL_TEMPLATES.find((t) => t.key === key);
      expect(tpl, `template ${key} must exist in a shared template constant`).toBeDefined();
      const tokens = supplier();
      expect(renderTemplate(tpl!.subject, tokens)).not.toMatch(/\{\{.*?\}\}/);
      expect(renderTemplate(tpl!.body, tokens)).not.toMatch(/\{\{.*?\}\}/);
    });
  }

  it('every shared template key is covered by the contract table', () => {
    const covered = new Set(CONTRACT.map(([k]) => k));
    for (const t of ALL_TEMPLATES) {
      expect(covered.has(t.key), `${t.key} is seeded but not in the contract table`).toBe(true);
    }
  });
});

describe('EVENT_TEMPLATE_KEY', () => {
  it('maps REVIEW_APPROVED to seeded key', () => {
    expect(EVENT_TEMPLATE_KEY.REVIEW_APPROVED).toBe('handout.review_approved');
  });
  it('maps FINAL_REJECTED to seeded key', () => {
    expect(EVENT_TEMPLATE_KEY.FINAL_REJECTED).toBe('handout.rejected');
  });
  it('covers every public lifecycle event', () => {
    expect(EVENT_TEMPLATE_KEY.REQUEST_INITIATED).toBe('handout.requested');
    expect(EVENT_TEMPLATE_KEY.FACULTY_ALLOCATED).toBe('handout.allocated');
    expect(EVENT_TEMPLATE_KEY.ASSIGNED).toBe('handout.assigned');
    expect(EVENT_TEMPLATE_KEY.SUBMITTED).toBe('handout.submitted');
    expect(EVENT_TEMPLATE_KEY.REVIEW_REWORK).toBe('handout.rework');
    expect(EVENT_TEMPLATE_KEY.FINAL_APPROVED).toBe('handout.approved');
    expect(EVENT_TEMPLATE_KEY.PUBLISHED).toBe('handout.published');
  });
});
