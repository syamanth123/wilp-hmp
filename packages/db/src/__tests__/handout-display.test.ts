import { describe, it, expect } from 'vitest';
import { resolveHandoutHtml } from '../handout-display';
import golden from '../__fixtures__/handout-aelzg631.json';

describe('resolveHandoutHtml — fallback decision', () => {
  it('uses the structured renderer when version.data is present and valid', () => {
    const html = resolveHandoutHtml(
      { data: golden, contentHtml: '<p>legacy fallback should not appear</p>' },
      { omitInstitutionalHeader: true, cssScope: 'none' },
    );
    expect(html).toBeTruthy();
    expect(html).toContain('Automotive Diagnostics and Interfaces'); // from structured data
    expect(html).not.toContain('legacy fallback should not appear'); // legacy was bypassed
  });

  it('falls back to contentHtml when data is null', () => {
    const html = resolveHandoutHtml({
      data: null,
      contentHtml: '<p>legacy content</p>',
    });
    expect(html).toBe('<p>legacy content</p>');
  });

  it('falls back to contentHtml when data is undefined', () => {
    const html = resolveHandoutHtml({
      data: undefined,
      contentHtml: '<p>legacy content</p>',
    });
    expect(html).toBe('<p>legacy content</p>');
  });

  it('returns null when both data and contentHtml are absent', () => {
    expect(resolveHandoutHtml({ data: null, contentHtml: null })).toBeNull();
    expect(resolveHandoutHtml({ data: undefined, contentHtml: null })).toBeNull();
  });

  it('falls back to contentHtml when data is present but malformed (defensive)', () => {
    // A malformed `data` shouldn't crash the renderer — the user still sees
    // the legacy HTML so the UI degrades gracefully. Surfacing the malformed
    // case is the consumer's job, not the helper's.
    const html = resolveHandoutHtml({
      data: { schemaVersion: 1, partA: 'not a partA object' },
      contentHtml: '<p>legacy still works</p>',
    });
    expect(html).toBe('<p>legacy still works</p>');
  });

  it('passes RenderOptions through to renderBitsHandout', () => {
    const withHeader = resolveHandoutHtml(
      { data: golden, contentHtml: null },
      { cssScope: 'none' },
    );
    const withoutHeader = resolveHandoutHtml(
      { data: golden, contentHtml: null },
      { cssScope: 'none', omitInstitutionalHeader: true },
    );
    expect(withHeader).toContain('Birla Institute of Technology &amp; Science, Pilani');
    expect(withoutHeader).not.toContain('Birla Institute of Technology &amp; Science, Pilani');
  });
});
