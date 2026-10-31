import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, parseCsvRows } from '../dibba-import/csv';
import { facultyRowsFromRecords } from '../dibba-import/xlsx';

const FIXTURE = join(__dirname, '..', '__fixtures__', 'dibba', 'faculty-synthetic.csv');

describe('parseCsvRows / parseCsv (RFC-4180 subset)', () => {
  it('splits plain rows and trims header cells', () => {
    expect(parseCsv(' a , b\n1,2\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('keeps commas, doubled quotes and newlines inside quoted fields', () => {
    const text = 'name,note\n"Rao, S","said ""hi""\nthen left"\n';
    expect(parseCsv(text)).toEqual([{ name: 'Rao, S', note: 'said "hi"\nthen left' }]);
  });

  it('accepts CRLF line ends and a UTF-8 BOM', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsvRows(`${bom}a,b\r\n1,2\r\n`)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips blank lines and pads short rows', () => {
    expect(parseCsv('a,b,c\n1\n\n2,3\n')).toEqual([
      { a: '1', b: '', c: '' },
      { a: '2', b: '3', c: '' },
    ]);
  });

  it('handles a final row without a trailing newline and an empty input', () => {
    expect(parseCsvRows('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b\n')).toEqual([]);
  });

  it('ignores cells under an empty header', () => {
    expect(parseCsv('a,,c\n1,2,3\n')).toEqual([{ a: '1', c: '3' }]);
  });
});

describe('faculty sheet as CSV goes through the shared row core', () => {
  it('the synthetic fixture parses to one record per data line and yields instructor rows', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    const dataLines = text.split(/\r?\n/).filter((l, i) => i > 0 && l.trim() !== '').length;
    const records = parseCsv(text);
    expect(records).toHaveLength(dataLines);
    const rows = facultyRowsFromRecords(records);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.courseCode).toMatch(/^[A-Z]{2,5} Z[CG]\d{3,4}T?$/);
      expect(r.email === null || r.email === r.email.toLowerCase()).toBe(true);
    }
  });
});
