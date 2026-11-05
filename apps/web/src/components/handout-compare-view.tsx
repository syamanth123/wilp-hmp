import type { ReactNode } from 'react';
import { Card } from '@hmp/ui';
import type {
  ChangeKind,
  CompareRow,
  CompareSection,
  HandoutComparison,
} from '@/lib/handout-compare';

/**
 * Side-by-side comparison of two handouts (Handout Library viewer).
 * Presentational and server-compatible: no hooks, no client state. The data
 * comes from `compareHandouts()`.
 *
 * Colour is never the only cue: every row carries a small text tag
 * ("Added" / "Removed" / "Changed"), removed words are struck through (<del>)
 * and added words are underlined (<ins>).
 */

const KIND_TAG: Record<ChangeKind, { label: string; cls: string }> = {
  added: { label: 'Added', cls: 'bg-green-100 text-green-900 border-green-300' },
  removed: { label: 'Removed', cls: 'bg-red-100 text-red-900 border-red-300' },
  changed: { label: 'Changed', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  same: { label: 'Unchanged', cls: 'bg-muted text-muted-foreground border-transparent' },
};

const DEL_CLS = 'rounded-sm bg-red-100 px-0.5 text-red-900 line-through decoration-red-500/70';
const INS_CLS = 'rounded-sm bg-green-100 px-0.5 text-green-900 underline decoration-green-600/60';

function KindTag({ kind }: { kind: ChangeKind }) {
  const t = KIND_TAG[kind];
  return (
    <span
      className={`inline-block rounded border px-1.5 py-px text-[10.5px] font-semibold uppercase tracking-wide ${t.cls}`}
    >
      {t.label}
    </span>
  );
}

/** One column of a 'changed' row: shared words plus this side's own words. */
function DiffSide({ row, side }: { row: CompareRow; side: 'before' | 'after' }) {
  const words = row.words ?? [];
  const own = side === 'before' ? 'del' : 'add';
  const parts = words.filter((w) => w.op === 'eq' || w.op === own);
  return (
    <>
      {parts.map((w, i) => {
        const sep = i > 0 ? ' ' : '';
        if (w.op === 'eq') return <span key={i}>{sep + w.text}</span>;
        return (
          <span key={i}>
            {sep}
            {w.op === 'del' ? (
              <del className={DEL_CLS}>
                <span className="sr-only">removed: </span>
                {w.text}
              </del>
            ) : (
              <ins className={INS_CLS}>
                <span className="sr-only">added: </span>
                {w.text}
              </ins>
            )}
          </span>
        );
      })}
    </>
  );
}

function Cell({
  row,
  side,
  caption,
}: {
  row: CompareRow;
  side: 'before' | 'after';
  caption: string;
}) {
  const value = side === 'before' ? row.before : row.after;
  let body: ReactNode = value;
  // Background goes on the cell; strike-through only on the text, so the
  // caption above it stays readable.
  let cellCls = 'rounded-md px-2.5 py-1.5';
  let textCls = 'whitespace-pre-wrap break-words';
  if (value === null) {
    body = <span className="text-muted-foreground italic">Not in {caption}</span>;
  } else if (row.kind === 'removed') {
    cellCls += ' bg-red-50 text-red-900';
    textCls += ' line-through decoration-red-400/50';
  } else if (row.kind === 'added') {
    cellCls += ' bg-green-50 text-green-900';
  } else if (row.kind === 'changed') {
    cellCls += ' bg-background';
    body = <DiffSide row={row} side={side} />;
  } else {
    cellCls += ' text-muted-foreground';
  }
  return (
    <div className={cellCls}>
      {/* Visible caption on narrow screens (columns stacked); screen-reader only
          on wide screens where the column headings above say it. */}
      <div className="text-muted-foreground mb-0.5 text-[11px] font-medium md:sr-only">
        {caption}
      </div>
      <div className={textCls}>{body}</div>
    </div>
  );
}

function Row({
  row,
  beforeLabel,
  afterLabel,
}: {
  row: CompareRow;
  beforeLabel: string;
  afterLabel: string;
}) {
  return (
    <li data-kind={row.kind} className="border-t py-2.5 first:border-t-0">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
        <KindTag kind={row.kind} />
        <span className="font-medium">{row.label}</span>
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-2">
        <Cell row={row} side="before" caption={beforeLabel} />
        <Cell row={row} side="after" caption={afterLabel} />
      </div>
    </li>
  );
}

function changesText(n: number): string {
  if (n === 0) return 'No changes';
  return n === 1 ? '1 change' : `${n} changes`;
}

function Section({
  section,
  beforeLabel,
  afterLabel,
  showUnchanged,
}: {
  section: CompareSection;
  beforeLabel: string;
  afterLabel: string;
  showUnchanged: boolean;
}) {
  const visible = showUnchanged ? section.rows : section.rows.filter((r) => r.kind !== 'same');
  const hidden = section.rows.length - visible.length;
  const headingId = `compare-${section.key}`;
  return (
    <Card data-testid="compare-section" className="p-4">
      <section aria-labelledby={headingId}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={headingId} className="font-serif text-base font-semibold">
            {section.title}
          </h3>
          <span
            className={
              section.changed > 0
                ? 'text-sm font-medium text-amber-800'
                : 'text-muted-foreground text-sm'
            }
          >
            {changesText(section.changed)}
          </span>
        </div>
        {visible.length > 0 && (
          <>
            <div
              aria-hidden="true"
              className="text-muted-foreground mt-2 hidden gap-3 text-xs font-medium uppercase tracking-wide md:grid md:grid-cols-2"
            >
              <div className="px-2.5">{beforeLabel}</div>
              <div className="px-2.5">{afterLabel}</div>
            </div>
            <ul className="mt-1">
              {visible.map((r) => (
                <Row key={r.key} row={r} beforeLabel={beforeLabel} afterLabel={afterLabel} />
              ))}
            </ul>
          </>
        )}
        {hidden > 0 && (
          <p className="text-muted-foreground mt-1 text-xs">
            {hidden === 1 ? '1 unchanged item hidden' : `${hidden} unchanged items hidden`}
          </p>
        )}
      </section>
    </Card>
  );
}

export function HandoutCompareView({
  comparison,
  beforeLabel,
  afterLabel,
  showUnchanged = false,
}: {
  comparison: HandoutComparison;
  beforeLabel: string;
  afterLabel: string;
  showUnchanged?: boolean;
}) {
  return (
    <div data-testid="compare-view" className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>
          Comparing <strong className="text-foreground">{beforeLabel}</strong> with{' '}
          <strong className="text-foreground">{afterLabel}</strong>
        </span>
        <span className="flex flex-wrap items-center gap-2" aria-label="Legend">
          <KindTag kind="added" />
          <KindTag kind="removed" />
          <KindTag kind="changed" />
          <span>
            Removed words are <del className={DEL_CLS}>struck through</del>, added words are{' '}
            <ins className={INS_CLS}>underlined</ins>.
          </span>
        </span>
      </div>
      {comparison.changedRows === 0 && (
        <p className="text-muted-foreground text-sm">These two handouts have the same content.</p>
      )}
      {comparison.sections.map((s) => (
        <Section
          key={s.key}
          section={s}
          beforeLabel={beforeLabel}
          afterLabel={afterLabel}
          showUnchanged={showUnchanged}
        />
      ))}
    </div>
  );
}
