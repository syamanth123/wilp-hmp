import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';

const TABS = [
  { href: '/ic', label: 'Overview' },
  { href: '/ic/requests', label: 'Requests' },
  { href: '/ic/requests/new', label: 'New request' },
  { href: '/ic/semesters', label: 'Semesters & dates' },
  { href: '/ic/dibba', label: 'Course Dibba' },
  // v1.4.0: the IC confirms each person's department (Admin accounts stay with the Admin).
  { href: '/ic/people', label: 'People' },
  { href: '/ic/departments', label: 'Departments' },
];

export const dynamic = 'force-dynamic';

export default function ICLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/ic">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
