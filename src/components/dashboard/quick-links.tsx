import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Places outside this app that the owner goes to often enough to want one
 * click away from the dashboard.
 *
 * ── Why these live here and not in the module nav ────────────────────────
 * The sidebar is a map of this application. Putting an outbound link in it
 * would say "this is a module", and then clicking it would leave — which is
 * the small dishonesty that makes navigation stop being trustworthy. These
 * sit in the page header instead, next to the page's own title, marked as
 * leaving.
 *
 * ── Always marked as leaving ─────────────────────────────────────────────
 * The icon is visual and the "opens in a new tab" is for a screen reader.
 * Both are needed: a link that silently opens a new tab is disorienting for
 * anyone who then presses Back and finds it does nothing.
 *
 * ── rel is load-bearing ──────────────────────────────────────────────────
 * `noopener` denies the opened page a handle on this one through
 * `window.opener`, which it could otherwise use to navigate this tab
 * somewhere else. `noreferrer` keeps this box's URL — a tailnet address —
 * out of the destination's referrer logs. Neither is optional for an
 * outbound link from a private application.
 */

interface QuickLink {
  label: string;
  href: string;
  /** What it is, for the accessible name. Never shown on its own. */
  description: string;
}

const QUICK_LINKS: QuickLink[] = [
  {
    label: "AI Tools",
    href: "https://academy.techpresso.co/free-tools",
    description: "Techpresso free AI tools directory",
  },
];

export function QuickLinks({ className }: { className?: string }) {
  if (QUICK_LINKS.length === 0) return null;

  return (
    <div className={className} data-testid="quick-links">
      {QUICK_LINKS.map((link) => (
        <Button
          key={link.href}
          asChild
          variant="secondary"
          size="sm"
          data-testid={`quick-link-${link.label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
            <ExternalLink aria-hidden="true" />
            <span className="sr-only">
              — {link.description}, opens in a new tab
            </span>
          </a>
        </Button>
      ))}
    </div>
  );
}
