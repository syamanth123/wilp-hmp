import Link from 'next/link';
import { AppShell } from '@/components/app-shell';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/roles', label: 'Roles' },
  { href: '/admin/programmes', label: 'Programmes' },
  { href: '/admin/import', label: 'Import' },
  { href: '/admin/workflow', label: 'Workflow' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/ai-metrics', label: 'AI Metrics' },
  { href: '/admin/audit', label: 'Audit' },
];

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/admin">
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
