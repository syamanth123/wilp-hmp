'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@hmp/ui';
import { signOutAction } from '@/app/login/actions';

export function SignOutButton({ sidebarStyle }: { sidebarStyle?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const handleClick = () =>
    startTransition(async () => {
      await signOutAction();
      router.push('/login');
    });

  if (sidebarStyle) {
    return (
      <button
        disabled={pending}
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '9px 12px',
          color: 'rgba(255,255,255,0.75)',
          fontSize: 14,
          fontWeight: 500,
          borderRadius: 6,
          background: 'transparent',
          border: '1px solid transparent',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
        </svg>
        <span>{pending ? 'Signing out…' : 'Sign out'}</span>
      </button>
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={handleClick}
    >
      {pending ? '…' : 'Sign out'}
    </Button>
  );
}
