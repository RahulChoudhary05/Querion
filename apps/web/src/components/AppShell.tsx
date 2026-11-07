import { motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight, Flame, Keyboard, LayoutDashboard, LayoutGrid, LogOut, Orbit, Search, Settings as SettingsIcon, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { modKey, useHotkeys } from '../lib/hooks';
import { useMeta, useStats } from '../lib/queries';
import { useSession, useSignOut } from '../lib/session';
import { useApp } from '../lib/store';
import { usePalette } from './CommandPalette';
import { Logo, LogoMark } from './Logo';
import { Onboarding } from './Onboarding';
import { confirmAction, cx, Dialog, Kbd, toast } from './ui';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/problems', label: 'Problems', icon: LayoutGrid },
  { to: '/daily', label: 'Daily Orbit', icon: Flame },
  { to: '/me', label: 'Progress', icon: User },
  { to: '/nebula', label: 'Nebula', icon: Orbit },
];

const SHORTCUTS: [string, string][] = [
  [`${modKey} K`, 'Command palette'],
  [`${modKey} ↵`, 'Run query'],
  [`${modKey} ⇧ ↵`, 'Submit'],
  [`${modKey} S`, 'Format SQL'],
  [`${modKey} B`, 'Toggle sidebar'],
  ['G then P', 'Go to problems'],
  ['G then D', 'Go to daily'],
  ['G then H', 'Go home'],
  ['?', 'This help'],
];

