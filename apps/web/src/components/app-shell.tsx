import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, type SessionUser } from '@hmp/auth';
import { RoleName } from '@hmp/db';
import { isAllowed } from '@/lib/routing';
import { SignOutButton } from './sign-out-button';
import { NotificationBell } from './notification-bell';

type NavItem = { href: string; label: string; roles: RoleName[]; icon: React.ReactNode };

function ShieldIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l8 3v6c0 4.5-3.3 8.5-8 9-4.7-.5-8-4.5-8-9V6l8-3z"/>
    </svg>
  );
}
function BookIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2V5z"/><path d="M4 17h14"/>
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 20c0-2.2 1.3-4.2 3-5"/>
    </svg>
  );
}
function FlowIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l3 9M16 7l-3 9"/>
    </svg>
  );
}
function EditIcon() {
  return (
    <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4l11-11-4-4L4 16v4z"/>
    </svg>
  );
}
const NAV: NavItem[] = [
  { href: '/admin',    label: 'Admin',               roles: [RoleName.ADMIN],                                              icon: <ShieldIcon /> },
  { href: '/ic',       label: 'Instruction Cell',     roles: [RoleName.INSTRUCTION_CELL, RoleName.ADMIN],                  icon: <BookIcon /> },
  { href: '/hog',      label: 'HOG',                  roles: [RoleName.HOG, RoleName.ADMIN],                               icon: <UsersIcon /> },
  { href: '/pc',       label: 'Programme Committee',  roles: [RoleName.PROGRAMME_COMMITTEE, RoleName.ADMIN],               icon: <FlowIcon /> },
  { href: '/faculty',  label: 'Faculty',              roles: [RoleName.FACULTY, RoleName.ADMIN],                           icon: <EditIcon /> },
];

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function roleLabel(roles: RoleName[]): string {
  const map: Record<string, string> = {
    ADMIN: 'Administrator',
    INSTRUCTION_CELL: 'Instruction Cell',
    HOG: 'Head of Group',
    PROGRAMME_COMMITTEE: 'Programme Committee',
    FACULTY: 'Faculty',
    SME: 'SME',
  };
  return roles.map(r => map[r] ?? r).join(', ');
}

export async function AppShell({
  area,
  children,
}: {
  area: '/admin' | '/ic' | '/hog' | '/pc' | '/faculty';
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (!isAllowed(user, area)) {
    return <ForbiddenView user={user} />;
  }
  const visible = NAV.filter((n) => n.roles.some((r) => user.roles.includes(r)));
  const currentLabel = NAV.find(n => n.href === area)?.label ?? area.slice(1);

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside className="glass-sidebar w-[248px] shrink-0 flex flex-col min-h-screen">
        {/* Brand */}
        <div style={{ padding: '18px 18px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <Image
            src="/bits-logo.png"
            alt="BITS Pilani"
            width={400}
            height={200}
            priority
            style={{
              width: '100%',
              maxWidth: 200,
              height: 'auto',
              objectFit: 'contain',
              objectPosition: 'left center',
              display: 'block',
            }}
          />
          <div style={{
            marginTop: 10,
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            fontWeight: 500,
            color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Handout Management Portal
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: '18px 12px 6px' }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', padding: '0 10px 8px', fontFamily: 'var(--font-mono)' }}>Workspace</div>
          <nav className="flex flex-col gap-0.5">
            {visible.map((n) => {
              const active = area === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '9px 12px',
                    color: active ? '#fff' : 'rgba(255,255,255,0.7)',
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    borderRadius: 6,
                    textDecoration: 'none',
                    background: active ? 'rgba(255,255,255,0.18)' : 'transparent',
                    border: active ? '1px solid rgba(255,255,255,0.14)' : '1px solid transparent',
                    boxShadow: active ? 'inset 3px 0 0 var(--bits-gold), 0 2px 10px rgba(0,0,0,0.18)' : 'none',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                >
                  <span style={{ opacity: active ? 1 : 0.65, flexShrink: 0 }}>{n.icon}</span>
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Account */}
        <div style={{ padding: '18px 12px 6px' }}>
          <div style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.45)', padding: '0 10px 8px', fontFamily: 'var(--font-mono)' }}>Account</div>
          <SignOutButton sidebarStyle />
        </div>

        {/* Footer / user */}
        <div style={{ marginTop: 'auto', padding: 16, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#f5a623', color: '#1a1300', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
            {initials(user.name ?? user.email)}
          </div>
          <div style={{ fontSize: 13, color: '#fff', minWidth: 0 }}>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name ?? user.email}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 1 }}>{roleLabel(user.roles)}</div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Topbar */}
        <header className="glass-topbar h-16 px-7 flex items-center gap-4 sticky top-0 z-10">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-2 text-sm">
            <span style={{ color: 'var(--muted)' }}>HMP</span>
            <span style={{ color: 'var(--muted-2)' }}>/</span>
            <span style={{ color: 'var(--bits-navy)', fontWeight: 600 }}>{currentLabel}</span>
          </div>
          <div className="flex-1" />
          {/* Notification bell */}
          <NotificationBell />
          {/* Profile chip */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '4px 12px 4px 4px',
            border: '1px solid rgba(255,255,255,0.55)',
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderRadius: 999,
            boxShadow: '0 1px 3px rgba(20,32,74,0.06)',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bits-navy)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>
              {initials(user.name ?? user.email)}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{user.name ?? user.email}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{roleLabel(user.roles)}</div>
            </div>
          </div>
        </header>

        {/* Content — bottom padding reserves room for the frozen tagline strip */}
        <main className="flex-1 p-7 max-w-[1480px] w-full" style={{ paddingBottom: 48 }}>{children}</main>
      </div>

      {/* Brand tagline — frozen to viewport bottom, sits only to the right of the sidebar */}
      <footer
        aria-label="BITS WILP tagline: innovate, achieve, lead"
        style={{
          position: 'fixed',
          left: 248,
          right: 0,
          bottom: 0,
          height: 16,
          overflow: 'hidden',
          borderTop: '1px solid rgba(20,32,74,0.08)',
          boxShadow: '0 -1px 8px rgba(20,32,74,0.06), inset 0 1px 0 rgba(255,255,255,0.55)',
          zIndex: 20,
          pointerEvents: 'none',
        }}
      >
        <Image
          src="/tagline.jpg"
          alt=""
          fill
          sizes="(min-width: 768px) calc(100vw - 248px), 100vw"
          style={{
            objectFit: 'cover',
            objectPosition: 'center 70%',
          }}
        />
      </footer>
    </div>
  );
}

function ForbiddenView({ user }: { user: SessionUser }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-10">
      <div className="glass-panel p-10 max-w-md text-center">
        <h1 className="mb-2 text-2xl font-semibold" style={{ fontFamily: 'var(--font-serif)' }}>403 — Forbidden</h1>
        <p style={{ color: 'var(--muted)' }}>
          You ({user.email}) do not have access to this area. Your roles: {user.roles.join(', ') || 'none'}.
        </p>
      </div>
    </div>
  );
}
