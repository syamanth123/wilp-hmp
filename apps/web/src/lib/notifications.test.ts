import { describe, it, expect } from 'vitest';
import { SME_NOTIFICATION_TEMPLATES } from '@hmp/db';
import {
  renderTemplate,
  EVENT_TEMPLATE_KEY,
  smeNominationTokens,
  smeAcceptedTokens,
  smeDeclinedTokens,
  smeCompletedTokens,
  type SmeTokenArgs,
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
 * strings come from the shared SME_NOTIFICATION_TEMPLATES constant in @hmp/db,
 * the same source seed.ts upserts — so there is zero drift between what's
 * tested and what's seeded.
 */
describe('notification template token contract', () => {
  const sample: SmeTokenArgs = {
    refNo: 'HMP-9999-0001',
    courseCode: 'SE-ZG501',
    courseTitle: 'Software Architecture',
    programme: 'MTECH-SE',
    semester: 'First Semester 2026',
    actorName: 'Dr. Priya Chandra',
    topic: 'Industry case study selection',
    reason: 'Out of expertise this term',
  };

  const CONTRACT: Array<[string, () => Record<string, string>]> = [
    ['handout.sme_nominated', () => smeNominationTokens(sample)],
    ['handout.sme_accepted', () => smeAcceptedTokens(sample)],
    ['handout.sme_declined', () => smeDeclinedTokens(sample)],
    ['handout.sme_completed', () => smeCompletedTokens(sample)],
  ];

  for (const [key, supplier] of CONTRACT) {
    it(`template ${key} renders subject + body with no residual tokens`, () => {
      const tpl = SME_NOTIFICATION_TEMPLATES.find((t) => t.key === key);
      expect(tpl, `template ${key} must exist in SME_NOTIFICATION_TEMPLATES`).toBeDefined();
      const tokens = supplier();
      expect(renderTemplate(tpl!.subject, tokens)).not.toMatch(/\{\{.*?\}\}/);
      expect(renderTemplate(tpl!.body, tokens)).not.toMatch(/\{\{.*?\}\}/);
    });
  }

  it('every SME template key in the constant is covered by the contract table', () => {
    const covered = new Set(CONTRACT.map(([k]) => k));
    for (const t of SME_NOTIFICATION_TEMPLATES) {
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
