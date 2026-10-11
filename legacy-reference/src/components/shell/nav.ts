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

export interface NavItem {
  href: string;
  label: string;
  /** Plain-language one-liner shown below the label in the sidebar. */
  description: string;
  icon: LucideIcon;
  /** The phase that delivers it, shown on unbuilt modules. */
  phase?: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    description: "Your day at a glance",
    icon: LayoutDashboard,
  },
  {
    href: "/dashboard/tasks",
    label: "Tasks",
    description: "Everything you need to do",
    icon: ClipboardList,
  },
  {
    href: "/dashboard/email",
    label: "Email",
    description: "Messages from connected accounts",
    icon: Mail,
  },
  {
    href: "/dashboard/calendar",
    label: "Calendar",
    description: "Meetings and scheduled events",
    icon: CalendarDays,
  },
  {
    href: "/dashboard/kanban",
    label: "Board",
    description: "Drag tasks between columns",
    icon: SquareKanban,
  },
  {
    href: "/dashboard/pomodoro",
    label: "Focus Timer",
    description: "Timed work sessions",
    icon: Timer,
  },
  {
    href: "/dashboard/hours",
    label: "Hours",
    description: "Track where your time goes",
    icon: Hourglass,
  },
  {
    href: "/dashboard/reports",
    label: "Reports",
    description: "Weekly summaries and trends",
    icon: FileBarChart,
  },
  {
    href: "/dashboard/inbox",
    label: "Briefings",
    description: "Scheduled digests and notices",
    icon: Inbox,
  },
];

const MOBILE_HREFS = [
  "/dashboard",
  "/dashboard/tasks",
  "/dashboard/pomodoro",
  "/dashboard/hours",
];

export const MOBILE_NAV_ITEMS: NavItem[] = MOBILE_HREFS.map((href) =>
  NAV_ITEMS.find((item) => item.href === href)!,
).filter((item) => item && !item.phase);

export const MOBILE_OVERFLOW_ITEMS: NavItem[] = NAV_ITEMS.filter(
  (item) => !item.phase && !MOBILE_HREFS.includes(item.href),
);
