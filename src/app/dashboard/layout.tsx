import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
        <div>
          <h1 className="text-lg font-semibold">God&apos;s Master Dashboard</h1>
          <p className="text-xs text-slate-500">{user.email}</p>
        </div>
        <SignOutButton />
      </header>
      <nav className="flex gap-4 border-b border-slate-200 px-6 py-2 text-sm dark:border-slate-800">
        <Link
          href="/dashboard"
          className="text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          Overview
        </Link>
        <Link
          href="/dashboard/priority"
          className="text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          Priority
        </Link>
        <Link
          href="/dashboard/hours"
          className="text-slate-600 transition hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
        >
          Hours
        </Link>
      </nav>
      <main className="p-6">{children}</main>
    </div>
  );
}
