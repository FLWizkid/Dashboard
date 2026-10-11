import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft, ChevronsRight, Clock, Menu, Moon, Plus, Search, Sun, Terminal, Unplug, LayoutDashboard, CheckSquare, Settings as SettingsIcon } from 'lucide-react';
import { cn, errorMessage } from '@/lib/utils';
import { useAuth } from '@/auth/AuthProvider';
import { useSettings } from '@/data/settings';
import { seedIfFirstRun } from '@/data/demo';
import { seedMonitorsIfFirstRun } from '@/data/ops';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { QuickAdd } from '@/components/tasks/QuickAdd';
import { TaskDrawer } from '@/components/tasks/TaskDrawer';
import { LogTimeForm } from '@/components/time/LogTimeForm';
import { FocusIndicator, FocusStartDialog } from '@/components/time/Focus';
import { NAV_GROUPS, isBuilt } from './nav';
import { useUi } from './ui-context';
import { useGlobalShortcuts } from './shortcuts';
import { useTheme } from './use-theme';
import { CommandPalette } from './CommandPalette';

function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Main">
      {NAV_GROUPS.map((g) => (
        <div key={g.label}>
          {!collapsed && <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-subtle">{g.label}</p>}
          <ul className="space-y-0.5">
            {g.items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavigate}
                  title={collapsed ? n.label : undefined}
                  className={({ isActive }) =>
                    cn(
                      'flex h-8 items-center gap-2.5 rounded-md px-2 text-sm transition-colors',
                      isActive ? 'bg-raised font-medium text-fg' : 'text-muted hover:bg-raised/70 hover:text-fg',
                      collapsed && 'justify-center',
                    )
                  }
                >
                  <n.icon className={cn('size-4 shrink-0', !isBuilt(n) && 'opacity-60')} />
                  {!collapsed && (
                    <>
                      <span className={cn('flex-1 truncate', !isBuilt(n) && 'opacity-80')}>{n.label}</span>
                      {!isBuilt(n) && <span className="rounded border border-line px-1 text-[10px] text-subtle">P{n.phase}</span>}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-14 items-center gap-2 border-b border-line px-4', collapsed && 'justify-center px-0')}>
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
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex', collapsed ? 'w-14' : 'w-60')}>
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-10 items-center justify-center gap-2 border-t border-line text-xs text-subtle transition-colors hover:text-fg"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
        </button>
      </aside>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen} title="Menu" side="right" className="max-w-[280px]">
        <div className="-m-4">
          <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
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
          <span
            className="hidden h-8 items-center gap-1.5 rounded-md border border-dashed border-line px-2 text-xs text-subtle md:flex"
            title="IT health checks run against public services. Mail, calendar and agent sources arrive in Phases 3 to 5."
          >
            <Unplug className="size-3.5" /> Sync: health checks only
          </span>
          <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label={theme.dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme.dark ? <Sun /> : <Moon />}
          </Button>
        </header>

        <main className="flex-1 px-3 pb-24 pt-4 sm:px-6 lg:pb-8">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-line bg-surface/95 backdrop-blur lg:hidden" aria-label="Bottom">
        {[
          { to: '/', label: 'Today', icon: LayoutDashboard },
          { to: '/tasks', label: 'Tasks', icon: CheckSquare },
          { to: '/time', label: 'Time', icon: Clock },
          { to: '/settings', label: 'Settings', icon: SettingsIcon },
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
