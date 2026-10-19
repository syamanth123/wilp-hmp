import { fmtInt } from '../format';

/**
 * Codes with no catalogue match, computed LIVE on each page load (plan D10):
 * two buckets with different meanings. (a) codes the strict catalogue format
 * can never hold (trailing-T project codes, 5-letter prefixes — rejected by
 * normalizeBitsCourseNumber by design); (b) real gaps for ADMIN to fill under
 * /admin/programmes — on a nearly empty catalogue (dev seed, CI, the pilot)
 * that is most of the file, which is a catalogue-population task, not an
 * import error. Bucket (b) is bounded (first 25 shown, the rest collapsed and
 * capped at 500) because it can be ~600 codes today.
 */
export interface UnknownCode {
  code: string;
  rows: number;
  title: string;
}

const SHOW_FIRST = 25;
const HARD_CAP = 500;

export function UnknownCodes({
  unmatchable,
  notFound,
}: {
  unmatchable: UnknownCode[];
  notFound: UnknownCode[];
}) {
  const visible = notFound.slice(0, SHOW_FIRST);
  const rest = notFound.slice(SHOW_FIRST, HARD_CAP);
  const beyond = Math.max(0, notFound.length - HARD_CAP);
  return (
    <div className="space-y-4 text-sm" data-testid="dibba-unknown-codes">
      <div data-testid="dibba-unknown-unmatchable">
        <p className="font-medium">
          Cannot exist in the catalogue by format ({unmatchable.length} codes)
        </p>
        <p className="text-muted-foreground text-xs">
          Dissertation / project codes ending in T and five-letter prefixes are rejected by the
          catalogue&apos;s strict course-number rule, so these can never link. They are kept on the
          schedule as written.
        </p>
        {unmatchable.length > 0 && <CodeList codes={unmatchable} />}
      </div>
      <div data-testid="dibba-unknown-notfound">
        <p className="font-medium">Not found in the catalogue ({notFound.length} codes)</p>
        <p className="text-muted-foreground text-xs">
          Valid course numbers with no Course row yet. Adding them under Admin → Programmes links
          them here on the next page load — no re-upload needed.
        </p>
        {visible.length > 0 && <CodeList codes={visible} />}
        {rest.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs underline-offset-4 hover:underline">
              {fmtInt.format(rest.length)} more{beyond > 0 ? '' : ' — show all'}
            </summary>
            <CodeList codes={rest} />
            {beyond > 0 && (
              <p className="text-muted-foreground mt-1 text-xs">
                …and {fmtInt.format(beyond)} more.
              </p>
            )}
          </details>
        )}
      </div>
    </div>
  );
}

function CodeList({ codes }: { codes: UnknownCode[] }) {
  return (
    <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs md:grid-cols-2 lg:grid-cols-3">
      {codes.map((c) => (
        <li key={c.code} className="flex items-baseline gap-2">
          <span className="font-mono">{c.code}</span>
          <span className="text-muted-foreground truncate" title={c.title}>
            {c.title}
          </span>
          <span className="text-muted-foreground ml-auto whitespace-nowrap">
            {c.rows} row{c.rows === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}
