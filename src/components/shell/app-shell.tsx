"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

import { MOBILE_NAV_ITEMS, NAV_ITEMS, type NavItem } from "./nav";

/**
 * The application shell.
 *
 * One layout, three sizes: a rail of icons on tablets, a labelled sidebar on
 * desktop, a bottom bar on phones. The bottom bar clears the iOS home
 * indicator via `env(safe-area-inset-bottom)`, which is what makes the
 * installed PWA feel like an app rather than a page.
 */
export function AppShell({
  email,
  children,
}: {
  email: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only focus-reveal absolute left-4 top-4 z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-fg"
      >
        Skip to content
      </a>

      <Sidebar email={email} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 sm:px-6 lg:pb-10"
        >
          {children}
        </main>
      </div>

      <MobileNav />
    </div>
  );
}

function Sidebar({ email }: { email: string | null }) {
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface lg:flex",
        "w-60",
      )}
    >
      <div className="border-b border-line px-5 py-4">
        <p className="text-sm font-semibold tracking-tight text-fg">
          Executive Dashboard
        </p>
        {email ? (
          <p className="mt-0.5 truncate text-xs text-fg-subtle">{email}</p>
        ) : null}
      </div>

      <nav aria-label="Modules" className="flex-1 overflow-y-auto p-3">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <SidebarLink item={item} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-line p-3">
        <SignOutButton />
      </div>
    </aside>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const Icon = item.icon;

  // `/dashboard` must not light up for every child route.
  const active =
    item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href);

  const inner = (
    <>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.phase ? (
        // `fg-muted`, not `fg-subtle`: at 10px this is small text and needs
        // the full 4.5:1. The axe scan in tests/e2e/a11y.spec.ts enforces it.
        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[0.625rem] font-medium text-fg-muted">
          {item.phase}
        </span>
      ) : null}
    </>
  );

  const base = cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-fast ease-standard",
  );

  if (item.phase) {
    return (
      <span
        className={cn(base, "cursor-default text-fg-subtle")}
        title={`Arrives in phase ${item.phase}`}
      >
        {inner}
        <span className="sr-only">Not built yet</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        active
          ? "bg-primary-soft font-medium text-primary-soft-fg"
          : "text-fg-muted hover:bg-surface-muted hover:text-fg",
      )}
    >
      {inner}
    </Link>
  );
}

function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Modules"
      className={cn(
        "no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden",
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="flex">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium transition-colors duration-fast",
                  active ? "text-primary" : "text-fg-subtle",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
