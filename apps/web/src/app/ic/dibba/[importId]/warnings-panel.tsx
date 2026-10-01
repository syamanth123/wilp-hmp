import { groupDibbaWarnings, type DibbaWarningSeverity } from '@hmp/db';

/**
 * Every parser warning, in full, grouped by family (plan D6). A deliberate
 * departure from /admin/corpus-imports, which shows only the first warning:
 * the IC must be able to read each one against the printed Dibba.
 */
const TONE: Record<DibbaWarningSeverity, { box: string; title: string; note: string }> = {
  error: {
    box: 'border-red-300 bg-red-50',
    title: 'text-red-800',
    note: 'Rows may be missing or wrong — check before publishing.',
  },
  confirm: {
    box: 'border-amber-300 bg-amber-50',
    title: 'text-amber-800',
    note: 'Confirm before publishing.',
  },
  info: {
    box: 'border-slate-300 bg-slate-50',
    title: 'text-slate-700',
    note: 'Informational.',
  },
};

export function WarningsPanel({ warnings }: { warnings: string[] }) {
  const groups = groupDibbaWarnings(warnings);
  if (groups.length === 0) {
    return (
      <p className="text-sm text-emerald-700" data-testid="dibba-warnings">
        ✓ The parser raised no warnings.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="dibba-warnings">
      {groups.map((g) => {
        const tone = TONE[g.severity];
        return (
          <section
            key={g.family}
            className={`rounded-md border p-3 ${tone.box}`}
            data-testid={`dibba-warnings-${g.family}`}
          >
            <h4 className={`text-sm font-semibold ${tone.title}`}>
              {g.title} — {tone.note.replace(/\.$/, '').toLowerCase()} ({g.warnings.length})
            </h4>
            <p className="text-muted-foreground mt-1 text-xs">{g.explanation}</p>
            <ul className="mt-2 space-y-1">
              {g.warnings.map((w, i) => (
                <li
                  key={`${g.family}-${i}`}
                  data-kind={g.family}
                  className="whitespace-pre-wrap break-words font-mono text-xs"
                >
                  {w}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
