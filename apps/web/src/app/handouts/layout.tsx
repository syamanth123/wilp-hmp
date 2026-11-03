import { AppShell } from '@/components/app-shell';

export const dynamic = 'force-dynamic';

export default function HandoutLibraryLayout({ children }: { children: React.ReactNode }) {
  return <AppShell area="/handouts">{children}</AppShell>;
}
