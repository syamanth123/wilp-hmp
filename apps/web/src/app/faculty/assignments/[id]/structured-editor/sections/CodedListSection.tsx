'use client';

import { Button, Label } from '@hmp/ui';

interface Props<T extends { code: string }> {
  /** Section heading, e.g. "Course Objectives". */
  title: string;
  /** Label for the code column, e.g. "CO" / "T" / "R" / "LO". */
  codePrefix: string;
  /** Label for the second column. */
  rightLabel: string;
  /** Object key whose value is the second column (e.g. "description" or "citation"). */
  rightFieldKey: keyof T & string;
  /** Regex the code must match, e.g. `/^CO\d+$/`. */
  codeRegex: RegExp;
  /** Allow zero rows? (Reference Books is the only one.) */
  allowEmpty?: boolean;
  value: T[];
  onChange: (next: T[]) => void;
  /** Factory for a new row when faculty clicks "Add" (returns a row with both
   *  schema-required fields populated for safe Zod parsing). */
  makeNew: (suggestedCode: string) => T;
}

/**
 * Repeatable code+text editor — reused for Course Objectives (CO), Text
 * Books (T), Reference Books (R), and Learning Outcomes (LO). Generic over
 * the row shape so each schema-typed call site keeps full type safety
 * (description vs citation field is set by the caller, not erased).
 *
 * Inline regex validation surfaces a per-row error; on-save global Zod
 * parse surfaces total-row count and other constraints.
 */
export function CodedListSection<T extends { code: string }>({
  title,
  codePrefix,
  rightLabel,
  rightFieldKey,
  codeRegex,
  allowEmpty,
  value,
  onChange,
  makeNew,
}: Props<T>) {
  const updateRow = (idx: number, next: T) =>
    onChange(value.map((row, i) => (i === idx ? next : row)));

  const removeRow = (idx: number) => {
    if (!allowEmpty && value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    const nextNum = value.length + 1;
    onChange([...value, makeNew(`${codePrefix}${nextNum}`)]);
  };

  return (
    <section aria-label={title} className="space-y-2" data-testid={`bits-list-${codePrefix}`}>
      <h3 className="text-base font-semibold">{title}</h3>
      {value.length === 0 && allowEmpty && (
        <p className="text-muted-foreground text-xs">No entries yet.</p>
      )}
      <div className="space-y-2">
        {value.map((row, idx) => {
          const codeOk = codeRegex.test(row.code);
          const rightValue = String(row[rightFieldKey] ?? '');
          return (
            <div key={idx} className="grid grid-cols-[120px_1fr_auto] items-start gap-2">
              <div className="grid gap-1">
                {idx === 0 && <Label className="text-xs">Code</Label>}
                <input
                  value={row.code}
                  onChange={(e) => updateRow(idx, { ...row, code: e.target.value })}
                  className={`bg-background rounded-md border px-2 py-1 font-mono text-sm ${
                    codeOk ? '' : 'border-destructive'
                  }`}
                  data-testid={`bits-${codePrefix}-code-${idx}`}
                />
                {!codeOk && (
                  <p className="text-destructive text-xs">Must match {String(codeRegex)}</p>
                )}
              </div>
              <div className="grid gap-1">
                {idx === 0 && <Label className="text-xs">{rightLabel}</Label>}
                <input
                  value={rightValue}
                  onChange={(e) => updateRow(idx, { ...row, [rightFieldKey]: e.target.value } as T)}
                  className="bg-background rounded-md border px-2 py-1 text-sm"
                  data-testid={`bits-${codePrefix}-text-${idx}`}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeRow(idx)}
                disabled={!allowEmpty && value.length <= 1}
                className="mt-5"
                aria-label={`Remove ${row.code}`}
              >
                ×
              </Button>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="sm" onClick={addRow} data-testid={`bits-${codePrefix}-add`}>
        + Add {codePrefix}
      </Button>
    </section>
  );
}
