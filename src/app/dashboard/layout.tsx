import { redirect } from "next/navigation";

import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { getSessionUser } from "@/lib/auth";

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

  return (
    <Providers>
      <AppShell email={user.email}>{children}</AppShell>
    </Providers>
  );
}
