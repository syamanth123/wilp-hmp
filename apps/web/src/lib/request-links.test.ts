import { describe, expect, it } from 'vitest';
import { requestHref } from './request-links';

describe('requestHref', () => {
  it('links each role to its own request page', () => {
    expect(requestHref('IC', 'r1')).toBe('/ic/requests/r1');
    expect(requestHref('HOG', 'r1')).toBe('/hog/requests/r1');
    expect(requestHref('PC', 'r1')).toBe('/pc/requests/r1');
    expect(requestHref('FACULTY', 'r1')).toBe('/faculty/assignments/r1');
    expect(requestHref('SME', 'r1')).toBe('/sme/review/r1');
    expect(requestHref('ADMIN', 'r1')).toBe('/ic/requests/r1');
  });
});
