import { describe, it, expect } from 'vitest';
import { renderTemplate, EVENT_TEMPLATE_KEY } from './notifications';

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
