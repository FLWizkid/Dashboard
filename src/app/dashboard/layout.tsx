import { Providers } from "@/components/providers";
import { AuthGuard } from "@/components/auth/auth-guard";
import { AppShellWrapper } from "@/components/shell/app-shell-wrapper";

export const dynamic = "force-dynamic";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Providers>
      <AuthGuard>
        <AppShellWrapper>{children}</AppShellWrapper>
      </AuthGuard>
    </Providers>
  );
}
