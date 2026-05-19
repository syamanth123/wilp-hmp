import Link from 'next/link';
import { AppShell } from '@/components/app-shell';

const TABS = [
  { href: '/hog', label: 'Overview' },
  { href: '/hog/requests', label: 'Requests' },
];

export const dynamic = 'force-dynamic';

export default function HOGLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/hog">
      <div className="space-y-4">
        <nav className="flex flex-wrap gap-2 border-b pb-2 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
