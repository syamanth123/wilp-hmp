'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface RecentNotification {
  id: string;
  subject: string;
  body: string;
  link: string | null;
  createdAt: string;
  status: string;
}

interface Snapshot {
  unread: number;
  recent: RecentNotification[];
}

const POLL_FALLBACK_MS = 30_000;

export function NotificationBell() {
  const [snap, setSnap] = useState<Snapshot>({ unread: 0, recent: [] });
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof EventSource === 'undefined') {
      // Fallback polling.
      let cancelled = false;
      const tick = async () => {
        try {
          const res = await fetch('/api/notifications/stream', { headers: { Accept: 'application/json' } });
          if (!res.ok) return;
        } catch {
          /* ignore */
        }
      };
      const t = setInterval(tick, POLL_FALLBACK_MS);
      return () => {
        cancelled = true;
        void cancelled;
        clearInterval(t);
      };
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      es = new EventSource('/api/notifications/stream');
      es.addEventListener('notification', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as Snapshot;
          // Coerce dates as strings; they come pre-serialized.
          setSnap(data);
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        es?.close();
        es = null;
        reconnectTimer = setTimeout(connect, 3_000);
      };
    };
    connect();

    return () => {
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="bits-btn relative"
        style={{ width: 38, height: 38, padding: 0 }}
        aria-label={snap.unread > 0 ? `Notifications, ${snap.unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {snap.unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-white"
            style={{
              top: 4,
              right: 4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              background: 'var(--danger)',
              boxShadow: '0 0 0 2px #fff',
            }}
          >
            {snap.unread > 99 ? '99+' : snap.unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Recent notifications"
          className="absolute right-0 z-50 mt-2 w-80 rounded-md border bg-background p-2 shadow-md"
        >
          <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
            <span>{snap.unread} unread</span>
            <Link href="/notifications" className="underline" onClick={() => setOpen(false)} role="menuitem">
              View all
            </Link>
          </div>
          {snap.recent.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
              </span>
              <span className="empty-title">You&apos;re all caught up</span>
              <span className="empty-hint">New activity will appear here.</span>
            </div>
          )}
          <ul className="max-h-80 overflow-y-auto">
            {snap.recent.map((n) => (
              <li key={n.id} className="border-t first:border-t-0">
                <Link
                  href={n.link ?? '/notifications'}
                  onClick={() => setOpen(false)}
                  className="block px-2 py-2 hover:bg-accent"
                  role="menuitem"
                >
                  <div className="text-sm font-medium">{n.subject}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
