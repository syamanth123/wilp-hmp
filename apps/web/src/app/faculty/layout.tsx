import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';

const TABS = [
  { href: '/faculty', label: 'Overview' },
  { href: '/faculty/assignments', label: 'My assignments' },
  { href: '/faculty/schedule', label: 'My schedule' },
];

export const dynamic = 'force-dynamic';

export default function FacultyLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/faculty">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
