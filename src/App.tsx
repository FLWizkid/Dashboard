import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { SignInPage } from '@/auth/SignInPage';
import { ToastProvider } from '@/components/ui/toast';
import { UiProvider } from '@/components/shell/ui-context';
import { AppShell } from '@/components/shell/AppShell';
import { ALL_NAV, isBuilt } from '@/components/shell/nav';
import { TodayPage } from '@/pages/TodayPage';
import { TasksPage } from '@/pages/TasksPage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { TimePage } from '@/pages/TimePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { PhasePage } from '@/pages/PhasePage';
import { OpsPage } from '@/pages/OpsPage';
import { InboxPage } from '@/pages/InboxPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { SetupPage } from '@/pages/SetupPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { AssetsPage } from '@/pages/AssetsPage';
import { SpendPage } from '@/pages/SpendPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { IdentityPage } from '@/pages/IdentityPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { useAssurance } from '@/auth/mfa';
import { MfaChallenge } from '@/auth/MfaChallenge';
import { NotesPage } from '@/pages/NotesPage';
import { WeeklyPage } from '@/pages/WeeklyPage';
import { RequestsPage } from '@/pages/RequestsPage';
import { RequestStatusPrint } from '@/pages/RequestStatusPrint';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true } },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="skeleton h-2 w-40 rounded-full" aria-label="Loading" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <MfaGate>{children}</MfaGate>;
}

function MfaGate({ children }: { children: ReactNode }) {
  const aal = useAssurance();
  if (aal.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="skeleton h-2 w-40 rounded-full" aria-label="Loading" />
      </div>
    );
  }
  if (aal.data && aal.data.next === 'aal2' && aal.data.current !== 'aal2') return <MfaChallenge />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <UiProvider>
              <Routes>
                <Route path="/login" element={<SignInPage />} />
                <Route path="/requests/status" element={<RequireAuth><RequestStatusPrint /></RequireAuth>} />
                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<TodayPage />} />
                  <Route path="tasks" element={<TasksPage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="time" element={<TimePage />} />
                  <Route path="settings/:section?" element={<SettingsPage />} />
                  <Route path="ops" element={<OpsPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="calendar" element={<CalendarPage />} />
                  <Route path="setup" element={<SetupPage />} />
                  <Route path="agents" element={<AgentsPage />} />
                  <Route path="assets/:section?" element={<AssetsPage />} />
                  <Route path="spend" element={<SpendPage />} />
                  <Route path="security/:section?" element={<SecurityPage />} />
                  <Route path="requests" element={<RequestsPage />} />
                  <Route path="identity/:section?" element={<IdentityPage />} />
                  <Route path="library/:id?" element={<LibraryPage />} />
                  <Route path="notes/:id?" element={<NotesPage />} />
                  <Route path="weekly" element={<WeeklyPage />} />
                  {ALL_NAV.filter((n) => !isBuilt(n)).map((n) => (
                    <Route key={n.to} path={n.to.slice(1)} element={<PhasePage />} />
                  ))}
                  <Route path="*" element={<PhasePage />} />
                </Route>
              </Routes>
            </UiProvider>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
