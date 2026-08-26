import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  FileBarChart,
  Inbox,
  Hourglass,
  LayoutDashboard,
  Mail,
  SquareKanban,
  Timer,
} from "lucide-react";

/**
 * The eight modules, in the order they appear in the product.
 *
 * Modules that haven't been built yet are listed but not linked. Showing the
 * whole shape from the start is deliberate: it is the difference between "a
 * task app" and "the operational core of a dashboard that is still arriving".
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** The phase that delivers it, shown on unbuilt modules. */
  phase?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/dashboard/email", label: "Email", icon: Mail },
  { href: "/dashboard/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/dashboard/kanban", label: "Kanban", icon: SquareKanban },
  { href: "/dashboard/pomodoro", label: "Pomodoro", icon: Timer },
  { href: "/dashboard/hours", label: "Hours", icon: Hourglass },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart },
  // "Digest", not "Inbox". Two things called Inbox — this and the board's
  // first lane, where untriaged tasks land — is an ambiguity in a product
  // whose whole job is telling you where a thing is. This one is where
  // scheduled briefs and agent notices arrive, which is what a digest is.
  { href: "/dashboard/inbox", label: "Digest", icon: Inbox },
];

/**
 * Notes is deliberately absent.
 *
 * The owner does not want it as a destination, so it is not in the menu. The
 * route and the Obsidian vault sync are untouched: notes still round-trip to
 * Markdown on disk, which was a founding requirement, and anything that
 * writes one still works. What is gone is the claim that browsing them is a
 * thing you do here — you do it in Obsidian.
 *
 * Because this list is the single source for both the sidebar and the phone's
 * overflow sheet, dropping it here removes it everywhere at once rather than
 * leaving a half-hidden entry on one surface.
 */

/**
 * The subset that fits a phone's bottom bar.
 *
 * Named explicitly rather than derived from "everything that is built": five
 * targets is what fits legibly across a phone, and as more modules land the
 * derived list would silently keep growing until every label was three
 * truncated characters. Hours earns its place over Notes here because
 * one-tap logging is the thing this product is used for while standing up.
 *
 * **Four, not five** — the fifth slot is *More*, because a cap that hides
 * modules with no way to reach them is not a cap, it is a phone build that is
 * missing half the product. Everything not in this list lives behind that
 * sheet, and `MOBILE_OVERFLOW_ITEMS` is derived so a new module can never be
 * added to the sidebar and silently left unreachable on a phone.
 */
const MOBILE_HREFS = [
  "/dashboard",
  "/dashboard/tasks",
  "/dashboard/pomodoro",
  "/dashboard/hours",
];

export const MOBILE_NAV_ITEMS: NavItem[] = MOBILE_HREFS.map((href) =>
  NAV_ITEMS.find((item) => item.href === href)!,
).filter((item) => item && !item.phase);

/** Everything the bottom bar does not have room for. Derived, never listed. */
export const MOBILE_OVERFLOW_ITEMS: NavItem[] = NAV_ITEMS.filter(
  (item) => !item.phase && !MOBILE_HREFS.includes(item.href),
);