function NavItem({ to, label, icon: Icon, end, collapsed }: { to: string; label: string; icon: typeof Flame; end?: boolean; collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cx(
          'group relative flex h-9 items-center gap-3 rounded-xl px-2.5 text-sm transition-colors',
          isActive ? 'text-ink' : 'text-muted hover:bg-panel-2 hover:text-ink',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-panel-2" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <Icon className={cx('relative size-[18px] shrink-0', isActive && 'text-accent')} />
          {!collapsed && <span className="relative">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const studio = pathname.startsWith('/p/');
  const collapsedPref = useApp((s) => s.sidebarCollapsed);
  const collapsed = studio || collapsedPref;
  const toggleSidebar = useApp((s) => s.toggleSidebar);
  const { user } = useSession();
  const logout = useSignOut();
  const openPalette = usePalette((s) => s.setOpen);
  const nav = useNavigate();
  const { data: meta } = useMeta();
  const { data: stats } = useStats();
  const [help, setHelp] = useState(false);

  useHotkeys(
    {
      '?': () => setHelp(true),
      'shift+?': () => setHelp(true),
      'mod+b': () => toggleSidebar(),
      'g p': () => nav('/problems'),
      'g d': () => nav('/daily'),
      'g h': () => nav('/dashboard'),
      'g m': () => nav('/me'),
    },
    [nav]
  );

  const signOut = async () => {
    if (await confirmAction({ title: 'Sign out?', body: 'Your progress is saved to your account. Drafts stay on this device.', confirm: 'Sign out' })) {
      logout.mutate(undefined, { onSettled: () => toast.info('Signed out') });
    }
  };

  const tracks = (meta?.domains ?? []).filter((d) => d.datasets.length);

  return (
    <div className="relative flex h-dvh overflow-hidden">
      {/* Aurora: living background, calmer inside the studio */}
      <div className="aurora" data-quiet={studio} aria-hidden>
        <span />
        <span />
        <span />
      </div>
      {/* Persistent sidebar (desktop) */}
      <aside className={cx('glass relative z-10 hidden shrink-0 flex-col !border-y-0 !border-l-0 transition-[width] duration-300 md:flex', collapsed ? 'w-[60px]' : 'w-[248px]')}>
        <div className={cx('flex h-14 items-center', collapsed ? 'justify-center' : 'px-4')}>
          <NavLink to="/dashboard" aria-label="Querion dashboard">{collapsed ? <LogoMark size={28} /> : <Logo />}</NavLink>
        </div>
        <div className={cx('px-3 pb-2', collapsed && 'px-2')}>
          <button
            onClick={() => openPalette(true)}
            className={cx('flex h-9 w-full items-center gap-2 rounded-xl border border-line bg-panel px-2.5 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted', collapsed && 'justify-center px-0')}
            aria-label="Search"
          >
            <Search className="size-4" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Search…</span>
                <Kbd>{modKey}K</Kbd>
              </>
            )}
          </button>
        </div>
        <nav className={cx('flex flex-col gap-0.5 px-3', collapsed && 'px-2')}>
          {NAV.map((n) => (
            <NavItem key={n.to} {...n} collapsed={collapsed} />
          ))}
        </nav>
        {!collapsed && (
          <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
            {tracks.map((d) => (
              <div key={d.key} className="mb-2">
                <div className="eyebrow flex items-center gap-2 px-2.5 pb-1 pt-1.5">
                  <span className="size-1.5 rounded-full" style={{ background: `oklch(0.75 0.15 ${d.hue})`, boxShadow: `0 0 8px oklch(0.75 0.15 ${d.hue})` }} />
                  {d.label}
                </div>
                {d.datasets.map((k) => {
                  const ds = meta?.datasets?.find((x) => x.key === k);
                  return (
                    <NavLink
                      key={k}
                      to={`/tracks/${k}`}
                      title={ds?.name ?? k}
                      className={({ isActive }) => cx('flex h-8 items-center gap-2 rounded-lg pl-6 pr-2.5 text-[13px] transition-colors', isActive ? 'bg-panel-2 text-ink' : 'text-muted hover:text-ink')}
                    >
                      <span className="truncate">{ds?.name ?? k}</span>
                      {ds?.source === 'kaggle' && <span className="ml-auto shrink-0 rounded px-1 font-mono text-[9.5px] text-faint ring-1 ring-line">kaggle</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {collapsed && <div className="flex-1" />}
        <div className={cx('flex flex-col gap-1 border-t border-line p-3', collapsed && 'items-center p-2')}>
          {!collapsed && stats && stats.streak > 0 && (
            <div className="mb-1 flex items-center gap-2 rounded-xl bg-warn/10 px-2.5 py-2 text-xs text-warn">
              <Flame className="size-4" /> {stats.streak}-day streak
            </div>
          )}
          <div className={cx('flex items-center gap-1', collapsed && 'flex-col')}>
            <button onClick={() => setHelp(true)} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-panel-2 hover:text-ink" aria-label="Keyboard shortcuts">
              <Keyboard className="size-4" />
            </button>
            {!studio && (
              <button onClick={toggleSidebar} className="grid size-9 place-items-center rounded-xl text-muted hover:bg-panel-2 hover:text-ink" aria-label="Collapse sidebar">
                {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
              </button>
            )}
          </div>
          {user && (
            <div className={cx('flex items-center gap-1', collapsed && 'flex-col')}>
              <NavLink
                to="/settings"
                title="Account settings"
                className={({ isActive }) => cx('flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-panel-2', isActive && 'bg-panel-2', collapsed && 'w-9 flex-none justify-center px-0')}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-nebula text-[11px] font-bold">{user.handle[0]?.toUpperCase()}</span>
                {!collapsed && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-ink">{user.handle}</span>
                    <span className="block truncate text-[11px] text-faint">{user.email}</span>
                  </span>
                )}
                {!collapsed && <SettingsIcon className="ml-auto size-3.5 shrink-0 text-faint" />}
              </NavLink>
              <button onClick={signOut} className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-panel-2 hover:text-ink" title="Sign out" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="glass flex h-14 shrink-0 items-center justify-between !border-x-0 !border-t-0 px-4 md:hidden">
          <NavLink to="/dashboard">
            <Logo size={24} />
          </NavLink>
          <div className="flex items-center gap-1">
            <button onClick={() => openPalette(true)} className="grid size-9 place-items-center rounded-xl text-muted" aria-label="Search">
              <Search className="size-[18px]" />
            </button>
          </div>
        </header>
        <div className={cx('min-h-0 flex-1', studio ? 'overflow-hidden' : 'overflow-y-auto pb-20 md:pb-0')}>
          <Outlet />
        </div>
        {/* mobile bottom tabs */}
        {!studio && (
          <nav className="glass-strong fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around !border-x-0 !border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden">
            {[...NAV.slice(0, 4), { to: '/settings', label: 'Account', icon: SettingsIcon }].map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => cx('flex flex-col items-center gap-1 text-[10.5px]', isActive ? 'text-accent' : 'text-muted')}>
                <Icon className="size-5" />
                {label.split(' ')[0]}
              </NavLink>
            ))}
          </nav>
        )}
      </main>

      <Dialog open={help} onClose={() => setHelp(false)} label="Keyboard shortcuts">
        <h2 className="mb-4 flex items-center gap-2 font-semibold">
          <Keyboard className="size-4 text-accent" /> Keyboard shortcuts
        </h2>
        <div className="grid gap-2">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="flex items-center justify-between text-sm">
              <span className="text-muted">{d}</span>
              <span className="flex gap-1">{k.split(' ').map((x) => <Kbd key={x}>{x}</Kbd>)}</span>
            </div>
          ))}
        </div>
      </Dialog>
      <Onboarding />
    </div>
  );
}

export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div>
        {eyebrow && <div className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">{eyebrow}</div>}
        <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] md:text-[32px]">{title}</h1>
        {children && <div className="mt-2 max-w-2xl text-[15px] text-muted">{children}</div>}
      </div>
      {actions}
    </div>
  );
}
