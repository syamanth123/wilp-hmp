'use client';

import { Label } from '@hmp/ui';
import type { BitsHandoutV1 } from '@hmp/db';

interface Props {
  value: BitsHandoutV1['importantLinks'];
  onChange: (next: BitsHandoutV1['importantLinks']) => void;
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ImportantLinks({ value, onChange }: Props) {
  const update = <K extends keyof BitsHandoutV1['importantLinks']>(
    key: K,
    next: BitsHandoutV1['importantLinks'][K],
  ) => onChange({ ...value, [key]: next });
  const urlOk = looksLikeUrl(value.elearnPortalUrl);

  return (
    <section aria-label="Important Links" className="space-y-2" data-testid="bits-important-links">
      <h3 className="text-base font-semibold">Important Links</h3>
      <div className="grid gap-1">
        <Label htmlFor="bits-elearn-url">eLearn portal URL *</Label>
        <input
          id="bits-elearn-url"
          type="url"
          value={value.elearnPortalUrl}
          onChange={(e) => update('elearnPortalUrl', e.target.value)}
          className={`bg-background rounded-md border px-2 py-1 font-mono text-sm ${
            urlOk ? '' : 'border-destructive'
          }`}
          data-testid="bits-elearn-url"
        />
        {!urlOk && <p className="text-destructive text-xs">Must be a full http(s) URL</p>}
      </div>
      <div className="grid gap-1">
        <Label htmlFor="bits-elearn-note">eLearn portal note</Label>
        <textarea
          id="bits-elearn-note"
          value={value.elearnPortalNote}
          onChange={(e) => update('elearnPortalNote', e.target.value)}
          rows={2}
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="bits-contact-note">Contact sessions note</Label>
        <textarea
          id="bits-contact-note"
          value={value.contactSessionsNote}
          onChange={(e) => update('contactSessionsNote', e.target.value)}
          rows={2}
          className="bg-background rounded-md border px-2 py-1 text-sm"
        />
      </div>
    </section>
  );
}
