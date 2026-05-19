'use client';

import { useTransition } from 'react';
import { Button } from '@hmp/ui';
import { toggleUserActiveAction } from './actions';

export function ToggleActiveButton({ userId, active }: { userId: string; active: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant={active ? 'outline' : 'default'}
      disabled={pending}
      onClick={() => startTransition(() => toggleUserActiveAction(userId))}
    >
      {pending ? '…' : active ? 'Deactivate' : 'Activate'}
    </Button>
  );
}
