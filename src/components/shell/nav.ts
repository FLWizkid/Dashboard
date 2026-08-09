import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  FileBarChart,
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
  { href: "/dashboard/notes", label: "Notes", icon: NotebookPen, phase: "P3" },
  { href: "/dashboard/pomodoro", label: "Pomodoro", icon: Timer, phase: "P4" },
  {
    href: "/dashboard/reports",
    label: "Reports",
    icon: FileBarChart,
    phase: "P6",
  },
];

/** The subset that fits a phone's bottom bar. */
export const MOBILE_NAV_ITEMS: NavItem[] = NAV_ITEMS.filter(
  (item) => !item.phase,
);
