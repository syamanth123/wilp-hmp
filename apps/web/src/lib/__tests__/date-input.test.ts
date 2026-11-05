import { describe, expect, it } from 'vitest';
import { formatDateInput, parseDateInput } from '../date-input';

describe('typed dates are day first, whatever the browser locale', () => {
  it.each([
    ['05/11/2026', '2026-11-05'],
    ['5/11/2026', '2026-11-05'],
    ['05-11-2026', '2026-11-05'],
    ['05.11.2026', '2026-11-05'],
    ['05 Nov 2026', '2026-11-05'],
    ['5 November 2026', '2026-11-05'],
    ['2026-11-05', '2026-11-05'],
    ['29/02/2028', '2028-02-29'],
    ['', ''],
  ])('%j → %j', (text, iso) => expect(parseDateInput(text)).toBe(iso));

  it.each(['31/02/2026', '13/13/2026', '11/05', 'tomorrow', '2026-13-01', '05 Foo 2026'])(
    'refuses %j',
    (text) => expect(parseDateInput(text)).toBeNull(),
  );

  it('shows the stored date as dd/mm/yyyy', () => {
    expect(formatDateInput('2026-11-05')).toBe('05/11/2026');
    expect(formatDateInput('')).toBe('');
    expect(formatDateInput(undefined)).toBe('');
  });
});
