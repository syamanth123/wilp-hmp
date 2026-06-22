'use client';

import { useMemo } from 'react';
import { renderBitsHandout, type BitsHandoutV1 } from '@hmp/db';

interface Props {
  data: BitsHandoutV1;
}

/**
 * Live preview of the BITS-format HTML — uses the SAME renderer
 * (`renderBitsHandout`) the LMS export ZIP and all read paths use. "What
 * you see here is exactly what gets published." (Prompt 11d plan §7.)
 */
export function PreviewPane({ data }: Props) {
  const html = useMemo(
    () =>
      renderBitsHandout(data, {
        cssScope: 'inline',
        logoSrc: '/bits-header.png',
        watermarkSrc: '/bits-watermark.png',
      }),
    [data],
  );
  return (
    <div className="bg-background rounded-md border p-2" data-testid="bits-preview">
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
