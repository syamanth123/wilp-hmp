import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';
import { DepartmentNotice } from '@/components/department-notice';

const TABS = [
  { href: '/hog', label: 'Overview' },
  { href: '/hog/requests', label: 'Requests' },
  { href: '/hog/department', label: 'My department' },
  { href: '/hog/schedule', label: 'Schedule' },
  { href: '/hog/bulk', label: 'Bulk tools' },
];

export const dynamic = 'force-dynamic';

export default function HOGLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/hog">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <DepartmentNotice />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
