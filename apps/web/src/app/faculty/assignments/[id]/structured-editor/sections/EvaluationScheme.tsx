'use client';

import { useEffect } from 'react';
import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { ecSumWeight, evaluationTotalWeight, isEvaluationValid } from './evaluation-validity';

type EvalComponent = BitsHandoutV1['evaluation']['components'][number];
type SubComponent = EvalComponent['subComponents'][number];

interface Props {
  value: BitsHandoutV1['evaluation'];
  onChange: (next: BitsHandoutV1['evaluation']) => void;
  /**
   * Fires whenever the evaluation section's UI-only validity changes (total
   * sub-component weight == 100). The root `StructuredEditor` uses this to
   * disable Save / Submit while invalid. Optional so the component can be
   * used in contexts that don't gate save (preview / read-only).
   *
   * NOTE: this is a UI-layer business rule. The Zod schema allows any weight
   * 0-100 per sub-component and any number of components. The sum-to-100
   * contract is a BITS convention enforced at save time by the editor.
   * Documented in docs/dev-handoff-audit.md §1.
   */
  onValidityChange?: (valid: boolean) => void;
}

/**
 * Evaluation Scheme (FULL, 11d-b). Replaces `EvaluationSchemeMinimal`.
 *
 * Faculty workflow:
 *   - Set the legend (free text; sometimes carries abbreviation glossary).
 *   - Add ECs (e.g. EC-1). Each EC has 1+ sub-components.
 *   - Per sub-component: name, type (Open book / Quiz / etc.), weight %,
 *     duration, scheduledAt (free text — see comments below).
 *   - Live feedback: each EC's local sum shown in its sub-header; the
 *     overall total in a sticky bar at the section bottom.
 *   - Save is blocked (via `onValidityChange`) until the overall total
 *     equals 100.
 *
 * scheduledAt: kept as a text input. Real BITS handouts use formats like
 * "21/09/2025 (AN)" or "September 01-10, 2025" — not ISO datetimes. The
 * schema is `z.string().optional()`; faculty types whichever format the
 * handout convention dictates. A native datetime picker would force them
 * to fight the UI for most rows; text matches the source domain.
 */
