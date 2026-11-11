import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="/settings">{children}</AppShell>;
}
