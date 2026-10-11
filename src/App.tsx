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
                <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                  <Route index element={<TodayPage />} />
                  <Route path="tasks" element={<TasksPage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="time" element={<TimePage />} />
                  <Route path="settings/:section?" element={<SettingsPage />} />
                  <Route path="ops" element={<OpsPage />} />
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
