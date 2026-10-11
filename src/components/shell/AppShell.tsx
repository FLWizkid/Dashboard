import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronRight, ChevronsLeft, ChevronsRight, Clock, LogOut, Menu, Moon, Plus, Search, Sun, Terminal, Unplug, Wrench, LayoutDashboard, CheckSquare, Settings as SettingsIcon } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/auth/AuthProvider';
import { useSettings } from '@/data/settings';
import { seedIfFirstRun } from '@/data/demo';
import { seedMonitorsIfFirstRun, useOpsHealth } from '@/data/ops';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { QuickAdd } from '@/components/tasks/QuickAdd';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { LogTimeForm } from '@/components/time/LogTimeForm';
import { FocusIndicator, FocusStartDialog } from '@/components/time/Focus';
import { NAV_GROUPS, isBuilt, type NavItem } from './nav';
import { useUi } from './ui-context';
import { useGlobalShortcuts } from './shortcuts';
import { useTheme } from './use-theme';
import { CommandPalette } from './CommandPalette';

function NavItemLink({ n, collapsed, onNavigate, badge }: { n: NavItem; collapsed: boolean; onNavigate?: () => void; badge?: ReactNode }) {
  const built = isBuilt(n);
  return (
    <NavLink
      to={n.to}
      end={n.to === '/'}
      onClick={onNavigate}
      title={collapsed ? n.label : undefined}
      className={({ isActive }) =>
        cn(
          'relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors',
          isActive
            ? 'bg-primary-500/10 font-medium text-primary-700 before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary-500 dark:text-primary-300'
            : built
              ? 'text-muted hover:bg-raised hover:text-fg'
              : 'text-subtle hover:bg-raised hover:text-muted',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <n.icon className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{n.label}</span>
          {badge}
          {!built && <span className="rounded border border-line px-1 text-[10px] text-subtle">P{n.phase}</span>}
        </>
      )}
    </NavLink>
  );
}

