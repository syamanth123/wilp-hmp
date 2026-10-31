import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';

const TABS = [
  { href: '/pc', label: 'Overview' },
  { href: '/pc/requests', label: 'Requests' },
  { href: '/pc/schedule', label: 'Schedule' },
  { href: '/pc/bulk', label: 'Bulk tools' },
];

export const dynamic = 'force-dynamic';

export default function PCLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/pc">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
