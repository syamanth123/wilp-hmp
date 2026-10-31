'use client';

import type { BitsHandoutV1 } from '@hmp/db';
import { InlineField } from './InlineField';

interface Props {
  value: BitsHandoutV1['metadata'];
  onChange: (next: BitsHandoutV1['metadata']) => void;
}

/**
 * The letterhead, drawn exactly as `renderHeader()` prints it. Institution,
 * division, semester and document title come from the request and stay
 * read-only (as in the old form); only the optional form number is editable,
 * shown where the footer prints it.
 */
export function HeaderBlock({ value, onChange }: Props) {
  return (
    <div className="bits-handout-header">
      <img
        className="bits-handout-logo"
        src="/bits-header.png"
        alt="Birla Institute of Technology & Science, Pilani"
      />
      <h1>{value.institutionHeader}</h1>
      <div>{value.divisionHeader}</div>
      <div>{value.semester}</div>
      <div>
        <strong>{value.documentTitle}</strong>
      </div>
      <div style={{ marginTop: 6, fontSize: '0.85em', color: '#555' }}>
        Form No.{' '}
        <InlineField
          value={value.formNumber}
          onChange={(formNumber) => onChange({ ...value, formNumber })}
          placeholder="optional"
          label="Form number"
          testId="bits-form-number"
          widthCh={Math.max(9, value.formNumber.length + 2)}
        />
      </div>
    </div>
  );
}
