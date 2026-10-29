import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GENERIC_ERROR, formError } from './form-error';

const fail = (schema: z.ZodTypeAny, value: unknown, labels?: Record<string, string>) => {
  const r = schema.safeParse(value);
  if (r.success) throw new Error('expected failure');
  return formError(r.error, labels);
};

describe('formError', () => {
  it('keeps a message the schema set on purpose', () => {
    expect(
      fail(z.object({ body: z.string().min(1, 'Comment cannot be empty') }), { body: '' }),
    ).toBe('Comment cannot be empty');
  });

  it('names the field for Zod defaults', () => {
    expect(fail(z.object({ name: z.string().min(2) }), { name: 'a' })).toBe(
      'Name must be at least 2 characters.',
    );
    expect(fail(z.object({ email: z.string().email() }), { email: 'x' })).toBe(
      'Email: enter a valid email address.',
    );
    expect(
      fail(z.object({ hogReviewSla: z.coerce.number().max(720) }), { hogReviewSla: 900 }),
    ).toBe('Hog review sla must be 720 or less.');
  });

  it('uses friendly labels when given', () => {
    expect(
      fail(
        z.object({ hogReviewSla: z.coerce.number().max(720) }),
        { hogReviewSla: 900 },
        {
          hogReviewSla: 'HOG review time (hours)',
        },
      ),
    ).toBe('HOG review time (hours) must be 720 or less.');
  });

  it('treats a required empty string as "is required"', () => {
    expect(fail(z.object({ title: z.string().min(1) }), { title: '' })).toBe('Title is required.');
  });

  it('gives the generic message for ids the page fills in', () => {
    expect(fail(z.object({ requestId: z.string().cuid() }), { requestId: 'nope' })).toBe(
      GENERIC_ERROR,
    );
  });

  it('never returns Zod wording', () => {
    const msg = fail(z.object({ url: z.string().url() }), { url: 'x' });
    expect(msg).not.toMatch(/Invalid url|String must/);
    expect(msg).toBe('Url: enter a full web address starting with https://');
  });
});
