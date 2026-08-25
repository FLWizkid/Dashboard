"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { FocusIndicator } from "@/components/pomodoro/focus-indicator";
import { SignOutButton } from "@/components/sign-out-button";
import { cn } from "@/lib/utils";

import { ThemeToggle } from "./theme-toggle";

import {
  MOBILE_NAV_ITEMS,
  MOBILE_OVERFLOW_ITEMS,
  NAV_ITEMS,
  type NavItem,
} from "./nav";

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

      {/* Rendered at the shell level so the running timer follows you into
          every module — a timer you can't see is a timer you forget to stop. */}
      <FocusIndicator />

      <MobileNav />
    </div>
  );
}

/**
 * The navy frame.
 *
 * The sidebar draws from the `chrome` tokens rather than the page tokens, so
 * it stays navy in both themes. That is what stops the light theme reading as
 * a white page with lines on it: the eye gets a constant saturated edge to
 * orient against, and the content area is the only thing the theme changes.
 */
function Sidebar({ email }: { email: string | null }) {
  return (
    <aside
      className={cn(
        "no-print sticky top-0 hidden h-screen shrink-0 flex-col border-r border-chrome-line bg-chrome lg:flex",
        "w-60",
      )}
    >
      <div className="border-b border-chrome-line px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold tracking-tight text-chrome-fg">
          {/* The amber mark. One saturated thing at the top of the frame,
              which is most of what an accent colour is for. */}
          <span
            aria-hidden="true"
            className="h-4 w-1 shrink-0 rounded-full bg-accent-bright"
          />
          Executive Dashboard
        </p>
        {email ? (
          <p className="mt-1 truncate pl-3 text-xs text-chrome-fg-muted">
            {email}
          </p>
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

      <div className="space-y-2 border-t border-chrome-line p-3">
        <ThemeToggle />
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
        // `chrome-fg-muted`, not a dimmer shade: at 10px this is small text
        // and needs the full 4.5:1 against the navy. The axe scan in
        // tests/e2e/a11y.spec.ts enforces it.
        <span className="rounded-full bg-chrome-raised px-1.5 py-0.5 text-[0.625rem] font-medium text-chrome-fg-muted">
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
        className={cn(base, "cursor-default text-chrome-fg-muted")}
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
        // The active module is marked by an amber rail as well as a lift, so
        // it survives being read at a glance or in greyscale.
        active
          ? "bg-chrome-raised font-medium text-chrome-fg shadow-[inset_2px_0_0_rgb(var(--accent-bright))]"
          : "text-chrome-fg-muted hover:bg-chrome-raised/60 hover:text-chrome-fg",
      )}
    >
      {inner}
    </Link>
  );
}

function MobileNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = React.useState(false);

  // Any navigation closes the sheet. Without this, tapping a module leaves it
  // covering the page you just asked for.
  React.useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const inOverflow = MOBILE_OVERFLOW_ITEMS.some((item) =>
    pathname.startsWith(item.href),
  );

  return (
    <nav
      aria-label="Modules"
      className={cn(
        // Navy here too: on a phone this bar is the frame, and matching it to
        // the sidebar is what makes the installed PWA read as one app rather
        // than as a page with a toolbar stuck to the bottom.
        "no-print fixed inset-x-0 bottom-0 z-40 border-t border-chrome-line bg-chrome/95 backdrop-blur lg:hidden",
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
                  active ? "text-accent-bright" : "text-chrome-fg-muted",
                )}
              >
                <Icon aria-hidden="true" className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}

        <li className="flex-1">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-controls="mobile-more"
            className={cn(
              "flex w-full flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium transition-colors duration-fast",
              moreOpen || inOverflow
                ? "text-accent-bright"
                : "text-chrome-fg-muted",
            )}
          >
            <Menu aria-hidden="true" className="size-5" />
            More
          </button>
        </li>
      </ul>

      {moreOpen && (
        <ul
          id="mobile-more"
          className="absolute bottom-full left-0 right-0 mb-px grid grid-cols-2 gap-1 border-t border-chrome-line bg-chrome p-2 shadow-lg"
        >
          {MOBILE_OVERFLOW_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // 44px minimum: this sheet is used one-handed, and the
                    // headset checklist holds the same floor for a raycast.
                    "flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium",
                    active
                      ? "bg-chrome-raised text-chrome-fg"
                      : "text-chrome-fg-muted hover:bg-chrome-raised/60 hover:text-chrome-fg",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {item.label}
                </Link>
              </li>
            );
          })}

          {/* The theme control is desktop-sidebar furniture, and a phone has
              no sidebar. Without this the setting is unreachable on the one
              device most likely to be carried between a dark room and
              daylight. */}
          <li className="col-span-2">
            <ThemeToggle />
          </li>
        </ul>
      )}
    </nav>
  );
}
