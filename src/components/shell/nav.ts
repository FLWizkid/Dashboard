import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  FileBarChart,
  Hourglass,
  LayoutDashboard,
  Mail,
  NotebookPen,
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
  { href: "/dashboard/email", label: "Email", icon: Mail, phase: "P2" },
  {
    href: "/dashboard/calendar",
    label: "Calendar",
    icon: CalendarDays,
    phase: "P2",
  },
  { href: "/dashboard/kanban", label: "Kanban", icon: SquareKanban },
  { href: "/dashboard/notes", label: "Notes", icon: NotebookPen },
  { href: "/dashboard/pomodoro", label: "Pomodoro", icon: Timer },
  { href: "/dashboard/hours", label: "Hours", icon: Hourglass },
  {
    href: "/dashboard/reports",
    label: "Reports",
    icon: FileBarChart,
    phase: "P6",
  },
];

/**
 * The subset that fits a phone's bottom bar.
 *
 * Named explicitly rather than derived from "everything that is built": five
 * targets is what fits legibly across a phone, and as more modules land the
 * derived list would silently keep growing until every label was three
 * truncated characters. Hours earns its place over Notes here because
 * one-tap logging is the thing this product is used for while standing up.
 */
const MOBILE_HREFS = [
  "/dashboard",
  "/dashboard/tasks",
  "/dashboard/kanban",
  "/dashboard/pomodoro",
  "/dashboard/hours",
];

export const MOBILE_NAV_ITEMS: NavItem[] = MOBILE_HREFS.map((href) =>
  NAV_ITEMS.find((item) => item.href === href)!,
).filter((item) => item && !item.phase);
