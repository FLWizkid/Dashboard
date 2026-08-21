import { redirect } from "next/navigation";

import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/lib/auth";
import { ensureDemoSeeded } from "@/lib/demo/ensure";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Belt and braces: middleware already redirects, but a layout that renders
  // private data must not depend on middleware having run.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // No-op unless DASHBOARD_DEMO_DATA is set and memory mode is on. Here
  // rather than in instrumentation because that file is compiled for the
  // edge runtime too, and the memory stores are Node-only.
  await ensureDemoSeeded();

  return (
    <Providers>
      <AppShell email={user.email}>{children}</AppShell>
    </Providers>
  );
}
