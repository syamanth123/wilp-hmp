import { describe, expect, it } from 'vitest';
import { parseAllocationsCsv, parseCsv, parseQueueActionsCsv } from '@hmp/integrations';
import {
  HOG_BULK_ALLOCATE_TEMPLATE,
  HOG_BULK_REVIEW_TEMPLATE,
  PC_ALLOCATION_REVIEW_TEMPLATE,
  PC_BULK_REVIEW_TEMPLATE,
  SME_BULK_REVIEW_TEMPLATE,
} from './bulk-templates';
import { PC_ALLOCATION_CONFIG } from '../app/pc/allocation-review/config';
import { PC_CONFIG } from '../app/pc/bulk-review/config';
import { HOG_CONFIG } from '../app/hog/bulk-review/config';
import { SME_CONFIG } from '../app/sme/bulk-review/config';

// Every bulk template must match the validator that reads it: same columns,
// and exactly the actions that validator accepts. A downloaded template that
// the upload then rejects would be the worst kind of bug for these users.

/** The action names listed in the template's "# action is one of: a | b" line. */
function documentedActions(template: string): string[] {
  const line = template.split('\n').find((l) => l.startsWith('# action is one of:'));
  if (!line) return [];
  return line
    .replace('# action is one of:', '')
    .split('.')[0]!
    .split('|')
    .map((a) => a.trim())
    .filter(Boolean);
}

/** The example rows (commented out in the template), un-commented. */
function exampleRows(template: string): string {
  const [header, ...rest] = template.trim().split('\n');
  const examples = rest.filter((l) => /^# HMP-/.test(l)).map((l) => l.replace(/^# /, ''));
  return [header, ...examples].join('\n');
}

const REVIEW_TEMPLATES = [
  ['PC allocation review', PC_ALLOCATION_REVIEW_TEMPLATE, PC_ALLOCATION_CONFIG],
  ['PC handout review', PC_BULK_REVIEW_TEMPLATE, PC_CONFIG],
  ['HOG handout review', HOG_BULK_REVIEW_TEMPLATE, HOG_CONFIG],
  ['SME handout review', SME_BULK_REVIEW_TEMPLATE, SME_CONFIG],
] as const;

describe('bulk review templates match their validators', () => {
  for (const [name, template, config] of REVIEW_TEMPLATES) {
    it(`${name}: columns are request_reference, action, comment`, () => {
      expect(parseCsv(template).header).toEqual(['request_reference', 'action', 'comment']);
    });

    it(`${name}: documents exactly the actions the validator accepts`, () => {
      expect([...documentedActions(template)].sort()).toEqual([...config.allowedActions].sort());
    });

    it(`${name}: example rows parse and use allowed actions, with comments where required`, () => {
      const parsed = parseQueueActionsCsv(exampleRows(template));
      expect(parsed.ok).toBe(true);
      expect(parsed.rows.length).toBeGreaterThan(0);
      for (const row of parsed.rows) {
        expect(config.allowedActions).toContain(row.action);
        if (config.commentRequiredFor.includes(row.action)) {
          expect(row.comment.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it(`${name}: the template as downloaded has no data rows (examples are ignored)`, () => {
      expect(parseQueueActionsCsv(template).rows).toEqual([]);
    });
  }
});

describe('HOG bulk allocation template', () => {
  it('has the columns the allocation parser requires and its examples parse', () => {
    expect(parseCsv(HOG_BULK_ALLOCATE_TEMPLATE).header).toEqual([
      'request_reference',
      'faculty_emails',
      'sme_email',
    ]);
    const parsed = parseAllocationsCsv(exampleRows(HOG_BULK_ALLOCATE_TEMPLATE));
    expect(parsed.ok).toBe(true);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]!.faculty_emails).toBe('a@hmp.local,b@hmp.local');
  });
});
