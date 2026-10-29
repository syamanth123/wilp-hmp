import { describe, expect, it } from 'vitest';
import { generatePassword } from './generate-password';

describe('generatePassword', () => {
  it('is 12 characters by default and meets the 6-character minimum', () => {
    expect(generatePassword()).toHaveLength(12);
  });

  it('uses no look-alike characters', () => {
    for (let i = 0; i < 50; i++) expect(generatePassword()).not.toMatch(/[0O1lI]/);
  });

  it('is never the old default and differs each time', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).not.toBe('password');
    expect(a).not.toBe(b);
  });
});