function OpsBadge() {
  const { health } = useOpsHealth();
  const red = health.filter((h) => h.status === 'action').length;
  if (!red) return null;
  return <span className="rounded-full bg-error-500/15 px-1.5 text-xs font-medium text-error-700 dark:text-error-300" aria-label={`${red} red health lights`}>{red}</span>;
}

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const upcoming = NAV_GROUPS.flatMap((g) => g.items).filter((n) => !isBuilt(n));
  const onUpcoming = upcoming.some((n) => location.pathname.startsWith(n.to));
  const [showUpcoming, setShowUpcoming] = useState(onUpcoming);
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => isBuilt(n) && n.to !== '/settings') })).filter((g) => g.items.length);

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label}>
          {!collapsed && <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((n) => (
              <li key={n.to}>
                <NavItemLink n={n} collapsed={collapsed} onNavigate={onNavigate} badge={n.to === '/ops' ? <OpsBadge /> : undefined} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      {upcoming.length > 0 && (
        <div>
          {!collapsed ? (
            <button
              onClick={() => setShowUpcoming((s) => !s)}
              aria-expanded={showUpcoming || onUpcoming}
              className="flex w-full items-center gap-1 px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle transition-colors hover:text-muted"
            >
              <ChevronRight className={cn('size-3 transition-transform', (showUpcoming || onUpcoming) && 'rotate-90')} />
              Coming soon
              <span className="ml-auto normal-case tracking-normal">{upcoming.length}</span>
            </button>
          ) : (
            <div className="mx-2 mb-2 border-t border-line" />
          )}
          {(collapsed || showUpcoming || onUpcoming) && (
            <ul className="space-y-0.5 animate-fade-in">
              {upcoming.map((n) => (
                <li key={n.to}>
                  <NavItemLink n={n} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </nav>
  );
}

function AccountFooter({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const initial = (user?.email ?? '?').charAt(0).toUpperCase();
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) toast('Could not sign out. Try again.', 'error');
  };
  return (
    <div className={cn('border-t border-line p-3', collapsed && 'px-2')}>
      <NavLink
        to="/settings"
        onClick={onNavigate}
        title="Settings"
        className={({ isActive }) => cn('flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors', isActive ? 'bg-primary-500/10 font-medium text-primary-700 dark:text-primary-300' : 'text-muted hover:bg-raised hover:text-fg', collapsed && 'justify-center px-0')}
      >
        <SettingsIcon className="size-4 shrink-0" />
        {!collapsed && 'Settings'}
      </NavLink>
      <div className={cn('mt-2 flex items-center gap-2.5 rounded-md px-2.5 py-1.5', collapsed && 'justify-center px-0')}>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white" aria-hidden>{initial}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-muted" title={user?.email}>{user?.email}</span>
            <Button variant="ghost" size="iconSm" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut /></Button>
          </>
        )}
      </div>
    </div>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-14 items-center gap-2.5 border-b border-line px-5', collapsed && 'justify-center px-0')}>
      <div className="flex size-7 items-center justify-center rounded-md bg-primary-600 text-white">
        <Terminal className="size-4" />
      </div>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-sm font-semibold">CIO Command</p>
          <p className="text-[11px] text-subtle">Encountive · Doug IT</p>
        </div>
      )}
    </div>
  );
}

function DemoSeeder() {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const started = useRef(false);
  const opsStarted = useRef(false);
  useEffect(() => {
    if (!user || !settings || settings.demo_seeded || started.current) return;
    started.current = true;
    seedIfFirstRun(user.id)
      .then((seeded) => {
        if (seeded) toast('Welcome. Your companies and projects are set up, plus demo tasks and hours marked DEMO DATA.', 'info');
        qc.invalidateQueries();
      })
      .catch((e) => toast(`Could not set up starter data: ${errorMessage(e)}`, 'error'));
  }, [user, settings, qc, toast]);
  useEffect(() => {
    if (!user || !settings || settings.ops_seeded || opsStarted.current) return;
    opsStarted.current = true;
    seedMonitorsIfFirstRun(user.id)
      .then(() => qc.invalidateQueries({ queryKey: ['monitors'] }))
      .catch((e) => toast(`Could not set up your default health checks: ${errorMessage(e)}`, 'error'));
  }, [user, settings, qc, toast]);
  return null;
}

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const ui = useUi();
  const location = useLocation();
  useGlobalShortcuts();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  return (
    <div className="flex min-h-screen">
      <DemoSeeder />
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-16' : 'w-64')}>
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <AccountFooter collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-9 items-center justify-center gap-2 border-t border-line text-xs text-subtle transition-colors hover:text-fg"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen} title="Menu" side="right" className="max-w-[280px]">
        <div className="-m-4 flex min-h-full flex-col">
          <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
          <AccountFooter collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </div>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-bg/90 px-3 backdrop-blur sm:px-4">
          <button
            onClick={ui.openPalette}
            className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-subtle transition-colors hover:border-subtle sm:max-w-sm"
          >
            <Search className="size-4 shrink-0" />
            <span className="truncate">Search or run a command</span>
            <kbd className="ml-auto hidden rounded border border-line bg-raised px-1.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
          </button>
          <div className="flex-1" />
          <Button size="sm" variant="primary" onClick={() => ui.openQuickAdd()} title="New task (N)">
            <Plus />
            <span className="hidden sm:inline">Task</span>
          </Button>
          <Button size="sm" onClick={ui.openLogTime} title="Log time (T)" className="hidden sm:inline-flex">
            <Clock />
            <span className="hidden md:inline">Log time</span>
          </Button>
          <FocusIndicator />
          <Button size="sm" variant="ghost" asChild>
            <Link to="/setup" title="Setup: connectors, raw data, reset" aria-label="Setup">
              <Wrench />
              <span className="hidden xl:inline">Setup</span>
            </Link>
          </Button>
          <span
            className="hidden h-8 items-center gap-1.5 rounded-md border border-dashed border-line px-2 text-xs text-subtle md:flex"
            title="IT health checks run against public services. Mail and calendar sync once connected in Setup."
          >
            <Unplug className="size-3.5" /> Sync: health checks only
          </span>
          <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme.dark ? <Sun /> : <Moon />}
          </Button>
        </header>

        <main className="flex-1 px-4 pb-24 pt-6 sm:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Bottom">
        {[
          { to: '/', label: 'Today', icon: LayoutDashboard },
          { to: '/tasks', label: 'Tasks', icon: CheckSquare },
          { to: '/ops', label: 'IT Ops', icon: Activity },
          { to: '/time', label: 'Time', icon: Clock },
        ].map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cn('flex flex-1 flex-col items-center justify-center gap-1 text-[11px]', isActive ? 'text-primary-600 dark:text-primary-400' : 'text-muted')}>
            <n.icon className="size-5" />
            {n.label}
          </NavLink>
        ))}
        <button onClick={() => setMobileOpen(true)} className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-muted">
          <Menu className="size-5" />
          More
        </button>
      </nav>

      <Dialog open={ui.state.quickAdd.open} onOpenChange={(o) => !o && ui.close('quickAdd')} title="New task" description="One line. Dates, !priority, #category and @company are picked up automatically.">
        <QuickAdd autoFocus defaultDue={ui.state.quickAdd.defaultDue} onCreated={() => ui.close('quickAdd')} />
      </Dialog>
      <Dialog open={ui.state.logTime} onOpenChange={(o) => !o && ui.close('logTime')} title="Log time">
        <LogTimeForm autoFocus onSaved={() => ui.close('logTime')} />
      </Dialog>
      <FocusStartDialog />
      <TaskDrawer />
      <CommandPalette onToggleTheme={theme.toggle} />
    </div>
  );
}
