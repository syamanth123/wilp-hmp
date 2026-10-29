import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';

const TABS = [
  { href: '/hog', label: 'Overview' },
  { href: '/hog/requests', label: 'Requests' },
  { href: '/hog/schedule', label: 'Schedule' },
  { href: '/hog/bulk', label: 'Bulk tools' },
];

export const dynamic = 'force-dynamic';

export default function HOGLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/hog">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
