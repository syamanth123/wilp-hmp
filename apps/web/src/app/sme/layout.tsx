import { AppShell } from '@/components/app-shell';
import { RoleTabs } from '@/components/role-tabs';

const TABS = [
  { href: '/sme', label: 'Overview' },
  { href: '/sme/review', label: 'Review queue' },
];

export const dynamic = 'force-dynamic';

export default function SmeLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell area="/sme">
      <div className="space-y-4">
        <RoleTabs tabs={TABS} />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
