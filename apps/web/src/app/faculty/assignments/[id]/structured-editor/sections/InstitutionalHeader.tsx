'use client';

import { Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';

interface Props {
  value: BitsHandoutV1['metadata'];
  onChange: (next: BitsHandoutV1['metadata']) => void;
}

/**
 * Institutional header section. Most fields are derived (semester from the
 * request context; institution/division/documentTitle are constants the
 * structured editor pre-populates). Faculty edits only `formNumber` —
 * sometimes blank, sometimes printed at the top of the handout.
 */
export function InstitutionalHeader({ value, onChange }: Props) {
  return (
    <section aria-label="Institutional header" className="space-y-3">
      <h3 className="text-base font-semibold">Institutional header</h3>
      <p className="text-muted-foreground text-xs">
        Derived from the request. Only the form number is editable here.
      </p>
      <dl className="text-muted-foreground grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
        <dt>Institution</dt>
        <dd>{value.institutionHeader}</dd>
        <dt>Division</dt>
        <dd>{value.divisionHeader}</dd>
        <dt>Semester</dt>
        <dd>{value.semester}</dd>
        <dt>Document title</dt>
        <dd>{value.documentTitle}</dd>
      </dl>
      <div className="grid gap-1">
        <Label htmlFor="bits-form-number">Form number (optional)</Label>
        <input
          id="bits-form-number"
          data-testid="bits-form-number"
          value={value.formNumber}
          onChange={(e) => onChange({ ...value, formNumber: e.target.value })}
          placeholder="e.g. F-WILP-001"
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>
    </section>
  );
}
