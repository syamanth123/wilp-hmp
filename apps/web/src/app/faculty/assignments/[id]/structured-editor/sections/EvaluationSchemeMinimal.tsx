'use client';

import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';

type EvalComponent = BitsHandoutV1['evaluation']['components'][number];
type SubComponent = EvalComponent['subComponents'][number];

interface Props {
  value: BitsHandoutV1['evaluation'];
  onChange: (next: BitsHandoutV1['evaluation']) => void;
}

/**
 * Evaluation Scheme (MINIMAL, 11d-a). Faculty can add ECs (e.g. "EC-1") and
 * sub-components (Name / Type / Weight / Duration / Scheduled). Weight is
 * 0-100 with inline validation; the live sum-to-100 warning is 11d-b. The
 * schema requires `evaluation.components` to be an array (no `.min(1)`) — so
 * zero rows is technically valid; the UI nudges faculty to add at least one.
 */
export function EvaluationSchemeMinimal({ value, onChange }: Props) {
  const update = <K extends keyof BitsHandoutV1['evaluation']>(
    key: K,
    next: BitsHandoutV1['evaluation'][K],
  ) => onChange({ ...value, [key]: next });

  const addEC = () =>
    update('components', [
      ...value.components,
      {
        ecNumber: `EC-${value.components.length + 1}`,
        subComponents: [{ name: '', type: '', weight: 0, duration: '' }],
      },
    ]);

  const removeEC = (idx: number) =>
    update(
      'components',
      value.components.filter((_, i) => i !== idx),
    );

  const updateEC = (idx: number, next: EvalComponent) =>
    update(
      'components',
      value.components.map((c, i) => (i === idx ? next : c)),
    );

  const addSubComponent = (ecIdx: number) => {
    const ec = value.components[ecIdx]!;
    updateEC(ecIdx, {
      ...ec,
      subComponents: [...ec.subComponents, { name: '', type: '', weight: 0, duration: '' }],
    });
  };

  const updateSubComponent = (ecIdx: number, scIdx: number, next: SubComponent) => {
    const ec = value.components[ecIdx]!;
    updateEC(ecIdx, {
      ...ec,
      subComponents: ec.subComponents.map((sc, i) => (i === scIdx ? next : sc)),
    });
  };

  const removeSubComponent = (ecIdx: number, scIdx: number) => {
    const ec = value.components[ecIdx]!;
    if (ec.subComponents.length <= 1) return;
    updateEC(ecIdx, { ...ec, subComponents: ec.subComponents.filter((_, i) => i !== scIdx) });
  };

  const totalWeight = value.components.reduce(
    (sum, ec) =>
      sum + ec.subComponents.reduce((s, sc) => s + (Number.isFinite(sc.weight) ? sc.weight : 0), 0),
    0,
  );

  return (
    <section aria-label="Evaluation Scheme" className="space-y-2" data-testid="bits-eval">
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
        {value.components.map((ec, ecIdx) => (
          <div key={ecIdx} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs">EC number</Label>
              <input
                value={ec.ecNumber}
                onChange={(e) => updateEC(ecIdx, { ...ec, ecNumber: e.target.value })}
                className="bg-background w-24 rounded-md border px-2 py-1 font-mono text-sm"
                data-testid={`bits-eval-ec-${ecIdx}`}
              />
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
                  className="grid grid-cols-[1fr_100px_70px_100px_auto] items-end gap-2"
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
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={addEC} data-testid="bits-eval-add-ec">
          + Add EC
        </Button>
        <span className="text-muted-foreground text-xs" data-testid="bits-eval-total">
          Total weight: {totalWeight}% {totalWeight === 100 ? '✓' : '(target 100%)'}
        </span>
      </div>
    </section>
  );
}
