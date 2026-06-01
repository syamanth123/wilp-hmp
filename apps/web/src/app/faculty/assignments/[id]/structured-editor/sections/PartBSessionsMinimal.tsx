'use client';

import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';

type Session = BitsHandoutV1['partB']['sessions'][number];

interface Props {
  value: Session[];
  onChange: (next: Session[]) => void;
}

/**
 * Part B — Learning Plan (MINIMAL, 11d-a). Each session row: session number
 * (string for ranges like "5-6"), topic title. subTopics + references use
 * simple textarea/CSV inputs — the rich list-editing UX is 11d-b.
 *
 * Schema requires `min(1)` so the remove button is disabled when only one
 * row remains.
 */
export function PartBSessionsMinimal({ value, onChange }: Props) {
  const updateRow = (idx: number, next: Session) =>
    onChange(value.map((row, i) => (i === idx ? next : row)));
  const removeRow = (idx: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, i) => i !== idx));
  };
  const addRow = () => {
    const nextNum = String(value.length + 1);
    onChange([...value, { sessionNumber: nextNum, topicTitle: '', subTopics: '', references: [] }]);
  };

  return (
    <section aria-label="Part B — Learning Plan" className="space-y-2" data-testid="bits-partb">
      <h3 className="text-base font-semibold">Part B — Learning Plan</h3>
      <p className="text-muted-foreground text-xs">
        Use ranges like <span className="font-mono">5-6</span> for combined contact sessions.
        Sub-topics: join multiple with <span className="font-mono">; </span>. References:
        comma-separated (e.g. <span className="font-mono">T1, R2 Chap 4</span>).
      </p>
      <div className="space-y-3">
        {value.map((row, idx) => (
          <div key={idx} className="grid grid-cols-[100px_1fr_auto] gap-2 rounded-md border p-2">
            <div className="grid gap-1">
              {idx === 0 && <Label className="text-xs">Session #</Label>}
              <input
                value={row.sessionNumber}
                onChange={(e) => updateRow(idx, { ...row, sessionNumber: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 font-mono text-sm"
                data-testid={`bits-partb-num-${idx}`}
              />
            </div>
            <div className="grid gap-1">
              {idx === 0 && <Label className="text-xs">Topic title</Label>}
              <input
                value={row.topicTitle}
                onChange={(e) => updateRow(idx, { ...row, topicTitle: e.target.value })}
                className="bg-background rounded-md border px-2 py-1 text-sm"
                data-testid={`bits-partb-title-${idx}`}
              />
              <Label className="mt-1 text-xs">Sub-topics</Label>
              <textarea
                value={row.subTopics}
                onChange={(e) => updateRow(idx, { ...row, subTopics: e.target.value })}
                placeholder="Topic A; Topic B; Topic C"
                rows={2}
                className="bg-background rounded-md border px-2 py-1 text-sm"
              />
              <Label className="mt-1 text-xs">References (comma-separated)</Label>
              <input
                value={row.references.join(', ')}
                onChange={(e) =>
                  updateRow(idx, {
                    ...row,
                    references: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="bg-background rounded-md border px-2 py-1 font-mono text-sm"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => removeRow(idx)}
              disabled={value.length <= 1}
              aria-label={`Remove session ${row.sessionNumber}`}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={addRow} data-testid="bits-partb-add">
        + Add session
      </Button>
    </section>
  );
}
