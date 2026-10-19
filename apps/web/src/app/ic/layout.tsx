import Link from 'next/link';
import { AppShell } from '@/components/app-shell';

const TABS = [
  { href: '/ic', label: 'Overview' },
  { href: '/ic/requests', label: 'Requests' },
  { href: '/ic/requests/new', label: 'New request' },
  { href: '/ic/semesters', label: 'Semesters & dates' },
  { href: '/ic/dibba', label: 'Course Dibba' },
];

export const dynamic = 'force-dynamic';

export default function ICLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/ic">
      <div className="space-y-4">
        <nav className="flex flex-wrap gap-2 border-b pb-2 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-1.5"
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
