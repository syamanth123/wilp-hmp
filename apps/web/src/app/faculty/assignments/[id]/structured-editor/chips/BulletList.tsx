'use client';

import { useId } from 'react';
import { Button, Label } from '@hmp/ui';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  /** Placeholder for each row's input. */
  placeholder?: string;
  /** data-testid prefix (e.g. "bits-overall-scope"). */
  testIdPrefix?: string;
}

/**
 * Shared vertical list editor — semantic `<ul>` model rendered as one
 * input per row + Add/remove buttons. Used for paragraph-length items
 * (`experientialLearning.overallScope`, `labInfrastructure`). For
 * short string tags see `ChipList`.
 *
 * Faculty workflow:
 *   - Click "+ Add item" to append a new empty row.
 *   - Type into a row to edit it.
 *   - Click ✕ on a row to remove it.
 *
 * Fully controlled: each row's value lives in `value[i]`; the component
 * doesn't keep internal state for the rows themselves.
 */
export function BulletList({ value, onChange, label, placeholder, testIdPrefix }: Props) {
  const baseId = useId();

  const updateRow = (idx: number, next: string) =>
    onChange(value.map((row, i) => (i === idx ? next : row)));
  const removeRow = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const addRow = () => onChange([...value, '']);

  return (
    <div className="grid gap-1" data-testid={testIdPrefix ?? undefined}>
      <Label className="text-xs">{label}</Label>
      {value.length === 0 && (
        <p className="text-muted-foreground text-xs italic">No entries yet.</p>
      )}
      <ul className="grid gap-1">
        {value.map((row, idx) => (
          <li key={idx} className="grid grid-cols-[1fr_auto] items-start gap-1">
            <input
              id={`${baseId}-${idx}`}
              value={row}
              onChange={(e) => updateRow(idx, e.target.value)}
              placeholder={placeholder ?? 'Type item…'}
              className="bg-background rounded-md border px-2 py-1 text-sm"
              data-testid={testIdPrefix ? `${testIdPrefix}-row-${idx}` : undefined}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => removeRow(idx)}
              aria-label={`Remove item ${idx + 1}`}
            >
              ×
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="w-fit"
        data-testid={testIdPrefix ? `${testIdPrefix}-add` : undefined}
      >
        + Add item
      </Button>
    </div>
  );
}