export function EvaluationScheme({ value, onChange, onValidityChange }: Props) {
  const totalWeight = evaluationTotalWeight(value);
  const valid = isEvaluationValid(value);

  useEffect(() => {
    onValidityChange?.(valid);
  }, [valid, onValidityChange]);

  const update = <K extends keyof BitsHandoutV1['evaluation']>(
    key: K,
    next: BitsHandoutV1['evaluation'][K],
  ) => onChange({ ...value, [key]: next });

  const updateEC = (idx: number, next: EvalComponent) =>
    update(
      'components',
      value.components.map((c, i) => (i === idx ? next : c)),
    );
  const removeEC = (idx: number) =>
    update(
      'components',
      value.components.filter((_, i) => i !== idx),
    );
  const addEC = () =>
    update('components', [
      ...value.components,
      {
        ecNumber: `EC-${value.components.length + 1}`,
        subComponents: [{ name: '', type: '', weight: 0, duration: '' }],
      },
    ]);

  const updateSubComponent = (ecIdx: number, scIdx: number, next: SubComponent) => {
    const ec = value.components[ecIdx]!;
    updateEC(ecIdx, {
      ...ec,
      subComponents: ec.subComponents.map((sc, i) => (i === scIdx ? next : sc)),
    });
  };
  const addSubComponent = (ecIdx: number) => {
    const ec = value.components[ecIdx]!;
    updateEC(ecIdx, {
      ...ec,
      subComponents: [...ec.subComponents, { name: '', type: '', weight: 0, duration: '' }],
    });
  };
  const removeSubComponent = (ecIdx: number, scIdx: number) => {
    const ec = value.components[ecIdx]!;
    if (ec.subComponents.length <= 1) return;
    updateEC(ecIdx, {
      ...ec,
      subComponents: ec.subComponents.filter((_, i) => i !== scIdx),
    });
  };

  return (
    <section aria-label="Evaluation Scheme" className="space-y-3" data-testid="bits-eval">
      <h3 className="text-base font-semibold">Evaluation Scheme</h3>

      <div className="grid gap-1">
        <Label htmlFor="bits-eval-legend">Legend</Label>
        <input
          id="bits-eval-legend"
          value={value.legend}
          onChange={(e) => update('legend', e.target.value)}
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>

      <div className="space-y-3">
        {value.components.map((ec, ecIdx) => {
          const ecSum = ecSumWeight(ec);
          return (
            <div key={ecIdx} className="space-y-2 rounded-md border p-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs">EC number</Label>
                <input
                  value={ec.ecNumber}
                  onChange={(e) => updateEC(ecIdx, { ...ec, ecNumber: e.target.value })}
                  className="bg-background w-24 rounded-md border px-2 py-1 font-mono text-sm"
                  data-testid={`bits-eval-ec-${ecIdx}`}
                />
                <span
                  className="text-muted-foreground text-xs"
                  data-testid={`bits-eval-ec-sum-${ecIdx}`}
                >
                  sum {ecSum}%
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeEC(ecIdx)}
                  aria-label={`Remove ${ec.ecNumber}`}
                  className="ml-auto"
                >
                  Remove EC
                </Button>
              </div>
              {ec.subComponents.map((sc, scIdx) => {
                const weightOk = sc.weight >= 0 && sc.weight <= 100;
                return (
                  <div
                    key={scIdx}
                    className="grid grid-cols-[1fr_120px_70px_100px_1fr_auto] items-end gap-2"
                  >
                    <div className="grid gap-1">
                      {scIdx === 0 && <Label className="text-xs">Name</Label>}
                      <input
                        value={sc.name}
                        onChange={(e) =>
                          updateSubComponent(ecIdx, scIdx, { ...sc, name: e.target.value })
                        }
                        className="bg-background rounded-md border px-2 py-1 text-sm"
                        data-testid={`bits-eval-name-${ecIdx}-${scIdx}`}
                      />
                    </div>
                    <div className="grid gap-1">
                      {scIdx === 0 && <Label className="text-xs">Type</Label>}
                      <input
                        value={sc.type}
                        onChange={(e) =>
                          updateSubComponent(ecIdx, scIdx, { ...sc, type: e.target.value })
                        }
                        className="bg-background rounded-md border px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="grid gap-1">
                      {scIdx === 0 && <Label className="text-xs">Weight %</Label>}
                      <input
                        type="number"
                        value={sc.weight}
                        onChange={(e) =>
                          updateSubComponent(ecIdx, scIdx, {
                            ...sc,
                            weight: Number(e.target.value),
                          })
                        }
                        className={`bg-background rounded-md border px-2 py-1 text-sm ${
                          weightOk ? '' : 'border-destructive'
                        }`}
                        data-testid={`bits-eval-weight-${ecIdx}-${scIdx}`}
                      />
                    </div>
                    <div className="grid gap-1">
                      {scIdx === 0 && <Label className="text-xs">Duration</Label>}
                      <input
                        value={sc.duration}
                        onChange={(e) =>
                          updateSubComponent(ecIdx, scIdx, { ...sc, duration: e.target.value })
                        }
                        className="bg-background rounded-md border px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="grid gap-1">
                      {scIdx === 0 && <Label className="text-xs">Scheduled at</Label>}
                      <input
                        value={sc.scheduledAt ?? ''}
                        onChange={(e) =>
                          updateSubComponent(ecIdx, scIdx, { ...sc, scheduledAt: e.target.value })
                        }
                        className="bg-background rounded-md border px-2 py-1 text-sm"
                        placeholder='e.g. "21/09/2025 (AN)" or "Sep 01-10, 2025"'
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeSubComponent(ecIdx, scIdx)}
                      disabled={ec.subComponents.length <= 1}
                      aria-label={`Remove sub-component ${sc.name || scIdx + 1}`}
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="outline"
                size="sm"
                onClick={() => addSubComponent(ecIdx)}
                data-testid={`bits-eval-sub-add-${ecIdx}`}
              >
                + Sub-component
              </Button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={addEC} data-testid="bits-eval-add-ec">
          + Add EC
        </Button>
        <div
          className={`flex-1 rounded-md border px-3 py-2 text-sm ${
            valid
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
          data-testid="bits-eval-total"
          role="status"
          aria-live="polite"
        >
          {valid ? (
            <span>
              <strong>Total weight: {totalWeight}%</strong> ✓ ready to save
            </span>
          ) : (
            <span>
              <strong>Total weight: {totalWeight}%</strong> — must equal 100%. Currently{' '}
              {totalWeight < 100 ? `${100 - totalWeight}% short` : `${totalWeight - 100}% over`}.
              <span className="ml-2 text-xs">Save is disabled until total = 100%.</span>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
