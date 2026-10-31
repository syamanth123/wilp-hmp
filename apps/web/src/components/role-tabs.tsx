'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface RoleTab {
  href: string;
  label: string;
}

/**
 * The tab row under each role's header. The tab for the current page is
 * highlighted: the longest tab path that the address starts with, so
 * /hog/requests/123 highlights "Requests" and /hog highlights "Overview".
 */
export function RoleTabs({ tabs }: { tabs: RoleTab[] }) {
  const pathname = usePathname() ?? '';
  const active = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex flex-wrap gap-2 border-b pb-2 text-sm" aria-label="Section">
      {tabs.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'bg-accent text-foreground rounded-md px-3 py-1.5 font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-1.5'
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
