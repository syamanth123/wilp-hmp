import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';
import { aiFeaturesEnabled } from '@/lib/features';

const TABS = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/roles', label: 'Roles' },
  { href: '/admin/programmes', label: 'Programmes' },
  { href: '/admin/import', label: 'Import' },
  { href: '/admin/corpus-imports', label: 'Past handouts' },
  { href: '/admin/workflow', label: 'Workflow' },
  { href: '/admin/notifications', label: 'Notifications' },
  { href: '/admin/queues', label: 'Background jobs' },
  // Shown only with AI_FEATURES_ENABLED=true (filtered below).
  { href: '/admin/ai-metrics', label: 'AI Metrics', ai: true },
  { href: '/admin/audit', label: 'Audit' },
];

export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/admin">
      <div className="space-y-4">
        <RoleTabs tabs={TABS.filter((t) => !('ai' in t) || aiFeaturesEnabled())} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
