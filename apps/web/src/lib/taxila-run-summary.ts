// Counting a bulk Taxila run's results — shared by the run page (browser) and the server's
// "finished" summary, so both say the same thing. No server imports here.

export const PROBLEM_STATUSES = [
  'NOT_FOUND',
  'AMBIGUOUS',
  'ITEM_MISSING',
  'OTHER_FILES',
  'FAILED',
] as string[];

export interface RunSummary {
  total: number;
  published: number;
  attention: number;
  skipped: number;
  waiting: number;
  ready: number;
}

export function summariseRun(rows: { status: string }[]): RunSummary {
  const n = (...s: string[]) => rows.filter((r) => s.includes(r.status)).length;
  return {
    total: rows.length,
    published: n('PUBLISHED'),
    attention: n(...PROBLEM_STATUSES),
    skipped: n('SKIPPED'),
    waiting: n('PENDING', 'WORKING'),
    ready: n('READY'),
  };
}

/** "2 published, 1 needs attention" (+ skipped when there are any). */
export function finishedLine(s: RunSummary): string {
  return [
    `${s.published} published`,
    s.skipped ? `${s.skipped} skipped` : '',
    `${s.attention} ${s.attention === 1 ? 'needs' : 'need'} attention`,
  ]
    .filter(Boolean)
    .join(', ');
}
