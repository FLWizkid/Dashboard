"use client";

import { useAuthEmail } from "@/components/auth/auth-guard";
import { AppShell } from "@/components/shell/app-shell";

export function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const email = useAuthEmail();
  return <AppShell email={email}>{children}</AppShell>;
}
