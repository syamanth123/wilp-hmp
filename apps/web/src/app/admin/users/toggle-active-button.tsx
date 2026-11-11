'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { Button, buttonVariants } from '@hmp/ui';
import { toggleUserActiveAction } from './actions';

/**
 * Activate here; v1.4.2 (F13): deactivating goes through Edit person, which lists the person's open work and
 * hands it over in the same step (and ends their session).
 */
export function ToggleActiveButton({ userId, active }: { userId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  if (active)
    return (
      <Link
        href={`/admin/people/${userId}?leaving=1`}
        className={buttonVariants({ size: 'sm', variant: 'outline' })}
        data-testid="user-deactivate"
      >
        Deactivate…
      </Link>
    );
  return (
    <Button
      size="sm"
      variant="default"
      disabled={pending}
      onClick={() => startTransition(() => toggleUserActiveAction(userId))}
    >
      {pending ? '…' : 'Activate'}
    </Button>
  );
}
