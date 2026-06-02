'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { resetToEmptyTemplateAction } from '../structured-actions';

interface Props {
  requestId: string;
  tier: 'prior-version' | 'import' | 'empty';
  detail: string;
}

/**
 * Banner shown above the structured editor on the immediate post-startEditing
 * render (Prompt 11e). State lives in the URL search params `?autoFetched=…`
 * set by `startEditingAction`'s redirect — dismissing replaces the URL with a
 * params-stripped version, and the banner won't show again on subsequent
 * visits to the assignment page.
 *
 * Two affordances:
 *  - "Got it — continue editing" → router.replace strips the search params,
 *    banner disappears, faculty proceeds with the pre-populated data.
 *  - "Start from empty template instead" → calls resetToEmptyTemplateAction
 *    which overwrites version 1's data with the blank template; the action
 *    triggers its own revalidate, and we strip the search params too.
 */
export function AutoFetchBanner({ requestId, tier, detail }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const stripParams = () => {
    router.replace(pathname);
  };

  const resetToEmpty = () => {
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await resetToEmptyTemplateAction(fd);
      if (r?.error) {
        console.error('reset_to_empty_failed', r.error);
        return;
      }
      // Strip params; the page will revalidate from the action and re-render
      // with the empty data.
      router.replace(pathname);
    });
  };

  const heading = (() => {
    switch (tier) {
      case 'prior-version':
        return 'Pre-populated from a prior published handout';
      case 'import':
        return 'Pre-populated from an imported corpus handout';
      case 'empty':
        return 'Starting from an empty template';
    }
  })();

  return (
    <div
      role="status"
      data-testid="bits-autofetch-banner"
      data-tier={tier}
      style={{
        background: tier === 'empty' ? '#f1f5f9' : '#f0fdf4',
        border: `1px solid ${tier === 'empty' ? '#cbd5e1' : '#86efac'}`,
        borderRadius: 8,
        padding: '10px 14px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{heading}</p>
        <p style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
          {detail}. Review carefully and adjust for this semester — evaluation weights and other
          content from prior versions carry forward and must be confirmed before submitting.
        </p>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {tier !== 'empty' && (
          <Button
            variant="outline"
            size="sm"
            onClick={resetToEmpty}
            disabled={pending}
            data-testid="bits-autofetch-reset"
          >
            {pending ? 'Resetting…' : 'Start from empty template instead'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={stripParams}
          disabled={pending}
          data-testid="bits-autofetch-dismiss"
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
