'use client';

import { Button, Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';
import { RichTextSubEditor } from '../RichTextSubEditor';

interface Props {
  value: BitsHandoutV1['experientialLearning'];
  onChange: (next: BitsHandoutV1['experientialLearning']) => void;
}

/**
 * Experiential Learning (MINIMAL, 11d-a). The entire section is optional —
 * faculty toggles it on/off. When on, only the `overallObjective` is
 * editable; the nested repeats (components / experiments / scope / lab
 * infrastructure) come in 11d-b. Empty inner arrays satisfy the schema
 * (the schema allows empty arrays on these fields).
 */
export function ExperientialMinimal({ value, onChange }: Props) {
  const isOn = value !== undefined;

  const enable = () =>
    onChange({
      components: [],
      overallObjective: '<p></p>',
      overallScope: [],
      labInfrastructure: [],
      experiments: [],
    });

  const disable = () => onChange(undefined);

  return (
    <section
      aria-label="Experiential Learning"
      className="space-y-2"
      data-testid="bits-experiential"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Experiential Learning</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={isOn ? disable : enable}
          data-testid="bits-experiential-toggle"
        >
          {isOn ? 'Remove section' : 'Add section'}
        </Button>
      </div>
      {!isOn ? (
        <p className="text-muted-foreground text-xs">
          Optional. Theory courses (e.g. <span className="font-mono">CC ZG501</span>) have no
          experiential section.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border p-3">
          <Label>Overall objective</Label>
          <RichTextSubEditor
            value={value.overallObjective}
            onChange={(html) => onChange({ ...value, overallObjective: html })}
          />
          <p className="text-muted-foreground text-xs">
            Components, scope, lab infrastructure, and the experiments table are added in Prompt
            11d-b. For now the section header renders with the objective only.
          </p>
        </div>
      )}
    </section>
  );
}
